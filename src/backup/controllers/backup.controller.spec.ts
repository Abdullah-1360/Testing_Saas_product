import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus } from '@nestjs/common';
import { BackupController } from './backup.controller';
import { BackupService } from '../services/backup.service';
import { ArtifactType } from '../interfaces/backup.interface';
import {
  CreateBackupDto,
  CreateDirectoryBackupDto,
  ExecuteRollbackDto,
  ValidateBackupDto,
} from '../dto/backup.dto';
import {
  BackupCreationError,
  BackupValidationError,
  RollbackExecutionError,
  BackupNotFoundError,
  BackupStorageError,
} from '../exceptions/backup.exceptions';

describe('BackupController', () => {
  let controller: BackupController;
  let backupService: jest.Mocked<BackupService>;

  const mockBackupOperationResult = {
    success: true,
    artifactId: 'artifact-123',
    filePath: '/tmp/backup/test-file.backup',
    checksum: 'abc123def456',
    size: 1024,
    executionTime: 500,
    timestamp: new Date(),
  };

  const mockBackupArtifact = {
    id: 'artifact-123',
    incidentId: 'incident-123',
    artifactType: ArtifactType.FILE_BACKUP,
    filePath: '/tmp/backup/test-file.backup',
    originalPath: '/var/www/html/test-file.txt',
    checksum: 'abc123def456',
    size: 1024,
    metadata: {
      backupReason: 'Pre-modification backup',
      fixAttemptNumber: 1,
    },
    createdAt: new Date(),
  };

  const mockRollbackResult = {
    success: true,
    restoredFiles: ['/var/www/html/test-file.txt'],
    failedFiles: [],
    executionTime: 1000,
    timestamp: new Date(),
  };

  const mockValidationResult = {
    isValid: true,
    checksumMatch: true,
    fileExists: true,
    sizeMatch: true,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BackupController],
      providers: [
        {
          provide: BackupService,
          useValue: {
            createFileBackup: jest.fn(),
            createDirectoryBackup: jest.fn(),
            validateBackupArtifact: jest.fn(),
            executeRollback: jest.fn(),
            getBackupArtifacts: jest.fn(),
            deleteBackupArtifact: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<BackupController>(BackupController);
    backupService = module.get(BackupService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createFileBackup', () => {
    it('should create a file backup successfully', async () => {
      // Arrange
      const createBackupDto: CreateBackupDto = {
        incidentId: 'incident-123',
        serverId: 'server-123',
        filePath: '/var/www/html/test-file.txt',
        artifactType: ArtifactType.FILE_BACKUP,
        metadata: { backupReason: 'Test backup' },
      };

      backupService.createFileBackup.mockResolvedValue(mockBackupOperationResult);

      // Act
      const result = await controller.createFileBackup(createBackupDto);

      // Assert
      expect(result).toEqual(mockBackupOperationResult);
      expect(backupService.createFileBackup).toHaveBeenCalledWith(
        createBackupDto.incidentId,
        createBackupDto.serverId,
        createBackupDto.filePath,
        createBackupDto.artifactType,
        createBackupDto.metadata
      );
    });

    it('should handle BackupCreationError', async () => {
      // Arrange
      const createBackupDto: CreateBackupDto = {
        incidentId: 'incident-123',
        serverId: 'server-123',
        filePath: '/nonexistent/file.txt',
        artifactType: ArtifactType.FILE_BACKUP,
      };

      const error = new BackupCreationError(
        'File does not exist',
        '/nonexistent/file.txt',
        'incident-123'
      );

      backupService.createFileBackup.mockRejectedValue(error);

      // Act & Assert
      await expect(controller.createFileBackup(createBackupDto)).rejects.toThrow(HttpException);
      
      try {
        await controller.createFileBackup(createBackupDto);
      } catch (httpError: any) {
        expect(httpError.getStatus()).toBe(HttpStatus.BAD_REQUEST);
        expect(httpError.getResponse()).toMatchObject({
          statusCode: HttpStatus.BAD_REQUEST,
          message: 'File does not exist',
          code: 'BACKUP_CREATION_ERROR',
          details: {
            filePath: '/nonexistent/file.txt',
            incidentId: 'incident-123',
          },
        });
      }
    });

    it('should handle generic errors', async () => {
      // Arrange
      const createBackupDto: CreateBackupDto = {
        incidentId: 'incident-123',
        serverId: 'server-123',
        filePath: '/var/www/html/test-file.txt',
        artifactType: ArtifactType.FILE_BACKUP,
      };

      backupService.createFileBackup.mockRejectedValue(new Error('Generic error'));

      // Act & Assert
      await expect(controller.createFileBackup(createBackupDto)).rejects.toThrow(HttpException);
      
      try {
        await controller.createFileBackup(createBackupDto);
      } catch (httpError: any) {
        expect(httpError.getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
        expect(httpError.getResponse()).toMatchObject({
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Generic error',
          code: 'INTERNAL_ERROR',
        });
      }
    });
  });

  describe('createDirectoryBackup', () => {
    it('should create a directory backup successfully', async () => {
      // Arrange
      const createDirectoryBackupDto: CreateDirectoryBackupDto = {
        incidentId: 'incident-123',
        serverId: 'server-123',
        directoryPath: '/var/www/html/wp-content/plugins/test-plugin',
        artifactType: ArtifactType.PLUGIN_BACKUP,
        metadata: { backupReason: 'Plugin backup before update' },
      };

      const directoryBackupResult = {
        ...mockBackupOperationResult,
        size: 2048000,
      };

      backupService.createDirectoryBackup.mockResolvedValue(directoryBackupResult);

      // Act
      const result = await controller.createDirectoryBackup(createDirectoryBackupDto);

      // Assert
      expect(result).toEqual(directoryBackupResult);
      expect(backupService.createDirectoryBackup).toHaveBeenCalledWith(
        createDirectoryBackupDto.incidentId,
        createDirectoryBackupDto.serverId,
        createDirectoryBackupDto.directoryPath,
        createDirectoryBackupDto.artifactType,
        createDirectoryBackupDto.metadata
      );
    });

    it('should handle directory backup errors', async () => {
      // Arrange
      const createDirectoryBackupDto: CreateDirectoryBackupDto = {
        incidentId: 'incident-123',
        serverId: 'server-123',
        directoryPath: '/nonexistent/directory',
        artifactType: ArtifactType.DIRECTORY_BACKUP,
      };

      const error = new BackupCreationError(
        'Directory does not exist',
        '/nonexistent/directory',
        'incident-123'
      );

      backupService.createDirectoryBackup.mockRejectedValue(error);

      // Act & Assert
      await expect(controller.createDirectoryBackup(createDirectoryBackupDto)).rejects.toThrow(HttpException);
    });
  });

  describe('validateBackup', () => {
    it('should validate backup successfully', async () => {
      // Arrange
      const validateBackupDto: ValidateBackupDto = {
        artifactId: 'artifact-123',
      };

      backupService.validateBackupArtifact.mockResolvedValue(mockValidationResult);

      // Act
      const result = await controller.validateBackup(validateBackupDto);

      // Assert
      expect(result).toEqual(mockValidationResult);
      expect(backupService.validateBackupArtifact).toHaveBeenCalledWith('artifact-123');
    });

    it('should handle validation errors', async () => {
      // Arrange
      const validateBackupDto: ValidateBackupDto = {
        artifactId: 'invalid-artifact',
      };

      const error = new BackupValidationError(
        'Backup validation failed',
        'invalid-artifact'
      );

      backupService.validateBackupArtifact.mockRejectedValue(error);

      // Act & Assert
      await expect(controller.validateBackup(validateBackupDto)).rejects.toThrow(HttpException);
      
      try {
        await controller.validateBackup(validateBackupDto);
      } catch (httpError: any) {
        expect(httpError.getStatus()).toBe(HttpStatus.BAD_REQUEST);
        expect(httpError.getResponse()).toMatchObject({
          statusCode: HttpStatus.BAD_REQUEST,
          message: 'Backup validation failed',
          code: 'BACKUP_VALIDATION_ERROR',
          details: {
            artifactId: 'invalid-artifact',
          },
        });
      }
    });

    it('should handle BackupNotFoundError', async () => {
      // Arrange
      const validateBackupDto: ValidateBackupDto = {
        artifactId: 'nonexistent-artifact',
      };

      const error = new BackupNotFoundError('nonexistent-artifact');

      backupService.validateBackupArtifact.mockRejectedValue(error);

      // Act & Assert
      await expect(controller.validateBackup(validateBackupDto)).rejects.toThrow(HttpException);
      
      try {
        await controller.validateBackup(validateBackupDto);
      } catch (httpError: any) {
        expect(httpError.getStatus()).toBe(HttpStatus.NOT_FOUND);
        expect(httpError.getResponse()).toMatchObject({
          statusCode: HttpStatus.NOT_FOUND,
          code: 'BACKUP_NOT_FOUND',
          details: {
            artifactId: 'nonexistent-artifact',
          },
        });
      }
    });
  });

  describe('executeRollback', () => {
    it('should execute rollback successfully', async () => {
      // Arrange
      const executeRollbackDto: ExecuteRollbackDto = {
        incidentId: 'incident-123',
        artifactIds: ['artifact-123', 'artifact-456'],
      };

      backupService.executeRollback.mockResolvedValue(mockRollbackResult);

      // Act
      const result = await controller.executeRollback(executeRollbackDto);

      // Assert
      expect(result).toEqual(mockRollbackResult);
      expect(backupService.executeRollback).toHaveBeenCalledWith(
        executeRollbackDto.incidentId,
        executeRollbackDto.artifactIds
      );
    });

    it('should handle rollback errors', async () => {
      // Arrange
      const executeRollbackDto: ExecuteRollbackDto = {
        incidentId: 'incident-123',
      };

      const error = new RollbackExecutionError(
        'Rollback failed',
        'incident-123',
        ['/var/www/html/failed-file.txt']
      );

      backupService.executeRollback.mockRejectedValue(error);

      // Act & Assert
      await expect(controller.executeRollback(executeRollbackDto)).rejects.toThrow(HttpException);
      
      try {
        await controller.executeRollback(executeRollbackDto);
      } catch (httpError: any) {
        expect(httpError.getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
        expect(httpError.getResponse()).toMatchObject({
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Rollback failed',
          code: 'ROLLBACK_EXECUTION_ERROR',
          details: {
            incidentId: 'incident-123',
            failedFiles: ['/var/www/html/failed-file.txt'],
          },
        });
      }
    });
  });

  describe('getBackupArtifacts', () => {
    it('should get backup artifacts successfully', async () => {
      // Arrange
      const incidentId = 'incident-123';
      const artifacts = [mockBackupArtifact];

      backupService.getBackupArtifacts.mockResolvedValue(artifacts);

      // Act
      const result = await controller.getBackupArtifacts(incidentId);

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'artifact-123',
        incidentId: 'incident-123',
        artifactType: ArtifactType.FILE_BACKUP,
        originalPath: '/var/www/html/test-file.txt',
      });
      expect(backupService.getBackupArtifacts).toHaveBeenCalledWith(incidentId);
    });

    it('should handle storage errors', async () => {
      // Arrange
      const incidentId = 'incident-123';
      const error = new BackupStorageError(
        'Database connection failed',
        'read',
        incidentId
      );

      backupService.getBackupArtifacts.mockRejectedValue(error);

      // Act & Assert
      await expect(controller.getBackupArtifacts(incidentId)).rejects.toThrow(HttpException);
      
      try {
        await controller.getBackupArtifacts(incidentId);
      } catch (httpError: any) {
        expect(httpError.getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
        expect(httpError.getResponse()).toMatchObject({
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Database connection failed',
          code: 'BACKUP_STORAGE_ERROR',
          details: {
            operation: 'read',
            filePath: incidentId,
          },
        });
      }
    });
  });

  describe('deleteBackupArtifact', () => {
    it('should delete backup artifact successfully', async () => {
      // Arrange
      const artifactId = 'artifact-123';
      backupService.deleteBackupArtifact.mockResolvedValue(true);

      // Act
      const result = await controller.deleteBackupArtifact(artifactId);

      // Assert
      expect(result).toEqual({ success: true });
      expect(backupService.deleteBackupArtifact).toHaveBeenCalledWith(artifactId);
    });

    it('should handle deletion errors', async () => {
      // Arrange
      const artifactId = 'artifact-123';
      const error = new BackupNotFoundError(artifactId);

      backupService.deleteBackupArtifact.mockRejectedValue(error);

      // Act & Assert
      await expect(controller.deleteBackupArtifact(artifactId)).rejects.toThrow(HttpException);
    });
  });

  describe('getBackupStats', () => {
    it('should get backup statistics successfully', async () => {
      // Arrange
      const incidentId = 'incident-123';
      const artifacts = [
        mockBackupArtifact,
        {
          ...mockBackupArtifact,
          id: 'artifact-456',
          artifactType: ArtifactType.PLUGIN_BACKUP,
          size: 2048,
          createdAt: new Date(Date.now() - 3600000), // 1 hour ago
        },
      ];

      backupService.getBackupArtifacts.mockResolvedValue(artifacts);

      // Act
      const result = await controller.getBackupStats(incidentId);

      // Assert
      expect(result).toMatchObject({
        totalArtifacts: 2,
        totalSize: 3072, // 1024 + 2048
        artifactTypes: {
          [ArtifactType.FILE_BACKUP]: 1,
          [ArtifactType.PLUGIN_BACKUP]: 1,
        },
        oldestBackup: expect.any(Number),
        newestBackup: expect.any(Number),
      });
      expect(result.oldestBackup).toBeLessThan(result.newestBackup!);
    });

    it('should handle empty artifact list', async () => {
      // Arrange
      const incidentId = 'incident-123';
      backupService.getBackupArtifacts.mockResolvedValue([]);

      // Act
      const result = await controller.getBackupStats(incidentId);

      // Assert
      expect(result).toMatchObject({
        totalArtifacts: 0,
        totalSize: 0,
        artifactTypes: {},
        oldestBackup: null,
        newestBackup: null,
      });
    });
  });

  describe('error handling', () => {
    it('should handle unknown errors gracefully', async () => {
      // Arrange
      const createBackupDto: CreateBackupDto = {
        incidentId: 'incident-123',
        serverId: 'server-123',
        filePath: '/var/www/html/test-file.txt',
        artifactType: ArtifactType.FILE_BACKUP,
      };

      // Create an error without a message
      const error = new Error();
      error.message = '';

      backupService.createFileBackup.mockRejectedValue(error);

      // Act & Assert
      await expect(controller.createFileBackup(createBackupDto)).rejects.toThrow(HttpException);
      
      try {
        await controller.createFileBackup(createBackupDto);
      } catch (httpError: any) {
        expect(httpError.getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
        expect(httpError.getResponse()).toMatchObject({
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Internal server error',
          code: 'INTERNAL_ERROR',
        });
      }
    });
  });
});