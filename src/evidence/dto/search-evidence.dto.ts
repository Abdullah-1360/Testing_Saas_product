import { IsString, IsOptional, IsNumber, IsDateString, IsEnum, Min, Max } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { EvidenceType } from './create-evidence.dto';

export class SearchEvidenceDto {
  @ApiPropertyOptional({
    description: 'Filter by incident ID',
    example: '123e4567-e89b-12d3-a456-426614174000'
  })
  @IsOptional()
  @IsString()
  incidentId?: string;

  @ApiPropertyOptional({
    description: 'Filter by evidence type',
    enum: EvidenceType,
    example: EvidenceType.LOG_FILE
  })
  @IsOptional()
  @IsEnum(EvidenceType)
  evidenceType?: EvidenceType;

  @ApiPropertyOptional({
    description: 'Filter by evidence signature',
    example: 'sha256:a1b2c3d4e5f6...'
  })
  @IsOptional()
  @IsString()
  signature?: string;

  @ApiPropertyOptional({
    description: 'Search for pattern in evidence content',
    example: 'ERROR|FATAL|CRITICAL'
  })
  @IsOptional()
  @IsString()
  contentPattern?: string;

  @ApiPropertyOptional({
    description: 'Filter by start date (ISO 8601 format)',
    example: '2024-01-01T00:00:00Z'
  })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({
    description: 'Filter by end date (ISO 8601 format)',
    example: '2024-01-31T23:59:59Z'
  })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({
    description: 'Number of results to return',
    example: 50,
    default: 50
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(1000)
  @Transform(({ value }) => parseInt(value))
  limit?: number = 50;

  @ApiPropertyOptional({
    description: 'Number of results to skip (for pagination)',
    example: 0,
    default: 0
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Transform(({ value }) => parseInt(value))
  offset?: number = 0;

  @ApiPropertyOptional({
    description: 'Sort field',
    example: 'timestamp',
    default: 'timestamp'
  })
  @IsOptional()
  @IsString()
  sortBy?: string = 'timestamp';

  @ApiPropertyOptional({
    description: 'Sort order',
    example: 'desc',
    default: 'desc'
  })
  @IsOptional()
  @IsString()
  sortOrder?: 'asc' | 'desc' = 'desc';
}