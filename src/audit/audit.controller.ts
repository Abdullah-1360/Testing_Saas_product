import {
  Controller,
  Get,
  Query,
  Param,
  UseGuards,
  Request,
  ParseIntPipe,
  DefaultValuePipe,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/auth/guards/roles.guard';
import { Roles } from '@/auth/decorators/roles.decorator';
import { AuditService, AuditEventFilter } from './audit.service';
import { LoggerService } from '@/common/services/logger.service';

@Controller({ path: 'audit', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class AuditController {
  constructor(
    private readonly auditService: AuditService,
    private readonly logger: LoggerService,
  ) {}

  /**
   * Get audit events with filtering and pagination
   * Requires ADMIN or SUPER_ADMIN role
   */
  @Get('events')
  @Roles('ADMIN', 'SUPER_ADMIN')
  async getAuditEvents(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('userId') userId: string | undefined,
    @Query('action') action: string | undefined,
    @Query('resource') resource: string | undefined,
    @Query('resourceId') resourceId: string | undefined,
    @Query('startDate') startDate: string | undefined,
    @Query('endDate') endDate: string | undefined,
    @Query('ipAddress') ipAddress: string | undefined,
    @Query('traceId') traceId: string | undefined,
    @Query('correlationId') correlationId: string | undefined,
    @Request() req: any,
  ) {
    try {
      // Validate pagination parameters
      if (page < 1) {
        throw new BadRequestException('Page must be greater than 0');
      }
      if (limit < 1 || limit > 100) {
        throw new BadRequestException('Limit must be between 1 and 100');
      }

      // Build filter
      const filter: AuditEventFilter = {};
      
      if (userId) filter.userId = userId;
      if (action) filter.action = action;
      if (resource) filter.resource = resource;
      if (resourceId) filter.resourceId = resourceId;
      if (ipAddress) filter.ipAddress = ipAddress;
      if (traceId) filter.traceId = traceId;
      if (correlationId) filter.correlationId = correlationId;

      // Parse dates
      if (startDate) {
        const parsedStartDate = new Date(startDate);
        if (isNaN(parsedStartDate.getTime())) {
          throw new BadRequestException('Invalid startDate format');
        }
        filter.startDate = parsedStartDate;
      }

      if (endDate) {
        const parsedEndDate = new Date(endDate);
        if (isNaN(parsedEndDate.getTime())) {
          throw new BadRequestException('Invalid endDate format');
        }
        filter.endDate = parsedEndDate;
      }

      const result = await this.auditService.getAuditEvents(filter, page, limit);

      // Log the audit access
      await this.auditService.logDataAccessEvent(
        'READ',
        req.user.id,
        'AUDIT_EVENT',
        undefined,
        {
          filter,
          page,
          limit,
          resultCount: result.events.length,
        },
        req.ip,
        req.get('user-agent'),
        req.traceId,
        req.correlationId,
      );

      return {
        success: true,
        data: result,
      };
    } catch (error: unknown) {
      this.logger.error('Failed to get audit events', error instanceof Error ? error.stack : 'Unknown error', 'AuditController');
      throw error;
    }
  }

  /**
   * Get specific audit event by ID
   * Requires ADMIN or SUPER_ADMIN role
   */
  @Get('events/:id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  async getAuditEventById(
    @Param('id') id: string,
    @Request() req: any,
  ) {
    try {
      const event = await this.auditService.getAuditEventById(id);

      if (!event) {
        throw new BadRequestException('Audit event not found');
      }

      // Log the audit access
      await this.auditService.logDataAccessEvent(
        'READ',
        req.user.id,
        'AUDIT_EVENT',
        id,
        {
          eventId: id,
        },
        req.ip,
        req.get('user-agent'),
        req.traceId,
        req.correlationId,
      );

      return {
        success: true,
        data: event,
      };
    } catch (error: unknown) {
      this.logger.error('Failed to get audit event by ID', error instanceof Error ? error.stack : 'Unknown error', 'AuditController');
      throw error;
    }
  }

  /**
   * Get audit statistics
   * Requires ADMIN or SUPER_ADMIN role
   */
  @Get('statistics')
  @Roles('ADMIN', 'SUPER_ADMIN')
  async getAuditStatistics(
    @Query('startDate') startDate: string | undefined,
    @Query('endDate') endDate: string | undefined,
    @Request() req: any,
  ) {
    try {
      // Parse dates
      let parsedStartDate: Date | undefined;
      let parsedEndDate: Date | undefined;

      if (startDate) {
        parsedStartDate = new Date(startDate);
        if (isNaN(parsedStartDate.getTime())) {
          throw new BadRequestException('Invalid startDate format');
        }
      }

      if (endDate) {
        parsedEndDate = new Date(endDate);
        if (isNaN(parsedEndDate.getTime())) {
          throw new BadRequestException('Invalid endDate format');
        }
      }

      const statistics = await this.auditService.getAuditStatistics(
        parsedStartDate,
        parsedEndDate,
      );

      // Log the statistics access
      await this.auditService.logDataAccessEvent(
        'READ',
        req.user.id,
        'AUDIT_STATISTICS',
        undefined,
        {
          startDate: parsedStartDate?.toISOString(),
          endDate: parsedEndDate?.toISOString(),
          totalEvents: statistics.totalEvents,
        },
        req.ip,
        req.get('user-agent'),
        req.traceId,
        req.correlationId,
      );

      return {
        success: true,
        data: statistics,
      };
    } catch (error: unknown) {
      this.logger.error('Failed to get audit statistics', error instanceof Error ? error.stack : 'Unknown error', 'AuditController');
      throw error;
    }
  }

  /**
   * Get audit events for current user
   * All authenticated users can access their own audit trail
   */
  @Get('my-events')
  async getMyAuditEvents(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('action') action: string | undefined,
    @Query('resource') resource: string | undefined,
    @Query('startDate') startDate: string | undefined,
    @Query('endDate') endDate: string | undefined,
    @Request() req: any,
  ) {
    try {
      // Validate pagination parameters
      if (page < 1) {
        throw new BadRequestException('Page must be greater than 0');
      }
      if (limit < 1 || limit > 100) {
        throw new BadRequestException('Limit must be between 1 and 100');
      }

      // Build filter for current user only
      const filter: AuditEventFilter = {
        userId: req.user.id,
      };
      
      if (action) filter.action = action;
      if (resource) filter.resource = resource;

      // Parse dates
      if (startDate) {
        const parsedStartDate = new Date(startDate);
        if (isNaN(parsedStartDate.getTime())) {
          throw new BadRequestException('Invalid startDate format');
        }
        filter.startDate = parsedStartDate;
      }

      if (endDate) {
        const parsedEndDate = new Date(endDate);
        if (isNaN(parsedEndDate.getTime())) {
          throw new BadRequestException('Invalid endDate format');
        }
        filter.endDate = parsedEndDate;
      }

      const result = await this.auditService.getAuditEvents(filter, page, limit);

      // Log the audit access (but don't create infinite loop)
      if (action !== 'DATA_READ' || resource !== 'AUDIT_EVENT') {
        await this.auditService.logDataAccessEvent(
          'READ',
          req.user.id,
          'AUDIT_EVENT',
          undefined,
          {
            filter: 'own_events',
            page,
            limit,
            resultCount: result.events.length,
          },
          req.ip,
          req.get('user-agent'),
          req.traceId,
          req.correlationId,
        );
      }

      return {
        success: true,
        data: result,
      };
    } catch (error: unknown) {
      this.logger.error('Failed to get user audit events', error instanceof Error ? error.stack : 'Unknown error', 'AuditController');
      throw error;
    }
  }

  /**
   * Get available audit actions for filtering
   * Requires ADMIN or SUPER_ADMIN role
   */
  @Get('actions')
  @Roles('ADMIN', 'SUPER_ADMIN')
  async getAuditActions() {
    try {
      // Get distinct actions from database
      const actions = await this.auditService['prisma'].auditEvent.findMany({
        select: {
          action: true,
        },
        distinct: ['action'],
        orderBy: {
          action: 'asc',
        },
      });

      const actionList = actions.map(a => a.action);

      return {
        success: true,
        data: {
          actions: actionList,
          categories: {
            authentication: actionList.filter(a => a.startsWith('AUTH_')),
            authorization: actionList.filter(a => a.startsWith('AUTHZ_')),
            data_access: actionList.filter(a => a.startsWith('DATA_')),
            system: actionList.filter(a => a.startsWith('SYSTEM_')),
            security: actionList.filter(a => a.startsWith('SECURITY_')),
            incident: actionList.filter(a => a.startsWith('INCIDENT_')),
            ssh: actionList.filter(a => a.includes('SSH')),
          },
        },
      };
    } catch (error: unknown) {
      this.logger.error('Failed to get audit actions', error instanceof Error ? error.stack : 'Unknown error', 'AuditController');
      throw error;
    }
  }

  /**
   * Get available resource types for filtering
   * Requires ADMIN or SUPER_ADMIN role
   */
  @Get('resource-types')
  @Roles('ADMIN', 'SUPER_ADMIN')
  async getResourceTypes() {
    try {
      // Get distinct resource types from database
      const resources = await this.auditService['prisma'].auditEvent.findMany({
        select: {
          resource: true,
        },
        distinct: ['resource'],
        orderBy: {
          resource: 'asc',
        },
      });

      return {
        success: true,
        data: {
          resources: resources.map(r => r.resource),
        },
      };
    } catch (error: unknown) {
      this.logger.error('Failed to get resource types', error instanceof Error ? error.stack : 'Unknown error', 'AuditController');
      throw error;
    }
  }
}