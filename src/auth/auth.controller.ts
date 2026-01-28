import {
  Controller,
  Post,
  Body,
  UseGuards,
  Request,
  Get,
  HttpCode,
  HttpStatus,
  Put,
  Delete,
  Param,
  Query,
  Ip,
  Headers,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { Request as ExpressRequest } from 'express';
import { AuthService } from './services/auth.service';
import { EmailService } from './services/email.service';
import { SessionService } from './services/session.service';
import { LoginDto } from './dto/login.dto';
import { SetupMfaDto } from './dto/setup-mfa.dto';
import { PasswordResetRequestDto, PasswordResetConfirmDto, ChangePasswordDto } from './dto/password-reset.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RevokeSessionDto } from './dto/session.dto';
import { SmtpConfigDto, TestEmailDto } from './dto/smtp-config.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { PermissionsGuard } from './guards/permissions.guard';
import { EnhancedRateLimitGuard, RateLimit } from '@/common/guards/enhanced-rate-limit.guard';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { RequirePermission } from './decorators/permissions.decorator';
import { User } from '@/users/entities/user.entity';
import { ApiResponseService } from '@/common/services/api-response.service';
import { SkipTransform } from '@/common/decorators/skip-transform.decorator';

@ApiTags('auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly emailService: EmailService,
    private readonly sessionService: SessionService,
    private readonly apiResponseService: ApiResponseService
  ) {}

  @Public()
  @UseGuards(EnhancedRateLimitGuard)
  @RateLimit({
    anonymous: { windowMs: 60000, maxRequests: 5 }, // 5 login attempts per minute for anonymous users
    ['VIEWER']: { windowMs: 60000, maxRequests: 10 },
    ['ENGINEER']: { windowMs: 60000, maxRequests: 20 },
    ['ADMIN']: { windowMs: 60000, maxRequests: 50 },
    ['SUPER_ADMIN']: { windowMs: 60000, maxRequests: 100 },
  })
  @SkipTransform()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'User login' })
  @ApiResponse({ 
    status: 200, 
    description: 'Login successful',
    schema: {
      type: 'object',
      properties: {
        token: { type: 'string' },
        refreshToken: { type: 'string' },
        user: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            email: { type: 'string' },
            username: { type: 'string' },
            role: { type: 'object' },
            mfaEnabled: { type: 'boolean' },
          },
        },
        requiresMfa: { type: 'boolean' },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  @ApiResponse({ status: 423, description: 'Account locked' })
  @ApiResponse({ status: 429, description: 'Too many login attempts' })
  async login(
    @Body() loginDto: LoginDto,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent: string,
    @Headers('x-device-fingerprint') deviceFingerprint?: string,
  ) {
    const result = await this.authService.login(loginDto, ipAddress, userAgent, deviceFingerprint);
    
    // Return format expected by frontend
    return {
      token: result.access_token,
      refreshToken: result.refresh_token,
      user: result.user,
      requiresMfa: result.mfaRequired || false,
      sessionId: result.sessionId,
    };
  }

  @Public()
  @UseGuards(EnhancedRateLimitGuard)
  @RateLimit({
    anonymous: { windowMs: 300000, maxRequests: 5 }, // 5 verification attempts per 5 minutes
  })
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify email address' })
  @ApiResponse({ status: 200, description: 'Email verified successfully' })
  @ApiResponse({ status: 400, description: 'Invalid or expired token' })
  @ApiResponse({ status: 429, description: 'Too many verification attempts' })
  async verifyEmail(@Body() body: { token: string }) {
    await this.authService.verifyEmail(body.token);
    return this.apiResponseService.success('Email verified successfully');
  }

  @Public()
  @UseGuards(EnhancedRateLimitGuard)
  @RateLimit({
    anonymous: { windowMs: 300000, maxRequests: 3 }, // 3 resend requests per 5 minutes
  })
  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resend email verification' })
  @ApiResponse({ status: 200, description: 'Verification email sent' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiResponse({ status: 429, description: 'Too many resend requests' })
  async resendVerification(@Body() body: { email: string }) {
    await this.authService.resendEmailVerification(body.email);
    return this.apiResponseService.success('Verification email sent');
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'User logout' })
  @ApiResponse({ 
    status: 200, 
    description: 'Logout successful',
  })
  async logout(
    @Request() req: ExpressRequest & { user: User },
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent: string,
  ) {
    const sessionId = (req.user as any).sessionId; // From JWT payload
    await this.authService.logout(req.user.id, sessionId, ipAddress, userAgent);
    
    return this.apiResponseService.createResponse(
      null,
      'Logged out successfully',
      HttpStatus.OK
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Logout from all devices' })
  @ApiResponse({ 
    status: 200, 
    description: 'Logged out from all devices successfully',
  })
  async logoutAll(
    @Request() req: ExpressRequest & { user: User },
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent: string,
  ) {
    const sessionId = (req.user as any).sessionId; // From JWT payload
    const revokedCount = await this.authService.logoutAll(req.user.id, sessionId, ipAddress, userAgent);
    
    return this.apiResponseService.createResponse(
      { revokedCount },
      `Logged out from ${revokedCount} other devices`,
      HttpStatus.OK
    );
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token' })
  @ApiResponse({ 
    status: 200, 
    description: 'Token refreshed successfully',
    schema: {
      type: 'object',
      properties: {
        token: { type: 'string' },
        refreshToken: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Invalid or expired refresh token' })
  async refreshToken(@Body() refreshTokenDto: RefreshTokenDto) {
    const result = await this.authService.refreshToken(refreshTokenDto);
    
    return {
      token: result.access_token,
      refreshToken: result.refresh_token,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Post('password/change')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Change password' })
  @ApiResponse({ status: 200, description: 'Password changed successfully' })
  @ApiResponse({ status: 400, description: 'Password policy violation or passwords do not match' })
  @ApiResponse({ status: 401, description: 'Current password is incorrect' })
  async changePassword(
    @CurrentUser() user: User,
    @Body() changePasswordDto: ChangePasswordDto,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent: string,
  ) {
    await this.authService.changePassword(user.id, changePasswordDto, ipAddress, userAgent);
    return this.apiResponseService.createResponse(
      null,
      'Password changed successfully',
      HttpStatus.OK
    );
  }

  @Public()
  @UseGuards(EnhancedRateLimitGuard)
  @RateLimit({
    anonymous: { windowMs: 300000, maxRequests: 3 }, // 3 password reset requests per 5 minutes
    ['VIEWER']: { windowMs: 300000, maxRequests: 5 },
    ['ENGINEER']: { windowMs: 300000, maxRequests: 10 },
    ['ADMIN']: { windowMs: 300000, maxRequests: 20 },
    ['SUPER_ADMIN']: { windowMs: 300000, maxRequests: 50 },
  })
  @Post('password/reset/request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request password reset' })
  @ApiResponse({ status: 200, description: 'Password reset email sent if account exists' })
  @ApiResponse({ status: 429, description: 'Too many password reset requests' })
  async requestPasswordReset(
    @Body() requestDto: PasswordResetRequestDto,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent: string,
  ) {
    const result = await this.authService.requestPasswordReset(requestDto, ipAddress, userAgent);
    return result;
  }

  @Public()
  @Post('password/reset/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm password reset' })
  @ApiResponse({ status: 200, description: 'Password reset successfully' })
  @ApiResponse({ status: 400, description: 'Invalid or expired token' })
  async confirmPasswordReset(
    @Body() confirmDto: PasswordResetConfirmDto,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent: string,
  ) {
    const result = await this.authService.confirmPasswordReset(confirmDto, ipAddress, userAgent);
    return result;
  }

  @UseGuards(JwtAuthGuard)
  @Post('mfa/setup')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Setup MFA' })
  @ApiResponse({ 
    status: 200, 
    description: 'MFA setup initiated',
    schema: {
      type: 'object',
      properties: {
        secret: { type: 'string' },
        qrCode: { type: 'string' },
        backupCodes: { type: 'array', items: { type: 'string' } },
      },
    },
  })
  @ApiResponse({ status: 409, description: 'MFA already enabled' })
  async setupMfa(@CurrentUser() user: User) {
    const result = await this.authService.setupMfa(user.id);
    return this.apiResponseService.createResponse(
      result,
      'MFA setup initiated',
      HttpStatus.OK
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post('mfa/verify')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Verify and enable MFA' })
  @ApiResponse({ status: 200, description: 'MFA enabled successfully' })
  @ApiResponse({ status: 400, description: 'Invalid MFA token' })
  @ApiResponse({ status: 409, description: 'MFA already enabled' })
  async verifyMfa(
    @CurrentUser() user: User,
    @Body() setupMfaDto: SetupMfaDto,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent: string,
  ) {
    await this.authService.enableMfa(user.id, setupMfaDto, ipAddress, userAgent);
    return this.apiResponseService.createResponse(
      null,
      'MFA enabled successfully',
      HttpStatus.OK
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post('mfa/disable')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Disable MFA' })
  @ApiResponse({ status: 200, description: 'MFA disabled successfully' })
  @ApiResponse({ status: 400, description: 'MFA not enabled or invalid token' })
  @ApiResponse({ status: 401, description: 'Invalid password or MFA token' })
  async disableMfa(
    @CurrentUser() user: User,
    @Body() body: { currentPassword: string; mfaToken: string },
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent: string,
  ) {
    await this.authService.disableMfa(
      user.id,
      body.currentPassword,
      body.mfaToken,
      ipAddress,
      userAgent,
    );
    return this.apiResponseService.createResponse(
      null,
      'MFA disabled successfully',
      HttpStatus.OK
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post('mfa/backup-codes/regenerate')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Regenerate MFA backup codes' })
  @ApiResponse({ 
    status: 200, 
    description: 'Backup codes regenerated',
    schema: {
      type: 'object',
      properties: {
        backupCodes: { type: 'array', items: { type: 'string' } },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'MFA not enabled' })
  async regenerateBackupCodes(
    @CurrentUser() user: User,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent: string,
  ) {
    const backupCodes = await this.authService.regenerateBackupCodes(user.id, ipAddress, userAgent);
    return this.apiResponseService.createResponse(
      { backupCodes },
      'Backup codes regenerated',
      HttpStatus.OK
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('sessions')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get user active sessions' })
  @ApiResponse({ status: 200, description: 'Active sessions retrieved' })
  async getSessions(@CurrentUser() user: User, @Request() req: ExpressRequest) {
    const currentSessionId = (req.user as any).sessionId;
    const sessions = await this.sessionService.getUserSessions(user.id, currentSessionId);
    return this.apiResponseService.createResponse(
      sessions,
      'Active sessions retrieved',
      HttpStatus.OK
    );
  }

  @UseGuards(JwtAuthGuard)
  @Delete('sessions/:sessionId')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Revoke a session' })
  @ApiResponse({ status: 200, description: 'Session revoked successfully' })
  @ApiResponse({ status: 404, description: 'Session not found' })
  async revokeSession(
    @CurrentUser() user: User,
    @Param('sessionId') sessionId: string,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent: string,
  ) {
    await this.sessionService.revokeSession(sessionId, user.id, ipAddress, userAgent);
    return this.apiResponseService.createResponse(
      null,
      'Session revoked successfully',
      HttpStatus.OK
    );
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('settings', 'read')
  @Get('settings/smtp')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get SMTP configuration' })
  @ApiResponse({ status: 200, description: 'SMTP configuration retrieved' })
  async getSmtpConfig() {
    const config = await this.emailService.getSmtpConfig();
    return this.apiResponseService.createResponse(
      config,
      'SMTP configuration retrieved',
      HttpStatus.OK
    );
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('settings', 'update')
  @Put('settings/smtp')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Update SMTP configuration' })
  @ApiResponse({ status: 200, description: 'SMTP configuration updated' })
  async updateSmtpConfig(@Body() configDto: SmtpConfigDto) {
    await this.emailService.saveSmtpConfig(configDto);
    return this.apiResponseService.createResponse(
      null,
      'SMTP configuration updated',
      HttpStatus.OK
    );
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('settings', 'update')
  @Post('settings/smtp/test')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Test SMTP configuration' })
  @ApiResponse({ status: 200, description: 'Test email sent successfully' })
  @ApiResponse({ status: 400, description: 'Email configuration error' })
  async testSmtpConfig(@Body() testDto: TestEmailDto) {
    await this.emailService.testEmailConfig(testDto.testEmail);
    return this.apiResponseService.createResponse(
      null,
      'Test email sent successfully',
      HttpStatus.OK
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({ status: 200, description: 'User profile retrieved' })
  async getProfile(@CurrentUser() user: User) {
    return this.apiResponseService.createResponse(
      user.toSafeObject(),
      'User profile retrieved',
      HttpStatus.OK
    );
  }
}