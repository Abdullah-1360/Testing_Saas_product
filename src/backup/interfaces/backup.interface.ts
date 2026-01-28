export interface BackupArtifactData {
  id: string;
  incidentId: string;
  artifactType: ArtifactType;
  filePath: string;
  originalPath: string;
  checksum: string;
  size: number;
  metadata: Record<string, any>;
  createdAt: Date;
}

export interface BackupOperationResult {
  success: boolean;
  artifactId?: string;
  filePath?: string;
  checksum?: string;
  size?: number;
  executionTime: number;
  timestamp: Date;
  error?: string;
}

export interface RollbackOperationResult {
  success: boolean;
  restoredFiles: string[];
  failedFiles: string[];
  executionTime: number;
  timestamp: Date;
  error?: string;
}

export interface BackupValidationResult {
  isValid: boolean;
  checksumMatch: boolean;
  fileExists: boolean;
  sizeMatch: boolean;
  error?: string;
}

export interface BackupServiceInterface {
  createFileBackup(
    incidentId: string,
    serverId: string,
    filePath: string,
    artifactType: ArtifactType,
    metadata?: Record<string, any>
  ): Promise<BackupOperationResult>;

  createDirectoryBackup(
    incidentId: string,
    serverId: string,
    directoryPath: string,
    artifactType: ArtifactType,
    metadata?: Record<string, any>
  ): Promise<BackupOperationResult>;

  validateBackupArtifact(artifactId: string): Promise<BackupValidationResult>;

  executeRollback(incidentId: string, artifactIds?: string[]): Promise<RollbackOperationResult>;

  getBackupArtifacts(incidentId: string): Promise<BackupArtifactData[]>;

  deleteBackupArtifact(artifactId: string): Promise<boolean>;

  calculateFileChecksum(filePath: string): Promise<string>;
}

export enum ArtifactType {
  FILE_BACKUP = 'FILE_BACKUP',
  DIRECTORY_BACKUP = 'DIRECTORY_BACKUP',
  DATABASE_BACKUP = 'DATABASE_BACKUP',
  CONFIGURATION_BACKUP = 'CONFIGURATION_BACKUP',
  PLUGIN_BACKUP = 'PLUGIN_BACKUP',
  THEME_BACKUP = 'THEME_BACKUP',
  WORDPRESS_CORE_BACKUP = 'WORDPRESS_CORE_BACKUP',
  HTACCESS_BACKUP = 'HTACCESS_BACKUP',
  WP_CONFIG_BACKUP = 'WP_CONFIG_BACKUP',
}

export interface BackupMetadata {
  originalPermissions?: string;
  originalOwner?: string;
  originalGroup?: string;
  backupReason: string;
  fixAttemptNumber: number;
  relatedFiles?: string[];
  dependencies?: string[];
  rollbackInstructions?: string[];
}

export interface BackupStorageConfig {
  backupDirectory: string;
  maxBackupSize: number;
  compressionEnabled: boolean;
  encryptionEnabled: boolean;
  retentionDays: number;
}