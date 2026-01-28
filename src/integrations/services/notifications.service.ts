import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../../audit/audit.service';
import {
  NotificationServiceInterface,
  WebhookEvent,
  NotificationChannel,
  NotificationTemplate
} from '../interfaces/integration.interface';
import { OnEvent } from '@nestjs/event-emitter';

@Injectable()
export class NotificationsService implements NotificationServiceInterface {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService
  ) {}

  /**
   * Send notification to a specific channel
   * Validates: Requirements 10.6
   */
  async sendNotification(
    channelType: string, 
    message: string, 
    metadata?: Record<string, any>
  ): Promise<void> {
    this.logger.debug(`Sending notification via ${channelType}`, {
      channelType,
      messageLength: message.length,
      metadata
    });

    try {
      // Get active notification channels of the specified type
      const integrations = await this.prisma.integration.findMany({
        where: {
          enabled: true,
          type: channelType.toUpperCase() as any
        }
      });

      if (integrations.length === 0) {
        this.logger.warn(`No active integrations found for channel type: ${channelType}`);
        return;
      }

      // Send notification via each integration
      for (const integration of integrations) {
        try {
          await this.sendNotificationViaIntegration(integration, message, metadata);
        } catch (error) {
          this.logger.error(`Failed to send notification via integration ${integration.id}:`, error);
        }
      }

      // Audit log
      await this.auditService.createAuditEvent({
        action: 'SEND_NOTIFICATION',
        resource: 'notification',
        details: {
          channelType,
          messageLength: message.length,
          integrationsCount: integrations.length,
          metadata
        }
      });
    } catch (error) {
      this.logger.error(`Failed to send notification via ${channelType}:`, error);
      throw error;
    }
  }

  /**
   * Process notification event and send to configured channels
   * Validates: Requirements 10.6
   */
  async processNotificationEvent(event: WebhookEvent, data: any): Promise<void> {
    this.logger.debug(`Processing notification event: ${event}`, { event, dataKeys: Object.keys(data) });

    try {
      // Get integrations with notification settings for this event
      const integrations = await this.prisma.integration.findMany({
        where: {
          enabled: true,
          type: { in: ['EMAIL', 'SLACK', 'DISCORD', 'TEAMS'] }
        }
      });

      if (integrations.length === 0) {
        this.logger.debug(`No notification integrations found for event: ${event}`);
        return;
      }

      // Process each integration
      for (const integration of integrations) {
        try {
          const notificationSettings = integration.notificationSettings as any;
          
          // Check if this event should trigger notifications
          if (!this.shouldSendNotification(event, data, notificationSettings)) {
            continue;
          }

          // Generate notification message
          const message = await this.generateNotificationMessage(event, data, notificationSettings);
          
          // Send notification
          await this.sendNotificationViaIntegration(integration, message, { event, data });
        } catch (error) {
          this.logger.error(`Failed to process notification for integration ${integration.id}:`, error);
        }
      }

      // Audit log
      await this.auditService.createAuditEvent({
        action: 'PROCESS_NOTIFICATION_EVENT',
        resource: 'notification',
        details: {
          event,
          integrationsProcessed: integrations.length
        }
      });
    } catch (error) {
      this.logger.error(`Failed to process notification event ${event}:`, error);
    }
  }

  /**
   * Test notification channel
   * Validates: Requirements 10.6
   */
  async testNotificationChannel(channelId: string): Promise<{ success: boolean; message: string }> {
    this.logger.log(`Testing notification channel: ${channelId}`);

    try {
      const integration = await this.prisma.integration.findUnique({
        where: { id: channelId }
      });

      if (!integration) {
        return {
          success: false,
          message: 'Integration not found'
        };
      }

      if (!integration.enabled) {
        return {
          success: false,
          message: 'Integration is disabled'
        };
      }

      const testMessage = `Test notification from WP-AutoHealer at ${new Date().toISOString()}`;
      const testMetadata = {
        test: true,
        integrationId: integration.id,
        timestamp: new Date().toISOString()
      };

      await this.sendNotificationViaIntegration(integration, testMessage, testMetadata);

      // Audit log
      await this.auditService.createAuditEvent({
        action: 'TEST_NOTIFICATION_CHANNEL',
        resource: 'integration',
        resourceId: channelId,
        details: {
          name: integration.name,
          type: integration.type,
          testResult: true
        }
      });

      return {
        success: true,
        message: 'Test notification sent successfully'
      };
    } catch (error) {
      this.logger.error(`Failed to test notification channel ${channelId}:`, error);
      
      // Audit log for failure
      await this.auditService.createAuditEvent({
        action: 'TEST_NOTIFICATION_CHANNEL',
        resource: 'integration',
        resourceId: channelId,
        details: {
          testResult: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        }
      });

      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  // Event listeners for automatic notification processing

  @OnEvent('incident.created')
  async handleIncidentCreated(payload: any) {
    await this.processNotificationEvent(WebhookEvent.INCIDENT_CREATED, payload);
  }

  @OnEvent('incident.resolved')
  async handleIncidentResolved(payload: any) {
    await this.processNotificationEvent(WebhookEvent.INCIDENT_RESOLVED, payload);
  }

  @OnEvent('incident.escalated')
  async handleIncidentEscalated(payload: any) {
    await this.processNotificationEvent(WebhookEvent.INCIDENT_ESCALATED, payload);
  }

  @OnEvent('site.health.changed')
  async handleSiteHealthChanged(payload: any) {
    await this.processNotificationEvent(WebhookEvent.SITE_HEALTH_CHANGED, payload);
  }

  // Private helper methods

  private async sendNotificationViaIntegration(
    integration: any, 
    message: string, 
    metadata?: Record<string, any>
  ): Promise<void> {
    const config = integration.configuration;

    switch (integration.type) {
      case 'EMAIL':
        await this.sendEmailNotification(config, message, metadata);
        break;
      case 'SLACK':
        await this.sendSlackNotification(config, message, metadata);
        break;
      case 'DISCORD':
        await this.sendDiscordNotification(config, message, metadata);
        break;
      case 'TEAMS':
        await this.sendTeamsNotification(config, message, metadata);
        break;
      default:
        this.logger.warn(`Unsupported notification type: ${integration.type}`);
    }
  }

  private async sendEmailNotification(
    config: any, 
    message: string, 
    metadata?: Record<string, any>
  ): Promise<void> {
    // TODO: Implement email notification
    this.logger.debug('Email notification (not implemented)', { config, message, metadata });
  }

  private async sendSlackNotification(
    config: any, 
    message: string, 
    metadata?: Record<string, any>
  ): Promise<void> {
    try {
      const webhookUrl = config.webhook_url;
      if (!webhookUrl) {
        throw new Error('Slack webhook URL not configured');
      }

      const payload = {
        text: message,
        username: 'WP-AutoHealer',
        icon_emoji: ':robot_face:',
        attachments: metadata ? [{
          color: this.getSlackColor(metadata.event),
          fields: Object.entries(metadata).map(([key, value]) => ({
            title: key,
            value: typeof value === 'object' ? JSON.stringify(value) : String(value),
            short: true
          }))
        }] : undefined
      };

      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`Slack API error: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      this.logger.error('Failed to send Slack notification:', error);
      throw error;
    }
  }

  private async sendDiscordNotification(
    config: any, 
    message: string, 
    metadata?: Record<string, any>
  ): Promise<void> {
    try {
      const webhookUrl = config.webhook_url;
      if (!webhookUrl) {
        throw new Error('Discord webhook URL not configured');
      }

      const payload = {
        content: message,
        username: 'WP-AutoHealer',
        avatar_url: 'https://example.com/wp-autohealer-avatar.png',
        embeds: metadata ? [{
          title: 'Event Details',
          color: this.getDiscordColor(metadata.event),
          fields: Object.entries(metadata).map(([key, value]) => ({
            name: key,
            value: typeof value === 'object' ? JSON.stringify(value) : String(value),
            inline: true
          })),
          timestamp: new Date().toISOString()
        }] : undefined
      };

      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`Discord API error: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      this.logger.error('Failed to send Discord notification:', error);
      throw error;
    }
  }

  private async sendTeamsNotification(
    config: any, 
    message: string, 
    metadata?: Record<string, any>
  ): Promise<void> {
    try {
      const webhookUrl = config.webhook_url;
      if (!webhookUrl) {
        throw new Error('Teams webhook URL not configured');
      }

      const payload = {
        '@type': 'MessageCard',
        '@context': 'http://schema.org/extensions',
        themeColor: this.getTeamsColor(metadata?.event),
        summary: 'WP-AutoHealer Notification',
        sections: [{
          activityTitle: 'WP-AutoHealer',
          activitySubtitle: 'System Notification',
          text: message,
          facts: metadata ? Object.entries(metadata).map(([key, value]) => ({
            name: key,
            value: typeof value === 'object' ? JSON.stringify(value) : String(value)
          })) : undefined
        }]
      };

      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`Teams API error: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      this.logger.error('Failed to send Teams notification:', error);
      throw error;
    }
  }

  private shouldSendNotification(
    event: WebhookEvent, 
    data: any, 
    notificationSettings: any
  ): boolean {
    // Check if notifications are enabled for this event
    const eventSettings = notificationSettings?.events?.[event];
    if (!eventSettings?.enabled) {
      return false;
    }

    // Apply filters if configured
    const filters = eventSettings?.filters || [];
    for (const filter of filters) {
      if (!this.evaluateFilter(filter, data)) {
        return false;
      }
    }

    return true;
  }

  private evaluateFilter(filter: any, data: any): boolean {
    const { field, operator, value } = filter;
    const fieldValue = this.getNestedValue(data, field);

    switch (operator) {
      case 'equals':
        return fieldValue === value;
      case 'contains':
        return String(fieldValue).includes(String(value));
      case 'greater_than':
        return Number(fieldValue) > Number(value);
      case 'less_than':
        return Number(fieldValue) < Number(value);
      case 'in':
        return Array.isArray(value) && value.includes(fieldValue);
      default:
        return true;
    }
  }

  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }

  private async generateNotificationMessage(
    event: WebhookEvent, 
    data: any, 
    notificationSettings: any
  ): Promise<string> {
    // Check for custom template
    const template = notificationSettings?.templates?.[event];
    if (template) {
      return this.renderTemplate(template.body, data);
    }

    // Generate default message based on event type
    switch (event) {
      case WebhookEvent.INCIDENT_CREATED:
        return `🚨 New incident created for ${data.domain}: ${data.state} (Priority: ${data.priority})`;
      case WebhookEvent.INCIDENT_RESOLVED:
        return `✅ Incident resolved for ${data.domain} after ${data.fixAttempts} attempts`;
      case WebhookEvent.INCIDENT_ESCALATED:
        return `⚠️ Incident escalated for ${data.domain}: ${data.escalationReason || 'Manual escalation'}`;
      case WebhookEvent.SITE_HEALTH_CHANGED:
        return `📊 Site health changed for ${data.domain}: ${data.status}`;
      default:
        return `📢 Event: ${event} - ${JSON.stringify(data)}`;
    }
  }

  private renderTemplate(template: string, data: any): string {
    return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (match, path) => {
      const value = this.getNestedValue(data, path);
      return value !== undefined ? String(value) : match;
    });
  }

  private getSlackColor(event?: string): string {
    switch (event) {
      case WebhookEvent.INCIDENT_CREATED:
        return 'danger';
      case WebhookEvent.INCIDENT_RESOLVED:
        return 'good';
      case WebhookEvent.INCIDENT_ESCALATED:
        return 'warning';
      default:
        return '#36a64f';
    }
  }

  private getDiscordColor(event?: string): number {
    switch (event) {
      case WebhookEvent.INCIDENT_CREATED:
        return 0xff0000; // Red
      case WebhookEvent.INCIDENT_RESOLVED:
        return 0x00ff00; // Green
      case WebhookEvent.INCIDENT_ESCALATED:
        return 0xffaa00; // Orange
      default:
        return 0x36a64f; // Default green
    }
  }

  private getTeamsColor(event?: string): string {
    switch (event) {
      case WebhookEvent.INCIDENT_CREATED:
        return 'FF0000';
      case WebhookEvent.INCIDENT_RESOLVED:
        return '00FF00';
      case WebhookEvent.INCIDENT_ESCALATED:
        return 'FFAA00';
      default:
        return '36A64F';
    }
  }
}