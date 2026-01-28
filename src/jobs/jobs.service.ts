import { Injectable, Logger } from '@nestjs/common';
import { QueueConfigService, JobTypes } from './queue.config';
import { IncidentJobData, IncidentState } from './incident-processor.service';
import { DataRetentionJobData } from './workers/data-retention.worker';
import { HealthCheckJobData } from './workers/health-check.worker';
import { FlappingPreventionService } from './flapping-prevention.service';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    private readonly queueConfig: QueueConfigService,
    private readonly flappingPrevention: FlappingPreventionService,
  ) {}

  /**
   * Create a new incident processing job with flapping prevention
   */
  async createIncident(data: {
    siteId: string;
    serverId: string;
    triggerType: string;
    priority?: string;
    maxFixAttempts?: number;
    metadata?: Record<string, any>;
  }) {
    const incidentId = uuidv4();
    const correlationId = uuidv4();
    const traceId = uuidv4();

    // Check flapping prevention before creating incident
    const flappingCheck = this.flappingPrevention.canCreateIncident(data.siteId);
    if (!flappingCheck.allowed) {
      this.logger.warn(`Incident creation blocked for site ${data.siteId}`, {
        reason: flappingCheck.reason,
        cooldownUntil: flappingCheck.cooldownUntil,
        shouldEscalate: flappingCheck.shouldEscalate,
      });

      return {
        success: false,
        reason: flappingCheck.reason,
        cooldownUntil: flappingCheck.cooldownUntil,
        shouldEscalate: flappingCheck.shouldEscalate,
        siteId: data.siteId,
      };
    }

    // Record the incident creation
    this.flappingPrevention.recordIncident(data.siteId, incidentId);

    const jobData: IncidentJobData = {
      incidentId,
      siteId: data.siteId,
      serverId: data.serverId,
      currentState: IncidentState.NEW,
      fixAttempts: 0,
      maxFixAttempts: data.maxFixAttempts || 15,
      metadata: {
        triggerType: data.triggerType,
        priority: data.priority || 'medium',
        createdAt: new Date().toISOString(),
        ...data.metadata,
      },
      correlationId,
      traceId,
    };

    const job = await this.queueConfig.addIncidentJob(
      JobTypes.PROCESS_INCIDENT,
      jobData,
      {
        jobId: `incident-${incidentId}`,
        priority: this.getPriorityValue(data.priority),
      }
    );

    this.logger.log(`Created incident processing job for incident ${incidentId}`, {
      jobId: job.id,
      siteId: data.siteId,
      serverId: data.serverId,
      correlationId,
      traceId,
    });

    return {
      success: true,
      incidentId,
      jobId: job.id,
      correlationId,
      traceId,
      state: IncidentState.NEW,
    };
  }

  /**
   * Schedule data retention purge job
   */
  async scheduleDataPurge(data: {
    retentionDays: number;
    tableName?: string;
    dryRun?: boolean;
  }) {
    const correlationId = uuidv4();
    const cutoffDate = new Date(Date.now() - data.retentionDays * 24 * 60 * 60 * 1000).toISOString();

    const jobData: DataRetentionJobData = {
      retentionDays: data.retentionDays,
      cutoffDate,
      dryRun: data.dryRun || false,
      correlationId,
    };

    if (data.tableName) {
      jobData.tableName = data.tableName;
    }

    const job = await this.queueConfig.addDataRetentionJob(
      JobTypes.PURGE_EXPIRED_DATA,
      jobData,
      {
        jobId: `purge-${Date.now()}`,
        priority: 5, // Lower priority for maintenance jobs
      }
    );

    this.logger.log(`Scheduled data purge job`, {
      jobId: job.id,
      retentionDays: data.retentionDays,
      tableName: data.tableName,
      dryRun: data.dryRun,
      correlationId,
    });

    return {
      jobId: job.id,
      correlationId,
      retentionDays: data.retentionDays,
      cutoffDate,
    };
  }

  /**
   * Schedule artifact cleanup job
   */
  async scheduleArtifactCleanup(data: {
    retentionDays: number;
  }) {
    const correlationId = uuidv4();

    const jobData: DataRetentionJobData = {
      retentionDays: data.retentionDays,
      correlationId,
    };

    const job = await this.queueConfig.addDataRetentionJob(
      JobTypes.CLEANUP_ARTIFACTS,
      jobData,
      {
        jobId: `cleanup-${Date.now()}`,
        priority: 5,
      }
    );

    this.logger.log(`Scheduled artifact cleanup job`, {
      jobId: job.id,
      retentionDays: data.retentionDays,
      correlationId,
    });

    return {
      jobId: job.id,
      correlationId,
    };
  }

  /**
   * Schedule data anonymization job
   */
  async scheduleDataAnonymization(data: {
    retentionDays: number;
    tableName?: string;
    anonymizePersonalData?: boolean;
    anonymizeCredentials?: boolean;
    anonymizeIpAddresses?: boolean;
  }) {
    const correlationId = uuidv4();

    const jobData = {
      retentionDays: data.retentionDays,
      tableName: data.tableName,
      anonymizePersonalData: data.anonymizePersonalData ?? true,
      anonymizeCredentials: data.anonymizeCredentials ?? true,
      anonymizeIpAddresses: data.anonymizeIpAddresses ?? true,
      correlationId,
    };

    const job = await this.queueConfig.addDataRetentionJob(
      JobTypes.ANONYMIZE_DATA,
      jobData,
      {
        jobId: `anonymize-${Date.now()}`,
        priority: 6, // Lower priority than purge jobs
      }
    );

    this.logger.log(`Scheduled data anonymization job`, {
      jobId: job.id,
      retentionDays: data.retentionDays,
      tableName: data.tableName,
      correlationId,
    });

    return {
      jobId: job.id,
      correlationId,
    };
  }

  /**
   * Schedule site health check
   */
  async scheduleSiteHealthCheck(data: {
    siteId: string;
    url?: string;
    timeout?: number;
  }) {
    const correlationId = uuidv4();

    const jobData: HealthCheckJobData = {
      siteId: data.siteId,
      checkType: 'site',
      timeout: data.timeout || 30000,
      correlationId,
    };

    if (data.url) {
      jobData.url = data.url;
    }

    const job = await this.queueConfig.addHealthCheckJob(
      JobTypes.SITE_HEALTH_CHECK,
      jobData,
      {
        jobId: `health-site-${data.siteId}-${Date.now()}`,
        priority: 3,
      }
    );

    this.logger.debug(`Scheduled site health check`, {
      jobId: job.id,
      siteId: data.siteId,
      correlationId,
    });

    return {
      jobId: job.id,
      correlationId,
    };
  }

  /**
   * Schedule server health check
   */
  async scheduleServerHealthCheck(data: {
    serverId: string;
    timeout?: number;
  }) {
    const correlationId = uuidv4();

    const jobData: HealthCheckJobData = {
      serverId: data.serverId,
      checkType: 'server',
      timeout: data.timeout || 30000,
      correlationId,
    };

    const job = await this.queueConfig.addHealthCheckJob(
      JobTypes.SERVER_HEALTH_CHECK,
      jobData,
      {
        jobId: `health-server-${data.serverId}-${Date.now()}`,
        priority: 3,
      }
    );

    this.logger.debug(`Scheduled server health check`, {
      jobId: job.id,
      serverId: data.serverId,
      correlationId,
    });

    return {
      jobId: job.id,
      correlationId,
    };
  }

  /**
   * Schedule system health check
   */
  async scheduleSystemHealthCheck() {
    const correlationId = uuidv4();

    const jobData: HealthCheckJobData = {
      checkType: 'system',
      correlationId,
    };

    const job = await this.queueConfig.addHealthCheckJob(
      JobTypes.SYSTEM_HEALTH_CHECK,
      jobData,
      {
        jobId: `health-system-${Date.now()}`,
        priority: 2,
      }
    );

    this.logger.debug(`Scheduled system health check`, {
      jobId: job.id,
      correlationId,
    });

    return {
      jobId: job.id,
      correlationId,
    };
  }

  /**
   * Get queue statistics
   */
  async getQueueStats() {
    return await this.queueConfig.getAllQueueStats();
  }

  /**
   * Pause a queue
   */
  async pauseQueue(queueName: string) {
    await this.queueConfig.pauseQueue(queueName);
    this.logger.log(`Queue ${queueName} paused`);
  }

  /**
   * Resume a queue
   */
  async resumeQueue(queueName: string) {
    await this.queueConfig.resumeQueue(queueName);
    this.logger.log(`Queue ${queueName} resumed`);
  }

  /**
   * Clean a queue
   */
  async cleanQueue(queueName: string, gracePeriodHours: number = 24) {
    const gracePeriodMs = gracePeriodHours * 60 * 60 * 1000;
    await this.queueConfig.cleanQueue(queueName, gracePeriodMs);
    this.logger.log(`Queue ${queueName} cleaned`);
  }

  /**
   * Get priority value for job scheduling
   */
  private getPriorityValue(priority?: string): number {
    switch (priority?.toLowerCase()) {
      case 'critical':
        return 1;
      case 'high':
        return 2;
      case 'medium':
        return 3;
      case 'low':
        return 4;
      default:
        return 3; // Default to medium priority
    }
  }
}