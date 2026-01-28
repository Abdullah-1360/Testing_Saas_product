import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/database/prisma.service';
import { AuditService } from '@/audit/audit.service';
import { PurgeService } from './purge.service';
import { AnonymizationService } from './anonymization.service';
import { RetentionService } from './retention.service';
import { JobsService } from '@/jobs/jobs.service';

export interface ScheduledPurgeConfig {
  id: string;
  name: string;
  description: string;
  cronExpression: string;
  retentionDays: number;
  purgeScope: string;
  isActive: boolean;
  createBackup: boolean;
  verifyIntegrity: boolean;
  maxRecords?: number;
  createdBy: string;
  createdAt: Date;
  lastExecuted?: Date;
  nextExecution?: Date;
  executionCount: number;
  failureCount: number;
}

export interface PurgeExecutionResult {
  scheduleId: string;
  executionId: string;
  startTime: Date;
  endTime: Date;
  success: boolean;
  recordsPurged: number;
  tablesProcessed: number;
  error?: string;
  executionTimeMs: number;
}

@Injectable()
export class ScheduledPurgeManagerService {
  private readonly logger = new Logger(ScheduledPurgeManagerService.name);
  private readonly schedules = new Map<string, ScheduledPurgeConfig>();
  private readonly executionHistory = new Map<string, PurgeExecutionResult[]>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly auditService: AuditService,
    private readonly purgeService: PurgeService,
    private readonly anonymizationService: AnonymizationService,
    private readonly retentionService: RetentionService,
    private readonly jobsService: JobsService,
  ) {
    this.initializeDefaultSchedules();
  }

  /**
   * Initialize default purge schedules
   */
  private async initializeDefaultSchedules(): Promise<void> {
    try {
      // Daily purge schedule
      const dailyPurge: ScheduledPurgeConfig = {
        id: 'daily-purge',
        name: 'Daily Data Purge',
        description: 'Automatic daily purge of expired data based on retention policies',
        cronExpression: '0 2 * * *', // 2:00 AM daily
        retentionDays: this.configService.get<number>('DEFAULT_RETENTION_DAYS', 3),
        purgeScope: 'all',
        isActive: this.configService.get<boolean>('ENABLE_AUTO_PURGE', true),
        createBackup: true,
        verifyIntegrity: true,
        createdBy: 'system',
        createdAt: new Date(),
        executionCount: 0,
        failureCount: 0,
      };

      // Weekly anonymization schedule
      const weeklyAnonymization: ScheduledPurgeConfig = {
        id: 'weekly-anonymization',
        name: 'Weekly Data Anonymization',
        description: 'Weekly anonymization of older data for compliance',
        cronExpression: '0 3 * * 0', // 3:00 AM every Sunday
        retentionDays: this.configService.get<number>('ANONYMIZATION_RETENTION_DAYS', 5),
        purgeScope: 'anonymization',
        isActive: this.configService.get<boolean>('ENABLE_DATA_ANONYMIZATION', true),
        createBackup: false,
        verifyIntegrity: false,
        createdBy: 'system',
        createdAt: new Date(),
        executionCount: 0,
        failureCount: 0,
      };

      // Emergency cleanup schedule (disabled by default)
      const emergencyCleanup: ScheduledPurgeConfig = {
        id: 'emergency-cleanup',
        name: 'Emergency Data Cleanup',
        description: 'Emergency cleanup when storage thresholds are exceeded',
        cronExpression: '*/15 * * * *', // Every 15 minutes
        retentionDays: 1,
        purgeScope: 'all',
        isActive: false, // Disabled by default, enabled when needed
        createBackup: true,
        verifyIntegrity: true,
        maxRecords: 10000, // Limit for safety
        createdBy: 'system',
        createdAt: new Date(),
        executionCount: 0,
        failureCount: 0,
      };

      this.schedules.set(dailyPurge.id, dailyPurge);
      this.schedules.set(weeklyAnonymization.id, weeklyAnonymization);
      this.schedules.set(emergencyCleanup.id, emergencyCleanup);

      this.logger.log('Initialized default purge schedules', {
        schedules: Array.from(this.schedules.keys()),
        activeSchedules: Array.from(this.schedules.values()).filter(s => s.isActive).length,
      });

    } catch (error) {
      this.logger.error('Failed to initialize default schedules:', error);
    }
  }

  /**
   * Create a custom purge schedule
   */
  async createSchedule(
    config: Omit<ScheduledPurgeConfig, 'id' | 'createdAt' | 'executionCount' | 'failureCount'>,
    userId: string,
  ): Promise<ScheduledPurgeConfig> {
    const scheduleId = `custom-${Date.now()}`;
    
    // Validate configuration
    await this.validateScheduleConfig(config);

    const schedule: ScheduledPurgeConfig = {
      ...config,
      id: scheduleId,
      createdAt: new Date(),
      executionCount: 0,
      failureCount: 0,
      nextExecution: this.calculateNextExecution(config.cronExpression),
    };

    this.schedules.set(scheduleId, schedule);
    this.executionHistory.set(scheduleId, []);

    // Audit the schedule creation
    await this.auditService.createAuditEvent({
      userId,
      action: 'CREATE_SCHEDULED_PURGE',
      resource: 'scheduled_purge',
      resourceId: scheduleId,
      details: {
        scheduleName: schedule.name,
        cronExpression: schedule.cronExpression,
        retentionDays: schedule.retentionDays,
        purgeScope: schedule.purgeScope,
        isActive: schedule.isActive,
        createBackup: schedule.createBackup,
        verifyIntegrity: schedule.verifyIntegrity,
        maxRecords: schedule.maxRecords,
      },
    });

    this.logger.log(`Created custom purge schedule: ${schedule.name}`, {
      scheduleId,
      cronExpression: schedule.cronExpression,
      retentionDays: schedule.retentionDays,
      userId,
    });

    return schedule;
  }

  /**
   * Execute a scheduled purge
   */
  async executeScheduledPurge(scheduleId: string): Promise<PurgeExecutionResult> {
    const schedule = this.schedules.get(scheduleId);
    if (!schedule) {
      throw new Error(`Schedule ${scheduleId} not found`);
    }

    if (!schedule.isActive) {
      throw new Error(`Schedule ${scheduleId} is not active`);
    }

    const executionId = `exec-${Date.now()}`;
    const startTime = new Date();

    this.logger.log(`Executing scheduled purge: ${schedule.name}`, {
      scheduleId,
      executionId,
      retentionDays: schedule.retentionDays,
      purgeScope: schedule.purgeScope,
    });

    try {
      let result;
      let recordsPurged = 0;
      let tablesProcessed = 0;

      if (schedule.purgeScope === 'anonymization') {
        // Execute anonymization
        const anonymizationResult = await this.anonymizationService.executeAnonymization({
          retentionDays: schedule.retentionDays,
          anonymizePersonalData: true,
          anonymizeCredentials: true,
          anonymizeIpAddresses: true,
          dryRun: false,
        });

        recordsPurged = anonymizationResult.totalRecordsAnonymized;
        tablesProcessed = anonymizationResult.tablesProcessed;
      } else {
        // Execute purge
        const purgeResult = await this.purgeService.executeManualPurge({
          retentionDays: schedule.retentionDays,
          purgeScope: schedule.purgeScope as any,
          dryRun: false,
          createBackup: schedule.createBackup,
          verifyIntegrity: schedule.verifyIntegrity,
          maxRecords: schedule.maxRecords,
          reason: `Scheduled purge: ${schedule.name}`,
        });

        recordsPurged = purgeResult.totalRecordsPurged;
        tablesProcessed = purgeResult.tablesProcessed;
      }

      const endTime = new Date();
      const executionTimeMs = endTime.getTime() - startTime.getTime();

      const executionResult: PurgeExecutionResult = {
        scheduleId,
        executionId,
        startTime,
        endTime,
        success: true,
        recordsPurged,
        tablesProcessed,
        executionTimeMs,
      };

      // Update schedule statistics
      schedule.executionCount++;
      schedule.lastExecuted = endTime;
      schedule.nextExecution = this.calculateNextExecution(schedule.cronExpression);

      // Store execution history
      const history = this.executionHistory.get(scheduleId) || [];
      history.push(executionResult);
      
      // Keep only last 100 executions
      if (history.length > 100) {
        history.splice(0, history.length - 100);
      }
      
      this.executionHistory.set(scheduleId, history);

      this.logger.log(`Scheduled purge completed successfully: ${schedule.name}`, {
        scheduleId,
        executionId,
        recordsPurged,
        tablesProcessed,
        executionTimeMs,
      });

      return executionResult;

    } catch (error) {
      const endTime = new Date();
      const executionTimeMs = endTime.getTime() - startTime.getTime();

      const executionResult: PurgeExecutionResult = {
        scheduleId,
        executionId,
        startTime,
        endTime,
        success: false,
        recordsPurged: 0,
        tablesProcessed: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
        executionTimeMs,
      };

      // Update failure count
      schedule.failureCount++;
      schedule.lastExecuted = endTime;
      schedule.nextExecution = this.calculateNextExecution(schedule.cronExpression);

      // Store execution history
      const history = this.executionHistory.get(scheduleId) || [];
      history.push(executionResult);
      this.executionHistory.set(scheduleId, history);

      this.logger.error(`Scheduled purge failed: ${schedule.name}`, {
        scheduleId,
        executionId,
        error: executionResult.error,
        executionTimeMs,
      });

      throw error;
    }
  }

  /**
   * Get all schedules
   */
  getAllSchedules(): ScheduledPurgeConfig[] {
    return Array.from(this.schedules.values());
  }

  /**
   * Get active schedules
   */
  getActiveSchedules(): ScheduledPurgeConfig[] {
    return Array.from(this.schedules.values()).filter(s => s.isActive);
  }

  /**
   * Get schedule by ID
   */
  getSchedule(scheduleId: string): ScheduledPurgeConfig | undefined {
    return this.schedules.get(scheduleId);
  }

  /**
   * Update schedule
   */
  async updateSchedule(
    scheduleId: string,
    updates: Partial<ScheduledPurgeConfig>,
    userId: string,
  ): Promise<ScheduledPurgeConfig> {
    const schedule = this.schedules.get(scheduleId);
    if (!schedule) {
      throw new Error(`Schedule ${scheduleId} not found`);
    }

    const previousConfig = { ...schedule };
    
    // Apply updates
    Object.assign(schedule, updates);
    
    // Recalculate next execution if cron expression changed
    if (updates.cronExpression) {
      schedule.nextExecution = this.calculateNextExecution(updates.cronExpression);
    }

    // Audit the schedule update
    await this.auditService.createAuditEvent({
      userId,
      action: 'UPDATE_SCHEDULED_PURGE',
      resource: 'scheduled_purge',
      resourceId: scheduleId,
      details: {
        previousConfig: {
          name: previousConfig.name,
          cronExpression: previousConfig.cronExpression,
          retentionDays: previousConfig.retentionDays,
          isActive: previousConfig.isActive,
        },
        newConfig: {
          name: schedule.name,
          cronExpression: schedule.cronExpression,
          retentionDays: schedule.retentionDays,
          isActive: schedule.isActive,
        },
        changes: updates,
      },
    });

    this.logger.log(`Updated scheduled purge: ${schedule.name}`, {
      scheduleId,
      changes: updates,
      userId,
    });

    return schedule;
  }

  /**
   * Delete schedule
   */
  async deleteSchedule(scheduleId: string, userId: string): Promise<void> {
    const schedule = this.schedules.get(scheduleId);
    if (!schedule) {
      throw new Error(`Schedule ${scheduleId} not found`);
    }

    // Don't allow deletion of system schedules
    if (schedule.createdBy === 'system') {
      throw new Error('Cannot delete system schedules');
    }

    this.schedules.delete(scheduleId);
    this.executionHistory.delete(scheduleId);

    // Audit the schedule deletion
    await this.auditService.createAuditEvent({
      userId,
      action: 'DELETE_SCHEDULED_PURGE',
      resource: 'scheduled_purge',
      resourceId: scheduleId,
      details: {
        deletedSchedule: {
          name: schedule.name,
          cronExpression: schedule.cronExpression,
          retentionDays: schedule.retentionDays,
          purgeScope: schedule.purgeScope,
        },
      },
    });

    this.logger.log(`Deleted scheduled purge: ${schedule.name}`, {
      scheduleId,
      userId,
    });
  }

  /**
   * Get execution history for a schedule
   */
  getExecutionHistory(scheduleId: string, limit: number = 50): PurgeExecutionResult[] {
    const history = this.executionHistory.get(scheduleId) || [];
    return history.slice(-limit).reverse(); // Most recent first
  }

  /**
   * Get schedule statistics
   */
  getScheduleStatistics(): {
    totalSchedules: number;
    activeSchedules: number;
    totalExecutions: number;
    successfulExecutions: number;
    failedExecutions: number;
    averageExecutionTime: number;
    lastExecutionTime?: Date;
  } {
    const schedules = Array.from(this.schedules.values());
    const allHistory = Array.from(this.executionHistory.values()).flat();

    const totalExecutions = allHistory.length;
    const successfulExecutions = allHistory.filter(h => h.success).length;
    const failedExecutions = totalExecutions - successfulExecutions;
    
    const averageExecutionTime = totalExecutions > 0
      ? allHistory.reduce((sum, h) => sum + h.executionTimeMs, 0) / totalExecutions
      : 0;

    const lastExecution = allHistory.sort((a, b) => b.endTime.getTime() - a.endTime.getTime())[0];

    return {
      totalSchedules: schedules.length,
      activeSchedules: schedules.filter(s => s.isActive).length,
      totalExecutions,
      successfulExecutions,
      failedExecutions,
      averageExecutionTime: Math.round(averageExecutionTime),
      lastExecutionTime: lastExecution?.endTime,
    };
  }

  /**
   * Enable emergency cleanup mode
   */
  async enableEmergencyCleanup(reason: string, userId: string): Promise<void> {
    const emergencySchedule = this.schedules.get('emergency-cleanup');
    if (!emergencySchedule) {
      throw new Error('Emergency cleanup schedule not found');
    }

    emergencySchedule.isActive = true;
    emergencySchedule.nextExecution = new Date(Date.now() + 60000); // Start in 1 minute

    await this.auditService.createAuditEvent({
      userId,
      action: 'ENABLE_EMERGENCY_CLEANUP',
      resource: 'scheduled_purge',
      resourceId: 'emergency-cleanup',
      details: {
        reason,
        enabledAt: new Date().toISOString(),
      },
    });

    this.logger.warn('Emergency cleanup mode enabled', {
      reason,
      nextExecution: emergencySchedule.nextExecution,
      userId,
    });
  }

  /**
   * Disable emergency cleanup mode
   */
  async disableEmergencyCleanup(userId: string): Promise<void> {
    const emergencySchedule = this.schedules.get('emergency-cleanup');
    if (!emergencySchedule) {
      throw new Error('Emergency cleanup schedule not found');
    }

    emergencySchedule.isActive = false;

    await this.auditService.createAuditEvent({
      userId,
      action: 'DISABLE_EMERGENCY_CLEANUP',
      resource: 'scheduled_purge',
      resourceId: 'emergency-cleanup',
      details: {
        disabledAt: new Date().toISOString(),
      },
    });

    this.logger.log('Emergency cleanup mode disabled', { userId });
  }

  /**
   * Validate schedule configuration
   */
  private async validateScheduleConfig(config: Partial<ScheduledPurgeConfig>): Promise<void> {
    // Validate retention days
    if (config.retentionDays && !this.retentionService.validateRetentionDays(config.retentionDays)) {
      throw new Error(`Invalid retention days: ${config.retentionDays}. Must be between 1-7 days.`);
    }

    // Validate cron expression
    if (config.cronExpression && !this.isValidCronExpression(config.cronExpression)) {
      throw new Error(`Invalid cron expression: ${config.cronExpression}`);
    }

    // Validate purge scope
    if (config.purgeScope) {
      const validScopes = ['all', 'incidents', 'commands', 'evidence', 'backups', 'audit', 'anonymization'];
      if (!validScopes.includes(config.purgeScope)) {
        throw new Error(`Invalid purge scope: ${config.purgeScope}`);
      }
    }

    // Validate max records
    if (config.maxRecords && (config.maxRecords < 1 || config.maxRecords > 100000)) {
      throw new Error(`Invalid max records: ${config.maxRecords}. Must be between 1-100000.`);
    }
  }

  /**
   * Validate cron expression (basic validation)
   */
  private isValidCronExpression(cronExpression: string): boolean {
    const cronParts = cronExpression.split(' ');
    return cronParts.length === 5 || cronParts.length === 6;
  }

  /**
   * Calculate next execution time (simplified)
   */
  private calculateNextExecution(cronExpression: string): Date {
    // This is a simplified implementation
    // In production, use a proper cron parser like 'node-cron' or 'cron-parser'
    const nextHour = new Date();
    nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);
    return nextHour;
  }
}