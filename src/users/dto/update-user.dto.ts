import { PartialType, OmitType } from '@nestjs/mapped-types';
import { IsOptional, IsBoolean, IsString, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { CreateUserDto } from './create-user.dto';

export class UpdateUserDto extends PartialType(
  OmitType(CreateUserDto, ['password'] as const)
) {
  @ApiPropertyOptional({ 
    description: 'Whether MFA is enabled for the user',
    example: true
  })
  @IsOptional()
  @IsBoolean()
  mfaEnabled?: boolean;

  @ApiPropertyOptional({ 
    description: 'Whether the user account is active',
    example: true
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ 
    description: 'Whether the user account is locked',
    example: false
  })
  @IsOptional()
  @IsBoolean()
  isLocked?: boolean;

  @ApiPropertyOptional({ 
    description: 'Whether user must change password on next login',
    example: false
  })
  @IsOptional()
  @IsBoolean()
  mustChangePassword?: boolean;
}

export class ChangePasswordDto {
  @ApiPropertyOptional({ 
    description: 'Current password (required for user-initiated changes)',
    example: 'CurrentPassword123!'
  })
  @IsOptional()
  @IsString()
  currentPassword?: string;

  @ApiPropertyOptional({ 
    description: 'New password',
    example: 'NewSecurePassword123!'
  })
  @IsString()
  newPassword!: string;

  @ApiPropertyOptional({ 
    description: 'Confirm new password',
    example: 'NewSecurePassword123!'
  })
  @IsString()
  confirmPassword!: string;
}

export class AssignRoleDto {
  @ApiPropertyOptional({ 
    description: 'Role ID to assign to the user',
    example: 'role_admin'
  })
  @IsUUID(4, { message: 'Role ID must be a valid UUID' })
  roleId!: string;
}