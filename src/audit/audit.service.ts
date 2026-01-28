import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { RedactionService } from '@/common/services/redaction.service';
import { AuditEvent, Prisma } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

export interface CreateAuditEventDto {
  userId?: string | undefined;
  action: string;
  resource: string;
  resourceId?: string | undefined;
  details?: Record<string, any> | undefined;
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
  traceId?: string | undefined;
  correlationId?: string | undefined;
}

export interface AuditEventFilter {
  userId?: string;
  action?: string;
  resource?: string;
  resourceId?: string;
  startDate?: Date;
  endDate?: Date;
  ipAddress?: string;
  traceId?: string;
  correlationId?: string;
}

export interface PaginatedAuditEvents {
  events: AuditEvent[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redactionService: RedactionService,
  ) {}

  /**
   * Generate a unique trace ID for operation tracking
   */
  generateTraceId(): string {
    return `trace-${Date.now()}-${uuidv4().substring(0, 8)}`;
  }

  /**
   * Generate a unique correlation ID for request tracking
   */
  generateCorrelationId(): string {
    return `corr-${Date.now()}-${uuidv4().substring(0, 8)}`;
  }

  /**
   * Create an audit event
   */
  async createAuditEvent(data: CreateAuditEventDto): Promise<AuditEvent> {
    try {
      // Redact sensitive information from details
      const redactedDetails = data.details 
        ? this.redactionService.redactObject(data.details)
        : null;

      // Ensure trace ID and correlation ID are present
      const traceId = data.traceId || this.generateTraceId();
      const correlationId = data.correlationId || this.generateCorrelationId();

      // Add trace and correlation IDs to details
      const enhancedDetails = {
        ...redactedDetails,
        traceId,
        correlationId,
        timestamp: new Date().toISOString(),
      };

      const auditEvent = await this.prisma.auditEvent.create({
        data: {
          userId: data.userId || null,
          action: data.action,
          resource: data.resource,
          resourceId: data.resourceId || null,
          description: `${data.action} on ${data.resource}`,
          metadata: enhancedDetails,
          ipAddress: data.ipAddress || null,
          userAgent: data.userAgent || null,
          severity: 'INFO',
        },
      });

      this.logger.log(`Audit event created: ${data.action} on ${data.resource}`, {
        auditEventId: auditEvent.id,
        traceId,
        correlationId,
        userId: data.userId,
        resource: data.resource,
        resourceId: data.resourceId,
      });

      return auditEvent;
    } catch (error: unknown) {
      this.logger.error('Failed to create audit event', {
        error: error instanceof Error ? error.message : 'Unknown error',
        data: this.redactionService.redactObject(data),
      });
      throw error;
    }
  }

  /**
   * Get audit events with filtering and pagination
   */
  async getAuditEvents(
    filter: AuditEventFilter = {},
    page: number = 1,
    limit: number = 50,
  ): Promise<PaginatedAuditEvents> {
    try {
      const skip = (page - 1) * limit;
      
      // Build where clause
      const where: Prisma.AuditEventWhereInput = {};
      
      if (filter.userId) {
        where.userId = filter.userId;
      }
      
      if (filter.action) {
        where.action = {
          contains: filter.action,
          mode: 'insensitive',
        };
      }
      
      if (filter.resource) {
        where.resource = filter.resource;
      }
      
      if (filter.resourceId) {
        where.resourceId = filter.resourceId;
      }
      
      if (filter.ipAddress) {
        where.ipAddress = filter.ipAddress;
      }
      
      if (filter.startDate || filter.endDate) {
        where.timestamp = {};
        if (filter.startDate) {
          where.timestamp.gte = filter.startDate;
        }
        if (filter.endDate) {
          where.timestamp.lte = filter.endDate;
        }
      }

      // Handle trace ID and correlation ID filtering through metadata JSON
      if (filter.traceId) {
        where.metadata = {
          path: ['traceId'],
          equals: filter.traceId,
        };
      }

      if (filter.correlationId) {
        where.metadata = {
          path: ['correlationId'],
          equals: filter.correlationId,
        };
      }

      // Get total count and events
      const [total, events] = await Promise.all([
        this.prisma.auditEvent.count({ where }),
        this.prisma.auditEvent.findMany({
          where,
          include: {
            user: {
              select: {
                id: true,
                email: true,
                role: true,
              },
            },
          },
          orderBy: {
            timestamp: 'desc',
          },
          skip,
          take: limit,
        }),
      ]);

      // Redact sensitive information from events
      const redactedEvents = events.map(event => ({
        ...event,
        metadata: event.metadata ? this.redactionService.redactObject(event.metadata) : null,
        userAgent: event.userAgent ? this.redactionService.redactText(event.userAgent) : null,
      }));

      return {
        events: redactedEvents,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    } catch (error: unknown) {
      this.logger.error('Failed to get audit events', {
        error: error instanceof Error ? error.message : 'Unknown error',
        filter: this.redactionService.redactObject(filter),
      });
      throw error;
    }
  }

  /**
   * Get audit event by ID
   */
  async getAuditEventById(id: string): Promise<AuditEvent | null> {
    try {
      const event = await this.prisma.auditEvent.findUnique({
        where: { id },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              role: true,
            },
          },
        },
      });

      if (!event) {
        return null;
      }

      // Redact sensitive information
      return {
        ...event,
        metadata: event.metadata ? this.redactionService.redactObject(event.metadata) : null,
        userAgent: event.userAgent ? this.redactionService.redactText(event.userAgent) : null,
      };
    } catch (error: unknown) {
      this.logger.error('Failed to get audit event by ID', {
        error: error instanceof Error ? error.message : 'Unknown error',
        id,
      });
      throw error;
    }
  }

  /**
   * Log authentication events
   */
  async logAuthenticationEvent(
    action: 'LOGIN' | 'LOGOUT' | 'LOGIN_FAILED' | 'MFA_ENABLED' | 'MFA_DISABLED' | 'PASSWORD_CHANGED',
    userId?: string | undefined,
    details: Record<string, any> = {},
    ipAddress?: string | undefined,
    userAgent?: string | undefined,
    traceId?: string | undefined,
    correlationId?: string | undefined,
  ): Promise<AuditEvent> {
    return this.createAuditEvent({
      userId: userId || undefined,
      action: `AUTH_${action}`,
      resource: 'USER',
      resourceId: userId || undefined,
      details: {
        ...details,
        category: 'authentication',
      },
      ipAddress: ipAddress || undefined,
      userAgent: userAgent || undefined,
      traceId: traceId || undefined,
      correlationId: correlationId || undefined,
    });
  }

  /**
   * Log authorization events
   */
  async logAuthorizationEvent(
    action: 'ACCESS_GRANTED' | 'ACCESS_DENIED',
    userId: string,
    resource: string,
    resourceId?: string | undefined,
    details: Record<string, any> = {},
    ipAddress?: string | undefined,
    userAgent?: string | undefined,
    traceId?: string | undefined,
    correlationId?: string | undefined,
  ): Promise<AuditEvent> {
    return this.createAuditEvent({
      userId,
      action: `AUTHZ_${action}`,
      resource: resource,
      resourceId: resourceId || undefined,
      details: {
        ...details,
        category: 'authorization',
      },
      ipAddress: ipAddress || undefined,
      userAgent: userAgent || undefined,
      traceId: traceId || undefined,
      correlationId: correlationId || undefined,
    });
  }

  /**
   * Log data access events
   */
  async logDataAccessEvent(
    action: 'READ' | 'CREATE' | 'UPDATE' | 'DELETE',
    userId: string,
    resource: string,
    resourceId?: string | undefined,
    details: Record<string, any> = {},
    ipAddress?: string | undefined,
    userAgent?: string | undefined,
    traceId?: string | undefined,
    correlationId?: string | undefined,
  ): Promise<AuditEvent> {
    return this.createAuditEvent({
      userId,
      action: `DATA_${action}`,
      resource: resource,
      resourceId: resourceId || undefined,
      details: {
        ...details,
        category: 'data_access',
      },
      ipAddress: ipAddress || undefined,
      userAgent: userAgent || undefined,
      traceId: traceId || undefined,
      correlationId: correlationId || undefined,
    });
  }

  /**
   * Log system events
   */
  async logSystemEvent(
    action: string,
    details: Record<string, any> = {},
    userId?: string | undefined,
    traceId?: string | undefined,
    correlationId?: string | undefined,
  ): Promise<AuditEvent> {
    return this.createAuditEvent({
      userId: userId || undefined,
      action: `SYSTEM_${action}`,
      resource: 'SYSTEM',
      details: {
        ...details,
        category: 'system',
      },
      traceId: traceId || undefined,
      correlationId: correlationId || undefined,
    });
  }

  /**
   * Log security events
   */
  async logSecurityEvent(
    action: string,
    details: Record<string, any> = {},
    userId?: string | undefined,
    ipAddress?: string | undefined,
    userAgent?: string | undefined,
    traceId?: string | undefined,
    correlationId?: string | undefined,
  ): Promise<AuditEvent> {
    return this.createAuditEvent({
      userId: userId || undefined,
      action: `SECURITY_${action}`,
      resource: 'SECURITY',
      details: {
        ...details,
        category: 'security',
        severity: 'high',
      },
      ipAddress: ipAddress || undefined,
      userAgent: userAgent || undefined,
      traceId: traceId || undefined,
      correlationId: correlationId || undefined,
    });
  }

  /**
   * Log incident events
   */
  async logIncidentEvent(
    action: string,
    incidentId: string,
    details: Record<string, any> = {},
    userId?: string | undefined,
    traceId?: string | undefined,
    correlationId?: string | undefined,
  ): Promise<AuditEvent> {
    return this.createAuditEvent({
      userId: userId || undefined,
      action: `INCIDENT_${action}`,
      resource: 'INCIDENT',
      resourceId: incidentId,
      details: {
        ...details,
        category: 'incident',
      },
      traceId: traceId || undefined,
      correlationId: correlationId || undefined,
    });
  }

  /**
   * Log SSH command execution events
   */
  async logSSHCommandEvent(
    command: string,
    serverId: string,
    result: {
      stdout?: string | undefined;
      stderr?: string | undefined;
      exitCode?: number | undefined;
      executionTime?: number | undefined;
    },
    userId?: string | undefined,
    incidentId?: string | undefined,
    traceId?: string | undefined,
    correlationId?: string | undefined,
  ): Promise<AuditEvent> {
    return this.createAuditEvent({
      userId: userId || undefined,
      action: 'SSH_COMMAND_EXECUTED',
      resource: 'SERVER',
      resourceId: serverId,
      details: {
        command: this.redactionService.redactCommand(command),
        result: this.redactionService.redactObject(result),
        incidentId: incidentId || undefined,
        category: 'ssh_command',
      },
      traceId: traceId || undefined,
      correlationId: correlationId || undefined,
    });
  }

  /**
   * Get audit statistics
   */
  async getAuditStatistics(
    startDate?: Date,
    endDate?: Date,
  ): Promise<{
    totalEvents: number;
    eventsByAction: Record<string, number>;
    eventsByResourceType: Record<string, number>;
    eventsByUser: Record<string, number>;
    recentEvents: AuditEvent[];
  }> {
    try {
      const where: Prisma.AuditEventWhereInput = {};
      
      if (startDate || endDate) {
        where.timestamp = {};
        if (startDate) {
          where.timestamp.gte = startDate;
        }
        if (endDate) {
          where.timestamp.lte = endDate;
        }
      }

      const [
        totalEvents,
        eventsByAction,
        eventsByResourceType,
        eventsByUser,
        recentEvents,
      ] = await Promise.all([
        this.prisma.auditEvent.count({ where }),
        this.prisma.auditEvent.groupBy({
          by: ['action'],
          where,
          _count: {
            action: true,
          },
        }),
        this.prisma.auditEvent.groupBy({
          by: ['resource'],
          where,
          _count: {
            resource: true,
          },
        }),
        this.prisma.auditEvent.groupBy({
          by: ['userId'],
          where: {
            ...where,
            userId: { not: null },
          },
          _count: {
            userId: true,
          },
        }),
        this.prisma.auditEvent.findMany({
          where,
          orderBy: {
            timestamp: 'desc',
          },
          take: 10,
          include: {
            user: {
              select: {
                email: true,
              },
            },
          },
        }),
      ]);

      return {
        totalEvents,
        eventsByAction: eventsByAction.reduce((acc, item) => {
          acc[item.action] = item._count.action;
          return acc;
        }, {} as Record<string, number>),
        eventsByResourceType: eventsByResourceType.reduce((acc, item) => {
          acc[item.resource] = item._count.resource;
          return acc;
        }, {} as Record<string, number>),
        eventsByUser: eventsByUser.reduce((acc, item) => {
          acc[item.userId!] = item._count.userId;
          return acc;
        }, {} as Record<string, number>),
        recentEvents: recentEvents.map(event => ({
          ...event,
          metadata: event.metadata ? this.redactionService.redactObject(event.metadata) : null,
        })),
      };
    } catch (error: unknown) {
      this.logger.error('Failed to get audit statistics', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }
}