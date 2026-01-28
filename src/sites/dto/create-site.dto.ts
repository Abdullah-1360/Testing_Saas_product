import { IsString, IsBoolean, IsOptional, IsNotEmpty, IsUrl, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateSiteDto {
  @ApiProperty({ description: 'Server ID where the site is hosted' })
  @IsString()
  @IsNotEmpty()
  @IsUUID()
  serverId!: string;

  @ApiProperty({ description: 'Domain name of the site' })
  @IsString()
  @IsNotEmpty()
  domain!: string;

  @ApiProperty({ description: 'Document root path on the server' })
  @IsString()
  @IsNotEmpty()
  documentRoot!: string;

  @ApiProperty({ description: 'WordPress installation path' })
  @IsString()
  @IsNotEmpty()
  wordpressPath!: string;

  @ApiPropertyOptional({ description: 'Whether this is a WordPress multisite installation', default: false })
  @IsOptional()
  @IsBoolean()
  isMultisite?: boolean;

  @ApiProperty({ description: 'Site URL (frontend)' })
  @IsString()
  @IsNotEmpty()
  @IsUrl()
  siteUrl!: string;

  @ApiProperty({ description: 'WordPress admin URL' })
  @IsString()
  @IsNotEmpty()
  @IsUrl()
  adminUrl!: string;

  @ApiPropertyOptional({ description: 'Whether the site is active for monitoring', default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}