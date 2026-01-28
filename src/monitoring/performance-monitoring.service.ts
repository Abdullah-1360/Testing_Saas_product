import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { Counter, Histogram, Gauge, register } from 'prom-client';

export interface PerformanceMetrics {
  responseTime: {
    p50: number;
    p95: number;
    p99: number;
  };
  throughput: {
    requestsPerSecond: number;
    requestsPerMinute: number;
  };
  errorRate: number;
}

@Injectable()
export class PerformanceMonitoringService {
  private readonly logger = new Logger(PerformanceMonitoringService.name);

  // Prometheus metrics for application performance
  private readonly httpRequestsTotal = new Counter({
    name: 'wp_autohealer_http_requests_total',
    help: 'Total number of HTTP requests',
    labelNames: ['method', 'route', 'status_code'],
  });

  private readonly httpRequestDuration = new Histogram({
    name: 'wp_autohealer_http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10],
  });

  private readonly databaseQueryDuration = new Histogram({
    name: 'wp_autohealer_database_query_duration_seconds',
    help: 'Database query duration in seconds',
    labelNames: ['operation', 'table'],
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
  });

  private readonly databaseConnectionsActive = new Gauge({
    name: 'wp_autohealer_database_connections_active',
    help: 'Number of active database connections',
  });

  private readonly databaseConnectionsFailed = new Counter({
    name: 'wp_autohealer_database_connections_failed_total',
    help: 'Total number of failed database connections',
  });

  private readonly queueJobDuration = new Histogram({
    name: 'wp_autohealer_queue_job_duration_seconds',
    help: 'Queue job processing duration in seconds',
    labelNames: ['queue', 'job_type', 'status'],
    buckets: [1, 5, 10, 30, 60, 300, 600, 1800],
  });

  private readonly queueJobsActive = new Gauge({
    name: 'wp_autohealer_queue_jobs_active',
    help: 'Number of active queue jobs',
    labelNames: ['queue'],
  });

  private readonly queueJobsWaiting = new Gauge({
    name: 'wp_autohealer_queue_jobs_waiting',
    help: 'Number of waiting queue jobs',
    labelNames: ['queue'],
  });

  private readonly queueJobsFailed = new Counter({
    name: 'wp_autohealer_queue_jobs_failed_total',
    help: 'Total number of failed queue jobs',
    labelNames: ['queue', 'job_type'],
  });

  private readonly incidentsProcessed = new Counter({
    name: 'wp_autohealer_incidents_processed_total',
    help: 'Total number of incidents processed',
    labelNames: ['status'],
  });

  private readonly incidentsFailed = new Counter({
    name: 'wp_autohealer_incidents_failed_total',
    help: 'Total number of failed incidents',
    labelNames: ['failure_reason'],
  });

  private readonly incidentProcessingDuration = new Histogram({
    name: 'wp_autohealer_incident_processing_duration_seconds',
    help: 'Incident processing duration in seconds',
    labelNames: ['status'],
    buckets: [10, 30, 60, 300, 600, 1800, 3600],
  });

  private readonly sshConnectionDuration = new Histogram({
    name: 'wp_autohealer_ssh_connection_duration_seconds',
    help: 'SSH connection establishment duration in seconds',
    labelNames: ['server_id', 'status'],
    buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
  });

  private readonly sshCommandDuration = new Histogram({
    name: 'wp_autohealer_ssh_command_duration_seconds',
    help: 'SSH command execution duration in seconds',
    labelNames: ['command_type', 'status'],
    buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60],
  });

  // In-memory tracking for performance calculations
  private readonly recentRequests: Array<{
    timestamp: number;
    duration: number;
    status: number;
  }> = [];

  constructor(private readonly prisma: PrismaService) {
    // Register all metrics
    register.registerMetric(this.httpRequestsTotal);
    register.registerMetric(this.httpRequestDuration);
    register.registerMetric(this.databaseQueryDuration);
    register.registerMetric(this.databaseConnectionsActive);
    register.registerMetric(this.databaseConnectionsFailed);
    register.registerMetric(this.queueJobDuration);
    register.registerMetric(this.queueJobsActive);
    register.registerMetric(this.queueJobsWaiting);
    register.registerMetric(this.queueJobsFailed);
    register.registerMetric(this.incidentsProcessed);
    register.registerMetric(this.incidentsFailed);
    register.registerMetric(this.incidentProcessingDuration);
    register.registerMetric(this.sshConnectionDuration);
    register.registerMetric(this.sshCommandDuration);

    // Clean up old request data every 5 minutes
    setInterval(() => this.cleanupOldRequests(), 5 * 60 * 1000);
  }

  /**
   * Record HTTP request metrics
   */
  recordHttpRequest(
    method: string,
    route: string,
    statusCode: number,
    duration: number,
  ): void {
    // Update Prometheus metrics
    this.httpRequestsTotal.labels(method, route, statusCode.toString()).inc();
    this.httpRequestDuration.labels(method, route, statusCode.toString()).observe(duration / 1000);

    // Store for in-memory calculations
    this.recentRequests.push({
      timestamp: Date.now(),
      duration,
      status: statusCode,
    });

    // Keep only last 1000 requests to prevent memory issues
    if (this.recentRequests.length > 1000) {
      this.recentRequests.shift();
    }
  }

  /**
   * Record database query metrics
   */
  recordDatabaseQuery(operation: string, table: string, duration: number): void {
    this.databaseQueryDuration.labels(operation, table).observe(duration / 1000);
  }

  /**
   * Record database connection metrics
   */
  recordDatabaseConnection(active: number, failed: boolean = false): void {
    this.databaseConnectionsActive.set(active);
    if (failed) {
      this.databaseConnectionsFailed.inc();
    }
  }

  /**
   * Record queue job metrics
   */
  recordQueueJob(
    queue: string,
    jobType: string,
    status: 'completed' | 'failed',
    duration: number,
  ): void {
    this.queueJobDuration.labels(queue, jobType, status).observe(duration / 1000);
    
    if (status === 'failed') {
      this.queueJobsFailed.labels(queue, jobType).inc();
    }
  }

  /**
   * Update queue job counts
   */
  updateQueueJobCounts(queue: string, active: number, waiting: number): void {
    this.queueJobsActive.labels(queue).set(active);
    this.queueJobsWaiting.labels(queue).set(waiting);
  }

  /**
   * Record incident processing metrics
   */
  recordIncidentProcessing(
    status: 'fixed' | 'escalated' | 'failed',
    duration: number,
    failureReason?: string,
  ): void {
    this.incidentsProcessed.labels(status).inc();
    this.incidentProcessingDuration.labels(status).observe(duration / 1000);

    if (status === 'failed' && failureReason) {
      this.incidentsFailed.labels(failureReason).inc();
    }
  }

  /**
   * Record SSH operation metrics
   */
  recordSshConnection(serverId: string, status: 'success' | 'failed', duration: number): void {
    this.sshConnectionDuration.labels(serverId, status).observe(duration / 1000);
  }

  /**
   * Record SSH command metrics
   */
  recordSshCommand(commandType: string, status: 'success' | 'failed', duration: number): void {
    this.sshCommandDuration.labels(commandType, status).observe(duration / 1000);
  }

  /**
   * Get current performance metrics
   */
  async getPerformanceMetrics(): Promise<PerformanceMetrics> {
    const now = Date.now();
    const oneMinuteAgo = now - 60 * 1000;
    const fiveMinutesAgo = now - 5 * 60 * 1000;

    // Filter recent requests
    const recentRequests = this.recentRequests.filter(req => req.timestamp > fiveMinutesAgo);
    const lastMinuteRequests = this.recentRequests.filter(req => req.timestamp > oneMinuteAgo);

    // Calculate response time percentiles
    const sortedDurations = recentRequests
      .map(req => req.duration)
      .sort((a, b) => a - b);

    const responseTime = {
      p50: this.calculatePercentile(sortedDurations, 0.5),
      p95: this.calculatePercentile(sortedDurations, 0.95),
      p99: this.calculatePercentile(sortedDurations, 0.99),
    };

    // Calculate throughput
    const requestsPerSecond = lastMinuteRequests.length / 60;
    const requestsPerMinute = lastMinuteRequests.length;

    // Calculate error rate
    const errorRequests = recentRequests.filter(req => req.status >= 400);
    const errorRate = recentRequests.length > 0 ? errorRequests.length / recentRequests.length : 0;

    return {
      responseTime,
      throughput: {
        requestsPerSecond: Math.round(requestsPerSecond * 100) / 100,
        requestsPerMinute,
      },
      errorRate: Math.round(errorRate * 10000) / 10000, // 4 decimal places
    };
  }

  /**
   * Get detailed performance statistics
   */
  async getDetailedPerformanceStats(): Promise<{
    httpRequests: {
      total: number;
      byStatus: Record<string, number>;
      byRoute: Record<string, number>;
    };
    database: {
      averageQueryTime: number;
      slowQueries: number;
      connectionPoolUsage: number;
    };
    queues: {
      totalJobs: number;
      failureRate: number;
      averageProcessingTime: number;
    };
    incidents: {
      totalProcessed: number;
      successRate: number;
      averageResolutionTime: number;
    };
  }> {
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    const recentRequests = this.recentRequests.filter(req => req.timestamp > fiveMinutesAgo);

    // HTTP request statistics
    const httpRequests = {
      total: recentRequests.length,
      byStatus: this.groupBy(recentRequests, req => Math.floor(req.status / 100) * 100),
      byRoute: {}, // Would need to be populated from actual route data
    };

    // Database statistics (would need actual implementation)
    const database = {
      averageQueryTime: 0, // Calculate from actual query metrics
      slowQueries: 0, // Count queries > threshold
      connectionPoolUsage: 0, // Current pool usage percentage
    };

    // Queue statistics (would need actual implementation)
    const queues = {
      totalJobs: 0, // Get from queue metrics
      failureRate: 0, // Calculate from job metrics
      averageProcessingTime: 0, // Calculate from job duration metrics
    };

    // Incident statistics
    const incidents = await this.getIncidentStatistics();

    return {
      httpRequests,
      database,
      queues,
      incidents,
    };
  }

  /**
   * Get incident processing statistics
   */
  private async getIncidentStatistics(): Promise<{
    totalProcessed: number;
    successRate: number;
    averageResolutionTime: number;
  }> {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [totalProcessed, successfulIncidents] = await Promise.all([
      this.prisma.incident.count({
        where: {
          updatedAt: { gte: twentyFourHoursAgo },
          state: { in: ['FIXED', 'ESCALATED'] },
        },
      }),
      this.prisma.incident.findMany({
        where: {
          state: 'FIXED',
          resolvedAt: { 
            gte: twentyFourHoursAgo,
            not: null 
          },
          createdAt: { not: null },
        },
        select: {
          createdAt: true,
          resolvedAt: true,
        },
      }),
    ]);

    const successRate = totalProcessed > 0 ? (successfulIncidents.length / totalProcessed) * 100 : 100;

    const averageResolutionTime = successfulIncidents.length > 0
      ? successfulIncidents.reduce((sum, incident) => {
          const resolutionTime = incident.resolvedAt!.getTime() - incident.createdAt.getTime();
          return sum + resolutionTime;
        }, 0) / successfulIncidents.length / 1000 / 60 // Convert to minutes
      : 0;

    return {
      totalProcessed,
      successRate: Math.round(successRate * 100) / 100,
      averageResolutionTime: Math.round(averageResolutionTime * 100) / 100,
    };
  }

  /**
   * Calculate percentile from sorted array
   */
  private calculatePercentile(sortedArray: number[], percentile: number): number {
    if (sortedArray.length === 0) return 0;
    
    const index = Math.ceil(sortedArray.length * percentile) - 1;
    return sortedArray[Math.max(0, index)] || 0;
  }

  /**
   * Group array elements by a key function
   */
  private groupBy<T>(array: T[], keyFn: (item: T) => string | number): Record<string, number> {
    return array.reduce((groups, item) => {
      const key = keyFn(item).toString();
      groups[key] = (groups[key] || 0) + 1;
      return groups;
    }, {} as Record<string, number>);
  }

  /**
   * Clean up old request data to prevent memory leaks
   */
  private cleanupOldRequests(): void {
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    const initialLength = this.recentRequests.length;
    
    // Remove requests older than 5 minutes
    while (this.recentRequests.length > 0 && this.recentRequests[0].timestamp < fiveMinutesAgo) {
      this.recentRequests.shift();
    }

    const removedCount = initialLength - this.recentRequests.length;
    if (removedCount > 0) {
      this.logger.debug(`Cleaned up ${removedCount} old request records`);
    }
  }
}