import { Role, Permission } from '@prisma/client';

// Type for Role with permissions included
type RoleWithPermissions = Role & {
  permissions: Permission[];
};

export class User {
  id!: string;
  email!: string;
  username!: string;
  passwordHash!: string;
  firstName?: string | null;
  lastName?: string | null;
  avatarUrl?: string | null;
  
  // Email verification
  emailVerified!: boolean;
  emailVerifiedAt?: Date | null;
  
  // Role and permissions
  roleId!: string;
  role?: RoleWithPermissions;
  
  // MFA
  mfaEnabled!: boolean;
  mfaSecret?: string | null;
  mfaBackupCodes?: string[];
  
  // Security
  isActive!: boolean;
  isLocked!: boolean;
  lockoutUntil?: Date | null;
  failedLoginAttempts!: number;
  lastLoginAt?: Date | null;
  lastLoginIp?: string | null;
  passwordChangedAt!: Date;
  mustChangePassword!: boolean;
  passwordHistory?: string[];
  
  // Timestamps
  createdAt!: Date;
  updatedAt!: Date;
  deletedAt?: Date | null;

  constructor(partial: Partial<User>) {
    Object.assign(this, partial);
  }

  // Helper method to check if user has specific role or higher
  hasRole(requiredRoleName: string): boolean {
    if (!this.role) return false;
    
    const roleHierarchy = {
      'VIEWER': 0,
      'ENGINEER': 1,
      'ADMIN': 2,
      'SUPER_ADMIN': 3,
    };

    const userRoleLevel = roleHierarchy[this.role.name as keyof typeof roleHierarchy] ?? 0;
    const requiredRoleLevel = roleHierarchy[requiredRoleName as keyof typeof roleHierarchy] ?? 0;

    return userRoleLevel >= requiredRoleLevel;
  }

  // Helper method to check if user can perform action on resource
  canAccess(requiredRoleName: string): boolean {
    return this.hasRole(requiredRoleName);
  }

  // Helper method to check if user has specific permission
  hasPermission(resource: string, action: string): boolean {
    if (!this.role?.permissions) return false;
    
    // SUPER_ADMIN has all permissions
    if (this.role.name === 'SUPER_ADMIN') return true;
    
    return this.role.permissions.some(
      (permission: Permission) => permission.resource === resource && permission.action === action
    );
  }

  // Helper method to get user's full name
  getFullName(): string {
    if (this.firstName && this.lastName) {
      return `${this.firstName} ${this.lastName}`;
    }
    if (this.firstName) return this.firstName;
    if (this.lastName) return this.lastName;
    return this.username;
  }

  // Helper method to check if account is locked
  isAccountLocked(): boolean {
    if (!this.isLocked) return false;
    if (!this.lockoutUntil) return this.isLocked;
    return this.lockoutUntil > new Date();
  }

  // Helper method to check if password needs to be changed
  needsPasswordChange(): boolean {
    return this.mustChangePassword;
  }

  // Helper method to get user without sensitive data
  toSafeObject() {
    const { passwordHash, mfaSecret, mfaBackupCodes, passwordHistory, ...safeUser } = this;
    return {
      ...safeUser,
      fullName: this.getFullName(),
      isAccountLocked: this.isAccountLocked(),
      needsPasswordChange: this.needsPasswordChange(),
    };
  }
}