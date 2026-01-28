import { IsString, IsNotEmpty, IsArray, IsOptional, IsNumber, IsBoolean, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

export class CollectLogsDto {
  @ApiProperty({
    description: 'The incident ID to associate the collected logs with',
    example: '123e4567-e89b-12d3-a456-426614174000'
  })
  @IsString()
  @IsNotEmpty()
  incidentId!: string;

  @ApiProperty({
    description: 'The server ID to collect logs from',
    example: '123e4567-e89b-12d3-a456-426614174001'
  })
  @IsString()
  @IsNotEmpty()
  serverId!: string;

  @ApiProperty({
    description: 'Array of log file paths to collect',
    example: ['/var/log/apache2/error.log', '/var/log/php/error.log', '/var/log/mysql/error.log'],
    type: [String]
  })
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  logPaths!: string[];

  @ApiPropertyOptional({
    description: 'Maximum number of lines to collect from each log file',
    example: 1000,
    default: 1000
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(10000)
  @Transform(({ value }) => parseInt(value))
  maxLines?: number = 1000;

  @ApiPropertyOptional({
    description: 'Maximum file size to process in bytes',
    example: 10485760,
    default: 10485760
  })
  @IsOptional()
  @IsNumber()
  @Min(1024)
  @Max(104857600) // 100MB max
  @Transform(({ value }) => parseInt(value))
  maxFileSize?: number = 10485760; // 10MB default

  @ApiPropertyOptional({
    description: 'Collection method to use',
    example: 'tail',
    default: 'tail'
  })
  @IsOptional()
  @IsString()
  collectionMethod?: 'tail' | 'head' | 'full' | 'grep' = 'tail';

  @ApiPropertyOptional({
    description: 'Grep pattern to filter log lines (only used with grep collection method)',
    example: 'ERROR|FATAL|CRITICAL'
  })
  @IsOptional()
  @IsString()
  grepPattern?: string;

  @ApiPropertyOptional({
    description: 'Whether to compress the collected log content',
    example: true,
    default: true
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  compress?: boolean = true;

  @ApiPropertyOptional({
    description: 'Whether to include file metadata in the evidence',
    example: true,
    default: true
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  includeMetadata?: boolean = true;
}