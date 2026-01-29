import { IsString, IsUUID, IsNotEmpty, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class EmergencyMfaDisableDto {
  @ApiProperty({
    description: 'ID of the user whose MFA should be disabled',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID('4', { message: 'Target user ID must be a valid UUID' })
  @IsNotEmpty()
  targetUserId: string;

  @ApiProperty({
    description: 'Reason for emergency MFA disable',
    example: 'User lost access to MFA device',
    maxLength: 500,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500, { message: 'Reason must not exceed 500 characters' })
  reason: string;
}