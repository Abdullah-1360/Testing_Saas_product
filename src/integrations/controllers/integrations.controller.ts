import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpStatus,
  Logger,
  BadRequestException,
  NotFoundException
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
  ApiBearerAuth,
  ApiBody
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { IntegrationsService } from '../services/integrations.service';
import { ApiKeysService } from '../services/api-keys.service';
import { NotificationsService } from '../services/notifications.service';
import {
  CreateIntegrationDto,
  UpdateIntegrationDto,
  CreateApiKeyDto,
  UpdateApiKeyDto,
  TestIntegrationDto,
  NotificationDto,
  IntegrationResponseDto,
  ApiKeyResponseDto
} from '../dto/integration.dto';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { User } from '@prisma/client';

@ApiTags('Integrations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller({ path: 'integrations', version: '1' })
export class IntegrationsController {
  private readonly logger = new Logger(IntegrationsController.name);

  constructor(
    private readonly integrationsService: IntegrationsService,
    private readonly apiKeysService: ApiKeysService,
    private readonly notificationsService: NotificationsService
  ) {}

  /**
   * Create a new integration
   */
  @Post()
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ 
    summary: 'Create a new integration',
    description: 'Create a new external system integration'
  })
  @ApiBody({ type: CreateIntegrationDto })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Integration created successfully',
    type: IntegrationResponseDto
  })
  async createIntegration(
    @Body() createIntegrationDto: CreateIntegrationDto,
    @CurrentUser() user: User
  ): Promise<IntegrationResponseDto> {
    this.logger.log(`Creating integration: ${createIntegrationDto.name}`);

    try {
      const integration = await this.integrationsService.createIntegration(createIntegrationDto as any);
      const stats = await this.integrationsService.getIntegrationStats(integration.id);

      return {
        ...integration,
        stats
      } as IntegrationResponseDto;
    } catch (error) {
      this.logger.error('Failed to create integration:', error);
      throw error;
    }
  }

  /**
   * Get all integrations
   */
  @Get()
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER', 'VIEWER')
  @ApiOperation({ 
    summary: 'Get all integrations',
    description: 'Retrieve all configured integrations with optional filtering'
  })
  @ApiQuery({ name: 'type', required: false, description: 'Filter by integration type' })
  @ApiQuery({ name: 'enabled', required: false, type: Boolean, description: 'Filter by enabled status' })
  @ApiQuery({ name: 'name', required: false, description: 'Filter by name (partial match)' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Integrations retrieved successfully',
    type: [IntegrationResponseDto]
  })
  async getIntegrations(
    @Query() query: { type?: string; enabled?: boolean; name?: string },
    @CurrentUser() user: User
  ): Promise<IntegrationResponseDto[]> {
    try {
      const integrations = await this.integrationsService.listIntegrations(query);
      
      // Get stats for each integration
      const integrationsWithStats = await Promise.all(
        integrations.map(async (integration) => {
          const stats = await this.integrationsService.getIntegrationStats(integration.id);
          return { ...integration, stats } as IntegrationResponseDto;
        })
      );

      return integrationsWithStats;
    } catch (error) {
      this.logger.error('Failed to get integrations:', error);
      throw error;
    }
  }

  /**
   * Get integration by ID
   */
  @Get(':id')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER', 'VIEWER')
  @ApiOperation({ 
    summary: 'Get integration by ID',
    description: 'Retrieve a specific integration by its ID'
  })
  @ApiParam({ name: 'id', description: 'Integration ID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Integration retrieved successfully',
    type: IntegrationResponseDto
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Integration not found'
  })
  async getIntegration(
    @Param('id') id: string,
    @CurrentUser() user: User
  ): Promise<IntegrationResponseDto> {
    try {
      const integration = await this.integrationsService.getIntegration(id);

      if (!integration) {
        throw new NotFoundException(`Integration with ID ${id} not found`);
      }

      const stats = await this.integrationsService.getIntegrationStats(id);

      return { ...integration, stats } as IntegrationResponseDto;
    } catch (error) {
      this.logger.error(`Failed to get integration ${id}:`, error);
      throw error;
    }
  }

  /**
   * Update integration
   */
  @Put(':id')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ 
    summary: 'Update integration',
    description: 'Update an existing integration configuration'
  })
  @ApiParam({ name: 'id', description: 'Integration ID' })
  @ApiBody({ type: UpdateIntegrationDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Integration updated successfully',
    type: IntegrationResponseDto
  })
  async updateIntegration(
    @Param('id') id: string,
    @Body() updateIntegrationDto: UpdateIntegrationDto,
    @CurrentUser() user: User
  ): Promise<IntegrationResponseDto> {
    try {
      const integration = await this.integrationsService.updateIntegration(id, updateIntegrationDto);
      const stats = await this.integrationsService.getIntegrationStats(id);

      return { ...integration, stats } as IntegrationResponseDto;
    } catch (error) {
      this.logger.error(`Failed to update integration ${id}:`, error);
      throw error;
    }
  }

  /**
   * Delete integration
   */
  @Delete(':id')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ 
    summary: 'Delete integration',
    description: 'Delete an integration and all its associated data'
  })
  @ApiParam({ name: 'id', description: 'Integration ID' })
  @ApiResponse({
    status: HttpStatus.NO_CONTENT,
    description: 'Integration deleted successfully'
  })
  async deleteIntegration(
    @Param('id') id: string,
    @CurrentUser() user: User
  ): Promise<void> {
    try {
      await this.integrationsService.deleteIntegration(id);
    } catch (error) {
      this.logger.error(`Failed to delete integration ${id}:`, error);
      throw error;
    }
  }

  /**
   * Test integration
   */
  @Post(':id/test')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER')
  @ApiOperation({ 
    summary: 'Test integration',
    description: 'Test integration connectivity and configuration'
  })
  @ApiParam({ name: 'id', description: 'Integration ID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Integration test completed',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' },
        details: { type: 'object' }
      }
    }
  })
  async testIntegration(
    @Param('id') id: string,
    @CurrentUser() user: User
  ) {
    try {
      const result = await this.integrationsService.testIntegration(id);
      return result;
    } catch (error) {
      this.logger.error(`Failed to test integration ${id}:`, error);
      throw error;
    }
  }

  /**
   * Generate API key
   */
  @Post('api-keys')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ 
    summary: 'Generate API key',
    description: 'Generate a new API key for external integrations'
  })
  @ApiBody({ type: CreateApiKeyDto })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'API key generated successfully',
    schema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'The generated API key (only shown once)' },
        config: { $ref: '#/components/schemas/ApiKeyResponseDto' }
      }
    }
  })
  async generateApiKey(
    @Body() createApiKeyDto: CreateApiKeyDto,
    @CurrentUser() user: User
  ) {
    try {
      const expiresAt = createApiKeyDto.expiresAt ? new Date(createApiKeyDto.expiresAt) : undefined;
      const result = await this.apiKeysService.generateApiKey(
        createApiKeyDto.name,
        createApiKeyDto.permissions,
        expiresAt
      );

      return {
        key: result.key,
        config: result.config
      };
    } catch (error) {
      this.logger.error('Failed to generate API key:', error);
      throw error;
    }
  }

  /**
   * Get API keys
   */
  @Get('api-keys')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER')
  @ApiOperation({ 
    summary: 'Get API keys',
    description: 'Retrieve all API keys with optional filtering'
  })
  @ApiQuery({ name: 'isActive', required: false, type: Boolean, description: 'Filter by active status' })
  @ApiQuery({ name: 'expired', required: false, type: Boolean, description: 'Filter by expiration status' })
  @ApiQuery({ name: 'name', required: false, description: 'Filter by name (partial match)' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'API keys retrieved successfully',
    type: [ApiKeyResponseDto]
  })
  async getApiKeys(
    @Query() query: { isActive?: boolean; expired?: boolean; name?: string },
    @CurrentUser() user: User
  ): Promise<ApiKeyResponseDto[]> {
    try {
      const apiKeys = await this.apiKeysService.listApiKeys(query);
      return apiKeys.map(key => ({
        id: key.id,
        name: key.name,
        permissions: key.permissions,
        expiresAt: key.expiresAt,
        lastUsedAt: key.lastUsedAt,
        isActive: key.isActive,
        createdAt: key.createdAt
      }));
    } catch (error) {
      this.logger.error('Failed to get API keys:', error);
      throw error;
    }
  }

  /**
   * Update API key
   */
  @Put('api-keys/:keyId')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ 
    summary: 'Update API key',
    description: 'Update API key configuration'
  })
  @ApiParam({ name: 'keyId', description: 'API Key ID' })
  @ApiBody({ type: UpdateApiKeyDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'API key updated successfully',
    type: ApiKeyResponseDto
  })
  async updateApiKey(
    @Param('keyId') keyId: string,
    @Body() updateApiKeyDto: UpdateApiKeyDto,
    @CurrentUser() user: User
  ): Promise<ApiKeyResponseDto> {
    try {
      const apiKey = await this.apiKeysService.updateApiKey(keyId, updateApiKeyDto);
      return {
        id: apiKey.id,
        name: apiKey.name,
        permissions: apiKey.permissions,
        expiresAt: apiKey.expiresAt,
        lastUsedAt: apiKey.lastUsedAt,
        isActive: apiKey.isActive,
        createdAt: apiKey.createdAt
      };
    } catch (error) {
      this.logger.error(`Failed to update API key ${keyId}:`, error);
      throw error;
    }
  }

  /**
   * Revoke API key
   */
  @Delete('api-keys/:keyId')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ 
    summary: 'Revoke API key',
    description: 'Revoke an API key (mark as inactive)'
  })
  @ApiParam({ name: 'keyId', description: 'API Key ID' })
  @ApiResponse({
    status: HttpStatus.NO_CONTENT,
    description: 'API key revoked successfully'
  })
  async revokeApiKey(
    @Param('keyId') keyId: string,
    @CurrentUser() user: User
  ): Promise<void> {
    try {
      await this.apiKeysService.revokeApiKey(keyId);
    } catch (error) {
      this.logger.error(`Failed to revoke API key ${keyId}:`, error);
      throw error;
    }
  }

  /**
   * Send test notification
   */
  @Post('notifications/test')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER')
  @ApiOperation({ 
    summary: 'Send test notification',
    description: 'Send a test notification to verify channel configuration'
  })
  @ApiBody({ type: NotificationDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Test notification sent successfully'
  })
  async sendTestNotification(
    @Body() notificationDto: NotificationDto,
    @CurrentUser() user: User
  ) {
    try {
      await this.notificationsService.sendNotification(
        notificationDto.channelType,
        notificationDto.message,
        notificationDto.metadata
      );

      return {
        success: true,
        message: 'Test notification sent successfully'
      };
    } catch (error) {
      this.logger.error('Failed to send test notification:', error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Test notification channel
   */
  @Post('notifications/channels/:channelId/test')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER')
  @ApiOperation({ 
    summary: 'Test notification channel',
    description: 'Test a specific notification channel'
  })
  @ApiParam({ name: 'channelId', description: 'Channel (Integration) ID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Channel test completed',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' }
      }
    }
  })
  async testNotificationChannel(
    @Param('channelId') channelId: string,
    @CurrentUser() user: User
  ) {
    try {
      const result = await this.notificationsService.testNotificationChannel(channelId);
      return result;
    } catch (error) {
      this.logger.error(`Failed to test notification channel ${channelId}:`, error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Get available permissions
   */
  @Get('api-keys/permissions')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER')
  @ApiOperation({ 
    summary: 'Get available permissions',
    description: 'Get list of available API key permissions'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Available permissions retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        permissions: {
          type: 'array',
          items: { type: 'string' }
        }
      }
    }
  })
  async getAvailablePermissions(@CurrentUser() user: User) {
    return {
      permissions: this.apiKeysService.getAvailablePermissions()
    };
  }

  /**
   * Get API key statistics
   */
  @Get('api-keys/stats')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ 
    summary: 'Get API key statistics',
    description: 'Get statistics about API key usage'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'API key statistics retrieved successfully'
  })
  async getApiKeyStats(@CurrentUser() user: User) {
    try {
      const stats = await this.apiKeysService.getApiKeyStats();
      return stats;
    } catch (error) {
      this.logger.error('Failed to get API key statistics:', error);
      throw error;
    }
  }
}