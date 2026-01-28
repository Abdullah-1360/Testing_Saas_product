import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BackupService } from './backup.service';
import { PrismaService } from '../../database/prisma.service';
import { SSHService } from '../../ssh/services/ssh.service';
import { AuditService } from '../../audit/audit.service';
import { ArtifactType } from '../interfaces/backup.interface';
import {
  BackupCreationError,
  RollbackExecutionError,
  BackupNotFoundError,
  BackupStorageError,
} from '../exceptions/backup.exceptions';
import * as fs from 'fs/promises';

// Mock fs module
jest.mock('fs/promises');
const mockFs = fs as jest.Mocked<typeof fs>;

describe('BackupService', () => {
  let service: BackupService;
  let prismaService: any;
  let sshService: any;
  let auditService: any;

  const mockIncident = {
    id: 'incident-123',
    siteId: 'site-123',
    site: {
      id: 'site-123',
      serverId: 'server-123',
    },
  };

  const mockServer = {
    id: 'server-123',
    hostname: 'test.example.com',
    port: 22,
    username: 'testuser',
  };

  const mockBackupArtifact = {
    id: 'artifact-123',
    incidentId: 'incident-123',
    artifactType: 'FILE_BACKUP',
    filePath: '/tmp/backup/test-file.txt',
    originalPath: '/var/www/html/test-file.txt',
    checksum: 'abc123def456',
    size: BigInt(1024),
    metadata: {
      backupReason: 'Pre-modification backup',
      fixAttemptNumber: 1,
    },
    createdAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BackupService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: any) => {
              const config: Record<string, any> = {
                BACKUP_DIRECTORY: '/tmp/wp-autohealer-backups',
                MAX_BACKUP_SIZE: 1024 * 1024 * 1024,
                BACKUP_COMPRESSION: true,
                BACKUP_ENCRYPTION: false,
                BACKUP_RETENTION_DAYS: 7,
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
            incident: {
              findUnique: jest.fn(),
            },
            server: {
              findUnique: jest.fn(),
            },
            backupArtifact: {
              create: jest.fn(),
              findUnique: jest.fn(),
              findMany: jest.fn(),
              delete: jest.fn(),
            },
          },
        },
        {
          provide: SSHService,
          useValue: {
            connect: jest.fn(),
            executeCommand: jest.fn(),
            downloadFile: jest.fn(),
            uploadFile: jest.fn(),
          },
        },
        {
          provide: AuditService,
          useValue: {
            logEvent: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<BackupService>(BackupService);
    prismaService = module.get(PrismaService);
    sshService = module.get(SSHService);
    auditService = module.get(AuditService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createFileBackup', () => {
    it('should create a file backup successfully', async () => {
      // Arrange
      const incidentId = 'incident-123';
      const serverId = 'server-123';
      const filePath = '/var/www/html/test-file.txt';
      const artifactType = ArtifactType.FILE_BACKUP;

      prismaService.incident.findUnique.mockResolvedValue(mockIncident as any);
      prismaService.server.findUnique.mockResolvedValue(mockServer as any);
      
      sshService.connect.mockResolvedValue({
        id: 'connection-123',
        config: { hostname: 'test.example.com', port: 22, username: 'testuser' },
        connection: {},
        isConnected: true,
        lastUsed: new Date(),
        createdAt: new Date(),
      } as any);

      sshService.executeCommand.mockResolvedValue({
        stdout: '1024 644 www-data www-data',
        stderr: '',
        exitCode: 0,
        executionTime: 100,
        timestamp: new Date(),
        command: 'stat command',
      });

      sshService.downloadFile.mockResolvedValue({
        success: true,
        bytesTransferred: 1024,
        executionTime: 200,
        timestamp: new Date(),
      });

      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.readFile.mockResolvedValue(Buffer.from('test file content'));

      prismaService.backupArtifact.create.mockResolvedValue(mockBackupArtifact as any);

      // Act
      const result = await service.createFileBackup(incidentId, serverId, filePath, artifactType);

      // Assert
      expect(result.success).toBe(true);
      expect(result.artifactId).toBe('artifact-123');
      expect(result.size).toBe(1024);
      expect(prismaService.backupArtifact.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          incidentId,
          artifactType: artifactType.toString(),
          originalPath: filePath,
          size: BigInt(1024),
        }),
      });
      expect(auditService.logEvent).toHaveBeenCalledWith({
        action: 'BACKUP_CREATED',
        resource: 'backup_artifact',
        resourceId: 'artifact-123',
        details: expect.any(Object),
      });
    });

    it('should throw BackupCreationError when incident not found', async () => {
      // Arrange
      prismaService.incident.findUnique.mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.createFileBackup('invalid-incident', 'server-123', '/test/file.txt', ArtifactType.FILE_BACKUP)
      ).rejects.toThrow(BackupCreationError);
    });

    it('should throw BackupCreationError when server not found', async () => {
      // Arrange
      prismaService.incident.findUnique.mockResolvedValue(mockIncident as any);
      prismaService.server.findUnique.mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.createFileBackup('incident-123', 'invalid-server', '/test/file.txt', ArtifactType.FILE_BACKUP)
      ).rejects.toThrow(BackupCreationError);
    });

    it('should throw BackupCreationError when file does not exist', async () => {
      // Arrange
      prismaService.incident.findUnique.mockResolvedValue(mockIncident as any);
      prismaService.server.findUnique.mockResolvedValue(mockServer as any);
      
      sshService.connect.mockResolvedValue({
        id: 'connection-123',
        config: { hostname: 'test.example.com', port: 22, username: 'testuser' },
        connection: {},
        isConnected: true,
        lastUsed: new Date(),
        createdAt: new Date(),
      } as any);

      sshService.executeCommand.mockResolvedValue({
        stdout: 'NOT_FOUND',
        stderr: '',
        exitCode: 1,
        executionTime: 100,
        timestamp: new Date(),
        command: 'stat command',
      });

      // Act & Assert
      await expect(
        service.createFileBackup('incident-123', 'server-123', '/nonexistent/file.txt', ArtifactType.FILE_BACKUP)
      ).rejects.toThrow(BackupCreationError);
    });

    it('should handle download failure gracefully', async () => {
      // Arrange
      prismaService.incident.findUnique.mockResolvedValue(mockIncident as any);
      prismaService.server.findUnique.mockResolvedValue(mockServer as any);
      
      sshService.connect.mockResolvedValue({
        id: 'connection-123',
        config: { hostname: 'test.example.com', port: 22, username: 'testuser' },
        connection: {},
        isConnected: true,
        lastUsed: new Date(),
        createdAt: new Date(),
      } as any);

      sshService.executeCommand.mockResolvedValue({
        stdout: '1024 644 www-data www-data',
        stderr: '',
        exitCode: 0,
        executionTime: 100,
        timestamp: new Date(),
        command: 'stat command',
      });

      sshService.downloadFile.mockResolvedValue({
        success: false,
        bytesTransferred: 0,
        executionTime: 200,
        timestamp: new Date(),
      });

      mockFs.mkdir.mockResolvedValue(undefined);

      // Act & Assert
      await expect(
        service.createFileBackup('incident-123', 'server-123', '/test/file.txt', ArtifactType.FILE_BACKUP)
      ).rejects.toThrow(BackupCreationError);
    });
  });

  describe('createDirectoryBackup', () => {
    it('should create a directory backup successfully', async () => {
      // Arrange
      const incidentId = 'incident-123';
      const serverId = 'server-123';
      const directoryPath = '/var/www/html/wp-content/plugins/test-plugin';
      const artifactType = ArtifactType.PLUGIN_BACKUP;

      prismaService.incident.findUnique.mockResolvedValue(mockIncident as any);
      prismaService.server.findUnique.mockResolvedValue(mockServer as any);
      
      sshService.connect.mockResolvedValue({
        id: 'connection-123',
        config: { hostname: 'test.example.com', port: 22, username: 'testuser' },
        connection: {},
        isConnected: true,
        lastUsed: new Date(),
        createdAt: new Date(),
      } as any);

      // Mock directory size check
      sshService.executeCommand
        .mockResolvedValueOnce({
          stdout: '2048000\t/var/www/html/wp-content/plugins/test-plugin',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
          command: 'du command',
        })
        // Mock tar command
        .mockResolvedValueOnce({
          stdout: '',
          stderr: '',
          exitCode: 0,
          executionTime: 500,
          timestamp: new Date(),
          command: 'tar command',
        })
        // Mock cleanup command
        .mockResolvedValueOnce({
          stdout: '',
          stderr: '',
          exitCode: 0,
          executionTime: 50,
          timestamp: new Date(),
          command: 'rm command',
        });

      sshService.downloadFile.mockResolvedValue({
        success: true,
        bytesTransferred: 1024000,
        executionTime: 1000,
        timestamp: new Date(),
      });

      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.stat.mockResolvedValue({ size: 1024000 } as any);
      mockFs.readFile.mockResolvedValue(Buffer.from('compressed archive content'));

      prismaService.backupArtifact.create.mockResolvedValue({
        ...mockBackupArtifact,
        artifactType: 'PLUGIN_BACKUP',
        originalPath: directoryPath,
      } as any);

      // Act
      const result = await service.createDirectoryBackup(incidentId, serverId, directoryPath, artifactType);

      // Assert
      expect(result.success).toBe(true);
      expect(result.size).toBe(1024000);
      expect(sshService.executeCommand).toHaveBeenCalledWith(
        'connection-123',
        expect.stringContaining('tar -czf')
      );
      expect(auditService.logEvent).toHaveBeenCalledWith({
        action: 'DIRECTORY_BACKUP_CREATED',
        resource: 'backup_artifact',
        resourceId: expect.any(String),
        details: expect.objectContaining({
          originalSize: 2048000,
          compressedSize: 1024000,
        }),
      });
    });

    it('should throw BackupCreationError when directory does not exist', async () => {
      // Arrange
      prismaService.incident.findUnique.mockResolvedValue(mockIncident as any);
      prismaService.server.findUnique.mockResolvedValue(mockServer as any);
      
      sshService.connect.mockResolvedValue({
        id: 'connection-123',
        config: { hostname: 'test.example.com', port: 22, username: 'testuser' },
        connection: {},
        isConnected: true,
        lastUsed: new Date(),
        createdAt: new Date(),
      } as any);

      sshService.executeCommand.mockResolvedValue({
        stdout: 'NOT_FOUND',
        stderr: '',
        exitCode: 1,
        executionTime: 100,
        timestamp: new Date(),
        command: 'du command',
      });

      // Act & Assert
      await expect(
        service.createDirectoryBackup('incident-123', 'server-123', '/nonexistent/directory', ArtifactType.PLUGIN_BACKUP)
      ).rejects.toThrow(BackupCreationError);
    });

    it('should handle tar command failure', async () => {
      // Arrange
      prismaService.incident.findUnique.mockResolvedValue(mockIncident as any);
      prismaService.server.findUnique.mockResolvedValue(mockServer as any);
      
      sshService.connect.mockResolvedValue({
        id: 'connection-123',
        config: { hostname: 'test.example.com', port: 22, username: 'testuser' },
        connection: {},
        isConnected: true,
        lastUsed: new Date(),
        createdAt: new Date(),
      } as any);

      sshService.executeCommand
        .mockResolvedValueOnce({
          stdout: '2048000\t/var/www/html/wp-content/plugins/test-plugin',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
          command: 'du command',
        })
        .mockResolvedValueOnce({
          stdout: '',
          stderr: 'tar: Cannot create archive',
          exitCode: 1,
          executionTime: 500,
          timestamp: new Date(),
          command: 'tar command',
        });

      mockFs.mkdir.mockResolvedValue(undefined);

      // Act & Assert
      await expect(
        service.createDirectoryBackup('incident-123', 'server-123', '/test/directory', ArtifactType.PLUGIN_BACKUP)
      ).rejects.toThrow(BackupCreationError);
    });
  });

  describe('validateBackupArtifact', () => {
    it('should validate backup artifact successfully', async () => {
      // Arrange
      prismaService.backupArtifact.findUnique.mockResolvedValue(mockBackupArtifact as any);
      mockFs.stat.mockResolvedValue({ size: 1024 } as any);
      mockFs.readFile.mockResolvedValue(Buffer.from('test file content'));

      // Act
      const result = await service.validateBackupArtifact('artifact-123');

      // Assert
      expect(result.isValid).toBe(true);
      expect(result.fileExists).toBe(true);
      expect(result.sizeMatch).toBe(true);
      expect(result.checksumMatch).toBe(true);
      expect(auditService.logEvent).toHaveBeenCalledWith({
        action: 'BACKUP_VALIDATED',
        resource: 'backup_artifact',
        resourceId: 'artifact-123',
        details: expect.objectContaining({
          isValid: true,
        }),
      });
    });

    it('should throw BackupNotFoundError when artifact not found', async () => {
      // Arrange
      prismaService.backupArtifact.findUnique.mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.validateBackupArtifact('nonexistent-artifact')
      ).rejects.toThrow(BackupNotFoundError);
    });

    it('should detect file corruption', async () => {
      // Arrange
      prismaService.backupArtifact.findUnique.mockResolvedValue(mockBackupArtifact as any);
      mockFs.stat.mockResolvedValue({ size: 1024 } as any);
      mockFs.readFile.mockResolvedValue(Buffer.from('corrupted content'));

      // Act
      const result = await service.validateBackupArtifact('artifact-123');

      // Assert
      expect(result.isValid).toBe(false);
      expect(result.fileExists).toBe(true);
      expect(result.sizeMatch).toBe(true);
      expect(result.checksumMatch).toBe(false);
      expect(result.error).toContain('Checksum mismatch');
    });

    it('should detect missing file', async () => {
      // Arrange
      prismaService.backupArtifact.findUnique.mockResolvedValue(mockBackupArtifact as any);
      mockFs.stat.mockRejectedValue(new Error('File not found'));

      // Act
      const result = await service.validateBackupArtifact('artifact-123');

      // Assert
      expect(result.isValid).toBe(false);
      expect(result.fileExists).toBe(false);
      expect(result.error).toContain('File does not exist');
    });
  });

  describe('executeRollback', () => {
    it('should execute rollback successfully', async () => {
      // Arrange
      const incidentId = 'incident-123';
      
      prismaService.backupArtifact.findMany.mockResolvedValue([mockBackupArtifact] as any);
      prismaService.incident.findUnique.mockResolvedValue(mockIncident as any);
      
      sshService.connect.mockResolvedValue({
        id: 'connection-123',
        config: { hostname: 'test.example.com', port: 22, username: 'testuser' },
        connection: {},
        isConnected: true,
        lastUsed: new Date(),
        createdAt: new Date(),
      } as any);

      // Mock validation
      prismaService.backupArtifact.findUnique.mockResolvedValue(mockBackupArtifact as any);
      mockFs.stat.mockResolvedValue({ size: 1024 } as any);
      mockFs.readFile.mockResolvedValue(Buffer.from('test file content'));

      sshService.uploadFile.mockResolvedValue({
        success: true,
        bytesTransferred: 1024,
        executionTime: 200,
        timestamp: new Date(),
      });

      sshService.executeCommand.mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
        executionTime: 100,
        timestamp: new Date(),
        command: 'mv command',
      });

      // Act
      const result = await service.executeRollback(incidentId);

      // Assert
      expect(result.success).toBe(true);
      expect(result.restoredFiles).toContain('/var/www/html/test-file.txt');
      expect(result.failedFiles).toHaveLength(0);
      expect(auditService.logEvent).toHaveBeenCalledWith({
        action: 'ROLLBACK_EXECUTED',
        resource: 'incident',
        resourceId: incidentId,
        details: expect.objectContaining({
          success: true,
          restoredFiles: ['/var/www/html/test-file.txt'],
        }),
      });
    });

    it('should throw RollbackExecutionError when no artifacts found', async () => {
      // Arrange
      prismaService.backupArtifact.findMany.mockResolvedValue([]);

      // Act & Assert
      await expect(
        service.executeRollback('incident-123')
      ).rejects.toThrow(RollbackExecutionError);
    });

    it('should throw RollbackExecutionError when incident not found', async () => {
      // Arrange
      prismaService.backupArtifact.findMany.mockResolvedValue([mockBackupArtifact] as any);
      prismaService.incident.findUnique.mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.executeRollback('nonexistent-incident')
      ).rejects.toThrow(RollbackExecutionError);
    });

    it('should handle partial rollback failure', async () => {
      // Arrange
      const artifacts = [
        mockBackupArtifact,
        {
          ...mockBackupArtifact,
          id: 'artifact-456',
          originalPath: '/var/www/html/another-file.txt',
        },
      ];

      prismaService.backupArtifact.findMany.mockResolvedValue(artifacts as any);
      prismaService.incident.findUnique.mockResolvedValue(mockIncident as any);
      
      sshService.connect.mockResolvedValue({
        id: 'connection-123',
        config: { hostname: 'test.example.com', port: 22, username: 'testuser' },
        connection: {},
        isConnected: true,
        lastUsed: new Date(),
        createdAt: new Date(),
      } as any);

      // Mock validation - first succeeds, second fails
      prismaService.backupArtifact.findUnique
        .mockResolvedValueOnce(mockBackupArtifact as any)
        .mockResolvedValueOnce(artifacts[1] as any);
      
      mockFs.stat
        .mockResolvedValueOnce({ size: 1024 } as any)
        .mockRejectedValueOnce(new Error('File not found'));
      
      mockFs.readFile.mockResolvedValueOnce(Buffer.from('test file content'));

      sshService.uploadFile.mockResolvedValue({
        success: true,
        bytesTransferred: 1024,
        executionTime: 200,
        timestamp: new Date(),
      });

      sshService.executeCommand.mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
        executionTime: 100,
        timestamp: new Date(),
        command: 'mv command',
      });

      // Act
      const result = await service.executeRollback('incident-123');

      // Assert
      expect(result.success).toBe(false);
      expect(result.restoredFiles).toContain('/var/www/html/test-file.txt');
      expect(result.failedFiles).toContain('/var/www/html/another-file.txt');
      expect(result.error).toContain('Failed to restore 1 files');
    });
  });

  describe('getBackupArtifacts', () => {
    it('should get backup artifacts successfully', async () => {
      // Arrange
      const artifacts = [mockBackupArtifact];
      prismaService.backupArtifact.findMany.mockResolvedValue(artifacts as any);

      // Act
      const result = await service.getBackupArtifacts('incident-123');

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe('artifact-123');
      expect(result[0]!.incidentId).toBe('incident-123');
      expect(result[0]!.size).toBe(1024);
    });

    it('should handle database error', async () => {
      // Arrange
      prismaService.backupArtifact.findMany.mockRejectedValue(new Error('Database error'));

      // Act & Assert
      await expect(
        service.getBackupArtifacts('incident-123')
      ).rejects.toThrow(BackupStorageError);
    });
  });

  describe('deleteBackupArtifact', () => {
    it('should delete backup artifact successfully', async () => {
      // Arrange
      prismaService.backupArtifact.findUnique.mockResolvedValue(mockBackupArtifact as any);
      mockFs.unlink.mockResolvedValue(undefined);
      prismaService.backupArtifact.delete.mockResolvedValue(mockBackupArtifact as any);

      // Act
      const result = await service.deleteBackupArtifact('artifact-123');

      // Assert
      expect(result).toBe(true);
      expect(mockFs.unlink).toHaveBeenCalledWith('/tmp/backup/test-file.txt');
      expect(prismaService.backupArtifact.delete).toHaveBeenCalledWith({
        where: { id: 'artifact-123' },
      });
      expect(auditService.logEvent).toHaveBeenCalledWith({
        action: 'BACKUP_DELETED',
        resource: 'backup_artifact',
        resourceId: 'artifact-123',
        details: expect.any(Object),
      });
    });

    it('should throw BackupNotFoundError when artifact not found', async () => {
      // Arrange
      prismaService.backupArtifact.findUnique.mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.deleteBackupArtifact('nonexistent-artifact')
      ).rejects.toThrow(BackupNotFoundError);
    });

    it('should continue with database deletion even if file deletion fails', async () => {
      // Arrange
      prismaService.backupArtifact.findUnique.mockResolvedValue(mockBackupArtifact as any);
      mockFs.unlink.mockRejectedValue(new Error('File not found'));
      prismaService.backupArtifact.delete.mockResolvedValue(mockBackupArtifact as any);

      // Act
      const result = await service.deleteBackupArtifact('artifact-123');

      // Assert
      expect(result).toBe(true);
      expect(prismaService.backupArtifact.delete).toHaveBeenCalled();
    });
  });

  describe('calculateFileChecksum', () => {
    it('should calculate file checksum correctly', async () => {
      // Arrange
      const testContent = 'test file content';
      mockFs.readFile.mockResolvedValue(Buffer.from(testContent));

      // Act
      const checksum = await service.calculateFileChecksum('/test/file.txt');

      // Assert
      expect(checksum).toBeDefined();
      expect(typeof checksum).toBe('string');
      expect(checksum.length).toBe(64); // SHA-256 hex string length
    });

    it('should throw BackupStorageError when file read fails', async () => {
      // Arrange
      mockFs.readFile.mockRejectedValue(new Error('File not found'));

      // Act & Assert
      await expect(
        service.calculateFileChecksum('/nonexistent/file.txt')
      ).rejects.toThrow(BackupStorageError);
    });
  });
});