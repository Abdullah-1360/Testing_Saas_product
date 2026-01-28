import { IsString, IsUUID, IsEnum, IsOptional, IsObject } from 'class-validator';
import { ArtifactType } from '../interfaces/backup.interface';

export class CreateBackupDto {
  @IsUUID()
  incidentId: string;

  @IsUUID()
  serverId: string;

  @IsString()
  filePath: string;

  @IsEnum(ArtifactType)
  artifactType: ArtifactType;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

export class CreateDirectoryBackupDto {
  @IsUUID()
  incidentId: string;

  @IsUUID()
  serverId: string;

  @IsString()
  directoryPath: string;

  @IsEnum(ArtifactType)
  artifactType: ArtifactType;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

export class ExecuteRollbackDto {
  @IsUUID()
  incidentId: string;

  @IsOptional()
  @IsUUID(4, { each: true })
  artifactIds?: string[];
}

export class ValidateBackupDto {
  @IsUUID()
  artifactId: string;
}

export class BackupArtifactResponseDto {
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

export class BackupOperationResponseDto {
  success: boolean;
  artifactId?: string;
  filePath?: string;
  checksum?: string;
  size?: number;
  executionTime: number;
  timestamp: Date;
  error?: string;
}

export class RollbackOperationResponseDto {
  success: boolean;
  restoredFiles: string[];
  failedFiles: string[];
  executionTime: number;
  timestamp: Date;
  error?: string;
}

export class BackupValidationResponseDto {
  isValid: boolean;
  checksumMatch: boolean;
  fileExists: boolean;
  sizeMatch: boolean;
  error?: string;
}