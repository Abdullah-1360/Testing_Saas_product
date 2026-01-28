import { IsString, IsInt, IsBoolean, IsOptional, Min, Max, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateRetentionPolicyDto {
  @ApiProperty({
    description: 'Unique name for the retention policy',
    example: 'default-incident-retention',
    minLength: 1,
    maxLength: 100,
  })
  @IsString()
  @Length(1, 100)
  policyName!: string;

  @ApiProperty({
    description: 'Number of days to retain data (1-7 days maximum)',
    example: 3,
    minimum: 1,
    maximum: 7,
  })
  @IsInt()
  @Min(1)
  @Max(7)
  retentionDays!: number;

  @ApiProperty({
    description: 'What type of data this policy applies to',
    example: 'incidents',
    enum: ['incidents', 'commands', 'evidence', 'backups', 'all'],
  })
  @IsString()
  appliesTo!: string;

  @ApiProperty({
    description: 'Whether this policy is active',
    example: true,
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean = true;
}