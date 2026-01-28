import { IsEmail, IsString, MinLength, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class PasswordResetRequestDto {
  @ApiProperty({ 
    description: 'Email address to send password reset link to',
    example: 'user@example.com'
  })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  email!: string;
}

export class PasswordResetConfirmDto {
  @ApiProperty({ 
    description: 'Password reset token from email',
    example: 'abc123def456...'
  })
  @IsString()
  token!: string;

  @ApiProperty({ 
    description: 'New password (minimum 12 characters with complexity requirements)',
    example: 'NewSecurePassword123!'
  })
  @IsString()
  @MinLength(12, { message: 'Password must be at least 12 characters long' })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/, {
    message: 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'
  })
  newPassword!: string;

  @ApiProperty({ 
    description: 'Confirm new password',
    example: 'NewSecurePassword123!'
  })
  @IsString()
  confirmPassword!: string;
}

export class ChangePasswordDto {
  @ApiProperty({ 
    description: 'Current password',
    example: 'CurrentPassword123!'
  })
  @IsString()
  currentPassword!: string;

  @ApiProperty({ 
    description: 'New password (minimum 12 characters with complexity requirements)',
    example: 'NewSecurePassword123!'
  })
  @IsString()
  @MinLength(12, { message: 'Password must be at least 12 characters long' })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/, {
    message: 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'
  })
  newPassword!: string;

  @ApiProperty({ 
    description: 'Confirm new password',
    example: 'NewSecurePassword123!'
  })
  @IsString()
  confirmPassword!: string;
}