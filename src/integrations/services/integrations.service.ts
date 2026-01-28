import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { EncryptionService } from '../../common/services/encryption.service';
import {
  IntegrationConfig,
  IntegrationType,
  IntegrationServiceInterface,
  WebhookEndpoint,
  NotificationSettings
} from '../interfaces/integration.interface';
import { CreateIntegrationDto, UpdateIntegrationDto } from '../dto/integration.dto';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class IntegrationsService implements IntegrationServiceInterface {
  private readonly logger = new Logger(IntegrationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly encryptionService: EncryptionService
  ) {}

  /**
   * Create a new integration
   * Validates: Requirements 10.6
   */
  async createIntegration(config: Partial<IntegrationConfig>): Promise<IntegrationConfig> {
    const createDto = config as CreateIntegrationDto;
    this.logger.log(`Creating integration: ${createDto.name} (${createDto.type})`);

    try {
      // Encrypt sensitive configuration data
      const encryptedConfig = await this.encryptSensitiveConfig(createDto.configuration || {});

      // Create integration in database
      const integration = await this.prisma.integration.create({
        data: {
          name: createDto.name,
          type: createDto.type,
          enabled: createDto.enabled ?? true,
          configuration: encryptedConfig,
          notificationSettings: createDto.notificationSettings || {},
        },
        include: {
          webhookEndpoints: true,
          apiKeys: true
        }
      });

      // Create webhook endpoints if provided
      const webhookEndpoints: WebhookEndpoint[] = [];
      if (createDto.webhookEndpoints && createDto.webhookEndpoints.length > 0) {
        for (const endpointDto of createDto.webhookEndpoints) {
          const endpoint = await this.prisma.webhookEndpoint.create({
            data: {
              integrationId: integration.id,
              url: endpointDto.url,
              method: endpointDto.method || 'POST',
              headers: endpointDto.headers || {},
              events: endpointDto.events,
              retryPolicy: endpointDto.retryPolicy as any || {
                maxAttempts: 3,
                backoffMultiplier: 2,
                initialDelayMs: 1000,
                maxDelayMs: 30000
              },
              isActive: endpointDto.isActive ?? true,
              successCount: 0,
              failureCount: 0
            }
          });
          webhookEndpoints.push(endpoint as any);
        }
      }

      // Audit log
      await this.auditService.createAuditEvent({
        action: 'CREATE_INTEGRATION',
        resource: 'integration',
        resourceId: integration.id,
        details: {
          name: integration.name,
          type: integration.type,
          webhookEndpointsCount: webhookEndpoints.length
        }
      });

      this.logger.log(`Created integration ${integration.id}: ${integration.name}`);

      return this.mapToIntegrationConfig(integration, webhookEndpoints);
    } catch (error) {
      this.logger.error(`Failed to create integration: ${createDto.name}`, error);
      throw error;
    }
  }

  /**
   * Update an existing integration
   * Validates: Requirements 10.6
   */
  async updateIntegration(id: string, updateDto: UpdateIntegrationDto): Promise<IntegrationConfig> {
    this.logger.log(`Updating integration: ${id}`);

    try {
      // Check if integration exists
      const existingIntegration = await this.prisma.integration.findUnique({
        where: { id },
        include: { webhookEndpoints: true, apiKeys: true }
      });

      if (!existingIntegration) {
        throw new NotFoundException(`Integration with ID ${id} not found`);
      }

      // Prepare update data
      const updateData: any = {};
      if (updateDto.name !== undefined) updateData.name = updateDto.name;
      if (updateDto.enabled !== undefined) updateData.enabled = updateDto.enabled;
      if (updateDto.notificationSettings !== undefined) {
        updateData.notificationSettings = updateDto.notificationSettings;
      }

      // Encrypt configuration if provided
      if (updateDto.configuration !== undefined) {
        updateData.configuration = await this.encryptSensitiveConfig(updateDto.configuration);
      }

      // Update integration
      const updatedIntegration = await this.prisma.integration.update({
        where: { id },
        data: updateData,
        include: {
          webhookEndpoints: true,
          apiKeys: true
        }
      });

      // Audit log
      await this.auditService.createAuditEvent({
        action: 'UPDATE_INTEGRATION',
        resource: 'integration',
        resourceId: id,
        details: {
          changes: updateData,
          previousName: existingIntegration.name,
          newName: updatedIntegration.name
        }
      });

      this.logger.log(`Updated integration ${id}: ${updatedIntegration.name}`);

      return this.mapToIntegrationConfig(updatedIntegration, updatedIntegration.webhookEndpoints);
    } catch (error) {
      this.logger.error(`Failed to update integration ${id}:`, error);
      throw error;
    }
  }

  /**
   * Delete an integration
   * Validates: Requirements 10.6
   */
  async deleteIntegration(id: string): Promise<void> {
    this.logger.log(`Deleting integration: ${id}`);

    try {
      const integration = await this.prisma.integration.findUnique({
        where: { id }
      });

      if (!integration) {
        throw new NotFoundException(`Integration with ID ${id} not found`);
      }

      // Delete integration (cascade will handle related records)
      await this.prisma.integration.delete({
        where: { id }
      });

      // Audit log
      await this.auditService.createAuditEvent({
        action: 'DELETE_INTEGRATION',
        resource: 'integration',
        resourceId: id,
        details: {
          name: integration.name,
          type: integration.type,
          deletedAt: new Date().toISOString()
        }
      });

      this.logger.log(`Deleted integration ${id}: ${integration.name}`);
    } catch (error) {
      this.logger.error(`Failed to delete integration ${id}:`, error);
      throw error;
    }
  }

  /**
   * Get integration by ID
   * Validates: Requirements 10.6
   */
  async getIntegration(id: string): Promise<IntegrationConfig | null> {
    try {
      const integration = await this.prisma.integration.findUnique({
        where: { id },
        include: {
          webhookEndpoints: true,
          apiKeys: true
        }
      });

      if (!integration) {
        return null;
      }

      return this.mapToIntegrationConfig(integration, integration.webhookEndpoints);
    } catch (error) {
      this.logger.error(`Failed to get integration ${id}:`, error);
      throw error;
    }
  }

  /**
   * List integrations with optional filtering
   * Validates: Requirements 10.6
   */
  async listIntegrations(filters: Record<string, any> = {}): Promise<IntegrationConfig[]> {
    try {
      const where: any = {};
      
      if (filters.type) where.type = filters.type;
      if (filters.enabled !== undefined) where.enabled = filters.enabled;
      if (filters.name) {
        where.name = { contains: filters.name, mode: 'insensitive' };
      }

      const integrations = await this.prisma.integration.findMany({
        where,
        include: {
          webhookEndpoints: true,
          apiKeys: true
        },
        orderBy: { createdAt: 'desc' }
      });

      return integrations.map(integration => 
        this.mapToIntegrationConfig(integration, integration.webhookEndpoints)
      );
    } catch (error) {
      this.logger.error('Failed to list integrations:', error);
      throw error;
    }
  }

  /**
   * Test integration connectivity
   * Validates: Requirements 10.6
   */
  async testIntegration(id: string): Promise<{ success: boolean; message: string; details?: any }> {
    this.logger.log(`Testing integration: ${id}`);

    try {
      const integration = await this.getIntegration(id);
      if (!integration) {
        throw new NotFoundException(`Integration with ID ${id} not found`);
      }

      if (!integration.enabled) {
        return {
          success: false,
          message: 'Integration is disabled'
        };
      }

      // Test based on integration type
      let testResult: { success: boolean; message: string; details?: any };

      switch (integration.type) {
        case IntegrationType.WEBHOOK:
          testResult = await this.testWebhookIntegration(integration);
          break;
        case IntegrationType.SLACK:
          testResult = await this.testSlackIntegration(integration);
          break;
        case IntegrationType.EMAIL:
          testResult = await this.testEmailIntegration(integration);
          break;
        default:
          testResult = {
            success: false,
            message: `Testing not implemented for integration type: ${integration.type}`
          };
      }

      // Audit log
      await this.auditService.createAuditEvent({
        action: 'TEST_INTEGRATION',
        resource: 'integration',
        resourceId: id,
        details: {
          name: integration.name,
          type: integration.type,
          testResult: testResult.success,
          message: testResult.message
        }
      });

      this.logger.log(`Integration test completed for ${id}: ${testResult.success ? 'SUCCESS' : 'FAILED'}`);

      return testResult;
    } catch (error) {
      this.logger.error(`Failed to test integration ${id}:`, error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error',
        details: { error: error instanceof Error ? error.stack : error }
      };
    }
  }

  /**
   * Get integration statistics
   */
  async getIntegrationStats(id: string): Promise<{
    totalWebhooks: number;
    successfulWebhooks: number;
    failedWebhooks: number;
    lastTriggered?: Date;
  }> {
    try {
      const integration = await this.prisma.integration.findUnique({
        where: { id },
        include: {
          webhookEndpoints: true,
          _count: {
            select: {
              webhookDeliveries: true
            }
          }
        }
      });

      if (!integration) {
        throw new NotFoundException(`Integration with ID ${id} not found`);
      }

      const successfulWebhooks = integration.webhookEndpoints.reduce((sum, endpoint) => sum + endpoint.successCount, 0);
      const failedWebhooks = integration.webhookEndpoints.reduce((sum, endpoint) => sum + endpoint.failureCount, 0);
      const lastTriggered = integration.webhookEndpoints
        .map(endpoint => endpoint.lastTriggeredAt)
        .filter(date => date !== null)
        .sort((a, b) => (b?.getTime() || 0) - (a?.getTime() || 0))[0] || undefined;

      return {
        totalWebhooks: integration._count.webhookDeliveries,
        successfulWebhooks,
        failedWebhooks,
        lastTriggered
      };
    } catch (error) {
      this.logger.error(`Failed to get integration stats for ${id}:`, error);
      throw error;
    }
  }

  // Private helper methods

  private async encryptSensitiveConfig(config: Record<string, any>): Promise<Record<string, any>> {
    const sensitiveFields = ['apiKey', 'secret', 'token', 'password', 'webhook_url'];
    const encryptedConfig = { ...config };

    for (const field of sensitiveFields) {
      if (encryptedConfig[field]) {
        encryptedConfig[field] = await this.encryptionService.encrypt(encryptedConfig[field]);
      }
    }

    return encryptedConfig;
  }

  private async decryptSensitiveConfig(config: Record<string, any>): Promise<Record<string, any>> {
    const sensitiveFields = ['apiKey', 'secret', 'token', 'password', 'webhook_url'];
    const decryptedConfig = { ...config };

    for (const field of sensitiveFields) {
      if (decryptedConfig[field]) {
        try {
          decryptedConfig[field] = await this.encryptionService.decrypt(decryptedConfig[field]);
        } catch (error) {
          this.logger.warn(`Failed to decrypt field ${field}:`, error);
        }
      }
    }

    return decryptedConfig;
  }

  private mapToIntegrationConfig(integration: any, webhookEndpoints: any[]): IntegrationConfig {
    return {
      id: integration.id,
      name: integration.name,
      type: integration.type as IntegrationType,
      enabled: integration.enabled,
      configuration: integration.configuration,
      apiKeys: integration.apiKeys || [],
      webhookEndpoints: webhookEndpoints.map(endpoint => ({
        id: endpoint.id,
        url: endpoint.url,
        method: endpoint.method,
        headers: endpoint.headers,
        events: endpoint.events,
        retryPolicy: endpoint.retryPolicy,
        isActive: endpoint.isActive,
        lastTriggeredAt: endpoint.lastTriggeredAt,
        successCount: endpoint.successCount,
        failureCount: endpoint.failureCount
      })),
      notificationSettings: integration.notificationSettings as NotificationSettings,
      createdAt: integration.createdAt,
      updatedAt: integration.updatedAt
    };
  }

  private async testWebhookIntegration(integration: IntegrationConfig): Promise<{ success: boolean; message: string; details?: any }> {
    // Test webhook endpoints
    if (integration.webhookEndpoints.length === 0) {
      return {
        success: false,
        message: 'No webhook endpoints configured'
      };
    }

    const testPayload = {
      id: uuidv4(),
      event: 'test.connection',
      timestamp: new Date().toISOString(),
      data: {
        message: 'Test webhook from WP-AutoHealer',
        integrationId: integration.id
      },
      metadata: {
        source: 'wp-autohealer',
        version: '1.0.0',
        environment: process.env.NODE_ENV || 'development'
      }
    };

    // Test first active endpoint
    const activeEndpoint = integration.webhookEndpoints.find(ep => ep.isActive);
    if (!activeEndpoint) {
      return {
        success: false,
        message: 'No active webhook endpoints found'
      };
    }

    try {
      const response = await fetch(activeEndpoint.url, {
        method: activeEndpoint.method,
        headers: {
          'Content-Type': 'application/json',
          ...activeEndpoint.headers
        },
        body: JSON.stringify(testPayload)
      });

      return {
        success: response.ok,
        message: response.ok ? 'Webhook test successful' : `Webhook test failed: ${response.status} ${response.statusText}`,
        details: {
          statusCode: response.status,
          statusText: response.statusText,
          url: activeEndpoint.url
        }
      };
    } catch (error) {
      return {
        success: false,
        message: `Webhook test failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        details: { error: error instanceof Error ? error.stack : error }
      };
    }
  }

  private async testSlackIntegration(_integration: IntegrationConfig): Promise<{ success: boolean; message: string; details?: any }> {
    // TODO: Implement Slack integration testing
    return {
      success: false,
      message: 'Slack integration testing not yet implemented'
    };
  }

  private async testEmailIntegration(_integration: IntegrationConfig): Promise<{ success: boolean; message: string; details?: any }> {
    // TODO: Implement email integration testing
    return {
      success: false,
      message: 'Email integration testing not yet implemented'
    };
  }
}