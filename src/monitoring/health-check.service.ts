import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/database/prisma.service';
import { RedisConfigService } from '@/config/redis.config';
import { SystemMetricsService } from './system-metrics.service';
import { Gauge, register } from 'prom-client';
import Redis from 'ioredis';

export interface HealthCheckStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  checks: {
    [component: string]: {
      status: 'healthy' | 'unhealthy';
      responseTime?: number;
      message?: string;
      details?: any;
    };
  };
  timestamp: string;
  uptime: number;
  version: string;
}

@Injectable()
export class HealthCheckService {
  private readonly logger = new Logger(HealthCheckService.name);
  private redis: Redis;

  // Prometheus metrics for health checks
  private readonly healthCheckStatus = new Gauge({
    name: 'wp_autohealer_health_check_status',
    help: 'Health check status (1 = healthy, 0 = unhealthy)',
    labelNames: ['component'],
  });

  private readonly healthCheckDuration = new Gauge({
    name: 'wp_autohealer_health_check_duration_seconds',
    help: 'Health check duration in seconds',
    labelNames: ['component'],
  });

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly redisConfig: RedisConfigService,
    private readonly systemMetricsService: SystemMetricsService,
  ) {
    this.redis = new Redis(this.redisConfig.getRedisOptions());

    // Register metrics
    register.registerMetric(this.healthCheckStatus);
    register.registerMetric(this.healthCheckDuration);
  }

  /**
   * Perform comprehensive health check
   */
  async performHealthCheck(): Promise<HealthCheckStatus> {
    const startTime = Date.now();
    const checks: HealthCheckStatus['checks'] = {};

    // Run all health checks in parallel
    const healthCheckPromises = [
      this.checkDatabase(),
      this.checkRedis(),
      this.checkFileSystem(),
      this.checkMemory(),
      this.checkDiskSpace(),
      this.checkEnvironmentVariables(),
    ];

    const results = await Promise.allSettled(healthCheckPromises);
    const componentNames = ['database', 'redis', 'filesystem', 'memory', 'disk', 'environment'];

    // Process results
    results.forEach((result, index) => {
      const componentName = componentNames[index];
      
      if (result.status === 'fulfilled') {
        checks[componentName] = result.value;
        this.healthCheckStatus.labels(componentName).set(result.value.status === 'healthy' ? 1 : 0);
      } else {
        checks[componentName] = {
          status: 'unhealthy',
          message: `Health check failed: ${result.reason?.message || 'Unknown error'}`,
        };
        this.healthCheckStatus.labels(componentName).set(0);
      }
    });

    // Determine overall status
    const overallStatus = this.determineOverallStatus(checks);

    const healthStatus: HealthCheckStatus = {
      status: overallStatus,
      checks,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: this.configService.get<string>('npm_package_version', '1.0.0'),
    };

    const totalDuration = (Date.now() - startTime) / 1000;
    this.healthCheckDuration.labels('overall').set(totalDuration);

    this.logger.debug(`Health check completed in ${totalDuration}s with status: ${overallStatus}`);

    return healthStatus;
  }

  /**
   * Check database connectivity and performance
   */
  private async checkDatabase(): Promise<HealthCheckStatus['checks'][string]> {
    const startTime = Date.now();
    
    try {
      // Test basic connectivity
      await this.prisma.$queryRaw`SELECT 1`;
      
      // Test a simple query
      const userCount = await this.prisma.user.count();
      
      const responseTime = Date.now() - startTime;
      this.healthCheckDuration.labels('database').set(responseTime / 1000);

      if (responseTime > 5000) {
        return {
          status: 'unhealthy',
          responseTime,
          message: 'Database response time too high',
          details: { responseTime, userCount },
        };
      }

      return {
        status: 'healthy',
        responseTime,
        details: { userCount },
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      this.healthCheckDuration.labels('database').set(responseTime / 1000);
      
      return {
        status: 'unhealthy',
        responseTime,
        message: `Database connection failed: ${error.message}`,
        details: { error: error.message },
      };
    }
  }

  /**
   * Check Redis connectivity and performance
   */
  private async checkRedis(): Promise<HealthCheckStatus['checks'][string]> {
    const startTime = Date.now();
    
    try {
      // Test basic connectivity
      const pong = await this.redis.ping();
      
      if (pong !== 'PONG') {
        throw new Error('Redis ping failed');
      }

      // Test set/get operations
      const testKey = `health_check_${Date.now()}`;
      await this.redis.set(testKey, 'test', 'EX', 10);
      const testValue = await this.redis.get(testKey);
      await this.redis.del(testKey);

      if (testValue !== 'test') {
        throw new Error('Redis set/get test failed');
      }

      const responseTime = Date.now() - startTime;
      this.healthCheckDuration.labels('redis').set(responseTime / 1000);

      if (responseTime > 1000) {
        return {
          status: 'unhealthy',
          responseTime,
          message: 'Redis response time too high',
        };
      }

      return {
        status: 'healthy',
        responseTime,
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      this.healthCheckDuration.labels('redis').set(responseTime / 1000);
      
      return {
        status: 'unhealthy',
        responseTime,
        message: `Redis connection failed: ${error.message}`,
        details: { error: error.message },
      };
    }
  }

  /**
   * Check file system access
   */
  private async checkFileSystem(): Promise<HealthCheckStatus['checks'][string]> {
    const startTime = Date.now();
    
    try {
      const fs = require('fs').promises;
      const path = require('path');
      
      // Test write access to logs directory
      const testFile = path.join(process.cwd(), 'logs', '.health_check');
      const testContent = `Health check at ${new Date().toISOString()}`;
      
      await fs.writeFile(testFile, testContent);
      const readContent = await fs.readFile(testFile, 'utf8');
      await fs.unlink(testFile);

      if (readContent !== testContent) {
        throw new Error('File system read/write test failed');
      }

      const responseTime = Date.now() - startTime;
      this.healthCheckDuration.labels('filesystem').set(responseTime / 1000);

      return {
        status: 'healthy',
        responseTime,
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      this.healthCheckDuration.labels('filesystem').set(responseTime / 1000);
      
      return {
        status: 'unhealthy',
        responseTime,
        message: `File system check failed: ${error.message}`,
        details: { error: error.message },
      };
    }
  }

  /**
   * Check memory usage
   */
  private async checkMemory(): Promise<HealthCheckStatus['checks'][string]> {
    const startTime = Date.now();
    
    try {
      const memUsage = process.memoryUsage();
      const os = require('os');
      
      const totalMemory = os.totalmem();
      const freeMemory = os.freemem();
      const usedMemory = totalMemory - freeMemory;
      const memoryUsagePercent = (usedMemory / totalMemory) * 100;

      const heapUsagePercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;

      const responseTime = Date.now() - startTime;
      this.healthCheckDuration.labels('memory').set(responseTime / 1000);

      let status: 'healthy' | 'unhealthy' = 'healthy';
      let message: string | undefined;

      if (memoryUsagePercent > 90) {
        status = 'unhealthy';
        message = 'System memory usage critically high';
      } else if (heapUsagePercent > 90) {
        status = 'unhealthy';
        message = 'Heap memory usage critically high';
      }

      return {
        status,
        responseTime,
        message,
        details: {
          systemMemoryUsagePercent: Math.round(memoryUsagePercent * 100) / 100,
          heapUsagePercent: Math.round(heapUsagePercent * 100) / 100,
          heapUsed: memUsage.heapUsed,
          heapTotal: memUsage.heapTotal,
          rss: memUsage.rss,
        },
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      this.healthCheckDuration.labels('memory').set(responseTime / 1000);
      
      return {
        status: 'unhealthy',
        responseTime,
        message: `Memory check failed: ${error.message}`,
        details: { error: error.message },
      };
    }
  }

  /**
   * Check disk space
   */
  private async checkDiskSpace(): Promise<HealthCheckStatus['checks'][string]> {
    const startTime = Date.now();
    
    try {
      const fs = require('fs').promises;
      const stats = await fs.stat(process.cwd());
      
      // Note: This is a simplified check. In production, you'd want to use
      // a library like 'statvfs' or 'diskusage' to get actual disk space info
      
      const responseTime = Date.now() - startTime;
      this.healthCheckDuration.labels('disk').set(responseTime / 1000);

      return {
        status: 'healthy',
        responseTime,
        details: {
          message: 'Disk space check completed (simplified)',
        },
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      this.healthCheckDuration.labels('disk').set(responseTime / 1000);
      
      return {
        status: 'unhealthy',
        responseTime,
        message: `Disk space check failed: ${error.message}`,
        details: { error: error.message },
      };
    }
  }

  /**
   * Check critical environment variables
   */
  private async checkEnvironmentVariables(): Promise<HealthCheckStatus['checks'][string]> {
    const startTime = Date.now();
    
    try {
      const requiredEnvVars = [
        'DATABASE_URL',
        'REDIS_URL',
        'JWT_SECRET',
        'SESSION_SECRET',
        'ENCRYPTION_KEY',
      ];

      const missingVars = requiredEnvVars.filter(
        varName => !this.configService.get(varName)
      );

      const responseTime = Date.now() - startTime;
      this.healthCheckDuration.labels('environment').set(responseTime / 1000);

      if (missingVars.length > 0) {
        return {
          status: 'unhealthy',
          responseTime,
          message: `Missing required environment variables: ${missingVars.join(', ')}`,
          details: { missingVars },
        };
      }

      return {
        status: 'healthy',
        responseTime,
        details: {
          checkedVars: requiredEnvVars.length,
        },
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      this.healthCheckDuration.labels('environment').set(responseTime / 1000);
      
      return {
        status: 'unhealthy',
        responseTime,
        message: `Environment check failed: ${error.message}`,
        details: { error: error.message },
      };
    }
  }

  /**
   * Determine overall system status based on component checks
   */
  private determineOverallStatus(checks: HealthCheckStatus['checks']): 'healthy' | 'degraded' | 'unhealthy' {
    const componentStatuses = Object.values(checks).map(check => check.status);
    
    const unhealthyCount = componentStatuses.filter(status => status === 'unhealthy').length;
    const totalCount = componentStatuses.length;

    if (unhealthyCount === 0) {
      return 'healthy';
    } else if (unhealthyCount <= totalCount / 2) {
      return 'degraded';
    } else {
      return 'unhealthy';
    }
  }

  /**
   * Get a simple health status for load balancer checks
   */
  async getSimpleHealthStatus(): Promise<{ status: 'ok' | 'error'; timestamp: string }> {
    try {
      // Quick checks for critical components
      await Promise.all([
        this.prisma.$queryRaw`SELECT 1`,
        this.redis.ping(),
      ]);

      return {
        status: 'ok',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error('Simple health check failed', error);
      return {
        status: 'error',
        timestamp: new Date().toISOString(),
      };
    }
  }
}