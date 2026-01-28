import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Worker, Job } from 'bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { QueueNames, JobTypes } from '../queue.config';
import { RedisConfigService } from '@/config/redis.config';

export interface HealthCheckJobData {
  siteId?: string;
  serverId?: string;
  checkType: 'site' | 'server' | 'system';
  url?: string;
  timeout?: number;
  correlationId?: string;
}

@Injectable()
export class HealthCheckWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HealthCheckWorker.name);
  private worker!: Worker;

  constructor(
    private readonly redisConfig: RedisConfigService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async onModuleInit() {
    await this.initializeWorker();
  }

  async onModuleDestroy() {
    await this.closeWorker();
  }

  private async initializeWorker() {
    this.worker = new Worker(
      QueueNames.HEALTH_CHECKS,
      async (job: Job) => {
        return await this.processJob(job);
      },
      {
        connection: this.redisConfig.getRedisOptions(),
        concurrency: 5, // Process multiple health checks concurrently
      }
    );

    // Set up worker event handlers
    this.worker.on('ready', () => {
      this.logger.log('Health check worker is ready');
    });

    this.worker.on('error', (error) => {
      this.logger.error('Health check worker error:', error);
    });

    this.worker.on('failed', (job, error) => {
      this.logger.error(`Health check job ${job?.id} failed:`, error);
    });

    this.worker.on('completed', (job, result) => {
      this.logger.debug(`Health check job ${job.id} completed:`, result);
    });

    this.logger.log('Health check worker initialized');
  }

  private async processJob(job: Job): Promise<any> {
    const { name: jobType, data } = job;
    
    this.logger.debug(`Processing health check job ${job.id} of type ${jobType}`, {
      checkType: data.checkType,
      siteId: data.siteId,
      serverId: data.serverId,
      correlationId: data.correlationId,
    });

    try {
      switch (jobType) {
        case JobTypes.SITE_HEALTH_CHECK:
          return await this.processSiteHealthCheck(job);
        
        case JobTypes.SERVER_HEALTH_CHECK:
          return await this.processServerHealthCheck(job);
        
        case JobTypes.SYSTEM_HEALTH_CHECK:
          return await this.processSystemHealthCheck(job);
        
        default:
          throw new Error(`Unknown health check job type: ${jobType}`);
      }
    } catch (error) {
      this.logger.error(`Error processing health check job ${job.id}:`, error);
      throw error;
    }
  }

  private async processSiteHealthCheck(job: Job<HealthCheckJobData>): Promise<any> {
    const { data } = job;
    this.logger.debug(`Processing site health check for site ${data.siteId}`);

    await job.updateProgress(20);

    // TODO: Implement actual site health check logic
    // This will perform HTTP requests and verify site functionality
    
    // Simulate health check work
    await new Promise(resolve => setTimeout(resolve, 1000));
    await job.updateProgress(60);

    // Simulate health check results
    const isHealthy = Math.random() > 0.1; // 90% healthy rate
    const responseTime = Math.floor(Math.random() * 1000) + 100; // 100-1100ms
    const httpStatus = isHealthy ? 200 : (Math.random() > 0.5 ? 500 : 404);

    const healthCheckResult = {
      siteId: data.siteId,
      url: data.url || `https://site-${data.siteId}.example.com`,
      isHealthy,
      httpStatus,
      responseTime,
      checks: {
        httpResponse: isHealthy,
        titleTag: isHealthy && Math.random() > 0.05,
        canonicalTag: isHealthy && Math.random() > 0.1,
        footerMarkers: isHealthy && Math.random() > 0.05,
        headerMarkers: isHealthy && Math.random() > 0.05,
        wpLogin: isHealthy && Math.random() > 0.1,
        internalUrls: isHealthy && Math.random() > 0.15,
      },
      errors: isHealthy ? [] : [
        'HTTP 500 Internal Server Error',
        'PHP Fatal Error detected',
      ],
      checkedAt: new Date().toISOString(),
    };

    await job.updateProgress(100);

    const result = {
      success: true,
      checkType: 'site',
      result: healthCheckResult,
    };

    // Emit SSE event for site health update
    this.eventEmitter.emit('site.health.updated', {
      siteId: data.siteId,
      domain: data.url || `site-${data.siteId}.example.com`,
      status: isHealthy ? 'healthy' : 'critical',
      lastCheck: healthCheckResult.checkedAt,
      responseTime: healthCheckResult.responseTime,
      details: healthCheckResult
    });

    if (!isHealthy) {
      this.logger.warn(`Site ${data.siteId} health check failed`, healthCheckResult);
    }
    
    return result;
  }

  private async processServerHealthCheck(job: Job<HealthCheckJobData>): Promise<any> {
    const { data } = job;
    this.logger.debug(`Processing server health check for server ${data.serverId}`);

    await job.updateProgress(20);

    // TODO: Implement actual server health check logic
    // This will check SSH connectivity, disk space, memory, etc.
    
    // Simulate server health check work
    await new Promise(resolve => setTimeout(resolve, 1500));
    await job.updateProgress(70);

    // Simulate server health results
    const isHealthy = Math.random() > 0.05; // 95% healthy rate
    const diskUsage = Math.floor(Math.random() * 80) + 10; // 10-90%
    const memoryUsage = Math.floor(Math.random() * 70) + 20; // 20-90%
    const cpuUsage = Math.floor(Math.random() * 60) + 10; // 10-70%

    const serverHealthResult = {
      serverId: data.serverId,
      isHealthy,
      sshConnectable: isHealthy,
      systemMetrics: {
        diskUsagePercent: diskUsage,
        memoryUsagePercent: memoryUsage,
        cpuUsagePercent: cpuUsage,
        loadAverage: parseFloat((Math.random() * 2).toFixed(2)),
      },
      services: {
        apache: isHealthy && Math.random() > 0.02,
        nginx: isHealthy && Math.random() > 0.02,
        mysql: isHealthy && Math.random() > 0.05,
        php: isHealthy && Math.random() > 0.02,
      },
      errors: isHealthy ? [] : [
        'SSH connection timeout',
        'High disk usage detected',
      ],
      checkedAt: new Date().toISOString(),
    };

    await job.updateProgress(100);

    const result = {
      success: true,
      checkType: 'server',
      result: serverHealthResult,
    };

    if (!isHealthy) {
      this.logger.warn(`Server ${data.serverId} health check failed`, serverHealthResult);
    }
    
    return result;
  }

  private async processSystemHealthCheck(job: Job<HealthCheckJobData>): Promise<any> {
    this.logger.debug(`Processing system health check`);

    await job.updateProgress(20);

    // TODO: Implement actual system health check logic
    // This will check database connectivity, Redis, queue status, etc.
    
    // Simulate system health check work
    await new Promise(resolve => setTimeout(resolve, 800));
    await job.updateProgress(60);

    // Simulate system health results
    const isHealthy = Math.random() > 0.02; // 98% healthy rate

    const systemHealthResult = {
      isHealthy,
      components: {
        database: {
          status: isHealthy ? 'healthy' : 'unhealthy',
          responseTime: Math.floor(Math.random() * 50) + 5, // 5-55ms
          activeConnections: Math.floor(Math.random() * 20) + 5,
        },
        redis: {
          status: isHealthy ? 'healthy' : 'unhealthy',
          responseTime: Math.floor(Math.random() * 10) + 1, // 1-11ms
          memoryUsage: Math.floor(Math.random() * 100) + 50, // MB
        },
        queues: {
          status: isHealthy ? 'healthy' : 'unhealthy',
          activeJobs: Math.floor(Math.random() * 10),
          failedJobs: Math.floor(Math.random() * 3),
          waitingJobs: Math.floor(Math.random() * 20),
        },
        storage: {
          status: isHealthy ? 'healthy' : 'unhealthy',
          diskUsagePercent: Math.floor(Math.random() * 60) + 20,
          availableSpaceGB: Math.floor(Math.random() * 100) + 50,
        },
      },
      errors: isHealthy ? [] : [
        'Database connection pool exhausted',
        'Redis memory usage high',
      ],
      checkedAt: new Date().toISOString(),
    };

    await job.updateProgress(100);

    const result = {
      success: true,
      checkType: 'system',
      result: systemHealthResult,
    };

    // Emit SSE events for system status updates
    this.eventEmitter.emit('system.status.updated', {
      component: 'database',
      status: systemHealthResult.components.database.status === 'healthy' ? 'operational' : 'down',
      details: systemHealthResult.components.database
    });

    this.eventEmitter.emit('system.status.updated', {
      component: 'job_engine',
      status: systemHealthResult.components.queues.status === 'healthy' ? 
        (systemHealthResult.components.queues.activeJobs > 0 ? 'processing' : 'idle') : 'error',
      details: systemHealthResult.components.queues
    });

    if (!isHealthy) {
      this.logger.warn(`System health check failed`, systemHealthResult);
    }
    
    return result;
  }

  private async closeWorker() {
    if (this.worker) {
      this.logger.log('Closing health check worker...');
      await this.worker.close();
      this.logger.log('Health check worker closed');
    }
  }
}