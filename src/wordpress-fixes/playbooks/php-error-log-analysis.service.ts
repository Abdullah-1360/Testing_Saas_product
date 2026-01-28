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

interface ErrorPattern {
  pattern: RegExp;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  fixAction?: string;
}

@Injectable()
export class PhpErrorLogAnalysisService extends BaseFixPlaybook {
  readonly name = 'php-error-log-analysis';
  readonly tier = FixTier.TIER_1_INFRASTRUCTURE;
  readonly priority = FixPriority.MEDIUM;
  readonly description = 'Analyze PHP error logs and apply fixes for common PHP configuration issues';
  readonly applicableConditions = [
    'php_fatal_error',
    'php_parse_error',
    'php_warning',
    'undefined_function',
    'class_not_found',
    'permission_denied'
  ];

  private readonly ERROR_PATTERNS: ErrorPattern[] = [
    {
      pattern: /Fatal error:.*Maximum execution time.*exceeded/i,
      description: 'PHP execution time limit exceeded',
      severity: 'high',
      fixAction: 'increase_execution_time'
    },
    {
      pattern: /Fatal error:.*Allowed memory size.*exhausted/i,
      description: 'PHP memory limit exhausted',
      severity: 'critical',
      fixAction: 'increase_memory_limit'
    },
    {
      pattern: /Parse error:|Fatal error:.*syntax error/i,
      description: 'PHP syntax error',
      severity: 'critical',
      fixAction: 'check_recent_changes'
    },
    {
      pattern: /Fatal error:.*Call to undefined function/i,
      description: 'Undefined function call',
      severity: 'high',
      fixAction: 'check_missing_extensions'
    },
    {
      pattern: /Fatal error:.*Class.*not found/i,
      description: 'Class not found',
      severity: 'high',
      fixAction: 'check_autoloader'
    },
    {
      pattern: /Warning:.*failed to open stream.*Permission denied/i,
      description: 'File permission issues',
      severity: 'medium',
      fixAction: 'fix_permissions'
    },
    {
      pattern: /Warning:.*file_get_contents.*failed to open stream/i,
      description: 'File access issues',
      severity: 'medium',
      fixAction: 'check_file_paths'
    },
    {
      pattern: /Fatal error:.*Cannot redeclare/i,
      description: 'Function/class redeclaration',
      severity: 'high',
      fixAction: 'check_duplicate_includes'
    }
  ];

  constructor(
    sshService: SSHService,
    backupService: BackupService,
    evidenceService: EvidenceService,
  ) {
    super(sshService, backupService, evidenceService);
  }

  async canApply(context: FixContext, evidence: FixEvidence[]): Promise<boolean> {
    // Check if evidence contains PHP errors
    return evidence.some(e => 
      e.content.toLowerCase().includes('fatal error') ||
      e.content.toLowerCase().includes('parse error') ||
      e.content.toLowerCase().includes('php warning') ||
      e.content.toLowerCase().includes('undefined function') ||
      e.content.toLowerCase().includes('class') && e.content.toLowerCase().includes('not found')
    );
  }

  async apply(context: FixContext): Promise<FixResult> {
    const changes: FixChange[] = [];
    const evidence: FixEvidence[] = [];
    const rollbackSteps: RollbackStep[] = [];

    try {
      this.logger.log(`Starting PHP error log analysis for incident ${context.incidentId}`);

      // 1. Find and analyze PHP error logs
      const errorLogs = await this.findPhpErrorLogs(context);
      evidence.push(...errorLogs.evidence);

      if (errorLogs.logFiles.length === 0) {
        return {
          success: false,
          applied: false,
          changes,
          evidence,
          error: 'No PHP error logs found',
        };
      }

      // 2. Analyze errors in each log file
      const analysisResults = await this.analyzeErrorLogs(context, errorLogs.logFiles);
      evidence.push(...analysisResults.evidence);

      if (analysisResults.errors.length === 0) {
        return {
          success: true,
          applied: false,
          changes,
          evidence,
          metadata: {
            message: 'No actionable PHP errors found in logs',
            logsAnalyzed: errorLogs.logFiles.length,
          },
        };
      }

      // 3. Apply fixes based on error analysis
      const fixResults = await this.applyErrorFixes(context, analysisResults.errors);
      changes.push(...fixResults.changes);
      rollbackSteps.push(...fixResults.rollbackSteps);
      evidence.push(...fixResults.evidence);

      // 4. Clean up old error logs if fixes were applied
      if (changes.length > 0) {
        const cleanupResult = await this.cleanupErrorLogs(context, errorLogs.logFiles);
        if (cleanupResult.change) {
          changes.push(cleanupResult.change);
        }
        evidence.push(...cleanupResult.evidence);
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
            errorsFound: analysisResults.errors.length,
            fixesApplied: changes.length,
          },
          createdAt: new Date(),
        } : undefined,
        metadata: {
          errorsAnalyzed: analysisResults.errors.length,
          fixesApplied: changes.length,
          logsProcessed: errorLogs.logFiles.length,
        },
      };

    } catch (error) {
      this.logger.error(`PHP error log analysis failed for incident ${context.incidentId}:`, error);
      
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
      this.logger.log(`Rolling back PHP error log fixes for incident ${context.incidentId}`);

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
    const phpErrors = evidence.filter(e => 
      e.content.toLowerCase().includes('fatal error') ||
      e.content.toLowerCase().includes('parse error')
    );

    if (phpErrors.length > 0) {
      return 'WordPress site is experiencing PHP errors that are preventing normal operation. Analyzing error logs and applying targeted fixes should resolve the issues.';
    }

    return 'Proactive PHP error log analysis to identify and resolve potential issues before they cause site failures.';
  }

  private async findPhpErrorLogs(context: FixContext): Promise<{
    logFiles: string[];
    evidence: FixEvidence[];
  }> {
    const evidence: FixEvidence[] = [];
    const logFiles: string[] = [];

    // Common PHP error log locations
    const logPaths = [
      '/var/log/php_errors.log',
      '/var/log/php/error.log',
      `${context.sitePath}/error_log`,
      `${context.sitePath}/php_errors.log`,
      `${context.wordpressPath}/error_log`,
      `${context.wordpressPath}/wp-content/debug.log`,
      `${context.wordpressPath}/wp-content/uploads/error_log`,
    ];

    // Find existing log files
    for (const logPath of logPaths) {
      const exists = await this.fileExists(context, logPath);
      if (exists) {
        // Check if file has recent content
        const sizeResult = await this.executeCommand(
          context,
          `stat -c%s "${logPath}" 2>/dev/null || echo "0"`,
          `Check log file size: ${logPath}`
        );

        const size = parseInt(sizeResult.stdout.trim(), 10);
        if (size > 0) {
          logFiles.push(logPath);
        }
      }
    }

    // Also check for PHP-FPM error logs
    const phpFpmResult = await this.executeCommand(
      context,
      `find /var/log -name "*php*" -name "*.log" -type f -size +0c 2>/dev/null | head -5`,
      'Find PHP-FPM error logs'
    );

    if (phpFpmResult.success && phpFpmResult.stdout.trim()) {
      const additionalLogs = phpFpmResult.stdout.trim().split('\n');
      logFiles.push(...additionalLogs.filter(log => !logFiles.includes(log)));
    }

    evidence.push({
      type: 'system_info',
      description: 'PHP error log files found',
      content: JSON.stringify(logFiles),
      signature: this.generateSignature(JSON.stringify(logFiles)),
      timestamp: new Date(),
    });

    return { logFiles, evidence };
  }

  private async analyzeErrorLogs(context: FixContext, logFiles: string[]): Promise<{
    errors: Array<{ file: string; pattern: ErrorPattern; matches: string[] }>;
    evidence: FixEvidence[];
  }> {
    const evidence: FixEvidence[] = [];
    const errors: Array<{ file: string; pattern: ErrorPattern; matches: string[] }> = [];

    for (const logFile of logFiles) {
      // Get recent log entries (last 100 lines)
      const logContent = await this.executeCommand(
        context,
        `tail -n 100 "${logFile}" 2>/dev/null || echo ""`,
        `Read recent entries from ${logFile}`
      );

      if (!logContent.success || !logContent.stdout.trim()) {
        continue;
      }

      evidence.push({
        type: 'log',
        description: `Recent PHP errors from ${logFile}`,
        content: logContent.stdout,
        signature: this.generateSignature(logContent.stdout),
        timestamp: new Date(),
        metadata: { logFile },
      });

      // Analyze log content against error patterns
      for (const pattern of this.ERROR_PATTERNS) {
        const matches = logContent.stdout.match(new RegExp(pattern.pattern.source, 'gim'));
        if (matches && matches.length > 0) {
          errors.push({
            file: logFile,
            pattern,
            matches: [...new Set(matches)], // Remove duplicates
          });
        }
      }
    }

    // Create summary evidence
    evidence.push({
      type: 'system_info',
      description: 'PHP error analysis summary',
      content: JSON.stringify({
        totalErrors: errors.length,
        errorsByType: errors.reduce((acc, error) => {
          acc[error.pattern.description] = (acc[error.pattern.description] || 0) + error.matches.length;
          return acc;
        }, {} as Record<string, number>),
      }),
      signature: this.generateSignature(`errors_${errors.length}`),
      timestamp: new Date(),
    });

    return { errors, evidence };
  }

  private async applyErrorFixes(
    context: FixContext, 
    errors: Array<{ file: string; pattern: ErrorPattern; matches: string[] }>
  ): Promise<{
    changes: FixChange[];
    rollbackSteps: RollbackStep[];
    evidence: FixEvidence[];
  }> {
    const changes: FixChange[] = [];
    const rollbackSteps: RollbackStep[] = [];
    const evidence: FixEvidence[] = [];

    // Group errors by fix action
    const errorsByAction = errors.reduce((acc, error) => {
      if (error.pattern.fixAction) {
        if (!acc[error.pattern.fixAction]) {
          acc[error.pattern.fixAction] = [];
        }
        acc[error.pattern.fixAction].push(error);
      }
      return acc;
    }, {} as Record<string, typeof errors>);

    // Apply fixes for each action type
    for (const [action, actionErrors] of Object.entries(errorsByAction)) {
      try {
        const fixResult = await this.applySpecificFix(context, action, actionErrors);
        if (fixResult.change) {
          changes.push(fixResult.change);
          rollbackSteps.push(...fixResult.rollbackSteps);
        }
        evidence.push(...fixResult.evidence);
      } catch (error) {
        this.logger.error(`Failed to apply fix for action ${action}:`, error);
        evidence.push({
          type: 'system_info',
          description: `Fix application failed: ${action}`,
          content: error instanceof Error ? error.message : 'Unknown error',
          signature: this.generateSignature(`fix_failed_${action}`),
          timestamp: new Date(),
        });
      }
    }

    return { changes, rollbackSteps, evidence };
  }

  private async applySpecificFix(
    context: FixContext,
    action: string,
    errors: Array<{ file: string; pattern: ErrorPattern; matches: string[] }>
  ): Promise<{
    change?: FixChange;
    rollbackSteps: RollbackStep[];
    evidence: FixEvidence[];
  }> {
    const evidence: FixEvidence[] = [];
    const rollbackSteps: RollbackStep[] = [];

    switch (action) {
      case 'increase_execution_time':
        return await this.fixExecutionTimeLimit(context);
      
      case 'fix_permissions':
        return await this.fixFilePermissions(context);
      
      case 'check_missing_extensions':
        return await this.checkMissingExtensions(context, errors);
      
      case 'check_recent_changes':
        return await this.checkRecentChanges(context);
      
      default:
        evidence.push({
          type: 'system_info',
          description: `No specific fix available for action: ${action}`,
          content: `Action: ${action}, Errors: ${errors.length}`,
          signature: this.generateSignature(`no_fix_${action}`),
          timestamp: new Date(),
        });
        return { evidence, rollbackSteps };
    }
  }

  private async fixExecutionTimeLimit(context: FixContext): Promise<{
    change?: FixChange;
    rollbackSteps: RollbackStep[];
    evidence: FixEvidence[];
  }> {
    const evidence: FixEvidence[] = [];
    const rollbackSteps: RollbackStep[] = [];

    // Update wp-config.php with increased execution time
    const wpConfigPath = `${context.wordpressPath}/wp-config.php`;
    const exists = await this.fileExists(context, wpConfigPath);
    
    if (!exists) {
      evidence.push({
        type: 'system_info',
        description: 'wp-config.php not found for execution time fix',
        content: `File not found: ${wpConfigPath}`,
        signature: this.generateSignature(`wpconfig_not_found_${wpConfigPath}`),
        timestamp: new Date(),
      });
      return { evidence, rollbackSteps };
    }

    const currentContent = await this.getFileContent(context, wpConfigPath);
    if (!currentContent) {
      return { evidence, rollbackSteps };
    }

    // Create backup
    const backupPath = await this.createBackup(context, wpConfigPath, 'Backup wp-config.php before execution time fix');
    if (!backupPath) {
      return { evidence, rollbackSteps };
    }

    // Add execution time limit increase
    let newContent = currentContent;
    const executionTimeDirective = `ini_set('max_execution_time', 300);`;
    
    if (!newContent.includes('max_execution_time')) {
      // Add after the opening PHP tag
      const phpTagRegex = /(<\?php)/;
      if (phpTagRegex.test(newContent)) {
        newContent = newContent.replace(phpTagRegex, `$1\n\n// Increased execution time - WP-AutoHealer\n${executionTimeDirective}\n`);
      }
    }

    const change = await this.writeFileWithBackup(context, wpConfigPath, newContent, 'Increase PHP execution time limit');
    
    if (change) {
      rollbackSteps.push(this.createFileRollbackStep(wpConfigPath, backupPath, 1));
      
      evidence.push({
        type: 'file_content',
        description: 'Increased PHP execution time limit',
        content: executionTimeDirective,
        signature: this.generateSignature(newContent),
        timestamp: new Date(),
      });

      return { change, evidence, rollbackSteps };
    }

    return { evidence, rollbackSteps };
  }

  private async fixFilePermissions(context: FixContext): Promise<{
    change?: FixChange;
    rollbackSteps: RollbackStep[];
    evidence: FixEvidence[];
  }> {
    const evidence: FixEvidence[] = [];
    const rollbackSteps: RollbackStep[] = [];

    // Fix common WordPress file permissions
    const permissionCommands = [
      `find "${context.wordpressPath}" -type d -exec chmod 755 {} \\;`,
      `find "${context.wordpressPath}" -type f -exec chmod 644 {} \\;`,
      `chmod 600 "${context.wordpressPath}/wp-config.php"`,
    ];

    let fixedPermissions = false;

    for (const command of permissionCommands) {
      const result = await this.executeCommand(context, command, 'Fix WordPress file permissions');
      
      if (result.success) {
        fixedPermissions = true;
      }

      evidence.push({
        type: 'command_output',
        description: 'File permission fix',
        content: `Command: ${command}\nResult: ${result.success ? 'Success' : 'Failed'}`,
        signature: this.generateSignature(command + result.stdout),
        timestamp: new Date(),
      });
    }

    if (fixedPermissions) {
      return {
        change: {
          type: 'command',
          description: 'Fixed WordPress file permissions',
          command: 'chmod/find commands',
          timestamp: new Date(),
        },
        evidence,
        rollbackSteps, // Permission fixes are generally not rolled back
      };
    }

    return { evidence, rollbackSteps };
  }

  private async checkMissingExtensions(
    context: FixContext,
    errors: Array<{ file: string; pattern: ErrorPattern; matches: string[] }>
  ): Promise<{
    change?: FixChange;
    rollbackSteps: RollbackStep[];
    evidence: FixEvidence[];
  }> {
    const evidence: FixEvidence[] = [];
    const rollbackSteps: RollbackStep[] = [];

    // Extract function names from error messages
    const missingFunctions = new Set<string>();
    
    for (const error of errors) {
      for (const match of error.matches) {
        const functionMatch = match.match(/Call to undefined function (\w+)/i);
        if (functionMatch) {
          missingFunctions.add(functionMatch[1]);
        }
      }
    }

    // Check which PHP extensions might be missing
    const extensionMap: Record<string, string> = {
      'curl_init': 'php-curl',
      'mysqli_connect': 'php-mysqli',
      'imagecreatetruecolor': 'php-gd',
      'mb_strlen': 'php-mbstring',
      'simplexml_load_string': 'php-xml',
      'json_encode': 'php-json',
    };

    const missingExtensions = Array.from(missingFunctions)
      .map(func => extensionMap[func])
      .filter(ext => ext);

    evidence.push({
      type: 'system_info',
      description: 'Missing PHP extensions analysis',
      content: JSON.stringify({
        missingFunctions: Array.from(missingFunctions),
        suggestedExtensions: missingExtensions,
      }),
      signature: this.generateSignature(JSON.stringify(missingExtensions)),
      timestamp: new Date(),
    });

    // Note: We don't automatically install extensions as this requires system-level changes
    // This would typically be escalated to system administrators

    return { evidence, rollbackSteps };
  }

  private async checkRecentChanges(context: FixContext): Promise<{
    change?: FixChange;
    rollbackSteps: RollbackStep[];
    evidence: FixEvidence[];
  }> {
    const evidence: FixEvidence[] = [];
    const rollbackSteps: RollbackStep[] = [];

    // Check for recently modified PHP files
    const recentFilesResult = await this.executeCommand(
      context,
      `find "${context.wordpressPath}" -name "*.php" -mtime -1 -type f | head -10`,
      'Find recently modified PHP files'
    );

    evidence.push({
      type: 'system_info',
      description: 'Recently modified PHP files',
      content: recentFilesResult.stdout,
      signature: this.generateSignature(recentFilesResult.stdout),
      timestamp: new Date(),
    });

    // This is primarily for evidence collection
    // Actual syntax error fixes would require manual intervention

    return { evidence, rollbackSteps };
  }

  private async cleanupErrorLogs(context: FixContext, logFiles: string[]): Promise<{
    change?: FixChange;
    evidence: FixEvidence[];
  }> {
    const evidence: FixEvidence[] = [];

    // Truncate error logs after successful fixes
    let cleanedLogs = 0;

    for (const logFile of logFiles) {
      const truncateResult = await this.executeCommand(
        context,
        `truncate -s 0 "${logFile}"`,
        `Clear error log: ${logFile}`
      );

      evidence.push({
        type: 'command_output',
        description: `Clear error log: ${logFile}`,
        content: truncateResult.success ? 'Success' : truncateResult.stderr,
        signature: this.generateSignature(`truncate_${logFile}`),
        timestamp: new Date(),
      });

      if (truncateResult.success) {
        cleanedLogs++;
      }
    }

    if (cleanedLogs > 0) {
      return {
        change: {
          type: 'command',
          description: `Cleared ${cleanedLogs} error log files`,
          command: 'truncate -s 0',
          timestamp: new Date(),
        },
        evidence,
      };
    }

    return { evidence };
  }
}