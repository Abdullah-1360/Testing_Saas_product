import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/database/prisma.service';
import { PerformanceMonitoringService } from './performance-monitoring.service';
import { SystemMetricsService } from './system-metrics.service';
import { ErrorTrackingService } from './error-tracking.service';
import { Counter, Histogram, Gauge, register } from 'prom-client';

export interface MonitoringDashboard {
  system: {
    status: 'healthy' | 'warning' | 'critical';
    uptime: number;
    version: string;
    environment: string;
    lastUpdated: string;
  };
  performance: {
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
  };
  infrastructure: {
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
  };
  incidents: {
    active: number;
    resolved24h: number;
    successRate: number;
    averageResolutionTime: number;
  };
  alerts: Array<{
    id: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    message: string;
    timestamp: string;
    component: string;
  }>;
}

@Injectable()
export class MonitoringService {
  private readonly logger = new Logger(MonitoringService.name);

  // Prometheus metrics for monitoring service itself
  private readonly dashboardRequestsCounter = new Counter({
    name: 'wp_autohealer_dashboard_requests_total',
    help: 'Total number of dashboard requests',
    labelNames: ['endpoint', 'status'],
  });

  private readonly dashboardResponseTime = new Histogram({
    name: 'wp_autohealer_dashboard_response_time_seconds',
    help: 'Dashboard response time in seconds',
    labelNames: ['endpoint'],
    buckets: [0.1, 0.5, 1, 2, 5],
  });

  private readonly systemHealthGauge = new Gauge({
    name: 'wp_autohealer_system_health_score',
    help: 'Overall system health score (0-1)',
  });

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly performanceService: PerformanceMonitoringService,
    private readonly systemMetricsService: SystemMetricsService,
    private readonly errorTrackingService: ErrorTrackingService,
  ) {
    // Register metrics
    register.registerMetric(this.dashboardRequestsCounter);
    register.registerMetric(this.dashboardResponseTime);
    register.registerMetric(this.systemHealthGauge);
  }

  /**
   * Get comprehensive monitoring dashboard data
   */
  async getMonitoringDashboard(): Promise<MonitoringDashboard> {
    const startTime = Date.now();
    
    try {
      this.logger.debug('Generating monitoring dashboard');

      const [
        systemMetrics,
        performanceMetrics,
        infrastructureMetrics,
        incidentMetrics,
        activeAlerts,
      ] = await Promise.all([
        this.getSystemStatus(),
        this.performanceService.getPerformanceMetrics(),
        this.systemMetricsService.getInfrastructureMetrics(),
        this.getIncidentMetrics(),
        this.getActiveAlerts(),
      ]);

      const dashboard: MonitoringDashboard = {
        system: systemMetrics,
        performance: performanceMetrics,
        infrastructure: infrastructureMetrics,
        incidents: incidentMetrics,
        alerts: activeAlerts,
      };

      // Calculate overall system health score
      const healthScore = this.calculateSystemHealthScore(dashboard);
      this.systemHealthGauge.set(healthScore);

      // Record metrics
      const responseTime = (Date.now() - startTime) / 1000;
      this.dashboardResponseTime.labels('dashboard').observe(responseTime);
      this.dashboardRequestsCounter.labels('dashboard', 'success').inc();

      this.logger.debug(`Dashboard generated in ${responseTime}s`);
      return dashboard;

    } catch (error) {
      this.dashboardRequestsCounter.labels('dashboard', 'error').inc();
      this.logger.error('Failed to generate monitoring dashboard', error);
      throw error;
    }
  }

  /**
   * Get system status information
   */
  private async getSystemStatus() {
    const uptime = process.uptime();
    const version = this.configService.get<string>('npm_package_version', '1.0.0');
    const environment = this.configService.get<string>('NODE_ENV', 'development');

    // Determine system status based on various factors
    const [dbHealth, redisHealth, errorRate] = await Promise.all([
      this.systemMetricsService.checkDatabaseHealth(),
      this.systemMetricsService.checkRedisHealth(),
      this.errorTrackingService.getRecentErrorRate(),
    ]);

    let status: 'healthy' | 'warning' | 'critical' = 'healthy';
    
    if (!dbHealth.healthy || !redisHealth.healthy || errorRate > 0.1) {
      status = 'critical';
    } else if (errorRate > 0.05 || dbHealth.responseTime > 100 || redisHealth.responseTime > 50) {
      status = 'warning';
    }

    return {
      status,
      uptime,
      version,
      environment,
      lastUpdated: new Date().toISOString(),
    };
  }

  /**
   * Get incident-related metrics
   */
  private async getIncidentMetrics() {
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const [
      activeIncidents,
      resolved24h,
      totalIncidents24h,
      avgResolutionTime,
    ] = await Promise.all([
      this.prisma.incident.count({
        where: {
          state: {
            in: ['NEW', 'DISCOVERY', 'BASELINE', 'BACKUP', 'OBSERVABILITY', 'FIX_ATTEMPT', 'VERIFY'],
          },
        },
      }),
      this.prisma.incident.count({
        where: {
          state: 'FIXED',
          resolvedAt: { gte: twentyFourHoursAgo },
        },
      }),
      this.prisma.incident.count({
        where: {
          createdAt: { gte: twentyFourHoursAgo },
        },
      }),
      this.getAverageResolutionTime(),
    ]);

    const successRate = totalIncidents24h > 0 ? (resolved24h / totalIncidents24h) * 100 : 100;

    return {
      active: activeIncidents,
      resolved24h,
      successRate: Math.round(successRate * 100) / 100,
      averageResolutionTime: avgResolutionTime,
    };
  }

  /**
   * Get average incident resolution time in minutes
   */
  private async getAverageResolutionTime(): Promise<number> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const resolvedIncidents = await this.prisma.incident.findMany({
      where: {
        state: 'FIXED',
        resolvedAt: { 
          gte: sevenDaysAgo,
          not: null 
        },
        createdAt: { not: null },
      },
      select: {
        createdAt: true,
        resolvedAt: true,
      },
    });

    if (resolvedIncidents.length === 0) {
      return 0;
    }

    const totalResolutionTime = resolvedIncidents.reduce((sum, incident) => {
      const resolutionTime = incident.resolvedAt!.getTime() - incident.createdAt.getTime();
      return sum + resolutionTime;
    }, 0);

    // Return average resolution time in minutes
    return Math.round(totalResolutionTime / resolvedIncidents.length / 1000 / 60);
  }

  /**
   * Get active alerts from various sources
   */
  private async getActiveAlerts() {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    // Get recent error events
    const recentErrors = await this.prisma.auditEvent.findMany({
      where: {
        action: { startsWith: 'ERROR_' },
        timestamp: { gte: oneHourAgo },
      },
      orderBy: { timestamp: 'desc' },
      take: 10,
    });

    // Get recent security events
    const recentSecurityEvents = await this.prisma.auditEvent.findMany({
      where: {
        action: { startsWith: 'SECURITY_EVENT_' },
        timestamp: { gte: oneHourAgo },
      },
      orderBy: { timestamp: 'desc' },
      take: 5,
    });

    const alerts = [];

    // Convert errors to alerts
    recentErrors.forEach((error, index) => {
      alerts.push({
        id: `error_${error.id}`,
        severity: 'high' as const,
        message: `Application error: ${error.action.replace('ERROR_', '')}`,
        timestamp: error.timestamp.toISOString(),
        component: 'application',
      });
    });

    // Convert security events to alerts
    recentSecurityEvents.forEach((event) => {
      const severity = this.getSecurityEventSeverity(event.metadata);
      alerts.push({
        id: `security_${event.id}`,
        severity,
        message: `Security event: ${event.action.replace('SECURITY_EVENT_', '')}`,
        timestamp: event.timestamp.toISOString(),
        component: 'security',
      });
    });

    // Add system alerts based on metrics
    const systemAlerts = await this.generateSystemAlerts();
    alerts.push(...systemAlerts);

    // Sort by severity and timestamp
    return alerts
      .sort((a, b) => {
        const severityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
        const severityDiff = severityOrder[b.severity] - severityOrder[a.severity];
        if (severityDiff !== 0) return severityDiff;
        return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
      })
      .slice(0, 20); // Limit to 20 most important alerts
  }

  /**
   * Generate system alerts based on current metrics
   */
  private async generateSystemAlerts() {
    const alerts = [];
    const now = new Date().toISOString();

    // Check database health
    const dbHealth = await this.systemMetricsService.checkDatabaseHealth();
    if (!dbHealth.healthy) {
      alerts.push({
        id: 'db_health',
        severity: 'critical' as const,
        message: 'Database connectivity issues detected',
        timestamp: now,
        component: 'database',
      });
    } else if (dbHealth.responseTime > 100) {
      alerts.push({
        id: 'db_slow',
        severity: 'warning' as const,
        message: `Database response time high: ${dbHealth.responseTime}ms`,
        timestamp: now,
        component: 'database',
      });
    }

    // Check Redis health
    const redisHealth = await this.systemMetricsService.checkRedisHealth();
    if (!redisHealth.healthy) {
      alerts.push({
        id: 'redis_health',
        severity: 'critical' as const,
        message: 'Redis connectivity issues detected',
        timestamp: now,
        component: 'redis',
      });
    }

    // Check error rate
    const errorRate = await this.errorTrackingService.getRecentErrorRate();
    if (errorRate > 0.1) {
      alerts.push({
        id: 'high_error_rate',
        severity: 'critical' as const,
        message: `High error rate detected: ${(errorRate * 100).toFixed(1)}%`,
        timestamp: now,
        component: 'application',
      });
    } else if (errorRate > 0.05) {
      alerts.push({
        id: 'elevated_error_rate',
        severity: 'warning' as const,
        message: `Elevated error rate: ${(errorRate * 100).toFixed(1)}%`,
        timestamp: now,
        component: 'application',
      });
    }

    return alerts;
  }

  /**
   * Get security event severity from event details
   */
  private getSecurityEventSeverity(details: any): 'low' | 'medium' | 'high' | 'critical' {
    if (!details || !details.severity) {
      return 'medium';
    }

    switch (details.severity.toLowerCase()) {
      case 'critical':
        return 'critical';
      case 'high':
        return 'high';
      case 'medium':
        return 'medium';
      case 'low':
        return 'low';
      default:
        return 'medium';
    }
  }

  /**
   * Calculate overall system health score (0-1)
   */
  private calculateSystemHealthScore(dashboard: MonitoringDashboard): number {
    let score = 1.0;

    // System status impact
    if (dashboard.system.status === 'critical') {
      score -= 0.4;
    } else if (dashboard.system.status === 'warning') {
      score -= 0.2;
    }

    // Error rate impact
    if (dashboard.performance.errorRate > 0.1) {
      score -= 0.3;
    } else if (dashboard.performance.errorRate > 0.05) {
      score -= 0.15;
    }

    // Infrastructure impact
    const infraComponents = [
      dashboard.infrastructure.database.status,
      dashboard.infrastructure.redis.status,
      dashboard.infrastructure.queues.status,
    ];

    infraComponents.forEach(status => {
      if (status === 'critical') {
        score -= 0.2;
      } else if (status === 'warning') {
        score -= 0.1;
      }
    });

    // Incident success rate impact
    if (dashboard.incidents.successRate < 80) {
      score -= 0.2;
    } else if (dashboard.incidents.successRate < 90) {
      score -= 0.1;
    }

    // Critical alerts impact
    const criticalAlerts = dashboard.alerts.filter(a => a.severity === 'critical').length;
    score -= criticalAlerts * 0.05;

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Get health check status for load balancer
   */
  async getHealthCheck(): Promise<{
    status: 'healthy' | 'unhealthy';
    checks: Record<string, boolean>;
    timestamp: string;
  }> {
    const [dbHealth, redisHealth] = await Promise.all([
      this.systemMetricsService.checkDatabaseHealth(),
      this.systemMetricsService.checkRedisHealth(),
    ]);

    const checks = {
      database: dbHealth.healthy,
      redis: redisHealth.healthy,
      application: true, // If we can execute this, app is running
    };

    const allHealthy = Object.values(checks).every(check => check);

    return {
      status: allHealthy ? 'healthy' : 'unhealthy',
      checks,
      timestamp: new Date().toISOString(),
    };
  }
}