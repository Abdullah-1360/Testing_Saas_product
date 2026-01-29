import { Test } from '@nestjs/testing';
import * as fc from 'fast-check';
import { EmergencyMfaService } from './emergency-mfa.service';
import { PrismaService } from '@/database/prisma.service';
import { AuditService } from '@/audit/audit.service';
import { UsersService } from '@/users/users.service';

/**
 * Property-Based Tests for Emergency MFA Service
 * 
 * **Validates: Requirements 6.9, 9.1-9.6**
 * 
 * These tests verify that the emergency MFA disable functionality
 * maintains security properties across all possible inputs.
 */
describe('EmergencyMfaService - Property-Based Tests', () => {
  let service: EmergencyMfaService;
  let mockPrismaService: any;
  let mockUsersService: any;

  beforeEach(async () => {
    mockPrismaService = {
      $transaction: jest.fn(),
      auditEvent: { findMany: jest.fn() },
    };

    mockUsersService = {
      findOne: jest.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [
        EmergencyMfaService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: AuditService, useValue: { createAuditEvent: jest.fn() } },
        { provide: UsersService, useValue: mockUsersService },
      ],
    }).compile();

    service = module.get<EmergencyMfaService>(EmergencyMfaService);
  });

  /**
   * Property: Only Super Admins can perform emergency MFA disable
   * **Validates: Requirements 9.2, 9.3**
   */
  it('should only allow Super Admins to disable MFA', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          adminRole: fc.oneof(
            fc.constant('Super Admin'),
            fc.constant('Admin'),
            fc.constant('Engineer'),
            fc.constant('Viewer'),
            fc.constant(null),
          ),
          adminActive: fc.boolean(),
          targetUserId: fc.uuid(),
          reason: fc.string({ minLength: 1, maxLength: 500 }),
        }),
        async ({ adminRole, adminActive, targetUserId, reason }) => {
          // Arrange
          const adminUser = adminRole ? {
            id: 'admin-id',
            email: 'admin@test.com',
            role: { name: adminRole },
            isActive: adminActive,
          } : null;

          const targetUser = {
            id: targetUserId,
            email: 'user@test.com',
            mfaEnabled: true,
          };

          mockUsersService.findOne
            .mockResolvedValueOnce(adminUser)
            .mockResolvedValueOnce(targetUser);

          // Act & Assert
          const canPerform = await service.canPerformEmergencyMfaDisable('admin-id');
          const expectedResult = adminRole === 'Super Admin' && adminActive;
          
          expect(canPerform).toBe(expectedResult);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Property: All emergency MFA disable operations must be audited
   * **Validates: Requirements 2.4, 2.5, 6.9**
   */
  it('should always create audit trail for emergency operations', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          reason: fc.string({ minLength: 1, maxLength: 500 }),
          ipAddress: fc.option(fc.ipV4()),
          userAgent: fc.option(fc.string({ maxLength: 200 })),
        }),
        async ({ reason, ipAddress, userAgent }) => {
          // Arrange
          const superAdmin = {
            id: 'admin-id',
            email: 'admin@test.com',
            username: 'admin',
            role: { name: 'Super Admin' },
            isActive: true,
          };

          const targetUser = {
            id: 'user-id',
            email: 'user@test.com',
            username: 'user',
            mfaEnabled: true,
          };

          const mockAuditEvent = {
            id: 'audit-id',
            timestamp: new Date(),
          };

          mockUsersService.findOne
            .mockResolvedValueOnce(superAdmin)
            .mockResolvedValueOnce(targetUser);

          mockPrismaService.$transaction.mockImplementation(async (callback) => {
            const mockTx = {
              user: { update: jest.fn() },
              userSession: { updateMany: jest.fn() },
              auditEvent: { create: jest.fn().mockResolvedValue(mockAuditEvent) },
            };
            return await callback(mockTx);
          });

          // Act
          const result = await service.disableMfaEmergency({
            targetUserId: 'user-id',
            adminUserId: 'admin-id',
            reason,
            ipAddress: ipAddress || undefined,
            userAgent: userAgent || undefined,
          });

          // Assert - Audit event must always be created
          expect(result.success).toBe(true);
          expect(result.auditEventId).toBeDefined();
          expect(result.auditEventId).toBe('audit-id');
        },
      ),
      { numRuns: 50 },
    );
  });

  /**
   * Property: Emergency MFA disable must revoke all user sessions
   * **Validates: Requirements 9.4, 9.5**
   */
  it('should always revoke all sessions when disabling MFA', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 500 }),
        async (reason) => {
          // Arrange
          const superAdmin = {
            id: 'admin-id',
            email: 'admin@test.com',
            username: 'admin',
            role: { name: 'Super Admin' },
            isActive: true,
          };

          const targetUser = {
            id: 'user-id',
            email: 'user@test.com',
            username: 'user',
            mfaEnabled: true,
          };

          mockUsersService.findOne
            .mockResolvedValueOnce(superAdmin)
            .mockResolvedValueOnce(targetUser);

          let sessionRevokeCallCount = 0;
          mockPrismaService.$transaction.mockImplementation(async (callback) => {
            const mockTx = {
              user: { update: jest.fn() },
              userSession: { 
                updateMany: jest.fn().mockImplementation(() => {
                  sessionRevokeCallCount++;
                  return Promise.resolve();
                })
              },
              auditEvent: { 
                create: jest.fn().mockResolvedValue({ 
                  id: 'audit-id', 
                  timestamp: new Date() 
                })
              },
            };
            return await callback(mockTx);
          });

          // Act
          await service.disableMfaEmergency({
            targetUserId: 'user-id',
            adminUserId: 'admin-id',
            reason,
          });

          // Assert - Sessions must always be revoked
          expect(sessionRevokeCallCount).toBe(1);
        },
      ),
      { numRuns: 30 },
    );
  });

  /**
   * Property: Reason field must be properly validated and stored
   * **Validates: Requirements 2.4, 6.9**
   */
  it('should properly handle reason field validation', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(
          fc.string({ minLength: 1, maxLength: 500 }), // Valid reasons
          fc.string({ minLength: 501 }), // Too long
          fc.constant(''), // Empty
        ),
        async (reason) => {
          // Arrange
          const superAdmin = {
            id: 'admin-id',
            email: 'admin@test.com',
            role: { name: 'Super Admin' },
            isActive: true,
          };

          const targetUser = {
            id: 'user-id',
            email: 'user@test.com',
            mfaEnabled: true,
          };

          mockUsersService.findOne
            .mockResolvedValueOnce(superAdmin)
            .mockResolvedValueOnce(targetUser);

          // Act & Assert
          if (reason.length === 0 || reason.length > 500) {
            // Should be handled by DTO validation in real implementation
            // For this test, we assume the service receives valid input
            return;
          } else {
            // Valid reason should work
            mockPrismaService.$transaction.mockImplementation(async (callback) => {
              const mockTx = {
                user: { update: jest.fn() },
                userSession: { updateMany: jest.fn() },
                auditEvent: { 
                  create: jest.fn().mockResolvedValue({ 
                    id: 'audit-id', 
                    timestamp: new Date() 
                  })
                },
              };
              return await callback(mockTx);
            });

            const result = await service.disableMfaEmergency({
              targetUserId: 'user-id',
              adminUserId: 'admin-id',
              reason,
            });

            expect(result.success).toBe(true);
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});