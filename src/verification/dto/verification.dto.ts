import { IsString, IsBoolean, IsOptional, IsArray, IsUrl } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class VerifyIncidentDto {
  @ApiProperty({ description: 'Incident ID to verify' })
  @IsString()
  incidentId!: string;

  @ApiProperty({ description: 'Site URL to verify' })
  @IsUrl()
  siteUrl!: string;

  @ApiProperty({ description: 'WordPress admin URL' })
  @IsUrl()
  adminUrl!: string;

  @ApiPropertyOptional({ description: 'Additional internal URLs to test' })
  @IsOptional()
  @IsArray()
  @IsUrl({}, { each: true })
  internalUrls?: string[];

  @ApiPropertyOptional({ description: 'Skip certain verification checks' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  skipChecks?: string[];
}

export class VerifySiteDto {
  @ApiProperty({ description: 'Site ID to verify' })
  @IsString()
  siteId!: string;

  @ApiPropertyOptional({ description: 'Force fresh verification (ignore cache)' })
  @IsOptional()
  @IsBoolean()
  force?: boolean;

  @ApiPropertyOptional({ description: 'Additional internal URLs to test' })
  @IsOptional()
  @IsArray()
  @IsUrl({}, { each: true })
  internalUrls?: string[];

  @ApiPropertyOptional({ description: 'Skip certain verification checks' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  skipChecks?: string[];
}

export class VerificationResultDto {
  @ApiProperty({ description: 'Overall verification success' })
  @IsBoolean()
  success!: boolean;

  @ApiProperty({ description: 'Site health status' })
  @IsBoolean()
  healthy!: boolean;

  @ApiProperty({ description: 'Total number of checks performed' })
  totalChecks!: number;

  @ApiProperty({ description: 'Number of checks that passed' })
  passedChecks!: number;

  @ApiProperty({ description: 'Number of checks that failed' })
  failedChecks!: number;

  @ApiProperty({ description: 'Total response time for all checks' })
  responseTime!: number;

  @ApiProperty({ description: 'Individual verification results' })
  checks!: {
    httpStatus: VerificationCheckDto;
    fatalErrorCheck: VerificationCheckDto;
    maintenanceCheck: VerificationCheckDto;
    whiteScreenCheck: VerificationCheckDto;
    titleTagCheck: VerificationCheckDto;
    canonicalTagCheck: VerificationCheckDto;
    footerMarkerCheck: VerificationCheckDto;
    headerMarkerCheck: VerificationCheckDto;
    wpLoginCheck: VerificationCheckDto;
    internalUrlCheck: VerificationCheckDto;
  };

  @ApiProperty({ description: 'Timestamp of verification' })
  timestamp!: Date;
}

export class VerificationCheckDto {
  @ApiProperty({ description: 'Check success status' })
  @IsBoolean()
  success!: boolean;

  @ApiProperty({ description: 'Type of verification check' })
  @IsString()
  verificationType!: string;

  @ApiProperty({ description: 'Check details' })
  details!: Record<string, any>;

  @ApiProperty({ description: 'Issues found during check' })
  @IsArray()
  issues!: string[];

  @ApiProperty({ description: 'Check timestamp' })
  timestamp!: Date;

  @ApiPropertyOptional({ description: 'Response time for this check' })
  @IsOptional()
  responseTime?: number;
}