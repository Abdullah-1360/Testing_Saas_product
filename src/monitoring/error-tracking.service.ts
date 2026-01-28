import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { Counter, Histogram, Gauge, register } from 'prom-client';
import { EventEmitter2 } from '@nestjs/event-emitter';

export interface ErrorEvent {
  type: ErrorType;
  severity: ErrorSeverity;
  message: string;
  stack?: string;
  context?: Record<string, any>;
  userId?: string;
  requestId?: string;
  timestamp: Date;
}

export enum ErrorType {
  APPLICATION_ERROR = 'application_error',
  DATABASE_ERROR = 'database_error',
  REDIS_ERROR = 'redis_error',
  SSH_ERROR = 'ssh_error',
  VALIDATION_ERROR = 'validation_error',
  AUTHENTICATION_ERROR = 'authentication_error',
  AUTHORIZATION_ERROR = 'authorization_error',
  NETWORK_ERROR = 'network_error',
  FILE_SYSTEM_ERROR = 'file_system_error',
  QUEUE_ERROR = 'queue_error',
  EXTERNAL_API_ERROR = 'external_api_error',
  CONFIGURATION_ERROR = 'configuration_error',
  TIMEOUT_ERROR = 'timeout_error',
  RATE_LIMIT_ERROR = 'rate_limit_error',
}

export enum ErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

@Injectable()
export class ErrorTrackingService {
  private readonly logger = new Logger(ErrorTrackingService.name);

  // Prometheus metrics for error tracking
  private readonly errorsTotal = new Counter({
    name: 'wp_autohealer_errors_total',
    help: 'Total number of errors',
    labelNames: ['type', 'severity', 'component'],
  });

  private readonly errorRate = new Gauge({
    name: 'wp_autohealer_error_rate',
    help: 'Current error rate (errors per minute)',
    labelNames: ['type'],
  });

  private readonly criticalErrorsTotal = new Counter({
    name: 'wp_autohealer_critical_errors_total',
    help: 'Total number of critical errors',
    labelNames: ['type', 'component'],
  });

  private readonly errorResolutionTime = new Histogram({
    name: 'wp_autohealer_error_resolution_time_seconds',
    help: 'Time to resolve errors in seconds',
    labelNames: ['type', 'severity'],
    buckets: [60, 300, 900, 1800, 3600, 7200, 14400], // 1min to 4hours
  });

  private readonly unhandledExceptions = new Counter({
    name: 'wp_autohealer_unhandled_exceptions_total',
    help: 'Total number of unhandled exceptions',
  });

  private readonly memoryLeakIndicator = new Gauge({
    name: 'wp_autohealer_memory_leak_indicator',
    help: 'Memory leak indicator (1 = potential leak detected)',
  });

  // In-memory tracking for error patterns
  private readonly recentErrors: ErrorEvent[] = [];
  private readonly errorPatterns = new Map<string, number>();
  private lastMemoryUsage = 0;
  private memoryGrowthCount = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    // Register metrics
    register.registerMetric(this.errorsTotal);
    register.registerMetric(this.errorRate);
    register.registerMetric(this.criticalErrorsTotal);
    register.registerMetric(this.errorResolutionTime);
    register.registerMetric(this.unhandledExceptions);
    register.registerMetric(this.memoryLeakIndicator);

    // Set up global error handlers
    this.setupGlobalErrorHandlers();

    // Clean up old error data every 5 minutes
    setInterval(() => this.cleanupOldErrors(), 5 * 60 * 1000);

    // Check for memory leaks every minute
    setInterval(() => this.checkMemoryLeaks(), 60 * 1000);

    // Update error rates every 30 seconds
    setInterval(() => this.updateErrorRates(), 30 * 1000);
  }

  /**
   * Record an error event
   */
  async recordError(error: ErrorEvent): Promise<void> {
    try {
      // Update Prometheus metrics
      this.errorsTotal.labels(error.type, error.severity, this.getComponentFromContext(error.context)).inc();
      
      if (error.severity === ErrorSeverity.CRITICAL) {
        this.criticalErrorsTotal.labels(error.type, this.getComponentFromContext(error.context)).inc();
      }

      // Store in database
      await this.storeError(error);

      // Add to in-memory tracking
      this.recentErrors.push(error);

      // Update error patterns
      this.updateErrorPatterns(error);

      // Check for error spikes
      await this.checkErrorSpikes(error);

      // Emit event for real-time notifications
      this.eventEmitter.emit('error.recorded', {
        type: error.type,
        severity: error.severity,
        message: error.message,
        timestamp: error.timestamp,
      });

      // Log the error
      this.logError(error);

    } catch (recordingError) {
      this.logger.error('Failed to record error event', {
        originalError: error.message,
        recordingError: recordingError.message,
      });
    }
  }

  /**
   * Get recent error rate (errors per minute)
   */
  async getRecentErrorRate(): Promise<number> {
    const oneMinuteAgo = new Date(Date.now() - 60 * 1000);
    const recentErrors = this.recentErrors.filter(error => error.timestamp > oneMinuteAgo);
    return recentErrors.length;
  }

  /**
   * Get error statistics for monitoring dashboard
   */
  async getErrorStatistics(): Promise<{
    total24h: number;
    criticalErrors: number;
    errorRate: number;
    topErrors: Array<{ type: string; count: number; lastOccurrence: string }>;
    errorTrends: Array<{ hour: number; count: number }>;
  }> {
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const [total24h, criticalErrors, errorsByType, hourlyErrors] = await Promise.all([
      this.prisma.auditEvent.count({
        where: {
          action: { startsWith: 'ERROR_' },
          timestamp: { gte: twentyFourHoursAgo },
        },
      }),
      this.prisma.auditEvent.count({
        where: {
          action: { startsWith: 'ERROR_' },
          timestamp: { gte: twentyFourHoursAgo },
          metadata: { path: ['severity'], equals: 'critical' },
        },
      }),
      this.getErrorsByType(twentyFourHoursAgo),
      this.getHourlyErrorCounts(twentyFourHoursAgo),
    ]);

    const errorRate = this.getRecentErrorRate();

    return {
      total24h,
      criticalErrors,
      errorRate: await errorRate,
      topErrors: errorsByType,
      errorTrends: hourlyErrors,
    };
  }

  /**
   * Get detailed error information
   */
  async getErrorDetails(errorId: string): Promise<{
    id: string;
    type: string;
    severity: string;
    message: string;
    stack?: string;
    context: any;
    timestamp: string;
    resolved: boolean;
    resolutionTime?: number;
  } | null> {
    const error = await this.prisma.auditEvent.findUnique({
      where: { id: errorId },
    });

    if (!error || !error.action.startsWith('ERROR_')) {
      return null;
    }

    const details = error.metadata as any;

    return {
      id: error.id,
      type: error.action.replace('ERROR_', ''),
      severity: details?.severity || 'medium',
      message: details?.message || 'Unknown error',
      stack: details?.stack,
      context: details?.context || {},
      timestamp: error.timestamp.toISOString(),
      resolved: details?.resolved || false,
      resolutionTime: details?.resolutionTime,
    };
  }

  /**
   * Mark an error as resolved
   */
  async resolveError(errorId: string, resolutionNotes?: string): Promise<void> {
    const error = await this.prisma.auditEvent.findUnique({
      where: { id: errorId },
    });

    if (!error) {
      throw new Error('Error not found');
    }

    const resolutionTime = Date.now() - error.timestamp.getTime();
    const existingDetails = error.metadata as any;

    await this.prisma.auditEvent.update({
      where: { id: errorId },
      data: {
        metadata: {
          ...(existingDetails || {}),
          resolved: true,
          resolutionTime: resolutionTime / 1000, // Convert to seconds
          resolutionNotes,
          resolvedAt: new Date().toISOString(),
        },
      },
    });

    // Update Prometheus metrics
    const errorType = error.action.replace('ERROR_', '');
    const severity = existingDetails?.severity || 'medium';
    this.errorResolutionTime.labels(errorType, severity).observe(resolutionTime / 1000);

    this.logger.log(`Error ${errorId} marked as resolved`, {
      type: errorType,
      resolutionTime: resolutionTime / 1000,
    });
  }

  /**
   * Set up global error handlers
   */
  private setupGlobalErrorHandlers(): void {
    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      this.unhandledExceptions.inc();
      
      this.recordError({
        type: ErrorType.APPLICATION_ERROR,
        severity: ErrorSeverity.CRITICAL,
        message: `Unhandled Promise Rejection: ${reason}`,
        stack: reason instanceof Error ? reason.stack : undefined,
        context: { promise: promise.toString() },
        timestamp: new Date(),
      });
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      this.unhandledExceptions.inc();
      
      this.recordError({
        type: ErrorType.APPLICATION_ERROR,
        severity: ErrorSeverity.CRITICAL,
        message: `Uncaught Exception: ${error.message}`,
        stack: error.stack,
        context: { name: error.name },
        timestamp: new Date(),
      });

      // Don't exit the process in production, but log it
      this.logger.fatal('Uncaught Exception', error);
    });
  }

  /**
   * Store error in database
   */
  private async storeError(error: ErrorEvent): Promise<void> {
    await this.prisma.auditEvent.create({
      data: {
        action: `ERROR_${error.type.toUpperCase()}`,
        resource: 'error',
        resourceId: error.requestId || null,
        description: `${error.type} error: ${error.message}`,
        metadata: {
          message: error.message,
          severity: error.severity,
          stack: error.stack,
          context: error.context || {},
          resolved: false,
        },
        userId: error.userId || null,
        timestamp: error.timestamp,
        severity: 'HIGH',
      },
    });
  }

  /**
   * Update error patterns for anomaly detection
   */
  private updateErrorPatterns(error: ErrorEvent): void {
    const patternKey = `${error.type}_${error.severity}`;
    const currentCount = this.errorPatterns.get(patternKey) || 0;
    this.errorPatterns.set(patternKey, currentCount + 1);
  }

  /**
   * Check for error spikes and trigger alerts
   */
  private async checkErrorSpikes(error: ErrorEvent): Promise<void> {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const recentSimilarErrors = this.recentErrors.filter(
      e => e.type === error.type && e.timestamp > fiveMinutesAgo
    );

    // Alert if we have more than 10 similar errors in 5 minutes
    if (recentSimilarErrors.length >= 10) {
      this.eventEmitter.emit('error.spike.detected', {
        type: error.type,
        count: recentSimilarErrors.length,
        timeWindow: '5 minutes',
        severity: 'high',
      });

      this.logger.warn(`Error spike detected: ${error.type}`, {
        count: recentSimilarErrors.length,
        timeWindow: '5 minutes',
      });
    }
  }

  /**
   * Check for memory leaks
   */
  private checkMemoryLeaks(): void {
    const currentMemory = process.memoryUsage().heapUsed;
    
    if (currentMemory > this.lastMemoryUsage) {
      this.memoryGrowthCount++;
    } else {
      this.memoryGrowthCount = 0;
    }

    // If memory has been growing for 10 consecutive checks (10 minutes)
    if (this.memoryGrowthCount >= 10) {
      this.memoryLeakIndicator.set(1);
      
      this.recordError({
        type: ErrorType.APPLICATION_ERROR,
        severity: ErrorSeverity.HIGH,
        message: 'Potential memory leak detected',
        context: {
          currentMemory,
          previousMemory: this.lastMemoryUsage,
          growthCount: this.memoryGrowthCount,
        },
        timestamp: new Date(),
      });

      this.memoryGrowthCount = 0; // Reset to avoid spam
    } else {
      this.memoryLeakIndicator.set(0);
    }

    this.lastMemoryUsage = currentMemory;
  }

  /**
   * Update error rate metrics
   */
  private updateErrorRates(): void {
    const oneMinuteAgo = new Date(Date.now() - 60 * 1000);
    
    // Group recent errors by type
    const errorsByType = new Map<string, number>();
    
    this.recentErrors
      .filter(error => error.timestamp > oneMinuteAgo)
      .forEach(error => {
        const count = errorsByType.get(error.type) || 0;
        errorsByType.set(error.type, count + 1);
      });

    // Update Prometheus metrics
    errorsByType.forEach((count, type) => {
      this.errorRate.labels(type).set(count);
    });
  }

  /**
   * Clean up old error data
   */
  private cleanupOldErrors(): void {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const initialLength = this.recentErrors.length;
    
    // Remove errors older than 1 hour
    while (this.recentErrors.length > 0 && this.recentErrors[0].timestamp < oneHourAgo) {
      this.recentErrors.shift();
    }

    const removedCount = initialLength - this.recentErrors.length;
    if (removedCount > 0) {
      this.logger.debug(`Cleaned up ${removedCount} old error records`);
    }
  }

  /**
   * Get component name from error context
   */
  private getComponentFromContext(context?: Record<string, any>): string {
    if (!context) return 'unknown';
    
    return context.component || context.module || context.service || 'application';
  }

  /**
   * Log error with appropriate level
   */
  private logError(error: ErrorEvent): void {
    const logData = {
      type: error.type,
      severity: error.severity,
      message: error.message,
      context: error.context,
      userId: error.userId,
      requestId: error.requestId,
    };

    switch (error.severity) {
      case ErrorSeverity.CRITICAL:
        this.logger.error(`CRITICAL ERROR: ${error.message}`, logData);
        break;
      case ErrorSeverity.HIGH:
        this.logger.error(`HIGH SEVERITY ERROR: ${error.message}`, logData);
        break;
      case ErrorSeverity.MEDIUM:
        this.logger.warn(`MEDIUM SEVERITY ERROR: ${error.message}`, logData);
        break;
      case ErrorSeverity.LOW:
        this.logger.log(`LOW SEVERITY ERROR: ${error.message}`, logData);
        break;
    }
  }

  /**
   * Get errors grouped by type
   */
  private async getErrorsByType(since: Date): Promise<Array<{ type: string; count: number; lastOccurrence: string }>> {
    const errors = await this.prisma.auditEvent.groupBy({
      by: ['action'],
      where: {
        action: { startsWith: 'ERROR_' },
        timestamp: { gte: since },
      },
      _count: { action: true },
      orderBy: { _count: { action: 'desc' } },
      take: 10,
    });

    const result = [];
    for (const error of errors) {
      const lastOccurrence = await this.prisma.auditEvent.findFirst({
        where: { action: error.action },
        orderBy: { timestamp: 'desc' },
        select: { timestamp: true },
      });

      result.push({
        type: error.action.replace('ERROR_', ''),
        count: error._count.action,
        lastOccurrence: lastOccurrence?.timestamp.toISOString() || '',
      });
    }

    return result;
  }

  /**
   * Get hourly error counts for trends
   */
  private async getHourlyErrorCounts(since: Date): Promise<Array<{ hour: number; count: number }>> {
    // This would need a more complex query in a real implementation
    // For now, return a simplified version
    const hours = [];
    const now = new Date();
    
    for (let i = 23; i >= 0; i--) {
      const hour = new Date(now.getTime() - i * 60 * 60 * 1000);
      const nextHour = new Date(hour.getTime() + 60 * 60 * 1000);
      
      const count = await this.prisma.auditEvent.count({
        where: {
          action: { startsWith: 'ERROR_' },
          timestamp: {
            gte: hour,
            lt: nextHour,
          },
        },
      });

      hours.push({
        hour: hour.getHours(),
        count,
      });
    }

    return hours;
  }
}