import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { AuditService } from '@/audit/audit.service';
import { EmailService } from './email.service';

@Injectable()
export class AccountLockoutService {
  private readonly logger = new Logger(AccountLockoutService.name);
  private readonly MAX_FAILED_ATTEMPTS = 5;
  private readonly LOCKOUT_DURATION_MINUTES = 15;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly emailService: EmailService,
  ) {}

  /**
   * Record a failed login attempt
   */
  async recordFailedAttempt(
    userId: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<{ isLocked: boolean; lockoutUntil?: Date }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { 
        id: true, 
        email: true, 
        username: true,
        failedLoginAttempts: true,
        isLocked: true,
        lockoutUntil: true,
      },
    });

    if (!user) {
      return { isLocked: false };
    }

    const newFailedAttempts = user.failedLoginAttempts + 1;
    let isLocked = false;
    let lockoutUntil: Date | undefined;

    // Check if we should lock the account
    if (newFailedAttempts >= this.MAX_FAILED_ATTEMPTS) {
      isLocked = true;
      lockoutUntil = new Date(Date.now() + this.LOCKOUT_DURATION_MINUTES * 60 * 1000);

      await this.prisma.user.update({
        where: { id: userId },
        data: {
          failedLoginAttempts: newFailedAttempts,
          isLocked: true,
          lockoutUntil,
        },
      });

      // Create audit log
      await this.auditService.createAuditEvent({
        userId,
        action: 'account_locked',
        resource: 'user',
        resourceId: userId,
        details: {
          email: user.email,
          username: user.username,
          failedAttempts: newFailedAttempts,
          lockoutUntil: lockoutUntil.toISOString(),
          reason: 'max_failed_attempts',
        },
        ipAddress,
        userAgent,
      });

      // Send email notification
      try {
        await this.emailService.sendAccountLockedEmail(user.email, user.username, lockoutUntil);
      } catch (error) {
        this.logger.warn(`Failed to send account locked email to ${user.email}:`, error);
      }

      this.logger.warn(`Account locked for user ${user.username} (${user.email}) after ${newFailedAttempts} failed attempts`);
    } else {
      // Just increment failed attempts
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          failedLoginAttempts: newFailedAttempts,
        },
      });

      // Create audit log
      await this.auditService.createAuditEvent({
        userId,
        action: 'failed_login_attempt',
        resource: 'user',
        resourceId: userId,
        details: {
          email: user.email,
          username: user.username,
          failedAttempts: newFailedAttempts,
          remainingAttempts: this.MAX_FAILED_ATTEMPTS - newFailedAttempts,
        },
        ipAddress,
        userAgent,
      });
    }

    return { isLocked, lockoutUntil };
  }

  /**
   * Reset failed login attempts (called on successful login)
   */
  async resetFailedAttempts(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        failedLoginAttempts: 0,
        isLocked: false,
        lockoutUntil: null,
      },
    });
  }

  /**
   * Check if account is currently locked
   */
  async isAccountLocked(userId: string): Promise<{ isLocked: boolean; lockoutUntil?: Date }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isLocked: true, lockoutUntil: true },
    });

    if (!user) {
      return { isLocked: false };
    }

    // Check if lockout has expired
    if (user.isLocked && user.lockoutUntil && user.lockoutUntil <= new Date()) {
      // Auto-unlock the account
      await this.unlockAccount(userId);
      return { isLocked: false };
    }

    return {
      isLocked: user.isLocked,
      lockoutUntil: user.lockoutUntil || undefined,
    };
  }

  /**
   * Manually unlock an account (admin action)
   */
  async unlockAccount(
    userId: string,
    unlockedBy?: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, username: true, isLocked: true },
    });

    if (!user) {
      throw new Error('User not found');
    }

    if (!user.isLocked) {
      return; // Already unlocked
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        isLocked: false,
        lockoutUntil: null,
        failedLoginAttempts: 0,
      },
    });

    // Create audit log
    await this.auditService.createAuditEvent({
      userId: unlockedBy || userId,
      action: 'account_unlocked',
      resource: 'user',
      resourceId: userId,
      details: {
        email: user.email,
        username: user.username,
        unlockedBy: unlockedBy ? 'admin' : 'auto_expire',
        unlockedByUserId: unlockedBy,
      },
      ipAddress,
      userAgent,
    });

    this.logger.log(`Account unlocked for user ${user.username} (${user.email})`);
  }

  /**
   * Lock an account manually (admin action)
   */
  async lockAccount(
    userId: string,
    lockedBy: string,
    reason?: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, username: true, isLocked: true },
    });

    if (!user) {
      throw new Error('User not found');
    }

    if (user.isLocked) {
      return; // Already locked
    }

    const lockoutUntil = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours for manual lock

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        isLocked: true,
        lockoutUntil,
        failedLoginAttempts: this.MAX_FAILED_ATTEMPTS,
      },
    });

    // Create audit log
    await this.auditService.createAuditEvent({
      userId: lockedBy,
      action: 'account_locked_manually',
      resource: 'user',
      resourceId: userId,
      details: {
        email: user.email,
        username: user.username,
        lockedBy: 'admin',
        lockedByUserId: lockedBy,
        reason: reason || 'manual_lock',
        lockoutUntil: lockoutUntil.toISOString(),
      },
      ipAddress,
      userAgent,
    });

    // Send email notification
    try {
      await this.emailService.sendAccountLockedEmail(user.email, user.username, lockoutUntil);
    } catch (error) {
      this.logger.warn(`Failed to send account locked email to ${user.email}:`, error);
    }

    this.logger.log(`Account manually locked for user ${user.username} (${user.email}) by admin`);
  }

  /**
   * Get lockout statistics
   */
  async getLockoutStats(): Promise<{
    totalLockedAccounts: number;
    accountsLockedToday: number;
    topFailedAttemptUsers: Array<{ email: string; username: string; failedAttempts: number }>;
  }> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [totalLocked, lockedToday, topFailedUsers] = await Promise.all([
      this.prisma.user.count({
        where: { isLocked: true },
      }),
      this.prisma.auditEvent.count({
        where: {
          action: 'account_locked',
          timestamp: { gte: today },
        },
      }),
      this.prisma.user.findMany({
        where: {
          failedLoginAttempts: { gt: 0 },
        },
        select: {
          email: true,
          username: true,
          failedLoginAttempts: true,
        },
        orderBy: {
          failedLoginAttempts: 'desc',
        },
        take: 10,
      }),
    ]);

    return {
      totalLockedAccounts: totalLocked,
      accountsLockedToday: lockedToday,
      topFailedAttemptUsers: topFailedUsers.map(user => ({
        email: user.email,
        username: user.username,
        failedAttempts: user.failedLoginAttempts,
      })),
    };
  }
}