import { IsString, IsInt, IsBoolean, IsOptional, Min, Max } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AnonymizationDto {
  @ApiProperty({
    description: 'Number of days to retain data before anonymization (1-7 days maximum)',
    example: 5,
    minimum: 1,
    maximum: 7,
  })
  @IsInt()
  @Min(1)
  @Max(7)
  retentionDays!: number;

  @ApiProperty({
    description: 'Specific table to anonymize (optional, defaults to all applicable tables)',
    example: 'audit_events',
    required: false,
  })
  @IsOptional()
  @IsString()
  tableName?: string;

  @ApiProperty({
    description: 'Whether to perform a dry run (no actual anonymization)',
    example: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean = false;

  @ApiProperty({
    description: 'Whether to anonymize personal data (emails, IP addresses, etc.)',
    example: true,
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  anonymizePersonalData?: boolean = true;

  @ApiProperty({
    description: 'Whether to anonymize credentials and secrets',
    example: true,
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  anonymizeCredentials?: boolean = true;

  @ApiProperty({
    description: 'Whether to anonymize IP addresses',
    example: true,
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  anonymizeIpAddresses?: boolean = true;
}