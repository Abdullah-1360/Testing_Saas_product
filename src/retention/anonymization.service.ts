import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { AuditService } from '@/audit/audit.service';

export interface AnonymizationResult {
  tableName: string;
  recordsAnonymized: number;
  fieldsAnonymized: string[];
  executionTimeMs: number;
}

export interface AnonymizationOperation {
  success: boolean;
  totalRecordsAnonymized: number;
  tablesProcessed: number;
  results: AnonymizationResult[];
  executedAt: string;
  dryRun: boolean;
  executedBy?: string;
}

export interface AnonymizationConfig {
  retentionDays: number;
  tableName?: string | undefined;
  dryRun?: boolean;
  anonymizePersonalData?: boolean;
  anonymizeCredentials?: boolean;
  anonymizeIpAddresses?: boolean;
}

@Injectable()
export class AnonymizationService {
  private readonly logger = new Logger(AnonymizationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Execute data anonymization for compliance
   */
  async executeAnonymization(
    config: AnonymizationConfig,
    userId?: string,
  ): Promise<AnonymizationOperation> {
    const startTime = Date.now();
    const cutoffDate = new Date(Date.now() - config.retentionDays * 24 * 60 * 60 * 1000);

    this.logger.log(`Starting data anonymization operation`, {
      retentionDays: config.retentionDays,
      tableName: config.tableName,
      cutoffDate: cutoffDate.toISOString(),
      dryRun: config.dryRun,
      userId,
    });

    try {
      // Determine which tables to anonymize
      const tablesToAnonymize = config.tableName ? [config.tableName] : [
        'audit_events',
        'command_executions',
        'evidence',
        'user_sessions',
        'servers',
      ];

      const results: AnonymizationResult[] = [];
      let totalRecordsAnonymized = 0;

      // Process each table
      for (const tableName of tablesToAnonymize) {
        const tableStartTime = Date.now();
        
        try {
          const recordsAnonymized = await this.anonymizeTableData(
            tableName,
            cutoffDate,
            config,
          );

          const fieldsAnonymized = this.getAnonymizedFields(tableName, config);

          const result: AnonymizationResult = {
            tableName,
            recordsAnonymized,
            fieldsAnonymized,
            executionTimeMs: Date.now() - tableStartTime,
          };

          results.push(result);
          totalRecordsAnonymized += recordsAnonymized;

          this.logger.log(`Anonymized ${recordsAnonymized} records in ${tableName}`, {
            tableName,
            recordsAnonymized,
            fieldsAnonymized,
            dryRun: config.dryRun,
            executionTimeMs: result.executionTimeMs,
          });

        } catch (error) {
          this.logger.error(`Failed to anonymize table ${tableName}:`, error);
          
          // Add failed result
          results.push({
            tableName,
            recordsAnonymized: 0,
            fieldsAnonymized: [],
            executionTimeMs: Date.now() - tableStartTime,
          });
        }
      }

      const operation: AnonymizationOperation = {
        success: true,
        totalRecordsAnonymized,
        tablesProcessed: tablesToAnonymize.length,
        results,
        executedAt: new Date().toISOString(),
        dryRun: config.dryRun || false,
        executedBy: userId || 'system',
      };

      // Audit the anonymization operation
      await this.auditService.createAuditEvent({
        userId,
        action: 'DATA_ANONYMIZATION',
        resource: 'data_anonymization',
        resourceId: `anonymization-${Date.now()}`,
        details: {
          retentionDays: config.retentionDays,
          cutoffDate: cutoffDate.toISOString(),
          totalRecordsAnonymized,
          tablesProcessed: tablesToAnonymize.length,
          dryRun: config.dryRun,
          executionTimeMs: Date.now() - startTime,
          results,
          config: {
            anonymizePersonalData: config.anonymizePersonalData,
            anonymizeCredentials: config.anonymizeCredentials,
            anonymizeIpAddresses: config.anonymizeIpAddresses,
          },
        },
      });

      this.logger.log(`Data anonymization operation completed`, {
        totalRecordsAnonymized,
        tablesProcessed: tablesToAnonymize.length,
        executionTimeMs: Date.now() - startTime,
        dryRun: config.dryRun,
        userId,
      });

      return operation;

    } catch (error) {
      this.logger.error('Data anonymization operation failed:', error);
      
      // Audit the failed operation
      await this.auditService.createAuditEvent({
        userId,
        action: 'DATA_ANONYMIZATION_FAILED',
        resource: 'data_anonymization',
        resourceId: `anonymization-failed-${Date.now()}`,
        details: {
          error: error instanceof Error ? error.message : 'Unknown error',
          retentionDays: config.retentionDays,
          cutoffDate: cutoffDate.toISOString(),
          dryRun: config.dryRun,
          executionTimeMs: Date.now() - startTime,
        },
      });

      throw error;
    }
  }

  /**
   * Anonymize data in a specific table
   */
  private async anonymizeTableData(
    tableName: string,
    cutoffDate: Date,
    config: AnonymizationConfig,
  ): Promise<number> {
    if (config.dryRun) {
      // For dry run, just count records that would be anonymized
      return await this.countRecordsToAnonymize(tableName, cutoffDate);
    }

    switch (tableName) {
      case 'audit_events':
        return await this.anonymizeAuditEvents(cutoffDate, config);
      
      case 'command_executions':
        return await this.anonymizeCommandExecutions(cutoffDate, config);
      
      case 'evidence':
        return await this.anonymizeEvidence(cutoffDate, config);
      
      case 'user_sessions':
        return await this.anonymizeUserSessions(cutoffDate, config);
      
      case 'servers':
        return await this.anonymizeServers(cutoffDate, config);
      
      default:
        this.logger.warn(`Unknown table for anonymization: ${tableName}`);
        return 0;
    }
  }

  /**
   * Count records that would be anonymized (for dry run)
   */
  private async countRecordsToAnonymize(tableName: string, cutoffDate: Date): Promise<number> {
    switch (tableName) {
      case 'audit_events':
        return await this.prisma.auditEvent.count({
          where: {
            timestamp: { lt: cutoffDate },
            OR: [
              { ipAddress: { not: { equals: null } } },
              { userAgent: { not: { equals: null } } },
              { metadata: { not: { equals: null } } },
            ],
          },
        });
      
      case 'command_executions':
        return await this.prisma.commandExecution.count({
          where: {
            timestamp: { lt: cutoffDate },
            OR: [
              { stdout: { contains: 'password' } },
              { stderr: { contains: 'password' } },
              { command: { contains: 'password' } },
            ],
          },
        });
      
      case 'evidence':
        return await this.prisma.evidence.count({
          where: {
            timestamp: { lt: cutoffDate },
            content: { not: '' },
          },
        });
      
      case 'user_sessions':
        return await this.prisma.userSession.count({
          where: {
            createdAt: { lt: cutoffDate },
          },
        });
      
      case 'servers':
        return await this.prisma.server.count({
          where: {
            updatedAt: { lt: cutoffDate },
            encryptedCredentials: { not: '' },
          },
        });
      
      default:
        return 0;
    }
  }

  /**
   * Anonymize audit events
   */
  private async anonymizeAuditEvents(cutoffDate: Date, config: AnonymizationConfig): Promise<number> {
    const records = await this.prisma.auditEvent.findMany({
      where: {
        timestamp: { lt: cutoffDate },
        OR: [
          { ipAddress: { not: { equals: null } } },
          { userAgent: { not: { equals: null } } },
          { metadata: { not: { equals: null } } },
        ],
      },
      select: { id: true },
    });

    if (records.length === 0) {
      return 0;
    }

    const updateData: any = {};

    if (config.anonymizeIpAddresses !== false) {
      updateData.ipAddress = '0.0.0.0';
    }

    if (config.anonymizePersonalData !== false) {
      updateData.userAgent = '[ANONYMIZED]';
      updateData.details = { anonymized: true, originalDataRemoved: true };
    }

    const result = await this.prisma.auditEvent.updateMany({
      where: {
        id: { in: records.map(r => r.id) },
      },
      data: updateData,
    });

    return result.count;
  }

  /**
   * Anonymize command executions
   */
  private async anonymizeCommandExecutions(cutoffDate: Date, config: AnonymizationConfig): Promise<number> {
    const records = await this.prisma.commandExecution.findMany({
      where: {
        timestamp: { lt: cutoffDate },
        OR: [
          { stdout: { contains: 'password' } },
          { stderr: { contains: 'password' } },
          { command: { contains: 'password' } },
        ],
      },
      select: { id: true, command: true, stdout: true, stderr: true },
    });

    if (records.length === 0) {
      return 0;
    }

    let updatedCount = 0;

    for (const record of records) {
      const updateData: any = {};

      if (config.anonymizeCredentials !== false) {
        updateData.command = this.anonymizeCredentialsInText(record.command);
        updateData.stdout = this.anonymizeCredentialsInText(record.stdout || '');
        updateData.stderr = this.anonymizeCredentialsInText(record.stderr || '');
      }

      await this.prisma.commandExecution.update({
        where: { id: record.id },
        data: updateData,
      });

      updatedCount++;
    }

    return updatedCount;
  }

  /**
   * Anonymize evidence records
   */
  private async anonymizeEvidence(cutoffDate: Date, config: AnonymizationConfig): Promise<number> {
    const records = await this.prisma.evidence.findMany({
      where: {
        timestamp: { lt: cutoffDate },
        content: { not: '' },
      },
      select: { id: true, content: true },
    });

    if (records.length === 0) {
      return 0;
    }

    let updatedCount = 0;

    for (const record of records) {
      const updateData: any = {};

      if (config.anonymizePersonalData !== false) {
        updateData.content = this.anonymizePersonalDataInText(record.content);
      }

      if (config.anonymizeCredentials !== false) {
        updateData.content = this.anonymizeCredentialsInText(updateData.content || record.content);
      }

      await this.prisma.evidence.update({
        where: { id: record.id },
        data: updateData,
      });

      updatedCount++;
    }

    return updatedCount;
  }

  /**
   * Anonymize user sessions
   */
  private async anonymizeUserSessions(cutoffDate: Date, _config: AnonymizationConfig): Promise<number> {
    // For expired sessions, we can safely remove the session token
    const result = await this.prisma.userSession.updateMany({
      where: {
        createdAt: { lt: cutoffDate },
      },
      data: {
        accessTokenHash: '[ANONYMIZED-EXPIRED-SESSION]',
        refreshTokenHash: '[ANONYMIZED-EXPIRED-SESSION]',
      },
    });

    return result.count;
  }

  /**
   * Anonymize server credentials (for very old records)
   */
  private async anonymizeServers(cutoffDate: Date, config: AnonymizationConfig): Promise<number> {
    if (config.anonymizeCredentials === false) {
      return 0;
    }

    // Only anonymize servers that haven't been updated in a very long time
    // This is a safety measure - we don't want to break active server connections
    const veryOldCutoff = new Date(cutoffDate.getTime() - (30 * 24 * 60 * 60 * 1000)); // 30 days before cutoff

    const result = await this.prisma.server.updateMany({
      where: {
        updatedAt: { lt: veryOldCutoff },
        encryptedCredentials: { not: '' },
      },
      data: {
        encryptedCredentials: '[ANONYMIZED-OLD-CREDENTIALS]',
      },
    });

    return result.count;
  }

  /**
   * Anonymize credentials in text content
   */
  private anonymizeCredentialsInText(text: string): string {
    if (!text) return text;

    return text
      // Anonymize password patterns
      .replace(/password[=:]\s*\S+/gi, 'password=***')
      .replace(/passwd[=:]\s*\S+/gi, 'passwd=***')
      .replace(/pwd[=:]\s*\S+/gi, 'pwd=***')
      .replace(/-p\S+/gi, '-p***') // Handle -ppassword format
      // Anonymize key patterns
      .replace(/key[=:]\s*\S+/gi, 'key=***')
      .replace(/apikey[=:]\s*\S+/gi, 'apikey=***')
      .replace(/api_key[=:]\s*\S+/gi, 'api_key=***')
      // Anonymize token patterns
      .replace(/token[=:]\s*\S+/gi, 'token=***')
      .replace(/bearer\s+\S+/gi, 'bearer ***')
      // Anonymize secret patterns
      .replace(/secret[=:]\s*\S+/gi, 'secret=***')
      .replace(/client_secret[=:]\s*\S+/gi, 'client_secret=***')
      // Anonymize database connection strings
      .replace(/mysql:\/\/[^@]+@/gi, 'mysql://***:***@')
      .replace(/postgresql:\/\/[^@]+@/gi, 'postgresql://***:***@')
      .replace(/mongodb:\/\/[^@]+@/gi, 'mongodb://***:***@');
  }

  /**
   * Anonymize personal data in text content
   */
  private anonymizePersonalDataInText(text: string): string {
    if (!text) return text;

    return text
      // Anonymize email addresses
      .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '***@***.***')
      // Anonymize IP addresses (but keep format for debugging)
      .replace(/\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/g, 'XXX.XXX.XXX.XXX')
      // Anonymize phone numbers (basic patterns)
      .replace(/\b\d{3}-\d{3}-\d{4}\b/g, 'XXX-XXX-XXXX')
      .replace(/\(\d{3}\)\s*\d{3}-\d{4}/g, '(XXX) XXX-XXXX')
      // Anonymize potential usernames in paths
      .replace(/\/home\/[^\/\s]+/g, '/home/***')
      .replace(/\/users\/[^\/\s]+/g, '/users/***');
  }

  /**
   * Get list of fields that would be anonymized for a table
   */
  private getAnonymizedFields(tableName: string, config: AnonymizationConfig): string[] {
    const fields: string[] = [];

    switch (tableName) {
      case 'audit_events':
        if (config.anonymizeIpAddresses !== false) fields.push('ipAddress');
        if (config.anonymizePersonalData !== false) fields.push('userAgent', 'details');
        break;
      
      case 'command_executions':
        if (config.anonymizeCredentials !== false) fields.push('command', 'stdout', 'stderr');
        break;
      
      case 'evidence':
        if (config.anonymizePersonalData !== false) fields.push('content');
        if (config.anonymizeCredentials !== false) fields.push('content');
        break;
      
      case 'user_sessions':
        fields.push('sessionToken');
        break;
      
      case 'servers':
        if (config.anonymizeCredentials !== false) fields.push('encryptedCredentials');
        break;
    }

    return fields;
  }

  /**
   * Get anonymization statistics
   */
  async getAnonymizationStatistics(): Promise<{
    totalRecordsWithPersonalData: number;
    totalRecordsWithCredentials: number;
    lastAnonymizationDate: Date | null;
    tablesWithSensitiveData: string[];
  }> {
    const cutoffDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // Last 7 days

    const [
      auditEventsWithPersonalData,
      commandsWithCredentials,
      evidenceWithData,
      lastAnonymization,
    ] = await Promise.all([
      this.prisma.auditEvent.count({
        where: {
          timestamp: { gte: cutoffDate },
          OR: [
            { ipAddress: { not: '0.0.0.0' } },
            { userAgent: { not: '[ANONYMIZED]' } },
          ],
        },
      }),
      this.prisma.commandExecution.count({
        where: {
          timestamp: { gte: cutoffDate },
          OR: [
            { stdout: { contains: 'password' } },
            { stderr: { contains: 'password' } },
            { command: { contains: 'password' } },
          ],
        },
      }),
      this.prisma.evidence.count({
        where: {
          timestamp: { gte: cutoffDate },
          content: { not: '' },
        },
      }),
      this.prisma.auditEvent.findFirst({
        where: {
          action: 'DATA_ANONYMIZATION',
        },
        orderBy: { timestamp: 'desc' },
        select: { timestamp: true },
      }),
    ]);

    return {
      totalRecordsWithPersonalData: auditEventsWithPersonalData + evidenceWithData,
      totalRecordsWithCredentials: commandsWithCredentials,
      lastAnonymizationDate: lastAnonymization?.timestamp || null,
      tablesWithSensitiveData: ['audit_events', 'command_executions', 'evidence', 'user_sessions', 'servers'],
    };
  }
}