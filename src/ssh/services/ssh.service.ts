import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { EncryptionService } from '../../common/services/encryption.service';
import { RedactionService } from '../../common/services/redaction.service';
import { SSHValidationService } from './ssh-validation.service';
import { SSHConnectionPoolService } from './ssh-connection-pool.service';
import {
  SSHConnection,
  SSHConnectionConfig,
  CommandResult,
  FileTransferResult,
  SSHServiceInterface,
  CommandExecutionOptions,
  CommandTemplate,
  HostKeyVerificationResult,
} from '../interfaces/ssh.interface';
import {
  SSHConnectionError,
  SSHAuthenticationError,
  SSHCommandExecutionError,
  SSHHostKeyVerificationError,
  SSHFileTransferError,
} from '../exceptions/ssh.exceptions';
import { Client as SSHClient, ConnectConfig } from 'ssh2';
import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs/promises';
import * as path from 'path';

@Injectable()
export class SSHService implements SSHServiceInterface, OnModuleDestroy {
  private readonly logger = new Logger(SSHService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly prismaService: PrismaService,
    private readonly encryptionService: EncryptionService,
    private readonly redactionService: RedactionService,
    private readonly validationService: SSHValidationService,
    private readonly connectionPool: SSHConnectionPoolService
  ) {}

  async onModuleDestroy(): Promise<void> {
    await this.connectionPool.closeAllConnections();
  }

  /**
   * Connect to a server using its ID from the database
   */
  async connect(serverId: string): Promise<SSHConnection> {
    try {
      // Get server configuration from database
      const server = await this.prismaService.server.findUnique({
        where: { id: serverId },
      });

      if (!server) {
        throw new SSHConnectionError(`Server with ID ${serverId} not found`);
      }

      // Decrypt credentials
      const decryptedCredentials = this.encryptionService.decrypt(server.encryptedCredentials);
      const credentials = JSON.parse(decryptedCredentials);

      // Build SSH configuration
      const sshConfig: SSHConnectionConfig = {
        hostname: this.validationService.validateHostname(server.hostname),
        port: this.validationService.validatePort(server.port),
        username: this.validationService.validateUsername(server.username),
        authType: server.authType === 'KEY' ? 'key' : 'password',
        strictHostKeyChecking: true,
        connectionTimeout: this.configService.get<number>('SSH_CONNECTION_TIMEOUT', 30000),
        keepaliveInterval: this.configService.get<number>('SSH_KEEPALIVE_INTERVAL', 30000),
      };

      // Set host key fingerprint if available
      if (server.hostKeyFingerprint) {
        sshConfig.hostKeyFingerprint = server.hostKeyFingerprint;
      }

      // Set authentication credentials
      if (sshConfig.authType === 'key') {
        sshConfig.privateKey = credentials.privateKey;
      } else {
        sshConfig.password = credentials.password;
      }

      // Create SSH connection
      const connection = await this.createConnection(sshConfig);

      // Add to connection pool
      await this.connectionPool.addConnection(serverId, connection);

      this.logger.log(`Successfully connected to server ${serverId} (${server.hostname})`);
      return connection;
    } catch (error) {
      this.logger.error(`Failed to connect to server ${serverId}`, error);
      throw error;
    }
  }

  /**
   * Create a new SSH connection with strict host key verification
   */
  private async createConnection(config: SSHConnectionConfig): Promise<SSHConnection> {
    return new Promise((resolve, reject) => {
      const client = new SSHClient();
      const connectionId = uuidv4();
      let isResolved = false;

      const connection: SSHConnection = {
        id: connectionId,
        config,
        connection: client,
        isConnected: false,
        lastUsed: new Date(),
        createdAt: new Date(),
      };

      // Set connection timeout
      const timeout = setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          client.destroy();
          reject(new SSHConnectionError(
            `Connection timeout after ${config.connectionTimeout}ms`,
            config.hostname,
            config.port
          ));
        }
      }, config.connectionTimeout || 30000);

      client.on('ready', () => {
        if (!isResolved) {
          isResolved = true;
          clearTimeout(timeout);
          connection.isConnected = true;
          connection.lastUsed = new Date();
          
          this.logger.debug(`SSH connection established to ${config.hostname}:${config.port}`);
          resolve(connection);
        }
      });

      client.on('error', (error: any) => {
        if (!isResolved) {
          isResolved = true;
          clearTimeout(timeout);
          
          this.logger.error(`SSH connection error to ${config.hostname}:${config.port}`, error);
          
          if (error.code === 'ENOTFOUND') {
            reject(new SSHConnectionError(
              `Host not found: ${config.hostname}`,
              config.hostname,
              config.port,
              error
            ));
          } else if (error.code === 'ECONNREFUSED') {
            reject(new SSHConnectionError(
              `Connection refused to ${config.hostname}:${config.port}`,
              config.hostname,
              config.port,
              error
            ));
          } else if (error.message && error.message.includes('authentication')) {
            reject(new SSHAuthenticationError(
              `Authentication failed for ${config.username}@${config.hostname}`,
              config.hostname,
              config.username
            ));
          } else {
            reject(new SSHConnectionError(
              error.message || 'Unknown SSH connection error',
              config.hostname,
              config.port,
              error
            ));
          }
        }
      });

      client.on('close', () => {
        connection.isConnected = false;
        this.logger.debug(`SSH connection closed to ${config.hostname}:${config.port}`);
      });

      client.on('end', () => {
        connection.isConnected = false;
        this.logger.debug(`SSH connection ended to ${config.hostname}:${config.port}`);
      });

      // Handle host key verification
      client.on('hostkeys', (hostkeys: any) => {
        if (config.strictHostKeyChecking && config.hostKeyFingerprint) {
          const verification = this.verifyHostKey(hostkeys, config.hostKeyFingerprint);
          if (!verification.verified) {
            client.destroy();
            if (!isResolved) {
              isResolved = true;
              clearTimeout(timeout);
              reject(new SSHHostKeyVerificationError(
                verification.reason || 'Host key verification failed',
                config.hostname,
                config.hostKeyFingerprint,
                verification.fingerprint
              ));
            }
            return;
          }
        }
      });

      // Build SSH2 connection config
      const ssh2Config: ConnectConfig = {
        host: config.hostname,
        port: config.port,
        username: config.username,
        readyTimeout: config.connectionTimeout || 30000,
        keepaliveInterval: config.keepaliveInterval || 30000,
        keepaliveCountMax: 3,
      };

      // Set authentication method
      if (config.authType === 'key' && config.privateKey) {
        ssh2Config.privateKey = config.privateKey;
      } else if (config.authType === 'password' && config.password) {
        ssh2Config.password = config.password;
      } else {
        reject(new SSHAuthenticationError(
          'Invalid authentication configuration',
          config.hostname,
          config.username
        ));
        return;
      }

      // Enable strict host key checking if configured
      if (config.strictHostKeyChecking) {
        ssh2Config.hostVerifier = (key: Buffer, callback: (result: boolean) => void) => {
          if (config.hostKeyFingerprint) {
            const keyHash = createHash('sha256').update(key).digest('base64');
            const verified = keyHash === config.hostKeyFingerprint;
            if (!verified) {
              this.logger.warn(
                `Host key verification failed for ${config.hostname}. ` +
                `Expected: ${config.hostKeyFingerprint}, Got: ${keyHash}`
              );
            }
            callback(verified);
          } else {
            // If no fingerprint is configured, accept but log warning
            const keyHash = createHash('sha256').update(key).digest('base64');
            this.logger.warn(
              `No host key fingerprint configured for ${config.hostname}. ` +
              `Current fingerprint: ${keyHash}`
            );
            callback(true);
          }
        };
      }

      // Initiate connection
      client.connect(ssh2Config);
    });
  }

  /**
   * Verify SSH host key
   */
  private verifyHostKey(hostkeys: any, expectedFingerprint: string): HostKeyVerificationResult {
    try {
      // Extract the first host key (usually the server's primary key)
      const hostkey = hostkeys[0];
      if (!hostkey) {
        return {
          verified: false,
          fingerprint: '',
          algorithm: 'unknown',
          reason: 'No host key provided by server',
        };
      }

      // Generate fingerprint from the host key
      const keyData = hostkey.key;
      const hash = createHash('sha256');
      hash.update(keyData);
      const fingerprint = hash.digest('base64');

      const result: HostKeyVerificationResult = {
        verified: fingerprint === expectedFingerprint,
        fingerprint,
        algorithm: hostkey.type || 'unknown',
      };

      if (!result.verified) {
        result.reason = `Host key fingerprint mismatch. Expected: ${expectedFingerprint}, Got: ${fingerprint}`;
      }

      return result;
    } catch (error: any) {
      return {
        verified: false,
        fingerprint: '',
        algorithm: 'unknown',
        reason: `Error verifying host key: ${error?.message || 'Unknown error'}`,
      };
    }
  }

  /**
   * Disconnect from a server
   */
  async disconnect(connectionId: string): Promise<void> {
    await this.connectionPool.closeConnection(connectionId);
  }

  /**
   * Execute a command on the remote server
   */
  async executeCommand(
    connectionId: string,
    command: string,
    options: CommandExecutionOptions = {}
  ): Promise<CommandResult> {
    try {
      // Validate and sanitize command
      const sanitizedCommand = this.validationService.validateCommand(command);
      
      // Get connection from pool
      const connection = await this.connectionPool.getConnection(connectionId);
      
      if (!connection.isConnected) {
        throw new SSHConnectionError('Connection is not active', connection.config.hostname, connection.config.port);
      }

      // Execute command
      const result = await this.executeSSHCommand(connection, sanitizedCommand, options);
      
      // Update connection last used time
      await this.connectionPool.releaseConnection(connectionId);
      
      // Sanitize output if requested
      if (options.sanitizeOutput !== false) {
        result.stdout = this.redactionService.redactText(result.stdout);
        result.stderr = this.redactionService.redactText(result.stderr);
      }

      this.logger.debug(
        `Command executed successfully on ${connection.config.hostname}: ${this.redactionService.redactCommand(command)}`
      );

      return result;
    } catch (error: any) {
      this.logger.error(`Command execution failed: ${this.redactionService.redactCommand(command)}`, error);
      
      if (error instanceof SSHCommandExecutionError) {
        throw error;
      }
      
      throw new SSHCommandExecutionError(
        error?.message || 'Command execution failed',
        command,
        undefined,
        undefined
      );
    }
  }

  /**
   * Execute a templated command with parameter substitution
   */
  async executeTemplatedCommand(
    connectionId: string,
    template: CommandTemplate
  ): Promise<CommandResult> {
    try {
      // Create safe command from template
      const safeCommand = this.validationService.createSafeTemplate(
        template.template,
        template.parameters || {}
      );

      // Execute the safe command
      return await this.executeCommand(connectionId, safeCommand);
    } catch (error) {
      this.logger.error(`Templated command execution failed: ${template.template}`, error);
      throw error;
    }
  }

  /**
   * Execute SSH command with proper error handling
   */
  private async executeSSHCommand(
    connection: SSHConnection,
    command: string,
    options: CommandExecutionOptions
  ): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      let stdout = '';
      let stderr = '';
      let isResolved = false;

      // Set command timeout
      const timeout = setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          reject(new SSHCommandExecutionError(
            `Command timeout after ${options.timeout || 30000}ms`,
            command
          ));
        }
      }, options.timeout || 30000);

      const execOptions: any = {};
      
      if (options.pty) {
        execOptions.pty = true;
      }

      if (options.env) {
        const sanitizedEnv = this.validationService.validateEnvironmentVariables(options.env);
        execOptions.env = sanitizedEnv;
      }

      connection.connection.exec(command, execOptions, (err: any, stream: any) => {
        if (err) {
          if (!isResolved) {
            isResolved = true;
            clearTimeout(timeout);
            reject(new SSHCommandExecutionError(
              `Failed to execute command: ${err.message}`,
              command
            ));
          }
          return;
        }

        stream.on('close', (code: number) => {
          if (!isResolved) {
            isResolved = true;
            clearTimeout(timeout);
            
            const executionTime = Date.now() - startTime;
            
            resolve({
              stdout,
              stderr,
              exitCode: code,
              executionTime,
              timestamp: new Date(),
              command: this.redactionService.redactCommand(command),
            });
          }
        });

        stream.on('data', (data: Buffer) => {
          stdout += data.toString();
        });

        stream.stderr.on('data', (data: Buffer) => {
          stderr += data.toString();
        });

        stream.on('error', (streamError: any) => {
          if (!isResolved) {
            isResolved = true;
            clearTimeout(timeout);
            reject(new SSHCommandExecutionError(
              `Stream error: ${streamError.message}`,
              command
            ));
          }
        });
      });
    });
  }

  /**
   * Upload a file to the remote server
   */
  async uploadFile(
    connectionId: string,
    localPath: string,
    remotePath: string
  ): Promise<FileTransferResult> {
    const startTime = Date.now();
    
    try {
      // Validate paths
      const sanitizedLocalPath = this.validationService.validatePath(localPath, 'local');
      const sanitizedRemotePath = this.validationService.validatePath(remotePath, 'remote');
      
      // Get connection from pool
      const connection = await this.connectionPool.getConnection(connectionId);
      
      if (!connection.isConnected) {
        throw new SSHConnectionError('Connection is not active', connection.config.hostname, connection.config.port);
      }

      // Check if local file exists
      try {
        await fs.access(sanitizedLocalPath);
      } catch {
        throw new SSHFileTransferError(
          `Local file does not exist: ${sanitizedLocalPath}`,
          sanitizedLocalPath,
          sanitizedRemotePath
        );
      }

      // Get file size
      const stats = await fs.stat(sanitizedLocalPath);
      const fileSize = stats.size;

      // Perform file upload
      await this.performFileUpload(connection, sanitizedLocalPath, sanitizedRemotePath);
      
      // Update connection last used time
      await this.connectionPool.releaseConnection(connectionId);
      
      const executionTime = Date.now() - startTime;
      
      this.logger.debug(
        `File uploaded successfully to ${connection.config.hostname}: ${sanitizedLocalPath} -> ${sanitizedRemotePath}`
      );

      return {
        success: true,
        bytesTransferred: fileSize,
        executionTime,
        timestamp: new Date(),
      };
    } catch (error: any) {
      this.logger.error(`File upload failed: ${localPath} -> ${remotePath}`, error);
      
      if (error instanceof SSHFileTransferError) {
        throw error;
      }
      
      throw new SSHFileTransferError(
        error?.message || 'File upload failed',
        localPath,
        remotePath
      );
    }
  }

  /**
   * Download a file from the remote server
   */
  async downloadFile(
    connectionId: string,
    remotePath: string,
    localPath: string
  ): Promise<FileTransferResult> {
    const startTime = Date.now();
    
    try {
      // Validate paths
      const sanitizedRemotePath = this.validationService.validatePath(remotePath, 'remote');
      const sanitizedLocalPath = this.validationService.validatePath(localPath, 'local');
      
      // Get connection from pool
      const connection = await this.connectionPool.getConnection(connectionId);
      
      if (!connection.isConnected) {
        throw new SSHConnectionError('Connection is not active', connection.config.hostname, connection.config.port);
      }

      // Ensure local directory exists
      const localDir = path.dirname(sanitizedLocalPath);
      await fs.mkdir(localDir, { recursive: true });

      // Perform file download
      const bytesTransferred = await this.performFileDownload(connection, sanitizedRemotePath, sanitizedLocalPath);
      
      // Update connection last used time
      await this.connectionPool.releaseConnection(connectionId);
      
      const executionTime = Date.now() - startTime;
      
      this.logger.debug(
        `File downloaded successfully from ${connection.config.hostname}: ${sanitizedRemotePath} -> ${sanitizedLocalPath}`
      );

      return {
        success: true,
        bytesTransferred,
        executionTime,
        timestamp: new Date(),
      };
    } catch (error: any) {
      this.logger.error(`File download failed: ${remotePath} -> ${localPath}`, error);
      
      if (error instanceof SSHFileTransferError) {
        throw error;
      }
      
      throw new SSHFileTransferError(
        error?.message || 'File download failed',
        localPath,
        remotePath
      );
    }
  }

  /**
   * Perform file upload using SFTP
   */
  private async performFileUpload(
    connection: SSHConnection,
    localPath: string,
    remotePath: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      connection.connection.sftp((err: any, sftp: any) => {
        if (err) {
          reject(new SSHFileTransferError(
            `SFTP initialization failed: ${err.message}`,
            localPath,
            remotePath
          ));
          return;
        }

        sftp.fastPut(localPath, remotePath, (uploadErr: any) => {
          sftp.end();
          
          if (uploadErr) {
            reject(new SSHFileTransferError(
              `File upload failed: ${uploadErr.message}`,
              localPath,
              remotePath
            ));
          } else {
            resolve();
          }
        });
      });
    });
  }

  /**
   * Perform file download using SFTP
   */
  private async performFileDownload(
    connection: SSHConnection,
    remotePath: string,
    localPath: string
  ): Promise<number> {
    return new Promise((resolve, reject) => {
      connection.connection.sftp((err: any, sftp: any) => {
        if (err) {
          reject(new SSHFileTransferError(
            `SFTP initialization failed: ${err.message}`,
            localPath,
            remotePath
          ));
          return;
        }

        // Get file stats first to get size
        sftp.stat(remotePath, (statErr: any, stats: any) => {
          if (statErr) {
            sftp.end();
            reject(new SSHFileTransferError(
              `Remote file not found: ${statErr.message}`,
              localPath,
              remotePath
            ));
            return;
          }

          const fileSize = stats.size;

          sftp.fastGet(remotePath, localPath, (downloadErr: any) => {
            sftp.end();
            
            if (downloadErr) {
              reject(new SSHFileTransferError(
                `File download failed: ${downloadErr.message}`,
                localPath,
                remotePath
              ));
            } else {
              resolve(fileSize);
            }
          });
        });
      });
    });
  }

  /**
   * Validate if a connection is still active
   */
  async validateConnection(connectionId: string): Promise<boolean> {
    try {
      const connection = await this.connectionPool.getConnection(connectionId);
      return connection.isConnected;
    } catch {
      return false;
    }
  }

  /**
   * Test a connection configuration without adding to pool
   */
  async testConnection(config: SSHConnectionConfig): Promise<boolean> {
    try {
      const connection = await this.createConnection(config);
      
      // Close the test connection immediately
      if (connection.connection) {
        connection.connection.end();
      }
      
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get connection pool statistics
   */
  getPoolStats() {
    return this.connectionPool.getPoolStats();
  }

  /**
   * Get connections for a specific server
   */
  getServerConnections(serverId: string) {
    return this.connectionPool.getServerConnections(serverId);
  }

  /**
   * Close all connections for a specific server
   */
  async closeServerConnections(serverId: string): Promise<void> {
    await this.connectionPool.closeServerConnections(serverId);
  }
}