import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { SSHService } from '../../ssh/services/ssh.service';
import { AuditService } from '../../audit/audit.service';
import {
  BackupServiceInterface,
  BackupArtifactData,
  BackupOperationResult,
  RollbackOperationResult,
  BackupValidationResult,
  ArtifactType,
  BackupMetadata,
  BackupStorageConfig,
} from '../interfaces/backup.interface';
import {
  BackupCreationError,
  BackupValidationError,
  RollbackExecutionError,
  BackupNotFoundError,
  BackupStorageError,
  InsufficientStorageError,
  BackupCorruptionError,
} from '../exceptions/backup.exceptions';
import { createHash } from 'crypto';
import * as path from 'path';
import * as fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class BackupService implements BackupServiceInterface {
  private readonly logger = new Logger(BackupService.name);
  private readonly storageConfig: BackupStorageConfig;

  constructor(
    private readonly configService: ConfigService,
    private readonly prismaService: PrismaService,
    private readonly sshService: SSHService,
    private readonly auditService: AuditService
  ) {
    this.storageConfig = {
      backupDirectory: this.configService.get<string>('BACKUP_DIRECTORY', '/tmp/wp-autohealer-backups'),
      maxBackupSize: this.configService.get<number>('MAX_BACKUP_SIZE', 1024 * 1024 * 1024), // 1GB
      compressionEnabled: this.configService.get<boolean>('BACKUP_COMPRESSION', true),
      encryptionEnabled: this.configService.get<boolean>('BACKUP_ENCRYPTION', false),
      retentionDays: this.configService.get<number>('BACKUP_RETENTION_DAYS', 7),
    };
  }

  /**
   * Create a backup of a single file
   */
  async createFileBackup(
    incidentId: string,
    serverId: string,
    filePath: string,
    artifactType: ArtifactType,
    metadata: Record<string, any> = {}
  ): Promise<BackupOperationResult> {
    const startTime = Date.now();
    
    try {
      this.logger.log(`Creating file backup for incident ${incidentId}: ${filePath}`);

      // Validate inputs
      await this.validateBackupInputs(incidentId, serverId, filePath);

      // Connect to server
      const connection = await this.sshService.connect(serverId);

      // Check if file exists and get metadata
      const fileInfo = await this.getRemoteFileInfo(connection.id, filePath);
      if (!fileInfo.exists) {
        throw new BackupCreationError(
          `File does not exist: ${filePath}`,
          filePath,
          incidentId
        );
      }

      // Check storage space
      await this.checkStorageSpace(fileInfo.size);

      // Generate backup file path
      const backupFileName = this.generateBackupFileName(filePath, artifactType);
      const localBackupPath = path.join(this.storageConfig.backupDirectory, backupFileName);

      // Ensure backup directory exists
      await fs.mkdir(path.dirname(localBackupPath), { recursive: true });

      // Download file to local backup storage
      const transferResult = await this.sshService.downloadFile(
        connection.id,
        filePath,
        localBackupPath
      );

      if (!transferResult.success) {
        throw new BackupCreationError(
          `Failed to download file for backup: ${filePath}`,
          filePath,
          incidentId
        );
      }

      // Calculate checksum
      const checksum = await this.calculateFileChecksum(localBackupPath);

      // Prepare backup metadata
      const backupMetadata = {
        originalPermissions: fileInfo.permissions,
        originalOwner: fileInfo.owner,
        originalGroup: fileInfo.group,
        backupReason: metadata['backupReason'] || 'Pre-modification backup',
        fixAttemptNumber: metadata['fixAttemptNumber'] || 1,
        relatedFiles: metadata['relatedFiles'] || [],
        dependencies: metadata['dependencies'] || [],
        rollbackInstructions: metadata['rollbackInstructions'] || [],
        ...metadata,
      };

      // Store backup artifact in database
      const backupArtifact = await this.prismaService.backupArtifact.create({
        data: {
          incidentId,
          artifactType: artifactType.toString(),
          filePath: localBackupPath,
          originalPath: filePath,
          checksum,
          size: BigInt(fileInfo.size),
          metadata: backupMetadata,
        },
      });

      // Log audit event
      await this.auditService.createAuditEvent({
        action: 'BACKUP_CREATED',
        resource: 'backup_artifact',
        resourceId: backupArtifact.id,
        details: {
          incidentId,
          originalPath: filePath,
          artifactType,
          size: fileInfo.size,
          checksum,
        },
      });

      const executionTime = Date.now() - startTime;

      this.logger.log(
        `File backup created successfully for incident ${incidentId}: ${filePath} -> ${backupArtifact.id}`
      );

      return {
        success: true,
        artifactId: backupArtifact.id,
        filePath: localBackupPath,
        checksum,
        size: fileInfo.size,
        executionTime,
        timestamp: new Date(),
      };
    } catch (error: any) {
      const executionTime = Date.now() - startTime;
      
      this.logger.error(`File backup failed for incident ${incidentId}: ${filePath}`, error);

      // Log audit event for failure
      await this.auditService.createAuditEvent({
        action: 'BACKUP_FAILED',
        resource: 'backup_artifact',
        details: {
          incidentId,
          originalPath: filePath,
          artifactType,
          error: error.message,
        },
      });

      if (error instanceof BackupCreationError) {
        throw error;
      }

      return {
        success: false,
        executionTime,
        timestamp: new Date(),
        error: error.message || 'Unknown backup error',
      };
    }
  }

  /**
   * Create a backup of a directory (compressed)
   */
  async createDirectoryBackup(
    incidentId: string,
    serverId: string,
    directoryPath: string,
    artifactType: ArtifactType,
    metadata: Record<string, any> = {}
  ): Promise<BackupOperationResult> {
    const startTime = Date.now();
    
    try {
      this.logger.log(`Creating directory backup for incident ${incidentId}: ${directoryPath}`);

      // Validate inputs
      await this.validateBackupInputs(incidentId, serverId, directoryPath);

      // Connect to server
      const connection = await this.sshService.connect(serverId);

      // Check if directory exists
      const dirInfo = await this.getRemoteDirectoryInfo(connection.id, directoryPath);
      if (!dirInfo.exists) {
        throw new BackupCreationError(
          `Directory does not exist: ${directoryPath}`,
          directoryPath,
          incidentId
        );
      }

      // Check storage space (estimate compressed size as 50% of original)
      const estimatedSize = Math.floor(dirInfo.size * 0.5);
      await this.checkStorageSpace(estimatedSize);

      // Generate backup file path
      const backupFileName = this.generateBackupFileName(directoryPath, artifactType, '.tar.gz');
      const localBackupPath = path.join(this.storageConfig.backupDirectory, backupFileName);

      // Ensure backup directory exists
      await fs.mkdir(path.dirname(localBackupPath), { recursive: true });

      // Create compressed archive on remote server
      const remoteArchivePath = `/tmp/wp-autohealer-${uuidv4()}.tar.gz`;
      const createArchiveCommand = `tar -czf "${remoteArchivePath}" -C "$(dirname "${directoryPath}")" "$(basename "${directoryPath}")"`;
      
      const archiveResult = await this.sshService.executeCommand(connection.id, createArchiveCommand);
      if (archiveResult.exitCode !== 0) {
        throw new BackupCreationError(
          `Failed to create archive: ${archiveResult.stderr}`,
          directoryPath,
          incidentId
        );
      }

      // Download archive to local backup storage
      const transferResult = await this.sshService.downloadFile(
        connection.id,
        remoteArchivePath,
        localBackupPath
      );

      // Clean up remote archive
      await this.sshService.executeCommand(connection.id, `rm -f "${remoteArchivePath}"`);

      if (!transferResult.success) {
        throw new BackupCreationError(
          `Failed to download directory archive for backup: ${directoryPath}`,
          directoryPath,
          incidentId
        );
      }

      // Calculate checksum
      const checksum = await this.calculateFileChecksum(localBackupPath);

      // Get actual file size
      const stats = await fs.stat(localBackupPath);
      const actualSize = stats.size;

      // Prepare backup metadata
      const backupMetadata = {
        backupReason: metadata['backupReason'] || 'Pre-modification directory backup',
        fixAttemptNumber: metadata['fixAttemptNumber'] || 1,
        relatedFiles: metadata['relatedFiles'] || [],
        dependencies: metadata['dependencies'] || [],
        rollbackInstructions: metadata['rollbackInstructions'] || [
          `Extract archive to restore: tar -xzf "${backupFileName}" -C "$(dirname "${directoryPath}")"`
        ],
        originalSize: dirInfo.size,
        compressionRatio: actualSize / dirInfo.size,
        ...metadata,
      };

      // Store backup artifact in database
      const backupArtifact = await this.prismaService.backupArtifact.create({
        data: {
          incidentId,
          artifactType: artifactType.toString(),
          filePath: localBackupPath,
          originalPath: directoryPath,
          checksum,
          size: BigInt(actualSize),
          metadata: backupMetadata,
        },
      });

      // Log audit event
      await this.auditService.createAuditEvent({
        action: 'DIRECTORY_BACKUP_CREATED',
        resource: 'backup_artifact',
        resourceId: backupArtifact.id,
        details: {
          incidentId,
          originalPath: directoryPath,
          artifactType,
          originalSize: dirInfo.size,
          compressedSize: actualSize,
          checksum,
        },
      });

      const executionTime = Date.now() - startTime;

      this.logger.log(
        `Directory backup created successfully for incident ${incidentId}: ${directoryPath} -> ${backupArtifact.id}`
      );

      return {
        success: true,
        artifactId: backupArtifact.id,
        filePath: localBackupPath,
        checksum,
        size: actualSize,
        executionTime,
        timestamp: new Date(),
      };
    } catch (error: any) {
      const executionTime = Date.now() - startTime;
      
      this.logger.error(`Directory backup failed for incident ${incidentId}: ${directoryPath}`, error);

      // Log audit event for failure
      await this.auditService.createAuditEvent({
        action: 'DIRECTORY_BACKUP_FAILED',
        resource: 'backup_artifact',
        details: {
          incidentId,
          originalPath: directoryPath,
          artifactType,
          error: error.message,
        },
      });

      if (error instanceof BackupCreationError) {
        throw error;
      }

      return {
        success: false,
        executionTime,
        timestamp: new Date(),
        error: error.message || 'Unknown directory backup error',
      };
    }
  }

  /**
   * Validate a backup artifact
   */
  async validateBackupArtifact(artifactId: string): Promise<BackupValidationResult> {
    try {
      this.logger.debug(`Validating backup artifact: ${artifactId}`);

      // Get backup artifact from database
      const artifact = await this.prismaService.backupArtifact.findUnique({
        where: { id: artifactId },
      });

      if (!artifact) {
        throw new BackupNotFoundError(artifactId);
      }

      // Check if backup file exists
      let fileExists = false;
      let actualSize = 0;
      let actualChecksum = '';

      try {
        const stats = await fs.stat(artifact.filePath);
        fileExists = true;
        actualSize = stats.size;
        actualChecksum = await this.calculateFileChecksum(artifact.filePath);
      } catch (error) {
        this.logger.warn(`Backup file not found: ${artifact.filePath}`);
      }

      // Validate checksum and size
      const checksumMatch = actualChecksum === artifact.checksum;
      const sizeMatch = actualSize === Number(artifact.size);
      const isValid = fileExists && checksumMatch && sizeMatch;

      const result: BackupValidationResult = {
        isValid,
        checksumMatch,
        fileExists,
        sizeMatch,
      };

      if (!isValid) {
        const errors = [];
        if (!fileExists) errors.push('File does not exist');
        if (!checksumMatch) errors.push(`Checksum mismatch (expected: ${artifact.checksum}, got: ${actualChecksum})`);
        if (!sizeMatch) errors.push(`Size mismatch (expected: ${artifact.size}, got: ${actualSize})`);
        result.error = errors.join(', ');
      }

      // Log validation result
      await this.auditService.createAuditEvent({
        action: 'BACKUP_VALIDATED',
        resource: 'backup_artifact',
        resourceId: artifactId,
        details: {
          isValid,
          checksumMatch,
          fileExists,
          sizeMatch,
          error: result.error,
        },
      });

      return result;
    } catch (error: any) {
      this.logger.error(`Backup validation failed for artifact ${artifactId}`, error);
      
      if (error instanceof BackupNotFoundError) {
        throw error;
      }

      throw new BackupValidationError(
        error.message || 'Backup validation failed',
        artifactId,
        error
      );
    }
  }

  /**
   * Execute rollback for an incident
   */
  async executeRollback(
    incidentId: string,
    artifactIds?: string[]
  ): Promise<RollbackOperationResult> {
    const startTime = Date.now();
    const restoredFiles: string[] = [];
    const failedFiles: string[] = [];

    try {
      this.logger.log(`Executing rollback for incident ${incidentId}`);

      // Get backup artifacts to rollback
      let artifacts;
      if (artifactIds && artifactIds.length > 0) {
        artifacts = await this.prismaService.backupArtifact.findMany({
          where: {
            id: { in: artifactIds },
            incidentId,
          },
          orderBy: { createdAt: 'desc' }, // Rollback in reverse order
        });
      } else {
        artifacts = await this.prismaService.backupArtifact.findMany({
          where: { incidentId },
          orderBy: { createdAt: 'desc' }, // Rollback in reverse order
        });
      }

      if (artifacts.length === 0) {
        throw new RollbackExecutionError(
          `No backup artifacts found for incident ${incidentId}`,
          incidentId
        );
      }

      // Get incident to find server
      const incident = await this.prismaService.incident.findUnique({
        where: { id: incidentId },
        include: { site: true },
      });

      if (!incident) {
        throw new RollbackExecutionError(
          `Incident not found: ${incidentId}`,
          incidentId
        );
      }

      // Connect to server
      const connection = await this.sshService.connect(incident.site.serverId);

      // Process each backup artifact
      for (const artifact of artifacts) {
        try {
          await this.rollbackSingleArtifact(connection.id, artifact);
          restoredFiles.push(artifact.originalPath);
          
          this.logger.debug(`Successfully restored: ${artifact.originalPath}`);
        } catch (error: any) {
          failedFiles.push(artifact.originalPath);
          this.logger.error(`Failed to restore ${artifact.originalPath}:`, error);
        }
      }

      const executionTime = Date.now() - startTime;
      const success = failedFiles.length === 0;

      // Log audit event
      await this.auditService.createAuditEvent({
        action: 'ROLLBACK_EXECUTED',
        resource: 'incident',
        resourceId: incidentId,
        details: {
          success,
          restoredFiles,
          failedFiles,
          artifactCount: artifacts.length,
          executionTime,
        },
      });

      this.logger.log(
        `Rollback completed for incident ${incidentId}. ` +
        `Restored: ${restoredFiles.length}, Failed: ${failedFiles.length}`
      );

      return {
        success,
        restoredFiles,
        failedFiles,
        executionTime,
        timestamp: new Date(),
        ...(failedFiles.length > 0 && { error: `Failed to restore ${failedFiles.length} files` }),
      };
    } catch (error: any) {
      const executionTime = Date.now() - startTime;
      
      this.logger.error(`Rollback failed for incident ${incidentId}`, error);

      // Log audit event for failure
      await this.auditService.createAuditEvent({
        action: 'ROLLBACK_FAILED',
        resource: 'incident',
        resourceId: incidentId,
        details: {
          error: error.message,
          restoredFiles,
          failedFiles,
          executionTime,
        },
      });

      if (error instanceof RollbackExecutionError) {
        throw error;
      }

      return {
        success: false,
        restoredFiles,
        failedFiles,
        executionTime,
        timestamp: new Date(),
        error: error.message || 'Unknown rollback error',
      };
    }
  }

  /**
   * Get backup artifacts for an incident
   */
  async getBackupArtifacts(incidentId: string): Promise<BackupArtifactData[]> {
    try {
      const artifacts = await this.prismaService.backupArtifact.findMany({
        where: { incidentId },
        orderBy: { createdAt: 'desc' },
      });

      return artifacts.map(artifact => ({
        id: artifact.id,
        incidentId: artifact.incidentId,
        artifactType: artifact.artifactType as ArtifactType,
        filePath: artifact.filePath,
        originalPath: artifact.originalPath,
        checksum: artifact.checksum,
        size: Number(artifact.size),
        metadata: artifact.metadata as Record<string, any>,
        createdAt: artifact.createdAt,
      }));
    } catch (error: any) {
      this.logger.error(`Failed to get backup artifacts for incident ${incidentId}`, error);
      throw new BackupStorageError(
        `Failed to retrieve backup artifacts: ${error.message}`,
        'read',
        incidentId,
        error
      );
    }
  }

  /**
   * Delete a backup artifact
   */
  async deleteBackupArtifact(artifactId: string): Promise<boolean> {
    try {
      this.logger.debug(`Deleting backup artifact: ${artifactId}`);

      // Get artifact from database
      const artifact = await this.prismaService.backupArtifact.findUnique({
        where: { id: artifactId },
      });

      if (!artifact) {
        throw new BackupNotFoundError(artifactId);
      }

      // Delete physical file
      try {
        await fs.unlink(artifact.filePath);
      } catch (error: any) {
        this.logger.warn(`Failed to delete backup file ${artifact.filePath}:`, error);
        // Continue with database deletion even if file deletion fails
      }

      // Delete from database
      await this.prismaService.backupArtifact.delete({
        where: { id: artifactId },
      });

      // Log audit event
      await this.auditService.createAuditEvent({
        action: 'BACKUP_DELETED',
        resource: 'backup_artifact',
        resourceId: artifactId,
        details: {
          originalPath: artifact.originalPath,
          filePath: artifact.filePath,
        },
      });

      this.logger.debug(`Backup artifact deleted successfully: ${artifactId}`);
      return true;
    } catch (error: any) {
      this.logger.error(`Failed to delete backup artifact ${artifactId}`, error);
      
      if (error instanceof BackupNotFoundError) {
        throw error;
      }

      throw new BackupStorageError(
        `Failed to delete backup artifact: ${error.message}`,
        'delete',
        artifactId,
        error
      );
    }
  }

  /**
   * Calculate file checksum
   */
  async calculateFileChecksum(filePath: string): Promise<string> {
    try {
      const fileBuffer = await fs.readFile(filePath);
      const hash = createHash('sha256');
      hash.update(fileBuffer);
      return hash.digest('hex');
    } catch (error: any) {
      throw new BackupStorageError(
        `Failed to calculate checksum: ${error.message}`,
        'read',
        filePath,
        error
      );
    }
  }

  // Private helper methods

  private async validateBackupInputs(
    incidentId: string,
    serverId: string,
    filePath: string
  ): Promise<void> {
    // Validate incident exists
    const incident = await this.prismaService.incident.findUnique({
      where: { id: incidentId },
    });

    if (!incident) {
      throw new BackupCreationError(
        `Incident not found: ${incidentId}`,
        filePath,
        incidentId
      );
    }

    // Validate server exists
    const server = await this.prismaService.server.findUnique({
      where: { id: serverId },
    });

    if (!server) {
      throw new BackupCreationError(
        `Server not found: ${serverId}`,
        filePath,
        incidentId
      );
    }

    // Validate file path
    if (!filePath || filePath.trim().length === 0) {
      throw new BackupCreationError(
        'File path cannot be empty',
        filePath,
        incidentId
      );
    }
  }

  private async getRemoteFileInfo(connectionId: string, filePath: string) {
    const statCommand = `stat -c '%s %a %U %G' "${filePath}" 2>/dev/null || echo "NOT_FOUND"`;
    const result = await this.sshService.executeCommand(connectionId, statCommand);

    if (result.stdout.trim() === 'NOT_FOUND' || result.exitCode !== 0) {
      return { exists: false, size: 0, permissions: '', owner: '', group: '' };
    }

    const [size, permissions, owner, group] = result.stdout.trim().split(' ');
    return {
      exists: true,
      size: parseInt(size || '0', 10),
      permissions: permissions || '',
      owner: owner || '',
      group: group || '',
    };
  }

  private async getRemoteDirectoryInfo(connectionId: string, directoryPath: string) {
    const duCommand = `du -sb "${directoryPath}" 2>/dev/null || echo "NOT_FOUND"`;
    const result = await this.sshService.executeCommand(connectionId, duCommand);

    if (result.stdout.trim() === 'NOT_FOUND' || result.exitCode !== 0) {
      return { exists: false, size: 0 };
    }

    const size = parseInt(result.stdout.split('\t')[0] || '0', 10);
    return { exists: true, size };
  }

  private async checkStorageSpace(requiredSpace: number): Promise<void> {
    try {
      // This is a simplified check - in production, you'd want to check actual disk space
      if (requiredSpace > this.storageConfig.maxBackupSize) {
        throw new InsufficientStorageError(requiredSpace, this.storageConfig.maxBackupSize);
      }
    } catch (error: any) {
      if (error instanceof InsufficientStorageError) {
        throw error;
      }
      // If we can't check space, proceed but log warning
      this.logger.warn(`Could not check storage space: ${error.message}`);
    }
  }

  private generateBackupFileName(
    originalPath: string,
    artifactType: ArtifactType,
    extension: string = ''
  ): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const basename = path.basename(originalPath);
    const sanitizedBasename = basename.replace(/[^a-zA-Z0-9.-]/g, '_');
    const artifactTypeStr = artifactType.toLowerCase().replace('_', '-');
    
    return `${timestamp}_${artifactTypeStr}_${sanitizedBasename}${extension}`;
  }

  private async rollbackSingleArtifact(connectionId: string, artifact: any): Promise<void> {
    // Validate backup before rollback
    const validation = await this.validateBackupArtifact(artifact.id);
    if (!validation.isValid) {
      throw new BackupCorruptionError(
        `Backup artifact is corrupted: ${validation.error}`,
        artifact.id,
        'checksum'
      );
    }

    // Handle different artifact types
    if (artifact.artifactType.includes('DIRECTORY')) {
      await this.rollbackDirectoryArtifact(connectionId, artifact);
    } else {
      await this.rollbackFileArtifact(connectionId, artifact);
    }
  }

  private async rollbackFileArtifact(connectionId: string, artifact: any): Promise<void> {
    // Upload backup file to temporary location
    const tempPath = `/tmp/wp-autohealer-restore-${uuidv4()}`;
    const uploadResult = await this.sshService.uploadFile(
      connectionId,
      artifact.filePath,
      tempPath
    );

    if (!uploadResult.success) {
      throw new RollbackExecutionError(
        `Failed to upload backup file for restoration: ${artifact.originalPath}`,
        artifact.incidentId,
        [artifact.originalPath]
      );
    }

    try {
      // Restore file permissions and ownership if available
      const metadata = artifact.metadata as BackupMetadata;
      
      // Move file to original location
      const moveCommand = `mv "${tempPath}" "${artifact.originalPath}"`;
      const moveResult = await this.sshService.executeCommand(connectionId, moveCommand);
      
      if (moveResult.exitCode !== 0) {
        throw new Error(`Failed to move file: ${moveResult.stderr}`);
      }

      // Restore permissions if available
      if (metadata.originalPermissions) {
        const chmodCommand = `chmod ${metadata.originalPermissions} "${artifact.originalPath}"`;
        await this.sshService.executeCommand(connectionId, chmodCommand);
      }

      // Restore ownership if available
      if (metadata.originalOwner && metadata.originalGroup) {
        const chownCommand = `chown ${metadata.originalOwner}:${metadata.originalGroup} "${artifact.originalPath}"`;
        await this.sshService.executeCommand(connectionId, chownCommand);
      }
    } catch (error) {
      // Clean up temporary file on failure
      await this.sshService.executeCommand(connectionId, `rm -f "${tempPath}"`);
      throw error;
    }
  }

  private async rollbackDirectoryArtifact(connectionId: string, artifact: any): Promise<void> {
    // Upload backup archive to temporary location
    const tempArchivePath = `/tmp/wp-autohealer-restore-${uuidv4()}.tar.gz`;
    const uploadResult = await this.sshService.uploadFile(
      connectionId,
      artifact.filePath,
      tempArchivePath
    );

    if (!uploadResult.success) {
      throw new RollbackExecutionError(
        `Failed to upload backup archive for restoration: ${artifact.originalPath}`,
        artifact.incidentId,
        [artifact.originalPath]
      );
    }

    try {
      // Remove existing directory
      const removeCommand = `rm -rf "${artifact.originalPath}"`;
      await this.sshService.executeCommand(connectionId, removeCommand);

      // Extract archive
      const extractCommand = `tar -xzf "${tempArchivePath}" -C "$(dirname "${artifact.originalPath}")"`;
      const extractResult = await this.sshService.executeCommand(connectionId, extractCommand);
      
      if (extractResult.exitCode !== 0) {
        throw new Error(`Failed to extract archive: ${extractResult.stderr}`);
      }
    } finally {
      // Clean up temporary archive
      await this.sshService.executeCommand(connectionId, `rm -f "${tempArchivePath}"`);
    }
  }
}