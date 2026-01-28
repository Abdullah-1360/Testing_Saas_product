import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '@/users/users.service';
import { MfaService } from './mfa.service';
import { PasswordService } from './password.service';
import { EmailService } from './email.service';
import { AccountLockoutService } from './account-lockout.service';
import { SessionService } from './session.service';
import { PrismaService } from '@/database/prisma.service';
import { AuditService } from '@/audit/audit.service';
import { LoginDto } from '../dto/login.dto';
import { SetupMfaDto } from '../dto/setup-mfa.dto';
import { PasswordResetRequestDto, PasswordResetConfirmDto, ChangePasswordDto } from '../dto/password-reset.dto';
import { RefreshTokenDto } from '../dto/refresh-token.dto';
import { JwtPayload } from '../interfaces/jwt-payload.interface';
import { AuthResponse, MfaSetupResponse, RefreshTokenResponse, PasswordResetResponse } from '../interfaces/auth-response.interface';
import { User } from '@/users/entities/user.entity';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly mfaService: MfaService,
    private readonly passwordService: PasswordService,
    private readonly emailService: EmailService,
    private readonly accountLockoutService: AccountLockoutService,
    private readonly sessionService: SessionService,
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async validateUser(email: string, password: string): Promise<User | null> {
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      return null;
    }

    const isPasswordValid = await this.usersService.validatePassword(user, password);
    if (!isPasswordValid) {
      return null;
    }

    return user;
  }

  async login(
    loginDto: LoginDto,
    ipAddress?: string,
    userAgent?: string,
    deviceFingerprint?: string,
  ): Promise<AuthResponse> {
    const { email, password, mfaToken } = loginDto;

    // Find user by email
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      // Create audit log for failed attempt
      await this.auditService.createAuditEvent({
        action: 'login_failed',
        resource: 'user',
        details: {
          email,
          reason: 'user_not_found',
        },
        ipAddress,
        userAgent,
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    // Check if account is locked
    const lockStatus = await this.accountLockoutService.isAccountLocked(user.id);
    if (lockStatus.isLocked) {
      await this.auditService.createAuditEvent({
        userId: user.id,
        action: 'login_blocked',
        resource: 'user',
        resourceId: user.id,
        details: {
          email: user.email,
          username: user.username,
          reason: 'account_locked',
          lockoutUntil: lockStatus.lockoutUntil?.toISOString(),
        },
        ipAddress,
        userAgent,
      });
      throw new UnauthorizedException('Account is locked. Please try again later.');
    }

    // Check if account is active
    if (!user.isActive) {
      await this.auditService.createAuditEvent({
        userId: user.id,
        action: 'login_blocked',
        resource: 'user',
        resourceId: user.id,
        details: {
          email: user.email,
          username: user.username,
          reason: 'account_inactive',
        },
        ipAddress,
        userAgent,
      });
      throw new UnauthorizedException('Account is not active');
    }

    // Validate password
    const isPasswordValid = await this.usersService.validatePassword(user, password);
    if (!isPasswordValid) {
      // Record failed attempt
      await this.accountLockoutService.recordFailedAttempt(user.id, ipAddress, userAgent);
      
      await this.auditService.createAuditEvent({
        userId: user.id,
        action: 'login_failed',
        resource: 'user',
        resourceId: user.id,
        details: {
          email: user.email,
          username: user.username,
          reason: 'invalid_password',
        },
        ipAddress,
        userAgent,
      });
      
      throw new UnauthorizedException('Invalid credentials');
    }

    // Check if MFA is enabled
    if (user.mfaEnabled && user.mfaSecret) {
      if (!mfaToken) {
        return {
          access_token: '',
          refresh_token: '',
          user: user.toSafeObject(),
          mfaRequired: true,
        };
      }

      // Verify MFA token (could be TOTP or backup code)
      const isMfaValid = await this.verifyMfaToken(user, mfaToken);
      if (!isMfaValid) {
        await this.auditService.createAuditEvent({
          userId: user.id,
          action: 'login_failed',
          resource: 'user',
          resourceId: user.id,
          details: {
            email: user.email,
            username: user.username,
            reason: 'invalid_mfa_token',
          },
          ipAddress,
          userAgent,
        });
        
        throw new UnauthorizedException('Invalid MFA token');
      }
    }

    // Reset failed login attempts on successful login
    await this.accountLockoutService.resetFailedAttempts(user.id);

    // Update last login info
    await this.usersService.updateLastLogin(user.id, ipAddress);

    // Create session and generate tokens
    const sessionData = await this.sessionService.createSession(
      user.id,
      ipAddress || '127.0.0.1',
      userAgent || 'Unknown',
      deviceFingerprint,
    );

    // Create audit log for successful login
    await this.auditService.createAuditEvent({
      userId: user.id,
      action: 'login_successful',
      resource: 'user',
      resourceId: user.id,
      details: {
        email: user.email,
        username: user.username,
        sessionId: sessionData.sessionId,
        mfaUsed: user.mfaEnabled,
      },
      ipAddress,
      userAgent,
    });

    return {
      access_token: sessionData.accessToken,
      refresh_token: sessionData.refreshToken,
      user: user.toSafeObject(),
      sessionId: sessionData.sessionId,
    };
  }

  async logout(
    userId: string,
    sessionId: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<void> {
    await this.sessionService.revokeSession(sessionId, userId, ipAddress, userAgent);
  }

  async logoutAll(
    userId: string,
    currentSessionId?: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<number> {
    return await this.sessionService.revokeAllUserSessions(
      userId,
      userId,
      currentSessionId,
      ipAddress,
      userAgent,
    );
  }

  async refreshToken(refreshTokenDto: RefreshTokenDto): Promise<RefreshTokenResponse> {
    const tokens = await this.sessionService.refreshToken(refreshTokenDto.refreshToken);
    return {
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
    };
  }

  async changePassword(
    userId: string,
    changePasswordDto: ChangePasswordDto,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<void> {
    await this.passwordService.changePassword(
      userId,
      changePasswordDto.currentPassword,
      changePasswordDto.newPassword,
      changePasswordDto.confirmPassword,
      ipAddress,
      userAgent,
    );
  }

  async requestPasswordReset(
    requestDto: PasswordResetRequestDto,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<PasswordResetResponse> {
    await this.passwordService.generatePasswordResetToken(
      requestDto.email,
      ipAddress,
      userAgent,
    );

    return {
      message: 'If an account with that email exists, a password reset link has been sent.',
      success: true,
    };
  }

  async confirmPasswordReset(
    confirmDto: PasswordResetConfirmDto,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<PasswordResetResponse> {
    await this.passwordService.confirmPasswordReset(
      confirmDto.token,
      confirmDto.newPassword,
      confirmDto.confirmPassword,
      ipAddress,
      userAgent,
    );

    return {
      message: 'Password has been reset successfully.',
      success: true,
    };
  }

  async setupMfa(userId: string): Promise<MfaSetupResponse> {
    const user = await this.usersService.findOne(userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    if (user.mfaEnabled) {
      throw new ConflictException('MFA is already enabled');
    }

    const secret = this.mfaService.generateSecret();
    const qrCode = await this.mfaService.generateQRCode(user.email, secret);
    const backupCodes = this.mfaService.generateBackupCodes();

    // Store the secret and backup codes temporarily (not enabled yet)
    await this.usersService.storeMfaSetup(userId, secret, backupCodes);

    return {
      secret,
      qrCode,
      backupCodes,
    };
  }

  async enableMfa(
    userId: string,
    setupMfaDto: SetupMfaDto,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<void> {
    const user = await this.usersService.findOne(userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    if (user.mfaEnabled) {
      throw new ConflictException('MFA is already enabled');
    }

    // Verify the TOTP token
    const isValid = this.mfaService.verifyToken(user.mfaSecret!, setupMfaDto.token);
    if (!isValid) {
      throw new BadRequestException('Invalid MFA token');
    }

    // Enable MFA
    await this.usersService.enableMfa(userId);

    // Send email notification
    try {
      await this.emailService.sendMfaEnabledEmail(user.email, user.username);
    } catch (error) {
      this.logger.warn(`Failed to send MFA enabled email to ${user.email}:`, error);
    }

    // Create audit log
    await this.auditService.createAuditEvent({
      userId,
      action: 'mfa_enabled',
      resource: 'user',
      resourceId: userId,
      details: {
        email: user.email,
        username: user.username,
      },
      ipAddress,
      userAgent,
    });
  }

  async disableMfa(
    userId: string,
    currentPassword: string,
    mfaToken: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<void> {
    const user = await this.usersService.findOne(userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    if (!user.mfaEnabled) {
      throw new BadRequestException('MFA is not enabled');
    }

    // Verify password
    const isPasswordValid = await this.usersService.validatePassword(user, currentPassword);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid password');
    }

    // Verify MFA token (TOTP or backup code)
    const isMfaValid = await this.verifyMfaToken(user, mfaToken);
    if (!isMfaValid) {
      throw new UnauthorizedException('Invalid MFA token');
    }

    // Disable MFA
    await this.usersService.disableMfa(userId);

    // Send email notification
    try {
      await this.emailService.sendMfaDisabledEmail(user.email, user.username);
    } catch (error) {
      this.logger.warn(`Failed to send MFA disabled email to ${user.email}:`, error);
    }

    // Create audit log
    await this.auditService.createAuditEvent({
      userId,
      action: 'mfa_disabled',
      resource: 'user',
      resourceId: userId,
      details: {
        email: user.email,
        username: user.username,
      },
      ipAddress,
      userAgent,
    });
  }

  async regenerateBackupCodes(
    userId: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<string[]> {
    const user = await this.usersService.findOne(userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    if (!user.mfaEnabled) {
      throw new BadRequestException('MFA is not enabled');
    }

    const newBackupCodes = this.mfaService.generateBackupCodes();
    await this.usersService.updateBackupCodes(userId, newBackupCodes);

    // Create audit log
    await this.auditService.createAuditEvent({
      userId,
      action: 'backup_codes_regenerated',
      resource: 'user',
      resourceId: userId,
      details: {
        email: user.email,
        username: user.username,
      },
      ipAddress,
      userAgent,
    });

    return newBackupCodes;
  }

  async verifyEmail(token: string): Promise<void> {
    const crypto = await import('crypto');
    
    // Hash the token to match stored hash
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // Find verification record
    const verification = await this.prisma.emailVerification.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!verification) {
      throw new BadRequestException('Invalid verification token');
    }

    if (verification.expiresAt < new Date()) {
      throw new BadRequestException('Verification token has expired');
    }

    if (verification.verifiedAt) {
      throw new BadRequestException('Email already verified');
    }

    // Mark email as verified
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: verification.userId },
        data: {
          emailVerified: true,
          emailVerifiedAt: new Date(),
        },
      }),
      this.prisma.emailVerification.update({
        where: { id: verification.id },
        data: {
          verifiedAt: new Date(),
        },
      }),
    ]);

    // Create audit log
    await this.auditService.createAuditEvent({
      userId: verification.userId,
      action: 'email_verified',
      resource: 'user',
      resourceId: verification.userId,
      details: {
        email: verification.user.email,
        username: verification.user.username,
      },
    });
  }

  async resendEmailVerification(email: string): Promise<void> {
    const crypto = await import('crypto');
    
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      // Don't reveal if email exists
      return;
    }

    if (user.emailVerified) {
      throw new BadRequestException('Email is already verified');
    }

    // Generate new verification token
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    // Delete existing verification record and create new one
    await this.prisma.$transaction([
      this.prisma.emailVerification.deleteMany({
        where: { userId: user.id },
      }),
      this.prisma.emailVerification.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt,
          attempts: 0,
        },
      }),
    ]);

    // Send verification email
    try {
      await this.emailService.sendEmailVerification(user.email, user.username, token);
    } catch (error) {
      this.logger.warn(`Failed to send verification email to ${user.email}:`, error);
    }

    // Create audit log
    await this.auditService.createAuditEvent({
      userId: user.id,
      action: 'email_verification_resent',
      resource: 'user',
      resourceId: user.id,
      details: {
        email: user.email,
        username: user.username,
      },
    });
  }

  private async verifyMfaToken(user: User, token: string): Promise<boolean> {
    // Try TOTP first
    if (user.mfaSecret) {
      const isTotpValid = this.mfaService.verifyToken(user.mfaSecret, token);
      if (isTotpValid) {
        return true;
      }
    }

    // Try backup codes
    if (user.mfaBackupCodes && user.mfaBackupCodes.length > 0) {
      const isBackupCodeValid = await this.mfaService.validateBackupCode(user.id, token);
      if (isBackupCodeValid) {
        // Check if running low on backup codes
        const updatedUser = await this.usersService.findOne(user.id);
        if (updatedUser && updatedUser.mfaBackupCodes && updatedUser.mfaBackupCodes.length < 3) {
          try {
            await this.emailService.sendBackupCodeWarningEmail(
              updatedUser.email,
              updatedUser.username,
              updatedUser.mfaBackupCodes.length,
            );
          } catch (error) {
            this.logger.warn(`Failed to send backup code warning email to ${updatedUser.email}:`, error);
          }
        }
        return true;
      }
    }

    return false;
  }

  async validateJwtPayload(payload: JwtPayload): Promise<User> {
    const user = await this.usersService.findOne(payload.sub);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    if (!user.isActive || user.isLocked) {
      throw new UnauthorizedException('User account is not active');
    }

    return user;
  }

  async validateSession(accessToken: string): Promise<User> {
    return await this.sessionService.validateSession(accessToken);
  }

  async cleanupExpiredSessions(): Promise<number> {
    return await this.sessionService.cleanupExpiredSessions();
  }
}