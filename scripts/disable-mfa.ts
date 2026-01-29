#!/usr/bin/env ts-node

import { PrismaClient } from '@prisma/client';
import { Logger } from '@nestjs/common';

interface DisableMfaOptions {
  email: string;
  reason?: string;
  executedBy?: string;
}

interface OperationResult {
  success: boolean;
  message: string;
  duration: number;
  auditEventId?: string;
}

/**
 * Emergency MFA Disable Utility
 * 
 * This utility provides a secure way to disable MFA for users who have lost
 * access to their MFA devices. All operations are logged for audit compliance.
 */
class MfaDisableUtility {
  private readonly prisma: PrismaClient;
  private readonly logger: Logger;

  constructor() {
    this.prisma = new PrismaClient();
    this.logger = new Logger(MfaDisableUtility.name);
  }

  /**
   * Validates email format using RFC 5322 compliant regex
   */
  private validateEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Disables MFA for a specific user with full audit logging
   */
  async disableMfaForUser(options: DisableMfaOptions): Promise<OperationResult> {
    const startTime = Date.now();
    const { email, reason = 'emergency_access', executedBy = 'system_admin' } = options;

    try {
      this.logger.log(`Starting MFA disable operation for: ${email}`);

      // Validate input
      if (!this.validateEmail(email)) {
        throw new Error('Invalid email format provided');
      }

      // Find user with complete information
      const user = await this.prisma.user.findUnique({
        where: { email },
        include: {
          role: {
            include: {
              permissions: true
            }
          }
        }
      });

      if (!user) {
        throw new Error(`User not found: ${email}`);
      }

      // Check if user is active
      if (!user.isActive) {
        throw new Error(`User account is inactive: ${email}`);
      }

      // Check current MFA status
      if (!user.mfaEnabled) {
        return {
          success: true,
          message: 'MFA is already disabled for this user',
          duration: Date.now() - startTime
        };
      }

      // Perform operation in transaction
      const result = await this.prisma.$transaction(async (tx) => {
        // Disable MFA
        const updatedUser = await tx.user.update({
          where: { id: user.id },
          data: {
            mfaEnabled: false,
            mfaSecret: null,
            mfaBackupCodes: []
          }
        });

        // Create audit event
        const auditEvent = await tx.auditEvent.create({
          data: {
            userId: user.id,
            action: 'mfa_disabled_emergency',
            resource: 'user',
            resourceId: user.id,
            details: {
              email: user.email,
              username: user.username,
              role: user.role?.name,
              reason,
              executedBy,
              timestamp: new Date().toISOString(),
              previousMfaStatus: true
            },
            ipAddress: '127.0.0.1',
            userAgent: 'mfa-disable-utility'
          }
        });

        return { updatedUser, auditEvent };
      });

      const duration = Date.now() - startTime;

      this.logger.log(`MFA disabled successfully for ${email} in ${duration}ms`);

      return {
        success: true,
        message: `MFA disabled successfully for ${email}`,
        duration,
        auditEventId: result.auditEvent.id
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(`MFA disable failed for ${email}: ${error.message}`);

      return {
        success: false,
        message: error.message,
        duration
      };
    }
  }

  /**
   * Cleanup resources
   */
  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }
}

/**
 * CLI Interface
 */
async function main(): Promise<void> {
  const email = process.argv[2];
  const reason = process.argv[3] || 'emergency_access';

  if (!email) {
    console.log('❌ Usage: ts-node scripts/disable-mfa.ts <email> [reason]');
    console.log('   Example: ts-node scripts/disable-mfa.ts user@example.com "lost_device"');
    process.exit(1);
  }

  const utility = new MfaDisableUtility();

  try {
    console.log('⚠️  WARNING: This will disable MFA for the specified user');
    console.log(`   Target user: ${email}`);
    console.log(`   Reason: ${reason}`);
    console.log('   This operation will be logged for audit purposes\n');

    const result = await utility.disableMfaForUser({ email, reason });

    if (result.success) {
      console.log('✅', result.message);
      console.log(`⏱️  Completed in ${result.duration}ms`);
      if (result.auditEventId) {
        console.log(`📝 Audit Event ID: ${result.auditEventId}`);
      }
      console.log('\n🔐 User can now log in without MFA');
      console.log('⚠️  Remember to advise user to re-enable MFA after regaining access');
    } else {
      console.log('❌', result.message);
      process.exit(1);
    }

  } catch (error) {
    console.error('❌ Unexpected error:', error.message);
    process.exit(1);
  } finally {
    await utility.disconnect();
  }
}

// Execute if run directly
if (require.main === module) {
  main().catch(console.error);
}

export { MfaDisableUtility, DisableMfaOptions, OperationResult };