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

interface DatabaseConfig {
  host: string;
  port: string;
  name: string;
  user: string;
  password: string;
  charset: string;
  collate: string;
}

@Injectable()
export class DatabaseConnectionRestorationService extends BaseFixPlaybook {
  readonly name = 'database-connection-restoration';
  readonly tier = FixTier.TIER_1_INFRASTRUCTURE;
  readonly priority = FixPriority.CRITICAL;
  readonly description = 'Restore database connectivity and fix common database connection issues';
  readonly applicableConditions = [
    'database_connection_error',
    'mysql_server_gone_away',
    'access_denied_for_user',
    'unknown_database',
    'cant_connect_to_mysql',
    'connection_refused'
  ];

  constructor(
    sshService: SSHService,
    backupService: BackupService,
    evidenceService: EvidenceService,
  ) {
    super(sshService, backupService, evidenceService);
  }

  async canApply(context: FixContext, evidence: FixEvidence[]): Promise<boolean> {
    // Check if evidence indicates database connection issues
    return evidence.some(e => 
      e.content.toLowerCase().includes('database connection') ||
      e.content.toLowerCase().includes('mysql server has gone away') ||
      e.content.toLowerCase().includes('access denied for user') ||
      e.content.toLowerCase().includes('unknown database') ||
      e.content.toLowerCase().includes('can\'t connect to mysql') ||
      e.content.toLowerCase().includes('connection refused') ||
      e.content.toLowerCase().includes('error establishing a database connection')
    );
  }

  async apply(context: FixContext): Promise<FixResult> {
    const changes: FixChange[] = [];
    const evidence: FixEvidence[] = [];
    const rollbackSteps: RollbackStep[] = [];

    try {
      this.logger.log(`Starting database connection restoration for incident ${context.incidentId}`);

      // 1. Extract database configuration from wp-config.php
      const dbConfig = await this.extractDatabaseConfig(context);
      evidence.push(...dbConfig.evidence);

      if (!dbConfig.success || !dbConfig.config) {
        return {
          success: false,
          applied: false,
          changes,
          evidence,
          error: 'Could not extract database configuration from wp-config.php',
        };
      }

      // 2. Test current database connection
      const connectionTest = await this.testDatabaseConnection(context, dbConfig.config);
      evidence.push(...connectionTest.evidence);

      // 3. If connection fails, try to diagnose and fix issues
      if (!connectionTest.success) {
        // Check if MySQL service is running
        const serviceResult = await this.checkAndStartMysqlService(context);
        if (serviceResult.change) {
          changes.push(serviceResult.change);
        }
        evidence.push(...serviceResult.evidence);

        // Check database server connectivity
        const connectivityResult = await this.checkDatabaseConnectivity(context, dbConfig.config);
        evidence.push(...connectivityResult.evidence);

        // Fix wp-config.php database settings if needed
        const configResult = await this.fixDatabaseConfig(context, dbConfig.config);
        if (configResult.change) {
          changes.push(configResult.change);
          rollbackSteps.push(...configResult.rollbackSteps);
        }
        evidence.push(...configResult.evidence);

        // Repair database tables if accessible
        const repairResult = await this.repairDatabaseTables(context, dbConfig.config);
        if (repairResult.change) {
          changes.push(repairResult.change);
        }
        evidence.push(...repairResult.evidence);

        // Test connection again after fixes
        const finalTest = await this.testDatabaseConnection(context, dbConfig.config);
        evidence.push(...finalTest.evidence);

        const success = finalTest.success;

        return {
          success,
          applied: changes.length > 0,
          changes,
          evidence,
          rollbackPlan: rollbackSteps.length > 0 ? {
            steps: rollbackSteps,
            metadata: {
              databaseHost: dbConfig.config.host,
              databaseName: dbConfig.config.name,
              fixesApplied: changes.length,
            },
            createdAt: new Date(),
          } : undefined,
          metadata: {
            databaseHost: dbConfig.config.host,
            databaseName: dbConfig.config.name,
            connectionRestored: success,
            fixesApplied: changes.length,
          },
        };
      } else {
        // Connection is working, but check for optimization opportunities
        const optimizationResult = await this.optimizeDatabaseSettings(context, dbConfig.config);
        if (optimizationResult.change) {
          changes.push(optimizationResult.change);
          rollbackSteps.push(...optimizationResult.rollbackSteps);
        }
        evidence.push(...optimizationResult.evidence);

        return {
          success: true,
          applied: changes.length > 0,
          changes,
          evidence,
          rollbackPlan: rollbackSteps.length > 0 ? {
            steps: rollbackSteps,
            metadata: {
              databaseHost: dbConfig.config.host,
              databaseName: dbConfig.config.name,
              optimizationsApplied: changes.length,
            },
            createdAt: new Date(),
          } : undefined,
          metadata: {
            databaseHost: dbConfig.config.host,
            databaseName: dbConfig.config.name,
            connectionWorking: true,
            optimizationsApplied: changes.length,
          },
        };
      }

    } catch (error) {
      this.logger.error(`Database connection restoration failed for incident ${context.incidentId}:`, error);
      
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
      this.logger.log(`Rolling back database connection fixes for incident ${context.incidentId}`);

      // Sort rollback steps by order (reverse order for rollback)
      const sortedSteps = rollbackPlan.steps.sort((a, b) => b.order - a.order);

      for (const step of sortedSteps) {
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
    const dbErrors = evidence.filter(e => 
      e.content.toLowerCase().includes('database connection') ||
      e.content.toLowerCase().includes('mysql server has gone away')
    );

    if (dbErrors.length > 0) {
      return 'WordPress site cannot connect to the database. Restoring database connectivity and fixing configuration issues should resolve the problem.';
    }

    return 'Proactive database connection optimization to prevent potential connectivity issues.';
  }

  private async extractDatabaseConfig(context: FixContext): Promise<{
    success: boolean;
    config?: DatabaseConfig;
    evidence: FixEvidence[];
  }> {
    const evidence: FixEvidence[] = [];

    const wpConfigPath = `${context.wordpressPath}/wp-config.php`;
    const exists = await this.fileExists(context, wpConfigPath);

    if (!exists) {
      evidence.push({
        type: 'system_info',
        description: 'wp-config.php not found',
        content: `File not found: ${wpConfigPath}`,
        signature: this.generateSignature(`wpconfig_not_found_${wpConfigPath}`),
        timestamp: new Date(),
      });
      return { success: false, evidence };
    }

    const configContent = await this.getFileContent(context, wpConfigPath);
    if (!configContent) {
      return { success: false, evidence };
    }

    // Extract database configuration using regex
    const dbHost = this.extractConfigValue(configContent, 'DB_HOST') || 'localhost';
    const dbName = this.extractConfigValue(configContent, 'DB_NAME') || '';
    const dbUser = this.extractConfigValue(configContent, 'DB_USER') || '';
    const dbPassword = this.extractConfigValue(configContent, 'DB_PASSWORD') || '';
    const dbCharset = this.extractConfigValue(configContent, 'DB_CHARSET') || 'utf8';
    const dbCollate = this.extractConfigValue(configContent, 'DB_COLLATE') || '';

    const config: DatabaseConfig = {
      host: dbHost,
      port: dbHost.includes(':') ? dbHost.split(':')[1] : '3306',
      name: dbName,
      user: dbUser,
      password: dbPassword,
      charset: dbCharset,
      collate: dbCollate,
    };

    evidence.push({
      type: 'system_info',
      description: 'Database configuration extracted',
      content: JSON.stringify({
        host: config.host,
        port: config.port,
        name: config.name,
        user: config.user,
        charset: config.charset,
        collate: config.collate,
        // Password is redacted for security
      }),
      signature: this.generateSignature(`db_config_${config.host}_${config.name}`),
      timestamp: new Date(),
    });

    return { success: true, config, evidence };
  }

  private extractConfigValue(content: string, key: string): string | null {
    const regex = new RegExp(`define\\s*\\(\\s*['"]${key}['"],\\s*['"]([^'"]*)['"]);`, 'i');
    const match = content.match(regex);
    return match ? match[1] : null;
  }

  private async testDatabaseConnection(context: FixContext, config: DatabaseConfig): Promise<{
    success: boolean;
    evidence: FixEvidence[];
  }> {
    const evidence: FixEvidence[] = [];

    // Test connection using MySQL command line
    const testCommand = `mysql -h "${config.host}" -P "${config.port}" -u "${config.user}" -p"${config.password}" -e "SELECT 1;" "${config.name}" 2>&1`;
    
    const testResult = await this.executeCommand(
      context,
      testCommand,
      'Test database connection'
    );

    const success = testResult.success && !testResult.stdout.toLowerCase().includes('error');

    evidence.push({
      type: 'command_output',
      description: 'Database connection test',
      content: success ? 'Connection successful' : testResult.stderr || testResult.stdout,
      signature: this.generateSignature(`db_test_${success}`),
      timestamp: new Date(),
    });

    return { success, evidence };
  }

  private async checkAndStartMysqlService(context: FixContext): Promise<{
    change?: FixChange;
    evidence: FixEvidence[];
  }> {
    const evidence: FixEvidence[] = [];

    // Check if MySQL service is running
    const statusResult = await this.executeCommand(
      context,
      'systemctl is-active mysql 2>/dev/null || systemctl is-active mysqld 2>/dev/null || service mysql status 2>/dev/null || echo "unknown"',
      'Check MySQL service status'
    );

    evidence.push({
      type: 'system_info',
      description: 'MySQL service status',
      content: statusResult.stdout,
      signature: this.generateSignature(statusResult.stdout),
      timestamp: new Date(),
    });

    if (!statusResult.stdout.includes('active') && !statusResult.stdout.includes('running')) {
      // Try to start MySQL service
      const startResult = await this.executeCommand(
        context,
        'systemctl start mysql 2>/dev/null || systemctl start mysqld 2>/dev/null || service mysql start 2>/dev/null || true',
        'Start MySQL service'
      );

      evidence.push({
        type: 'command_output',
        description: 'MySQL service start attempt',
        content: startResult.stdout + startResult.stderr,
        signature: this.generateSignature(startResult.stdout),
        timestamp: new Date(),
      });

      if (startResult.success || startResult.exitCode === 0) {
        return {
          change: {
            type: 'command',
            description: 'Started MySQL service',
            command: 'systemctl start mysql',
            timestamp: new Date(),
          },
          evidence,
        };
      }
    }

    return { evidence };
  }

  private async checkDatabaseConnectivity(context: FixContext, config: DatabaseConfig): Promise<{
    evidence: FixEvidence[];
  }> {
    const evidence: FixEvidence[] = [];

    // Test network connectivity to database host
    const pingResult = await this.executeCommand(
      context,
      `ping -c 3 "${config.host.split(':')[0]}" 2>/dev/null || echo "ping_failed"`,
      `Test network connectivity to database host`
    );

    evidence.push({
      type: 'command_output',
      description: 'Database host connectivity test',
      content: pingResult.stdout,
      signature: this.generateSignature(pingResult.stdout),
      timestamp: new Date(),
    });

    // Test port connectivity
    const portTestResult = await this.executeCommand(
      context,
      `nc -z "${config.host.split(':')[0]}" "${config.port}" 2>/dev/null && echo "port_open" || echo "port_closed"`,
      `Test database port connectivity`
    );

    evidence.push({
      type: 'command_output',
      description: 'Database port connectivity test',
      content: portTestResult.stdout,
      signature: this.generateSignature(portTestResult.stdout),
      timestamp: new Date(),
    });

    return { evidence };
  }

  private async fixDatabaseConfig(context: FixContext, config: DatabaseConfig): Promise<{
    change?: FixChange;
    rollbackSteps: RollbackStep[];
    evidence: FixEvidence[];
  }> {
    const evidence: FixEvidence[] = [];
    const rollbackSteps: RollbackStep[] = [];

    const wpConfigPath = `${context.wordpressPath}/wp-config.php`;
    const currentContent = await this.getFileContent(context, wpConfigPath);
    
    if (!currentContent) {
      return { evidence, rollbackSteps };
    }

    // Create backup
    const backupPath = await this.createBackup(context, wpConfigPath, 'Backup wp-config.php before database config fix');
    if (!backupPath) {
      return { evidence, rollbackSteps };
    }

    let newContent = currentContent;
    let hasChanges = false;

    // Fix common database configuration issues
    
    // 1. Ensure proper charset
    if (config.charset !== 'utf8mb4') {
      newContent = newContent.replace(
        /define\s*\(\s*['"]DB_CHARSET['"],\s*['"][^'"]*['"]\s*\);/i,
        "define('DB_CHARSET', 'utf8mb4');"
      );
      hasChanges = true;
    }

    // 2. Set proper collation
    if (config.collate !== 'utf8mb4_unicode_ci') {
      newContent = newContent.replace(
        /define\s*\(\s*['"]DB_COLLATE['"],\s*['"][^'"]*['"]\s*\);/i,
        "define('DB_COLLATE', 'utf8mb4_unicode_ci');"
      );
      hasChanges = true;
    }

    // 3. Add database connection timeout settings
    if (!newContent.includes('MYSQL_CLIENT_FLAGS')) {
      const mysqlFlags = `
// Database connection optimization - WP-AutoHealer
define('MYSQL_CLIENT_FLAGS', MYSQLI_CLIENT_SSL_DONT_VERIFY_SERVER_CERT);
ini_set('mysql.connect_timeout', 60);
ini_set('default_socket_timeout', 60);
`;
      
      const phpTagRegex = /(<\?php)/;
      if (phpTagRegex.test(newContent)) {
        newContent = newContent.replace(phpTagRegex, `$1${mysqlFlags}`);
        hasChanges = true;
      }
    }

    if (hasChanges) {
      const change = await this.writeFileWithBackup(context, wpConfigPath, newContent, 'Fix database configuration in wp-config.php');
      
      if (change) {
        rollbackSteps.push(this.createFileRollbackStep(wpConfigPath, backupPath, 1));
        
        evidence.push({
          type: 'file_content',
          description: 'Fixed database configuration',
          content: 'Updated charset, collation, and connection settings',
          signature: this.generateSignature(newContent),
          timestamp: new Date(),
        });

        return { change, evidence, rollbackSteps };
      }
    }

    return { evidence, rollbackSteps };
  }

  private async repairDatabaseTables(context: FixContext, config: DatabaseConfig): Promise<{
    change?: FixChange;
    evidence: FixEvidence[];
  }> {
    const evidence: FixEvidence[] = [];

    // Try to repair WordPress database tables
    const repairCommand = `mysql -h "${config.host}" -P "${config.port}" -u "${config.user}" -p"${config.password}" -e "
      REPAIR TABLE wp_posts;
      REPAIR TABLE wp_options;
      REPAIR TABLE wp_users;
      REPAIR TABLE wp_usermeta;
      REPAIR TABLE wp_comments;
      REPAIR TABLE wp_commentmeta;
      REPAIR TABLE wp_terms;
      REPAIR TABLE wp_term_taxonomy;
      REPAIR TABLE wp_term_relationships;
    " "${config.name}" 2>&1`;

    const repairResult = await this.executeCommand(
      context,
      repairCommand,
      'Repair WordPress database tables'
    );

    evidence.push({
      type: 'command_output',
      description: 'Database table repair',
      content: repairResult.stdout + repairResult.stderr,
      signature: this.generateSignature(repairResult.stdout),
      timestamp: new Date(),
    });

    if (repairResult.success && !repairResult.stdout.toLowerCase().includes('error')) {
      return {
        change: {
          type: 'command',
          description: 'Repaired WordPress database tables',
          command: 'REPAIR TABLE commands',
          timestamp: new Date(),
        },
        evidence,
      };
    }

    return { evidence };
  }

  private async optimizeDatabaseSettings(context: FixContext, config: DatabaseConfig): Promise<{
    change?: FixChange;
    rollbackSteps: RollbackStep[];
    evidence: FixEvidence[];
  }> {
    const evidence: FixEvidence[] = [];
    const rollbackSteps: RollbackStep[] = [];

    // Optimize database tables
    const optimizeCommand = `mysql -h "${config.host}" -P "${config.port}" -u "${config.user}" -p"${config.password}" -e "
      OPTIMIZE TABLE wp_posts;
      OPTIMIZE TABLE wp_options;
      OPTIMIZE TABLE wp_comments;
    " "${config.name}" 2>&1`;

    const optimizeResult = await this.executeCommand(
      context,
      optimizeCommand,
      'Optimize WordPress database tables'
    );

    evidence.push({
      type: 'command_output',
      description: 'Database table optimization',
      content: optimizeResult.stdout + optimizeResult.stderr,
      signature: this.generateSignature(optimizeResult.stdout),
      timestamp: new Date(),
    });

    if (optimizeResult.success && !optimizeResult.stdout.toLowerCase().includes('error')) {
      return {
        change: {
          type: 'command',
          description: 'Optimized WordPress database tables',
          command: 'OPTIMIZE TABLE commands',
          timestamp: new Date(),
        },
        evidence,
        rollbackSteps, // Database optimization is generally not rolled back
      };
    }

    return { evidence, rollbackSteps };
  }
}