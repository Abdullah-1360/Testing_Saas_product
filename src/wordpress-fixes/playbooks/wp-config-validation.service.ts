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
export class WpConfigValidationService extends BaseFixPlaybook {
  readonly name = 'wp-config-validation';
  readonly tier = FixTier.TIER_2_CORE_INTEGRITY;
  readonly priority = FixPriority.CRITICAL;
  readonly description = 'Validate and repair wp-config.php file including database settings, security keys, and critical constants';
  readonly applicableConditions = [
    'wp_config_error',
    'database_connection_error',
    'wp_config_missing',
    'wp_config_corrupted',
    'security_keys_missing',
    'database_credentials_invalid'
  ];

  constructor(
    sshService: SSHService,
    backupService: BackupService,
    evidenceService: EvidenceService,
  ) {
    super(sshService, backupService, evidenceService);
  }

  async canApply(context: FixContext, evidence: FixEvidence[]): Promise<boolean> {
    // Check if evidence indicates wp-config.php issues
    const wpConfigEvidence = evidence.some(e => 
      e.content.toLowerCase().includes('wp-config') ||
      e.content.toLowerCase().includes('database connection') ||
      e.content.toLowerCase().includes('db_name') ||
      e.content.toLowerCase().includes('db_user') ||
      e.content.toLowerCase().includes('db_password') ||
      e.content.toLowerCase().includes('db_host') ||
      e.content.toLowerCase().includes('security keys') ||
      e.content.toLowerCase().includes('auth_key') ||
      e.content.toLowerCase().includes('wp_debug')
    );

    if (wpConfigEvidence) {
      return true;
    }

    // Check if wp-config.php exists and is readable
    const wpConfigExists = await this.fileExists(context, `${context.wordpressPath}/wp-config.php`);
    if (!wpConfigExists) {
      return true; // Missing wp-config.php definitely needs fixing
    }

    // Check if wp-config.php has basic required constants
    const configValidation = await this.validateWpConfigBasics(context);
    return !configValidation.isValid;
  }

  async apply(context: FixContext): Promise<FixResult> {
    const changes: FixChange[] = [];
    const evidence: FixEvidence[] = [];
    const rollbackSteps: RollbackStep[] = [];

    try {
      this.logger.log(`Starting wp-config.php validation and repair for incident ${context.incidentId}`);

      const wpConfigPath = `${context.wordpressPath}/wp-config.php`;
      const wpConfigSamplePath = `${context.wordpressPath}/wp-config-sample.php`;

      // 1. Check if wp-config.php exists
      const wpConfigExists = await this.fileExists(context, wpConfigPath);
      
      evidence.push({
        type: 'system_info',
        description: 'wp-config.php existence check',
        content: JSON.stringify({ exists: wpConfigExists, path: wpConfigPath }),
        signature: this.generateSignature(`wpconfig_exists_${wpConfigExists}`),
        timestamp: new Date(),
      });

      let currentConfig = '';
      if (wpConfigExists) {
        // 2. Read current wp-config.php
        currentConfig = await this.getFileContent(context, wpConfigPath) || '';
        
        evidence.push({
          type: 'file_content',
          description: 'Current wp-config.php analysis',
          content: this.sanitizeConfigForLogging(currentConfig),
          signature: this.generateSignature(currentConfig),
          timestamp: new Date(),
        });

        // 3. Validate current configuration
        const validation = await this.validateWpConfig(context, currentConfig);
        evidence.push(...validation.evidence);

        if (validation.isValid && validation.issues.length === 0) {
          return {
            success: true,
            applied: false,
            changes,
            evidence,
            metadata: {
              configStatus: 'valid',
              issues: [],
            },
          };
        }
      }

      // 4. Create backup of existing wp-config.php if it exists
      if (wpConfigExists) {
        const backupPath = await this.createBackup(
          context, 
          wpConfigPath, 
          'Backup wp-config.php before repair'
        );
        
        if (backupPath) {
          rollbackSteps.push(this.createFileRollbackStep(wpConfigPath, backupPath, 0));
        }
      }

      // 5. Generate or repair wp-config.php
      const configResult = await this.generateOrRepairWpConfig(context, currentConfig);
      if (!configResult.success) {
        return {
          success: false,
          applied: false,
          changes,
          evidence,
          error: configResult.error,
        };
      }

      evidence.push(...configResult.evidence);

      // 6. Write the repaired/generated wp-config.php
      const writeResult = await this.writeFileWithBackup(
        context,
        wpConfigPath,
        configResult.configContent!,
        'Write repaired wp-config.php'
      );

      if (writeResult) {
        changes.push(writeResult);
      }

      // 7. Set proper permissions
      await this.executeCommand(
        context,
        `chmod 600 "${wpConfigPath}"`,
        'Set secure permissions for wp-config.php'
      );

      changes.push({
        type: 'config',
        description: 'Set secure permissions (600) for wp-config.php',
        path: wpConfigPath,
        timestamp: new Date(),
      });

      // 8. Test database connection
      const dbTestResult = await this.testDatabaseConnection(context);
      evidence.push(...dbTestResult.evidence);

      // 9. Validate final configuration
      const finalValidation = await this.validateWpConfig(context, configResult.configContent!);
      evidence.push(...finalValidation.evidence);

      const success = writeResult !== null && dbTestResult.success && finalValidation.isValid;

      return {
        success,
        applied: changes.length > 0,
        changes,
        evidence,
        rollbackPlan: rollbackSteps.length > 0 ? {
          steps: rollbackSteps,
          metadata: {
            originalExists: wpConfigExists,
            repairActions: configResult.repairActions,
          },
          createdAt: new Date(),
        } : undefined,
        metadata: {
          originalExists: wpConfigExists,
          repairActions: configResult.repairActions,
          databaseConnectionTest: dbTestResult.success,
          finalValidation: finalValidation.isValid,
          issuesFixed: configResult.repairActions?.length || 0,
        },
      };

    } catch (error) {
      this.logger.error(`wp-config.php validation failed for incident ${context.incidentId}:`, error);
      
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
      this.logger.log(`Rolling back wp-config.php changes for incident ${context.incidentId}`);

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
    const configEvidence = evidence.find(e => 
      e.content.toLowerCase().includes('wp-config') ||
      e.content.toLowerCase().includes('database connection')
    );

    if (configEvidence) {
      return 'WordPress site is failing due to wp-config.php issues such as missing file, corrupted database settings, or missing security keys. Repairing the configuration should restore functionality.';
    }

    return 'Proactive wp-config.php validation and repair to ensure proper WordPress configuration.';
  }

  private async validateWpConfigBasics(context: FixContext): Promise<{ isValid: boolean }> {
    const wpConfigPath = `${context.wordpressPath}/wp-config.php`;
    
    // Check for basic required constants
    const checkResult = await this.executeCommand(
      context,
      `grep -E "(DB_NAME|DB_USER|DB_PASSWORD|DB_HOST)" "${wpConfigPath}" | wc -l`,
      'Check basic wp-config.php constants'
    );

    const constantCount = parseInt(checkResult.stdout.trim(), 10);
    return { isValid: constantCount >= 4 };
  }

  private async validateWpConfig(context: FixContext, configContent: string): Promise<{
    isValid: boolean;
    issues: string[];
    evidence: FixEvidence[];
  }> {
    const issues: string[] = [];
    const evidence: FixEvidence[] = [];

    // Check for required database constants
    const requiredDbConstants = ['DB_NAME', 'DB_USER', 'DB_PASSWORD', 'DB_HOST'];
    const missingDbConstants = requiredDbConstants.filter(constant => 
      !configContent.includes(`define('${constant}'`) && !configContent.includes(`define("${constant}"`)
    );

    if (missingDbConstants.length > 0) {
      issues.push(`Missing database constants: ${missingDbConstants.join(', ')}`);
    }

    // Check for security keys
    const securityKeys = [
      'AUTH_KEY', 'SECURE_AUTH_KEY', 'LOGGED_IN_KEY', 'NONCE_KEY',
      'AUTH_SALT', 'SECURE_AUTH_SALT', 'LOGGED_IN_SALT', 'NONCE_SALT'
    ];
    
    const missingKeys = securityKeys.filter(key => 
      !configContent.includes(`define('${key}'`) && !configContent.includes(`define("${key}"`)
    );

    if (missingKeys.length > 0) {
      issues.push(`Missing security keys: ${missingKeys.join(', ')}`);
    }

    // Check for placeholder values
    if (configContent.includes('database_name_here') || 
        configContent.includes('username_here') || 
        configContent.includes('password_here')) {
      issues.push('Contains placeholder database values');
    }

    // Check for default security key values
    if (configContent.includes('put your unique phrase here')) {
      issues.push('Contains default security key placeholders');
    }

    // Check PHP syntax
    const wpConfigPath = `${context.wordpressPath}/wp-config.php`;
    const syntaxCheck = await this.executeCommand(
      context,
      `php -l "${wpConfigPath}" 2>&1`,
      'Check wp-config.php PHP syntax'
    );

    if (!syntaxCheck.success || syntaxCheck.stdout.includes('Parse error')) {
      issues.push('PHP syntax errors detected');
    }

    evidence.push({
      type: 'system_info',
      description: 'wp-config.php validation results',
      content: JSON.stringify({
        missingDbConstants,
        missingSecurityKeys: missingKeys,
        syntaxValid: !syntaxCheck.stdout.includes('Parse error'),
        totalIssues: issues.length,
      }),
      signature: this.generateSignature(JSON.stringify(issues)),
      timestamp: new Date(),
    });

    return {
      isValid: issues.length === 0,
      issues,
      evidence,
    };
  }

  private async generateOrRepairWpConfig(context: FixContext, currentConfig: string): Promise<{
    success: boolean;
    configContent?: string;
    repairActions?: string[];
    evidence: FixEvidence[];
    error?: string;
  }> {
    const evidence: FixEvidence[] = [];
    const repairActions: string[] = [];

    try {
      let configContent = currentConfig;
      const wpConfigSamplePath = `${context.wordpressPath}/wp-config-sample.php`;

      // If no current config or it's severely corrupted, start from sample
      if (!configContent || configContent.length < 100) {
        const sampleExists = await this.fileExists(context, wpConfigSamplePath);
        if (sampleExists) {
          configContent = await this.getFileContent(context, wpConfigSamplePath) || '';
          repairActions.push('Used wp-config-sample.php as base');
        } else {
          // Generate minimal wp-config.php
          configContent = this.generateMinimalWpConfig();
          repairActions.push('Generated minimal wp-config.php');
        }
      }

      // Try to extract database settings from existing config or environment
      const dbSettings = await this.extractOrDetectDatabaseSettings(context, configContent);
      evidence.push(...dbSettings.evidence);

      if (dbSettings.settings) {
        // Update database constants
        configContent = this.updateDatabaseConstants(configContent, dbSettings.settings);
        repairActions.push('Updated database constants');
      }

      // Generate security keys if missing
      if (!this.hasValidSecurityKeys(configContent)) {
        configContent = await this.updateSecurityKeys(context, configContent);
        repairActions.push('Generated new security keys');
      }

      // Add essential WordPress constants if missing
      configContent = this.addEssentialConstants(configContent);
      if (configContent !== currentConfig) {
        repairActions.push('Added essential WordPress constants');
      }

      // Ensure proper PHP tags and structure
      configContent = this.ensureProperStructure(configContent);

      evidence.push({
        type: 'system_info',
        description: 'wp-config.php repair summary',
        content: JSON.stringify({
          repairActions,
          hasDbSettings: !!dbSettings.settings,
          configLength: configContent.length,
        }),
        signature: this.generateSignature(JSON.stringify(repairActions)),
        timestamp: new Date(),
      });

      return {
        success: true,
        configContent,
        repairActions,
        evidence,
      };

    } catch (error) {
      evidence.push({
        type: 'system_info',
        description: 'wp-config.php repair failed',
        content: error instanceof Error ? error.message : 'Unknown error',
        signature: this.generateSignature('repair_failed'),
        timestamp: new Date(),
      });

      return {
        success: false,
        evidence,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private async extractOrDetectDatabaseSettings(context: FixContext, configContent: string): Promise<{
    settings?: {
      name: string;
      user: string;
      password: string;
      host: string;
    };
    evidence: FixEvidence[];
  }> {
    const evidence: FixEvidence[] = [];

    // Try to extract from current config
    const dbNameMatch = configContent.match(/define\s*\(\s*['"]DB_NAME['"]\s*,\s*['"]([^'"]+)['"]/);
    const dbUserMatch = configContent.match(/define\s*\(\s*['"]DB_USER['"]\s*,\s*['"]([^'"]+)['"]/);
    const dbPassMatch = configContent.match(/define\s*\(\s*['"]DB_PASSWORD['"]\s*,\s*['"]([^'"]*)['"]/);
    const dbHostMatch = configContent.match(/define\s*\(\s*['"]DB_HOST['"]\s*,\s*['"]([^'"]+)['"]/);

    if (dbNameMatch && dbUserMatch && dbHostMatch && 
        !dbNameMatch[1].includes('database_name_here') &&
        !dbUserMatch[1].includes('username_here')) {
      
      evidence.push({
        type: 'system_info',
        description: 'Database settings extracted from existing config',
        content: JSON.stringify({
          name: dbNameMatch[1],
          user: dbUserMatch[1],
          host: dbHostMatch[1],
          hasPassword: !!dbPassMatch && dbPassMatch[1] !== 'password_here',
        }),
        signature: this.generateSignature('db_extracted'),
        timestamp: new Date(),
      });

      return {
        settings: {
          name: dbNameMatch[1],
          user: dbUserMatch[1],
          password: dbPassMatch ? dbPassMatch[1] : '',
          host: dbHostMatch[1],
        },
        evidence,
      };
    }

    // Try to detect from environment or common patterns
    const envCheck = await this.executeCommand(
      context,
      'printenv | grep -E "(DB_|DATABASE_)" || echo "no_env_vars"',
      'Check for database environment variables'
    );

    evidence.push({
      type: 'command_output',
      description: 'Database environment variables check',
      content: envCheck.stdout,
      signature: this.generateSignature(envCheck.stdout),
      timestamp: new Date(),
    });

    // Default fallback settings
    evidence.push({
      type: 'system_info',
      description: 'Using default database settings',
      content: 'No valid database settings found, using defaults',
      signature: this.generateSignature('db_defaults'),
      timestamp: new Date(),
    });

    return {
      settings: {
        name: 'wordpress',
        user: 'wordpress',
        password: '',
        host: 'localhost',
      },
      evidence,
    };
  }

  private updateDatabaseConstants(configContent: string, dbSettings: any): string {
    let updatedContent = configContent;

    // Update or add database constants
    const constants = [
      { key: 'DB_NAME', value: dbSettings.name },
      { key: 'DB_USER', value: dbSettings.user },
      { key: 'DB_PASSWORD', value: dbSettings.password },
      { key: 'DB_HOST', value: dbSettings.host },
    ];

    for (const constant of constants) {
      const regex = new RegExp(`define\\s*\\(\\s*['"]${constant.key}['"]\\s*,\\s*['"][^'"]*['"]\\s*\\)\\s*;`, 'g');
      const replacement = `define('${constant.key}', '${constant.value}');`;
      
      if (regex.test(updatedContent)) {
        updatedContent = updatedContent.replace(regex, replacement);
      } else {
        // Add the constant if it doesn't exist
        const insertPoint = updatedContent.indexOf('<?php') + 5;
        updatedContent = updatedContent.slice(0, insertPoint) + 
          `\n${replacement}\n` + 
          updatedContent.slice(insertPoint);
      }
    }

    return updatedContent;
  }

  private hasValidSecurityKeys(configContent: string): boolean {
    const securityKeys = [
      'AUTH_KEY', 'SECURE_AUTH_KEY', 'LOGGED_IN_KEY', 'NONCE_KEY',
      'AUTH_SALT', 'SECURE_AUTH_SALT', 'LOGGED_IN_SALT', 'NONCE_SALT'
    ];

    return securityKeys.every(key => {
      const hasKey = configContent.includes(`define('${key}'`) || configContent.includes(`define("${key}"`);
      const notPlaceholder = !configContent.includes('put your unique phrase here');
      return hasKey && notPlaceholder;
    });
  }

  private async updateSecurityKeys(context: FixContext, configContent: string): Promise<string> {
    // Generate random security keys
    const generateKey = () => {
      const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+-=[]{}|;:,.<>?';
      let result = '';
      for (let i = 0; i < 64; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return result;
    };

    const securityKeys = [
      'AUTH_KEY', 'SECURE_AUTH_KEY', 'LOGGED_IN_KEY', 'NONCE_KEY',
      'AUTH_SALT', 'SECURE_AUTH_SALT', 'LOGGED_IN_SALT', 'NONCE_SALT'
    ];

    let updatedContent = configContent;

    for (const key of securityKeys) {
      const keyValue = generateKey();
      const regex = new RegExp(`define\\s*\\(\\s*['"]${key}['"]\\s*,\\s*['"][^'"]*['"]\\s*\\)\\s*;`, 'g');
      const replacement = `define('${key}', '${keyValue}');`;
      
      if (regex.test(updatedContent)) {
        updatedContent = updatedContent.replace(regex, replacement);
      } else {
        // Add the key if it doesn't exist
        const insertPoint = updatedContent.indexOf('<?php') + 5;
        updatedContent = updatedContent.slice(0, insertPoint) + 
          `\n${replacement}\n` + 
          updatedContent.slice(insertPoint);
      }
    }

    return updatedContent;
  }

  private addEssentialConstants(configContent: string): string {
    let updatedContent = configContent;

    const essentialConstants = [
      { key: 'WP_DEBUG', value: 'false' },
      { key: 'WP_DEBUG_LOG', value: 'false' },
      { key: 'WP_DEBUG_DISPLAY', value: 'false' },
      { key: 'ABSPATH', value: "dirname(__FILE__) . '/'" },
    ];

    for (const constant of essentialConstants) {
      if (!updatedContent.includes(`define('${constant.key}'`) && 
          !updatedContent.includes(`define("${constant.key}"`)) {
        
        const insertPoint = updatedContent.lastIndexOf('require_once');
        if (insertPoint > 0) {
          updatedContent = updatedContent.slice(0, insertPoint) + 
            `define('${constant.key}', ${constant.value});\n\n` + 
            updatedContent.slice(insertPoint);
        }
      }
    }

    return updatedContent;
  }

  private ensureProperStructure(configContent: string): string {
    let updatedContent = configContent;

    // Ensure PHP opening tag
    if (!updatedContent.startsWith('<?php')) {
      updatedContent = '<?php\n' + updatedContent;
    }

    // Ensure WordPress bootstrap inclusion
    if (!updatedContent.includes("require_once(ABSPATH . 'wp-settings.php')") &&
        !updatedContent.includes("require_once ABSPATH . 'wp-settings.php'")) {
      updatedContent += "\n\n/** Absolute path to the WordPress directory. */\n";
      updatedContent += "if ( !defined('ABSPATH') )\n";
      updatedContent += "\tdefine('ABSPATH', dirname(__FILE__) . '/');\n\n";
      updatedContent += "/** Sets up WordPress vars and included files. */\n";
      updatedContent += "require_once(ABSPATH . 'wp-settings.php');\n";
    }

    return updatedContent;
  }

  private generateMinimalWpConfig(): string {
    return `<?php
/**
 * The base configuration for WordPress
 *
 * This file contains the following configurations:
 *
 * * MySQL settings
 * * Secret keys
 * * Database table prefix
 * * ABSPATH
 *
 * @package WordPress
 */

// ** MySQL settings - You will need to get this info from your web host ** //
/** The name of the database for WordPress */
define('DB_NAME', 'wordpress');

/** MySQL database username */
define('DB_USER', 'wordpress');

/** MySQL database password */
define('DB_PASSWORD', '');

/** MySQL hostname */
define('DB_HOST', 'localhost');

/** Database Charset to use in creating database tables. */
define('DB_CHARSET', 'utf8');

/** The Database Collate type. Don't change this if in doubt. */
define('DB_COLLATE', '');

/**#@+
 * Authentication Unique Keys and Salts.
 * You can generate these using the {@link https://api.wordpress.org/secret-key/1.1/salt/ WordPress.org secret-key service}
 */
define('AUTH_KEY',         'put your unique phrase here');
define('SECURE_AUTH_KEY',  'put your unique phrase here');
define('LOGGED_IN_KEY',    'put your unique phrase here');
define('NONCE_KEY',        'put your unique phrase here');
define('AUTH_SALT',        'put your unique phrase here');
define('SECURE_AUTH_SALT', 'put your unique phrase here');
define('LOGGED_IN_SALT',   'put your unique phrase here');
define('NONCE_SALT',       'put your unique phrase here');

/**#@-*/

/**
 * WordPress Database Table prefix.
 */
$table_prefix  = 'wp_';

/**
 * For developers: WordPress debugging mode.
 */
define('WP_DEBUG', false);

/* That's all, stop editing! Happy blogging. */

/** Absolute path to the WordPress directory. */
if ( !defined('ABSPATH') )
	define('ABSPATH', dirname(__FILE__) . '/');

/** Sets up WordPress vars and included files. */
require_once(ABSPATH . 'wp-settings.php');
`;
  }

  private async testDatabaseConnection(context: FixContext): Promise<{
    success: boolean;
    evidence: FixEvidence[];
  }> {
    const evidence: FixEvidence[] = [];

    // Test database connection using WordPress
    const testScript = `
<?php
require_once('${context.wordpressPath}/wp-config.php');
$connection = @mysqli_connect(DB_HOST, DB_USER, DB_PASSWORD, DB_NAME);
if ($connection) {
    echo "CONNECTION_SUCCESS";
    mysqli_close($connection);
} else {
    echo "CONNECTION_FAILED: " . mysqli_connect_error();
}
?>`;

    const testResult = await this.executeCommand(
      context,
      `echo '${testScript}' | php`,
      'Test database connection'
    );

    const success = testResult.success && testResult.stdout.includes('CONNECTION_SUCCESS');

    evidence.push({
      type: 'command_output',
      description: 'Database connection test',
      content: success ? 'Connection successful' : testResult.stdout,
      signature: this.generateSignature(testResult.stdout),
      timestamp: new Date(),
    });

    return { success, evidence };
  }

  private sanitizeConfigForLogging(configContent: string): string {
    // Remove sensitive information for logging
    return configContent
      .replace(/define\s*\(\s*['"]DB_PASSWORD['"]\s*,\s*['"][^'"]*['"]/g, "define('DB_PASSWORD', '***')")
      .replace(/define\s*\(\s*['"]AUTH_KEY['"]\s*,\s*['"][^'"]*['"]/g, "define('AUTH_KEY', '***')")
      .replace(/define\s*\(\s*['"]SECURE_AUTH_KEY['"]\s*,\s*['"][^'"]*['"]/g, "define('SECURE_AUTH_KEY', '***')")
      .replace(/define\s*\(\s*['"]LOGGED_IN_KEY['"]\s*,\s*['"][^'"]*['"]/g, "define('LOGGED_IN_KEY', '***')")
      .replace(/define\s*\(\s*['"]NONCE_KEY['"]\s*,\s*['"][^'"]*['"]/g, "define('NONCE_KEY', '***')")
      .replace(/define\s*\(\s*['"]AUTH_SALT['"]\s*,\s*['"][^'"]*['"]/g, "define('AUTH_SALT', '***')")
      .replace(/define\s*\(\s*['"]SECURE_AUTH_SALT['"]\s*,\s*['"][^'"]*['"]/g, "define('SECURE_AUTH_SALT', '***')")
      .replace(/define\s*\(\s*['"]LOGGED_IN_SALT['"]\s*,\s*['"][^'"]*['"]/g, "define('LOGGED_IN_SALT', '***')")
      .replace(/define\s*\(\s*['"]NONCE_SALT['"]\s*,\s*['"][^'"]*['"]/g, "define('NONCE_SALT', '***')");
  }
}