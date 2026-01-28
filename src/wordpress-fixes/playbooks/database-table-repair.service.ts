import { Injectable } from '@nestjs/common';
import { BaseFixPlaybook } from '../base/base-fix-playbook';
import { 
  FixTier, 
  FixPriority, 
  FixContext, 
  FixResult, 
  FixEvidence, 
  RollbackPlan,
  FixChange,
  RollbackStep
} from '../interfaces/fix-playbook.interface';
import { SSHService } from '../../ssh/services/ssh.service';
import { BackupService } from '../../backup/services/backup.service';
import { EvidenceService } from '../../evidence/services/evidence.service';

@Injectable()
export class DatabaseTableRepairService extends BaseFixPlaybook {
  readonly name = 'database-table-repair';
  readonly tier = FixTier.TIER_2_CORE_INTEGRITY;
  readonly priority = FixPriority.HIGH;
  readonly description = 'Repair corrupted WordPress database tables and restore database integrity';
  readonly applicableConditions = [
    'database_table_corrupted',
    'table_crashed',
    'table_marked_as_crashed',
    'database_repair_needed',
    'mysql_table_error',
    'innodb_corruption',
    'wp_options_corrupted'
  ];

  constructor(
    sshService: SSHService,
    backupService: BackupService,
    evidenceService: EvidenceService,
  ) {
    super(sshService, backupService, evidenceService);
  }

  async canApply(context: FixContext, evidence: FixEvidence[]): Promise<boolean> {
    // Check if evidence indicates database table issues
    const dbTableEvidence = evidence.some(e => 
      e.content.toLowerCase().includes('table') && (
        e.content.toLowerCase().includes('crashed') ||
        e.content.toLowerCase().includes('corrupted') ||
        e.content.toLowerCase().includes('marked as crashed') ||
        e.content.toLowerCase().includes('repair') ||
        e.content.toLowerCase().includes('innodb') ||
        e.content.toLowerCase().includes('myisam')
      ) ||
      e.content.toLowerCase().includes('database error') ||
      e.content.toLowerCase().includes('mysql error') ||
      e.content.toLowerCase().includes('wp_options') && e.content.toLowerCase().includes('error')
    );

    if (dbTableEvidence) {
      return true;
    }

    // Check database connectivity and table status
    const dbCheck = await this.checkDatabaseHealth(context);
    return dbCheck.hasIssues;
  }

  async apply(context: FixContext): Promise<FixResult> {
    const changes: FixChange[] = [];
    const evidence: FixEvidence[] = [];
    const rollbackSteps: RollbackStep[] = [];

    try {
      this.logger.log(`Starting database table repair for incident ${context.incidentId}`);

      // 1. Get database connection info
      const dbInfo = await this.getDatabaseInfo(context);
      if (!dbInfo.success) {
        return {
          success: false,
          applied: false,
          changes,
          evidence,
          error: 'Could not extract database connection information',
        };
      }

      evidence.push(...dbInfo.evidence);

      // 2. Create database backup
      const backupResult = await this.createDatabaseBackup(context, dbInfo.config!);
      evidence.push(...backupResult.evidence);

      if (backupResult.backupPath) {
        rollbackSteps.push({
          type: 'execute_command',
          description: 'Restore database from backup',
          action: `mysql -h "${dbInfo.config!.host}" -u "${dbInfo.config!.user}" -p"${dbInfo.config!.password}" "${dbInfo.config!.database}" < "${backupResult.backupPath}"`,
          parameters: {
            backupPath: backupResult.backupPath,
            database: dbInfo.config!.database,
          },
          order: 0,
        });
      }

      // 3. Check table status
      const tableStatus = await this.checkTableStatus(context, dbInfo.config!);
      evidence.push(...tableStatus.evidence);

      if (tableStatus.corruptedTables.length === 0) {
        return {
          success: true,
          applied: false,
          changes,
          evidence,
          metadata: {
            databaseStatus: 'healthy',
            tablesChecked: tableStatus.totalTables,
          },
        };
      }

      // 4. Repair corrupted tables
      const repairResult = await this.repairCorruptedTables(context, dbInfo.config!, tableStatus.corruptedTables);
      changes.push(...repairResult.changes);
      evidence.push(...repairResult.evidence);

      // 5. Optimize repaired tables
      const optimizeResult = await this.optimizeTables(context, dbInfo.config!, tableStatus.corruptedTables);
      changes.push(...optimizeResult.changes);
      evidence.push(...optimizeResult.evidence);

      // 6. Verify table integrity after repair
      const verificationResult = await this.verifyTableIntegrity(context, dbInfo.config!);
      evidence.push(...verificationResult.evidence);

      // 7. Update WordPress options if needed
      const optionsResult = await this.repairWordPressOptions(context, dbInfo.config!);
      if (optionsResult.applied) {
        changes.push(...optionsResult.changes);
        evidence.push(...optionsResult.evidence);
      }

      const success = repairResult.repairedCount > 0 && verificationResult.success;

      return {
        success,
        applied: changes.length > 0,
        changes,
        evidence,
        rollbackPlan: rollbackSteps.length > 0 ? {
          steps: rollbackSteps,
          metadata: {
            backupPath: backupResult.backupPath,
            repairedTables: repairResult.repairedCount,
            originalCorruptedTables: tableStatus.corruptedTables.length,
          },
          createdAt: new Date(),
        } : undefined,
        metadata: {
          databaseBackupCreated: !!backupResult.backupPath,
          tablesChecked: tableStatus.totalTables,
          corruptedTablesFound: tableStatus.corruptedTables.length,
          tablesRepaired: repairResult.repairedCount,
          tablesOptimized: optimizeResult.optimizedCount,
          verificationPassed: verificationResult.success,
          optionsRepaired: optionsResult.applied,
        },
      };

    } catch (error) {
      this.logger.error(`Database table repair failed for incident ${context.incidentId}:`, error);
      
      return {
        success: false,
        applied: false,
        changes,
        evidence,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async rollback(context: FixContext, rollbackPlan: RollbackPlan): Promise<boolean> {
    try {
      this.logger.log(`Rolling back database table repair for incident ${context.incidentId}`);

      // Sort rollback steps by order (reverse order for rollback)
      const sortedSteps = rollbackPlan.steps.sort((a, b) => b.order - a.order);

      for (const step of sortedSteps) {
        // For database restore, we need to be extra careful
        if (step.type === 'execute_command' && step.description.includes('database')) {
          this.logger.warn(`Executing database rollback: ${step.description}`);
        }

        const result = await this.executeCommand(context, step.action, step.description);
        if (!result.success) {
          this.logger.error(`Rollback step failed: ${step.description}`);
          return false;
        }
      }

      return true;
    } catch (error) {
      this.logger.error(`Rollback failed for incident ${context.incidentId}:`, error);
      return false;
    }
  }

  getHypothesis(context: FixContext, evidence: FixEvidence[]): string {
    const dbEvidence = evidence.find(e => 
      e.content.toLowerCase().includes('table') && e.content.toLowerCase().includes('crashed') ||
      e.content.toLowerCase().includes('corrupted') ||
      e.content.toLowerCase().includes('database error')
    );

    if (dbEvidence) {
      return 'WordPress site is failing due to corrupted database tables. Repairing the affected tables and optimizing the database should restore functionality.';
    }

    return 'Proactive database table integrity check and repair to ensure WordPress database health.';
  }

  private async checkDatabaseHealth(context: FixContext): Promise<{ hasIssues: boolean }> {
    // Basic check to see if we can connect to the database
    const testResult = await this.executeCommand(
      context,
      `cd "${context.wordpressPath}" && php -r "
        require_once('wp-config.php');
        try {
          \$conn = new mysqli(DB_HOST, DB_USER, DB_PASSWORD, DB_NAME);
          if (\$conn->connect_error) {
            echo 'CONNECTION_FAILED';
          } else {
            echo 'CONNECTION_SUCCESS';
            \$conn->close();
          }
        } catch (Exception \$e) {
          echo 'CONNECTION_ERROR';
        }
      "`,
      'Test database connection health'
    );

    return { hasIssues: !testResult.stdout.includes('CONNECTION_SUCCESS') };
  }

  private async getDatabaseInfo(context: FixContext): Promise<{
    success: boolean;
    config?: {
      host: string;
      user: string;
      password: string;
      database: string;
    };
    evidence: FixEvidence[];
  }> {
    const evidence: FixEvidence[] = [];

    const extractResult = await this.executeCommand(
      context,
      `cd "${context.wordpressPath}" && php -r "
        require_once('wp-config.php');
        echo json_encode([
          'host' => DB_HOST,
          'user' => DB_USER,
          'password' => DB_PASSWORD,
          'database' => DB_NAME
        ]);
      "`,
      'Extract database configuration'
    );

    evidence.push({
      type: 'system_info',
      description: 'Database configuration extraction',
      content: extractResult.success ? 'Configuration extracted successfully' : extractResult.stderr,
      signature: this.generateSignature(extractResult.stdout),
      timestamp: new Date(),
    });

    if (!extractResult.success) {
      return { success: false, evidence };
    }

    try {
      const config = JSON.parse(extractResult.stdout);
      return {
        success: true,
        config: {
          host: config.host,
          user: config.user,
          password: config.password,
          database: config.database,
        },
        evidence,
      };
    } catch (error) {
      return { success: false, evidence };
    }
  }

  private async createDatabaseBackup(context: FixContext, dbConfig: any): Promise<{
    backupPath?: string;
    evidence: FixEvidence[];
  }> {
    const evidence: FixEvidence[] = [];
    const backupPath = `/tmp/db-backup-${context.incidentId}-${Date.now()}.sql`;

    const backupResult = await this.executeCommand(
      context,
      `mysqldump -h "${dbConfig.host}" -u "${dbConfig.user}" -p"${dbConfig.password}" "${dbConfig.database}" > "${backupPath}" 2>/dev/null && echo "BACKUP_SUCCESS" || echo "BACKUP_FAILED"`,
      'Create database backup before repair'
    );

    const success = backupResult.stdout.includes('BACKUP_SUCCESS');

    evidence.push({
      type: 'command_output',
      description: 'Database backup creation',
      content: success ? `Backup created at ${backupPath}` : 'Backup creation failed',
      signature: this.generateSignature(backupResult.stdout),
      timestamp: new Date(),
    });

    return {
      backupPath: success ? backupPath : undefined,
      evidence,
    };
  }

  private async checkTableStatus(context: FixContext, dbConfig: any): Promise<{
    totalTables: number;
    corruptedTables: string[];
    evidence: FixEvidence[];
  }> {
    const evidence: FixEvidence[] = [];
    const corruptedTables: string[] = [];

    // Check table status using MySQL
    const checkResult = await this.executeCommand(
      context,
      `mysql -h "${dbConfig.host}" -u "${dbConfig.user}" -p"${dbConfig.password}" "${dbConfig.database}" -e "CHECK TABLE $(mysql -h '${dbConfig.host}' -u '${dbConfig.user}' -p'${dbConfig.password}' '${dbConfig.database}' -e 'SHOW TABLES' | tail -n +2 | tr '\\n' ',' | sed 's/,$//' | sed 's/,/ EXTENDED, /g') EXTENDED;" 2>/dev/null`,
      'Check all database tables for corruption'
    );

    evidence.push({
      type: 'command_output',
      description: 'Database table status check',
      content: checkResult.stdout,
      signature: this.generateSignature(checkResult.stdout),
      timestamp: new Date(),
    });

    if (checkResult.success) {
      // Parse the output to find corrupted tables
      const lines = checkResult.stdout.split('\n');
      let totalTables = 0;

      for (const line of lines) {
        if (line.includes('\t')) {
          totalTables++;
          if (line.toLowerCase().includes('error') || 
              line.toLowerCase().includes('corrupt') ||
              line.toLowerCase().includes('crashed')) {
            const tableName = line.split('\t')[0];
            if (tableName && !corruptedTables.includes(tableName)) {
              corruptedTables.push(tableName);
            }
          }
        }
      }

      evidence.push({
        type: 'system_info',
        description: 'Table status summary',
        content: JSON.stringify({
          totalTables,
          corruptedTables: corruptedTables.length,
          corruptedTableNames: corruptedTables,
        }),
        signature: this.generateSignature(JSON.stringify(corruptedTables)),
        timestamp: new Date(),
      });

      return { totalTables, corruptedTables, evidence };
    }

    return { totalTables: 0, corruptedTables, evidence };
  }

  private async repairCorruptedTables(context: FixContext, dbConfig: any, tables: string[]): Promise<{
    changes: FixChange[];
    evidence: FixEvidence[];
    repairedCount: number;
  }> {
    const changes: FixChange[] = [];
    const evidence: FixEvidence[] = [];
    let repairedCount = 0;

    for (const table of tables) {
      this.logger.log(`Repairing table: ${table}`);

      const repairResult = await this.executeCommand(
        context,
        `mysql -h "${dbConfig.host}" -u "${dbConfig.user}" -p"${dbConfig.password}" "${dbConfig.database}" -e "REPAIR TABLE \`${table}\` EXTENDED;" 2>/dev/null`,
        `Repair corrupted table: ${table}`
      );

      const success = repairResult.success && 
        (repairResult.stdout.includes('OK') || repairResult.stdout.includes('repaired'));

      evidence.push({
        type: 'command_output',
        description: `Table repair result: ${table}`,
        content: repairResult.stdout + repairResult.stderr,
        signature: this.generateSignature(repairResult.stdout),
        timestamp: new Date(),
      });

      if (success) {
        changes.push({
          type: 'database',
          description: `Repaired corrupted database table: ${table}`,
          timestamp: new Date(),
        });
        repairedCount++;
      }
    }

    return { changes, evidence, repairedCount };
  }

  private async optimizeTables(context: FixContext, dbConfig: any, tables: string[]): Promise<{
    changes: FixChange[];
    evidence: FixEvidence[];
    optimizedCount: number;
  }> {
    const changes: FixChange[] = [];
    const evidence: FixEvidence[] = [];
    let optimizedCount = 0;

    for (const table of tables) {
      const optimizeResult = await this.executeCommand(
        context,
        `mysql -h "${dbConfig.host}" -u "${dbConfig.user}" -p"${dbConfig.password}" "${dbConfig.database}" -e "OPTIMIZE TABLE \`${table}\`;" 2>/dev/null`,
        `Optimize repaired table: ${table}`
      );

      const success = optimizeResult.success && optimizeResult.stdout.includes('OK');

      evidence.push({
        type: 'command_output',
        description: `Table optimization result: ${table}`,
        content: optimizeResult.stdout,
        signature: this.generateSignature(optimizeResult.stdout),
        timestamp: new Date(),
      });

      if (success) {
        changes.push({
          type: 'database',
          description: `Optimized database table: ${table}`,
          timestamp: new Date(),
        });
        optimizedCount++;
      }
    }

    return { changes, evidence, optimizedCount };
  }

  private async verifyTableIntegrity(context: FixContext, dbConfig: any): Promise<{
    success: boolean;
    evidence: FixEvidence[];
  }> {
    const evidence: FixEvidence[] = [];

    // Re-check table status after repair
    const verifyResult = await this.executeCommand(
      context,
      `mysql -h "${dbConfig.host}" -u "${dbConfig.user}" -p"${dbConfig.password}" "${dbConfig.database}" -e "CHECK TABLE $(mysql -h '${dbConfig.host}' -u '${dbConfig.user}' -p'${dbConfig.password}' '${dbConfig.database}' -e 'SHOW TABLES' | tail -n +2 | tr '\\n' ',' | sed 's/,$//' | sed 's/,/ QUICK, /g') QUICK;" 2>/dev/null`,
      'Verify table integrity after repair'
    );

    evidence.push({
      type: 'command_output',
      description: 'Post-repair table integrity verification',
      content: verifyResult.stdout,
      signature: this.generateSignature(verifyResult.stdout),
      timestamp: new Date(),
    });

    const success = verifyResult.success && 
      !verifyResult.stdout.toLowerCase().includes('error') &&
      !verifyResult.stdout.toLowerCase().includes('corrupt');

    return { success, evidence };
  }

  private async repairWordPressOptions(context: FixContext, dbConfig: any): Promise<{
    applied: boolean;
    changes: FixChange[];
    evidence: FixEvidence[];
  }> {
    const changes: FixChange[] = [];
    const evidence: FixEvidence[] = [];

    // Check if wp_options table exists and has critical options
    const optionsCheck = await this.executeCommand(
      context,
      `mysql -h "${dbConfig.host}" -u "${dbConfig.user}" -p"${dbConfig.password}" "${dbConfig.database}" -e "SELECT COUNT(*) as count FROM wp_options WHERE option_name IN ('siteurl', 'home', 'blogname');" 2>/dev/null`,
      'Check critical WordPress options'
    );

    evidence.push({
      type: 'command_output',
      description: 'WordPress options check',
      content: optionsCheck.stdout,
      signature: this.generateSignature(optionsCheck.stdout),
      timestamp: new Date(),
    });

    if (!optionsCheck.success) {
      return { applied: false, changes, evidence };
    }

    // Extract count from result
    const countMatch = optionsCheck.stdout.match(/(\d+)/);
    const optionCount = countMatch ? parseInt(countMatch[1], 10) : 0;

    if (optionCount < 3) {
      // Some critical options are missing, try to restore them
      const siteUrl = `http://${context.domain}`;
      
      const restoreOptions = [
        `INSERT IGNORE INTO wp_options (option_name, option_value, autoload) VALUES ('siteurl', '${siteUrl}', 'yes')`,
        `INSERT IGNORE INTO wp_options (option_name, option_value, autoload) VALUES ('home', '${siteUrl}', 'yes')`,
        `INSERT IGNORE INTO wp_options (option_name, option_value, autoload) VALUES ('blogname', '${context.domain}', 'yes')`,
      ];

      for (const query of restoreOptions) {
        const restoreResult = await this.executeCommand(
          context,
          `mysql -h "${dbConfig.host}" -u "${dbConfig.user}" -p"${dbConfig.password}" "${dbConfig.database}" -e "${query};" 2>/dev/null`,
          'Restore critical WordPress option'
        );

        if (restoreResult.success) {
          changes.push({
            type: 'database',
            description: 'Restored critical WordPress option',
            timestamp: new Date(),
          });
        }
      }

      evidence.push({
        type: 'system_info',
        description: 'WordPress options restoration',
        content: `Restored ${changes.length} critical options`,
        signature: this.generateSignature(`options_restored_${changes.length}`),
        timestamp: new Date(),
      });

      return { applied: changes.length > 0, changes, evidence };
    }

    return { applied: false, changes, evidence };
  }
}