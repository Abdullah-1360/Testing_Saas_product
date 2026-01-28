import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../../audit/audit.service';
import {
  WebhookServiceInterface,
  WebhookPayload,
  WebhookEvent,
  RetryPolicy
} from '../interfaces/integration.interface';
import { OnEvent } from '@nestjs/event-emitter';
import { v4 as uuidv4 } from 'uuid';
import { createHmac } from 'crypto';

@Injectable()
export class WebhooksService implements WebhookServiceInterface {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService
  ) {
    // Start retry processor
    this.startRetryProcessor();
  }

  /**
   * Send webhook to a specific endpoint
   * Validates: Requirements 10.6
   */
  async sendWebhook(
    endpointId: string, 
    payload: WebhookPayload
  ): Promise<{ success: boolean; response?: any; error?: string }> {
    this.logger.debug(`Sending webhook to endpoint ${endpointId}`, {
      endpointId,
      event: payload.event,
      payloadId: payload.id
    });

    try {
      // Get webhook endpoint
      const endpoint = await this.prisma.webhookEndpoint.findUnique({
        where: { id: endpointId },
        include: { integration: true }
      });

      if (!endpoint) {
        throw new Error(`Webhook endpoint ${endpointId} not found`);
      }

      if (!endpoint.isActive) {
        this.logger.warn(`Webhook endpoint ${endpointId} is inactive, skipping`);
        return { success: false, error: 'Endpoint is inactive' };
      }

      if (!endpoint.integration.enabled) {
        this.logger.warn(`Integration for endpoint ${endpointId} is disabled, skipping`);
        return { success: false, error: 'Integration is disabled' };
      }

      // Create webhook delivery record
      const delivery = await this.prisma.webhookDelivery.create({
        data: {
          endpointId,
          integrationId: endpoint.integrationId,
          event: payload.event,
          payload: payload as any,
          status: 'PENDING',
          attempts: 0
        }
      });

      // Attempt delivery
      const result = await this.attemptWebhookDelivery(endpoint, payload, delivery.id);

      // Update delivery record
      await this.prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: result.success ? 'DELIVERED' : 'FAILED',
          attempts: 1,
          lastAttemptAt: new Date(),
          response: result.response ? {
            statusCode: result.response.status,
            body: result.response.body,
            headers: result.response.headers
          } : undefined,
          error: result.error,
          nextRetryAt: result.success ? null : this.calculateNextRetry(endpoint.retryPolicy as any, 1)
        }
      });

      // Update endpoint statistics
      if (result.success) {
        await this.prisma.webhookEndpoint.update({
          where: { id: endpointId },
          data: {
            successCount: { increment: 1 },
            lastTriggeredAt: new Date()
          }
        });
      } else {
        await this.prisma.webhookEndpoint.update({
          where: { id: endpointId },
          data: {
            failureCount: { increment: 1 }
          }
        });
      }

      return result;
    } catch (error) {
      this.logger.error(`Failed to send webhook to endpoint ${endpointId}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Process webhook event and send to all matching endpoints
   * Validates: Requirements 10.6
   */
  async processWebhookEvent(event: WebhookEvent, data: any): Promise<void> {
    this.logger.debug(`Processing webhook event: ${event}`, { event, dataKeys: Object.keys(data) });

    try {
      // Find all webhook endpoints that listen for this event
      const endpoints = await this.prisma.webhookEndpoint.findMany({
        where: {
          isActive: true,
          events: { has: event },
          integration: { enabled: true }
        },
        include: { integration: true }
      });

      if (endpoints.length === 0) {
        this.logger.debug(`No active webhook endpoints found for event: ${event}`);
        return;
      }

      // Create webhook payload
      const payload: WebhookPayload = {
        id: uuidv4(),
        event,
        timestamp: new Date().toISOString(),
        data,
        metadata: {
          source: 'wp-autohealer',
          version: '1.0.0',
          environment: process.env.NODE_ENV || 'development'
        }
      };

      // Send webhook to all matching endpoints
      const deliveryPromises = endpoints.map(endpoint => 
        this.sendWebhook(endpoint.id, payload)
      );

      const results = await Promise.allSettled(deliveryPromises);
      
      const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
      const failed = results.length - successful;

      this.logger.log(`Webhook event ${event} processed: ${successful} successful, ${failed} failed deliveries`);

      // Audit log
      await this.auditService.createAuditEvent({
        action: 'PROCESS_WEBHOOK_EVENT',
        resource: 'webhook',
        details: {
          event,
          endpointsCount: endpoints.length,
          successfulDeliveries: successful,
          failedDeliveries: failed,
          payloadId: payload.id
        }
      });
    } catch (error) {
      this.logger.error(`Failed to process webhook event ${event}:`, error);
    }
  }

  /**
   * Validate webhook signature
   * Validates: Requirements 10.6
   */
  validateWebhookSignature(payload: string, signature: string, secret: string): boolean {
    try {
      const expectedSignature = createHmac('sha256', secret)
        .update(payload, 'utf8')
        .digest('hex');
      
      const providedSignature = signature.startsWith('sha256=') 
        ? signature.slice(7) 
        : signature;

      return expectedSignature === providedSignature;
    } catch (error) {
      this.logger.error('Failed to validate webhook signature:', error);
      return false;
    }
  }

  /**
   * Retry failed webhooks
   * Validates: Requirements 10.6
   */
  async retryFailedWebhooks(): Promise<void> {
    this.logger.debug('Processing webhook retries');

    try {
      // Find deliveries that need retry
      const failedDeliveries = await this.prisma.webhookDelivery.findMany({
        where: {
          status: { in: ['FAILED', 'RETRYING'] },
          nextRetryAt: { lte: new Date() }
        },
        include: {
          endpoint: {
            include: { integration: true }
          }
        },
        take: 100 // Process in batches
      });

      if (failedDeliveries.length === 0) {
        return;
      }

      this.logger.log(`Processing ${failedDeliveries.length} webhook retries`);

      for (const delivery of failedDeliveries) {
        if (!delivery.endpoint.isActive || !delivery.endpoint.integration.enabled) {
          // Mark as permanently failed if endpoint/integration is disabled
          await this.prisma.webhookDelivery.update({
            where: { id: delivery.id },
            data: { status: 'FAILED', nextRetryAt: null }
          });
          continue;
        }

        const retryPolicy = delivery.endpoint.retryPolicy as any;
        if (delivery.attempts >= retryPolicy.maxAttempts) {
          // Max attempts reached, mark as permanently failed
          await this.prisma.webhookDelivery.update({
            where: { id: delivery.id },
            data: { status: 'FAILED', nextRetryAt: null }
          });
          continue;
        }

        // Attempt retry
        const result = await this.attemptWebhookDelivery(
          delivery.endpoint, 
          delivery.payload as any, 
          delivery.id
        );

        // Update delivery record
        const newAttempts = delivery.attempts + 1;
        await this.prisma.webhookDelivery.update({
          where: { id: delivery.id },
          data: {
            status: result.success ? 'DELIVERED' : (newAttempts >= retryPolicy.maxAttempts ? 'FAILED' : 'RETRYING'),
            attempts: newAttempts,
            lastAttemptAt: new Date(),
            response: result.response ? {
              statusCode: result.response.status,
              body: result.response.body,
              headers: result.response.headers
            } : undefined,
            error: result.error,
            nextRetryAt: result.success || newAttempts >= retryPolicy.maxAttempts 
              ? null 
              : this.calculateNextRetry(retryPolicy, newAttempts)
          }
        });

        // Update endpoint statistics
        if (result.success) {
          await this.prisma.webhookEndpoint.update({
            where: { id: delivery.endpoint.id },
            data: {
              successCount: { increment: 1 },
              lastTriggeredAt: new Date()
            }
          });
        } else {
          await this.prisma.webhookEndpoint.update({
            where: { id: delivery.endpoint.id },
            data: {
              failureCount: { increment: 1 }
            }
          });
        }
      }

      this.logger.log(`Completed processing ${failedDeliveries.length} webhook retries`);
    } catch (error) {
      this.logger.error('Failed to process webhook retries:', error);
    }
  }

  // Event listeners for automatic webhook processing

  @OnEvent('incident.created')
  async handleIncidentCreated(payload: any) {
    await this.processWebhookEvent(WebhookEvent.INCIDENT_CREATED, payload);
  }

  @OnEvent('incident.updated')
  async handleIncidentUpdated(payload: any) {
    await this.processWebhookEvent(WebhookEvent.INCIDENT_UPDATED, payload);
  }

  @OnEvent('incident.resolved')
  async handleIncidentResolved(payload: any) {
    await this.processWebhookEvent(WebhookEvent.INCIDENT_RESOLVED, payload);
  }

  @OnEvent('incident.escalated')
  async handleIncidentEscalated(payload: any) {
    await this.processWebhookEvent(WebhookEvent.INCIDENT_ESCALATED, payload);
  }

  @OnEvent('site.health.changed')
  async handleSiteHealthChanged(payload: any) {
    await this.processWebhookEvent(WebhookEvent.SITE_HEALTH_CHANGED, payload);
  }

  @OnEvent('system.status.changed')
  async handleSystemStatusChanged(payload: any) {
    await this.processWebhookEvent(WebhookEvent.SYSTEM_STATUS_CHANGED, payload);
  }

  @OnEvent('backup.created')
  async handleBackupCreated(payload: any) {
    await this.processWebhookEvent(WebhookEvent.BACKUP_CREATED, payload);
  }

  @OnEvent('rollback.executed')
  async handleRollbackExecuted(payload: any) {
    await this.processWebhookEvent(WebhookEvent.ROLLBACK_EXECUTED, payload);
  }

  // Private helper methods

  private async attemptWebhookDelivery(
    endpoint: any, 
    payload: WebhookPayload, 
    deliveryId: string
  ): Promise<{ success: boolean; response?: any; error?: string }> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

      const response = await fetch(endpoint.url, {
        method: endpoint.method,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'WP-AutoHealer-Webhook/1.0',
          'X-Webhook-ID': deliveryId,
          'X-Webhook-Event': payload.event,
          'X-Webhook-Timestamp': payload.timestamp,
          ...endpoint.headers
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      const responseBody = await response.text();

      return {
        success: response.ok,
        response: {
          status: response.status,
          body: responseBody,
          headers: Object.fromEntries(response.headers.entries())
        },
        error: response.ok ? undefined : `HTTP ${response.status}: ${response.statusText}`
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private calculateNextRetry(retryPolicy: RetryPolicy, attemptNumber: number): Date {
    const delay = Math.min(
      retryPolicy.initialDelayMs * Math.pow(retryPolicy.backoffMultiplier, attemptNumber - 1),
      retryPolicy.maxDelayMs
    );
    
    return new Date(Date.now() + delay);
  }

  private startRetryProcessor(): void {
    // Process retries every 30 seconds
    setInterval(() => {
      this.retryFailedWebhooks().catch(error => {
        this.logger.error('Error in webhook retry processor:', error);
      });
    }, 30000);
  }
}