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
export class ThemeRollbackService extends BaseFixPlaybook {
  readonly name = 'Theme Rollback Functionality';
  readonly tier = FixTier.TIER_3_PLUGIN_THEME_CONFLICTS;
  readonly priority = FixPriority.MEDIUM;
  readonly description = 'Rolls back theme changes and restores previous working theme configuration';
  readonly applicableConditions = [
    'Recent theme update causing issues',
    'Theme customization conflicts',
    'Theme file corruption',
    'Child theme parent conflicts',
    'Theme compatibility issues after WordPress update'
  ];

  async canApply(context: FixContext, evidence: FixEvidence[]): Promise<boolean> {
    // Check if evidence suggests theme rollback is needed
    const hasThemeRollbackIndicators = evidence.some(e => 
      e.content.toLowerCase().includes('theme') ||
      e.content.toLowerCase().includes('stylesheet') ||
      e.content.toLowerCase().includes('template') ||
      e.content.toLowerCase().includes('wp-content/themes') ||
      e.content.toLowerCase().includes('child theme') ||
      e.content.toLowerCase().includes('parent theme')
    );

    if (!hasThemeRollbackIndicators) {
      return false;
    }

    // Check if themes directory exists
    const themesPath = `${context.wordpressPath}/wp-content/themes`;
    const themesDirExists = await this.fileExists(context, themesPath);

    if (!themesDirExists) {
      return false;
    }

    // Check if there are theme backups or previous configurations available
    const hasThemeHistory = await this.checkThemeHistory(context);
    return hasThemeHistory;
  }

  async apply(context: FixContext): Promise<FixResult> {
    const changes: FixChange[] = [];
    const evidence: FixEvidence[] = [];
    const rollbackSteps: any[] = [];

    try {
      this.logger.log(`Starting theme rollback for incident ${context.incidentId}`);

      // Step 1: Get current theme configuration
      const currentThemeConfig = await this.getCurrentThemeConfiguration(context);
      evidence.push({
        type: 'system_info',
        description: 'Current theme configuration',
        content: JSON.stringify(currentThemeConfig),
        signature: this.generateSignature(JSON.stringify(currentThemeConfig)),
        timestamp: new Date(),
      });

      if (!currentThemeConfig.theme) {
        return {
          success: false,
          applied: false,
          changes: [],
          evidence,
          error: 'Could not determine current theme configuration',
        };
      }

      // Step 2: Find available theme backups or previous configurations
      const availableBackups = await this.findAvailableThemeBackups(context);
      evidence.push({
        type: 'system_info',
        description: 'Available theme backups and configurations',
        content: JSON.stringify(availableBackups),
        signature: this.generateSignature(JSON.stringify(availableBackups)),
        timestamp: new Date(),
      });

      if (availableBackups.length === 0) {
        // Try to find a stable default theme as fallback
        const defaultThemes = await this.getAvailableDefaultThemes(context);
        if (defaultThemes.length === 0) {
          return {
            success: false,
            applied: false,
            changes: [],
            evidence,
            error: 'No theme backups or default themes available for rollback',
          };
        }

        // Use most recent default theme as rollback target
        const rollbackTarget = this.selectBestDefaultTheme(defaultThemes);
        return await this.rollbackToDefaultTheme(context, rollbackTarget, currentThemeConfig, changes, evidence);
      }

      // Step 3: Select the best backup to rollback to
      const selectedBackup = this.selectBestBackup(availableBackups, currentThemeConfig);
      
      this.logger.log(`Rolling back to theme backup: ${selectedBackup.path}`);

      // Step 4: Create backup of current state before rollback
      const currentStateBackup = await this.backupCurrentThemeState(context, currentThemeConfig);
      if (!currentStateBackup) {
        throw new Error('Failed to create backup of current theme state');
      }

      rollbackSteps.push(this.createCommandRollbackStep(
        this.getThemeRestoreCommand(context, currentStateBackup),
        'Restore current theme state if rollback fails',
        1
      ));

      // Step 5: Restore theme from backup
      const restoreResult = await this.restoreThemeFromBackup(context, selectedBackup);
      
      if (restoreResult.success) {
        changes.push({
          type: 'config',
          description: `Rolled back theme from '${currentThemeConfig.theme}' to backup from ${selectedBackup.timestamp}`,
          originalValue: JSON.stringify(currentThemeConfig),
          newValue: JSON.stringify(selectedBackup.config),
          timestamp: new Date(),
        });

        // Step 6: Restore theme customizations if available
        if (selectedBackup.customizations) {
          const customizationResult = await this.restoreThemeCustomizations(context, selectedBackup.customizations);
          
          if (customizationResult.success) {
            changes.push({
              type: 'config',
              description: 'Restored theme customizations from backup',
              originalValue: 'current_customizations',
              newValue: 'backup_customizations',
              timestamp: new Date(),
            });
          }
        }

        // Step 7: Test site functionality after rollback
        const siteTestResult = await this.testSiteAfterThemeRollback(context);
        evidence.push({
          type: 'system_info',
          description: 'Site functionality test after theme rollback',
          content: JSON.stringify(siteTestResult),
          signature: this.generateSignature(JSON.stringify(siteTestResult)),
          timestamp: new Date(),
        });

        // Step 8: If rollback didn't fix the issue, try alternative backups
        if (!siteTestResult.working && availableBackups.length > 1) {
          const alternativeBackup = availableBackups.find(backup => backup.path !== selectedBackup.path);
          if (alternativeBackup) {
            this.logger.log(`Site still not working, trying alternative backup: ${alternativeBackup.path}`);
            
            const alternativeResult = await this.restoreThemeFromBackup(context, alternativeBackup);
            if (alternativeResult.success) {
              changes.push({
                type: 'config',
                description: `Rolled back to alternative theme backup from ${alternativeBackup.timestamp}`,
                originalValue: JSON.stringify(selectedBackup.config),
                newValue: JSON.stringify(alternativeBackup.config),
                timestamp: new Date(),
              });
            }
          }
        }

        const rollbackPlan: RollbackPlan = {
          steps: rollbackSteps,
          metadata: {
            originalThemeConfig: currentThemeConfig,
            selectedBackup: selectedBackup.path,
            currentStateBackup,
            availableBackups: availableBackups.map(b => b.path),
          },
          createdAt: new Date(),
        };

        return {
          success: true,
          applied: true,
          changes,
          evidence,
          rollbackPlan,
          metadata: {
            rolledBackFrom: currentThemeConfig.theme,
            rolledBackTo: selectedBackup.config.theme,
            backupTimestamp: selectedBackup.timestamp,
            siteWorking: siteTestResult.working,
          },
        };
      } else {
        throw new Error(`Failed to restore theme from backup: ${restoreResult.error}`);
      }

    } catch (error) {
      this.logger.error(`Theme rollback failed for incident ${context.incidentId}:`, error);
      
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
      this.logger.log(`Rolling back theme rollback for incident ${context.incidentId}`);

      // Execute rollback steps in reverse order
      const sortedSteps = rollbackPlan.steps.sort((a, b) => b.order - a.order);

      for (const step of sortedSteps) {
        const result = await this.executeCommand(context, step.action, step.description);
        if (!result.success) {
          this.logger.error(`Rollback step failed: ${step.description}`);
          return false;
        }
      }

      this.logger.log(`Theme rollback rollback completed for incident ${context.incidentId}`);
      return true;

    } catch (error) {
      this.logger.error(`Theme rollback rollback failed for incident ${context.incidentId}:`, error);
      return false;
    }
  }

  getHypothesis(_context: FixContext, evidence: FixEvidence[]): string {
    const themeEvidence = evidence.filter(e => 
      e.content.toLowerCase().includes('theme') ||
      e.content.toLowerCase().includes('wp-content/themes') ||
      e.content.toLowerCase().includes('stylesheet')
    );

    if (themeEvidence.length > 0) {
      return `Site errors appear to be caused by recent theme changes or corruption. Detected ${themeEvidence.length} theme-related issue(s). Will rollback to a previous working theme configuration or stable default theme to restore site functionality.`;
    }

    return 'Site errors may be caused by theme issues requiring rollback. Will identify and restore a previous working theme configuration or fallback to a stable default theme to resolve conflicts.';
  }

  private async checkThemeHistory(context: FixContext): Promise<boolean> {
    // Check for existing theme backups
    const backupCheck = await this.executeCommand(
      context,
      `find "${context.wordpressPath}/wp-content" -name ".wp-autohealer-theme-backup-*" -type f | head -5`,
      'Check for existing theme backups'
    );

    if (backupCheck.success && backupCheck.stdout.trim()) {
      return true;
    }

    // Check if default themes are available
    const defaultThemes = await this.getAvailableDefaultThemes(context);
    return defaultThemes.length > 0;
  }

  private async getCurrentThemeConfiguration(context: FixContext): Promise<any> {
    const result = await this.executeCommand(
      context,
      `cd "${context.wordpressPath}" && php -r "
        if (file_exists('wp-load.php')) {
          define('WP_USE_THEMES', false);
          require_once('wp-load.php');
          if (function_exists('get_option')) {
            \$config = array(
              'theme' => get_option('stylesheet'),
              'template' => get_option('template'),
              'theme_mods' => get_option('theme_mods_' . get_option('stylesheet')),
              'customizer_settings' => get_option('theme_mods_' . get_option('stylesheet')),
              'timestamp' => time()
            );
            echo json_encode(\$config);
          } else {
            echo '{}';
          }
        } else {
          echo '{}';
        }
      "`,
      'Get current theme configuration'
    );

    if (!result.success) {
      return {};
    }

    try {
      return JSON.parse(result.stdout);
    } catch {
      return {};
    }
  }

  private async findAvailableThemeBackups(context: FixContext): Promise<any[]> {
    const backups: any[] = [];

    // Find theme backup files
    const findResult = await this.executeCommand(
      context,
      `find "${context.wordpressPath}/wp-content" -name ".wp-autohealer-theme-backup-*" -type f -exec ls -la {} \\; | sort -k9`,
      'Find available theme backup files'
    );

    if (findResult.success && findResult.stdout.trim()) {
      const backupFiles = findResult.stdout.trim().split('\n');
      
      for (const backupLine of backupFiles) {
        const parts = backupLine.trim().split(/\s+/);
        const backupPath = parts[parts.length - 1];
        
        if (backupPath && backupPath.includes('.wp-autohealer-theme-backup-')) {
          const backupContent = await this.getFileContent(context, backupPath);
          if (backupContent) {
            try {
              const config = JSON.parse(backupContent);
              const timestamp = this.extractTimestampFromPath(backupPath);
              
              backups.push({
                path: backupPath,
                config,
                timestamp,
                size: parts[4] || '0',
              });
            } catch {
              // Skip invalid backup files
            }
          }
        }
      }
    }

    return backups.sort((a, b) => b.timestamp - a.timestamp); // Most recent first
  }

  private selectBestBackup(availableBackups: any[], currentConfig: any): any {
    // Prefer the most recent backup that's different from current config
    for (const backup of availableBackups) {
      if (backup.config.theme !== currentConfig.theme) {
        return backup;
      }
    }

    // If all backups are the same theme, return the most recent
    return availableBackups[0];
  }

  private async backupCurrentThemeState(context: FixContext, currentConfig: any): Promise<string | null> {
    const backupPath = `${context.wordpressPath}/wp-content/.wp-autohealer-theme-rollback-backup-${Date.now()}`;
    
    const result = await this.executeCommand(
      context,
      `echo '${JSON.stringify(currentConfig)}' > "${backupPath}"`,
      'Backup current theme state before rollback'
    );

    return result.success ? backupPath : null;
  }

  private async restoreThemeFromBackup(context: FixContext, backup: any): Promise<any> {
    const result = await this.executeCommand(
      context,
      `cd "${context.wordpressPath}" && php -r "
        if (file_exists('wp-load.php')) {
          define('WP_USE_THEMES', false);
          require_once('wp-load.php');
          if (function_exists('switch_theme') && function_exists('update_option')) {
            \$backup_config = json_decode('${JSON.stringify(backup.config)}', true);
            if (\$backup_config) {
              // Switch theme
              if (isset(\$backup_config['theme'])) {
                switch_theme(\$backup_config['theme']);
              }
              
              // Restore theme mods if available
              if (isset(\$backup_config['theme_mods'])) {
                update_option('theme_mods_' . \$backup_config['theme'], \$backup_config['theme_mods']);
              }
              
              echo 'RESTORE_SUCCESS';
            } else {
              echo 'RESTORE_FAILED';
            }
          } else {
            echo 'RESTORE_FAILED';
          }
        } else {
          echo 'RESTORE_FAILED';
        }
      "`,
      `Restore theme from backup: ${backup.path}`
    );

    return {
      success: result.success && result.stdout.includes('RESTORE_SUCCESS'),
      error: result.success ? null : result.stderr,
      output: result.stdout,
    };
  }

  private async restoreThemeCustomizations(context: FixContext, customizations: any): Promise<any> {
    const result = await this.executeCommand(
      context,
      `cd "${context.wordpressPath}" && php -r "
        if (file_exists('wp-load.php')) {
          define('WP_USE_THEMES', false);
          require_once('wp-load.php');
          if (function_exists('update_option')) {
            \$customizations = json_decode('${JSON.stringify(customizations)}', true);
            if (\$customizations) {
              foreach (\$customizations as \$option_name => \$option_value) {
                update_option(\$option_name, \$option_value);
              }
              echo 'CUSTOMIZATIONS_RESTORED';
            } else {
              echo 'CUSTOMIZATIONS_FAILED';
            }
          } else {
            echo 'CUSTOMIZATIONS_FAILED';
          }
        } else {
          echo 'CUSTOMIZATIONS_FAILED';
        }
      "`,
      'Restore theme customizations'
    );

    return {
      success: result.success && result.stdout.includes('CUSTOMIZATIONS_RESTORED'),
      error: result.success ? null : result.stderr,
    };
  }

  private async testSiteAfterThemeRollback(context: FixContext): Promise<any> {
    // Test if the site loads without errors
    const testResult = await this.executeCommand(
      context,
      `curl -s -o /dev/null -w "%{http_code}" "${context.domain}" || echo "CURL_FAILED"`,
      'Test site accessibility after theme rollback'
    );

    const httpCode = testResult.stdout.trim();
    const working = httpCode === '200';

    // Also test for common error indicators
    const contentTest = await this.executeCommand(
      context,
      `curl -s "${context.domain}" | grep -i "fatal error\\|parse error\\|white screen" || echo "NO_ERRORS"`,
      'Test site content for errors after theme rollback'
    );

    const hasErrors = contentTest.success && !contentTest.stdout.includes('NO_ERRORS');

    return {
      working: working && !hasErrors,
      httpCode,
      accessible: testResult.success,
      hasErrors,
      errorContent: hasErrors ? contentTest.stdout : null,
    };
  }

  private async getAvailableDefaultThemes(context: FixContext): Promise<string[]> {
    const result = await this.executeCommand(
      context,
      `cd "${context.wordpressPath}" && php -r "
        if (file_exists('wp-load.php')) {
          define('WP_USE_THEMES', false);
          require_once('wp-load.php');
          if (function_exists('wp_get_themes')) {
            \$themes = wp_get_themes();
            \$default_themes = array();
            foreach (\$themes as \$theme_slug => \$theme_obj) {
              if (strpos(\$theme_slug, 'twenty') === 0) {
                \$default_themes[] = \$theme_slug;
              }
            }
            echo json_encode(\$default_themes);
          } else {
            echo '[]';
          }
        } else {
          echo '[]';
        }
      "`,
      'Get available default WordPress themes'
    );

    if (!result.success) {
      return [];
    }

    try {
      const themes = JSON.parse(result.stdout);
      return Array.isArray(themes) ? themes : [];
    } catch {
      return [];
    }
  }

  private selectBestDefaultTheme(availableThemes: string[]): string {
    // Prefer the most recent Twenty* theme
    const sortedThemes = availableThemes.sort((a, b) => {
      const yearA = parseInt(a.replace('twenty', '')) || 0;
      const yearB = parseInt(b.replace('twenty', '')) || 0;
      return yearB - yearA; // Descending order (newest first)
    });

    return sortedThemes[0] || availableThemes[0];
  }

  private async rollbackToDefaultTheme(
    context: FixContext, 
    defaultTheme: string, 
    currentConfig: any, 
    changes: FixChange[], 
    evidence: FixEvidence[]
  ): Promise<FixResult> {
    const switchResult = await this.executeCommand(
      context,
      `cd "${context.wordpressPath}" && php -r "
        if (file_exists('wp-load.php')) {
          define('WP_USE_THEMES', false);
          require_once('wp-load.php');
          if (function_exists('switch_theme')) {
            switch_theme('${defaultTheme}');
            echo 'SWITCH_SUCCESS';
          } else {
            echo 'SWITCH_FAILED';
          }
        } else {
          echo 'SWITCH_FAILED';
        }
      "`,
      `Rollback to default theme: ${defaultTheme}`
    );

    if (switchResult.success && switchResult.stdout.includes('SWITCH_SUCCESS')) {
      changes.push({
        type: 'config',
        description: `Rolled back to default theme: ${defaultTheme}`,
        originalValue: currentConfig.theme,
        newValue: defaultTheme,
        timestamp: new Date(),
      });

      const siteTest = await this.testSiteAfterThemeRollback(context);
      evidence.push({
        type: 'system_info',
        description: 'Site test after default theme rollback',
        content: JSON.stringify(siteTest),
        signature: this.generateSignature(JSON.stringify(siteTest)),
        timestamp: new Date(),
      });

      return {
        success: true,
        applied: true,
        changes,
        evidence,
        metadata: {
          rolledBackFrom: currentConfig.theme,
          rolledBackTo: defaultTheme,
          method: 'default_theme_fallback',
          siteWorking: siteTest.working,
        },
      };
    } else {
      return {
        success: false,
        applied: false,
        changes,
        evidence,
        error: 'Failed to switch to default theme',
      };
    }
  }

  private extractTimestampFromPath(path: string): number {
    const match = path.match(/(\d+)$/);
    return match ? parseInt(match[1]) : 0;
  }

  private getThemeRestoreCommand(context: FixContext, backupPath: string): string {
    return `cd "${context.wordpressPath}" && php -r "
      if (file_exists('${backupPath}')) {
        \$backup_config = json_decode(file_get_contents('${backupPath}'), true);
        if (\$backup_config && function_exists('switch_theme')) {
          switch_theme(\$backup_config['theme']);
          if (isset(\$backup_config['theme_mods'])) {
            update_option('theme_mods_' . \$backup_config['theme'], \$backup_config['theme_mods']);
          }
        }
      }
    "`;
  }
}