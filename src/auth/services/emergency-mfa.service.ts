import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { AuditService } from '@/audit/audit.service';
import { UsersService } from '@/users/users.service';
import { User, Role, AuditEvent } from '@prisma/client';

export interface EmergencyMfaDisableOptions {
  targetUserId: string;
  adminUserId: string;
  reason: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface EmergencyMfaDisableResult {
  success: boolean;
  message: string;
  auditEventId: string;
  timestamp: Date;
}

interface UserWithRole extends User {
  role: Role | null;
}

interface EmergencyMfaValidationResult {
  admin: UserWithRole;
  targetUser: UserWithRole;
}

/**
 * Emergency MFA Disable Service
 * 
 * Provides secure methods for administrators to disable MFA for users
 * who have lost access to their MFA devices. All operations are fully
 * audited and require proper authorization.
 */
@Injectable()
export class EmergencyMfaService {
  private readonly logger = new Logger(EmergencyMfaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly usersService: UsersService,
  ) {}

  /**
   * Disables MFA for a user in emergency situations
   * Only Super Admins can perform this operation
   * 
   * @param options - Emergency MFA disable options including target user, admin, and reason
   * @returns Promise resolving to the result of the emergency MFA disable operation
   * @throws BadRequestException if admin lacks permissions or MFA is already disabled
   * @throws NotFoundException if target user is not found
   */
  async disableMfaEmergency(
    options: EmergencyMfaDisableOptions,
  ): Promise<EmergencyMfaDisableResult> {
    const { targetUserId, adminUserId, reason, ipAddress, userAgent } = options;

    try {
      // Validate permissions and users
      const { admin, targetUser } = await this.validateEmergencyMfaOperation(
        adminUserId,
        targetUserId,
      );

      // Perform the MFA disable operation
      const auditEvent = await this.executeEmergencyMfaDisable(
        admin,
        targetUser,
        reason,
        ipAddress,
        userAgent,
      );

      this.logger.warn(
        `Emergency MFA disable performed by ${admin.email} for ${targetUser.email}. Reason: ${reason}`,
      );

      return {
        success: true,
        message: `MFA disabled for ${targetUser.email}. All sessions revoked.`,
        auditEventId: auditEvent.id,
        timestamp: auditEvent.timestamp,
      };

    } catch (error) {
      this.logger.error(
        `Emergency MFA disable failed for user ${targetUserId} by admin ${adminUserId}: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Validates admin permissions and target user for emergency MFA operations
   * @private
   */
  private async validateEmergencyMfaOperation(
    adminUserId: string,
    targetUserId: string,
  ): Promise<EmergencyMfaValidationResult> {
    // Prevent self-targeting for additional security
    if (adminUserId === targetUserId) {
      throw new BadRequestException('Cannot perform emergency MFA disable on your own account');
    }

    // Check for recent emergency operations on this user (rate limiting)
    await this.checkRecentEmergencyOperations(targetUserId);

    // Verify admin permissions
    const admin = await this.usersService.findOne(adminUserId);
    if (!admin || admin.role?.name !== 'Super Admin' || !admin.isActive) {
      throw new BadRequestException('Only active Super Admins can perform emergency MFA disable');
    }

    // Find target user
    const targetUser = await this.usersService.findOne(targetUserId);
    if (!targetUser) {
      throw new NotFoundException('Target user not found');
    }

    // Additional security: prevent disabling MFA for other Super Admins without explicit confirmation
    if (targetUser.role?.name === 'Super Admin') {
      this.logger.warn(
        `Attempt to disable MFA for Super Admin ${targetUser.email} by ${admin.email}`,
      );
    }

    // Check if MFA is enabled
    if (!targetUser.mfaEnabled) {
      throw new BadRequestException('MFA is already disabled for this user');
    }

    // Check if target user is active
    if (!targetUser.isActive) {
      throw new BadRequestException('Cannot disable MFA for inactive user');
    }

    return { admin, targetUser };
  }

  /**
   * Checks for recent emergency MFA operations to prevent abuse
   * @private
   */
  private async checkRecentEmergencyOperations(targetUserId: string): Promise<void> {
    const recentOperations = await this.prisma.auditEvent.findMany({
      where: {
        action: 'mfa_disabled_emergency',
        resourceId: targetUserId,
        timestamp: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
        },
      },
      orderBy: { timestamp: 'desc' },
      take: 1,
    });

    if (recentOperations.length > 0) {
      const lastOperation = recentOperations[0];
      const timeSinceLastOperation = Date.now() - lastOperation.timestamp.getTime();
      const cooldownPeriod = 60 * 60 * 1000; // 1 hour cooldown

      if (timeSinceLastOperation < cooldownPeriod) {
        const remainingCooldown = Math.ceil((cooldownPeriod - timeSinceLastOperation) / (60 * 1000));
        throw new BadRequestException(
          `Emergency MFA disable was recently performed for this user. Please wait ${remainingCooldown} minutes before trying again.`,
        );
      }
    }
  }

  /**
   * Executes the emergency MFA disable operation within a transaction
   * @private
   */
  private async executeEmergencyMfaDisable(
    admin: UserWithRole,
    targetUser: UserWithRole,
    reason: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<AuditEvent> {
    return await this.prisma.$transaction(async (tx) => {
      // Disable MFA
      await tx.user.update({
        where: { id: targetUser.id },
        data: {
          mfaEnabled: false,
          mfaSecret: null,
          mfaBackupCodes: [],
        },
      });

      // Revoke all active sessions to force re-login
      await tx.userSession.updateMany({
        where: { userId: targetUser.id },
        data: { revokedAt: new Date() },
      });

      // Create audit event with comprehensive metadata
      return await tx.auditEvent.create({
        data: {
          userId: admin.id,
          action: 'mfa_disabled_emergency',
          resource: 'user',
          resourceId: targetUser.id,
          description: `Emergency MFA disable for user ${targetUser.username} by admin ${admin.username}`,
          metadata: {
            operation: 'emergency_mfa_disable',
            target: {
              userId: targetUser.id,
              email: targetUser.email,
              username: targetUser.username,
              role: targetUser.role?.name,
            },
            admin: {
              userId: admin.id,
              email: admin.email,
              username: admin.username,
              role: admin.role?.name,
            },
            reason: reason.trim(),
            timestamp: new Date().toISOString(),
            actions: {
              mfaDisabled: true,
              secretCleared: true,
              backupCodesCleared: true,
              sessionsRevoked: true,
            },
            security: {
              requiresReauthentication: true,
              riskLevel: 'high',
            },
          },
          ipAddress,
          userAgent,
        },
      });
    });
  }

  /**
   * Lists recent emergency MFA disable operations for audit purposes
   * 
   * @param adminUserId - ID of the admin requesting the history
   * @param limit - Maximum number of records to return (default: 50, max: 100)
   * @returns Promise resolving to an array of audit events for emergency MFA disables
   * @throws BadRequestException if admin lacks sufficient permissions
   */
  async getEmergencyMfaDisableHistory(
    adminUserId: string,
    limit = 50,
  ): Promise<Array<{
    id: string;
    timestamp: Date;
    adminUser: { email: string; username: string };
    targetUser: { email: string; username: string };
    reason: string;
    ipAddress?: string;
  }>> {
    // Validate limit
    const validatedLimit = Math.min(Math.max(1, limit), 100);

    // Verify admin permissions
    const admin = await this.usersService.findOne(adminUserId);
    if (!admin || !['Super Admin', 'Admin'].includes(admin.role?.name || '')) {
      throw new BadRequestException('Insufficient permissions to view audit history');
    }

    const auditEvents = await this.prisma.auditEvent.findMany({
      where: {
        action: 'mfa_disabled_emergency',
      },
      orderBy: { timestamp: 'desc' },
      take: validatedLimit,
      include: {
        user: {
          select: {
            email: true,
            username: true,
          },
        },
      },
    });

    // Transform the data to a more usable format
    return auditEvents.map(event => ({
      id: event.id,
      timestamp: event.timestamp,
      adminUser: {
        email: event.user?.email || 'Unknown',
        username: event.user?.username || 'Unknown',
      },
      targetUser: {
        email: (event.metadata as any)?.target?.email || 'Unknown',
        username: (event.metadata as any)?.target?.username || 'Unknown',
      },
      reason: (event.metadata as any)?.reason || 'No reason provided',
      ipAddress: event.ipAddress,
    }));
  }

  /**
   * Validates if an admin can perform emergency MFA operations
   * 
   * @param adminUserId - ID of the admin to validate
   * @returns Promise resolving to true if admin can perform emergency MFA operations, false otherwise
   */
  async canPerformEmergencyMfaDisable(adminUserId: string): Promise<boolean> {
    try {
      const admin = await this.usersService.findOne(adminUserId);
      return admin?.role?.name === 'Super Admin' && admin.isActive;
    } catch {
      return false;
    }
  }
}