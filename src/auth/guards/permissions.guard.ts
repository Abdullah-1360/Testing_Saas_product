import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { User } from '@/users/entities/user.entity';
import {
  PERMISSIONS_KEY,
  RESOURCE_KEY,
  ACTION_KEY,
  Permission,
} from '@/auth/decorators/permissions.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly logger = new Logger(PermissionsGuard.name);

  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user as User;

    if (!user) {
      throw new ForbiddenException('User not authenticated');
    }

    // Get required permissions from decorators
    const requiredPermissions = this.reflector.getAllAndOverride<Permission[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()]
    );

    const resource = this.reflector.getAllAndOverride<string>(
      RESOURCE_KEY,
      [context.getHandler(), context.getClass()]
    );

    const action = this.reflector.getAllAndOverride<string>(
      ACTION_KEY,
      [context.getHandler(), context.getClass()]
    );

    // If no permissions are specified, allow access (handled by role guard)
    if (!requiredPermissions && !resource && !action) {
      return true;
    }

    // Build permissions list from individual resource/action or permissions array
    const permissions: Permission[] = [];
    
    if (requiredPermissions) {
      permissions.push(...requiredPermissions);
    }
    
    if (resource && action) {
      permissions.push({ resource, action });
    }

    // Check if user has required permissions
    const hasPermission = this.checkUserPermissions(user, permissions, request);

    if (!hasPermission) {
      this.logger.warn({
        message: 'Permission denied',
        userId: user.id,
        userRole: user.role,
        requiredPermissions: permissions,
        endpoint: request.url,
        method: request.method,
        timestamp: new Date().toISOString(),
      });

      throw new ForbiddenException('Insufficient permissions for this operation');
    }

    return true;
  }

  private checkUserPermissions(
    user: User,
    requiredPermissions: Permission[],
    request: any
  ): boolean {
    // Check if user has the required permissions through their role
    for (const required of requiredPermissions) {
      const hasPermission = user.hasPermission(required.resource, required.action);
      if (!hasPermission) {
        return false;
      }
    }

    return true;
  }

  private matchesPermission(
    userPermission: Permission,
    requiredPermission: Permission,
    user: User,
    request: any
  ): boolean {
    // Check resource and action match
    if (
      userPermission.resource !== requiredPermission.resource ||
      userPermission.action !== requiredPermission.action
    ) {
      return false;
    }

    // Check additional conditions if specified
    if (requiredPermission.conditions) {
      return this.checkConditions(requiredPermission.conditions, user, request);
    }

    return true;
  }

  private checkConditions(
    conditions: Record<string, any>,
    user: User,
    request: any
  ): boolean {
    // Handle ownership conditions
    if (conditions.owner) {
      const resourceId = request.params?.id || request.body?.id;
      
      // For user resources, check if user is accessing their own data
      if (conditions.owner === 'self' && resourceId === user.id) {
        return true;
      }
      
      // For other ownership checks, would need to query the database
      // This is a simplified implementation
      return false;
    }

    // Handle role-based conditions
    if (conditions.minRole) {
      return user.hasRole(conditions.minRole);
    }

    // Handle custom conditions
    if (conditions.custom) {
      return this.evaluateCustomCondition(conditions.custom, user, request);
    }

    return true;
  }

  private evaluateCustomCondition(
    condition: string,
    user: User,
    request: any
  ): boolean {
    // Implement custom condition logic based on your requirements
    switch (condition) {
      case 'can_modify_super_admin':
        // Only super admins can modify other super admin accounts
        return user.role?.name === 'SUPER_ADMIN';
      
      case 'can_delete_self':
        // Users cannot delete their own accounts
        const targetUserId = request.params?.id;
        return targetUserId !== user.id;
      
      case 'can_escalate_incident':
        // Engineers and above can escalate incidents
        return user.hasRole('ENGINEER');
      
      default:
        return false;
    }
  }
}