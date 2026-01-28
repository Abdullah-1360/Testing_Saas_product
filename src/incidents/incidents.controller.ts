import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  HttpStatus,
  HttpCode,
  UseGuards,
  Logger,
  BadRequestException,
  NotFoundException,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery, ApiParam } from '@nestjs/swagger';
import { IncidentsService } from './incidents.service';
import { CreateIncidentDto } from './dto/create-incident.dto';
import { UpdateIncidentDto } from './dto/update-incident.dto';
import { CreateIncidentEventDto } from './dto/create-incident-event.dto';
import { IncidentTimelineQueryDto } from './dto/incident-timeline.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '@/users/entities/user.entity';
import { IncidentState, Priority, TriggerType } from '@prisma/client';
import { VersionedApiController, ApiResponseFormat, PaginationQuery } from '@/common/controllers/versioned-api.controller';
import { SkipTransform } from '@/common/decorators/skip-transform.decorator';

@ApiTags('incidents')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'incidents', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@SkipTransform()
export class IncidentsController extends VersionedApiController {
  private readonly logger = new Logger(IncidentsController.name);

  constructor(private readonly incidentsService: IncidentsService) {
    super();
  }

  /**
   * Create a new incident
   * Requires: ADMIN, ENGINEER roles
   */
  @Post()
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new incident' })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Incident created successfully',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 201 },
        message: { type: 'string', example: 'Incident created successfully' },
        data: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'uuid' },
            siteId: { type: 'string', example: 'uuid' },
            state: { type: 'string', example: 'NEW' },
            triggerType: { type: 'string', example: 'MANUAL' },
            priority: { type: 'string', example: 'MEDIUM' },
            fixAttempts: { type: 'number', example: 0 },
            maxFixAttempts: { type: 'number', example: 15 },
            createdAt: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
            updatedAt: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
          },
        },
        timestamp: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
      },
    },
  })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid incident data' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Site not found' })
  async create(
    @Body() createIncidentDto: CreateIncidentDto,
    @CurrentUser() user: User,
  ): Promise<ApiResponseFormat> {
    try {
      const incident = await this.incidentsService.create(createIncidentDto);
      
      return this.createResponse(
        incident,
        this.getStandardMessages().created,
        HttpStatus.CREATED
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to create incident: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Get all incidents with filtering and pagination
   * Requires: All authenticated users
   */
  @Get()
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER', 'VIEWER')
  @ApiOperation({ summary: 'Get all incidents with filtering and pagination' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (default: 10, max: 100)' })
  @ApiQuery({ name: 'siteId', required: false, type: String, description: 'Filter by site ID' })
  @ApiQuery({ name: 'state', required: false, enum: IncidentState, description: 'Filter by incident state' })
  @ApiQuery({ name: 'priority', required: false, enum: Priority, description: 'Filter by priority' })
  @ApiQuery({ name: 'triggerType', required: false, enum: TriggerType, description: 'Filter by trigger type' })
  @ApiQuery({ name: 'search', required: false, type: String, description: 'Search incidents' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Incidents retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 200 },
        message: { type: 'string', example: 'Incidents retrieved successfully' },
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', example: 'uuid' },
              siteId: { type: 'string', example: 'uuid' },
              state: { type: 'string', example: 'NEW' },
              triggerType: { type: 'string', example: 'MANUAL' },
              priority: { type: 'string', example: 'MEDIUM' },
              fixAttempts: { type: 'number', example: 0 },
              maxFixAttempts: { type: 'number', example: 15 },
              createdAt: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
              updatedAt: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
              resolvedAt: { type: 'string', nullable: true, example: null },
              escalatedAt: { type: 'string', nullable: true, example: null },
            },
          },
        },
        pagination: {
          type: 'object',
          properties: {
            page: { type: 'number', example: 1 },
            limit: { type: 'number', example: 10 },
            total: { type: 'number', example: 25 },
            totalPages: { type: 'number', example: 3 },
          },
        },
        timestamp: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
      },
    },
  })
  async findAll(
    @CurrentUser() user: User,
    @Query() query: PaginationQuery & {
      siteId?: string;
      state?: IncidentState;
      priority?: Priority;
      triggerType?: TriggerType;
    }
  ): Promise<ApiResponseFormat> {
    const { page, limit, skip } = this.parsePaginationQuery(query);
    const filters = this.parseFilterQuery(query);

    try {
      const { incidents, total } = await this.incidentsService.findAllPaginated(skip, limit, filters);
      
      return this.createPaginatedResponse(incidents, total, page, limit);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to fetch incidents: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Get incident by ID with full details
   * Requires: All authenticated users
   */
  @Get(':id')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER', 'VIEWER')
  async findOne(@Param('id') id: string, @CurrentUser() user: User) {
    try {
      const incident = await this.incidentsService.findOne(id);
      
      if (!incident) {
        throw new NotFoundException(`Incident with ID ${id} not found`);
      }

      return {
        success: true,
        data: incident,
        message: 'Incident retrieved successfully',
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to fetch incident ${id}: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Update incident
   * Requires: ADMIN, ENGINEER roles
   */
  @Patch(':id')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER')
  async update(
    @Param('id') id: string,
    @Body() updateIncidentDto: UpdateIncidentDto,
    @CurrentUser() user: User,
  ) {
    try {
      const incident = await this.incidentsService.update(id, updateIncidentDto);
      
      return {
        success: true,
        data: incident,
        message: 'Incident updated successfully',
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to update incident ${id}: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Delete incident
   * Requires: SUPER_ADMIN, ADMIN roles only
   */
  @Delete(':id')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string, @CurrentUser() user: User) {
    try {
      await this.incidentsService.remove(id);
      
      return {
        success: true,
        message: 'Incident deleted successfully',
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to delete incident ${id}: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Create incident event (append-only logging)
   * Requires: ADMIN, ENGINEER roles
   */
  @Post(':id/events')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER')
  @HttpCode(HttpStatus.CREATED)
  async createEvent(
    @Param('id') incidentId: string,
    @Body() createEventDto: Omit<CreateIncidentEventDto, 'incidentId'>,
    @CurrentUser() user: User,
  ) {
    const eventDto: CreateIncidentEventDto = {
      ...createEventDto,
      incidentId,
    };

    try {
      const event = await this.incidentsService.createEvent(eventDto);
      
      return {
        success: true,
        data: event,
        message: 'Incident event created successfully',
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to create event for incident ${incidentId}: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Get incident timeline
   * Requires: All authenticated users
   */
  @Get(':id/timeline')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER', 'VIEWER')
  async getTimeline(
    @Param('id') incidentId: string,
    @Query() query: Omit<IncidentTimelineQueryDto, 'incidentId'>,
    @CurrentUser() user: User,
  ) {
    const timelineQuery: IncidentTimelineQueryDto = {
      ...query,
      incidentId,
    };

    try {
      const timeline = await this.incidentsService.getTimeline(timelineQuery);
      
      return {
        success: true,
        data: timeline,
        message: `Found ${timeline.length} timeline events`,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to fetch timeline for incident ${incidentId}: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Escalate incident
   * Requires: ADMIN, ENGINEER roles
   */
  @Post(':id/escalate')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER')
  async escalate(
    @Param('id') id: string,
    @Body('reason') reason: string,
    @CurrentUser() user: User,
  ) {
    if (!reason || reason.trim().length === 0) {
      throw new BadRequestException('Escalation reason is required');
    }

    try {
      const escalationTicket = await this.incidentsService.escalateIncident(id, reason);
      
      return {
        success: true,
        data: escalationTicket,
        message: 'Incident escalated successfully',
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to escalate incident ${id}: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Generate ticket payload for external systems
   * Requires: ADMIN, ENGINEER roles
   */
  @Get(':id/ticket-payload')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER')
  async generateTicketPayload(@Param('id') id: string, @CurrentUser() user: User) {
    try {
      const ticketPayload = await this.incidentsService.generateTicketPayload(id);
      
      return {
        success: true,
        data: ticketPayload,
        message: 'Ticket payload generated successfully',
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to generate ticket payload for incident ${id}: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Get incident statistics
   * Requires: All authenticated users
   */
  @Get('stats/overview')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER', 'VIEWER')
  async getStatistics(
    @CurrentUser() user: User,
    @Query('siteId') siteId?: string,
  ) {
    try {
      const stats = await this.incidentsService.getStatistics(siteId);
      
      return {
        success: true,
        data: stats,
        message: 'Statistics retrieved successfully',
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to fetch incident statistics: ${errorMessage}`);
      throw error;
    }
  }
}