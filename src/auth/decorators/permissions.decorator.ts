import { SetMetadata } from '@nestjs/common';

export interface Permission {
  resource: string;
  action: string;
  conditions?: Record<string, any>;
}

export const PERMISSIONS_KEY = 'permissions';
export const RESOURCE_KEY = 'resource';
export const ACTION_KEY = 'action';

/**
 * Decorator to define required permissions for an endpoint
 */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

/**
 * Decorator to define the resource being accessed
 */
export const Resource = (resource: string) =>
  SetMetadata(RESOURCE_KEY, resource);

/**
 * Decorator to define the action being performed
 */
export const Action = (action: string) =>
  SetMetadata(ACTION_KEY, action);

/**
 * Combined decorator for resource and action
 */
export const RequirePermission = (resource: string, action: string, conditions?: Record<string, any>) =>
  RequirePermissions({ resource, action, conditions });

/**
 * Predefined permission sets for common operations
 */
export const PermissionSets = {
  // User management permissions
  USER_READ: { resource: 'user', action: 'read' },
  USER_CREATE: { resource: 'user', action: 'create' },
  USER_UPDATE: { resource: 'user', action: 'update' },
  USER_DELETE: { resource: 'user', action: 'delete' },
  USER_MANAGE_ROLES: { resource: 'user', action: 'manage_roles' },

  // Server management permissions
  SERVER_READ: { resource: 'server', action: 'read' },
  SERVER_CREATE: { resource: 'server', action: 'create' },
  SERVER_UPDATE: { resource: 'server', action: 'update' },
  SERVER_DELETE: { resource: 'server', action: 'delete' },
  SERVER_CONNECT: { resource: 'server', action: 'connect' },
  SERVER_DISCOVER: { resource: 'server', action: 'discover' },

  // Site management permissions
  SITE_READ: { resource: 'site', action: 'read' },
  SITE_CREATE: { resource: 'site', action: 'create' },
  SITE_UPDATE: { resource: 'site', action: 'update' },
  SITE_DELETE: { resource: 'site', action: 'delete' },
  SITE_HEALTH_CHECK: { resource: 'site', action: 'health_check' },

  // Incident management permissions
  INCIDENT_READ: { resource: 'incident', action: 'read' },
  INCIDENT_CREATE: { resource: 'incident', action: 'create' },
  INCIDENT_UPDATE: { resource: 'incident', action: 'update' },
  INCIDENT_DELETE: { resource: 'incident', action: 'delete' },
  INCIDENT_ESCALATE: { resource: 'incident', action: 'escalate' },
  INCIDENT_RESOLVE: { resource: 'incident', action: 'resolve' },

  // Audit permissions
  AUDIT_READ: { resource: 'audit', action: 'read' },
  AUDIT_EXPORT: { resource: 'audit', action: 'export' },

  // System configuration permissions
  CONFIG_READ: { resource: 'config', action: 'read' },
  CONFIG_UPDATE: { resource: 'config', action: 'update' },
  CONFIG_RETENTION: { resource: 'config', action: 'retention' },

  // Evidence and backup permissions
  EVIDENCE_READ: { resource: 'evidence', action: 'read' },
  EVIDENCE_DELETE: { resource: 'evidence', action: 'delete' },
  BACKUP_READ: { resource: 'backup', action: 'read' },
  BACKUP_CREATE: { resource: 'backup', action: 'create' },
  BACKUP_RESTORE: { resource: 'backup', action: 'restore' },
};