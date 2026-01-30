import { Injectable, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import * as speakeasy from 'speakeasy';
import * as qrcode from 'qrcode';
import { PrismaService } from '@/database/prisma.service';
import { EncryptionService } from '@/common/services/encryption.service';
import { AuditService } from '@/audit/audit.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto, ChangePasswordDto, AssignRoleDto } from './dto/update-user.dto';
import { User } from './entities/user.entity';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryptionService: EncryptionService,
    private readonly auditService: AuditService,
  ) {}

  async create(
    createUserDto: CreateUserDto,
    createdBy?: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<{ user: User; temporaryPassword: string }> {
    const { email, username, password, firstName, lastName, roleId, mustChangePassword, avatarUrl } = createUserDto;

    // Check if user already exists
    const [existingEmail, existingUsername] = await Promise.all([
      this.prisma.user.findUnique({ where: { email } }),
      this.prisma.user.findUnique({ where: { username } }),
    ]);

    if (existingEmail) {
      throw new ConflictException('User with this email already exists');
    }

    if (existingUsername) {
      throw new ConflictException('User with this username already exists');
    }

    // Verify role exists
    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!role) {
      throw new BadRequestException('Invalid role ID');
    }

    // Hash password
    const saltRounds = 12;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Create user
    const user = await this.prisma.user.create({
      data: {
        email,
        username,
        passwordHash,
        firstName,
        lastName,
        roleId,
        avatarUrl,
        isActive: true,
        mustChangePassword: mustChangePassword ?? true,
        passwordChangedAt: new Date(),
      },
      include: {
        role: {
          include: {
            permissions: true,
          },
        },
      },
    });

    // Create audit log
    if (createdBy) {
      await this.auditService.createAuditEvent({
        userId: createdBy,
        action: 'user_created',
        resource: 'user',
        resourceId: user.id,
        details: {
          email: user.email,
          username: user.username,
          role: role.name,
          createdBy: 'admin',
        },
        ipAddress,
        userAgent,
      });
    }

    return {
      user: new User(user),
      temporaryPassword: password,
    };
  }

  async findAllPaginated(
    skip: number, 
    limit: number, 
    filters: Record<string, any> = {}
  ): Promise<{ users: User[]; total: number }> {
    const where: any = {
      deletedAt: null, // Only active users
    };

    // Apply filters
    if (filters.roleId) {
      where.roleId = filters.roleId;
    }
    if (filters.mfaEnabled !== undefined) {
      where.mfaEnabled = filters.mfaEnabled;
    }
    if (filters.isActive !== undefined) {
      where.isActive = filters.isActive;
    }
    if (filters.isLocked !== undefined) {
      where.isLocked = filters.isLocked;
    }
    if (filters.search) {
      where.OR = [
        { email: { contains: filters.search, mode: 'insensitive' } },
        { username: { contains: filters.search, mode: 'insensitive' } },
        { firstName: { contains: filters.search, mode: 'insensitive' } },
        { lastName: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          role: {
            include: {
              permissions: true,
            },
          },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      users: users.map(user => new User(user)),
      total,
    };
  }

  async getStats(): Promise<{
    total: number;
    byRole: Record<string, number>;
    mfaEnabled: number;
    mfaDisabled: number;
    recentLogins: number;
    activeUsers: number;
    lockedUsers: number;
  }> {
    const [
      total,
      roleStats,
      mfaEnabledCount,
      recentLoginsCount,
      activeUsersCount,
      lockedUsersCount,
    ] = await Promise.all([
      this.prisma.user.count({ where: { deletedAt: null } }),
      this.prisma.user.groupBy({
        by: ['roleId'],
        _count: { roleId: true },
        where: { deletedAt: null },
      }),
      this.prisma.user.count({ where: { mfaEnabled: true, deletedAt: null } }),
      this.prisma.user.count({
        where: {
          lastLoginAt: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
          },
          deletedAt: null,
        },
      }),
      this.prisma.user.count({ where: { isActive: true, deletedAt: null } }),
      this.prisma.user.count({ where: { isLocked: true, deletedAt: null } }),
    ]);

    // Get role names
    const roles = await this.prisma.role.findMany();
    const roleMap = roles.reduce((acc, role) => {
      acc[role.id] = role.name;
      return acc;
    }, {} as Record<string, string>);

    const byRole = roleStats.reduce((acc, stat) => {
      const roleName = roleMap[stat.roleId] || 'Unknown';
      acc[roleName] = stat._count.roleId;
      return acc;
    }, {} as Record<string, number>);

    return {
      total,
      byRole,
      mfaEnabled: mfaEnabledCount,
      mfaDisabled: total - mfaEnabledCount,
      recentLogins: recentLoginsCount,
      activeUsers: activeUsersCount,
      lockedUsers: lockedUsersCount,
    };
  }

  async findOne(id: string): Promise<User> {
    const user = await this.prisma.user.findUnique({
      where: { id, deletedAt: null },
      include: {
        role: {
          include: {
            permissions: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return new User(user);
  }

  async findByEmail(email: string): Promise<User | null> {
    const user = await this.prisma.user.findUnique({
      where: { email, deletedAt: null },
      include: {
        role: {
          include: {
            permissions: true,
          },
        },
      },
    });

    return user ? new User(user) : null;
  }

  async findByUsername(username: string): Promise<User | null> {
    const user = await this.prisma.user.findUnique({
      where: { username, deletedAt: null },
      include: {
        role: {
          include: {
            permissions: true,
          },
        },
      },
    });

    return user ? new User(user) : null;
  }

  async update(
    id: string,
    updateUserDto: UpdateUserDto,
    updatedBy?: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<User> {
    const existingUser = await this.findOne(id); // Check if user exists

    const updateData: any = { ...updateUserDto };

    // Check for email/username conflicts if they're being updated
    if (updateUserDto.email && updateUserDto.email !== existingUser.email) {
      const emailExists = await this.prisma.user.findUnique({
        where: { email: updateUserDto.email, deletedAt: null },
      });
      if (emailExists) {
        throw new ConflictException('Email already exists');
      }
    }

    if (updateUserDto.username && updateUserDto.username !== existingUser.username) {
      const usernameExists = await this.prisma.user.findUnique({
        where: { username: updateUserDto.username, deletedAt: null },
      });
      if (usernameExists) {
        throw new ConflictException('Username already exists');
      }
    }

    // Verify role exists if being updated
    if (updateUserDto.roleId) {
      const role = await this.prisma.role.findUnique({ where: { id: updateUserDto.roleId } });
      if (!role) {
        throw new BadRequestException('Invalid role ID');
      }
    }

    const user = await this.prisma.user.update({
      where: { id },
      data: updateData,
      include: {
        role: {
          include: {
            permissions: true,
          },
        },
      },
    });

    // Create audit log
    if (updatedBy) {
      await this.auditService.createAuditEvent({
        userId: updatedBy,
        action: 'user_updated',
        resource: 'user',
        resourceId: id,
        details: {
          email: user.email,
          username: user.username,
          updatedFields: Object.keys(updateUserDto),
          updatedBy: updatedBy === id ? 'self' : 'admin',
        },
        ipAddress,
        userAgent,
      });
    }

    return new User(user);
  }

  async remove(
    id: string,
    deletedBy?: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<void> {
    const user = await this.findOne(id); // Check if user exists

    // Soft delete
    await this.prisma.user.update({
      where: { id },
      data: { 
        deletedAt: new Date(),
        isActive: false,
      },
    });

    // Create audit log
    if (deletedBy) {
      await this.auditService.createAuditEvent({
        userId: deletedBy,
        action: 'user_deleted',
        resource: 'user',
        resourceId: id,
        details: {
          email: user.email,
          username: user.username,
          deletedBy: 'admin',
        },
        ipAddress,
        userAgent,
      });
    }
  }

  async activate(
    id: string,
    activatedBy?: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<void> {
    const user = await this.findOne(id);

    await this.prisma.user.update({
      where: { id },
      data: { isActive: true },
    });

    // Create audit log
    if (activatedBy) {
      await this.auditService.createAuditEvent({
        userId: activatedBy,
        action: 'user_activated',
        resource: 'user',
        resourceId: id,
        details: {
          email: user.email,
          username: user.username,
          activatedBy: 'admin',
        },
        ipAddress,
        userAgent,
      });
    }
  }

  async deactivate(
    id: string,
    deactivatedBy?: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<void> {
    const user = await this.findOne(id);

    await this.prisma.user.update({
      where: { id },
      data: { isActive: false },
    });

    // Revoke all sessions
    await this.prisma.userSession.updateMany({
      where: { userId: id },
      data: { revokedAt: new Date() },
    });

    // Create audit log
    if (deactivatedBy) {
      await this.auditService.createAuditEvent({
        userId: deactivatedBy,
        action: 'user_deactivated',
        resource: 'user',
        resourceId: id,
        details: {
          email: user.email,
          username: user.username,
          deactivatedBy: 'admin',
        },
        ipAddress,
        userAgent,
      });
    }
  }

  async assignRole(
    id: string,
    assignRoleDto: AssignRoleDto,
    assignedBy?: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<void> {
    const user = await this.findOne(id);
    const role = await this.prisma.role.findUnique({ where: { id: assignRoleDto.roleId } });
    
    if (!role) {
      throw new BadRequestException('Invalid role ID');
    }

    await this.prisma.user.update({
      where: { id },
      data: { roleId: assignRoleDto.roleId },
    });

    // Revoke all sessions to force re-login with new permissions
    await this.prisma.userSession.updateMany({
      where: { userId: id },
      data: { revokedAt: new Date() },
    });

    // Create audit log
    if (assignedBy) {
      await this.auditService.createAuditEvent({
        userId: assignedBy,
        action: 'role_assigned',
        resource: 'user',
        resourceId: id,
        details: {
          email: user.email,
          username: user.username,
          oldRole: user.role?.name,
          newRole: role.name,
          assignedBy: 'admin',
        },
        ipAddress,
        userAgent,
      });
    }
  }

  async validatePassword(user: User, password: string): Promise<boolean> {
    return bcrypt.compare(password, user.passwordHash);
  }

  async updateLastLogin(id: string, ipAddress?: string): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: { 
        lastLoginAt: new Date(),
        lastLoginIp: ipAddress,
      },
    });
  }

  async storeMfaSetup(id: string, secret: string, backupCodes: string[]): Promise<void> {
    // Encrypt secret and backup codes
    const encryptedSecret = this.encryptionService.encrypt(secret);
    const encryptedBackupCodes = backupCodes.map(code => this.encryptionService.encrypt(code));

    await this.prisma.user.update({
      where: { id },
      data: {
        mfaSecret: encryptedSecret,
        mfaBackupCodes: encryptedBackupCodes,
        // Don't enable MFA yet - that happens in enableMfa
      },
    });
  }

  async enableMfa(id: string): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: { mfaEnabled: true },
    });
  }

  async disableMfa(id: string): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: {
        mfaEnabled: false,
        mfaSecret: null,
        mfaBackupCodes: [],
      },
    });
  }

  async updateBackupCodes(id: string, backupCodes: string[]): Promise<void> {
    const encryptedBackupCodes = backupCodes.map(code => this.encryptionService.encrypt(code));
    
    await this.prisma.user.update({
      where: { id },
      data: { mfaBackupCodes: encryptedBackupCodes },
    });
  }

  async getUsersByRole(roleId: string): Promise<User[]> {
    const users = await this.prisma.user.findMany({
      where: { roleId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        role: {
          include: {
            permissions: true,
          },
        },
      },
    });

    return users.map(user => new User(user));
  }

  async getRoles(): Promise<any[]> {
    return await this.prisma.role.findMany({
      include: {
        permissions: true,
        _count: {
          select: { users: true },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  async activateUser(id: string, activatedBy?: string, ipAddress?: string, userAgent?: string): Promise<void> {
    const user = await this.findOne(id);
    
    await this.prisma.user.update({
      where: { id },
      data: { 
        isActive: true,
        updatedAt: new Date(),
      },
    });

    // Create audit event
    await this.auditService.createAuditEvent({
      userId: activatedBy,
      action: 'user_activated',
      resource: 'user',
      resourceId: id,
      details: {
        description: `User ${user.username} activated`,
        targetUserId: id,
        targetUsername: user.username,
        targetEmail: user.email,
      },
      ipAddress,
      userAgent,
    });
  }

  async deactivateUser(id: string, deactivatedBy?: string, ipAddress?: string, userAgent?: string): Promise<void> {
    const user = await this.findOne(id);
    
    await this.prisma.user.update({
      where: { id },
      data: { 
        isActive: false,
        updatedAt: new Date(),
      },
    });

    // Create audit event
    await this.auditService.createAuditEvent({
      userId: deactivatedBy,
      action: 'user_deactivated',
      resource: 'user',
      resourceId: id,
      details: {
        description: `User ${user.username} deactivated`,
        targetUserId: id,
        targetUsername: user.username,
        targetEmail: user.email,
      },
      ipAddress,
      userAgent,
    });
  }

  async unlockUser(id: string, unlockedBy?: string, ipAddress?: string, userAgent?: string): Promise<void> {
    const user = await this.findOne(id);
    
    await this.prisma.user.update({
      where: { id },
      data: { 
        isLocked: false,
        lockoutUntil: null,
        failedLoginAttempts: 0,
        updatedAt: new Date(),
      },
    });

    // Create audit event
    await this.auditService.createAuditEvent({
      userId: unlockedBy,
      action: 'user_unlocked',
      resource: 'user',
      resourceId: id,
      details: {
        description: `User ${user.username} unlocked`,
        targetUserId: id,
        targetUsername: user.username,
        targetEmail: user.email,
      },
      ipAddress,
      userAgent,
    });
  }

  async lockUser(id: string, lockedBy: string, reason?: string, ipAddress?: string, userAgent?: string): Promise<void> {
    const user = await this.findOne(id);
    
    // Don't allow locking super admin users
    if (user.role?.name === 'SUPER_ADMIN') {
      throw new BadRequestException('Cannot lock super admin users');
    }

    const lockoutUntil = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours for manual lock

    await this.prisma.user.update({
      where: { id },
      data: { 
        isLocked: true,
        lockoutUntil,
        failedLoginAttempts: 5, // Set to max to indicate manual lock
        updatedAt: new Date(),
      },
    });

    // Create audit event
    await this.auditService.createAuditEvent({
      userId: lockedBy,
      action: 'user_locked_manually',
      resource: 'user',
      resourceId: id,
      details: {
        description: `User ${user.username} locked manually`,
        targetUserId: id,
        targetUsername: user.username,
        targetEmail: user.email,
        reason: reason || 'manual_lock',
        lockoutUntil: lockoutUntil.toISOString(),
      },
      ipAddress,
      userAgent,
    });
  }

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
          action: { in: ['account_locked', 'user_locked_manually'] },
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