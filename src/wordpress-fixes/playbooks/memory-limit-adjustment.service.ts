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
export class MemoryLimitAdjustmentService extends BaseFixPlaybook {
  readonly name = 'memory-limit-adjustment';
  readonly tier = FixTier.TIER_1_INFRASTRUCTURE;
  readonly priority = FixPriority.HIGH;
  readonly description = 'Adjust PHP memory limits to resolve memory exhaustion errors';
  readonly applicableConditions = [
    'memory_exhausted',
    'fatal_error_memory_limit',
    'allowed_memory_size_exhausted',
    'out_of_memory'
  ];

  private readonly RECOMMENDED_MEMORY_LIMITS = {
    small: '256M',    // For small sites
    medium: '512M',   // For medium sites
    large: '1024M',   // For large sites
    critical: '2048M' // For critical memory issues
  };

  constructor(
    sshService: SSHService,
    backupService: BackupService,
    evidenceService: EvidenceService,
  ) {
    super(sshService, backupService, evidenceService);
  }

  async canApply(context: FixContext, evidence: FixEvidence[]): Promise<boolean> {
    // Check if evidence indicates memory limit issues
    return evidence.some(e => 
      e.content.toLowerCase().includes('memory exhausted') ||
      e.content.toLowerCase().includes('memory limit') ||
      e.content.toLowerCase().includes('allowed memory size') ||
      e.content.toLowerCase().includes('out of memory') ||
      e.content.toLowerCase().includes('fatal error') && e.content.toLowerCase().includes('memory')
    );
  }

  async apply(context: FixContext): Promise<FixResult> {
    const changes: FixChange[] = [];
    const evidence: FixEvidence[] = [];
    const rollbackSteps: RollbackStep[] = [];

    try {
      this.logger.log(`Starting memory limit adjustment for incident ${context.incidentId}`);

      // 1. Get current PHP configuration
      const phpInfo = await this.getPhpConfiguration(context);
      evidence.push(...phpInfo.evidence);

      if (!phpInfo.success) {
        return {
          success: false,
          applied: false,
          changes,
          evidence,
          error: 'Could not determine PHP configuration',
        };
      }

      // 2. Determine appropriate memory limit
      const recommendedLimit = this.determineMemoryLimit(context, evidence, phpInfo.currentLimit);
      
      evidence.push({
        type: 'system_info',
        description: 'Memory limit recommendation',
        content: `Current: ${phpInfo.currentLimit}, Recommended: ${recommendedLimit}`,
        signature: this.generateSignature(`memory_${phpInfo.currentLimit}_${recommendedLimit}`),
        timestamp: new Date(),
      });

      // 3. Update php.ini if needed
      if (phpInfo.phpIniPath && this.shouldUpdatePhpIni(phpInfo.currentLimit, recommendedLimit)) {
        const phpIniResult = await this.updatePhpIni(context, phpInfo.phpIniPath, recommendedLimit);
        if (phpIniResult.change) {
          changes.push(phpIniResult.change);
          rollbackSteps.push(...phpIniResult.rollbackSteps);
        }
        evidence.push(...phpIniResult.evidence);
      }

      // 4. Update .htaccess if applicable
      const htaccessResult = await this.updateHtaccess(context, recommendedLimit);
      if (htaccessResult.change) {
        changes.push(htaccessResult.change);
        rollbackSteps.push(...htaccessResult.rollbackSteps);
      }
      evidence.push(...htaccessResult.evidence);

      // 5. Update wp-config.php
      const wpConfigResult = await this.updateWpConfig(context, recommendedLimit);
      if (wpConfigResult.change) {
        changes.push(wpConfigResult.change);
        rollbackSteps.push(...wpConfigResult.rollbackSteps);
      }
      evidence.push(...wpConfigResult.evidence);

      // 6. Restart PHP-FPM if needed
      const restartResult = await this.restartPhpService(context);
      if (restartResult.change) {
        changes.push(restartResult.change);
      }
      evidence.push(...restartResult.evidence);

      // 7. Verify new memory limit
      const verificationResult = await this.verifyMemoryLimit(context, recommendedLimit);
      evidence.push(...verificationResult.evidence);

      const success = changes.length > 0 && verificationResult.success;

      return {
        success,
        applied: changes.length > 0,
        changes,
        evidence,
        rollbackPlan: rollbackSteps.length > 0 ? {
          steps: rollbackSteps,
          metadata: {
            originalLimit: phpInfo.currentLimit,
            newLimit: recommendedLimit,
            phpIniPath: phpInfo.phpIniPath,
          },
          createdAt: new Date(),
        } : undefined,
        metadata: {
          originalLimit: phpInfo.currentLimit,
          newLimit: recommendedLimit,
          changesApplied: changes.length,
        },
      };

    } catch (error) {
      this.logger.error(`Memory limit adjustment failed for incident ${context.incidentId}:`, error);
      
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
      this.logger.log(`Rolling back memory limit adjustment for incident ${context.incidentId}`);

      // Sort rollback steps by order (reverse order for rollback)
      const sortedSteps = rollbackPlan.steps.sort((a, b) => b.order - a.order);

      for (const step of sortedSteps) {
        const result = await this.executeCommand(context, step.action, step.description);
        if (!result.success) {
          this.logger.error(`Rollback step failed: ${step.description}`);
          return false;
        }
      }

      // Restart PHP service after rollback
      await this.restartPhpService(context);

      return true;
    } catch (error) {
      this.logger.error(`Rollback failed for incident ${context.incidentId}:`, error);
      return false;
    }
  }

  getHypothesis(context: FixContext, evidence: FixEvidence[]): string {
    const memoryEvidence = evidence.find(e => 
      e.content.toLowerCase().includes('memory exhausted') ||
      e.content.toLowerCase().includes('memory limit')
    );

    if (memoryEvidence) {
      return 'WordPress site is experiencing memory exhaustion errors. Increasing PHP memory limits should resolve the issue and restore site functionality.';
    }

    return 'Proactive memory limit adjustment to prevent potential memory-related issues.';
  }

  private async getPhpConfiguration(context: FixContext): Promise<{
    success: boolean;
    currentLimit: string;
    phpIniPath?: string;
    evidence: FixEvidence[];
  }> {
    const evidence: FixEvidence[] = [];

    // Get current memory limit
    const memoryLimitResult = await this.executeCommand(
      context,
      `php -r "echo ini_get('memory_limit');"`,
      'Get current PHP memory limit'
    );

    evidence.push({
      type: 'system_info',
      description: 'Current PHP memory limit',
      content: memoryLimitResult.stdout,
      signature: this.generateSignature(memoryLimitResult.stdout),
      timestamp: new Date(),
    });

    if (!memoryLimitResult.success) {
      return { success: false, currentLimit: '', evidence };
    }

    // Get php.ini path
    const phpIniResult = await this.executeCommand(
      context,
      `php --ini | grep "Loaded Configuration File" | cut -d: -f2 | xargs`,
      'Get php.ini path'
    );

    evidence.push({
      type: 'system_info',
      description: 'PHP configuration file path',
      content: phpIniResult.stdout,
      signature: this.generateSignature(phpIniResult.stdout),
      timestamp: new Date(),
    });

    return {
      success: true,
      currentLimit: memoryLimitResult.stdout.trim(),
      phpIniPath: phpIniResult.success ? phpIniResult.stdout.trim() : undefined,
      evidence,
    };
  }

  private determineMemoryLimit(context: FixContext, evidence: FixEvidence[], currentLimit: string): string {
    // Parse current limit
    const currentBytes = this.parseMemoryLimit(currentLimit);
    
    // Check severity of memory issues in evidence
    const hasCriticalMemoryIssues = evidence.some(e => 
      e.content.toLowerCase().includes('fatal error') ||
      e.content.toLowerCase().includes('white screen') ||
      e.content.toLowerCase().includes('500 error')
    );

    if (hasCriticalMemoryIssues) {
      return this.RECOMMENDED_MEMORY_LIMITS.critical;
    }

    // Determine based on current limit
    if (currentBytes < this.parseMemoryLimit('256M')) {
      return this.RECOMMENDED_MEMORY_LIMITS.medium;
    } else if (currentBytes < this.parseMemoryLimit('512M')) {
      return this.RECOMMENDED_MEMORY_LIMITS.large;
    } else {
      return this.RECOMMENDED_MEMORY_LIMITS.critical;
    }
  }

  private parseMemoryLimit(limit: string): number {
    const match = limit.match(/^(\d+)([KMG]?)$/i);
    if (!match) return 0;

    const value = parseInt(match[1], 10);
    const unit = match[2]?.toUpperCase() || '';

    switch (unit) {
      case 'K': return value * 1024;
      case 'M': return value * 1024 * 1024;
      case 'G': return value * 1024 * 1024 * 1024;
      default: return value;
    }
  }

  private shouldUpdatePhpIni(currentLimit: string, recommendedLimit: string): boolean {
    const currentBytes = this.parseMemoryLimit(currentLimit);
    const recommendedBytes = this.parseMemoryLimit(recommendedLimit);
    return recommendedBytes > currentBytes;
  }

  private async updatePhpIni(context: FixContext, phpIniPath: string, memoryLimit: string): Promise<{
    change?: FixChange;
    evidence: FixEvidence[];
    rollbackSteps: RollbackStep[];
  }> {
    const evidence: FixEvidence[] = [];
    const rollbackSteps: RollbackStep[] = [];

    // Check if php.ini exists and is writable
    const exists = await this.fileExists(context, phpIniPath);
    if (!exists) {
      evidence.push({
        type: 'system_info',
        description: 'PHP ini file not found',
        content: `File not found: ${phpIniPath}`,
        signature: this.generateSignature(`php_ini_not_found_${phpIniPath}`),
        timestamp: new Date(),
      });
      return { evidence, rollbackSteps };
    }

    // Get current php.ini content
    const currentContent = await this.getFileContent(context, phpIniPath);
    if (!currentContent) {
      return { evidence, rollbackSteps };
    }

    // Create backup
    const backupPath = await this.createBackup(context, phpIniPath, 'Backup php.ini before memory limit change');
    if (!backupPath) {
      return { evidence, rollbackSteps };
    }

    // Update memory limit in php.ini
    let newContent = currentContent;
    const memoryLimitRegex = /^memory_limit\s*=.*$/m;
    
    if (memoryLimitRegex.test(newContent)) {
      newContent = newContent.replace(memoryLimitRegex, `memory_limit = ${memoryLimit}`);
    } else {
      newContent += `\n; Updated by WP-AutoHealer\nmemory_limit = ${memoryLimit}\n`;
    }

    const change = await this.writeFileWithBackup(context, phpIniPath, newContent, 'Update PHP memory limit in php.ini');
    
    if (change) {
      rollbackSteps.push(this.createFileRollbackStep(phpIniPath, backupPath, 1));
      
      evidence.push({
        type: 'file_content',
        description: 'Updated php.ini memory limit',
        content: `memory_limit = ${memoryLimit}`,
        signature: this.generateSignature(newContent),
        timestamp: new Date(),
      });

      return { change, evidence, rollbackSteps };
    }

    return { evidence, rollbackSteps };
  }

  private async updateHtaccess(context: FixContext, memoryLimit: string): Promise<{
    change?: FixChange;
    evidence: FixEvidence[];
    rollbackSteps: RollbackStep[];
  }> {
    const evidence: FixEvidence[] = [];
    const rollbackSteps: RollbackStep[] = [];

    const htaccessPath = `${context.sitePath}/.htaccess`;
    const exists = await this.fileExists(context, htaccessPath);
    
    if (!exists) {
      evidence.push({
        type: 'system_info',
        description: '.htaccess file not found',
        content: `File not found: ${htaccessPath}`,
        signature: this.generateSignature(`htaccess_not_found_${htaccessPath}`),
        timestamp: new Date(),
      });
      return { evidence, rollbackSteps };
    }

    const currentContent = await this.getFileContent(context, htaccessPath);
    if (!currentContent) {
      return { evidence, rollbackSteps };
    }

    // Create backup
    const backupPath = await this.createBackup(context, htaccessPath, 'Backup .htaccess before memory limit change');
    if (!backupPath) {
      return { evidence, rollbackSteps };
    }

    // Add or update memory limit directive
    let newContent = currentContent;
    const memoryLimitRegex = /^php_value memory_limit.*$/m;
    const memoryDirective = `php_value memory_limit ${memoryLimit}`;

    if (memoryLimitRegex.test(newContent)) {
      newContent = newContent.replace(memoryLimitRegex, memoryDirective);
    } else {
      // Add at the beginning of the file
      newContent = `# Updated by WP-AutoHealer\n${memoryDirective}\n\n${newContent}`;
    }

    const change = await this.writeFileWithBackup(context, htaccessPath, newContent, 'Update PHP memory limit in .htaccess');
    
    if (change) {
      rollbackSteps.push(this.createFileRollbackStep(htaccessPath, backupPath, 2));
      
      evidence.push({
        type: 'file_content',
        description: 'Updated .htaccess memory limit',
        content: memoryDirective,
        signature: this.generateSignature(newContent),
        timestamp: new Date(),
      });

      return { change, evidence, rollbackSteps };
    }

    return { evidence, rollbackSteps };
  }

  private async updateWpConfig(context: FixContext, memoryLimit: string): Promise<{
    change?: FixChange;
    evidence: FixEvidence[];
    rollbackSteps: RollbackStep[];
  }> {
    const evidence: FixEvidence[] = [];
    const rollbackSteps: RollbackStep[] = [];

    const wpConfigPath = `${context.wordpressPath}/wp-config.php`;
    const exists = await this.fileExists(context, wpConfigPath);
    
    if (!exists) {
      evidence.push({
        type: 'system_info',
        description: 'wp-config.php file not found',
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
    const backupPath = await this.createBackup(context, wpConfigPath, 'Backup wp-config.php before memory limit change');
    if (!backupPath) {
      return { evidence, rollbackSteps };
    }

    // Add or update WP_MEMORY_LIMIT
    let newContent = currentContent;
    const memoryLimitRegex = /define\s*\(\s*['"]WP_MEMORY_LIMIT['"],\s*['"][^'"]*['"]\s*\)\s*;/;
    const memoryDirective = `define('WP_MEMORY_LIMIT', '${memoryLimit}');`;

    if (memoryLimitRegex.test(newContent)) {
      newContent = newContent.replace(memoryLimitRegex, memoryDirective);
    } else {
      // Add after the opening PHP tag
      const phpTagRegex = /(<\?php)/;
      if (phpTagRegex.test(newContent)) {
        newContent = newContent.replace(phpTagRegex, `$1\n\n// Updated by WP-AutoHealer\n${memoryDirective}\n`);
      }
    }

    const change = await this.writeFileWithBackup(context, wpConfigPath, newContent, 'Update WordPress memory limit in wp-config.php');
    
    if (change) {
      rollbackSteps.push(this.createFileRollbackStep(wpConfigPath, backupPath, 3));
      
      evidence.push({
        type: 'file_content',
        description: 'Updated wp-config.php memory limit',
        content: memoryDirective,
        signature: this.generateSignature(newContent),
        timestamp: new Date(),
      });

      return { change, evidence, rollbackSteps };
    }

    return { evidence, rollbackSteps };
  }

  private async restartPhpService(context: FixContext): Promise<{
    change?: FixChange;
    evidence: FixEvidence[];
  }> {
    const evidence: FixEvidence[] = [];

    // Try to restart PHP-FPM service
    const services = ['php-fpm', 'php7.4-fpm', 'php8.0-fpm', 'php8.1-fpm', 'php8.2-fpm'];
    
    for (const service of services) {
      const restartResult = await this.executeCommand(
        context,
        `systemctl restart ${service} 2>/dev/null || service ${service} restart 2>/dev/null || true`,
        `Restart ${service} service`
      );

      evidence.push({
        type: 'command_output',
        description: `Restart ${service} service`,
        content: restartResult.stdout + restartResult.stderr,
        signature: this.generateSignature(restartResult.stdout),
        timestamp: new Date(),
      });

      if (restartResult.success || restartResult.exitCode === 0) {
        return {
          change: {
            type: 'command',
            description: `Restarted ${service} service`,
            command: `systemctl restart ${service}`,
            timestamp: new Date(),
          },
          evidence,
        };
      }
    }

    return { evidence };
  }

  private async verifyMemoryLimit(context: FixContext, expectedLimit: string): Promise<{
    success: boolean;
    evidence: FixEvidence[];
  }> {
    const evidence: FixEvidence[] = [];

    // Check current memory limit after changes
    const verifyResult = await this.executeCommand(
      context,
      `php -r "echo ini_get('memory_limit');"`,
      'Verify new PHP memory limit'
    );

    evidence.push({
      type: 'system_info',
      description: 'Verified PHP memory limit',
      content: verifyResult.stdout,
      signature: this.generateSignature(verifyResult.stdout),
      timestamp: new Date(),
    });

    const success = verifyResult.success && verifyResult.stdout.trim() === expectedLimit;

    return { success, evidence };
  }
}