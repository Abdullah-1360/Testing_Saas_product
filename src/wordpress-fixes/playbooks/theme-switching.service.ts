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
export class ThemeSwitchingService extends BaseFixPlaybook {
  readonly name = 'Theme Switching for Conflict Resolution';
  readonly tier = FixTier.TIER_3_PLUGIN_THEME_CONFLICTS;
  readonly priority = FixPriority.HIGH;
  readonly description = 'Switches to a default WordPress theme to resolve theme-related conflicts';
  readonly applicableConditions = [
    'Theme-related PHP errors',
    'Template file errors',
    'Theme function conflicts',
    'CSS/JS loading issues from theme',
    'Theme compatibility problems'
  ];

  async canApply(context: FixContext, evidence: FixEvidence[]): Promise<boolean> {
    // Check if evidence suggests theme-related issues
    const hasThemeErrors = evidence.some(e => 
      e.content.toLowerCase().includes('theme') ||
      e.content.toLowerCase().includes('wp-content/themes') ||
      e.content.toLowerCase().includes('template') ||
      e.content.toLowerCase().includes('functions.php')
    );

    if (!hasThemeErrors) {
      return false;
    }

    // Check if themes directory exists
    const themesPath = `${context.wordpressPath}/wp-content/themes`;
    const themesDirExists = await this.fileExists(context, themesPath);

    return themesDirExists;
  }

  async apply(context: FixContext): Promise<FixResult> {
    const changes: FixChange[] = [];
    const evidence: FixEvidence[] = [];
    const rollbackSteps: any[] = [];

    try {
      this.logger.log(`Starting theme switching for incident ${context.incidentId}`);

      // Step 1: Get current active theme
      const currentTheme = await this.getCurrentTheme(context);
      evidence.push({
        type: 'system_info',
        description: 'Current active WordPress theme',
        content: JSON.stringify(currentTheme),
        signature: this.generateSignature(JSON.stringify(currentTheme)),
        timestamp: new Date(),
      });

      if (!currentTheme.name) {
        return {
          success: false,
          applied: false,
          changes: [],
          evidence,
          error: 'Could not determine current theme',
        };
      }

      // Step 2: Get available default themes
      const availableThemes = await this.getAvailableDefaultThemes(context);
      evidence.push({
        type: 'system_info',
        description: 'Available default WordPress themes',
        content: JSON.stringify(availableThemes),
        signature: this.generateSignature(JSON.stringify(availableThemes)),
        timestamp: new Date(),
      });

      if (availableThemes.length === 0) {
        return {
          success: false,
          applied: false,
          changes: [],
          evidence,
          error: 'No default WordPress themes available for switching',
        };
      }

      // Step 3: Select the best default theme to switch to
      const targetTheme = this.selectBestDefaultTheme(availableThemes, currentTheme.name);
      
      if (targetTheme === currentTheme.name) {
        return {
          success: true,
          applied: false,
          changes: [],
          evidence,
          metadata: {
            reason: 'already_using_default',
            message: `Already using default theme: ${currentTheme.name}`,
          },
        };
      }

      this.logger.log(`Switching from theme '${currentTheme.name}' to '${targetTheme}'`);

      // Step 4: Create backup of current theme configuration
      const themeConfigBackup = await this.backupThemeConfiguration(context, currentTheme);
      if (!themeConfigBackup) {
        throw new Error('Failed to create theme configuration backup');
      }

      rollbackSteps.push(this.createCommandRollbackStep(
        this.getThemeSwitchCommand(context, currentTheme.name),
        `Restore original theme: ${currentTheme.name}`,
        1
      ));

      // Step 5: Switch to the target theme
      const switchResult = await this.switchToTheme(context, targetTheme);
      
      if (switchResult.success) {
        changes.push({
          type: 'config',
          description: `Switched WordPress theme from '${currentTheme.name}' to '${targetTheme}'`,
          originalValue: currentTheme.name,
          newValue: targetTheme,
          timestamp: new Date(),
        });

        // Step 6: Test site functionality after theme switch
        const siteTestResult = await this.testSiteAfterThemeSwitch(context);
        evidence.push({
          type: 'system_info',
          description: 'Site functionality test after theme switch',
          content: JSON.stringify(siteTestResult),
          signature: this.generateSignature(JSON.stringify(siteTestResult)),
          timestamp: new Date(),
        });

        // Step 7: If site is still not working, try another theme
        if (!siteTestResult.working && availableThemes.length > 1) {
          const alternativeTheme = availableThemes.find(theme => theme !== targetTheme);
          if (alternativeTheme) {
            this.logger.log(`Site still not working, trying alternative theme: ${alternativeTheme}`);
            
            const alternativeResult = await this.switchToTheme(context, alternativeTheme);
            if (alternativeResult.success) {
              changes.push({
                type: 'config',
                description: `Switched to alternative theme: ${alternativeTheme}`,
                originalValue: targetTheme,
                newValue: alternativeTheme,
                timestamp: new Date(),
              });

              // Update rollback to restore original theme
              rollbackSteps[0] = this.createCommandRollbackStep(
                this.getThemeSwitchCommand(context, currentTheme.name),
                `Restore original theme: ${currentTheme.name}`,
                1
              );
            }
          }
        }

        const rollbackPlan: RollbackPlan = {
          steps: rollbackSteps,
          metadata: {
            originalTheme: currentTheme.name,
            targetTheme,
            backupPath: themeConfigBackup,
            availableThemes,
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
            originalTheme: currentTheme.name,
            newTheme: targetTheme,
            siteWorking: siteTestResult.working,
          },
        };
      } else {
        throw new Error(`Failed to switch to theme: ${switchResult.error}`);
      }

    } catch (error) {
      this.logger.error(`Theme switching failed for incident ${context.incidentId}:`, error);
      
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
      this.logger.log(`Rolling back theme switching for incident ${context.incidentId}`);

      // Execute rollback steps in reverse order
      const sortedSteps = rollbackPlan.steps.sort((a, b) => b.order - a.order);

      for (const step of sortedSteps) {
        const result = await this.executeCommand(context, step.action, step.description);
        if (!result.success) {
          this.logger.error(`Rollback step failed: ${step.description}`);
          return false;
        }
      }

      this.logger.log(`Theme switching rollback completed for incident ${context.incidentId}`);
      return true;

    } catch (error) {
      this.logger.error(`Theme switching rollback failed for incident ${context.incidentId}:`, error);
      return false;
    }
  }

  getHypothesis(_context: FixContext, evidence: FixEvidence[]): string {
    const themeErrors = evidence.filter(e => 
      e.content.toLowerCase().includes('theme') ||
      e.content.toLowerCase().includes('wp-content/themes') ||
      e.content.toLowerCase().includes('template')
    );

    if (themeErrors.length > 0) {
      return `Site errors appear to be caused by theme conflicts. Detected ${themeErrors.length} theme-related error(s) in logs. Will switch to a default WordPress theme to restore site functionality.`;
    }

    return 'Site errors may be caused by theme conflicts. Will switch to a stable default WordPress theme to isolate and resolve theme-related issues.';
  }

  private async getCurrentTheme(context: FixContext): Promise<any> {
    const result = await this.executeCommand(
      context,
      `cd "${context.wordpressPath}" && php -r "
        if (file_exists('wp-load.php')) {
          define('WP_USE_THEMES', false);
          require_once('wp-load.php');
          if (function_exists('get_option')) {
            \$theme = get_option('stylesheet');
            \$theme_data = wp_get_theme(\$theme);
            echo json_encode(array(
              'name' => \$theme,
              'version' => \$theme_data->get('Version'),
              'description' => \$theme_data->get('Description')
            ));
          } else {
            echo '{}';
          }
        } else {
          echo '{}';
        }
      "`,
      'Get current WordPress theme'
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
              // Check if it's a default WordPress theme
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

  private selectBestDefaultTheme(availableThemes: string[], currentTheme: string): string {
    // If already using a default theme, return it
    if (availableThemes.includes(currentTheme)) {
      return currentTheme;
    }

    // Prefer the most recent Twenty* theme
    const sortedThemes = availableThemes.sort((a, b) => {
      const yearA = parseInt(a.replace('twenty', '')) || 0;
      const yearB = parseInt(b.replace('twenty', '')) || 0;
      return yearB - yearA; // Descending order (newest first)
    });

    // Return the newest available theme, or fallback to first available
    return sortedThemes[0] || availableThemes[0];
  }

  private async backupThemeConfiguration(context: FixContext, currentTheme: any): Promise<string | null> {
    const backupPath = `${context.wordpressPath}/wp-content/.wp-autohealer-theme-backup-${Date.now()}`;
    
    const result = await this.executeCommand(
      context,
      `cd "${context.wordpressPath}" && php -r "
        if (file_exists('wp-load.php')) {
          define('WP_USE_THEMES', false);
          require_once('wp-load.php');
          if (function_exists('get_option')) {
            \$theme_config = array(
              'stylesheet' => get_option('stylesheet'),
              'template' => get_option('template'),
              'theme_mods' => get_option('theme_mods_' . get_option('stylesheet')),
            );
            file_put_contents('${backupPath}', json_encode(\$theme_config));
            echo 'BACKUP_SUCCESS';
          } else {
            echo 'BACKUP_FAILED';
          }
        } else {
          echo 'BACKUP_FAILED';
        }
      "`,
      'Backup current theme configuration'
    );

    return result.success && result.stdout.includes('BACKUP_SUCCESS') ? backupPath : null;
  }

  private async switchToTheme(context: FixContext, themeName: string): Promise<any> {
    const result = await this.executeCommand(
      context,
      `cd "${context.wordpressPath}" && php -r "
        if (file_exists('wp-load.php')) {
          define('WP_USE_THEMES', false);
          require_once('wp-load.php');
          if (function_exists('switch_theme')) {
            switch_theme('${themeName}');
            echo 'SWITCH_SUCCESS';
          } else {
            echo 'SWITCH_FAILED';
          }
        } else {
          echo 'SWITCH_FAILED';
        }
      "`,
      `Switch to theme: ${themeName}`
    );

    return {
      success: result.success && result.stdout.includes('SWITCH_SUCCESS'),
      error: result.success ? null : result.stderr,
      output: result.stdout,
    };
  }

  private getThemeSwitchCommand(context: FixContext, themeName: string): string {
    return `cd "${context.wordpressPath}" && php -r "
      if (file_exists('wp-load.php')) {
        define('WP_USE_THEMES', false);
        require_once('wp-load.php');
        if (function_exists('switch_theme')) {
          switch_theme('${themeName}');
        }
      }
    "`;
  }

  private async testSiteAfterThemeSwitch(context: FixContext): Promise<any> {
    // Test if the site loads without errors
    const testResult = await this.executeCommand(
      context,
      `curl -s -o /dev/null -w "%{http_code}" "${context.domain}" || echo "CURL_FAILED"`,
      'Test site accessibility after theme switch'
    );

    const httpCode = testResult.stdout.trim();
    const working = httpCode === '200';

    // Also test for common error indicators
    const contentTest = await this.executeCommand(
      context,
      `curl -s "${context.domain}" | grep -i "fatal error\\|parse error\\|white screen" || echo "NO_ERRORS"`,
      'Test site content for errors after theme switch'
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
}