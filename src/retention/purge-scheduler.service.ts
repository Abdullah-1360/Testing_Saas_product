import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/database/prisma.service';
import { AuditService } from '@/audit/audit.service';
import { PurgeService } from './purge.service';
import { RetentionService } from './retention.service';

export interface PurgeSchedule {
  id: string;
  name: string;
  cronExpression: string;
  retentionDays: number;
  purgeScope: string;
  isActive: boolean;
  lastExecuted?: Date;
  nextExecution?: Date;
  createdBy: string;
  createdAt: Date;
}

export interface PurgeMonitoringAlert {
  type: 'HIGH_VOLUME' | 'STALE_DATA' | 'FAILED_PURGE' | 'EXCESSIVE_GROWTH';
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  message: string;
  tableName?: string;
  recordCount?: number;
  threshold?: number;
  timestamp: Date;
}

@Injectable()
export class PurgeSchedulerService {
  private readonly logger = new Logger(PurgeSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly auditService: AuditService,
    private readonly purgeService: PurgeService,
    private readonly retentionService: RetentionService,
  ) {}

  /**
   * Create a custom purge schedule
   */
  async createPurgeSchedule(
    schedule: Omit<PurgeSchedule, 'id' | 'createdAt'>,
    userId: string,
  ): Promise<PurgeSchedule> {
    this.logger.log('Creating custom purge schedule', {
      name: schedule.name,
      cronExpression: schedule.cronExpression,
      retentionDays: schedule.retentionDays,
      purgeScope: schedule.purgeScope,
      userId,
    });

    // Validate cron expression
    if (!this.isValidCronExpression(schedule.cronExpression)) {
      throw new Error(`Invalid cron expression: ${schedule.cronExpression}`);
    }

    // Validate retention days
    if (!this.retentionService.validateRetentionDays(schedule.retentionDays)) {
      throw new Error(`Invalid retention days: ${schedule.retentionDays}`);
    }

    const newSchedule: PurgeSchedule = {
      id: `schedule-${Date.now()}`,
      ...schedule,
      createdBy: userId,
      createdAt: new Date(),
      nextExecution: this.calculateNextExecution(schedule.cronExpression),
    };

    // Store in database (this would require a purge_schedules table)
    // For now, we'll log the creation
    this.logger.log('Purge schedule created', newSchedule);

    // Audit the schedule creation
    await this.auditService.createAuditEvent({
      userId,
      action: 'CREATE_PURGE_SCHEDULE',
      resource: 'purge_schedule',
      resourceId: newSchedule.id,
      details: {
        scheduleName: schedule.name,
        cronExpression: schedule.cronExpression,
        retentionDays: schedule.retentionDays,
        purgeScope: schedule.purgeScope,
        nextExecution: newSchedule.nextExecution,
      },
    });

    return newSchedule;
  }

  /**
   * Monitor data growth and generate alerts
   */
  async monitorDataGrowth(): Promise<PurgeMonitoringAlert[]> {
    const alerts: PurgeMonitoringAlert[] = [];

    try {
      // Get retention statistics
      const stats = await this.retentionService.getRetentionStatistics();
      
      // Configuration thresholds
      const highVolumeThreshold = this.configService.get<number>('HIGH_VOLUME_THRESHOLD', 50000);
      const criticalVolumeThreshold = this.configService.get<number>('CRITICAL_VOLUME_THRESHOLD', 100000);
      const staleDataDays = this.configService.get<number>('STALE_DATA_THRESHOLD_DAYS', 14);

      // Check for high purge operation count
      if (stats.totalPurgeOperations > criticalVolumeThreshold) {
        alerts.push({
          type: 'HIGH_VOLUME',
          severity: 'CRITICAL',
          message: `Total purge operations (${stats.totalPurgeOperations}) exceeds critical threshold (${criticalVolumeThreshold})`,
          tableName: 'purge_audit',
          recordCount: stats.totalPurgeOperations,
          threshold: criticalVolumeThreshold,
          timestamp: new Date(),
        });
      }

      // Check for failed purge operations
      const recentFailedPurges = await this.getRecentFailedPurges();
      if (recentFailedPurges > 0) {
        alerts.push({
          type: 'FAILED_PURGE',
          severity: recentFailedPurges > 3 ? 'CRITICAL' : 'HIGH',
          message: `${recentFailedPurges} purge operations failed in the last 24 hours`,
          recordCount: recentFailedPurges,
          timestamp: new Date(),
        });
      }

      // Check for excessive data growth
      const growthRate = await this.calculateDataGrowthRate();
      const excessiveGrowthThreshold = this.configService.get<number>('EXCESSIVE_GROWTH_THRESHOLD', 10000);
      
      if (growthRate > excessiveGrowthThreshold) {
        alerts.push({
          type: 'EXCESSIVE_GROWTH',
          severity: growthRate > excessiveGrowthThreshold * 2 ? 'CRITICAL' : 'HIGH',
          message: `Data growth rate is ${growthRate} records/day (threshold: ${excessiveGrowthThreshold})`,
          recordCount: growthRate,
          threshold: excessiveGrowthThreshold,
          timestamp: new Date(),
        });
      }

      this.logger.log('Data growth monitoring completed', {
        alertsGenerated: alerts.length,
        highVolumeAlerts: alerts.filter(a => a.type === 'HIGH_VOLUME').length,
        staleDataAlerts: alerts.filter(a => a.type === 'STALE_DATA').length,
        failedPurgeAlerts: alerts.filter(a => a.type === 'FAILED_PURGE').length,
        excessiveGrowthAlerts: alerts.filter(a => a.type === 'EXCESSIVE_GROWTH').length,
      });

      return alerts;

    } catch (error) {
      this.logger.error('Failed to monitor data growth:', error);
      
      alerts.push({
        type: 'FAILED_PURGE',
        severity: 'CRITICAL',
        message: `Data growth monitoring failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: new Date(),
      });

      return alerts;
    }
  }

  /**
   * Execute emergency purge when thresholds are exceeded
   */
  async executeEmergencyPurge(
    tableName: string,
    reason: string,
    userId?: string,
  ): Promise<void> {
    const emergencyRetentionDays = this.configService.get<number>('EMERGENCY_RETENTION_DAYS', 1);
    
    this.logger.warn('Executing emergency purge', {
      tableName,
      reason,
      emergencyRetentionDays,
      userId,
    });

    try {
      // Execute emergency purge directly using purge service
      const result = await this.purgeService.executeManualPurge({
        retentionDays: emergencyRetentionDays,
        tableName,
        dryRun: false,
        purgeMode: 'hard' as any,
        purgeScope: 'all' as any,
        reason: `EMERGENCY: ${reason}`,
        createBackup: true,
        verifyIntegrity: true,
      }, userId);

      this.logger.log('Emergency purge completed', {
        tableName,
        recordsPurged: result.totalRecordsPurged,
        retentionDays: emergencyRetentionDays,
        reason,
      });

      // Audit the emergency purge
      await this.auditService.createAuditEvent({
        userId,
        action: 'EMERGENCY_PURGE_EXECUTED',
        resource: 'emergency_purge',
        resourceId: `emergency-${Date.now()}`,
        details: {
          tableName,
          reason,
          emergencyRetentionDays,
          recordsPurged: result.totalRecordsPurged,
          executionTimeMs: result.results.reduce((sum, r) => sum + r.executionTimeMs, 0),
        },
      });

    } catch (error) {
      this.logger.error('Failed to execute emergency purge:', error);
      
      // Audit the failed emergency purge
      await this.auditService.createAuditEvent({
        userId,
        action: 'EMERGENCY_PURGE_FAILED',
        resource: 'emergency_purge',
        resourceId: `emergency-failed-${Date.now()}`,
        details: {
          tableName,
          reason,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      });

      throw error;
    }
  }

  /**
   * Get purge performance metrics
   */
  async getPurgePerformanceMetrics(): Promise<{
    averageExecutionTime: number;
    totalRecordsPurgedToday: number;
    successRate: number;
    mostActiveTable: string;
    purgeFrequency: number;
  }> {
    try {
      // Get purge audit records from the last 24 hours
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const auditRecords = await this.retentionService.getPurgeAuditRecords(1000, 0);
      
      const recentAudits = auditRecords.records.filter(
        record => new Date(record.executedAt) >= yesterday
      );

      if (recentAudits.length === 0) {
        return {
          averageExecutionTime: 0,
          totalRecordsPurgedToday: 0,
          successRate: 0,
          mostActiveTable: 'none',
          purgeFrequency: 0,
        };
      }

      // Calculate metrics
      const totalRecordsPurged = recentAudits.reduce(
        (sum, record) => sum + record.recordsPurged, 0
      );

      // Group by table to find most active
      const tableActivity = recentAudits.reduce((acc, record) => {
        acc[record.tableName] = (acc[record.tableName] || 0) + record.recordsPurged;
        return acc;
      }, {} as Record<string, number>);

      const mostActiveTable = Object.entries(tableActivity)
        .sort(([,a], [,b]) => b - a)[0]?.[0] || 'none';

      return {
        averageExecutionTime: 0, // Would need execution time data
        totalRecordsPurgedToday: totalRecordsPurged,
        successRate: 100, // Would need failure data
        mostActiveTable,
        purgeFrequency: recentAudits.length,
      };

    } catch (error) {
      this.logger.error('Failed to get purge performance metrics:', error);
      throw error;
    }
  }

  /**
   * Validate cron expression
   */
  private isValidCronExpression(cronExpression: string): boolean {
    // Basic cron validation - in production, use a proper cron parser
    const cronParts = cronExpression.split(' ');
    return cronParts.length === 5 || cronParts.length === 6;
  }

  /**
   * Calculate next execution time for cron expression
   */
  private calculateNextExecution(cronExpression: string): Date {
    // Simplified calculation - in production, use a proper cron parser
    // For now, just return next hour
    const nextHour = new Date();
    nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);
    return nextHour;
  }

  /**
   * Get count of recent failed purges
   */
  private async getRecentFailedPurges(): Promise<number> {
    try {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      
      const failedPurges = await this.prisma.auditEvent.count({
        where: {
          action: { contains: 'PURGE_FAILED' },
          timestamp: { gte: yesterday },
        },
      });

      return failedPurges;
    } catch (error) {
      this.logger.error('Failed to get recent failed purges:', error);
      return 0;
    }
  }

  /**
   * Calculate data growth rate (records per day)
   */
  private async calculateDataGrowthRate(): Promise<number> {
    try {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      
      // Count new incidents created in the last 24 hours as a proxy for growth
      const newIncidents = await this.prisma.incident.count({
        where: {
          createdAt: { gte: yesterday },
        },
      });

      // Estimate total growth based on incidents (rough approximation)
      // Each incident typically generates ~10-20 related records
      return newIncidents * 15;
    } catch (error) {
      this.logger.error('Failed to calculate data growth rate:', error);
      return 0;
    }
  }
}