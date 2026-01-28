import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { JobsService } from './jobs.service';
import { PurgeService } from '@/retention/purge.service';
import { AnonymizationService } from '@/retention/anonymization.service';
import { RetentionService } from '@/retention/retention.service';
import { PurgeSchedulerService } from '@/retention/purge-scheduler.service';
import { ScheduledPurgeManagerService } from '@/retention/scheduled-purge-manager.service';

@Injectable()
export class ScheduledJobsService {
  private readonly logger = new Logger(ScheduledJobsService.name);

  constructor(
    private readonly jobsService: JobsService,
    private readonly configService: ConfigService,
    private readonly purgeService: PurgeService,
    private readonly anonymizationService: AnonymizationService,
    private readonly retentionService: RetentionService,
    private readonly purgeSchedulerService: PurgeSchedulerService,
    private readonly scheduledPurgeManager: ScheduledPurgeManagerService,
  ) {}

  /**
   * Daily data retention purge at 2:00 AM
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async handleDailyDataPurge() {
    const enableAutoPurge = this.configService.get<boolean>('ENABLE_AUTO_PURGE', true);
    
    if (!enableAutoPurge) {
      this.logger.log('Automatic data purge is disabled via configuration');
      return;
    }

    this.logger.log('Starting daily scheduled purge execution');

    try {
      // Execute the daily purge schedule using the scheduled purge manager
      const result = await this.scheduledPurgeManager.executeScheduledPurge('daily-purge');

      this.logger.log('Daily scheduled purge completed successfully', {
        scheduleId: 'daily-purge',
        executionId: result.executionId,
        recordsPurged: result.recordsPurged,
        tablesProcessed: result.tablesProcessed,
        executionTimeMs: result.executionTimeMs,
        success: result.success,
      });

      // If the scheduled purge failed or found no data, try fallback
      if (!result.success || result.recordsPurged === 0) {
        this.logger.warn('Scheduled purge had issues, attempting fallback purge');
        
        const fallbackResult = await this.purgeService.executeAutomaticPurge();
        const totalRecordsPurged = fallbackResult.reduce((sum, op) => sum + op.totalRecordsPurged, 0);
        
        this.logger.log('Fallback purge completed', {
          totalRecordsPurged,
          operations: fallbackResult.length,
        });
      }

    } catch (error) {
      this.logger.error('Daily scheduled purge failed:', error);
      
      // Fallback to original purge logic
      try {
        const fallbackOperations = await this.purgeService.executeAutomaticPurge();
        const totalRecordsPurged = fallbackOperations.reduce((sum, op) => sum + op.totalRecordsPurged, 0);
        
        this.logger.log('Fallback purge completed after scheduled purge failure', {
          totalRecordsPurged,
          operations: fallbackOperations.length,
        });
      } catch (fallbackError) {
        this.logger.error('Fallback purge also failed:', fallbackError);
        
        // Schedule emergency cleanup job as last resort
        try {
          const emergencyResult = await this.jobsService.scheduleArtifactCleanup({
            retentionDays: 1, // Very aggressive cleanup
          });

          this.logger.log('Emergency cleanup job scheduled due to purge failures', {
            jobId: emergencyResult.jobId,
          });
        } catch (emergencyError) {
          this.logger.error('Failed to schedule emergency cleanup:', emergencyError);
        }
      }
    }
  }

  /**
   * System health check every 5 minutes
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async handleSystemHealthCheck() {
    this.logger.debug('Starting system health check');

    try {
      const result = await this.jobsService.scheduleSystemHealthCheck();

      this.logger.debug(`System health check scheduled successfully`, {
        jobId: result.jobId,
      });

    } catch (error) {
      this.logger.error('Failed to schedule system health check:', error);
    }
  }

  /**
   * Queue maintenance every hour
   */
  @Cron(CronExpression.EVERY_HOUR)
  async handleQueueMaintenance() {
    this.logger.log('Starting queue maintenance');

    try {
      // Get queue stats to check for issues
      const stats = await this.jobsService.getQueueStats();
      
      for (const queueStat of stats) {
        const { queueName, counts } = queueStat;
        
        // Log queue status
        this.logger.log(`Queue ${queueName} status:`, counts);
        
        // Clean old completed and failed jobs (keep last 24 hours)
        if (counts.completed > 100 || counts.failed > 50) {
          await this.jobsService.cleanQueue(queueName, 24);
          this.logger.log(`Cleaned queue ${queueName}`);
        }

        // Alert on high failure rates
        if (counts.failed > 20) {
          this.logger.warn(`High failure rate detected in queue ${queueName}`, {
            failed: counts.failed,
            active: counts.active,
            waiting: counts.waiting,
          });
        }

        // Alert on stalled jobs
        if (counts.active > 10) {
          this.logger.warn(`High number of active jobs in queue ${queueName}`, {
            active: counts.active,
            waiting: counts.waiting,
          });
        }
      }

    } catch (error) {
      this.logger.error('Failed to perform queue maintenance:', error);
    }
  }

  /**
   * Weekly queue statistics report every Sunday at 6:00 AM
   */
  @Cron('0 6 * * 0') // Every Sunday at 6:00 AM
  async handleWeeklyQueueReport() {
    this.logger.log('Generating weekly queue statistics report');

    try {
      const stats = await this.jobsService.getQueueStats();
      
      let totalJobs = 0;
      let totalCompleted = 0;
      let totalFailed = 0;
      
      const queueSummary = stats.map(queueStat => {
        const { queueName, counts } = queueStat;
        const queueTotal = counts.waiting + counts.active + counts.completed + counts.failed + counts.delayed;
        
        totalJobs += queueTotal;
        totalCompleted += counts.completed;
        totalFailed += counts.failed;
        
        return {
          queue: queueName,
          total: queueTotal,
          completed: counts.completed,
          failed: counts.failed,
          successRate: queueTotal > 0 ? ((counts.completed / queueTotal) * 100).toFixed(2) + '%' : '0%',
        };
      });

      const overallSuccessRate = totalJobs > 0 ? ((totalCompleted / totalJobs) * 100).toFixed(2) + '%' : '0%';

      this.logger.log('Weekly Queue Statistics Report', {
        reportDate: new Date().toISOString(),
        summary: {
          totalJobs,
          totalCompleted,
          totalFailed,
          overallSuccessRate,
        },
        queueBreakdown: queueSummary,
      });

    } catch (error) {
      this.logger.error('Failed to generate weekly queue report:', error);
    }
  }

  /**
   * Circuit breaker reset every 30 minutes
   * This helps recover from temporary issues
   */
  @Cron('*/30 * * * *') // Every 30 minutes
  async handleCircuitBreakerReset() {
    this.logger.debug('Checking for circuit breaker reset opportunities');

    try {
      const stats = await this.jobsService.getQueueStats();
      
      for (const queueStat of stats) {
        const { queueName, counts } = queueStat;
        
        // If a queue has been idle (no active jobs) and has failed jobs,
        // it might be in a circuit breaker state - try resuming it
        if (counts.active === 0 && counts.failed > 0 && counts.waiting === 0) {
          this.logger.log(`Attempting to resume potentially circuit-broken queue: ${queueName}`);
          
          // Resume the queue in case it was paused due to circuit breaker
          await this.jobsService.resumeQueue(queueName);
        }
      }

    } catch (error) {
      this.logger.error('Failed to check circuit breaker reset:', error);
    }
  }

  /**
   * Weekly data anonymization every Sunday at 3:00 AM
   * This runs after the daily purge to anonymize older data for compliance
   */
  @Cron('0 3 * * 0') // Every Sunday at 3:00 AM
  async handleWeeklyDataAnonymization() {
    const enableAnonymization = this.configService.get<boolean>('ENABLE_DATA_ANONYMIZATION', true);
    
    if (!enableAnonymization) {
      this.logger.log('Data anonymization is disabled via configuration');
      return;
    }
    
    this.logger.log('Starting weekly scheduled anonymization');

    try {
      // Execute the weekly anonymization schedule using the scheduled purge manager
      const result = await this.scheduledPurgeManager.executeScheduledPurge('weekly-anonymization');

      this.logger.log('Weekly scheduled anonymization completed successfully', {
        scheduleId: 'weekly-anonymization',
        executionId: result.executionId,
        recordsProcessed: result.recordsPurged, // In this case, records anonymized
        tablesProcessed: result.tablesProcessed,
        executionTimeMs: result.executionTimeMs,
        success: result.success,
      });

    } catch (error) {
      this.logger.error('Weekly scheduled anonymization failed:', error);
      
      // Fallback to direct anonymization service
      try {
        const retentionDays = this.configService.get<number>('ANONYMIZATION_RETENTION_DAYS', 5);
        
        const operation = await this.anonymizationService.executeAnonymization({
          retentionDays,
          anonymizePersonalData: true,
          anonymizeCredentials: true,
          anonymizeIpAddresses: true,
          dryRun: false,
        });

        this.logger.log('Fallback anonymization completed', {
          totalRecordsAnonymized: operation.totalRecordsAnonymized,
          tablesProcessed: operation.tablesProcessed,
          success: operation.success,
        });
      } catch (fallbackError) {
        this.logger.error('Fallback anonymization also failed:', fallbackError);
      }
    }
  }

  /**
   * Hourly purge monitoring and emergency cleanup
   * Monitors for data growth and triggers emergency purges if needed
   */
  @Cron(CronExpression.EVERY_HOUR)
  async handlePurgeMonitoring() {
    this.logger.debug('Starting hourly purge monitoring');

    try {
      // Use the purge scheduler service for comprehensive monitoring
      const alerts = await this.purgeSchedulerService.monitorDataGrowth();
      
      // Process critical alerts
      const criticalAlerts = alerts.filter(alert => alert.severity === 'CRITICAL');
      
      if (criticalAlerts.length > 0) {
        this.logger.warn('Critical data growth alerts detected', {
          criticalAlerts: criticalAlerts.length,
          totalAlerts: alerts.length,
        });

        // Handle high volume alerts with emergency purge
        for (const alert of criticalAlerts) {
          if (alert.type === 'HIGH_VOLUME' && alert.tableName) {
            try {
              await this.purgeSchedulerService.executeEmergencyPurge(
                alert.tableName,
                `Emergency purge triggered by critical volume alert: ${alert.message}`,
                'system'
              );

              this.logger.log(`Emergency purge scheduled for ${alert.tableName}`, {
                reason: alert.message,
                recordCount: alert.recordCount,
                threshold: alert.threshold,
              });
            } catch (emergencyError) {
              this.logger.error(`Failed to schedule emergency purge for ${alert.tableName}:`, emergencyError);
            }
          }
        }
      }

      // Log monitoring summary
      const alertSummary = {
        total: alerts.length,
        critical: alerts.filter(a => a.severity === 'CRITICAL').length,
        high: alerts.filter(a => a.severity === 'HIGH').length,
        medium: alerts.filter(a => a.severity === 'MEDIUM').length,
        low: alerts.filter(a => a.severity === 'LOW').length,
      };

      this.logger.debug('Purge monitoring completed', alertSummary);

      // If there are high or critical alerts, log them for visibility
      if (alertSummary.critical > 0 || alertSummary.high > 0) {
        this.logger.warn('Data retention alerts require attention', {
          alertSummary,
          criticalAlerts: alerts.filter(a => a.severity === 'CRITICAL').map(a => ({
            type: a.type,
            message: a.message,
            tableName: a.tableName,
          })),
        });
      }

    } catch (error) {
      this.logger.error('Failed to perform purge monitoring:', error);
    }
  }

  /**
   * Daily purge audit report at 6:00 AM
   * Generates and logs purge audit summary
   */
  @Cron('0 6 * * *') // Every day at 6:00 AM
  async handleDailyPurgeAuditReport() {
    this.logger.log('Generating daily purge audit report');

    try {
      // Get purge audit records from the last 24 hours
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const auditRecords = await this.retentionService.getPurgeAuditRecords(100, 0);
      
      // Filter records from the last 24 hours
      const recentAudits = auditRecords.records.filter(
        record => new Date(record.executedAt) >= yesterday
      );

      const totalRecordsPurged = recentAudits.reduce(
        (sum, record) => sum + record.recordsPurged, 0
      );

      const uniqueTables = new Set(recentAudits.map(record => record.tableName));
      const uniquePolicies = new Set(recentAudits.map(record => record.policyId));

      const auditSummary = {
        reportDate: new Date().toISOString(),
        period: '24 hours',
        totalPurgeOperations: recentAudits.length,
        totalRecordsPurged,
        tablesAffected: Array.from(uniqueTables),
        policiesExecuted: Array.from(uniquePolicies),
        auditRecords: recentAudits.map(record => ({
          tableName: record.tableName,
          recordsPurged: record.recordsPurged,
          executedAt: record.executedAt,
          executedBy: record.executedBy,
        })),
      };

      this.logger.log('Daily Purge Audit Report', auditSummary);

      // Alert if no purge operations occurred (might indicate system issue)
      if (recentAudits.length === 0) {
        this.logger.warn('No purge operations detected in the last 24 hours - check system health');
      }

      // Alert if excessive purging occurred
      const excessivePurgeThreshold = this.configService.get<number>('EXCESSIVE_PURGE_THRESHOLD', 10000);
      if (totalRecordsPurged > excessivePurgeThreshold) {
        this.logger.warn('Excessive data purging detected', {
          totalRecordsPurged,
          threshold: excessivePurgeThreshold,
          operations: recentAudits.length,
        });
      }

    } catch (error) {
      this.logger.error('Failed to generate daily purge audit report:', error);
    }
  }
}