import { Injectable } from '@nestjs/common';
import { Queue, Worker, QueueEvents } from 'bullmq';
import { RedisConfigService } from '@/config/redis.config';

export enum QueueNames {
  INCIDENT_PROCESSING = 'incident-processing',
  DATA_RETENTION = 'data-retention',
  HEALTH_CHECKS = 'health-checks',
  NOTIFICATIONS = 'notifications',
}

export enum JobTypes {
  // Incident processing jobs
  PROCESS_INCIDENT = 'process-incident',
  DISCOVERY_PHASE = 'discovery-phase',
  BASELINE_PHASE = 'baseline-phase',
  BACKUP_PHASE = 'backup-phase',
  OBSERVABILITY_PHASE = 'observability-phase',
  FIX_ATTEMPT_PHASE = 'fix-attempt-phase',
  VERIFY_PHASE = 'verify-phase',
  ROLLBACK_PHASE = 'rollback-phase',
  ESCALATE_INCIDENT = 'escalate-incident',
  
  // Data retention jobs
  PURGE_EXPIRED_DATA = 'purge-expired-data',
  CLEANUP_ARTIFACTS = 'cleanup-artifacts',
  AUDIT_PURGE = 'audit-purge',
  ANONYMIZE_DATA = 'anonymize-data',
  
  // Health check jobs
  SITE_HEALTH_CHECK = 'site-health-check',
  SERVER_HEALTH_CHECK = 'server-health-check',
  SYSTEM_HEALTH_CHECK = 'system-health-check',
  
  // Notification jobs
  SEND_ALERT = 'send-alert',
  SEND_ESCALATION = 'send-escalation',
  SEND_REPORT = 'send-report',
}

@Injectable()
export class QueueConfigService {
  private queues: Map<string, Queue> = new Map();
  private workers: Map<string, Worker> = new Map();
  private queueEvents: Map<string, QueueEvents> = new Map();

  constructor(private readonly redisConfig: RedisConfigService) {}

  /**
   * Initialize all queues with their configurations
   */
  async initializeQueues(): Promise<void> {
    // Initialize incident processing queue
    await this.createQueue(QueueNames.INCIDENT_PROCESSING);
    
    // Initialize data retention queue
    await this.createQueue(QueueNames.DATA_RETENTION);
    
    // Initialize health checks queue
    await this.createQueue(QueueNames.HEALTH_CHECKS);
    
    // Initialize notifications queue
    await this.createQueue(QueueNames.NOTIFICATIONS);

    console.log('All BullMQ queues initialized successfully');
  }

  /**
   * Create a queue with proper configuration
   */
  private async createQueue(queueName: string): Promise<Queue> {
    if (this.queues.has(queueName)) {
      return this.queues.get(queueName)!;
    }

    const queueOptions = this.redisConfig.getQueueOptions(queueName);
    const queue = new Queue(queueName, queueOptions);

    // Set up queue events for monitoring
    const queueEvents = new QueueEvents(queueName, {
      connection: this.redisConfig.getRedisOptions(),
    });

    // Event handlers for monitoring and logging
    queueEvents.on('waiting', ({ jobId }) => {
      console.log(`Job ${jobId} is waiting in queue ${queueName}`);
    });

    queueEvents.on('active', ({ jobId, prev }) => {
      console.log(`Job ${jobId} is now active in queue ${queueName} (was ${prev})`);
    });

    queueEvents.on('completed', ({ jobId, returnvalue }) => {
      console.log(`Job ${jobId} completed in queue ${queueName}:`, returnvalue);
    });

    queueEvents.on('failed', ({ jobId, failedReason }) => {
      console.error(`Job ${jobId} failed in queue ${queueName}:`, failedReason);
    });

    queueEvents.on('progress', ({ jobId, data }) => {
      console.log(`Job ${jobId} progress in queue ${queueName}:`, data);
    });

    queueEvents.on('stalled', ({ jobId }) => {
      console.warn(`Job ${jobId} stalled in queue ${queueName}`);
    });

    // Store references
    this.queues.set(queueName, queue);
    this.queueEvents.set(queueName, queueEvents);

    console.log(`Queue ${queueName} created successfully`);
    return queue;
  }

  /**
   * Get a queue by name
   */
  getQueue(queueName: string): Queue | undefined {
    return this.queues.get(queueName);
  }

  /**
   * Get the incident processing queue
   */
  getIncidentQueue(): Queue {
    const queue = this.getQueue(QueueNames.INCIDENT_PROCESSING);
    if (!queue) {
      throw new Error('Incident processing queue not initialized');
    }
    return queue;
  }

  /**
   * Get the data retention queue
   */
  getDataRetentionQueue(): Queue {
    const queue = this.getQueue(QueueNames.DATA_RETENTION);
    if (!queue) {
      throw new Error('Data retention queue not initialized');
    }
    return queue;
  }

  /**
   * Get the health checks queue
   */
  getHealthChecksQueue(): Queue {
    const queue = this.getQueue(QueueNames.HEALTH_CHECKS);
    if (!queue) {
      throw new Error('Health checks queue not initialized');
    }
    return queue;
  }

  /**
   * Get the notifications queue
   */
  getNotificationsQueue(): Queue {
    const queue = this.getQueue(QueueNames.NOTIFICATIONS);
    if (!queue) {
      throw new Error('Notifications queue not initialized');
    }
    return queue;
  }

  /**
   * Add a job to the incident processing queue
   */
  async addIncidentJob(jobType: JobTypes, data: any, options?: any) {
    const queue = this.getIncidentQueue();
    const jobOptions = {
      ...this.redisConfig.getIncidentJobOptions(),
      ...options,
    };

    return await queue.add(jobType, data, jobOptions);
  }

  /**
   * Add a job to the data retention queue
   */
  async addDataRetentionJob(jobType: JobTypes, data: any, options?: any) {
    const queue = this.getDataRetentionQueue();
    const jobOptions = {
      ...this.redisConfig.getDefaultJobOptions(),
      ...options,
    };

    return await queue.add(jobType, data, jobOptions);
  }

  /**
   * Add a job to the health checks queue
   */
  async addHealthCheckJob(jobType: JobTypes, data: any, options?: any) {
    const queue = this.getHealthChecksQueue();
    const jobOptions = {
      ...this.redisConfig.getDefaultJobOptions(),
      ...options,
    };

    return await queue.add(jobType, data, jobOptions);
  }

  /**
   * Add a job to the notifications queue
   */
  async addNotificationJob(jobType: JobTypes, data: any, options?: any) {
    const queue = this.getNotificationsQueue();
    const jobOptions = {
      ...this.redisConfig.getDefaultJobOptions(),
      ...options,
    };

    return await queue.add(jobType, data, jobOptions);
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(queueName: string) {
    const queue = this.getQueue(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }

    const [waiting, active, completed, failed, delayed] = await Promise.all([
      queue.getWaiting(),
      queue.getActive(),
      queue.getCompleted(),
      queue.getFailed(),
      queue.getDelayed(),
    ]);

    return {
      queueName,
      counts: {
        waiting: waiting.length,
        active: active.length,
        completed: completed.length,
        failed: failed.length,
        delayed: delayed.length,
      },
      jobs: {
        waiting: waiting.slice(0, 10), // First 10 waiting jobs
        active: active.slice(0, 10), // First 10 active jobs
        failed: failed.slice(0, 10), // First 10 failed jobs
      },
    };
  }

  /**
   * Get all queue statistics
   */
  async getAllQueueStats() {
    const stats = await Promise.all(
      Array.from(this.queues.keys()).map(queueName => 
        this.getQueueStats(queueName)
      )
    );

    return stats;
  }

  /**
   * Pause a queue
   */
  async pauseQueue(queueName: string): Promise<void> {
    const queue = this.getQueue(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }

    await queue.pause();
    console.log(`Queue ${queueName} paused`);
  }

  /**
   * Resume a queue
   */
  async resumeQueue(queueName: string): Promise<void> {
    const queue = this.getQueue(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }

    await queue.resume();
    console.log(`Queue ${queueName} resumed`);
  }

  /**
   * Clean up completed and failed jobs
   */
  async cleanQueue(queueName: string, grace: number = 24 * 60 * 60 * 1000): Promise<void> {
    const queue = this.getQueue(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }

    // Clean completed jobs older than grace period
    await queue.clean(grace, 100, 'completed');
    
    // Clean failed jobs older than grace period
    await queue.clean(grace, 50, 'failed');

    console.log(`Queue ${queueName} cleaned`);
  }

  /**
   * Gracefully close all queues and connections
   */
  async closeAll(): Promise<void> {
    console.log('Closing all BullMQ queues and connections...');

    // Close all workers first
    await Promise.all(
      Array.from(this.workers.values()).map(worker => worker.close())
    );

    // Close all queue events
    await Promise.all(
      Array.from(this.queueEvents.values()).map(queueEvents => queueEvents.close())
    );

    // Close all queues
    await Promise.all(
      Array.from(this.queues.values()).map(queue => queue.close())
    );

    // Clear all maps
    this.workers.clear();
    this.queueEvents.clear();
    this.queues.clear();

    console.log('All BullMQ queues and connections closed');
  }
}