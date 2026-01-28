import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '@/database/prisma.service';
import { RedactionService } from '@/common/services/redaction.service';
import { Counter, Histogram, Gauge, register } from 'prom-client';

export interface SecurityEvent {
  type: SecurityEventType;
  severity: SecuritySeverity;
  source: string;
  sourceIp?: string;
  userId?: string;
  metadata: Record<string, any>;
  timestamp: Date;
  requestId?: string;
}

export enum SecurityEventType {
  AUTHENTICATION_FAILURE = 'authentication_failure',
  UNAUTHORIZED_ACCESS = 'unauthorized_access',
  SUSPICIOUS_REQUEST = 'suspicious_request',
  SQL_INJECTION_ATTEMPT = 'sql_injection_attempt',
  XSS_ATTEMPT = 'xss_attempt',
  PRIVILEGE_ESCALATION = 'privilege_escalation',
  RATE_LIMIT_EXCEEDED = 'rate_limit_exceeded',
  MALICIOUS_FILE_UPLOAD = 'malicious_file_upload',
  SUSPICIOUS_FILE_ACCESS = 'suspicious_file_access',
  BRUTE_FORCE_ATTACK = 'brute_force_attack',
  SESSION_HIJACKING = 'session_hijacking',
  CSRF_ATTEMPT = 'csrf_attempt',
  DIRECTORY_TRAVERSAL = 'directory_traversal',
  COMMAND_INJECTION = 'command_injection',
  SSH_CONNECTION_FAILURE = 'ssh_connection_failure',
  ANOMALOUS_BEHAVIOR = 'anomalous_behavior',
  DATA_EXFILTRATION = 'data_exfiltration',
  CONFIGURATION_CHANGE = 'configuration_change',
  BACKUP_INTEGRITY_FAILURE = 'backup_integrity_failure',
}

export enum SecuritySeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

@Injectable()
export class SecurityMonitoringService {
  private readonly logger = new Logger(SecurityMonitoringService.name);

  // Prometheus metrics
  private readonly securityEventsCounter = new Counter({
    name: 'wp_autohealer_security_events_total',
    help: 'Total number of security events',
    labelNames: ['type', 'severity', 'source'],
  });

  private readonly authFailuresCounter = new Counter({
    name: 'wp_autohealer_auth_failures_total',
    help: 'Total number of authentication failures',
    labelNames: ['source_ip', 'user_agent'],
  });

  private readonly unauthorizedAccessCounter = new Counter({
    name: 'wp_autohealer_unauthorized_access_total',
    help: 'Total number of unauthorized access attempts',
    labelNames: ['endpoint', 'source_ip'],
  });

  private readonly securityViolationsCounter = new Counter({
    name: 'wp_autohealer_security_violations_total',
    help: 'Total number of security violations',
    labelNames: ['type', 'source_ip'],
  });

  private readonly privilegeEscalationCounter = new Counter({
    name: 'wp_autohealer_privilege_escalation_attempts_total',
    help: 'Total number of privilege escalation attempts',
    labelNames: ['user_id', 'target_role'],
  });

  private readonly suspiciousFileAccessCounter = new Counter({
    name: 'wp_autohealer_suspicious_file_access_total',
    help: 'Total number of suspicious file access attempts',
    labelNames: ['file_path', 'source_ip'],
  });

  private readonly sshConnectionFailuresCounter = new Counter({
    name: 'wp_autohealer_ssh_connection_failures_total',
    help: 'Total number of SSH connection failures',
    labelNames: ['server_id', 'error_type'],
  });

  private readonly userSessionAnomalyGauge = new Gauge({
    name: 'wp_autohealer_user_session_anomaly_score',
    help: 'User session anomaly score (0-1)',
    labelNames: ['user_id'],
  });

  private readonly securityConfigChangesCounter = new Counter({
    name: 'wp_autohealer_security_config_changes_total',
    help: 'Total number of security configuration changes',
    labelNames: ['user', 'config_type'],
  });

  private readonly malwareDetectedCounter = new Counter({
    name: 'wp_autohealer_malware_detected_total',
    help: 'Total number of malware detections',
    labelNames: ['file_path', 'server'],
  });

  private readonly dataTransferGauge = new Gauge({
    name: 'wp_autohealer_data_transfer_bytes',
    help: 'Data transfer rate in bytes per second',
    labelNames: ['direction', 'user_id'],
  });

  private readonly backupIntegrityFailuresCounter = new Counter({
    name: 'wp_autohealer_backup_integrity_failures_total',
    help: 'Total number of backup integrity failures',
    labelNames: ['backup_id', 'failure_type'],
  });

  // In-memory tracking for pattern detection
  private readonly recentEvents = new Map<string, SecurityEvent[]>();
  private readonly ipAttempts = new Map<string, number>();
  private readonly userSessions = new Map<string, any>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly redactionService: RedactionService,
  ) {
    // Register metrics
    register.registerMetric(this.securityEventsCounter);
    register.registerMetric(this.authFailuresCounter);
    register.registerMetric(this.unauthorizedAccessCounter);
    register.registerMetric(this.securityViolationsCounter);
    register.registerMetric(this.privilegeEscalationCounter);
    register.registerMetric(this.suspiciousFileAccessCounter);
    register.registerMetric(this.sshConnectionFailuresCounter);
    register.registerMetric(this.userSessionAnomalyGauge);
    register.registerMetric(this.securityConfigChangesCounter);
    register.registerMetric(this.malwareDetectedCounter);
    register.registerMetric(this.dataTransferGauge);
    register.registerMetric(this.backupIntegrityFailuresCounter);
  }

  /**
   * Record a security event
   */
  async recordSecurityEvent(event: SecurityEvent): Promise<void> {
    try {
      // Update Prometheus metrics
      this.securityEventsCounter
        .labels(event.type, event.severity, event.source)
        .inc();

      // Update specific metrics based on event type
      this.updateSpecificMetrics(event);

      // Store in database
      await this.storeSecurityEvent(event);

      // Update in-memory tracking
      this.updateInMemoryTracking(event);

      // Check for patterns and trigger alerts
      await this.analyzeSecurityPatterns(event);

      // Log the event
      this.logSecurityEvent(event);

    } catch (error) {
      this.logger.error('Failed to record security event', {
        error: error.message,
        event: this.redactionService.redactObject(event),
      });
    }
  }

  /**
   * Update specific Prometheus metrics based on event type
   */
  private updateSpecificMetrics(event: SecurityEvent): void {
    switch (event.type) {
      case SecurityEventType.AUTHENTICATION_FAILURE:
        this.authFailuresCounter
          .labels(event.sourceIp || 'unknown', event.metadata.userAgent || 'unknown')
          .inc();
        break;

      case SecurityEventType.UNAUTHORIZED_ACCESS:
        this.unauthorizedAccessCounter
          .labels(event.metadata.endpoint || 'unknown', event.sourceIp || 'unknown')
          .inc();
        break;

      case SecurityEventType.SQL_INJECTION_ATTEMPT:
      case SecurityEventType.XSS_ATTEMPT:
        this.securityViolationsCounter
          .labels(event.type, event.sourceIp || 'unknown')
          .inc();
        break;

      case SecurityEventType.PRIVILEGE_ESCALATION:
        this.privilegeEscalationCounter
          .labels(event.userId || 'unknown', event.metadata.targetRole || 'unknown')
          .inc();
        break;

      case SecurityEventType.SUSPICIOUS_FILE_ACCESS:
        this.suspiciousFileAccessCounter
          .labels(event.metadata.filePath || 'unknown', event.sourceIp || 'unknown')
          .inc();
        break;

      case SecurityEventType.SSH_CONNECTION_FAILURE:
        this.sshConnectionFailuresCounter
          .labels(event.metadata.serverId || 'unknown', event.metadata.errorType || 'unknown')
          .inc();
        break;

      case SecurityEventType.CONFIGURATION_CHANGE:
        this.securityConfigChangesCounter
          .labels(event.userId || 'unknown', event.metadata.configType || 'unknown')
          .inc();
        break;

      case SecurityEventType.BACKUP_INTEGRITY_FAILURE:
        this.backupIntegrityFailuresCounter
          .labels(event.metadata.backupId || 'unknown', event.metadata.failureType || 'unknown')
          .inc();
        break;
    }
  }

  /**
   * Store security event in database
   */
  private async storeSecurityEvent(event: SecurityEvent): Promise<void> {
    await this.prisma.auditEvent.create({
      data: {
        action: `SECURITY_EVENT_${event.type.toUpperCase()}`,
        resource: 'security',
        resourceId: event.requestId || null,
        description: `Security event: ${event.type}`,
        metadata: {
          ...event.metadata,
          severity: event.severity,
          source: event.source,
          sourceIp: event.sourceIp,
        },
        ipAddress: event.sourceIp || null,
        userAgent: event.metadata.userAgent || null,
        userId: event.userId || null,
        timestamp: event.timestamp,
        severity: 'HIGH',
      },
    });
  }

  /**
   * Update in-memory tracking for pattern detection
   */
  private updateInMemoryTracking(event: SecurityEvent): void {
    const key = `${event.type}_${event.sourceIp || 'unknown'}`;
    
    if (!this.recentEvents.has(key)) {
      this.recentEvents.set(key, []);
    }
    
    const events = this.recentEvents.get(key)!;
    events.push(event);
    
    // Keep only events from the last hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    this.recentEvents.set(
      key,
      events.filter(e => e.timestamp > oneHourAgo)
    );

    // Track IP-based attempts
    if (event.sourceIp) {
      const currentAttempts = this.ipAttempts.get(event.sourceIp) || 0;
      this.ipAttempts.set(event.sourceIp, currentAttempts + 1);
    }
  }

  /**
   * Analyze security patterns and trigger alerts
   */
  private async analyzeSecurityPatterns(event: SecurityEvent): Promise<void> {
    // Brute force detection
    if (event.type === SecurityEventType.AUTHENTICATION_FAILURE && event.sourceIp) {
      const recentFailures = this.getRecentEventCount(
        SecurityEventType.AUTHENTICATION_FAILURE,
        event.sourceIp,
        5 * 60 * 1000 // 5 minutes
      );

      if (recentFailures >= 10) {
        await this.triggerSecurityAlert({
          type: 'BRUTE_FORCE_DETECTED',
          severity: SecuritySeverity.CRITICAL,
          message: `Brute force attack detected from IP ${event.sourceIp}`,
          metadata: { sourceIp: event.sourceIp, attemptCount: recentFailures },
        });
      }
    }

    // Distributed attack detection
    if (event.sourceIp) {
      const totalAttempts = this.ipAttempts.get(event.sourceIp) || 0;
      if (totalAttempts >= 50) {
        await this.triggerSecurityAlert({
          type: 'DISTRIBUTED_ATTACK_DETECTED',
          severity: SecuritySeverity.HIGH,
          message: `High number of security events from IP ${event.sourceIp}`,
          metadata: { sourceIp: event.sourceIp, totalAttempts },
        });
      }
    }

    // Privilege escalation pattern
    if (event.type === SecurityEventType.PRIVILEGE_ESCALATION && event.userId) {
      const recentEscalations = this.getRecentEventCount(
        SecurityEventType.PRIVILEGE_ESCALATION,
        event.userId,
        10 * 60 * 1000 // 10 minutes
      );

      if (recentEscalations >= 3) {
        await this.triggerSecurityAlert({
          type: 'PRIVILEGE_ESCALATION_PATTERN',
          severity: SecuritySeverity.CRITICAL,
          message: `Multiple privilege escalation attempts by user ${event.userId}`,
          metadata: { userId: event.userId, attemptCount: recentEscalations },
        });
      }
    }
  }

  /**
   * Get count of recent events for pattern analysis
   */
  private getRecentEventCount(
    eventType: SecurityEventType,
    identifier: string,
    timeWindowMs: number
  ): number {
    const key = `${eventType}_${identifier}`;
    const events = this.recentEvents.get(key) || [];
    const cutoff = new Date(Date.now() - timeWindowMs);
    
    return events.filter(e => e.timestamp > cutoff).length;
  }

  /**
   * Trigger security alert
   */
  private async triggerSecurityAlert(alert: {
    type: string;
    severity: SecuritySeverity;
    message: string;
    metadata: Record<string, any>;
  }): Promise<void> {
    this.logger.error(`SECURITY ALERT: ${alert.message}`, {
      type: alert.type,
      severity: alert.severity,
      metadata: this.redactionService.redactObject(alert.metadata),
    });

    // Store alert in database
    await this.prisma.auditEvent.create({
      data: {
        action: `SECURITY_ALERT_${alert.type}`,
        resource: 'security_alert',
        description: alert.message,
        metadata: {
          ...alert.metadata,
          severity: alert.severity,
          message: alert.message,
        },
        timestamp: new Date(),
        severity: 'CRITICAL',
      },
    });

    // Send to external alerting system if configured
    await this.sendExternalAlert(alert);
  }

  /**
   * Send alert to external systems (webhook, email, etc.)
   */
  private async sendExternalAlert(alert: any): Promise<void> {
    const webhookUrl = this.configService.get<string>('SECURITY_WEBHOOK_URL');
    
    if (webhookUrl) {
      try {
        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.configService.get<string>('SECURITY_WEBHOOK_TOKEN')}`,
          },
          body: JSON.stringify({
            timestamp: new Date().toISOString(),
            service: 'wp-autohealer',
            ...alert,
          }),
        });

        if (!response.ok) {
          throw new Error(`Webhook failed with status ${response.status}`);
        }
      } catch (error) {
        this.logger.error('Failed to send security alert to webhook', {
          error: error.message,
          webhookUrl: this.redactionService.redactUrl(webhookUrl),
        });
      }
    }
  }

  /**
   * Log security event with appropriate level
   */
  private logSecurityEvent(event: SecurityEvent): void {
    const logData = {
      type: event.type,
      severity: event.severity,
      source: event.source,
      sourceIp: event.sourceIp,
      userId: event.userId,
      requestId: event.requestId,
      metadata: this.redactionService.redactObject(event.metadata),
      timestamp: event.timestamp.toISOString(),
    };

    switch (event.severity) {
      case SecuritySeverity.CRITICAL:
        this.logger.error(`CRITICAL SECURITY EVENT: ${event.type}`, logData);
        break;
      case SecuritySeverity.HIGH:
        this.logger.error(`HIGH SECURITY EVENT: ${event.type}`, logData);
        break;
      case SecuritySeverity.MEDIUM:
        this.logger.warn(`MEDIUM SECURITY EVENT: ${event.type}`, logData);
        break;
      case SecuritySeverity.LOW:
        this.logger.log(`LOW SECURITY EVENT: ${event.type}`, logData);
        break;
    }
  }

  /**
   * Clean up old tracking data (runs every hour)
   */
  @Cron(CronExpression.EVERY_HOUR)
  private cleanupTrackingData(): void {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    
    // Clean up recent events
    for (const [key, events] of this.recentEvents.entries()) {
      const filteredEvents = events.filter(e => e.timestamp > oneHourAgo);
      if (filteredEvents.length === 0) {
        this.recentEvents.delete(key);
      } else {
        this.recentEvents.set(key, filteredEvents);
      }
    }

    // Reset IP attempt counters
    this.ipAttempts.clear();

    this.logger.debug('Cleaned up security monitoring tracking data');
  }

  /**
   * Get security metrics for monitoring dashboard
   */
  async getSecurityMetrics(): Promise<any> {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const [
      recentEvents,
      dailyEvents,
      topSourceIPs,
      eventsByType,
    ] = await Promise.all([
      this.prisma.auditEvent.count({
        where: {
          action: { startsWith: 'SECURITY_EVENT_' },
          timestamp: { gte: oneHourAgo },
        },
      }),
      this.prisma.auditEvent.count({
        where: {
          action: { startsWith: 'SECURITY_EVENT_' },
          timestamp: { gte: oneDayAgo },
        },
      }),
      this.prisma.auditEvent.groupBy({
        by: ['ipAddress'],
        where: {
          action: { startsWith: 'SECURITY_EVENT_' },
          timestamp: { gte: oneDayAgo },
          ipAddress: { not: null },
        },
        _count: { ipAddress: true },
        orderBy: { _count: { ipAddress: 'desc' } },
        take: 10,
      }),
      this.prisma.auditEvent.groupBy({
        by: ['action'],
        where: {
          action: { startsWith: 'SECURITY_EVENT_' },
          timestamp: { gte: oneDayAgo },
        },
        _count: { action: true },
        orderBy: { _count: { action: 'desc' } },
      }),
    ]);

    return {
      summary: {
        recentEvents,
        dailyEvents,
        activeThreats: this.recentEvents.size,
        monitoredIPs: this.ipAttempts.size,
      },
      topSourceIPs: topSourceIPs.map(item => ({
        ip: item.ipAddress,
        count: item._count.ipAddress,
      })),
      eventsByType: eventsByType.map(item => ({
        type: item.action.replace('SECURITY_EVENT_', ''),
        count: item._count.action,
      })),
      timestamp: now.toISOString(),
    };
  }
}