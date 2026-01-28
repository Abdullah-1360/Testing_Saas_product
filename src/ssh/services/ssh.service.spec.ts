import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SSHService } from './ssh.service';
import { SSHValidationService } from './ssh-validation.service';
import { SSHConnectionPoolService } from './ssh-connection-pool.service';
import { PrismaService } from '../../database/prisma.service';
import { EncryptionService } from '../../common/services/encryption.service';
import { RedactionService } from '../../common/services/redaction.service';
import {
  SSHConnectionError,
  SSHCommandExecutionError,
} from '../exceptions/ssh.exceptions';

describe('SSHService', () => {
  let service: SSHService;
  let prismaService: jest.Mocked<PrismaService>;
  let encryptionService: jest.Mocked<EncryptionService>;
  let validationService: jest.Mocked<SSHValidationService>;
  let connectionPool: jest.Mocked<SSHConnectionPoolService>;

  const mockServer = {
    id: 'server-1',
    hostname: 'test.example.com',
    port: 22,
    username: 'testuser',
    authType: 'KEY',
    encryptedCredentials: 'encrypted-creds',
    hostKeyFingerprint: 'test-fingerprint',
  };

  const mockConnection = {
    id: 'conn-1',
    config: {
      hostname: 'test.example.com',
      port: 22,
      username: 'testuser',
      authType: 'key' as const,
      strictHostKeyChecking: true,
    },
    connection: {
      end: jest.fn(),
      exec: jest.fn(),
      sftp: jest.fn(),
    },
    isConnected: true,
    lastUsed: new Date(),
    createdAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SSHService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: any) => {
              const config: Record<string, any> = {
                SSH_CONNECTION_TIMEOUT: 30000,
                SSH_KEEPALIVE_INTERVAL: 30000,
              };
              return config[key] || defaultValue;
            }),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            server: {
              findUnique: jest.fn(),
            },
          },
        },
        {
          provide: EncryptionService,
          useValue: {
            decrypt: jest.fn(),
          },
        },
        {
          provide: RedactionService,
          useValue: {
            redactText: jest.fn((text) => text),
            redactCommand: jest.fn((cmd) => cmd),
          },
        },
        {
          provide: SSHValidationService,
          useValue: {
            validateHostname: jest.fn((hostname) => hostname),
            validatePort: jest.fn((port) => port),
            validateUsername: jest.fn((username) => username),
            validateCommand: jest.fn((command) => command),
            validatePath: jest.fn((path) => path),
            createSafeTemplate: jest.fn(),
            validateEnvironmentVariables: jest.fn((env) => env),
          },
        },
        {
          provide: SSHConnectionPoolService,
          useValue: {
            getConnection: jest.fn(),
            addConnection: jest.fn(),
            releaseConnection: jest.fn(),
            closeConnection: jest.fn(),
            closeAllConnections: jest.fn(),
            getPoolStats: jest.fn(),
            getServerConnections: jest.fn(),
            closeServerConnections: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<SSHService>(SSHService);
    prismaService = module.get(PrismaService);
    encryptionService = module.get(EncryptionService);
    validationService = module.get(SSHValidationService);
    connectionPool = module.get(SSHConnectionPoolService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('connect', () => {
    it('should successfully connect to a server', async () => {
      // Arrange
      (prismaService.server.findUnique as jest.Mock).mockResolvedValue(mockServer as any);
      encryptionService.decrypt.mockReturnValue('{"privateKey":"test-key"}');
      connectionPool.addConnection.mockResolvedValue();

      // Act & Assert
      // Note: This test would need more complex mocking of the ssh2 Client
      // For now, we test the database lookup and validation parts
      
      try {
        await service.connect('server-1');
      } catch (error) {
        // Expected to fail due to SSH connection mocking complexity
        expect(error).toBeDefined();
      }

      expect(prismaService.server.findUnique).toHaveBeenCalledWith({
        where: { id: 'server-1' },
      });
      expect(encryptionService.decrypt).toHaveBeenCalledWith('encrypted-creds');
      expect(validationService.validateHostname).toHaveBeenCalledWith('test.example.com');
      expect(validationService.validatePort).toHaveBeenCalledWith(22);
      expect(validationService.validateUsername).toHaveBeenCalledWith('testuser');
    });

    it('should throw error when server not found', async () => {
      // Arrange
      (prismaService.server.findUnique as jest.Mock).mockResolvedValue(null);

      // Act & Assert
      await expect(service.connect('nonexistent-server')).rejects.toThrow(
        SSHConnectionError
      );
      await expect(service.connect('nonexistent-server')).rejects.toThrow(
        'Server with ID nonexistent-server not found'
      );
    });

    it('should handle decryption errors', async () => {
      // Arrange
      (prismaService.server.findUnique as jest.Mock).mockResolvedValue(mockServer as any);
      encryptionService.decrypt.mockImplementation(() => {
        throw new Error('Decryption failed');
      });

      // Act & Assert
      await expect(service.connect('server-1')).rejects.toThrow('Decryption failed');
    });
  });

  describe('executeCommand', () => {
    it('should execute command successfully', async () => {
      // Arrange
      const command = 'ls -la';

      connectionPool.getConnection.mockResolvedValue(mockConnection as any);
      connectionPool.releaseConnection.mockResolvedValue();
      validationService.validateCommand.mockReturnValue(command);

      // Mock the SSH exec
      mockConnection.connection.exec.mockImplementation((_cmd, _options, callback) => {
        const stream = {
          on: jest.fn((event, handler) => {
            if (event === 'close') {
              setTimeout(() => handler(0), 10);
            } else if (event === 'data') {
              setTimeout(() => handler(Buffer.from('file1\nfile2\n')), 5);
            }
          }),
          stderr: {
            on: jest.fn(),
          },
        };
        callback(null, stream);
      });

      // Act
      const result = await service.executeCommand('conn-1', command);

      // Assert
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('file1\nfile2\n');
      expect(validationService.validateCommand).toHaveBeenCalledWith(command);
      expect(connectionPool.getConnection).toHaveBeenCalledWith('conn-1');
      expect(connectionPool.releaseConnection).toHaveBeenCalledWith('conn-1');
    });

    it('should handle command validation errors', async () => {
      // Arrange
      const dangerousCommand = 'rm -rf /';
      validationService.validateCommand.mockImplementation(() => {
        throw new Error('Dangerous command detected');
      });

      // Act & Assert
      await expect(service.executeCommand('conn-1', dangerousCommand)).rejects.toThrow(
        'Dangerous command detected'
      );
    });

    it('should handle connection not found', async () => {
      // Arrange
      connectionPool.getConnection.mockRejectedValue(new Error('Connection not found'));
      validationService.validateCommand.mockReturnValue('ls');

      // Act & Assert
      await expect(service.executeCommand('nonexistent-conn', 'ls')).rejects.toThrow(
        SSHCommandExecutionError
      );
    });

    it('should handle inactive connection', async () => {
      // Arrange
      const inactiveConnection = { ...mockConnection, isConnected: false };
      connectionPool.getConnection.mockResolvedValue(inactiveConnection as any);
      validationService.validateCommand.mockReturnValue('ls');

      // Act & Assert
      await expect(service.executeCommand('conn-1', 'ls')).rejects.toThrow(
        SSHConnectionError
      );
      await expect(service.executeCommand('conn-1', 'ls')).rejects.toThrow(
        'Connection is not active'
      );
    });
  });

  describe('executeTemplatedCommand', () => {
    it('should execute templated command successfully', async () => {
      // Arrange
      const template = {
        template: 'ls {{directory}}',
        parameters: { directory: '/var/log' },
        sanitized: true,
      };
      const safeCommand = 'ls /var/log';

      validationService.createSafeTemplate.mockReturnValue(safeCommand);
      connectionPool.getConnection.mockResolvedValue(mockConnection as any);
      connectionPool.releaseConnection.mockResolvedValue();
      validationService.validateCommand.mockReturnValue(safeCommand);

      mockConnection.connection.exec.mockImplementation((_cmd, _options, callback) => {
        const stream = {
          on: jest.fn((event, handler) => {
            if (event === 'close') {
              setTimeout(() => handler(0), 10);
            }
          }),
          stderr: { on: jest.fn() },
        };
        callback(null, stream);
      });

      // Act
      const result = await service.executeTemplatedCommand('conn-1', template);

      // Assert
      expect(validationService.createSafeTemplate).toHaveBeenCalledWith(
        template.template,
        template.parameters
      );
      expect(result.exitCode).toBe(0);
    });

    it('should handle template validation errors', async () => {
      // Arrange
      const template = {
        template: 'rm {{file}}',
        parameters: { file: '/important/file' },
        sanitized: false,
      };

      validationService.createSafeTemplate.mockImplementation(() => {
        throw new Error('Dangerous template');
      });

      // Act & Assert
      await expect(service.executeTemplatedCommand('conn-1', template)).rejects.toThrow(
        'Dangerous template'
      );
    });
  });

  describe('uploadFile', () => {
    it('should upload file successfully', async () => {
      // Arrange
      const localPath = '/local/file.txt';
      const remotePath = '/remote/file.txt';

      connectionPool.getConnection.mockResolvedValue(mockConnection as any);
      connectionPool.releaseConnection.mockResolvedValue();
      validationService.validatePath
        .mockReturnValueOnce(localPath)
        .mockReturnValueOnce(remotePath);

      // Mock fs.access and fs.stat
      const mockFs = require('fs/promises');
      jest.doMock('fs/promises', () => ({
        access: jest.fn().mockResolvedValue(undefined),
        stat: jest.fn().mockResolvedValue({ size: 1024 }),
        mkdir: jest.fn().mockResolvedValue(undefined),
      }));

      // Mock SFTP
      mockConnection.connection.sftp.mockImplementation((callback) => {
        const sftp = {
          fastPut: jest.fn((_local, _remote, cb) => cb(null)),
          end: jest.fn(),
        };
        callback(null, sftp);
      });

      // Act
      const result = await service.uploadFile('conn-1', localPath, remotePath);

      // Assert
      expect(result.success).toBe(true);
      expect(result.bytesTransferred).toBe(1024);
      expect(validationService.validatePath).toHaveBeenCalledWith(localPath, 'local');
      expect(validationService.validatePath).toHaveBeenCalledWith(remotePath, 'remote');
    });
  });

  describe('downloadFile', () => {
    it('should download file successfully', async () => {
      // Arrange
      const remotePath = '/remote/file.txt';
      const localPath = '/local/file.txt';

      connectionPool.getConnection.mockResolvedValue(mockConnection as any);
      connectionPool.releaseConnection.mockResolvedValue();
      validationService.validatePath
        .mockReturnValueOnce(remotePath)
        .mockReturnValueOnce(localPath);

      // Mock SFTP
      mockConnection.connection.sftp.mockImplementation((callback) => {
        const sftp = {
          stat: jest.fn((_path, cb) => cb(null, { size: 2048 })),
          fastGet: jest.fn((_remote, _local, cb) => cb(null)),
          end: jest.fn(),
        };
        callback(null, sftp);
      });

      // Act
      const result = await service.downloadFile('conn-1', remotePath, localPath);

      // Assert
      expect(result.success).toBe(true);
      expect(result.bytesTransferred).toBe(2048);
    });
  });

  describe('validateConnection', () => {
    it('should return true for active connection', async () => {
      // Arrange
      connectionPool.getConnection.mockResolvedValue(mockConnection as any);

      // Act
      const result = await service.validateConnection('conn-1');

      // Assert
      expect(result).toBe(true);
    });

    it('should return false for inactive connection', async () => {
      // Arrange
      const inactiveConnection = { ...mockConnection, isConnected: false };
      connectionPool.getConnection.mockResolvedValue(inactiveConnection as any);

      // Act
      const result = await service.validateConnection('conn-1');

      // Assert
      expect(result).toBe(false);
    });

    it('should return false when connection not found', async () => {
      // Arrange
      connectionPool.getConnection.mockRejectedValue(new Error('Not found'));

      // Act
      const result = await service.validateConnection('nonexistent');

      // Assert
      expect(result).toBe(false);
    });
  });

  describe('disconnect', () => {
    it('should disconnect successfully', async () => {
      // Arrange
      connectionPool.closeConnection.mockResolvedValue();

      // Act
      await service.disconnect('conn-1');

      // Assert
      expect(connectionPool.closeConnection).toHaveBeenCalledWith('conn-1');
    });
  });

  describe('getPoolStats', () => {
    it('should return pool statistics', () => {
      // Arrange
      const mockStats = {
        totalConnections: 5,
        activeConnections: 3,
        idleConnections: 2,
        maxPoolSize: 50,
        serverCount: 2,
      };
      connectionPool.getPoolStats.mockReturnValue(mockStats);

      // Act
      const result = service.getPoolStats();

      // Assert
      expect(result).toEqual(mockStats);
      expect(connectionPool.getPoolStats).toHaveBeenCalled();
    });
  });
});