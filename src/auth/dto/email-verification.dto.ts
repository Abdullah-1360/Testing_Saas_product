import { IsEmail, IsString, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SendVerificationEmailDto {
  @ApiProperty({ 
    description: 'Email address to send verification to',
    example: 'user@example.com'
  })
  @IsEmail()
  email!: string;
}

export class VerifyEmailDto {
  @ApiProperty({ 
    description: 'Email verification token',
    example: 'abc123def456'
  })
  @IsString()
  token!: string;
}

export class ResendVerificationDto {
  @ApiProperty({ 
    description: 'Email address to resend verification to',
    example: 'user@example.com'
  })
  @IsEmail()
  email!: string;
}