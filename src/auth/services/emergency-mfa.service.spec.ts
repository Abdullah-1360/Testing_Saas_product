import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EmergencyMfaService } from './emergency-mfa.service';
import { PrismaService } from '@/database/prisma.service';
import { AuditService } from '@/audit/audit.service';
import { UsersService } from '@/users/users.service';

describe('EmergencyMfaService', () => {
  let service: EmergencyMfaService;
  let prismaService: jest.Mocked<PrismaService>;
  let auditService: jest.Mocked<AuditService>;
  let usersService: jest.Mocked<UsersService>;

  const mockSuperAdmin = {
    id: 'admin-id',
    email: 'admin@example.com',
    username: 'admin',
    role: { name: 'Super Admin' },
    isActive: true,
  };

  const mockTargetUser = {
    id: 'user-id',
    email: 'user@example.com',
    username: 'user',
    mfaEnabled: true,
    role: { name: 'Engineer' },
  };

  beforeEach(async () => {
    const mockPrismaService = {
      $transaction: jest.fn(),
      user: {
        update: jest.fn(),
      },
      userSession: {
        updateMany: jest.fn(),
      },
      auditEvent: {
        create: jest.fn(),
        findMany: jest.fn(),
      },
    };

    const mockAuditService = {
      createAuditEvent: jest.fn(),
    };

    const mockUsersService = {
      findOne: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmergencyMfaService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: AuditService, useValue: mockAuditService },
        { provide: UsersService, useValue: mockUsersService },
      ],
    }).compile();

    service = module.get<EmergencyMfaService>(EmergencyMfaService);
    prismaService = module.get(PrismaService);
    auditService = module.get(AuditService);
    usersService = module.get(UsersService);
  });

  describe('disableMfaEmergency', () => {
    it('should successfully disable MFA for a user', async () => {
      // Arrange
      const options = {
        targetUserId: 'user-id',
        adminUserId: 'admin-id',
        reason: 'Lost MFA device',
        ipAddress: '192.168.1.1',
        userAgent: 'Test Agent',
      };

      const mockAuditEvent = {
        id: 'audit-id',
        timestamp: new Date(),
      };

      usersService.findOne
        .mockResolvedValueOnce(mockSuperAdmin as any)
        .mockResolvedValueOnce(mockTargetUser as any);

      prismaService.$transaction.mockImplementation(async (callback) => {
        return await callback({
          user: { update: jest.fn() },
          userSession: { updateMany: jest.fn() },
          auditEvent: { create: jest.fn().mockResolvedValue(mockAuditEvent) },
        });
      });

      // Act
      const result = await service.disableMfaEmergency(options);

      // Assert
      expect(result.success).toBe(true);
      expect(result.auditEventId).toBe('audit-id');
      expect(result.message).toContain('user@example.com');
      expect(usersService.findOne).toHaveBeenCalledTimes(2);
    });

    it('should throw BadRequestException if admin is not Super Admin', async () => {
      // Arrange
      const options = {
        targetUserId: 'user-id',
        adminUserId: 'admin-id',
        reason: 'Lost MFA device',
      };

      const mockRegularAdmin = {
        ...mockSuperAdmin,
        role: { name: 'Admin' },
      };

      usersService.findOne.mockResolvedValueOnce(mockRegularAdmin as any);

      // Act & Assert
      await expect(service.disableMfaEmergency(options)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw NotFoundException if target user not found', async () => {
      // Arrange
      const options = {
        targetUserId: 'user-id',
        adminUserId: 'admin-id',
        reason: 'Lost MFA device',
      };

      usersService.findOne
        .mockResolvedValueOnce(mockSuperAdmin as any)
        .mockResolvedValueOnce(null);

      // Act & Assert
      await expect(service.disableMfaEmergency(options)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException if MFA is already disabled', async () => {
      // Arrange
      const options = {
        targetUserId: 'user-id',
        adminUserId: 'admin-id',
        reason: 'Lost MFA device',
      };

      const mockUserWithoutMfa = {
        ...mockTargetUser,
        mfaEnabled: false,
      };

      usersService.findOne
        .mockResolvedValueOnce(mockSuperAdmin as any)
        .mockResolvedValueOnce(mockUserWithoutMfa as any);

      // Act & Assert
      await expect(service.disableMfaEmergency(options)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('canPerformEmergencyMfaDisable', () => {
    it('should return true for active Super Admin', async () => {
      // Arrange
      usersService.findOne.mockResolvedValue(mockSuperAdmin as any);

      // Act
      const result = await service.canPerformEmergencyMfaDisable('admin-id');

      // Assert
      expect(result).toBe(true);
    });

    it('should return false for non-Super Admin', async () => {
      // Arrange
      const mockRegularUser = {
        ...mockSuperAdmin,
        role: { name: 'Engineer' },
      };
      usersService.findOne.mockResolvedValue(mockRegularUser as any);

      // Act
      const result = await service.canPerformEmergencyMfaDisable('user-id');

      // Assert
      expect(result).toBe(false);
    });

    it('should return false if user not found', async () => {
      // Arrange
      usersService.findOne.mockResolvedValue(null);

      // Act
      const result = await service.canPerformEmergencyMfaDisable('invalid-id');

      // Assert
      expect(result).toBe(false);
    });
  });
});