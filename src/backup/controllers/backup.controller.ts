import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpStatus,
  HttpException,
  Logger,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { BackupService } from '../services/backup.service';
import {
  CreateBackupDto,
  CreateDirectoryBackupDto,
  ExecuteRollbackDto,
  ValidateBackupDto,
  BackupArtifactResponseDto,
  BackupOperationResponseDto,
  RollbackOperationResponseDto,
  BackupValidationResponseDto,
} from '../dto/backup.dto';
import {
  BackupCreationError,
  BackupValidationError,
  RollbackExecutionError,
  BackupNotFoundError,
  BackupStorageError,
} from '../exceptions/backup.exceptions';

@Controller('backup')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BackupController {
  private readonly logger = new Logger(BackupController.name);

  constructor(private readonly backupService: BackupService) {}

  /**
   * Create a file backup
   */
  @Post('file')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER')
  async createFileBackup(@Body() createBackupDto: CreateBackupDto): Promise<BackupOperationResponseDto> {
    try {
      this.logger.log(`Creating file backup for incident ${createBackupDto.incidentId}: ${createBackupDto.filePath}`);

      const result = await this.backupService.createFileBackup(
        createBackupDto.incidentId,
        createBackupDto.serverId,
        createBackupDto.filePath,
        createBackupDto.artifactType,
        createBackupDto.metadata
      );

      return result;
    } catch (error: any) {
      this.logger.error('File backup creation failed', error);
      this.handleBackupError(error);
    }
  }

  /**
   * Create a directory backup
   */
  @Post('directory')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER')
  async createDirectoryBackup(@Body() createDirectoryBackupDto: CreateDirectoryBackupDto): Promise<BackupOperationResponseDto> {
    try {
      this.logger.log(`Creating directory backup for incident ${createDirectoryBackupDto.incidentId}: ${createDirectoryBackupDto.directoryPath}`);

      const result = await this.backupService.createDirectoryBackup(
        createDirectoryBackupDto.incidentId,
        createDirectoryBackupDto.serverId,
        createDirectoryBackupDto.directoryPath,
        createDirectoryBackupDto.artifactType,
        createDirectoryBackupDto.metadata
      );

      return result;
    } catch (error: any) {
      this.logger.error('Directory backup creation failed', error);
      this.handleBackupError(error);
    }
  }

  /**
   * Validate a backup artifact
   */
  @Post('validate')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER', 'VIEWER')
  async validateBackup(@Body() validateBackupDto: ValidateBackupDto): Promise<BackupValidationResponseDto> {
    try {
      this.logger.debug(`Validating backup artifact: ${validateBackupDto.artifactId}`);

      const result = await this.backupService.validateBackupArtifact(validateBackupDto.artifactId);
      return result;
    } catch (error: any) {
      this.logger.error('Backup validation failed', error);
      this.handleBackupError(error);
    }
  }

  /**
   * Execute rollback for an incident
   */
  @Post('rollback')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER')
  async executeRollback(@Body() executeRollbackDto: ExecuteRollbackDto): Promise<RollbackOperationResponseDto> {
    try {
      this.logger.log(`Executing rollback for incident ${executeRollbackDto.incidentId}`);

      const result = await this.backupService.executeRollback(
        executeRollbackDto.incidentId,
        executeRollbackDto.artifactIds
      );

      return result;
    } catch (error: any) {
      this.logger.error('Rollback execution failed', error);
      this.handleBackupError(error);
    }
  }

  /**
   * Get backup artifacts for an incident
   */
  @Get('incident/:incidentId')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER', 'VIEWER')
  async getBackupArtifacts(@Param('incidentId') incidentId: string): Promise<BackupArtifactResponseDto[]> {
    try {
      this.logger.debug(`Getting backup artifacts for incident: ${incidentId}`);

      const artifacts = await this.backupService.getBackupArtifacts(incidentId);
      
      return artifacts.map(artifact => ({
        id: artifact.id,
        incidentId: artifact.incidentId,
        artifactType: artifact.artifactType,
        filePath: artifact.filePath,
        originalPath: artifact.originalPath,
        checksum: artifact.checksum,
        size: artifact.size,
        metadata: artifact.metadata,
        createdAt: artifact.createdAt,
      }));
    } catch (error: any) {
      this.logger.error(`Failed to get backup artifacts for incident ${incidentId}`, error);
      this.handleBackupError(error);
    }
  }

  /**
   * Get a specific backup artifact
   */
  @Get('artifact/:artifactId')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER', 'VIEWER')
  async getBackupArtifact(@Param('artifactId') artifactId: string): Promise<BackupArtifactResponseDto> {
    try {
      this.logger.debug(`Getting backup artifact: ${artifactId}`);

      const artifacts = await this.backupService.getBackupArtifacts(''); // This will need to be refactored
      const artifact = artifacts.find(a => a.id === artifactId);

      if (!artifact) {
        throw new BackupNotFoundError(artifactId);
      }

      return {
        id: artifact.id,
        incidentId: artifact.incidentId,
        artifactType: artifact.artifactType,
        filePath: artifact.filePath,
        originalPath: artifact.originalPath,
        checksum: artifact.checksum,
        size: artifact.size,
        metadata: artifact.metadata,
        createdAt: artifact.createdAt,
      };
    } catch (error: any) {
      this.logger.error(`Failed to get backup artifact ${artifactId}`, error);
      this.handleBackupError(error);
    }
  }

  /**
   * Delete a backup artifact
   */
  @Delete('artifact/:artifactId')
  @Roles('SUPER_ADMIN', 'ADMIN')
  async deleteBackupArtifact(@Param('artifactId') artifactId: string): Promise<{ success: boolean }> {
    try {
      this.logger.log(`Deleting backup artifact: ${artifactId}`);

      const success = await this.backupService.deleteBackupArtifact(artifactId);
      return { success };
    } catch (error: any) {
      this.logger.error(`Failed to delete backup artifact ${artifactId}`, error);
      this.handleBackupError(error);
    }
  }

  /**
   * Get backup statistics for an incident
   */
  @Get('stats/:incidentId')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER', 'VIEWER')
  async getBackupStats(@Param('incidentId') incidentId: string) {
    try {
      this.logger.debug(`Getting backup statistics for incident: ${incidentId}`);

      const artifacts = await this.backupService.getBackupArtifacts(incidentId);
      
      const stats = {
        totalArtifacts: artifacts.length,
        totalSize: artifacts.reduce((sum, artifact) => sum + artifact.size, 0),
        artifactTypes: artifacts.reduce((types, artifact) => {
          types[artifact.artifactType] = (types[artifact.artifactType] || 0) + 1;
          return types;
        }, {} as Record<string, number>),
        oldestBackup: artifacts.length > 0 ? Math.min(...artifacts.map(a => a.createdAt.getTime())) : null,
        newestBackup: artifacts.length > 0 ? Math.max(...artifacts.map(a => a.createdAt.getTime())) : null,
      };

      return stats;
    } catch (error: any) {
      this.logger.error(`Failed to get backup statistics for incident ${incidentId}`, error);
      this.handleBackupError(error);
    }
  }

  /**
   * Handle backup-specific errors and convert to appropriate HTTP exceptions
   */
  private handleBackupError(error: any): never {
    if (error instanceof BackupCreationError) {
      throw new HttpException(
        {
          statusCode: HttpStatus.BAD_REQUEST,
          message: error.message,
          code: error.code,
          details: {
            filePath: error.filePath,
            incidentId: error.incidentId,
          },
        },
        HttpStatus.BAD_REQUEST
      );
    }

    if (error instanceof BackupValidationError) {
      throw new HttpException(
        {
          statusCode: HttpStatus.BAD_REQUEST,
          message: error.message,
          code: error.code,
          details: {
            artifactId: error.artifactId,
          },
        },
        HttpStatus.BAD_REQUEST
      );
    }

    if (error instanceof RollbackExecutionError) {
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: error.message,
          code: error.code,
          details: {
            incidentId: error.incidentId,
            failedFiles: error.failedFiles,
          },
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }

    if (error instanceof BackupNotFoundError) {
      throw new HttpException(
        {
          statusCode: HttpStatus.NOT_FOUND,
          message: error.message,
          code: error.code,
          details: {
            artifactId: error.artifactId,
          },
        },
        HttpStatus.NOT_FOUND
      );
    }

    if (error instanceof BackupStorageError) {
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: error.message,
          code: error.code,
          details: {
            operation: error.operation,
            filePath: error.filePath,
          },
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }

    // Generic error handling
    throw new HttpException(
      {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: error.message || 'Internal server error',
        code: 'INTERNAL_ERROR',
      },
      HttpStatus.INTERNAL_SERVER_ERROR
    );
  }
}