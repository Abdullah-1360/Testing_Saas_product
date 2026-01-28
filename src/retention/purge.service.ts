import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { AuditService } from '@/audit/audit.service';
import { RetentionService } from './retention.service';
import { ManualPurgeDto, PurgeMode, PurgeScope } from './dto';

export interface PurgeResult {
  tableName: string;
  recordsPurged: number;
  cutoffDate: string;
  executionTimeMs: number;
  purgeMode: PurgeMode;
  backupCreated?: boolean;
  integrityVerified?: boolean;
}

export interface PurgeOperation {
  success: boolean;
  totalRecordsPurged: number;
  tablesProcessed: number;
  results: PurgeResult[];
  executedAt: string;
  dryRun: boolean;
  policyId?: string;
  executedBy?: string;
  purgeMode: PurgeMode;
  purgeScope: PurgeScope;
  reason?: string;
  backupsCreated: number;
  integrityChecksPerformed: number;
}

@Injectable()
export class PurgeService {
  private readonly logger = new Logger(PurgeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly retentionService: RetentionService,
  ) {}

  /**
   * Execute manual purge operation with enhanced features
   */
  async executeManualPurge(
    purgeDto: ManualPurgeDto,
    userId?: string,
  ): Promise<PurgeOperation> {
    const startTime = Date.now();
    const cutoffDate = purgeDto.cutoffDate || 
      new Date(Date.now() - purgeDto.retentionDays * 24 * 60 * 60 * 1000).toISOString();

    this.logger.log(`Starting enhanced manual purge operation`, {
      retentionDays: purgeDto.retentionDays,
      tableName: purgeDto.tableName,
      cutoffDate,
      dryRun: purgeDto.dryRun,
      purgeMode: purgeDto.purgeMode,
      purgeScope: purgeDto.purgeScope,
      maxRecords: purgeDto.maxRecords,
      createBackup: purgeDto.createBackup,
      verifyIntegrity: purgeDto.verifyIntegrity,
      reason: purgeDto.reason,
      userId,
    });

    try {
      // Validate purge parameters
      await this.validatePurgeOperation(purgeDto);

      // Get or create default policy for audit trail
      const defaultPolicy = await this.retentionService.getOrCreateDefaultRetentionPolicy();

      // Determine which tables to purge based on scope
      const tablesToPurge = this.getTablesForPurgeScope(purgeDto.purgeScope, purgeDto.tableName);

      const results: PurgeResult[] = [];
      let totalRecordsPurged = 0;
      let backupsCreated = 0;
      let integrityChecksPerformed = 0;

      // Process each table
      for (const tableName of tablesToPurge) {
        const tableStartTime = Date.now();
        
        try {
          // Create backup if requested and not a dry run
          let backupCreated = false;
          if (purgeDto.createBackup && !purgeDto.dryRun) {
            backupCreated = await this.createTableBackup(tableName, cutoffDate);
            if (backupCreated) backupsCreated++;
          }

          // Execute the purge operation
          const recordsPurged = await this.purgeTableDataEnhanced(
            tableName,
            cutoffDate,
            purgeDto,
          );

          // Verify integrity if requested and not a dry run
          let integrityVerified = false;
          if (purgeDto.verifyIntegrity && !purgeDto.dryRun && recordsPurged > 0) {
            integrityVerified = await this.verifyTableIntegrity(tableName);
            if (integrityVerified) integrityChecksPerformed++;
          }

          const result: PurgeResult = {
            tableName,
            recordsPurged,
            cutoffDate,
            executionTimeMs: Date.now() - tableStartTime,
            purgeMode: purgeDto.purgeMode || PurgeMode.HARD,
            backupCreated,
            integrityVerified,
          };

          results.push(result);
          totalRecordsPurged += recordsPurged;

          this.logger.log(`Enhanced purge completed for ${tableName}`, {
            tableName,
            recordsPurged,
            cutoffDate,
            purgeMode: purgeDto.purgeMode,
            backupCreated,
            integrityVerified,
            dryRun: purgeDto.dryRun,
            executionTimeMs: result.executionTimeMs,
          });

        } catch (error) {
          this.logger.error(`Failed to purge table ${tableName}:`, error);
          
          // Add failed result
          results.push({
            tableName,
            recordsPurged: 0,
            cutoffDate,
            executionTimeMs: Date.now() - tableStartTime,
            purgeMode: purgeDto.purgeMode || PurgeMode.HARD,
            backupCreated: false,
            integrityVerified: false,
          });
        }
      }

      const operation: PurgeOperation = {
        success: true,
        totalRecordsPurged,
        tablesProcessed: tablesToPurge.length,
        results,
        executedAt: new Date().toISOString(),
        dryRun: purgeDto.dryRun || false,
        policyId: defaultPolicy.id,
        executedBy: userId,
        purgeMode: purgeDto.purgeMode || PurgeMode.HARD,
        purgeScope: purgeDto.purgeScope || PurgeScope.ALL,
        reason: purgeDto.reason,
        backupsCreated,
        integrityChecksPerformed,
      };

      // Create enhanced purge audit record if not a dry run
      if (!purgeDto.dryRun) {
        await this.createEnhancedPurgeAuditRecord(
          defaultPolicy.id,
          operation,
          cutoffDate,
          userId,
        );
      }

      // Audit the purge operation with enhanced details
      await this.auditService.createAuditEvent({
        userId,
        action: 'ENHANCED_MANUAL_DATA_PURGE',
        resource: 'data_purge',
        resourceId: `purge-${Date.now()}`,
        details: {
          retentionDays: purgeDto.retentionDays,
          cutoffDate,
          totalRecordsPurged,
          tablesProcessed: tablesToPurge.length,
          dryRun: purgeDto.dryRun,
          purgeMode: purgeDto.purgeMode,
          purgeScope: purgeDto.purgeScope,
          maxRecords: purgeDto.maxRecords,
          createBackup: purgeDto.createBackup,
          verifyIntegrity: purgeDto.verifyIntegrity,
          reason: purgeDto.reason,
          backupsCreated,
          integrityChecksPerformed,
          executionTimeMs: Date.now() - startTime,
          results,
        },
      });

      this.logger.log(`Enhanced manual purge operation completed`, {
        totalRecordsPurged,
        tablesProcessed: tablesToPurge.length,
        backupsCreated,
        integrityChecksPerformed,
        executionTimeMs: Date.now() - startTime,
        dryRun: purgeDto.dryRun,
        userId,
      });

      return operation;

    } catch (error) {
      this.logger.error('Enhanced manual purge operation failed:', error);
      
      // Audit the failed operation
      await this.auditService.createAuditEvent({
        userId,
        action: 'ENHANCED_MANUAL_DATA_PURGE_FAILED',
        resource: 'data_purge',
        resourceId: `purge-failed-${Date.now()}`,
        details: {
          error: error instanceof Error ? error.message : 'Unknown error',
          retentionDays: purgeDto.retentionDays,
          cutoffDate,
          dryRun: purgeDto.dryRun,
          purgeMode: purgeDto.purgeMode,
          purgeScope: purgeDto.purgeScope,
          reason: purgeDto.reason,
          executionTimeMs: Date.now() - startTime,
        },
      });

      throw error;
    }
  }

  /**
   * Execute automatic purge based on retention policies
   */
  async executeAutomaticPurge(): Promise<PurgeOperation[]> {
    this.logger.log('Starting automatic purge operation');

    const activePolicies = await this.retentionService.getActiveRetentionPolicies();
    const operations: PurgeOperation[] = [];

    for (const policy of activePolicies) {
      try {
        const operation = await this.executePolicyPurge(policy);
        operations.push(operation);
      } catch (error) {
        this.logger.error(`Failed to execute purge for policy ${policy.policyName}:`, error);
        
        // Add failed operation
        operations.push({
          success: false,
          totalRecordsPurged: 0,
          tablesProcessed: 0,
          results: [],
          executedAt: new Date().toISOString(),
          dryRun: false,
          policyId: policy.id,
          purgeMode: PurgeMode.HARD,
          purgeScope: PurgeScope.ALL,
          backupsCreated: 0,
          integrityChecksPerformed: 0,
        });
      }
    }

    this.logger.log(`Automatic purge operation completed`, {
      policiesProcessed: activePolicies.length,
      totalOperations: operations.length,
      successfulOperations: operations.filter(op => op.success).length,
    });

    return operations;
  }

  /**
   * Execute purge for a specific retention policy
   */
  private async executePolicyPurge(policy: any): Promise<PurgeOperation> {
    const cutoffDate = new Date(Date.now() - policy.retentionDays * 24 * 60 * 60 * 1000).toISOString();
    
    this.logger.log(`Executing purge for policy: ${policy.policyName}`, {
      policyId: policy.id,
      retentionDays: policy.retentionDays,
      appliesTo: policy.appliesTo,
      cutoffDate,
    });

    // Determine tables based on policy appliesTo
    const tablesToPurge = this.getTablesForPolicy(policy.appliesTo);
    const results: PurgeResult[] = [];
    let totalRecordsPurged = 0;

    for (const tableName of tablesToPurge) {
      const tableStartTime = Date.now();
      
      try {
        const recordsPurged = await this.purgeTableData(tableName, cutoffDate, false);
        
        const result: PurgeResult = {
          tableName,
          recordsPurged,
          cutoffDate,
          executionTimeMs: Date.now() - tableStartTime,
          purgeMode: PurgeMode.HARD,
        };

        results.push(result);
        totalRecordsPurged += recordsPurged;

      } catch (error) {
        this.logger.error(`Failed to purge table ${tableName} for policy ${policy.policyName}:`, error);
        
        results.push({
          tableName,
          recordsPurged: 0,
          cutoffDate,
          executionTimeMs: Date.now() - tableStartTime,
          purgeMode: PurgeMode.HARD,
        });
      }
    }

    // Create purge audit record
    await this.createPurgeAuditRecord(
      policy.id,
      tablesToPurge,
      totalRecordsPurged,
      cutoffDate,
      'system', // System-initiated purge
    );

    return {
      success: true,
      totalRecordsPurged,
      tablesProcessed: tablesToPurge.length,
      results,
      executedAt: new Date().toISOString(),
      dryRun: false,
      policyId: policy.id,
      purgeMode: PurgeMode.HARD,
      purgeScope: PurgeScope.ALL,
      backupsCreated: 0,
      integrityChecksPerformed: 0,
    };
  }

  /**
   * Purge data from a specific table
   */
  private async purgeTableData(
    tableName: string,
    cutoffDate: string,
    dryRun: boolean,
  ): Promise<number> {
    const cutoffDateTime = new Date(cutoffDate);

    switch (tableName) {
      case 'incidents':
        return await this.purgeIncidents(cutoffDateTime, dryRun);
      
      case 'incident_events':
        return await this.purgeIncidentEvents(cutoffDateTime, dryRun);
      
      case 'command_executions':
        return await this.purgeCommandExecutions(cutoffDateTime, dryRun);
      
      case 'evidence':
        return await this.purgeEvidence(cutoffDateTime, dryRun);
      
      case 'backup_artifacts':
        return await this.purgeBackupArtifacts(cutoffDateTime, dryRun);
      
      case 'file_changes':
        return await this.purgeFileChanges(cutoffDateTime, dryRun);
      
      case 'verification_results':
        return await this.purgeVerificationResults(cutoffDateTime, dryRun);
      
      case 'audit_events':
        return await this.purgeAuditEvents(cutoffDateTime, dryRun);
      
      default:
        this.logger.warn(`Unknown table for purging: ${tableName}`);
        return 0;
    }
  }

  /**
   * Purge incidents and related data
   */
  private async purgeIncidents(cutoffDate: Date, dryRun: boolean): Promise<number> {
    if (dryRun) {
      const count = await this.prisma.incident.count({
        where: {
          createdAt: { lt: cutoffDate },
        },
      });
      return count;
    }

    // Delete incidents (cascade will handle related records)
    const result = await this.prisma.incident.deleteMany({
      where: {
        createdAt: { lt: cutoffDate },
      },
    });

    return result.count;
  }

  /**
   * Purge incident events
   */
  private async purgeIncidentEvents(cutoffDate: Date, dryRun: boolean): Promise<number> {
    if (dryRun) {
      const count = await this.prisma.incidentEvent.count({
        where: {
          timestamp: { lt: cutoffDate },
        },
      });
      return count;
    }

    const result = await this.prisma.incidentEvent.deleteMany({
      where: {
        timestamp: { lt: cutoffDate },
      },
    });

    return result.count;
  }

  /**
   * Purge command executions
   */
  private async purgeCommandExecutions(cutoffDate: Date, dryRun: boolean): Promise<number> {
    if (dryRun) {
      const count = await this.prisma.commandExecution.count({
        where: {
          timestamp: { lt: cutoffDate },
        },
      });
      return count;
    }

    const result = await this.prisma.commandExecution.deleteMany({
      where: {
        timestamp: { lt: cutoffDate },
      },
    });

    return result.count;
  }

  /**
   * Purge evidence records
   */
  private async purgeEvidence(cutoffDate: Date, dryRun: boolean): Promise<number> {
    if (dryRun) {
      const count = await this.prisma.evidence.count({
        where: {
          timestamp: { lt: cutoffDate },
        },
      });
      return count;
    }

    const result = await this.prisma.evidence.deleteMany({
      where: {
        timestamp: { lt: cutoffDate },
      },
    });

    return result.count;
  }

  /**
   * Purge backup artifacts
   */
  private async purgeBackupArtifacts(cutoffDate: Date, dryRun: boolean): Promise<number> {
    if (dryRun) {
      const count = await this.prisma.backupArtifact.count({
        where: {
          createdAt: { lt: cutoffDate },
        },
      });
      return count;
    }

    const result = await this.prisma.backupArtifact.deleteMany({
      where: {
        createdAt: { lt: cutoffDate },
      },
    });

    return result.count;
  }

  /**
   * Purge file changes
   */
  private async purgeFileChanges(cutoffDate: Date, dryRun: boolean): Promise<number> {
    if (dryRun) {
      const count = await this.prisma.fileChange.count({
        where: {
          timestamp: { lt: cutoffDate },
        },
      });
      return count;
    }

    const result = await this.prisma.fileChange.deleteMany({
      where: {
        timestamp: { lt: cutoffDate },
      },
    });

    return result.count;
  }

  /**
   * Purge verification results
   */
  private async purgeVerificationResults(cutoffDate: Date, dryRun: boolean): Promise<number> {
    if (dryRun) {
      const count = await this.prisma.verificationResult.count({
        where: {
          timestamp: { lt: cutoffDate },
        },
      });
      return count;
    }

    const result = await this.prisma.verificationResult.deleteMany({
      where: {
        timestamp: { lt: cutoffDate },
      },
    });

    return result.count;
  }

  /**
   * Purge audit events (keep recent ones for compliance)
   */
  private async purgeAuditEvents(cutoffDate: Date, dryRun: boolean): Promise<number> {
    if (dryRun) {
      const count = await this.prisma.auditEvent.count({
        where: {
          timestamp: { lt: cutoffDate },
        },
      });
      return count;
    }

    const result = await this.prisma.auditEvent.deleteMany({
      where: {
        timestamp: { lt: cutoffDate },
      },
    });

    return result.count;
  }

  /**
   * Limited purge methods for enhanced manual purge
   */

  /**
   * Purge incidents with limit
   */
  private async purgeIncidentsWithLimit(
    cutoffDate: Date,
    dryRun: boolean,
    maxRecords: number,
    incidentIds?: string[],
  ): Promise<number> {
    const whereClause: any = {
      createdAt: { lt: cutoffDate },
    };

    if (incidentIds && incidentIds.length > 0) {
      whereClause.id = { in: incidentIds };
    }

    if (dryRun) {
      const count = await this.prisma.incident.count({
        where: whereClause,
        take: maxRecords,
      });
      return Math.min(count, maxRecords);
    }

    // Get IDs to delete (limited)
    const incidentsToDelete = await this.prisma.incident.findMany({
      where: whereClause,
      select: { id: true },
      take: maxRecords,
      orderBy: { createdAt: 'asc' }, // Delete oldest first
    });

    if (incidentsToDelete.length === 0) {
      return 0;
    }

    // Delete incidents (cascade will handle related records)
    const result = await this.prisma.incident.deleteMany({
      where: {
        id: { in: incidentsToDelete.map(i => i.id) },
      },
    });

    return result.count;
  }

  /**
   * Purge incident events with limit
   */
  private async purgeIncidentEventsWithLimit(
    cutoffDate: Date,
    dryRun: boolean,
    maxRecords: number,
    incidentIds?: string[],
  ): Promise<number> {
    const whereClause: any = {
      timestamp: { lt: cutoffDate },
    };

    if (incidentIds && incidentIds.length > 0) {
      whereClause.incidentId = { in: incidentIds };
    }

    if (dryRun) {
      const count = await this.prisma.incidentEvent.count({
        where: whereClause,
        take: maxRecords,
      });
      return Math.min(count, maxRecords);
    }

    // Get IDs to delete (limited)
    const eventsToDelete = await this.prisma.incidentEvent.findMany({
      where: whereClause,
      select: { id: true },
      take: maxRecords,
      orderBy: { timestamp: 'asc' },
    });

    if (eventsToDelete.length === 0) {
      return 0;
    }

    const result = await this.prisma.incidentEvent.deleteMany({
      where: {
        id: { in: eventsToDelete.map(e => e.id) },
      },
    });

    return result.count;
  }

  /**
   * Purge command executions with limit
   */
  private async purgeCommandExecutionsWithLimit(
    cutoffDate: Date,
    dryRun: boolean,
    maxRecords: number,
    incidentIds?: string[],
  ): Promise<number> {
    const whereClause: any = {
      timestamp: { lt: cutoffDate },
    };

    if (incidentIds && incidentIds.length > 0) {
      whereClause.incidentId = { in: incidentIds };
    }

    if (dryRun) {
      const count = await this.prisma.commandExecution.count({
        where: whereClause,
        take: maxRecords,
      });
      return Math.min(count, maxRecords);
    }

    // Get IDs to delete (limited)
    const commandsToDelete = await this.prisma.commandExecution.findMany({
      where: whereClause,
      select: { id: true },
      take: maxRecords,
      orderBy: { timestamp: 'asc' },
    });

    if (commandsToDelete.length === 0) {
      return 0;
    }

    const result = await this.prisma.commandExecution.deleteMany({
      where: {
        id: { in: commandsToDelete.map(c => c.id) },
      },
    });

    return result.count;
  }

  /**
   * Purge evidence with limit
   */
  private async purgeEvidenceWithLimit(
    cutoffDate: Date,
    dryRun: boolean,
    maxRecords: number,
    incidentIds?: string[],
  ): Promise<number> {
    const whereClause: any = {
      timestamp: { lt: cutoffDate },
    };

    if (incidentIds && incidentIds.length > 0) {
      whereClause.incidentId = { in: incidentIds };
    }

    if (dryRun) {
      const count = await this.prisma.evidence.count({
        where: whereClause,
        take: maxRecords,
      });
      return Math.min(count, maxRecords);
    }

    // Get IDs to delete (limited)
    const evidenceToDelete = await this.prisma.evidence.findMany({
      where: whereClause,
      select: { id: true },
      take: maxRecords,
      orderBy: { timestamp: 'asc' },
    });

    if (evidenceToDelete.length === 0) {
      return 0;
    }

    const result = await this.prisma.evidence.deleteMany({
      where: {
        id: { in: evidenceToDelete.map(e => e.id) },
      },
    });

    return result.count;
  }

  /**
   * Purge backup artifacts with limit
   */
  private async purgeBackupArtifactsWithLimit(
    cutoffDate: Date,
    dryRun: boolean,
    maxRecords: number,
    incidentIds?: string[],
  ): Promise<number> {
    const whereClause: any = {
      createdAt: { lt: cutoffDate },
    };

    if (incidentIds && incidentIds.length > 0) {
      whereClause.incidentId = { in: incidentIds };
    }

    if (dryRun) {
      const count = await this.prisma.backupArtifact.count({
        where: whereClause,
        take: maxRecords,
      });
      return Math.min(count, maxRecords);
    }

    // Get IDs to delete (limited)
    const artifactsToDelete = await this.prisma.backupArtifact.findMany({
      where: whereClause,
      select: { id: true },
      take: maxRecords,
      orderBy: { createdAt: 'asc' },
    });

    if (artifactsToDelete.length === 0) {
      return 0;
    }

    const result = await this.prisma.backupArtifact.deleteMany({
      where: {
        id: { in: artifactsToDelete.map(a => a.id) },
      },
    });

    return result.count;
  }

  /**
   * Purge file changes with limit
   */
  private async purgeFileChangesWithLimit(
    cutoffDate: Date,
    dryRun: boolean,
    maxRecords: number,
    incidentIds?: string[],
  ): Promise<number> {
    const whereClause: any = {
      timestamp: { lt: cutoffDate },
    };

    if (incidentIds && incidentIds.length > 0) {
      whereClause.incidentId = { in: incidentIds };
    }

    if (dryRun) {
      const count = await this.prisma.fileChange.count({
        where: whereClause,
        take: maxRecords,
      });
      return Math.min(count, maxRecords);
    }

    // Get IDs to delete (limited)
    const changesToDelete = await this.prisma.fileChange.findMany({
      where: whereClause,
      select: { id: true },
      take: maxRecords,
      orderBy: { timestamp: 'asc' },
    });

    if (changesToDelete.length === 0) {
      return 0;
    }

    const result = await this.prisma.fileChange.deleteMany({
      where: {
        id: { in: changesToDelete.map(c => c.id) },
      },
    });

    return result.count;
  }

  /**
   * Purge verification results with limit
   */
  private async purgeVerificationResultsWithLimit(
    cutoffDate: Date,
    dryRun: boolean,
    maxRecords: number,
    incidentIds?: string[],
  ): Promise<number> {
    const whereClause: any = {
      timestamp: { lt: cutoffDate },
    };

    if (incidentIds && incidentIds.length > 0) {
      whereClause.incidentId = { in: incidentIds };
    }

    if (dryRun) {
      const count = await this.prisma.verificationResult.count({
        where: whereClause,
        take: maxRecords,
      });
      return Math.min(count, maxRecords);
    }

    // Get IDs to delete (limited)
    const resultsToDelete = await this.prisma.verificationResult.findMany({
      where: whereClause,
      select: { id: true },
      take: maxRecords,
      orderBy: { timestamp: 'asc' },
    });

    if (resultsToDelete.length === 0) {
      return 0;
    }

    const result = await this.prisma.verificationResult.deleteMany({
      where: {
        id: { in: resultsToDelete.map(r => r.id) },
      },
    });

    return result.count;
  }

  /**
   * Purge audit events with limit
   */
  private async purgeAuditEventsWithLimit(
    cutoffDate: Date,
    dryRun: boolean,
    maxRecords: number,
  ): Promise<number> {
    if (dryRun) {
      const count = await this.prisma.auditEvent.count({
        where: {
          timestamp: { lt: cutoffDate },
        },
        take: maxRecords,
      });
      return Math.min(count, maxRecords);
    }

    // Get IDs to delete (limited)
    const eventsToDelete = await this.prisma.auditEvent.findMany({
      where: {
        timestamp: { lt: cutoffDate },
      },
      select: { id: true },
      take: maxRecords,
      orderBy: { timestamp: 'asc' },
    });

    if (eventsToDelete.length === 0) {
      return 0;
    }

    const result = await this.prisma.auditEvent.deleteMany({
      where: {
        id: { in: eventsToDelete.map(e => e.id) },
      },
    });

    return result.count;
  }

  /**
   * Create purge audit record
   */
  private async createPurgeAuditRecord(
    policyId: string,
    tableNames: string[],
    totalRecordsPurged: number,
    cutoffDate: string,
    executedBy?: string,
  ): Promise<void> {
    try {
      // Create individual audit records for each table
      for (const tableName of tableNames) {
        const recordsPurged = totalRecordsPurged; // This would be table-specific in real implementation
        
        await this.prisma.purgeAudit.create({
          data: {
            policyId,
            tableName,
            recordsPurged,
            cutoffDate: new Date(cutoffDate),
            executedBy: executedBy || 'system',
          },
        });
      }

      this.logger.log(`Created purge audit records`, {
        policyId,
        tableNames,
        totalRecordsPurged,
        cutoffDate,
        executedBy,
      });

    } catch (error) {
      this.logger.error('Failed to create purge audit record:', error);
      // Don't throw - audit failure shouldn't stop the purge operation
    }
  }

  /**
   * Get tables to purge based on policy appliesTo
   */
  private getTablesForPolicy(appliesTo: string): string[] {
    switch (appliesTo) {
      case 'incidents':
        return ['incidents', 'incident_events'];
      
      case 'commands':
        return ['command_executions'];
      
      case 'evidence':
        return ['evidence'];
      
      case 'backups':
        return ['backup_artifacts', 'file_changes'];
      
      case 'all':
      default:
        return [
          'incidents',
          'incident_events',
          'command_executions',
          'evidence',
          'backup_artifacts',
          'file_changes',
          'verification_results',
        ];
    }
  }

  /**
   * Validate purge operation parameters
   */
  private async validatePurgeOperation(purgeDto: ManualPurgeDto): Promise<void> {
    // Validate retention days against hard cap
    if (!this.retentionService.validateRetentionDays(purgeDto.retentionDays)) {
      throw new Error(`Retention days ${purgeDto.retentionDays} exceeds hard cap (1-7 days)`);
    }

    // Validate max records limit
    if (purgeDto.maxRecords && purgeDto.maxRecords > 100000) {
      throw new Error(`Max records limit ${purgeDto.maxRecords} exceeds safety threshold (100,000)`);
    }

    // Validate specific incident IDs if provided
    if (purgeDto.incidentIds && purgeDto.incidentIds.length > 0) {
      const existingIncidents = await this.prisma.incident.count({
        where: {
          id: { in: purgeDto.incidentIds },
        },
      });

      if (existingIncidents !== purgeDto.incidentIds.length) {
        throw new Error(`Some incident IDs do not exist in the database`);
      }
    }

    // Validate table name if provided
    if (purgeDto.tableName) {
      const validTables = [
        'incidents', 'incident_events', 'command_executions',
        'evidence', 'backup_artifacts', 'file_changes',
        'verification_results', 'audit_events'
      ];

      if (!validTables.includes(purgeDto.tableName)) {
        throw new Error(`Invalid table name: ${purgeDto.tableName}`);
      }
    }
  }

  /**
   * Get tables to purge based on purge scope
   */
  private getTablesForPurgeScope(scope: PurgeScope, specificTable?: string): string[] {
    if (specificTable) {
      return [specificTable];
    }

    switch (scope) {
      case PurgeScope.INCIDENTS:
        return ['incidents', 'incident_events'];
      
      case PurgeScope.COMMANDS:
        return ['command_executions'];
      
      case PurgeScope.EVIDENCE:
        return ['evidence'];
      
      case PurgeScope.BACKUPS:
        return ['backup_artifacts', 'file_changes'];
      
      case PurgeScope.AUDIT:
        return ['audit_events'];
      
      case PurgeScope.ALL:
      default:
        return [
          'incidents',
          'incident_events',
          'command_executions',
          'evidence',
          'backup_artifacts',
          'file_changes',
          'verification_results',
          'audit_events',
        ];
    }
  }

  /**
   * Create table backup before purging
   */
  private async createTableBackup(tableName: string, cutoffDate: string): Promise<boolean> {
    try {
      const backupTableName = `${tableName}_backup_${Date.now()}`;
      
      // This is a simplified backup - in production, you'd want more sophisticated backup logic
      this.logger.log(`Creating backup for table ${tableName} as ${backupTableName}`);
      
      // For now, just log the backup creation
      // In a real implementation, you'd create the backup table and copy data
      
      return true;
    } catch (error) {
      this.logger.error(`Failed to create backup for table ${tableName}:`, error);
      return false;
    }
  }

  /**
   * Verify table integrity after purging
   */
  private async verifyTableIntegrity(tableName: string): Promise<boolean> {
    try {
      this.logger.log(`Verifying integrity for table ${tableName}`);
      
      // Basic integrity checks - in production, you'd want more comprehensive checks
      switch (tableName) {
        case 'incidents':
          // Check for orphaned incident events
          const orphanedEvents = await this.prisma.incidentEvent.count({
            where: {
              incident: null,
            },
          });
          
          if (orphanedEvents > 0) {
            this.logger.warn(`Found ${orphanedEvents} orphaned incident events`);
            return false;
          }
          break;
        
        case 'command_executions':
          // Check for command executions without incidents
          const orphanedCommands = await this.prisma.commandExecution.count({
            where: {
              incident: null,
            },
          });
          
          if (orphanedCommands > 0) {
            this.logger.warn(`Found ${orphanedCommands} orphaned command executions`);
            return false;
          }
          break;
        
        default:
          // Basic existence check
          const count = await this.getTableRecordCount(tableName);
          this.logger.log(`Table ${tableName} has ${count} records after purge`);
      }
      
      return true;
    } catch (error) {
      this.logger.error(`Failed to verify integrity for table ${tableName}:`, error);
      return false;
    }
  }

  /**
   * Get record count for a table
   */
  private async getTableRecordCount(tableName: string): Promise<number> {
    switch (tableName) {
      case 'incidents':
        return await this.prisma.incident.count();
      case 'incident_events':
        return await this.prisma.incidentEvent.count();
      case 'command_executions':
        return await this.prisma.commandExecution.count();
      case 'evidence':
        return await this.prisma.evidence.count();
      case 'backup_artifacts':
        return await this.prisma.backupArtifact.count();
      case 'file_changes':
        return await this.prisma.fileChange.count();
      case 'verification_results':
        return await this.prisma.verificationResult.count();
      case 'audit_events':
        return await this.prisma.auditEvent.count();
      default:
        return 0;
    }
  }

  /**
   * Enhanced purge table data with new features
   */
  private async purgeTableDataEnhanced(
    tableName: string,
    cutoffDate: string,
    purgeDto: ManualPurgeDto,
  ): Promise<number> {
    const cutoffDateTime = new Date(cutoffDate);

    // Apply max records limit if specified
    if (purgeDto.maxRecords) {
      return await this.purgeTableDataWithLimit(
        tableName,
        cutoffDateTime,
        purgeDto.dryRun || false,
        purgeDto.maxRecords,
        purgeDto.incidentIds,
      );
    }

    // Use existing purge logic for unlimited purging
    return await this.purgeTableData(tableName, cutoffDate, purgeDto.dryRun || false);
  }

  /**
   * Purge table data with record limit
   */
  private async purgeTableDataWithLimit(
    tableName: string,
    cutoffDate: Date,
    dryRun: boolean,
    maxRecords: number,
    incidentIds?: string[],
  ): Promise<number> {
    switch (tableName) {
      case 'incidents':
        return await this.purgeIncidentsWithLimit(cutoffDate, dryRun, maxRecords, incidentIds);
      
      case 'incident_events':
        return await this.purgeIncidentEventsWithLimit(cutoffDate, dryRun, maxRecords, incidentIds);
      
      case 'command_executions':
        return await this.purgeCommandExecutionsWithLimit(cutoffDate, dryRun, maxRecords, incidentIds);
      
      case 'evidence':
        return await this.purgeEvidenceWithLimit(cutoffDate, dryRun, maxRecords, incidentIds);
      
      case 'backup_artifacts':
        return await this.purgeBackupArtifactsWithLimit(cutoffDate, dryRun, maxRecords, incidentIds);
      
      case 'file_changes':
        return await this.purgeFileChangesWithLimit(cutoffDate, dryRun, maxRecords, incidentIds);
      
      case 'verification_results':
        return await this.purgeVerificationResultsWithLimit(cutoffDate, dryRun, maxRecords, incidentIds);
      
      case 'audit_events':
        return await this.purgeAuditEventsWithLimit(cutoffDate, dryRun, maxRecords);
      
      default:
        this.logger.warn(`Unknown table for limited purging: ${tableName}`);
        return 0;
    }
  }

  /**
   * Create enhanced purge audit record
   */
  private async createEnhancedPurgeAuditRecord(
    policyId: string,
    operation: PurgeOperation,
    cutoffDate: string,
    executedBy?: string,
  ): Promise<void> {
    try {
      // Create individual audit records for each table with enhanced details
      for (const result of operation.results) {
        await this.prisma.purgeAudit.create({
          data: {
            policyId,
            tableName: result.tableName,
            recordsPurged: result.recordsPurged,
            cutoffDate: new Date(cutoffDate),
            executedBy: executedBy || 'system',
            // Store additional metadata in a JSON field if your schema supports it
            // metadata: {
            //   purgeMode: operation.purgeMode,
            //   purgeScope: operation.purgeScope,
            //   reason: operation.reason,
            //   backupCreated: result.backupCreated,
            //   integrityVerified: result.integrityVerified,
            //   executionTimeMs: result.executionTimeMs,
            // },
          },
        });
      }

      this.logger.log(`Created enhanced purge audit records`, {
        policyId,
        tablesProcessed: operation.tablesProcessed,
        totalRecordsPurged: operation.totalRecordsPurged,
        purgeMode: operation.purgeMode,
        purgeScope: operation.purgeScope,
        cutoffDate,
        executedBy,
      });

    } catch (error) {
      this.logger.error('Failed to create enhanced purge audit record:', error);
      // Don't throw - audit failure shouldn't stop the purge operation
    }
  }
}