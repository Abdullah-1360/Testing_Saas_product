import { IsString, IsNotEmpty, IsOptional, IsObject, IsEnum, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum EvidenceType {
  LOG_FILE = 'LOG_FILE',
  COMMAND_OUTPUT = 'COMMAND_OUTPUT',
  SYSTEM_INFO = 'SYSTEM_INFO',
  WORDPRESS_INFO = 'WORDPRESS_INFO',
  ERROR_LOG = 'ERROR_LOG',
  ACCESS_LOG = 'ACCESS_LOG',
  PHP_ERROR_LOG = 'PHP_ERROR_LOG',
  MYSQL_ERROR_LOG = 'MYSQL_ERROR_LOG',
  NGINX_ERROR_LOG = 'NGINX_ERROR_LOG',
  APACHE_ERROR_LOG = 'APACHE_ERROR_LOG',
  DIAGNOSTIC_REPORT = 'DIAGNOSTIC_REPORT',
  CONFIGURATION_FILE = 'CONFIGURATION_FILE',
  PROCESS_LIST = 'PROCESS_LIST',
  NETWORK_STATUS = 'NETWORK_STATUS',
  DISK_USAGE = 'DISK_USAGE',
  MEMORY_USAGE = 'MEMORY_USAGE',
  CUSTOM = 'CUSTOM'
}

export class CreateEvidenceDto {
  @ApiProperty({
    description: 'The incident ID this evidence belongs to',
    example: '123e4567-e89b-12d3-a456-426614174000'
  })
  @IsString()
  @IsNotEmpty()
  incidentId!: string;

  @ApiProperty({
    description: 'Type of evidence being collected',
    enum: EvidenceType,
    example: EvidenceType.LOG_FILE
  })
  @IsEnum(EvidenceType)
  evidenceType!: EvidenceType;

  @ApiProperty({
    description: 'The actual evidence content',
    example: 'Log file content or command output...'
  })
  @IsString()
  @IsNotEmpty()
  content!: string;

  @ApiPropertyOptional({
    description: 'Additional metadata about the evidence',
    example: {
      filePath: '/var/log/apache2/error.log',
      fileSize: 1024,
      lineCount: 50,
      collectionMethod: 'tail'
    }
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;

  @ApiPropertyOptional({
    description: 'Custom signature for the evidence (auto-generated if not provided)',
    example: 'sha256:a1b2c3d4e5f6...'
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  signature?: string;
}