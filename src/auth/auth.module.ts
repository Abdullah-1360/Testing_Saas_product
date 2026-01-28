import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { UsersModule } from '@/users/users.module';
import { DatabaseModule } from '@/database/database.module';
import { CommonModule } from '@/common/common.module';
import { AuditModule } from '@/audit/audit.module';
import { AuthService } from './services/auth.service';
import { MfaService } from './services/mfa.service';
import { PasswordService } from './services/password.service';
import { EmailService } from './services/email.service';
import { AccountLockoutService } from './services/account-lockout.service';
import { SessionService } from './services/session.service';
import { SessionCleanupService } from './services/session-cleanup.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { LocalStrategy } from './strategies/local.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { PermissionsGuard } from './guards/permissions.guard';

@Module({
  imports: [
    UsersModule,
    DatabaseModule,
    CommonModule,
    AuditModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        const secret = configService.get<string>('JWT_SECRET');
        if (!secret) {
          throw new Error('JWT_SECRET is required');
        }
        return {
          secret,
          signOptions: {
            expiresIn: configService.get<string>('JWT_EXPIRES_IN', '24h'),
          },
        };
      },
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    MfaService,
    PasswordService,
    EmailService,
    AccountLockoutService,
    SessionService,
    SessionCleanupService,
    JwtStrategy,
    LocalStrategy,
    JwtAuthGuard,
    RolesGuard,
    PermissionsGuard,
  ],
  exports: [
    AuthService,
    MfaService,
    PasswordService,
    EmailService,
    AccountLockoutService,
    SessionService,
    JwtAuthGuard,
    RolesGuard,
    PermissionsGuard,
  ],
})
export class AuthModule {}