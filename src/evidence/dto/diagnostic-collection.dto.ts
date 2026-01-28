import { IsString, IsNotEmpty, IsOptional, IsBoolean, IsArray } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

export class DiagnosticCollectionDto {
  @ApiProperty({
    description: 'The incident ID to associate the diagnostic data with',
    example: '123e4567-e89b-12d3-a456-426614174000'
  })
  @IsString()
  @IsNotEmpty()
  incidentId!: string;

  @ApiProperty({
    description: 'The site ID to collect diagnostics for',
    example: '123e4567-e89b-12d3-a456-426614174001'
  })
  @IsString()
  @IsNotEmpty()
  siteId!: string;

  @ApiPropertyOptional({
    description: 'Whether to collect system diagnostics',
    example: true,
    default: true
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  includeSystemDiagnostics?: boolean = true;

  @ApiPropertyOptional({
    description: 'Whether to collect WordPress diagnostics',
    example: true,
    default: true
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  includeWordPressDiagnostics?: boolean = true;

  @ApiPropertyOptional({
    description: 'Whether to collect log files',
    example: true,
    default: true
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  includeLogFiles?: boolean = true;

  @ApiPropertyOptional({
    description: 'Whether to collect configuration files',
    example: true,
    default: true
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  includeConfigFiles?: boolean = true;

  @ApiPropertyOptional({
    description: 'Custom log file paths to collect (in addition to standard ones)',
    example: ['/var/log/custom-app.log', '/opt/app/logs/error.log'],
    type: [String]
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  customLogPaths?: string[];

  @ApiPropertyOptional({
    description: 'Custom commands to execute and capture output',
    example: ['netstat -tulpn', 'df -h', 'free -m'],
    type: [String]
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  customCommands?: string[];

  @ApiPropertyOptional({
    description: 'Whether to compress collected data',
    example: true,
    default: true
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  compress?: boolean = true;

  @ApiPropertyOptional({
    description: 'Whether to generate detailed signatures for all evidence',
    example: true,
    default: true
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  generateSignatures?: boolean = true;
}