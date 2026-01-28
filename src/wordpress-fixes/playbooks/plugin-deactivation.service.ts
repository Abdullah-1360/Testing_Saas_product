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
export class PluginDeactivationService extends BaseFixPlaybook {
  readonly name = 'Plugin Deactivation with Backup';
  readonly tier = FixTier.TIER_3_PLUGIN_THEME_CONFLICTS;
  readonly priority = FixPriority.HIGH;
  readonly description = 'Systematically deactivates plugins with backup to isolate conflicts';
  readonly applicableConditions = [
    'Multiple plugin conflicts detected',
    'Plugin causing site-wide errors',
    'Memory issues from plugins',
    'Plugin activation errors',
    'Cascading plugin failures'
  ];

  async canApply(context: FixContext, evidence: FixEvidence[]): Promise<boolean> {
    // Check if evidence suggests plugin-related issues that require deactivation
    const hasPluginIssues = evidence.some(e => 
      e.content.toLowerCase().includes('plugin') ||
      e.content.toLowerCase().includes('wp-content/plugins') ||
      e.content.toLowerCase().includes('activate') ||
      e.content.toLowerCase().includes('deactivate')
    );

    if (!hasPluginIssues) {
      return false;
    }

    // Check if plugins directory exists and has plugins
    const pluginsPath = `${context.wordpressPath}/wp-content/plugins`;
    const pluginsDirExists = await this.fileExists(context, pluginsPath);

    if (!pluginsDirExists) {
      return false;
    }

    // Check if there are active plugins to deactivate
    const activePlugins = await this.getActivePlugins(context);
    return activePlugins.length > 0;
  }

  async apply(context: FixContext): Promise<FixResult> {
    const changes: FixChange[] = [];
    const evidence: FixEvidence[] = [];
    const rollbackSteps: any[] = [];

    try {
      this.logger.log(`Starting systematic plugin deactivation for incident ${context.incidentId}`);

      // Step 1: Get list of all active plugins
      const activePlugins = await this.getActivePlugins(context);
      evidence.push({
        type: 'system_info',
        description: 'Active WordPress plugins before deactivation',
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
            message: 'No active plugins found to deactivate',
          },
        };
      }

      // Step 2: Create comprehensive backup of plugin state
      const pluginBackup = await this.createComprehensivePluginBackup(context, activePlugins);
      if (!pluginBackup.success) {
        throw new Error('Failed to create comprehensive plugin backup');
      }

      evidence.push({
        type: 'system_info',
        description: 'Plugin backup creation',
        content: JSON.stringify(pluginBackup),
        signature: this.generateSignature(JSON.stringify(pluginBackup)),
        timestamp: new Date(),
      });

      // Step 3: Categorize plugins by priority (keep essential, deactivate others)
      const pluginCategories = await this.categorizePlugins(context, activePlugins);
      evidence.push({
        type: 'system_info',
        description: 'Plugin categorization for deactivation strategy',
        content: JSON.stringify(pluginCategories),
        signature: this.generateSignature(JSON.stringify(pluginCategories)),
        timestamp: new Date(),
      });

      // Step 4: Deactivate non-essential plugins first
      const deactivationResults = await this.deactivatePluginsByPriority(context, pluginCategories);
      
      for (const result of deactivationResults) {
        if (result.success) {
          changes.push({
            type: 'config',
            description: `Deactivated plugin: ${result.plugin} (${result.category})`,
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

      // Step 5: Test site after each deactivation phase
      const testResults = await this.testSiteAfterDeactivations(context, deactivationResults);
      evidence.push({
        type: 'system_info',
        description: 'Site functionality tests after plugin deactivations',
        content: JSON.stringify(testResults),
        signature: this.generateSignature(JSON.stringify(testResults)),
        timestamp: new Date(),
      });

      // Step 6: If site is working, try to reactivate essential plugins one by one
      let reactivationResults: any[] = [];
      if (testResults.siteWorking) {
        reactivationResults = await this.selectiveReactivation(context, pluginCategories.essential);
        
        for (const result of reactivationResults) {
          if (result.success && result.reactivated) {
            changes.push({
              type: 'config',
              description: `Reactivated essential plugin: ${result.plugin}`,
              originalValue: 'inactive',
              newValue: 'active',
              timestamp: new Date(),
            });

            // Update rollback step to deactivate this plugin if needed
            const rollbackIndex = rollbackSteps.findIndex(step => 
              step.action.includes(result.plugin)
            );
            if (rollbackIndex !== -1) {
              rollbackSteps.splice(rollbackIndex, 1);
            }
          }
        }
      }

      // Add master rollback step to restore all plugins
      rollbackSteps.unshift(this.createCommandRollbackStep(
        this.getFullPluginRestoreCommand(context, pluginBackup.backupPath),
        'Restore all original plugins from backup',
        0
      ));

      const rollbackPlan: RollbackPlan = {
        steps: rollbackSteps,
        metadata: {
          originalPlugins: activePlugins,
          backupPath: pluginBackup.backupPath,
          deactivatedPlugins: deactivationResults.filter(r => r.success).map(r => r.plugin),
          reactivatedPlugins: reactivationResults.filter(r => r.reactivated).map(r => r.plugin),
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
          totalPlugins: activePlugins.length,
          deactivatedCount: deactivationResults.filter(r => r.success).length,
          reactivatedCount: reactivationResults.filter(r => r.reactivated).length,
          siteWorking: testResults.siteWorking,
          strategy: 'systematic_deactivation',
        },
      };

    } catch (error) {
      this.logger.error(`Plugin deactivation failed for incident ${context.incidentId}:`, error);
      
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
      this.logger.log(`Rolling back plugin deactivation for incident ${context.incidentId}`);

      // Execute rollback steps in reverse order
      const sortedSteps = rollbackPlan.steps.sort((a, b) => b.order - a.order);

      for (const step of sortedSteps) {
        const result = await this.executeCommand(context, step.action, step.description);
        if (!result.success) {
          this.logger.error(`Rollback step failed: ${step.description}`);
          return false;
        }
      }

      this.logger.log(`Plugin deactivation rollback completed for incident ${context.incidentId}`);
      return true;

    } catch (error) {
      this.logger.error(`Plugin deactivation rollback failed for incident ${context.incidentId}:`, error);
      return false;
    }
  }

  getHypothesis(_context: FixContext, evidence: FixEvidence[]): string {
    const pluginEvidence = evidence.filter(e => 
      e.content.toLowerCase().includes('plugin') ||
      e.content.toLowerCase().includes('wp-content/plugins')
    );

    if (pluginEvidence.length > 0) {
      return `Site errors appear to be caused by plugin conflicts requiring systematic deactivation. Detected ${pluginEvidence.length} plugin-related issue(s). Will deactivate non-essential plugins first, test site functionality, then selectively reactivate essential plugins to isolate the problematic ones.`;
    }

    return 'Site errors may require plugin isolation through systematic deactivation. Will create comprehensive backup, categorize plugins by importance, and use a phased deactivation approach to identify and isolate problematic plugins while maintaining essential functionality.';
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

  private async createComprehensivePluginBackup(context: FixContext, activePlugins: string[]): Promise<any> {
    const backupPath = `${context.wordpressPath}/wp-content/.wp-autohealer-plugin-full-backup-${Date.now()}`;
    
    const result = await this.executeCommand(
      context,
      `cd "${context.wordpressPath}" && php -r "
        if (file_exists('wp-load.php')) {
          define('WP_USE_THEMES', false);
          require_once('wp-load.php');
          if (function_exists('get_option')) {
            \$backup_data = array(
              'active_plugins' => get_option('active_plugins', array()),
              'plugin_data' => array(),
              'timestamp' => time()
            );
            
            // Get detailed plugin information
            if (function_exists('get_plugins')) {
              \$all_plugins = get_plugins();
              foreach (\$backup_data['active_plugins'] as \$plugin) {
                if (isset(\$all_plugins[\$plugin])) {
                  \$backup_data['plugin_data'][\$plugin] = \$all_plugins[\$plugin];
                }
              }
            }
            
            file_put_contents('${backupPath}', json_encode(\$backup_data));
            echo 'BACKUP_SUCCESS';
          } else {
            echo 'BACKUP_FAILED';
          }
        } else {
          echo 'BACKUP_FAILED';
        }
      "`,
      'Create comprehensive plugin backup'
    );

    return {
      success: result.success && result.stdout.includes('BACKUP_SUCCESS'),
      backupPath: result.success && result.stdout.includes('BACKUP_SUCCESS') ? backupPath : null,
      pluginCount: activePlugins.length,
    };
  }

  private async categorizePlugins(context: FixContext, activePlugins: string[]): Promise<any> {
    // Define essential plugin patterns (security, backup, etc.)
    const essentialPatterns = [
      'security', 'backup', 'cache', 'seo', 'analytics',
      'wordfence', 'updraft', 'jetpack', 'yoast', 'rankmath'
    ];

    // Define problematic plugin patterns (known to cause conflicts)
    const problematicPatterns = [
      'page-builder', 'visual-composer', 'elementor', 'divi',
      'slider', 'popup', 'social', 'share'
    ];

    const categories = {
      essential: [] as string[],
      standard: [] as string[],
      problematic: [] as string[],
      unknown: [] as string[]
    };

    for (const plugin of activePlugins) {
      const pluginName = plugin.toLowerCase();
      
      if (essentialPatterns.some(pattern => pluginName.includes(pattern))) {
        categories.essential.push(plugin);
      } else if (problematicPatterns.some(pattern => pluginName.includes(pattern))) {
        categories.problematic.push(plugin);
      } else if (pluginName.includes('wp-') || pluginName.includes('wordpress')) {
        categories.standard.push(plugin);
      } else {
        categories.unknown.push(plugin);
      }
    }

    return categories;
  }

  private async deactivatePluginsByPriority(context: FixContext, categories: any): Promise<any[]> {
    const results: any[] = [];
    
    // Deactivation order: problematic -> unknown -> standard (keep essential for last)
    const deactivationOrder = [
      { plugins: categories.problematic, category: 'problematic' },
      { plugins: categories.unknown, category: 'unknown' },
      { plugins: categories.standard, category: 'standard' }
    ];

    for (const group of deactivationOrder) {
      for (const plugin of group.plugins) {
        const result = await this.deactivatePlugin(context, plugin);
        results.push({
          ...result,
          category: group.category,
        });

        // Test site after each deactivation to see if issue is resolved
        if (result.success) {
          const siteTest = await this.quickSiteTest(context);
          if (siteTest.working) {
            this.logger.log(`Site working after deactivating ${plugin}, stopping deactivation process`);
            break;
          }
        }
      }
    }

    return results;
  }

  private async deactivatePlugin(context: FixContext, plugin: string): Promise<any> {
    const result = await this.executeCommand(
      context,
      `cd "${context.wordpressPath}" && php -r "
        if (file_exists('wp-load.php')) {
          define('WP_USE_THEMES', false);
          require_once('wp-load.php');
          if (function_exists('deactivate_plugins')) {
            deactivate_plugins('${plugin}');
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

    return {
      plugin,
      success: result.success && result.stdout.includes('DEACTIVATED'),
      output: result.stdout,
      error: result.success ? null : result.stderr,
    };
  }

  private async testSiteAfterDeactivations(context: FixContext, deactivationResults: any[]): Promise<any> {
    const siteTest = await this.quickSiteTest(context);
    
    return {
      siteWorking: siteTest.working,
      httpCode: siteTest.httpCode,
      deactivatedCount: deactivationResults.filter(r => r.success).length,
      testTimestamp: new Date(),
    };
  }

  private async selectiveReactivation(context: FixContext, essentialPlugins: string[]): Promise<any[]> {
    const results: any[] = [];

    for (const plugin of essentialPlugins) {
      const activationResult = await this.activatePlugin(context, plugin);
      
      if (activationResult.success) {
        // Test site after reactivation
        const siteTest = await this.quickSiteTest(context);
        
        if (siteTest.working) {
          results.push({
            plugin,
            success: true,
            reactivated: true,
            siteStillWorking: true,
          });
        } else {
          // If site breaks, deactivate again
          await this.deactivatePlugin(context, plugin);
          results.push({
            plugin,
            success: true,
            reactivated: false,
            siteStillWorking: false,
            reason: 'caused_site_failure',
          });
        }
      } else {
        results.push({
          plugin,
          success: false,
          reactivated: false,
          error: activationResult.error,
        });
      }
    }

    return results;
  }

  private async activatePlugin(context: FixContext, plugin: string): Promise<any> {
    const result = await this.executeCommand(
      context,
      `cd "${context.wordpressPath}" && php -r "
        if (file_exists('wp-load.php')) {
          define('WP_USE_THEMES', false);
          require_once('wp-load.php');
          if (function_exists('activate_plugin')) {
            activate_plugin('${plugin}');
            echo 'ACTIVATED';
          } else {
            echo 'FAILED';
          }
        } else {
          echo 'FAILED';
        }
      "`,
      `Activate plugin: ${plugin}`
    );

    return {
      success: result.success && result.stdout.includes('ACTIVATED'),
      output: result.stdout,
      error: result.success ? null : result.stderr,
    };
  }

  private async quickSiteTest(context: FixContext): Promise<any> {
    const testResult = await this.executeCommand(
      context,
      `curl -s -o /dev/null -w "%{http_code}" "${context.domain}" || echo "CURL_FAILED"`,
      'Quick site accessibility test'
    );

    const httpCode = testResult.stdout.trim();
    const working = httpCode === '200';

    return {
      working,
      httpCode,
      accessible: testResult.success,
    };
  }

  private getPluginActivationCommand(context: FixContext, plugin: string): string {
    return `cd "${context.wordpressPath}" && php -r "
      if (file_exists('wp-load.php')) {
        define('WP_USE_THEMES', false);
        require_once('wp-load.php');
        if (function_exists('activate_plugin')) {
          activate_plugin('${plugin}');
        }
      }
    "`;
  }

  private getFullPluginRestoreCommand(context: FixContext, backupPath: string): string {
    return `cd "${context.wordpressPath}" && php -r "
      if (file_exists('${backupPath}')) {
        \$backup_data = json_decode(file_get_contents('${backupPath}'), true);
        if (\$backup_data && isset(\$backup_data['active_plugins'])) {
          update_option('active_plugins', \$backup_data['active_plugins']);
          echo 'RESTORED';
        }
      }
    "`;
  }
}