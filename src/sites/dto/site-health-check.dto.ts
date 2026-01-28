import { IsString, IsBoolean, IsNumber, IsOptional, IsArray, IsObject } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SiteHealthCheckDto {
  @ApiProperty({ description: 'Site ID to check' })
  @IsString()
  siteId!: string;

  @ApiPropertyOptional({ description: 'Force a fresh health check (ignore cache)', default: false })
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

export class HealthCheckResultDto {
  @ApiProperty({ description: 'Overall health status' })
  @IsBoolean()
  healthy!: boolean;

  @ApiProperty({ description: 'HTTP response status code' })
  @IsNumber()
  statusCode!: number;

  @ApiProperty({ description: 'Response time in milliseconds' })
  @IsNumber()
  responseTime!: number;

  @ApiProperty({ description: 'Whether WordPress is detected' })
  @IsBoolean()
  wordpressDetected!: boolean;

  @ApiPropertyOptional({ description: 'WordPress version if detected' })
  @IsOptional()
  @IsString()
  wordpressVersion?: string;

  @ApiProperty({ description: 'Whether site is in maintenance mode' })
  @IsBoolean()
  maintenanceMode!: boolean;

  @ApiProperty({ description: 'Whether fatal errors were detected' })
  @IsBoolean()
  fatalErrors!: boolean;

  @ApiProperty({ description: 'Whether white screen of death detected' })
  @IsBoolean()
  whiteScreen!: boolean;

  @ApiProperty({ description: 'Whether title tag is present' })
  @IsBoolean()
  titleTagPresent!: boolean;

  @ApiProperty({ description: 'Whether canonical tag is present' })
  @IsBoolean()
  canonicalTagPresent!: boolean;

  @ApiProperty({ description: 'Whether footer markers are present' })
  @IsBoolean()
  footerMarkersPresent!: boolean;

  @ApiProperty({ description: 'Whether header markers are present' })
  @IsBoolean()
  headerMarkersPresent!: boolean;

  @ApiProperty({ description: 'Whether wp-login is accessible' })
  @IsBoolean()
  wpLoginAccessible!: boolean;

  @ApiProperty({ description: 'List of detected issues' })
  @IsArray()
  issues!: string[];

  @ApiProperty({ description: 'Additional health check details' })
  @IsOptional()
  @IsObject()
  details?: Record<string, any>;

  @ApiProperty({ description: 'Timestamp of the health check' })
  timestamp!: Date;
}