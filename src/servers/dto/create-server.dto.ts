import { IsString, IsNumber, IsEnum, IsOptional, IsNotEmpty, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AuthType, ControlPanelType } from '@prisma/client';

export class CreateServerDto {
  @ApiProperty({ description: 'Server name' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ description: 'Server hostname or IP address' })
  @IsString()
  @IsNotEmpty()
  hostname!: string;

  @ApiPropertyOptional({ description: 'SSH port', default: 22 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(65535)
  port?: number | undefined;

  @ApiProperty({ description: 'SSH username' })
  @IsString()
  @IsNotEmpty()
  username!: string;

  @ApiProperty({ description: 'Authentication type', enum: AuthType })
  @IsEnum(AuthType)
  authType!: AuthType;

  @ApiProperty({ description: 'SSH credentials (password or private key)' })
  @IsString()
  @IsNotEmpty()
  credentials!: string;

  @ApiPropertyOptional({ description: 'SSH host key fingerprint' })
  @IsOptional()
  @IsString()
  hostKeyFingerprint?: string | undefined;

  @ApiPropertyOptional({ description: 'Control panel type', enum: ControlPanelType })
  @IsOptional()
  @IsEnum(ControlPanelType)
  controlPanel?: ControlPanelType | undefined;
}