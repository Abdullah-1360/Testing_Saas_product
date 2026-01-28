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

interface WebServerInfo {
  type: 'apache' | 'nginx' | 'litespeed' | 'unknown';
  version: string;
  configPath: string;
  sitesPath?: string;
  errorLogPath?: string;
}

@Injectable()
export class WebServerConfigFixesService extends BaseFixPlaybook {
  readonly name = 'web-server-config-fixes';
  readonly tier = FixTier.TIER_1_INFRASTRUCTURE;
  readonly priority = FixPriority.MEDIUM;
  readonly description = 'Fix common web server configuration issues affecting WordPress';
  readonly applicableConditions = [
    'server_error_500',
    'server_error_502',
    'server_error_503',
    'connection_timeout',
    'request_timeout',
    'file_not_found_404'
  ];

  constructor(
    sshService: SSHService,
    backupService: BackupService,
    evidenceService: EvidenceService,
  ) {
    super(sshService, backupService, evidenceService);
  }

  async canApply(context: FixContext, evidence: FixEvidence[]): Promise<boolean> {
    // Check if evidence indicates web server configuration issues
    return evidence.some(e => 
      e.content.includes('500 Internal Server Error') ||
      e.content.includes('502 Bad Gateway') ||
      e.content.includes('503 Service Unavailable') ||
      e.content.includes('Connection timed out') ||
      e.content.includes('Request timeout') ||
      e.content.toLowerCase().includes('server configuration') ||
      e.content.toLowerCase().includes('htaccess')
    );
  }

  async apply(context: FixContext): Promise<FixResult> {
    const changes: FixChange[] = [];
    const evidence: FixEvidence[] = [];
    const rollbackSteps: RollbackStep[] = [];

    try {
      this.logger.log(`Starting web server configuration fixes for incident ${context.incidentId}`);

      // 1. Detect web server type and configuration
      const webServerInfo = await this.detectWebServer(context);
      evidence.push(...webServerInfo.evidence);

      if (webServerInfo.server.type === 'unknown') {
        return {
          success: false,
          applied: false,
          changes,
          evidence,
          error: 'Could not detect web server type',
        };
      }

      // 2. Check and fix .htaccess issues (for Apache)
      if (webServerInfo.server.type === 'apache') {
        const htaccessResult = await this.fixHtaccessIssues(context);
        if (htaccessResult.change) {
          changes.push(htaccessResult.change);
          rollbackSteps.push(...htaccessResult.rollbackSteps);
        }
        evidence.push(...htaccessResult.evidence);
      }

      // 3. Fix file upload limits
      const uploadLimitsResult = await this.fixUploadLimits(context, webServerInfo.server);
      if (uploadLimitsResult.change) {
        changes.push(uploadLimitsResult.change);
        rollbackSteps.push(...uploadLimitsResult.rollbackSteps);
      }
      evidence.push(...uploadLimitsResult.evidence);

      // 4. Fix timeout configurations
      const timeoutResult = await this.fixTimeoutSettings(context, webServerInfo.server);
      if (timeoutResult.change) {
        changes.push(timeoutResult.change);
        rollbackSteps.push(...timeoutResult.rollbackSteps);
      }
      evidence.push(...timeoutResult.evidence);

      // 5. Check and fix directory permissions
      const permissionsResult = await this.fixDirectoryPermissions(context);
      if (permissionsResult.change) {
        changes.push(permissionsResult.change);
      }
      evidence.push(...permissionsResult.evidence);

      // 6. Restart web server if changes were made
      if (changes.length > 0) {
        const restartResult = await this.restartWebServer(context, webServerInfo.server);
        if (restartResult.change) {
          changes.push(restartResult.change);
        }
        evidence.push(...restartResult.evidence);
      }

      const success = changes.length > 0;

      return {
        success,
        applied: changes.length > 0,
        changes,
        evidence,
        rollbackPlan: rollbackSteps.length > 0 ? {
          steps: rollbackSteps,
          metadata: {
            webServerType: webServerInfo.server.type,
            configPath: webServerInfo.server.configPath,
            fixesApplied: changes.length,
          },
          createdAt: new Date(),
        } : undefined,
        metadata: {
          webServerType: webServerInfo.server.type,
          webServerVersion: webServerInfo.server.version,
          fixesApplied: changes.length,
        },
      };

    } catch (error) {
      this.logger.error(`Web server configuration fixes failed for incident ${context.incidentId}:`, error);
      
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
      this.logger.log(`Rolling back web server configuration fixes for incident ${context.incidentId}`);

      // Sort rollback steps by order (reverse order for rollback)
      const sortedSteps = rollbackPlan.steps.sort((a, b) => b.order - a.order);

      for (const step of sortedSteps) {
        const result = await this.executeCommand(context, step.action, step.description);
        if (!result.success) {
          this.logger.error(`Rollback step failed: ${step.description}`);
          return false;
        }
      }

      // Restart web server after rollback
      const webServerType = rollbackPlan.metadata.webServerType as string;
      if (webServerType && webServerType !== 'unknown') {
        await this.restartWebServer(context, { type: webServerType } as WebServerInfo);
      }

      return true;
    } catch (error) {
      this.logger.error(`Rollback failed for incident ${context.incidentId}:`, error);
      return false;
    }
  }

  getHypothesis(context: FixContext, evidence: FixEvidence[]): string {
    const serverErrors = evidence.filter(e => 
      e.content.includes('500') || 
      e.content.includes('502') || 
      e.content.includes('503')
    );

    if (serverErrors.length > 0) {
      return 'WordPress site is experiencing web server errors. Fixing common web server configuration issues should restore site functionality.';
    }

    return 'Proactive web server configuration optimization to prevent potential issues and improve site reliability.';
  }

  private async detectWebServer(context: FixContext): Promise<{
    server: WebServerInfo;
    evidence: FixEvidence[];
  }> {
    const evidence: FixEvidence[] = [];
    let server: WebServerInfo = {
      type: 'unknown',
      version: '',
      configPath: '',
    };

    // Check for Apache
    const apacheResult = await this.executeCommand(
      context,
      'apache2 -v 2>/dev/null || httpd -v 2>/dev/null || echo "not_found"',
      'Detect Apache web server'
    );

    if (apacheResult.success && !apacheResult.stdout.includes('not_found')) {
      server = {
        type: 'apache',
        version: apacheResult.stdout.split('\n')[0] || '',
        configPath: '/etc/apache2/apache2.conf',
        sitesPath: '/etc/apache2/sites-available',
        errorLogPath: '/var/log/apache2/error.log',
      };
    }

    // Check for Nginx if Apache not found
    if (server.type === 'unknown') {
      const nginxResult = await this.executeCommand(
        context,
        'nginx -v 2>&1 || echo "not_found"',
        'Detect Nginx web server'
      );

      if (nginxResult.success && !nginxResult.stdout.includes('not_found')) {
        server = {
          type: 'nginx',
          version: nginxResult.stdout.split('\n')[0] || '',
          configPath: '/etc/nginx/nginx.conf',
          sitesPath: '/etc/nginx/sites-available',
          errorLogPath: '/var/log/nginx/error.log',
        };
      }
    }

    // Check for LiteSpeed
    if (server.type === 'unknown') {
      const litespeedResult = await this.executeCommand(
        context,
        'ls /usr/local/lsws/bin/lshttpd 2>/dev/null && echo "litespeed_found" || echo "not_found"',
        'Detect LiteSpeed web server'
      );

      if (litespeedResult.success && litespeedResult.stdout.includes('litespeed_found')) {
        server = {
          type: 'litespeed',
          version: 'LiteSpeed',
          configPath: '/usr/local/lsws/conf/httpd_config.conf',
          errorLogPath: '/usr/local/lsws/logs/error.log',
        };
      }
    }

    evidence.push({
      type: 'system_info',
      description: 'Web server detection',
      content: JSON.stringify(server),
      signature: this.generateSignature(JSON.stringify(server)),
      timestamp: new Date(),
    });

    return { server, evidence };
  }

  private async fixHtaccessIssues(context: FixContext): Promise<{
    change?: FixChange;
    rollbackSteps: RollbackStep[];
    evidence: FixEvidence[];
  }> {
    const evidence: FixEvidence[] = [];
    const rollbackSteps: RollbackStep[] = [];

    const htaccessPath = `${context.sitePath}/.htaccess`;
    const exists = await this.fileExists(context, htaccessPath);

    if (!exists) {
      // Create a basic .htaccess file for WordPress
      const basicHtaccess = `# BEGIN WordPress
<IfModule mod_rewrite.c>
RewriteEngine On
RewriteBase /
RewriteRule ^index\\.php$ - [L]
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule . /index.php [L]
</IfModule>
# END WordPress`;

      const change = await this.writeFileWithBackup(context, htaccessPath, basicHtaccess, 'Create basic .htaccess file');
      
      if (change) {
        evidence.push({
          type: 'file_content',
          description: 'Created basic .htaccess file',
          content: basicHtaccess,
          signature: this.generateSignature(basicHtaccess),
          timestamp: new Date(),
        });

        return { change, evidence, rollbackSteps };
      }
    } else {
      // Check for common .htaccess issues
      const currentContent = await this.getFileContent(context, htaccessPath);
      if (!currentContent) {
        return { evidence, rollbackSteps };
      }

      // Create backup
      const backupPath = await this.createBackup(context, htaccessPath, 'Backup .htaccess before fixes');
      if (!backupPath) {
        return { evidence, rollbackSteps };
      }

      let newContent = currentContent;
      let hasChanges = false;

      // Fix common issues
      // 1. Ensure RewriteEngine is On
      if (!newContent.includes('RewriteEngine On')) {
        newContent = `RewriteEngine On\n${newContent}`;
        hasChanges = true;
      }

      // 2. Fix file upload size limits
      if (!newContent.includes('php_value upload_max_filesize')) {
        newContent = `php_value upload_max_filesize 64M\nphp_value post_max_size 64M\n${newContent}`;
        hasChanges = true;
      }

      // 3. Add security headers
      if (!newContent.includes('X-Content-Type-Options')) {
        const securityHeaders = `
# Security Headers
<IfModule mod_headers.c>
Header always set X-Content-Type-Options nosniff
Header always set X-Frame-Options DENY
Header always set X-XSS-Protection "1; mode=block"
</IfModule>
`;
        newContent = `${securityHeaders}\n${newContent}`;
        hasChanges = true;
      }

      if (hasChanges) {
        const change = await this.writeFileWithBackup(context, htaccessPath, newContent, 'Fix .htaccess configuration issues');
        
        if (change) {
          rollbackSteps.push(this.createFileRollbackStep(htaccessPath, backupPath, 1));
          
          evidence.push({
            type: 'file_content',
            description: 'Fixed .htaccess configuration',
            content: 'Applied security headers, upload limits, and rewrite rules',
            signature: this.generateSignature(newContent),
            timestamp: new Date(),
          });

          return { change, evidence, rollbackSteps };
        }
      }
    }

    return { evidence, rollbackSteps };
  }

  private async fixUploadLimits(context: FixContext, server: WebServerInfo): Promise<{
    change?: FixChange;
    rollbackSteps: RollbackStep[];
    evidence: FixEvidence[];
  }> {
    const evidence: FixEvidence[] = [];
    const rollbackSteps: RollbackStep[] = [];

    // Get current upload limits
    const currentLimits = await this.executeCommand(
      context,
      `php -r "echo 'upload_max_filesize: ' . ini_get('upload_max_filesize') . '\\n'; echo 'post_max_size: ' . ini_get('post_max_size') . '\\n'; echo 'max_file_uploads: ' . ini_get('max_file_uploads') . '\\n';"`,
      'Get current PHP upload limits'
    );

    evidence.push({
      type: 'system_info',
      description: 'Current PHP upload limits',
      content: currentLimits.stdout,
      signature: this.generateSignature(currentLimits.stdout),
      timestamp: new Date(),
    });

    // Check if limits are too low (less than 32M)
    const uploadMaxMatch = currentLimits.stdout.match(/upload_max_filesize: (\d+)([KMG]?)/);
    const postMaxMatch = currentLimits.stdout.match(/post_max_size: (\d+)([KMG]?)/);

    if (uploadMaxMatch && postMaxMatch) {
      const uploadMax = this.parseSize(uploadMaxMatch[1], uploadMaxMatch[2]);
      const postMax = this.parseSize(postMaxMatch[1], postMaxMatch[2]);
      const minSize = 32 * 1024 * 1024; // 32MB

      if (uploadMax < minSize || postMax < minSize) {
        // Update wp-config.php with increased limits
        const wpConfigPath = `${context.wordpressPath}/wp-config.php`;
        const exists = await this.fileExists(context, wpConfigPath);
        
        if (exists) {
          const currentContent = await this.getFileContent(context, wpConfigPath);
          if (currentContent) {
            const backupPath = await this.createBackup(context, wpConfigPath, 'Backup wp-config.php before upload limit fix');
            if (backupPath) {
              let newContent = currentContent;
              const uploadDirectives = `
// Increased upload limits - WP-AutoHealer
ini_set('upload_max_filesize', '64M');
ini_set('post_max_size', '64M');
ini_set('max_file_uploads', '20');
`;

              if (!newContent.includes('upload_max_filesize')) {
                const phpTagRegex = /(<\?php)/;
                if (phpTagRegex.test(newContent)) {
                  newContent = newContent.replace(phpTagRegex, `$1${uploadDirectives}`);
                }
              }

              const change = await this.writeFileWithBackup(context, wpConfigPath, newContent, 'Increase PHP upload limits');
              
              if (change) {
                rollbackSteps.push(this.createFileRollbackStep(wpConfigPath, backupPath, 1));
                
                evidence.push({
                  type: 'file_content',
                  description: 'Increased PHP upload limits',
                  content: 'Set upload_max_filesize=64M, post_max_size=64M, max_file_uploads=20',
                  signature: this.generateSignature(newContent),
                  timestamp: new Date(),
                });

                return { change, evidence, rollbackSteps };
              }
            }
          }
        }
      }
    }

    return { evidence, rollbackSteps };
  }

  private async fixTimeoutSettings(context: FixContext, server: WebServerInfo): Promise<{
    change?: FixChange;
    rollbackSteps: RollbackStep[];
    evidence: FixEvidence[];
  }> {
    const evidence: FixEvidence[] = [];
    const rollbackSteps: RollbackStep[] = [];

    // Get current timeout settings
    const currentTimeouts = await this.executeCommand(
      context,
      `php -r "echo 'max_execution_time: ' . ini_get('max_execution_time') . '\\n'; echo 'max_input_time: ' . ini_get('max_input_time') . '\\n';"`,
      'Get current PHP timeout settings'
    );

    evidence.push({
      type: 'system_info',
      description: 'Current PHP timeout settings',
      content: currentTimeouts.stdout,
      signature: this.generateSignature(currentTimeouts.stdout),
      timestamp: new Date(),
    });

    // Check if timeouts are too low
    const executionTimeMatch = currentTimeouts.stdout.match(/max_execution_time: (\d+)/);
    const inputTimeMatch = currentTimeouts.stdout.match(/max_input_time: (\d+)/);

    if (executionTimeMatch && inputTimeMatch) {
      const executionTime = parseInt(executionTimeMatch[1], 10);
      const inputTime = parseInt(inputTimeMatch[1], 10);

      if (executionTime < 300 || inputTime < 300) {
        // Update wp-config.php with increased timeouts
        const wpConfigPath = `${context.wordpressPath}/wp-config.php`;
        const exists = await this.fileExists(context, wpConfigPath);
        
        if (exists) {
          const currentContent = await this.getFileContent(context, wpConfigPath);
          if (currentContent) {
            const backupPath = await this.createBackup(context, wpConfigPath, 'Backup wp-config.php before timeout fix');
            if (backupPath) {
              let newContent = currentContent;
              const timeoutDirectives = `
// Increased timeout settings - WP-AutoHealer
ini_set('max_execution_time', 300);
ini_set('max_input_time', 300);
`;

              if (!newContent.includes('max_execution_time')) {
                const phpTagRegex = /(<\?php)/;
                if (phpTagRegex.test(newContent)) {
                  newContent = newContent.replace(phpTagRegex, `$1${timeoutDirectives}`);
                }
              }

              const change = await this.writeFileWithBackup(context, wpConfigPath, newContent, 'Increase PHP timeout settings');
              
              if (change) {
                rollbackSteps.push(this.createFileRollbackStep(wpConfigPath, backupPath, 1));
                
                evidence.push({
                  type: 'file_content',
                  description: 'Increased PHP timeout settings',
                  content: 'Set max_execution_time=300, max_input_time=300',
                  signature: this.generateSignature(newContent),
                  timestamp: new Date(),
                });

                return { change, evidence, rollbackSteps };
              }
            }
          }
        }
      }
    }

    return { evidence, rollbackSteps };
  }

  private async fixDirectoryPermissions(context: FixContext): Promise<{
    change?: FixChange;
    evidence: FixEvidence[];
  }> {
    const evidence: FixEvidence[] = [];

    // Check and fix WordPress directory permissions
    const permissionChecks = [
      { path: context.wordpressPath, expectedPerm: '755', type: 'directory' },
      { path: `${context.wordpressPath}/wp-content`, expectedPerm: '755', type: 'directory' },
      { path: `${context.wordpressPath}/wp-content/uploads`, expectedPerm: '755', type: 'directory' },
      { path: `${context.wordpressPath}/wp-config.php`, expectedPerm: '600', type: 'file' },
    ];

    let fixedPermissions = false;

    for (const check of permissionChecks) {
      const exists = await this.fileExists(context, check.path);
      if (!exists) continue;

      // Get current permissions
      const permResult = await this.executeCommand(
        context,
        `stat -c "%a" "${check.path}" 2>/dev/null || echo "unknown"`,
        `Check permissions for ${check.path}`
      );

      const currentPerm = permResult.stdout.trim();
      
      evidence.push({
        type: 'system_info',
        description: `Permissions for ${check.path}`,
        content: `Current: ${currentPerm}, Expected: ${check.expectedPerm}`,
        signature: this.generateSignature(`perm_${check.path}_${currentPerm}`),
        timestamp: new Date(),
      });

      if (currentPerm !== check.expectedPerm && currentPerm !== 'unknown') {
        const chmodResult = await this.executeCommand(
          context,
          `chmod ${check.expectedPerm} "${check.path}"`,
          `Fix permissions for ${check.path}`
        );

        if (chmodResult.success) {
          fixedPermissions = true;
        }
      }
    }

    if (fixedPermissions) {
      return {
        change: {
          type: 'command',
          description: 'Fixed WordPress directory permissions',
          command: 'chmod commands',
          timestamp: new Date(),
        },
        evidence,
      };
    }

    return { evidence };
  }

  private async restartWebServer(context: FixContext, server: WebServerInfo): Promise<{
    change?: FixChange;
    evidence: FixEvidence[];
  }> {
    const evidence: FixEvidence[] = [];

    let restartCommand = '';
    switch (server.type) {
      case 'apache':
        restartCommand = 'systemctl restart apache2 2>/dev/null || service apache2 restart 2>/dev/null || systemctl restart httpd 2>/dev/null || service httpd restart';
        break;
      case 'nginx':
        restartCommand = 'systemctl restart nginx 2>/dev/null || service nginx restart';
        break;
      case 'litespeed':
        restartCommand = '/usr/local/lsws/bin/lswsctrl restart';
        break;
      default:
        evidence.push({
          type: 'system_info',
          description: 'Web server restart skipped',
          content: `Unknown web server type: ${server.type}`,
          signature: this.generateSignature(`restart_skip_${server.type}`),
          timestamp: new Date(),
        });
        return { evidence };
    }

    const restartResult = await this.executeCommand(
      context,
      restartCommand,
      `Restart ${server.type} web server`
    );

    evidence.push({
      type: 'command_output',
      description: `Restart ${server.type} web server`,
      content: restartResult.stdout + restartResult.stderr,
      signature: this.generateSignature(restartResult.stdout),
      timestamp: new Date(),
    });

    if (restartResult.success || restartResult.exitCode === 0) {
      return {
        change: {
          type: 'command',
          description: `Restarted ${server.type} web server`,
          command: restartCommand,
          timestamp: new Date(),
        },
        evidence,
      };
    }

    return { evidence };
  }

  private parseSize(value: string, unit: string): number {
    const numValue = parseInt(value, 10);
    switch (unit?.toUpperCase()) {
      case 'K': return numValue * 1024;
      case 'M': return numValue * 1024 * 1024;
      case 'G': return numValue * 1024 * 1024 * 1024;
      default: return numValue;
    }
  }
}