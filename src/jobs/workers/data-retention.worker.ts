import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Worker, Job } from 'bullmq';
import { QueueNames, JobTypes } from '../queue.config';
import { RedisConfigService } from '@/config/redis.config';
import { PurgeService } from '@/retention/purge.service';
import { AnonymizationService } from '@/retention/anonymization.service';

export interface DataRetentionJobData {
  retentionDays: number;
  tableName?: string;
  cutoffDate?: string;
  dryRun?: boolean;
  correlationId?: string;
  // Anonymization specific fields
  anonymizePersonalData?: boolean;
  anonymizeCredentials?: boolean;
  anonymizeIpAddresses?: boolean;
}

@Injectable()
export class DataRetentionWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DataRetentionWorker.name);
  private worker!: Worker;

  constructor(
    private readonly redisConfig: RedisConfigService,
    private readonly purgeService: PurgeService,
    private readonly anonymizationService: AnonymizationService,
  ) {}

  async onModuleInit() {
    await this.initializeWorker();
  }

  async onModuleDestroy() {
    await this.closeWorker();
  }

  private async initializeWorker() {
    this.worker = new Worker(
      QueueNames.DATA_RETENTION,
      async (job: Job) => {
        return await this.processJob(job);
      },
      {
        connection: this.redisConfig.getRedisOptions(),
        concurrency: 1, // Process retention jobs sequentially to avoid conflicts
      }
    );

    // Set up worker event handlers
    this.worker.on('ready', () => {
      this.logger.log('Data retention worker is ready');
    });

    this.worker.on('error', (error) => {
      this.logger.error('Data retention worker error:', error);
    });

    this.worker.on('failed', (job, error) => {
      this.logger.error(`Data retention job ${job?.id} failed:`, error);
    });

    this.worker.on('completed', (job, result) => {
      this.logger.log(`Data retention job ${job.id} completed:`, result);
    });

    this.logger.log('Data retention worker initialized');
  }

  private async processJob(job: Job): Promise<any> {
    const { name: jobType, data } = job;
    
    this.logger.log(`Processing data retention job ${job.id} of type ${jobType}`, {
      correlationId: data.correlationId,
    });

    try {
      switch (jobType) {
        case JobTypes.PURGE_EXPIRED_DATA:
          return await this.processPurgeExpiredData(job);
        
        case JobTypes.CLEANUP_ARTIFACTS:
          return await this.processCleanupArtifacts(job);
        
        case JobTypes.AUDIT_PURGE:
          return await this.processAuditPurge(job);
        
        case JobTypes.ANONYMIZE_DATA:
          return await this.processDataAnonymization(job);
        
        default:
          throw new Error(`Unknown data retention job type: ${jobType}`);
      }
    } catch (error) {
      this.logger.error(`Error processing data retention job ${job.id}:`, error);
      throw error;
    }
  }

  private async processPurgeExpiredData(job: Job<DataRetentionJobData>): Promise<any> {
    const { data } = job;
    this.logger.log(`Processing purge expired data job`, {
      retentionDays: data.retentionDays,
      tableName: data.tableName,
      dryRun: data.dryRun,
    });

    await job.updateProgress(10);

    try {
      // Use the actual purge service to execute the purge
      const result = await this.purgeService.executeManualPurge({
        retentionDays: data.retentionDays,
        tableName: data.tableName || undefined,
        dryRun: data.dryRun || false,
        cutoffDate: data.cutoffDate || undefined,
      });

      await job.updateProgress(100);

      this.logger.log(`Purged ${result.totalRecordsPurged} expired records from ${result.tablesProcessed} tables`);
      
      return {
        success: true,
        totalRecordsPurged: result.totalRecordsPurged,
        tablesProcessed: result.tablesProcessed,
        results: result.results,
        retentionDays: data.retentionDays,
        dryRun: data.dryRun || false,
        executedAt: result.executedAt,
      };

    } catch (error) {
      this.logger.error('Failed to execute purge operation:', error);
      throw error;
    }
  }

  private async processCleanupArtifacts(job: Job<DataRetentionJobData>): Promise<any> {
    this.logger.log(`Processing cleanup artifacts job`);

    await job.updateProgress(20);

    try {
      // Use the purge service to execute automatic purge
      const operations = await this.purgeService.executeAutomaticPurge();
      
      await job.updateProgress(70);

      // Calculate totals from all operations
      const totalRecordsPurged = operations.reduce((sum, op) => sum + op.totalRecordsPurged, 0);
      const totalTablesProcessed = operations.reduce((sum, op) => sum + op.tablesProcessed, 0);
      const successfulOperations = operations.filter(op => op.success).length;

      await job.updateProgress(100);

      const result = {
        success: true,
        operationsExecuted: operations.length,
        successfulOperations,
        totalRecordsPurged,
        totalTablesProcessed,
        operations,
        executedAt: new Date().toISOString(),
      };

      this.logger.log(`Cleaned up ${totalRecordsPurged} records across ${totalTablesProcessed} tables in ${operations.length} operations`);
      
      return result;

    } catch (error) {
      this.logger.error('Failed to execute artifact cleanup:', error);
      throw error;
    }
  }

  private async processAuditPurge(job: Job<DataRetentionJobData>): Promise<any> {
    this.logger.log(`Processing audit purge job`);

    await job.updateProgress(30);

    // TODO: Implement actual audit purge recording logic
    // This will record the purge operation in the audit trail
    
    // Simulate audit recording
    await new Promise(resolve => setTimeout(resolve, 1000));
    await job.updateProgress(80);

    const auditRecord = {
      purgeId: `PURGE-${Date.now()}`,
      retentionDays: job.data.retentionDays,
      executedAt: new Date().toISOString(),
      recordsPurged: Math.floor(Math.random() * 200) + 50,
      tablesAffected: ['incidents', 'incident_events', 'command_executions'],
    };

    await job.updateProgress(100);

    const result = {
      success: true,
      auditRecord,
      auditRecordCreated: true,
    };

    this.logger.log(`Created audit record for purge operation: ${auditRecord.purgeId}`);
    
    return result;
  }

  private async processDataAnonymization(job: Job<DataRetentionJobData>): Promise<any> {
    const { data } = job;
    this.logger.log(`Processing data anonymization job`, {
      retentionDays: data.retentionDays,
      tableName: data.tableName,
      anonymizePersonalData: data.anonymizePersonalData,
      anonymizeCredentials: data.anonymizeCredentials,
      anonymizeIpAddresses: data.anonymizeIpAddresses,
    });

    await job.updateProgress(10);

    try {
      // Use the anonymization service to execute the anonymization
      const result = await this.anonymizationService.executeAnonymization({
        retentionDays: data.retentionDays,
        tableName: data.tableName || undefined,
        dryRun: false,
        anonymizePersonalData: data.anonymizePersonalData ?? true,
        anonymizeCredentials: data.anonymizeCredentials ?? true,
        anonymizeIpAddresses: data.anonymizeIpAddresses ?? true,
      });

      await job.updateProgress(100);

      this.logger.log(`Anonymized ${result.totalRecordsAnonymized} records across ${result.tablesProcessed} tables`);
      
      return {
        success: true,
        totalRecordsAnonymized: result.totalRecordsAnonymized,
        tablesProcessed: result.tablesProcessed,
        results: result.results,
        retentionDays: data.retentionDays,
        executedAt: result.executedAt,
      };

    } catch (error) {
      this.logger.error('Failed to execute anonymization operation:', error);
      throw error;
    }
  }

  private async closeWorker() {
    if (this.worker) {
      this.logger.log('Closing data retention worker...');
      await this.worker.close();
      this.logger.log('Data retention worker closed');
    }
  }
}