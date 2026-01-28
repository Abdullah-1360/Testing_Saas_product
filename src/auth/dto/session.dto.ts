import { IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RevokeSessionDto {
  @ApiProperty({ 
    description: 'Session ID to revoke',
    example: '123e4567-e89b-12d3-a456-426614174000'
  })
  @IsUUID(4, { message: 'Session ID must be a valid UUID' })
  sessionId!: string;
}

export class SessionResponseDto {
  @ApiProperty({ description: 'Session ID' })
  id!: string;

  @ApiProperty({ description: 'IP address of the session' })
  ipAddress!: string;

  @ApiProperty({ description: 'User agent string' })
  userAgent!: string;

  @ApiProperty({ description: 'Device fingerprint', required: false })
  deviceFingerprint?: string;

  @ApiProperty({ description: 'Session creation time' })
  createdAt!: Date;

  @ApiProperty({ description: 'Last activity time' })
  lastActivityAt!: Date;

  @ApiProperty({ description: 'Session expiration time' })
  expiresAt!: Date;

  @ApiProperty({ description: 'Whether this is the current session' })
  isCurrent!: boolean;
}