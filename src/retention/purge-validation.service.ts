import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { RetentionService } from './retention.service';
import { ManualPurgeDto, PurgeScope, PurgeMode } from './dto';

export interface PurgeValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  recommendations: string[];
  estimatedImpact: {
    recordsToDelete: number;
    tablesAffected: string[];
    estimatedExecutionTime: number;
    diskSpaceToFree: number;
  };
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  requiresConfirmation: boolean;
}

export interface TableImpactAnalysis {
  tableName: string;
  currentRecords: number;
  recordsToDelete: number;
  percentageToDelete: number;
  oldestRecord?: Date;
  newestRecord?: Date;
  estimatedSizeBytes: number;
  hasReferences: boolean;
  referenceCount: number;
}

@Injectable()
export class PurgeValidationService {
  private readonly logger = new Logger(PurgeValidationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly retentionService: RetentionService,
  ) {}

  /**
   * Comprehensive validation of purge operation
   */
  async validatePurgeOperation(purgeDto: ManualPurgeDto): Promise<PurgeValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const recommendations: string[] = [];

    try {
      // Basic parameter validation
      const basicValidation = await this.validateBasicParameters(purgeDto);
      errors.push(...basicValidation.errors);
      warnings.push(...basicValidation.warnings);

      // Impact analysis
      const impactAnalysis = await this.analyzeImpact(purgeDto);
      
      // Risk assessment
      const riskLevel = this.assessRiskLevel(purgeDto, impactAnalysis);
      
      // Generate recommendations
      const recs = this.generateRecommendations(purgeDto, impactAnalysis, riskLevel);
      recommendations.push(...recs);

      // Determine if confirmation is required
      const requiresConfirmation = this.requiresConfirmation(riskLevel, impactAnalysis);

      const result: PurgeValidationResult = {
        isValid: errors.length === 0,
        errors,
        warnings,
        recommendations,
        estimatedImpact: {
          recordsToDelete: impactAnalysis.reduce((sum, t) => sum + t.recordsToDelete, 0),
          tablesAffected: impactAnalysis.map(t => t.tableName),
          estimatedExecutionTime: this.estimateExecutionTime(impactAnalysis),
          diskSpaceToFree: impactAnalysis.reduce((sum, t) => sum + t.estimatedSizeBytes, 0),
        },
        riskLevel,
        requiresConfirmation,
      };

      this.logger.debug('Purge validation completed', {
        isValid: result.isValid,
        riskLevel: result.riskLevel,
        recordsToDelete: result.estimatedImpact.recordsToDelete,
        tablesAffected: result.estimatedImpact.tablesAffected.length,
      });

      return result;

    } catch (error) {
      this.logger.error('Purge validation failed:', error);
      
      return {
        isValid: false,
        errors: [`Validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`],
        warnings: [],
        recommendations: [],
        estimatedImpact: {
          recordsToDelete: 0,
          tablesAffected: [],
          estimatedExecutionTime: 0,
          diskSpaceToFree: 0,
        },
        riskLevel: 'CRITICAL',
        requiresConfirmation: true,
      };
    }
  }

  /**
   * Validate basic parameters
   */
  private async validateBasicParameters(purgeDto: ManualPurgeDto): Promise<{
    errors: string[];
    warnings: string[];
  }> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate retention days
    if (!this.retentionService.validateRetentionDays(purgeDto.retentionDays)) {
      errors.push(`Retention days ${purgeDto.retentionDays} exceeds hard cap (1-7 days)`);
    }

    // Validate max records
    if (purgeDto.maxRecords && purgeDto.maxRecords > 100000) {
      errors.push(`Max records ${purgeDto.maxRecords} exceeds safety limit (100,000)`);
    }

    // Validate specific incident IDs
    if (purgeDto.incidentIds && purgeDto.incidentIds.length > 0) {
      const existingIncidents = await this.prisma.incident.count({
        where: { id: { in: purgeDto.incidentIds } },
      });

      if (existingIncidents !== purgeDto.incidentIds.length) {
        errors.push('Some specified incident IDs do not exist');
      }

      if (purgeDto.incidentIds.length > 1000) {
        warnings.push(`Large number of specific incidents (${purgeDto.incidentIds.length}) - consider batch processing`);
      }
    }

    // Validate table name
    if (purgeDto.tableName) {
      const validTables = [
        'incidents', 'incident_events', 'command_executions',
        'evidence', 'backup_artifacts', 'file_changes',
        'verification_results', 'audit_events'
      ];

      if (!validTables.includes(purgeDto.tableName)) {
        errors.push(`Invalid table name: ${purgeDto.tableName}`);
      }
    }

    // Validate cutoff date
    if (purgeDto.cutoffDate) {
      const cutoffDate = new Date(purgeDto.cutoffDate);
      const now = new Date();
      
      if (cutoffDate > now) {
        errors.push('Cutoff date cannot be in the future');
      }

      const daysDiff = Math.floor((now.getTime() - cutoffDate.getTime()) / (1000 * 60 * 60 * 24));
      if (daysDiff > 30) {
        warnings.push(`Cutoff date is ${daysDiff} days ago - this will purge a large amount of data`);
      }
    }

    // Validate purge mode and scope combination
    if (purgeDto.purgeMode === PurgeMode.SOFT && purgeDto.purgeScope === PurgeScope.AUDIT) {
      warnings.push('Soft delete mode with audit scope may not free up significant space');
    }

    // Safety warnings
    if (purgeDto.retentionDays === 1) {
      warnings.push('Very aggressive retention (1 day) - ensure this is intentional');
    }

    if (purgeDto.createBackup === false) {
      warnings.push('Backup creation disabled - data will be permanently lost');
    }

    if (purgeDto.verifyIntegrity === false) {
      warnings.push('Integrity verification disabled - potential corruption may go undetected');
    }

    return { errors, warnings };
  }

  /**
   * Analyze impact of purge operation
   */
  private async analyzeImpact(purgeDto: ManualPurgeDto): Promise<TableImpactAnalysis[]> {
    const cutoffDate = purgeDto.cutoffDate 
      ? new Date(purgeDto.cutoffDate)
      : new Date(Date.now() - purgeDto.retentionDays * 24 * 60 * 60 * 1000);

    const tablesToAnalyze = this.getTablesForAnalysis(purgeDto);
    const analyses: TableImpactAnalysis[] = [];

    for (const tableName of tablesToAnalyze) {
      try {
        const analysis = await this.analyzeTableImpact(tableName, cutoffDate, purgeDto);
        analyses.push(analysis);
      } catch (error) {
        this.logger.error(`Failed to analyze table ${tableName}:`, error);
        
        // Add placeholder analysis for failed table
        analyses.push({
          tableName,
          currentRecords: 0,
          recordsToDelete: 0,
          percentageToDelete: 0,
          estimatedSizeBytes: 0,
          hasReferences: false,
          referenceCount: 0,
        });
      }
    }

    return analyses;
  }

  /**
   * Analyze impact for a specific table
   */
  private async analyzeTableImpact(
    tableName: string,
    cutoffDate: Date,
    purgeDto: ManualPurgeDto,
  ): Promise<TableImpactAnalysis> {
    let currentRecords = 0;
    let recordsToDelete = 0;
    let oldestRecord: Date | undefined;
    let newestRecord: Date | undefined;

    switch (tableName) {
      case 'incidents':
        currentRecords = await this.prisma.incident.count();
        
        const incidentWhereClause: any = { createdAt: { lt: cutoffDate } };
        if (purgeDto.incidentIds?.length) {
          incidentWhereClause.id = { in: purgeDto.incidentIds };
        }

        recordsToDelete = await this.prisma.incident.count({ where: incidentWhereClause });
        
        const incidentDateRange = await this.prisma.incident.aggregate({
          _min: { createdAt: true },
          _max: { createdAt: true },
        });
        
        oldestRecord = incidentDateRange._min.createdAt || undefined;
        newestRecord = incidentDateRange._max.createdAt || undefined;
        break;

      case 'incident_events':
        currentRecords = await this.prisma.incidentEvent.count();
        
        const eventWhereClause: any = { timestamp: { lt: cutoffDate } };
        if (purgeDto.incidentIds?.length) {
          eventWhereClause.incidentId = { in: purgeDto.incidentIds };
        }

        recordsToDelete = await this.prisma.incidentEvent.count({ where: eventWhereClause });
        
        const eventDateRange = await this.prisma.incidentEvent.aggregate({
          _min: { timestamp: true },
          _max: { timestamp: true },
        });
        
        oldestRecord = eventDateRange._min.timestamp || undefined;
        newestRecord = eventDateRange._max.timestamp || undefined;
        break;

      case 'command_executions':
        currentRecords = await this.prisma.commandExecution.count();
        
        const commandWhereClause: any = { timestamp: { lt: cutoffDate } };
        if (purgeDto.incidentIds?.length) {
          commandWhereClause.incidentId = { in: purgeDto.incidentIds };
        }

        recordsToDelete = await this.prisma.commandExecution.count({ where: commandWhereClause });
        
        const commandDateRange = await this.prisma.commandExecution.aggregate({
          _min: { timestamp: true },
          _max: { timestamp: true },
        });
        
        oldestRecord = commandDateRange._min.timestamp || undefined;
        newestRecord = commandDateRange._max.timestamp || undefined;
        break;

      case 'evidence':
        currentRecords = await this.prisma.evidence.count();
        
        const evidenceWhereClause: any = { timestamp: { lt: cutoffDate } };
        if (purgeDto.incidentIds?.length) {
          evidenceWhereClause.incidentId = { in: purgeDto.incidentIds };
        }

        recordsToDelete = await this.prisma.evidence.count({ where: evidenceWhereClause });
        
        const evidenceDateRange = await this.prisma.evidence.aggregate({
          _min: { timestamp: true },
          _max: { timestamp: true },
        });
        
        oldestRecord = evidenceDateRange._min.timestamp || undefined;
        newestRecord = evidenceDateRange._max.timestamp || undefined;
        break;

      case 'backup_artifacts':
        currentRecords = await this.prisma.backupArtifact.count();
        
        const backupWhereClause: any = { createdAt: { lt: cutoffDate } };
        if (purgeDto.incidentIds?.length) {
          backupWhereClause.incidentId = { in: purgeDto.incidentIds };
        }

        recordsToDelete = await this.prisma.backupArtifact.count({ where: backupWhereClause });
        
        const backupDateRange = await this.prisma.backupArtifact.aggregate({
          _min: { createdAt: true },
          _max: { createdAt: true },
        });
        
        oldestRecord = backupDateRange._min.createdAt || undefined;
        newestRecord = backupDateRange._max.createdAt || undefined;
        break;

      case 'file_changes':
        currentRecords = await this.prisma.fileChange.count();
        
        const fileWhereClause: any = { timestamp: { lt: cutoffDate } };
        if (purgeDto.incidentIds?.length) {
          fileWhereClause.incidentId = { in: purgeDto.incidentIds };
        }

        recordsToDelete = await this.prisma.fileChange.count({ where: fileWhereClause });
        
        const fileDateRange = await this.prisma.fileChange.aggregate({
          _min: { timestamp: true },
          _max: { timestamp: true },
        });
        
        oldestRecord = fileDateRange._min.timestamp || undefined;
        newestRecord = fileDateRange._max.timestamp || undefined;
        break;

      case 'verification_results':
        currentRecords = await this.prisma.verificationResult.count();
        
        const verificationWhereClause: any = { timestamp: { lt: cutoffDate } };
        if (purgeDto.incidentIds?.length) {
          verificationWhereClause.incidentId = { in: purgeDto.incidentIds };
        }

        recordsToDelete = await this.prisma.verificationResult.count({ where: verificationWhereClause });
        
        const verificationDateRange = await this.prisma.verificationResult.aggregate({
          _min: { timestamp: true },
          _max: { timestamp: true },
        });
        
        oldestRecord = verificationDateRange._min.timestamp || undefined;
        newestRecord = verificationDateRange._max.timestamp || undefined;
        break;

      case 'audit_events':
        currentRecords = await this.prisma.auditEvent.count();
        recordsToDelete = await this.prisma.auditEvent.count({
          where: { timestamp: { lt: cutoffDate } },
        });
        
        const auditDateRange = await this.prisma.auditEvent.aggregate({
          _min: { timestamp: true },
          _max: { timestamp: true },
        });
        
        oldestRecord = auditDateRange._min.timestamp || undefined;
        newestRecord = auditDateRange._max.timestamp || undefined;
        break;

      default:
        // Unknown table
        break;
    }

    // Apply max records limit if specified
    if (purgeDto.maxRecords && recordsToDelete > purgeDto.maxRecords) {
      recordsToDelete = purgeDto.maxRecords;
    }

    const percentageToDelete = currentRecords > 0 ? (recordsToDelete / currentRecords) * 100 : 0;
    const estimatedSizeBytes = this.estimateTableSizeBytes(tableName, recordsToDelete);
    const hasReferences = this.tableHasReferences(tableName);
    const referenceCount = hasReferences ? await this.countTableReferences(tableName) : 0;

    return {
      tableName,
      currentRecords,
      recordsToDelete,
      percentageToDelete,
      oldestRecord,
      newestRecord,
      estimatedSizeBytes,
      hasReferences,
      referenceCount,
    };
  }

  /**
   * Assess risk level of purge operation
   */
  private assessRiskLevel(
    purgeDto: ManualPurgeDto,
    impactAnalysis: TableImpactAnalysis[],
  ): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
    const totalRecordsToDelete = impactAnalysis.reduce((sum, t) => sum + t.recordsToDelete, 0);
    const maxPercentageToDelete = Math.max(...impactAnalysis.map(t => t.percentageToDelete));
    const hasAuditData = impactAnalysis.some(t => t.tableName === 'audit_events' && t.recordsToDelete > 0);

    // Critical risk factors
    if (totalRecordsToDelete > 50000) return 'CRITICAL';
    if (maxPercentageToDelete > 80) return 'CRITICAL';
    if (purgeDto.createBackup === false && totalRecordsToDelete > 1000) return 'CRITICAL';
    if (purgeDto.retentionDays === 1 && totalRecordsToDelete > 10000) return 'CRITICAL';

    // High risk factors
    if (totalRecordsToDelete > 10000) return 'HIGH';
    if (maxPercentageToDelete > 50) return 'HIGH';
    if (hasAuditData && impactAnalysis.find(t => t.tableName === 'audit_events')!.recordsToDelete > 1000) return 'HIGH';
    if (purgeDto.verifyIntegrity === false && totalRecordsToDelete > 5000) return 'HIGH';

    // Medium risk factors
    if (totalRecordsToDelete > 1000) return 'MEDIUM';
    if (maxPercentageToDelete > 25) return 'MEDIUM';
    if (purgeDto.retentionDays <= 2) return 'MEDIUM';

    return 'LOW';
  }

  /**
   * Generate recommendations based on analysis
   */
  private generateRecommendations(
    purgeDto: ManualPurgeDto,
    impactAnalysis: TableImpactAnalysis[],
    riskLevel: string,
  ): string[] {
    const recommendations: string[] = [];
    const totalRecordsToDelete = impactAnalysis.reduce((sum, t) => sum + t.recordsToDelete, 0);

    // Backup recommendations
    if (purgeDto.createBackup === false && totalRecordsToDelete > 1000) {
      recommendations.push('Consider enabling backup creation for this large purge operation');
    }

    // Execution timing recommendations
    if (totalRecordsToDelete > 5000) {
      recommendations.push('Execute during off-peak hours to minimize system impact');
    }

    // Incremental processing recommendations
    if (totalRecordsToDelete > 25000) {
      recommendations.push('Consider breaking this into smaller, incremental purge operations');
    }

    // Testing recommendations
    if (riskLevel === 'HIGH' || riskLevel === 'CRITICAL') {
      recommendations.push('Test this purge operation in a staging environment first');
    }

    // Integrity verification recommendations
    if (purgeDto.verifyIntegrity === false && totalRecordsToDelete > 1000) {
      recommendations.push('Enable integrity verification to detect potential data corruption');
    }

    // Audit data recommendations
    const auditAnalysis = impactAnalysis.find(t => t.tableName === 'audit_events');
    if (auditAnalysis && auditAnalysis.recordsToDelete > 0) {
      recommendations.push(`${auditAnalysis.recordsToDelete} audit records will be deleted - ensure compliance requirements are met`);
    }

    // Performance recommendations
    const estimatedTime = this.estimateExecutionTime(impactAnalysis);
    if (estimatedTime > 300000) { // 5 minutes
      recommendations.push('This operation may take several minutes - consider running during maintenance window');
    }

    // Disk space recommendations
    const totalSizeBytes = impactAnalysis.reduce((sum, t) => sum + t.estimatedSizeBytes, 0);
    if (totalSizeBytes > 100 * 1024 * 1024) { // 100MB
      recommendations.push(`This will free approximately ${this.formatBytes(totalSizeBytes)} of disk space`);
    }

    return recommendations;
  }

  /**
   * Determine if operation requires confirmation
   */
  private requiresConfirmation(riskLevel: string, impactAnalysis: TableImpactAnalysis[]): boolean {
    if (riskLevel === 'HIGH' || riskLevel === 'CRITICAL') return true;
    
    const totalRecordsToDelete = impactAnalysis.reduce((sum, t) => sum + t.recordsToDelete, 0);
    if (totalRecordsToDelete > 5000) return true;

    const hasHighPercentage = impactAnalysis.some(t => t.percentageToDelete > 50);
    if (hasHighPercentage) return true;

    return false;
  }

  /**
   * Get tables to analyze based on purge configuration
   */
  private getTablesForAnalysis(purgeDto: ManualPurgeDto): string[] {
    if (purgeDto.tableName) {
      return [purgeDto.tableName];
    }

    switch (purgeDto.purgeScope) {
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
   * Estimate execution time based on records to delete
   */
  private estimateExecutionTime(impactAnalysis: TableImpactAnalysis[]): number {
    // Rough estimation: 100 records per second
    const totalRecords = impactAnalysis.reduce((sum, t) => sum + t.recordsToDelete, 0);
    return Math.max(totalRecords * 10, 1000); // Minimum 1 second
  }

  /**
   * Estimate table size in bytes
   */
  private estimateTableSizeBytes(tableName: string, recordCount: number): number {
    // Rough estimates based on typical record sizes
    const estimatedBytesPerRecord: Record<string, number> = {
      incidents: 500,
      incident_events: 1000,
      command_executions: 2000,
      evidence: 5000,
      backup_artifacts: 200,
      file_changes: 3000,
      verification_results: 800,
      audit_events: 1200,
    };

    return (estimatedBytesPerRecord[tableName] || 500) * recordCount;
  }

  /**
   * Check if table has foreign key references
   */
  private tableHasReferences(tableName: string): boolean {
    const tablesWithReferences = [
      'incidents', // Referenced by incident_events, command_executions, etc.
      'servers', // Referenced by incidents, sites
      'sites', // Referenced by incidents
      'users', // Referenced by audit_events, sessions
    ];

    return tablesWithReferences.includes(tableName);
  }

  /**
   * Count table references (simplified)
   */
  private async countTableReferences(tableName: string): Promise<number> {
    // This is a simplified implementation
    // In production, you'd query the actual foreign key relationships
    switch (tableName) {
      case 'incidents':
        const [events, commands, evidence, backups, files, verifications] = await Promise.all([
          this.prisma.incidentEvent.count(),
          this.prisma.commandExecution.count(),
          this.prisma.evidence.count(),
          this.prisma.backupArtifact.count(),
          this.prisma.fileChange.count(),
          this.prisma.verificationResult.count(),
        ]);
        return events + commands + evidence + backups + files + verifications;
      
      default:
        return 0;
    }
  }

  /**
   * Format bytes to human readable string
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}