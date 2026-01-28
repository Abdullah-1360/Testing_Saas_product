import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { EncryptionService } from '@/common/services/encryption.service';
import { LoggerService } from '@/common/services/logger.service';
import { SSHService } from '@/ssh/services/ssh.service';
import { Server, AuthType } from '@prisma/client';
import { CreateServerDto } from './dto/create-server.dto';
import { UpdateServerDto } from './dto/update-server.dto';

export interface ServerWithDecryptedCredentials extends Omit<Server, 'encryptedCredentials'> {
  credentials: string;
}

@Injectable()
export class ServersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryptionService: EncryptionService,
    private readonly logger: LoggerService,
    private readonly sshService: SSHService,
  ) {}

  /**
   * Create a new server with encrypted credentials
   * **Validates: Requirements 6.2** - Encrypt all secrets at rest using libsodium
   */
  async create(createServerDto: CreateServerDto): Promise<Server> {
    try {
      // Format credentials for storage
      const credentialsData = {
        [createServerDto.authType === AuthType.KEY ? 'privateKey' : 'password']: createServerDto.credentials,
      };

      // Encrypt credentials before storing
      const encryptedCredentials = this.encryptionService.encrypt(JSON.stringify(credentialsData));

      const server = await this.prisma.server.create({
        data: {
          name: createServerDto.name,
          hostname: createServerDto.hostname,
          port: createServerDto.port || 22,
          username: createServerDto.username,
          authType: createServerDto.authType,
          encryptedCredentials,
          hostKeyFingerprint: createServerDto.hostKeyFingerprint || null,
          controlPanel: createServerDto.controlPanel || null,
        },
      });

      this.logger.logAuditEvent(
        'server_created',
        'server',
        {
          serverId: server.id,
          hostname: server.hostname,
          authType: server.authType,
        },
        'ServersService'
      );

      return server;
    } catch (error) {
      this.logger.error(
        `Failed to create server: ${(error as Error).message}`,
        (error as Error).stack,
        'ServersService'
      );
      throw new BadRequestException('Failed to create server');
    }
  }

  /**
   * Find all servers (credentials remain encrypted)
   */
  async findAll(): Promise<Server[]> {
    return this.prisma.server.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Find all servers with pagination and filtering
   */
  async findAllPaginated(
    skip: number, 
    limit: number, 
    filters: Record<string, any> = {}
  ): Promise<{ servers: Server[]; total: number }> {
    const where: any = {};

    // Apply filters
    if (filters.controlPanel) {
      where.controlPanel = filters.controlPanel;
    }
    if (filters.authType) {
      where.authType = filters.authType;
    }
    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { hostname: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const [servers, total] = await Promise.all([
      this.prisma.server.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.server.count({ where }),
    ]);

    return { servers, total };
  }

  /**
   * Find server by ID (credentials remain encrypted)
   */
  async findOne(id: string): Promise<Server> {
    const server = await this.prisma.server.findUnique({
      where: { id },
    });

    if (!server) {
      throw new NotFoundException(`Server with ID ${id} not found`);
    }

    return server;
  }

  /**
   * Find server by ID with decrypted credentials (for SSH operations)
   * **Validates: Requirements 6.2** - Decrypt secrets when needed for operations
   */
  async findOneWithCredentials(id: string): Promise<ServerWithDecryptedCredentials> {
    const server = await this.findOne(id);

    try {
      // Decrypt credentials for use
      const credentials = this.encryptionService.decrypt(server.encryptedCredentials);

      this.logger.logSecurityEvent(
        'credentials_decrypted',
        {
          serverId: server.id,
          hostname: server.hostname,
          purpose: 'ssh_operation',
        },
        'ServersService'
      );

      return {
        ...server,
        credentials,
      };
    } catch (error) {
      this.logger.error(
        `Failed to decrypt credentials for server ${id}: ${(error as Error).message}`,
        (error as Error).stack,
        'ServersService'
      );
      throw new BadRequestException('Failed to decrypt server credentials');
    }
  }

  /**
   * Update server with optional credential re-encryption
   * **Validates: Requirements 6.2** - Re-encrypt secrets when updated
   */
  async update(id: string, updateServerDto: UpdateServerDto): Promise<Server> {
    // Verify server exists
    await this.findOne(id);

    try {
      const updateData: any = {
        ...updateServerDto,
      };

      // If credentials are being updated, encrypt them
      if (updateServerDto.credentials) {
        const credentialsData = {
          [updateServerDto.authType === AuthType.KEY ? 'privateKey' : 'password']: updateServerDto.credentials,
        };
        updateData.encryptedCredentials = this.encryptionService.encrypt(JSON.stringify(credentialsData));
        delete updateData.credentials; // Remove plaintext credentials from update data
      }

      const updatedServer = await this.prisma.server.update({
        where: { id },
        data: updateData,
      });

      this.logger.logAuditEvent(
        'server_updated',
        'server',
        {
          serverId: updatedServer.id,
          hostname: updatedServer.hostname,
          fieldsUpdated: Object.keys(updateServerDto),
          credentialsUpdated: !!updateServerDto.credentials,
        },
        'ServersService'
      );

      return updatedServer;
    } catch (error) {
      this.logger.error(
        `Failed to update server ${id}: ${(error as Error).message}`,
        (error as Error).stack,
        'ServersService'
      );
      throw new BadRequestException('Failed to update server');
    }
  }

  /**
   * Delete server
   */
  async remove(id: string): Promise<void> {
    const server = await this.findOne(id);

    try {
      await this.prisma.server.delete({
        where: { id },
      });

      this.logger.logAuditEvent(
        'server_deleted',
        'server',
        {
          serverId: server.id,
          hostname: server.hostname,
        },
        'ServersService'
      );
    } catch (error) {
      this.logger.error(
        `Failed to delete server ${id}: ${(error as Error).message}`,
        (error as Error).stack,
        'ServersService'
      );
      throw new BadRequestException('Failed to delete server');
    }
  }

  /**
   * Test server connection using decrypted credentials
   * **Validates: Requirements 6.2** - Use decrypted secrets for operations
   */
  async testConnection(id: string): Promise<{ success: boolean; message: string }> {
    try {
      const server = await this.findOneWithCredentials(id);

      // Create SSH configuration for testing
      const baseConfig = {
        hostname: server.hostname,
        port: server.port,
        username: server.username,
        authType: server.authType === AuthType.KEY ? 'key' as const : 'password' as const,
        strictHostKeyChecking: true,
        connectionTimeout: 30000,
      };

      // Parse credentials and add to config
      const credentials = JSON.parse(server.credentials);
      const sshConfig = server.hostKeyFingerprint 
        ? { ...baseConfig, hostKeyFingerprint: server.hostKeyFingerprint }
        : baseConfig;

      if (sshConfig.authType === 'key') {
        (sshConfig as any).privateKey = credentials.privateKey;
      } else {
        (sshConfig as any).password = credentials.password;
      }

      // Test the connection
      const testResult = await this.sshService.testConnection(sshConfig);

      this.logger.logAuditEvent(
        'connection_test',
        'server',
        {
          serverId: server.id,
          hostname: server.hostname,
          authType: server.authType,
          success: testResult,
        },
        'ServersService'
      );

      return {
        success: testResult,
        message: testResult ? 'Connection test successful' : 'Connection test failed',
      };
    } catch (error) {
      this.logger.error(
        `Connection test failed for server ${id}: ${(error as Error).message}`,
        (error as Error).stack,
        'ServersService'
      );

      return {
        success: false,
        message: `Connection test failed: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Rotate server credentials (generate new credentials and re-encrypt)
   * **Validates: Requirements 6.2** - Secure credential rotation
   */
  async rotateCredentials(id: string, newCredentials: string): Promise<void> {
    const server = await this.findOne(id);

    try {
      // Format credentials for storage
      const credentialsData = {
        [server.authType === AuthType.KEY ? 'privateKey' : 'password']: newCredentials,
      };

      // Encrypt new credentials
      const encryptedCredentials = this.encryptionService.encrypt(JSON.stringify(credentialsData));

      await this.prisma.server.update({
        where: { id },
        data: {
          encryptedCredentials,
          updatedAt: new Date(),
        },
      });

      this.logger.logSecurityEvent(
        'credentials_rotated',
        {
          serverId: server.id,
          hostname: server.hostname,
          authType: server.authType,
        },
        'ServersService'
      );
    } catch (error) {
      this.logger.error(
        `Failed to rotate credentials for server ${id}: ${(error as Error).message}`,
        (error as Error).stack,
        'ServersService'
      );
      throw new BadRequestException('Failed to rotate server credentials');
    }
  }

  /**
   * Get server statistics (without exposing sensitive data)
   */
  async getStats(): Promise<{
    total: number;
    byAuthType: Record<AuthType, number>;
    byControlPanel: Record<string, number>;
  }> {
    const servers = await this.findAll();

    const stats = {
      total: servers.length,
      byAuthType: servers.reduce((acc, server) => {
        acc[server.authType] = (acc[server.authType] || 0) + 1;
        return acc;
      }, {} as Record<AuthType, number>),
      byControlPanel: servers.reduce((acc, server) => {
        const panel = server.controlPanel || 'none';
        acc[panel] = (acc[panel] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
    };

    return stats;
  }

  /**
   * Get server connection status without full connection test
   */
  async getConnectionStatus(id: string): Promise<{
    serverId: string;
    hostname: string;
    lastConnectionTest?: Date;
    status: 'unknown' | 'connected' | 'disconnected' | 'error';
    message: string;
  }> {
    try {
      const server = await this.findOne(id);

      // For now, we'll return basic status based on server configuration
      // In a real implementation, this could check cached connection status
      const hasCredentials = !!server.encryptedCredentials;
      const hasHostKey = !!server.hostKeyFingerprint;

      let status: 'unknown' | 'connected' | 'disconnected' | 'error' = 'unknown';
      let message = 'Connection status unknown';

      if (!hasCredentials) {
        status = 'error';
        message = 'No credentials configured';
      } else if (hasHostKey) {
        status = 'unknown';
        message = 'Ready for connection with host key verification';
      } else {
        status = 'unknown';
        message = 'Ready for connection (no host key verification)';
      }

      return {
        serverId: server.id,
        hostname: server.hostname,
        status,
        message,
      };
    } catch (error) {
      this.logger.error(
        `Failed to get connection status for server ${id}: ${(error as Error).message}`,
        (error as Error).stack,
        'ServersService'
      );

      return {
        serverId: id,
        hostname: 'unknown',
        status: 'error',
        message: `Failed to get connection status: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Validate server host key
   * **Validates: Requirements 6.4** - SSH strict host key checking
   */
  async validateHostKey(id: string): Promise<{ 
    valid: boolean; 
    fingerprint?: string; 
    algorithm?: string; 
    message: string 
  }> {
    try {
      const server = await this.findOne(id);

      if (!server.hostKeyFingerprint) {
        return {
          valid: false,
          message: 'No host key fingerprint configured for this server',
        };
      }

      // Test connection to validate host key
      const connectionResult = await this.testConnection(id);
      
      if (connectionResult.success) {
        return {
          valid: true,
          fingerprint: server.hostKeyFingerprint,
          message: 'Host key validation successful',
        };
      } else {
        return {
          valid: false,
          fingerprint: server.hostKeyFingerprint,
          message: 'Host key validation failed - connection rejected',
        };
      }
    } catch (error) {
      this.logger.error(
        `Host key validation failed for server ${id}: ${(error as Error).message}`,
        (error as Error).stack,
        'ServersService'
      );

      return {
        valid: false,
        message: `Host key validation failed: ${(error as Error).message}`,
      };
    }
  }
}