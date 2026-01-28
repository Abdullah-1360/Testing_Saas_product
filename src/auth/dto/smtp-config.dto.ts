import { IsString, IsNumber, IsBoolean, IsEmail, IsOptional, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SmtpConfigDto {
  @ApiProperty({ 
    description: 'SMTP server hostname',
    example: 'smtp.gmail.com'
  })
  @IsString()
  host!: string;

  @ApiProperty({ 
    description: 'SMTP server port',
    example: 587
  })
  @IsNumber()
  @Min(1)
  @Max(65535)
  port!: number;

  @ApiProperty({ 
    description: 'SMTP username',
    example: 'your-email@gmail.com'
  })
  @IsString()
  username!: string;

  @ApiProperty({ 
    description: 'SMTP password',
    example: 'your-app-password'
  })
  @IsString()
  password!: string;

  @ApiProperty({ 
    description: 'From email address',
    example: 'noreply@wp-autohealer.com'
  })
  @IsEmail()
  fromAddress!: string;

  @ApiProperty({ 
    description: 'From name',
    example: 'WP-AutoHealer'
  })
  @IsString()
  fromName!: string;

  @ApiPropertyOptional({ 
    description: 'Use TLS encryption',
    example: true,
    default: true
  })
  @IsOptional()
  @IsBoolean()
  useTls?: boolean;

  @ApiPropertyOptional({ 
    description: 'Whether this configuration is active',
    example: true,
    default: true
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class TestEmailDto {
  @ApiProperty({ 
    description: 'Email address to send test email to',
    example: 'admin@example.com'
  })
  @IsEmail()
  testEmail!: string;
}