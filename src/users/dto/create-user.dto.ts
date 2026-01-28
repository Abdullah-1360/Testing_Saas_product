import { 
  IsEmail, 
  IsString, 
  MinLength, 
  IsOptional, 
  IsUUID,
  Matches,
  MaxLength,
  IsBoolean
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateUserDto {
  @ApiProperty({ 
    description: 'User email address',
    example: 'user@example.com'
  })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  email!: string;

  @ApiProperty({ 
    description: 'Username (3-50 characters, alphanumeric and underscores only)',
    example: 'john_doe'
  })
  @IsString()
  @MinLength(3, { message: 'Username must be at least 3 characters long' })
  @MaxLength(50, { message: 'Username must not exceed 50 characters' })
  @Matches(/^[a-zA-Z0-9_]+$/, { 
    message: 'Username can only contain letters, numbers, and underscores' 
  })
  username!: string;

  @ApiProperty({ 
    description: 'Password (minimum 12 characters with complexity requirements)',
    example: 'SecurePassword123!'
  })
  @IsString()
  @MinLength(12, { message: 'Password must be at least 12 characters long' })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/, {
    message: 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'
  })
  password!: string;

  @ApiPropertyOptional({ 
    description: 'User first name',
    example: 'John'
  })
  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'First name must not exceed 100 characters' })
  firstName?: string;

  @ApiPropertyOptional({ 
    description: 'User last name',
    example: 'Doe'
  })
  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'Last name must not exceed 100 characters' })
  lastName?: string;

  @ApiProperty({ 
    description: 'Role ID to assign to the user',
    example: 'role_admin'
  })
  @IsUUID(4, { message: 'Role ID must be a valid UUID' })
  roleId!: string;

  @ApiPropertyOptional({ 
    description: 'Whether user must change password on first login',
    example: true,
    default: true
  })
  @IsOptional()
  @IsBoolean()
  mustChangePassword?: boolean;

  @ApiPropertyOptional({ 
    description: 'Avatar URL for the user',
    example: 'https://example.com/avatar.jpg'
  })
  @IsOptional()
  @IsString()
  avatarUrl?: string;
}