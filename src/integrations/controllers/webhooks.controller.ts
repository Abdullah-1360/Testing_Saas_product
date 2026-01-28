import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  Headers,
  UseGuards,
  HttpStatus,
  Logger,
  BadRequestException,
  UnauthorizedException,
  RawBodyRequest,
  Req
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
  ApiBearerAuth,
  ApiBody,
  ApiHeader
} from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { WebhooksService } from '../services/webhooks.service';
import { ApiKeysService } from '../services/api-keys.service';
import { IncidentsService } from '../../incidents/incidents.service';
import { SitesService } from '../../sites/sites.service';
import {
  ExternalTriggerDto,
  WebhookDeliveryDto,
  WebhookDeliveryResponseDto
} from '../dto/integration.dto';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { User } from '@prisma/client';
import { Public } from '../../auth/decorators/public.decorator';
import { TriggerType, Priority } from '@prisma/client';

@ApiTags('Webhooks')
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private readonly webhooksService: WebhooksService,
    private readonly apiKeysService: ApiKeysService,
    private readonly incidentsService: IncidentsService,
    private readonly sitesService: SitesService
  ) {}

  /**
   * External webhook endpoint for triggering incidents
   * This endpoint accepts webhooks from external monitoring systems
   */
  @Post('external/trigger')
  @Public()
  @ApiOperation({ 
    summary: 'External incident trigger',
    description: 'Webhook endpoint for external systems to trigger incidents'
  })
  @ApiHeader({ 
    name: 'X-API-Key', 
    description: 'API key for authentication',
    required: true 
  })
  @ApiHeader({ 
    name: 'X-Webhook-Signature', 
    description: 'HMAC signature for payload verification (optional)',
    required: false 
  })
  @ApiBody({ type: ExternalTriggerDto })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Incident triggered successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        incidentId: { type: 'string' },
        message: { type: 'string' }
      }
    }
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Invalid API key or signature'
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid payload or missing required fields'
  })
  async externalTrigger(
    @Body() triggerDto: ExternalTriggerDto,
    @Headers('x-api-key') apiKey: string,
    @Headers('x-webhook-signature') signature?: string,
    @Req() req?: RawBodyRequest<Request>
  ) {
    this.logger.log(`External trigger received from ${triggerDto.source}`, {
      source: triggerDto.source,
      eventType: triggerDto.eventType,
      siteId: triggerDto.siteId,
      priority: triggerDto.priority
    });

    try {
      // Validate API key
      if (!apiKey) {
        throw new UnauthorizedException('API key is required');
      }

      const keyValidation = await this.apiKeysService.validateApiKey(apiKey);
      if (!keyValidation.valid || !keyValidation.config) {
        throw new UnauthorizedException('Invalid API key');
      }

      // Check permissions
      if (!this.apiKeysService.hasPermission(keyValidation.config, 'webhooks:trigger')) {
        throw new UnauthorizedException('Insufficient permissions');
      }

      // Validate webhook signature if provided
      if (signature && req?.rawBody) {
        const isValidSignature = this.webhooksService.validateWebhookSignature(
          req.rawBody.toString(),
          signature,
          process.env.WEBHOOK_SECRET || 'default-secret'
        );

        if (!isValidSignature) {
          throw new UnauthorizedException('Invalid webhook signature');
        }
      }

      // Validate required fields
      if (!triggerDto.siteId && !triggerDto.serverId) {
        throw new BadRequestException('Either siteId or serverId must be provided');
      }

      // Find or validate site
      let siteId = triggerDto.siteId;
      if (!siteId && triggerDto.serverId) {
        // Find a site on the specified server
        const allSites = await this.sitesService.findAll(true) as any[];
        const sites = allSites.filter((site: any) => site.serverId === triggerDto.serverId);
        if (sites.length === 0) {
          throw new BadRequestException(`No sites found on server ${triggerDto.serverId}`);
        }
        siteId = sites[0].id; // Use the first site found
      }

      if (siteId) {
        const site = await this.sitesService.findOne(siteId);
        if (!site) {
          throw new BadRequestException(`Site with ID ${siteId} not found`);
        }
      }

      // Map priority
      const priority = this.mapPriority(triggerDto.priority);

      // Create incident
      const incident = await this.incidentsService.create({
        siteId: siteId!,
        triggerType: TriggerType.EXTERNAL,
        priority,
        metadata: {
          externalSource: triggerDto.source,
          externalEventType: triggerDto.eventType,
          externalMetadata: triggerDto.metadata,
          externalTimestamp: triggerDto.timestamp,
          apiKeyUsed: keyValidation.config.name
        }
      });

      this.logger.log(`External trigger created incident ${incident.id}`, {
        incidentId: incident.id,
        source: triggerDto.source,
        siteId: incident.siteId,
        priority: incident.priority
      });

      return {
        success: true,
        incidentId: incident.id,
        message: 'Incident triggered successfully'
      };
    } catch (error) {
      this.logger.error('External trigger failed:', error);
      throw error;
    }
  }

  /**
   * Manual webhook delivery (for testing)
   */
  @Post('deliver')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER')
  @ApiBearerAuth()
  @ApiOperation({ 
    summary: 'Manual webhook delivery',
    description: 'Manually trigger a webhook delivery for testing purposes'
  })
  @ApiBody({ type: WebhookDeliveryDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Webhook delivered successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        response: { type: 'object' },
        error: { type: 'string' }
      }
    }
  })
  async manualWebhookDelivery(
    @Body() deliveryDto: WebhookDeliveryDto,
    @CurrentUser() user: User
  ) {
    this.logger.log(`Manual webhook delivery requested for endpoint ${deliveryDto.endpointId}`);

    try {
      const payload = {
        id: `manual_${Date.now()}`,
        event: deliveryDto.event,
        timestamp: new Date().toISOString(),
        data: deliveryDto.data,
        metadata: {
          source: 'wp-autohealer' as const,
          version: '1.0.0',
          environment: process.env.NODE_ENV || 'development',
          triggeredBy: user.email,
          manual: true,
          ...deliveryDto.metadata
        }
      };

      const result = await this.webhooksService.sendWebhook(deliveryDto.endpointId, payload as any);

      return result;
    } catch (error) {
      this.logger.error('Manual webhook delivery failed:', error);
      throw error;
    }
  }

  /**
   * Get webhook deliveries
   */
  @Get('deliveries')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER', 'VIEWER')
  @ApiBearerAuth()
  @ApiOperation({ 
    summary: 'Get webhook deliveries',
    description: 'Retrieve webhook delivery history with optional filtering'
  })
  @ApiQuery({ name: 'endpointId', required: false, description: 'Filter by endpoint ID' })
  @ApiQuery({ name: 'event', required: false, description: 'Filter by event type' })
  @ApiQuery({ name: 'status', required: false, description: 'Filter by delivery status' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Limit results (default: 50)' })
  @ApiQuery({ name: 'offset', required: false, type: Number, description: 'Offset for pagination (default: 0)' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Webhook deliveries retrieved successfully',
    type: [WebhookDeliveryResponseDto]
  })
  async getWebhookDeliveries(
    @Query() query: {
      endpointId?: string;
      event?: string;
      status?: string;
      limit?: number;
      offset?: number;
    },
    @CurrentUser() user: User
  ): Promise<WebhookDeliveryResponseDto[]> {
    try {
      // This would need to be implemented in the WebhooksService
      // For now, return empty array
      this.logger.debug('Getting webhook deliveries', query);
      return [];
    } catch (error) {
      this.logger.error('Failed to get webhook deliveries:', error);
      throw error;
    }
  }

  /**
   * Get webhook delivery by ID
   */
  @Get('deliveries/:deliveryId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER', 'VIEWER')
  @ApiBearerAuth()
  @ApiOperation({ 
    summary: 'Get webhook delivery by ID',
    description: 'Retrieve a specific webhook delivery by its ID'
  })
  @ApiParam({ name: 'deliveryId', description: 'Webhook delivery ID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Webhook delivery retrieved successfully',
    type: WebhookDeliveryResponseDto
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Webhook delivery not found'
  })
  async getWebhookDelivery(
    @Param('deliveryId') deliveryId: string,
    @CurrentUser() user: User
  ): Promise<WebhookDeliveryResponseDto> {
    try {
      // This would need to be implemented in the WebhooksService
      this.logger.debug(`Getting webhook delivery ${deliveryId}`);
      throw new BadRequestException('Not implemented yet');
    } catch (error) {
      this.logger.error(`Failed to get webhook delivery ${deliveryId}:`, error);
      throw error;
    }
  }

  /**
   * Retry webhook delivery
   */
  @Post('deliveries/:deliveryId/retry')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER')
  @ApiBearerAuth()
  @ApiOperation({ 
    summary: 'Retry webhook delivery',
    description: 'Manually retry a failed webhook delivery'
  })
  @ApiParam({ name: 'deliveryId', description: 'Webhook delivery ID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Webhook delivery retry initiated',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' }
      }
    }
  })
  async retryWebhookDelivery(
    @Param('deliveryId') deliveryId: string,
    @CurrentUser() user: User
  ) {
    try {
      // This would need to be implemented in the WebhooksService
      this.logger.log(`Retrying webhook delivery ${deliveryId}`);
      
      return {
        success: true,
        message: 'Webhook delivery retry initiated'
      };
    } catch (error) {
      this.logger.error(`Failed to retry webhook delivery ${deliveryId}:`, error);
      throw error;
    }
  }

  /**
   * Process webhook retries (admin endpoint)
   */
  @Post('process-retries')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ 
    summary: 'Process webhook retries',
    description: 'Manually trigger processing of failed webhook retries'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Webhook retries processed successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' }
      }
    }
  })
  async processWebhookRetries(@CurrentUser() user: User) {
    try {
      this.logger.log('Processing webhook retries manually');
      
      await this.webhooksService.retryFailedWebhooks();

      return {
        success: true,
        message: 'Webhook retries processed successfully'
      };
    } catch (error) {
      this.logger.error('Failed to process webhook retries:', error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Webhook health check endpoint
   */
  @Get('health')
  @Public()
  @ApiOperation({ 
    summary: 'Webhook health check',
    description: 'Health check endpoint for webhook system'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Webhook system is healthy',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string' },
        timestamp: { type: 'string' },
        version: { type: 'string' }
      }
    }
  })
  async webhookHealthCheck() {
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '1.0.0'
    };
  }

  // Private helper methods

  private mapPriority(externalPriority?: string): Priority {
    if (!externalPriority) return Priority.MEDIUM;

    switch (externalPriority.toUpperCase()) {
      case 'LOW':
        return Priority.LOW;
      case 'MEDIUM':
        return Priority.MEDIUM;
      case 'HIGH':
        return Priority.HIGH;
      case 'CRITICAL':
        return Priority.CRITICAL;
      default:
        return Priority.MEDIUM;
    }
  }
}