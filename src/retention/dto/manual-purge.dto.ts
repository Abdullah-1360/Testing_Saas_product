import { IsString, IsInt, IsBoolean, IsOptional, Min, Max, IsDateString, IsArray, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum PurgeMode {
  SOFT = 'soft',     // Mark as deleted but keep data
  HARD = 'hard',     // Permanently delete data
  ARCHIVE = 'archive' // Move to archive table
}

export enum PurgeScope {
  ALL = 'all',
  INCIDENTS = 'incidents',
  COMMANDS = 'commands',
  EVIDENCE = 'evidence',
  BACKUPS = 'backups',
  AUDIT = 'audit'
}

export class ManualPurgeDto {
  @ApiProperty({
    description: 'Number of days to retain data (1-7 days maximum)',
    example: 3,
    minimum: 1,
    maximum: 7,
  })
  @IsInt()
  @Min(1)
  @Max(7)
  retentionDays!: number;

  @ApiProperty({
    description: 'Specific table to purge (optional, defaults to all tables)',
    example: 'incidents',
    required: false,
  })
  @IsOptional()
  @IsString()
  tableName?: string;

  @ApiProperty({
    description: 'Whether to perform a dry run (no actual deletion)',
    example: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean = false;

  @ApiProperty({
    description: 'Custom cutoff date (optional, overrides retentionDays)',
    example: '2024-01-01T00:00:00.000Z',
    required: false,
  })
  @IsOptional()
  @IsDateString()
  cutoffDate?: string;

  @ApiProperty({
    description: 'Purge mode - soft (mark deleted), hard (permanent), or archive',
    enum: PurgeMode,
    example: PurgeMode.HARD,
    default: PurgeMode.HARD,
  })
  @IsOptional()
  @IsEnum(PurgeMode)
  purgeMode?: PurgeMode = PurgeMode.HARD;

  @ApiProperty({
    description: 'Purge scope - which data categories to purge',
    enum: PurgeScope,
    example: PurgeScope.ALL,
    default: PurgeScope.ALL,
  })
  @IsOptional()
  @IsEnum(PurgeScope)
  purgeScope?: PurgeScope = PurgeScope.ALL;

  @ApiProperty({
    description: 'Specific incident IDs to purge (optional, for targeted cleanup)',
    example: ['incident-123', 'incident-456'],
    required: false,
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  incidentIds?: string[];

  @ApiProperty({
    description: 'Whether to create backup before purging',
    example: true,
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  createBackup?: boolean = true;

  @ApiProperty({
    description: 'Whether to verify data integrity after purging',
    example: true,
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  verifyIntegrity?: boolean = true;

  @ApiProperty({
    description: 'Maximum number of records to purge in single operation (safety limit)',
    example: 10000,
    minimum: 1,
    maximum: 100000,
    required: false,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100000)
  maxRecords?: number;

  @ApiProperty({
    description: 'Reason for manual purge (for audit trail)',
    example: 'Emergency cleanup due to storage constraints',
    required: false,
  })
  @IsOptional()
  @IsString()
  reason?: string;
}