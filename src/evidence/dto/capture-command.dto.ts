import { IsString, IsNotEmpty, IsOptional, IsNumber, IsBoolean, IsObject, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

export class CaptureCommandDto {
  @ApiProperty({
    description: 'The incident ID to associate the command output with',
    example: '123e4567-e89b-12d3-a456-426614174000'
  })
  @IsString()
  @IsNotEmpty()
  incidentId!: string;

  @ApiProperty({
    description: 'The server ID to execute the command on',
    example: '123e4567-e89b-12d3-a456-426614174001'
  })
  @IsString()
  @IsNotEmpty()
  serverId!: string;

  @ApiProperty({
    description: 'The command to execute and capture output from',
    example: 'ps aux | grep apache'
  })
  @IsString()
  @IsNotEmpty()
  command!: string;

  @ApiPropertyOptional({
    description: 'Command execution timeout in milliseconds',
    example: 30000,
    default: 30000
  })
  @IsOptional()
  @IsNumber()
  @Min(1000)
  @Max(300000) // 5 minutes max
  @Transform(({ value }) => parseInt(value))
  timeout?: number = 30000;

  @ApiPropertyOptional({
    description: 'Working directory for command execution',
    example: '/var/www/html'
  })
  @IsOptional()
  @IsString()
  workingDirectory?: string;

  @ApiPropertyOptional({
    description: 'Environment variables for command execution',
    example: { PATH: '/usr/local/bin:/usr/bin:/bin' }
  })
  @IsOptional()
  @IsObject()
  environment?: Record<string, string>;

  @ApiPropertyOptional({
    description: 'Whether to sanitize sensitive information from output',
    example: true,
    default: true
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  sanitizeOutput?: boolean = true;

  @ApiPropertyOptional({
    description: 'Whether to include command metadata in the evidence',
    example: true,
    default: true
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  includeMetadata?: boolean = true;

  @ApiPropertyOptional({
    description: 'Whether to store both stdout and stderr separately',
    example: true,
    default: true
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  separateStreams?: boolean = true;
}