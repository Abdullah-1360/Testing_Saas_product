import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/database/prisma.service';
import { RedisConfigService } from '@/config/redis.config';
import { Gauge, Counter, register } from 'prom-client';
import Redis from 'ioredis';

export interface InfrastructureMetrics {
  database: {
    status: 'healthy' | 'warning' | 'critical';
    connections: number;
    responseTime: number;
  };
  redis: {
    status: 'healthy' | 'warning' | 'critical';
    memoryUsage: number;
    responseTime: number;
  };
  queues: {
    status: 'healthy' | 'warning' | 'critical';
    activeJobs: number;
    failedJobs: number;
    waitingJobs: number;
  };
}

export interface HealthCheckResult {
  healthy: boolean;
  responseTime: number;
  details?: any;
}

@Injectable()
export class SystemMetricsService {
  private readonly logger = new Logger(SystemMetricsService.name);
  private redis: Redis;

  // Prometheus metrics for system monitoring
  private readonly systemCpuUsage = new Gauge({
    name: 'wp_autohealer_system_cpu_usage_percent',
    help: 'System CPU usage percentage',
  });

  private readonly systemMemoryUsage = new Gauge({
    name: 'wp_autohealer_system_memory_usage_bytes',
    help: 'System memory usage in bytes',
  });

  private readonly systemMemoryTotal = new Gauge({
    name: 'wp_autohealer_system_memory_total_bytes',
    help: 'Total system memory in bytes',
  });

  private readonly processMemoryUsage = new Gauge({
    name: 'wp_autohealer_process_memory_usage_bytes',
    help: 'Process memory usage in bytes',
    labelNames: ['type'],
  });

  private readonly processUptime = new Gauge({
    name: 'wp_autohealer_process_uptime_seconds',
    help: 'Process uptime in seconds',
  });

  private readonly databaseHealthStatus = new Gauge({
    name: 'wp_autohealer_database_health_status',
    help: 'Database health status (1 = healthy, 0 = unhealthy)',
  });

  private readonly databaseResponseTime = new Gauge({
    name: 'wp_autohealer_database_response_time_ms',
    help: 'Database response time in milliseconds',
  });

  private readonly redisHealthStatus = new Gauge({
    name: 'wp_autohealer_redis_health_status',
    help: 'Redis health status (1 = healthy, 0 = unhealthy)',
  });

  private readonly redisResponseTime = new Gauge({
    name: 'wp_autohealer_redis_response_time_ms',
    help: 'Redis response time in milliseconds',
  });

  private readonly redisMemoryUsage = new Gauge({
    name: 'wp_autohealer_redis_memory_usage_bytes',
    help: 'Redis memory usage in bytes',
  });

  private readonly diskUsage = new Gauge({
    name: 'wp_autohealer_disk_usage_bytes',
    help: 'Disk usage in bytes',
    labelNames: ['mount_point'],
  });

  private readonly networkConnections = new Gauge({
    name: 'wp_autohealer_network_connections_total',
    help: 'Total number of network connections',
    labelNames: ['state'],
  });

  private readonly fileDescriptors = new Gauge({
    name: 'wp_autohealer_file_descriptors_open',
    help: 'Number of open file descriptors',
  });

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly redisConfig: RedisConfigService,
  ) {
    // Initialize Redis connection for health checks
    this.redis = new Redis(this.redisConfig.getRedisOptions());

    // Register metrics
    register.registerMetric(this.systemCpuUsage);
    register.registerMetric(this.systemMemoryUsage);
    register.registerMetric(this.systemMemoryTotal);
    register.registerMetric(this.processMemoryUsage);
    register.registerMetric(this.processUptime);
    register.registerMetric(this.databaseHealthStatus);
    register.registerMetric(this.databaseResponseTime);
    register.registerMetric(this.redisHealthStatus);
    register.registerMetric(this.redisResponseTime);
    register.registerMetric(this.redisMemoryUsage);
    register.registerMetric(this.diskUsage);
    register.registerMetric(this.networkConnections);
    register.registerMetric(this.fileDescriptors);

    // Update system metrics every 30 seconds
    setInterval(() => this.updateSystemMetrics(), 30000);
  }

  /**
   * Get comprehensive infrastructure metrics
   */
  async getInfrastructureMetrics(): Promise<InfrastructureMetrics> {
    const [databaseHealth, redisHealth, queueMetrics] = await Promise.all([
      this.checkDatabaseHealth(),
      this.checkRedisHealth(),
      this.getQueueMetrics(),
    ]);

    return {
      database: {
        status: databaseHealth.healthy ? 'healthy' : 'critical',
        connections: databaseHealth.details?.connections || 0,
        responseTime: databaseHealth.responseTime,
      },
      redis: {
        status: redisHealth.healthy ? 'healthy' : 'critical',
        memoryUsage: redisHealth.details?.memoryUsage || 0,
        responseTime: redisHealth.responseTime,
      },
      queues: {
        status: queueMetrics.healthy ? 'healthy' : 'warning',
        activeJobs: queueMetrics.activeJobs,
        failedJobs: queueMetrics.failedJobs,
        waitingJobs: queueMetrics.waitingJobs,
      },
    };
  }

  /**
   * Check database health and connectivity
   */
  async checkDatabaseHealth(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    
    try {
      // Simple query to test connectivity and response time
      await this.prisma.$queryRaw`SELECT 1`;
      
      // Get connection pool information if available
      const connections = await this.getDatabaseConnections();
      
      const responseTime = Date.now() - startTime;
      
      // Update Prometheus metrics
      this.databaseHealthStatus.set(1);
      this.databaseResponseTime.set(responseTime);
      
      return {
        healthy: true,
        responseTime,
        details: { connections },
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      
      // Update Prometheus metrics
      this.databaseHealthStatus.set(0);
      this.databaseResponseTime.set(responseTime);
      
      this.logger.error('Database health check failed', error);
      
      return {
        healthy: false,
        responseTime,
        details: { error: error.message },
      };
    }
  }

  /**
   * Check Redis health and connectivity
   */
  async checkRedisHealth(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    
    try {
      // Test Redis connectivity with PING
      await this.redis.ping();
      
      // Get Redis memory usage
      const info = await this.redis.info('memory');
      const memoryUsage = this.parseRedisMemoryInfo(info);
      
      const responseTime = Date.now() - startTime;
      
      // Update Prometheus metrics
      this.redisHealthStatus.set(1);
      this.redisResponseTime.set(responseTime);
      this.redisMemoryUsage.set(memoryUsage);
      
      return {
        healthy: true,
        responseTime,
        details: { memoryUsage },
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      
      // Update Prometheus metrics
      this.redisHealthStatus.set(0);
      this.redisResponseTime.set(responseTime);
      
      this.logger.error('Redis health check failed', error);
      
      return {
        healthy: false,
        responseTime,
        details: { error: error.message },
      };
    }
  }

  /**
   * Get queue metrics and health status
   */
  async getQueueMetrics(): Promise<{
    healthy: boolean;
    activeJobs: number;
    failedJobs: number;
    waitingJobs: number;
  }> {
    try {
      // Get queue statistics from Redis
      const [activeJobs, failedJobs, waitingJobs] = await Promise.all([
        this.getQueueJobCount('active'),
        this.getQueueJobCount('failed'),
        this.getQueueJobCount('waiting'),
      ]);

      // Consider queues unhealthy if there are too many failed jobs
      const healthy = failedJobs < 100; // Threshold for failed jobs

      return {
        healthy,
        activeJobs,
        failedJobs,
        waitingJobs,
      };
    } catch (error) {
      this.logger.error('Failed to get queue metrics', error);
      return {
        healthy: false,
        activeJobs: 0,
        failedJobs: 0,
        waitingJobs: 0,
      };
    }
  }

  /**
   * Update system-level metrics
   */
  private async updateSystemMetrics(): Promise<void> {
    try {
      // Update process metrics
      this.processUptime.set(process.uptime());
      
      const memUsage = process.memoryUsage();
      this.processMemoryUsage.labels('rss').set(memUsage.rss);
      this.processMemoryUsage.labels('heapUsed').set(memUsage.heapUsed);
      this.processMemoryUsage.labels('heapTotal').set(memUsage.heapTotal);
      this.processMemoryUsage.labels('external').set(memUsage.external);

      // Update system metrics (if available)
      await this.updateSystemResourceMetrics();
      
    } catch (error) {
      this.logger.error('Failed to update system metrics', error);
    }
  }

  /**
   * Update system resource metrics (CPU, memory, disk)
   */
  private async updateSystemResourceMetrics(): Promise<void> {
    try {
      // Note: In a real implementation, you would use system monitoring libraries
      // like 'systeminformation' or 'node-os-utils' to get actual system metrics
      
      // For now, we'll use process-level metrics and estimates
      const cpuUsage = process.cpuUsage();
      const cpuPercent = (cpuUsage.user + cpuUsage.system) / 1000000; // Convert to seconds
      this.systemCpuUsage.set(cpuPercent);

      // System memory (would need actual system monitoring)
      // This is a placeholder - in production, use proper system monitoring
      const totalMemory = require('os').totalmem();
      const freeMemory = require('os').freemem();
      const usedMemory = totalMemory - freeMemory;
      
      this.systemMemoryTotal.set(totalMemory);
      this.systemMemoryUsage.set(usedMemory);

    } catch (error) {
      this.logger.debug('Could not update system resource metrics', error);
    }
  }

  /**
   * Get database connection count
   */
  private async getDatabaseConnections(): Promise<number> {
    try {
      // This would depend on your database setup
      // For PostgreSQL, you might query pg_stat_activity
      const result = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) as count FROM pg_stat_activity WHERE state = 'active'
      `;
      return Number(result[0]?.count || 0);
    } catch (error) {
      this.logger.debug('Could not get database connection count', error);
      return 0;
    }
  }

  /**
   * Parse Redis memory usage from INFO command
   */
  private parseRedisMemoryInfo(info: string): number {
    const lines = info.split('\r\n');
    const usedMemoryLine = lines.find(line => line.startsWith('used_memory:'));
    
    if (usedMemoryLine) {
      const memoryBytes = parseInt(usedMemoryLine.split(':')[1], 10);
      return memoryBytes || 0;
    }
    
    return 0;
  }

  /**
   * Get job count for a specific queue state
   */
  private async getQueueJobCount(state: 'active' | 'failed' | 'waiting'): Promise<number> {
    try {
      // This would depend on your BullMQ setup
      // You might need to query Redis directly or use BullMQ's queue methods
      const queueNames = ['incidents', 'health-checks', 'data-retention'];
      let totalCount = 0;

      for (const queueName of queueNames) {
        try {
          const key = `bull:${queueName}:${state}`;
          const count = await this.redis.llen(key);
          totalCount += count;
        } catch (error) {
          // Queue might not exist, continue
        }
      }

      return totalCount;
    } catch (error) {
      this.logger.debug(`Could not get ${state} job count`, error);
      return 0;
    }
  }

  /**
   * Get system resource usage summary
   */
  async getSystemResourceSummary(): Promise<{
    cpu: { usage: number; cores: number };
    memory: { used: number; total: number; percentage: number };
    disk: { used: number; total: number; percentage: number };
    network: { connections: number };
  }> {
    const os = require('os');
    
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemory = totalMemory - freeMemory;
    const memoryPercentage = (usedMemory / totalMemory) * 100;

    return {
      cpu: {
        usage: 0, // Would need proper CPU monitoring
        cores: os.cpus().length,
      },
      memory: {
        used: usedMemory,
        total: totalMemory,
        percentage: Math.round(memoryPercentage * 100) / 100,
      },
      disk: {
        used: 0, // Would need disk monitoring
        total: 0, // Would need disk monitoring
        percentage: 0,
      },
      network: {
        connections: 0, // Would need network monitoring
      },
    };
  }

  /**
   * Get detailed system information
   */
  async getSystemInfo(): Promise<{
    platform: string;
    arch: string;
    nodeVersion: string;
    uptime: number;
    loadAverage: number[];
    hostname: string;
  }> {
    const os = require('os');
    
    return {
      platform: os.platform(),
      arch: os.arch(),
      nodeVersion: process.version,
      uptime: os.uptime(),
      loadAverage: os.loadavg(),
      hostname: os.hostname(),
    };
  }
}