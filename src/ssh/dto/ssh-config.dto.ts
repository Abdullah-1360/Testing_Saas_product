import { IsString, IsNumber, IsEnum, IsOptional, IsBoolean, Min, Max, IsNotEmpty } from 'class-validator';
import { Transform } from 'class-transformer';

export class SSHConfigDto {
  @IsString()
  @IsNotEmpty()
  hostname: string;

  @IsNumber()
  @Min(1)
  @Max(65535)
  port: number;

  @IsString()
  @IsNotEmpty()
  username: string;

  @IsEnum(['key', 'password'])
  authType: 'key' | 'password';

  @IsOptional()
  @IsString()
  privateKey?: string;

  @IsOptional()
  @IsString()
  password?: string;

  @IsOptional()
  @IsString()
  hostKeyFingerprint?: string;

  @IsBoolean()
  @Transform(({ value }) => value === true || value === 'true')
  strictHostKeyChecking: boolean = true;

  @IsOptional()
  @IsNumber()
  @Min(1000)
  @Max(300000)
  connectionTimeout?: number = 30000;

  @IsOptional()
  @IsNumber()
  @Min(1000)
  @Max(60000)
  keepaliveInterval?: number = 30000;
}

export class CommandExecutionDto {
  @IsString()
  @IsNotEmpty()
  command: string;

  @IsOptional()
  @IsNumber()
  @Min(1000)
  @Max(300000)
  timeout?: number = 30000;

  @IsOptional()
  @IsString()
  cwd?: string;

  @IsOptional()
  env?: Record<string, string>;

  @IsOptional()
  @IsBoolean()
  pty?: boolean = false;

  @IsOptional()
  @IsBoolean()
  sanitizeOutput?: boolean = true;
}

export class FileTransferDto {
  @IsString()
  @IsNotEmpty()
  localPath: string;

  @IsString()
  @IsNotEmpty()
  remotePath: string;
}

export class CommandTemplateDto {
  @IsString()
  @IsNotEmpty()
  template: string;

  @IsOptional()
  parameters?: Record<string, any>;
}