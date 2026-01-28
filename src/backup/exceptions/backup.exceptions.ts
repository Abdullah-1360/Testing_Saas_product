export class BackupError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: any
  ) {
    super(message);
    this.name = 'BackupError';
  }
}

export class BackupCreationError extends BackupError {
  constructor(
    message: string,
    public readonly filePath: string,
    public readonly incidentId: string,
    details?: any
  ) {
    super(message, 'BACKUP_CREATION_ERROR', details);
    this.name = 'BackupCreationError';
  }
}

export class BackupValidationError extends BackupError {
  constructor(
    message: string,
    public readonly artifactId: string,
    details?: any
  ) {
    super(message, 'BACKUP_VALIDATION_ERROR', details);
    this.name = 'BackupValidationError';
  }
}

export class RollbackExecutionError extends BackupError {
  constructor(
    message: string,
    public readonly incidentId: string,
    public readonly failedFiles: string[] = [],
    details?: any
  ) {
    super(message, 'ROLLBACK_EXECUTION_ERROR', details);
    this.name = 'RollbackExecutionError';
  }
}

export class BackupNotFoundError extends BackupError {
  constructor(
    public readonly artifactId: string
  ) {
    super(`Backup artifact not found: ${artifactId}`, 'BACKUP_NOT_FOUND', { artifactId });
    this.name = 'BackupNotFoundError';
  }
}

export class BackupStorageError extends BackupError {
  constructor(
    message: string,
    public readonly operation: 'read' | 'write' | 'delete',
    public readonly filePath: string,
    details?: any
  ) {
    super(message, 'BACKUP_STORAGE_ERROR', details);
    this.name = 'BackupStorageError';
  }
}

export class ChecksumMismatchError extends BackupError {
  constructor(
    public readonly expectedChecksum: string,
    public readonly actualChecksum: string,
    public readonly filePath: string
  ) {
    super(
      `Checksum mismatch for ${filePath}. Expected: ${expectedChecksum}, Got: ${actualChecksum}`,
      'CHECKSUM_MISMATCH',
      { expectedChecksum, actualChecksum, filePath }
    );
    this.name = 'ChecksumMismatchError';
  }
}

export class InsufficientStorageError extends BackupError {
  constructor(
    public readonly requiredSpace: number,
    public readonly availableSpace: number
  ) {
    super(
      `Insufficient storage space. Required: ${requiredSpace} bytes, Available: ${availableSpace} bytes`,
      'INSUFFICIENT_STORAGE',
      { requiredSpace, availableSpace }
    );
    this.name = 'InsufficientStorageError';
  }
}

export class BackupCorruptionError extends BackupError {
  constructor(
    message: string,
    public readonly artifactId: string,
    public readonly corruptionType: 'checksum' | 'size' | 'format' | 'missing',
    details?: any
  ) {
    super(message, 'BACKUP_CORRUPTION', details);
    this.name = 'BackupCorruptionError';
  }
}