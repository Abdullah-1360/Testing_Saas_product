import { Injectable } from '@nestjs/common';
import { BaseFixPlaybook } from '../base/base-fix-playbook';
import { 
  FixTier, 
  FixPriority, 
  FixContext, 
  FixResult, 
  FixEvidence, 
  RollbackPlan,
  FixChange
} from '../interfaces/fix-playbook.interface';

@Injectable()
export class PluginConflictDetectionService extends BaseFixPlaybook {
  readonly name = 'Plugin Conflict Detection';
  readonly tier = FixTier.TIER_3_PLUGIN_THEME_CONFLICTS;
  readonly priority = FixPriority.CRITICAL;
  readonly description = 'Detects and isolates conflicting WordPress plugins causing site errors';
  readonly applicableConditions = [
    'PHP fatal errors in plugin files',
    'Plugin-related error messages in logs',
    'Site errors after plugin activation',
    'Plugin compatibility issues',
    'Memory exhaustion from plugins'
  ];

  async canApply(context: FixContext, evidence: FixEvidence[]): Promise<boolean> {
    // Check if evidence suggests plugin-related issues
    const hasPluginErrors = evidence.some(e => 
      e.content.toLowerCase().includes('plugin') ||
      e.content.toLowerCase().includes('wp-content/plugins') ||
      e.content.toLowerCase().includes('fatal error') && e.content.includes('.php')
    );

    if (!hasPluginErrors) {
      return false;
    }

    // Check if plugins directory exists
    const pluginsPath = `${context.wordpressPath}/wp-content/plugins`;
    const pluginsDirExists = await this.fileExists(context, pluginsPath);

    return pluginsDirExists;
  }

  async apply(context: FixContext): Promise<FixResult> {
    const changes: FixChange[] = [];
    const evidence: FixEvidence[] = [];
    const rollbackSteps: any[] = [];

    try {
      this.logger.log(`Starting plugin conflict detection for incident ${context.incidentId}`);

      // Step 1: Get list of active plugins
      const activePlugins = await this.getActivePlugins(context);
      evidence.push({
        type: 'system_info',
        description: 'Active WordPress plugins',
        content: JSON.stringify(activePlugins),
        signature: this.generateSignature(JSON.stringify(activePlugins)),
        timestamp: new Date(),
      });

      if (activePlugins.length === 0) {
        return {
          success: true,
          applied: false,
          changes: [],
          evidence,
          metadata: {
            reason: 'no_active_plugins',
            message: 'No active plugins found to check for conflicts',
          },
        };
      }

      // Step 2: Check recent error logs for plugin-specific errors
      const pluginErrors = await this.analyzePluginErrors(context, activePlugins);
      evidence.push({
        type: 'log',
        description: 'Plugin error analysis',
        content: JSON.stringify(pluginErrors),
        signature: this.generateSignature(JSON.stringify(pluginErrors)),
        timestamp: new Date(),
      });

      // Step 3: Identify problematic plugins
      const problematicPlugins = this.identifyProblematicPlugins(pluginErrors);
      
      if (problematicPlugins.length === 0) {
        return {
          success: true,
          applied: false,
          changes: [],
          evidence,
          metadata: {
            reason: 'no_conflicts_detected',
            message: 'No plugin conflicts detected in error logs',
          },
        };
      }

      this.logger.log(`Found ${problematicPlugins.length} problematic plugins: ${problematicPlugins.join(', ')}`);

      // Step 4: Create backup of current plugin state
      const pluginStateBackup = await this.backupPluginState(context);
      if (!pluginStateBackup) {
        throw new Error('Failed to create plugin state backup');
      }

      rollbackSteps.push(this.createCommandRollbackStep(
        `cp "${pluginStateBackup}" "${context.wordpressPath}/wp-content/plugins/.wp-autohealer-active-plugins"`,
        'Restore original plugin state',
        1
      ));

      // Step 5: Temporarily deactivate problematic plugins
      const deactivationResults = await this.deactivateProblematicPlugins(context, problematicPlugins);
      
      for (const result of deactivationResults) {
        if (result.success) {
          changes.push({
            type: 'config',
            description: `Deactivated plugin: ${result.plugin}`,
            originalValue: 'active',
            newValue: 'inactive',
            timestamp: new Date(),
          });

          // Add rollback step to reactivate plugin
          rollbackSteps.push(this.createCommandRollbackStep(
            this.getPluginActivationCommand(context, result.plugin),
            `Reactivate plugin: ${result.plugin}`,
            rollbackSteps.length + 1
          ));
        }
      }

      // Step 6: Test site functionality after deactivation
      const siteTestResult = await this.testSiteAfterPluginChanges(context);
      evidence.push({
        type: 'system_info',
        description: 'Site functionality test after plugin deactivation',
        content: JSON.stringify(siteTestResult),
        signature: this.generateSignature(JSON.stringify(siteTestResult)),
        timestamp: new Date(),
      });

      const rollbackPlan: RollbackPlan = {
        steps: rollbackSteps,
        metadata: {
          originalPlugins: activePlugins,
          deactivatedPlugins: problematicPlugins,
          backupPath: pluginStateBackup,
        },
        createdAt: new Date(),
      };

      return {
        success: true,
        applied: changes.length > 0,
        changes,
        evidence,
        rollbackPlan,
        metadata: {
          problematicPlugins,
          deactivatedCount: deactivationResults.filter(r => r.success).length,
          siteWorking: siteTestResult.working,
        },
      };

    } catch (error) {
      this.logger.error(`Plugin conflict detection failed for incident ${context.incidentId}:`, error);
      
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
      this.logger.log(`Rolling back plugin conflict detection for incident ${context.incidentId}`);

      // Execute rollback steps in reverse order
      const sortedSteps = rollbackPlan.steps.sort((a, b) => b.order - a.order);

      for (const step of sortedSteps) {
        const result = await this.executeCommand(context, step.action, step.description);
        if (!result.success) {
          this.logger.error(`Rollback step failed: ${step.description}`);
          return false;
        }
      }

      this.logger.log(`Plugin conflict detection rollback completed for incident ${context.incidentId}`);
      return true;

    } catch (error) {
      this.logger.error(`Plugin conflict detection rollback failed for incident ${context.incidentId}:`, error);
      return false;
    }
  }

  getHypothesis(_context: FixContext, evidence: FixEvidence[]): string {
    const pluginErrors = evidence.filter(e => 
      e.content.toLowerCase().includes('plugin') ||
      e.content.toLowerCase().includes('wp-content/plugins')
    );

    if (pluginErrors.length > 0) {
      return `Site errors appear to be caused by plugin conflicts. Detected ${pluginErrors.length} plugin-related error(s) in logs. Will identify and temporarily deactivate problematic plugins to restore site functionality.`;
    }

    return 'Site errors may be caused by plugin conflicts. Will analyze active plugins and error logs to identify and isolate problematic plugins.';
  }

  private async getActivePlugins(context: FixContext): Promise<string[]> {
    const result = await this.executeCommand(
      context,
      `cd "${context.wordpressPath}" && php -r "
        if (file_exists('wp-load.php')) {
          define('WP_USE_THEMES', false);
          require_once('wp-load.php');
          if (function_exists('get_option')) {
            \$active_plugins = get_option('active_plugins', array());
            echo json_encode(\$active_plugins);
          } else {
            echo '[]';
          }
        } else {
          echo '[]';
        }
      "`,
      'Get active WordPress plugins'
    );

    if (!result.success) {
      return [];
    }

    try {
      const plugins = JSON.parse(result.stdout);
      return Array.isArray(plugins) ? plugins : [];
    } catch {
      return [];
    }
  }

  private async analyzePluginErrors(context: FixContext, activePlugins: string[]): Promise<any[]> {
    const errors: any[] = [];

    // Check PHP error log for plugin-related errors
    const errorLogResult = await this.executeCommand(
      context,
      `tail -n 100 /var/log/php_errors.log 2>/dev/null || tail -n 100 /var/log/apache2/error.log 2>/dev/null || echo "No error log found"`,
      'Check error logs for plugin issues'
    );

    if (errorLogResult.success && errorLogResult.stdout !== 'No error log found') {
      const logLines = errorLogResult.stdout.split('\n');
      
      for (const plugin of activePlugins) {
        const pluginName = plugin.split('/')[0];
        if (pluginName) {
          const pluginErrors = logLines.filter(line => 
            line.toLowerCase().includes(pluginName.toLowerCase()) ||
            line.includes(`wp-content/plugins/${pluginName}`)
          );

          if (pluginErrors.length > 0) {
            errors.push({
              plugin: pluginName,
              errors: pluginErrors,
              severity: this.assessErrorSeverity(pluginErrors),
            });
          }
        }
      }
    }

    return errors;
  }

  private identifyProblematicPlugins(pluginErrors: any[]): string[] {
    return pluginErrors
      .filter(error => error.severity === 'critical' || error.severity === 'high')
      .map(error => error.plugin);
  }

  private assessErrorSeverity(errors: string[]): 'low' | 'medium' | 'high' | 'critical' {
    const criticalKeywords = ['fatal error', 'cannot redeclare', 'memory exhausted'];
    const highKeywords = ['warning', 'deprecated', 'notice'];

    const hasCritical = errors.some(error => 
      criticalKeywords.some(keyword => error.toLowerCase().includes(keyword))
    );

    const hasHigh = errors.some(error => 
      highKeywords.some(keyword => error.toLowerCase().includes(keyword))
    );

    if (hasCritical) return 'critical';
    if (hasHigh) return 'high';
    if (errors.length > 5) return 'medium';
    return 'low';
  }

  private async backupPluginState(context: FixContext): Promise<string | null> {
    const backupPath = `${context.wordpressPath}/wp-content/.wp-autohealer-plugin-backup-${Date.now()}`;
    
    const result = await this.executeCommand(
      context,
      `cd "${context.wordpressPath}" && php -r "
        if (file_exists('wp-load.php')) {
          define('WP_USE_THEMES', false);
          require_once('wp-load.php');
          if (function_exists('get_option')) {
            \$active_plugins = get_option('active_plugins', array());
            file_put_contents('${backupPath}', json_encode(\$active_plugins));
            echo 'BACKUP_SUCCESS';
          } else {
            echo 'BACKUP_FAILED';
          }
        } else {
          echo 'BACKUP_FAILED';
        }
      "`,
      'Backup current plugin state'
    );

    return result.success && result.stdout.includes('BACKUP_SUCCESS') ? backupPath : null;
  }

  private async deactivateProblematicPlugins(context: FixContext, plugins: string[]): Promise<any[]> {
    const results: any[] = [];

    for (const plugin of plugins) {
      const result = await this.executeCommand(
        context,
        `cd "${context.wordpressPath}" && php -r "
          if (file_exists('wp-load.php')) {
            define('WP_USE_THEMES', false);
            require_once('wp-load.php');
            if (function_exists('deactivate_plugins')) {
              deactivate_plugins('${plugin}/${plugin}.php');
              echo 'DEACTIVATED';
            } else {
              echo 'FAILED';
            }
          } else {
            echo 'FAILED';
          }
        "`,
        `Deactivate plugin: ${plugin}`
      );

      results.push({
        plugin,
        success: result.success && result.stdout.includes('DEACTIVATED'),
        output: result.stdout,
      });
    }

    return results;
  }

  private getPluginActivationCommand(context: FixContext, plugin: string): string {
    return `cd "${context.wordpressPath}" && php -r "
      if (file_exists('wp-load.php')) {
        define('WP_USE_THEMES', false);
        require_once('wp-load.php');
        if (function_exists('activate_plugin')) {
          activate_plugin('${plugin}/${plugin}.php');
        }
      }
    "`;
  }

  private async testSiteAfterPluginChanges(context: FixContext): Promise<any> {
    // Test if the site loads without errors
    const testResult = await this.executeCommand(
      context,
      `curl -s -o /dev/null -w "%{http_code}" "${context.domain}" || echo "CURL_FAILED"`,
      'Test site accessibility after plugin changes'
    );

    const httpCode = testResult.stdout.trim();
    const working = httpCode === '200';

    return {
      working,
      httpCode,
      accessible: testResult.success,
    };
  }
}