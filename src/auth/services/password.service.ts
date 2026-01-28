import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { AuditService } from '@/audit/audit.service';
import { EncryptionService } from '@/common/services/encryption.service';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';

@Injectable()
export class PasswordService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly encryptionService: EncryptionService,
  ) {}

  /**
   * Validate password against policy requirements
   */
  validatePasswordPolicy(password: string): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (password.length < 12) {
      errors.push('Password must be at least 12 characters long');
    }

    if (!/[a-z]/.test(password)) {
      errors.push('Password must contain at least one lowercase letter');
    }

    if (!/[A-Z]/.test(password)) {
      errors.push('Password must contain at least one uppercase letter');
    }

    if (!/\d/.test(password)) {
      errors.push('Password must contain at least one number');
    }

    if (!/[@$!%*?&]/.test(password)) {
      errors.push('Password must contain at least one special character (@$!%*?&)');
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Check if password was used recently (password history)
   */
  async checkPasswordHistory(userId: string, newPassword: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHistory: true },
    });

    if (!user?.passwordHistory) return false;

    // Check against last 3 passwords
    for (const oldPasswordHash of user.passwordHistory.slice(-3)) {
      if (await bcrypt.compare(newPassword, oldPasswordHash)) {
        return true; // Password was used before
      }
    }

    return false;
  }

  /**
   * Add password to history
   */
  async addToPasswordHistory(userId: string, passwordHash: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHistory: true },
    });

    const history = user?.passwordHistory || [];
    history.push(passwordHash);

    // Keep only last 3 passwords
    const updatedHistory = history.slice(-3);

    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHistory: updatedHistory },
    });
  }

  /**
   * Change user password
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    confirmPassword: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<void> {
    // Validate new password matches confirmation
    if (newPassword !== confirmPassword) {
      throw new BadRequestException('New password and confirmation do not match');
    }

    // Validate password policy
    const policyCheck = this.validatePasswordPolicy(newPassword);
    if (!policyCheck.isValid) {
      throw new BadRequestException(`Password policy violation: ${policyCheck.errors.join(', ')}`);
    }

    // Get user with current password
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { 
        id: true, 
        email: true, 
        username: true,
        passwordHash: true,
        passwordHistory: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // Verify current password
    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isCurrentPasswordValid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    // Check if new password is same as current
    const isSamePassword = await bcrypt.compare(newPassword, user.passwordHash);
    if (isSamePassword) {
      throw new BadRequestException('New password must be different from current password');
    }

    // Check password history
    const isPasswordReused = await this.checkPasswordHistory(userId, newPassword);
    if (isPasswordReused) {
      throw new BadRequestException('Cannot reuse any of the last 3 passwords');
    }

    // Hash new password
    const newPasswordHash = await bcrypt.hash(newPassword, 12);

    // Update password and add to history
    await this.prisma.$transaction(async (tx) => {
      // Add current password to history
      await this.addToPasswordHistory(userId, user.passwordHash);

      // Update password
      await tx.user.update({
        where: { id: userId },
        data: {
          passwordHash: newPasswordHash,
          passwordChangedAt: new Date(),
          mustChangePassword: false,
        },
      });

      // Invalidate all other sessions (except current one would be handled by auth service)
      await tx.userSession.deleteMany({
        where: { 
          userId,
          // Keep current session if we have session info
        },
      });
    });

    // Create audit log
    await this.auditService.createAuditEvent({
      userId,
      action: 'password_changed',
      resource: 'user',
      resourceId: userId,
      details: {
        email: user.email,
        username: user.username,
        changedBy: 'user',
      },
      ipAddress,
      userAgent,
    });
  }

  /**
   * Generate password reset token
   */
  async generatePasswordResetToken(email: string, ipAddress?: string, userAgent?: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, username: true, isActive: true },
    });

    // Always return success for security (don't reveal if email exists)
    if (!user || !user.isActive) {
      return;
    }

    // Generate secure token
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // Invalidate any existing reset tokens
    await this.prisma.passwordReset.deleteMany({
      where: { userId: user.id },
    });

    // Create new reset token
    await this.prisma.passwordReset.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
      },
    });

    // Create audit log
    await this.auditService.createAuditEvent({
      userId: user.id,
      action: 'password_reset_requested',
      resource: 'user',
      resourceId: user.id,
      details: {
        email: user.email,
        username: user.username,
        expiresAt: expiresAt.toISOString(),
      },
      ipAddress,
      userAgent,
    });

    // TODO: Send email with reset link containing the token
    // This would be handled by the email service
  }

  /**
   * Confirm password reset with token
   */
  async confirmPasswordReset(
    token: string,
    newPassword: string,
    confirmPassword: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<void> {
    // Validate passwords match
    if (newPassword !== confirmPassword) {
      throw new BadRequestException('New password and confirmation do not match');
    }

    // Validate password policy
    const policyCheck = this.validatePasswordPolicy(newPassword);
    if (!policyCheck.isValid) {
      throw new BadRequestException(`Password policy violation: ${policyCheck.errors.join(', ')}`);
    }

    // Hash the token to find it
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // Find valid reset token
    const resetToken = await this.prisma.passwordReset.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!resetToken || resetToken.usedAt || resetToken.expiresAt < new Date()) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    // Hash new password
    const newPasswordHash = await bcrypt.hash(newPassword, 12);

    // Update password and mark token as used
    await this.prisma.$transaction(async (tx) => {
      // Update password
      await tx.user.update({
        where: { id: resetToken.userId },
        data: {
          passwordHash: newPasswordHash,
          passwordChangedAt: new Date(),
          mustChangePassword: false,
          // Clear password history on reset
          passwordHistory: [],
        },
      });

      // Mark token as used
      await tx.passwordReset.update({
        where: { id: resetToken.id },
        data: { usedAt: new Date() },
      });

      // Invalidate all sessions
      await tx.userSession.deleteMany({
        where: { userId: resetToken.userId },
      });
    });

    // Create audit log
    await this.auditService.createAuditEvent({
      userId: resetToken.userId,
      action: 'password_reset_completed',
      resource: 'user',
      resourceId: resetToken.userId,
      details: {
        email: resetToken.user.email,
        username: resetToken.user.username,
        tokenId: resetToken.id,
      },
      ipAddress,
      userAgent,
    });
  }

  /**
   * Generate secure temporary password
   */
  generateTemporaryPassword(): string {
    const length = 16;
    const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+-=[]{}|;:,.<>?';
    let password = '';
    
    // Ensure at least one character from each required category
    const lowercase = 'abcdefghijklmnopqrstuvwxyz';
    const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const numbers = '0123456789';
    const symbols = '!@#$%^&*()_+-=[]{}|;:,.<>?';
    
    password += lowercase[Math.floor(Math.random() * lowercase.length)];
    password += uppercase[Math.floor(Math.random() * uppercase.length)];
    password += numbers[Math.floor(Math.random() * numbers.length)];
    password += symbols[Math.floor(Math.random() * symbols.length)];
    
    // Fill the rest randomly
    for (let i = 4; i < length; i++) {
      password += charset[Math.floor(Math.random() * charset.length)];
    }
    
    // Shuffle the password
    return password.split('').sort(() => Math.random() - 0.5).join('');
  }
}