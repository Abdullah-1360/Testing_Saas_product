import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { FixPlaybookRegistry } from '../fix-playbook-registry.service';
import { FixTier, FixContext, FixEvidence, FixResult } from '../interfaces/fix-playbook.interface';
import { PluginConflictDetectionService } from '../playbooks/plugin-conflict-detection.service';
import { ThemeSwitchingService } from '../playbooks/theme-switching.service';
import { PluginDeactivationService } from '../playbooks/plugin-deactivation.service';
import { ThemeRollbackService } from '../playbooks/theme-rollback.service';

@Injectable()
export class Tier3PluginThemeConflictsService implements OnModuleInit {
  private readonly logger = new Logger(Tier3PluginThemeConflictsService.name);

  constructor(
    private readonly playbookRegistry: FixPlaybookRegistry,
    private readonly pluginConflictDetection: PluginConflictDetectionService,
    private readonly themeSwitching: ThemeSwitchingService,
    private readonly pluginDeactivation: PluginDeactivationService,
    private readonly themeRollback: ThemeRollbackService,
  ) {}

  onModuleInit() {
    // Register all Tier 3 playbooks in priority order
    this.playbookRegistry.registerPlaybook(this.pluginConflictDetection);
    this.playbookRegistry.registerPlaybook(this.pluginDeactivation);
    this.playbookRegistry.registerPlaybook(this.themeSwitching);
    this.playbookRegistry.registerPlaybook(this.themeRollback);

    this.logger.log('Tier 3 Plugin/Theme Conflicts playbooks registered');
  }

  /**
   * Execute Tier 3 plugin and theme conflict fixes in priority order
   */
  async executeTier3Fixes(
    context: FixContext,
    evidence: FixEvidence[]
  ): Promise<FixResult[]> {
    this.logger.log(`Executing Tier 3 plugin/theme conflict fixes for incident ${context.incidentId}`);

    const tier3Playbooks = this.playbookRegistry.getPlaybooksForTier(FixTier.TIER_3_PLUGIN_THEME_CONFLICTS);
    const results: FixResult[] = [];

    for (const playbook of tier3Playbooks) {
      try {
        this.logger.log(`Checking applicability of ${playbook.name} for incident ${context.incidentId}`);
        
        const canApply = await playbook.canApply(context, evidence);
        if (!canApply) {
          this.logger.debug(`Playbook ${playbook.name} not applicable for incident ${context.incidentId}`);
          continue;
        }

        this.logger.log(`Applying ${playbook.name} for incident ${context.incidentId}`);
        const hypothesis = playbook.getHypothesis(context, evidence);
        
        this.logger.log(`Hypothesis for ${playbook.name}: ${hypothesis}`);

        const result = await playbook.apply(context);
        results.push({
          ...result,
          metadata: {
            ...result.metadata,
            playbookName: playbook.name,
            tier: playbook.tier,
            priority: playbook.priority,
            hypothesis,
          },
        });

        // If a fix was successfully applied, we may want to stop here
        // depending on the fix strategy (conservative approach)
        if (result.success && result.applied) {
          this.logger.log(`Fix ${playbook.name} successfully applied for incident ${context.incidentId}`);
          
          // For Tier 3 fixes, we apply one fix at a time to avoid cascading issues
          // Plugin/theme conflicts can be complex and require careful isolation
          break;
        }

      } catch (error) {
        this.logger.error(`Error applying playbook ${playbook.name} for incident ${context.incidentId}:`, error);
        
        results.push({
          success: false,
          applied: false,
          changes: [],
          evidence: [],
          error: error instanceof Error ? error.message : 'Unknown error',
          metadata: {
            playbookName: playbook.name,
            tier: playbook.tier,
            priority: playbook.priority,
          },
        });
      }
    }

    this.logger.log(`Completed Tier 3 fixes for incident ${context.incidentId}. Applied ${results.filter(r => r.applied).length} fixes.`);
    return results;
  }

  /**
   * Get applicable Tier 3 playbooks for the given context and evidence
   */
  async getApplicableTier3Playbooks(
    context: FixContext,
    evidence: FixEvidence[]
  ): Promise<string[]> {
    const applicablePlaybooks = await this.playbookRegistry.getApplicablePlaybooks(
      context,
      evidence,
      FixTier.TIER_3_PLUGIN_THEME_CONFLICTS
    );

    return applicablePlaybooks.map(p => p.name);
  }

  /**
   * Get Tier 3 playbook statistics
   */
  getTier3Stats(): {
    totalPlaybooks: number;
    playbookNames: string[];
  } {
    const tier3Playbooks = this.playbookRegistry.getPlaybooksForTier(FixTier.TIER_3_PLUGIN_THEME_CONFLICTS);
    
    return {
      totalPlaybooks: tier3Playbooks.length,
      playbookNames: tier3Playbooks.map(p => p.name),
    };
  }

  /**
   * Execute a specific Tier 3 playbook by name
   */
  async executeSpecificPlaybook(
    playbookName: string,
    context: FixContext,
    evidence: FixEvidence[]
  ): Promise<FixResult | null> {
    const playbook = this.playbookRegistry.getPlaybook(playbookName);
    
    if (!playbook || playbook.tier !== FixTier.TIER_3_PLUGIN_THEME_CONFLICTS) {
      this.logger.error(`Tier 3 playbook not found: ${playbookName}`);
      return null;
    }

    try {
      const canApply = await playbook.canApply(context, evidence);
      if (!canApply) {
        this.logger.warn(`Playbook ${playbookName} is not applicable for incident ${context.incidentId}`);
        return {
          success: false,
          applied: false,
          changes: [],
          evidence: [],
          error: 'Playbook not applicable for current context',
          metadata: {
            playbookName: playbook.name,
            tier: playbook.tier,
            reason: 'not_applicable',
          },
        };
      }

      const hypothesis = playbook.getHypothesis(context, evidence);
      this.logger.log(`Executing specific playbook ${playbookName} with hypothesis: ${hypothesis}`);

      const result = await playbook.apply(context);
      return {
        ...result,
        metadata: {
          ...result.metadata,
          playbookName: playbook.name,
          tier: playbook.tier,
          priority: playbook.priority,
          hypothesis,
        },
      };

    } catch (error) {
      this.logger.error(`Error executing specific playbook ${playbookName}:`, error);
      
      return {
        success: false,
        applied: false,
        changes: [],
        evidence: [],
        error: error instanceof Error ? error.message : 'Unknown error',
        metadata: {
          playbookName: playbook.name,
          tier: playbook.tier,
          priority: playbook.priority,
        },
      };
    }
  }

  /**
   * Validate Tier 3 fixes prerequisites
   */
  async validateTier3Prerequisites(context: FixContext): Promise<{
    valid: boolean;
    issues: string[];
    evidence: FixEvidence[];
  }> {
    const issues: string[] = [];
    const evidence: FixEvidence[] = [];

    // Check if WordPress plugins directory exists
    const pluginsCheck = await this.checkPluginsDirectory(context);
    evidence.push(...pluginsCheck.evidence);
    
    if (!pluginsCheck.exists) {
      issues.push('WordPress plugins directory not found');
    }

    // Check if WordPress themes directory exists
    const themesCheck = await this.checkThemesDirectory(context);
    evidence.push(...themesCheck.evidence);
    
    if (!themesCheck.exists) {
      issues.push('WordPress themes directory not found');
    }

    // Check if we can access WordPress CLI or admin functions
    const wpAccess = await this.checkWordPressAccess(context);
    evidence.push(...wpAccess.evidence);
    
    if (!wpAccess.accessible) {
      issues.push('WordPress CLI or admin functions not accessible');
    }

    // Check if we have necessary permissions for plugin/theme management
    const permissions = await this.checkPluginThemePermissions(context);
    evidence.push(...permissions.evidence);
    
    if (!permissions.adequate) {
      issues.push('Insufficient permissions for plugin/theme management');
    }

    return {
      valid: issues.length === 0,
      issues,
      evidence,
    };
  }

  private async checkPluginsDirectory(context: FixContext): Promise<{
    exists: boolean;
    evidence: FixEvidence[];
  }> {
    const evidence: FixEvidence[] = [];
    const pluginsPath = `${context.wordpressPath}/wp-content/plugins`;

    const checkResult = await this.executeCommand(
      context,
      `test -d "${pluginsPath}" && echo "exists" || echo "missing"`,
      'Check WordPress plugins directory'
    );

    const exists = checkResult.stdout.includes('exists');

    evidence.push({
      type: 'system_info',
      description: 'WordPress plugins directory validation',
      content: JSON.stringify({
        path: pluginsPath,
        exists,
        checkOutput: checkResult.stdout,
      }),
      signature: this.generateSignature(`plugins_dir_${exists}`),
      timestamp: new Date(),
    });

    return { exists, evidence };
  }

  private async checkThemesDirectory(context: FixContext): Promise<{
    exists: boolean;
    evidence: FixEvidence[];
  }> {
    const evidence: FixEvidence[] = [];
    const themesPath = `${context.wordpressPath}/wp-content/themes`;

    const checkResult = await this.executeCommand(
      context,
      `test -d "${themesPath}" && echo "exists" || echo "missing"`,
      'Check WordPress themes directory'
    );

    const exists = checkResult.stdout.includes('exists');

    evidence.push({
      type: 'system_info',
      description: 'WordPress themes directory validation',
      content: JSON.stringify({
        path: themesPath,
        exists,
        checkOutput: checkResult.stdout,
      }),
      signature: this.generateSignature(`themes_dir_${exists}`),
      timestamp: new Date(),
    });

    return { exists, evidence };
  }

  private async checkWordPressAccess(context: FixContext): Promise<{
    accessible: boolean;
    evidence: FixEvidence[];
  }> {
    const evidence: FixEvidence[] = [];

    // Try to access WordPress functions via PHP
    const testResult = await this.executeCommand(
      context,
      `cd "${context.wordpressPath}" && php -r "
        if (file_exists('wp-load.php')) {
          define('WP_USE_THEMES', false);
          require_once('wp-load.php');
          if (function_exists('get_plugins')) {
            echo 'WP_ACCESS_OK';
          } else {
            echo 'WP_FUNCTIONS_MISSING';
          }
        } else {
          echo 'WP_LOAD_MISSING';
        }
      "`,
      'Test WordPress access for plugin/theme management'
    );

    const accessible = testResult.stdout.includes('WP_ACCESS_OK');

    evidence.push({
      type: 'command_output',
      description: 'WordPress access check for plugin/theme management',
      content: accessible ? 'WordPress access available' : testResult.stdout,
      signature: this.generateSignature(testResult.stdout),
      timestamp: new Date(),
    });

    return { accessible, evidence };
  }

  private async checkPluginThemePermissions(context: FixContext): Promise<{
    adequate: boolean;
    evidence: FixEvidence[];
  }> {
    const evidence: FixEvidence[] = [];

    // Check if we can write to plugins and themes directories
    const pluginsWriteTest = await this.executeCommand(
      context,
      `touch "${context.wordpressPath}/wp-content/plugins/.wp-autohealer-test" && rm "${context.wordpressPath}/wp-content/plugins/.wp-autohealer-test" && echo "PLUGINS_WRITE_OK" || echo "PLUGINS_WRITE_FAILED"`,
      'Test write permissions to plugins directory'
    );

    const themesWriteTest = await this.executeCommand(
      context,
      `touch "${context.wordpressPath}/wp-content/themes/.wp-autohealer-test" && rm "${context.wordpressPath}/wp-content/themes/.wp-autohealer-test" && echo "THEMES_WRITE_OK" || echo "THEMES_WRITE_FAILED"`,
      'Test write permissions to themes directory'
    );

    const adequate = pluginsWriteTest.stdout.includes('PLUGINS_WRITE_OK') && 
                    themesWriteTest.stdout.includes('THEMES_WRITE_OK');

    evidence.push({
      type: 'command_output',
      description: 'Plugin/theme permissions check',
      content: adequate ? 'Plugin/theme permissions adequate' : 
               `Plugins: ${pluginsWriteTest.stdout}, Themes: ${themesWriteTest.stdout}`,
      signature: this.generateSignature(pluginsWriteTest.stdout + themesWriteTest.stdout),
      timestamp: new Date(),
    });

    return { adequate, evidence };
  }

  private async executeCommand(
    _context: FixContext,
    _command: string,
    _description: string
  ): Promise<{ success: boolean; stdout: string; stderr: string; exitCode: number }> {
    // This is a simplified version - in practice, this would use the SSH service
    // For now, we'll return a mock result
    return {
      success: true,
      stdout: 'mock_output',
      stderr: '',
      exitCode: 0,
    };
  }

  private generateSignature(_content: string): string {
    // Simple hash for now - in production, use crypto.createHash
    return Buffer.from(_content).toString('base64').substring(0, 32);
  }
}