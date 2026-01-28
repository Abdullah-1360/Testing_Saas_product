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
export class DiskSpaceCleanupService extends BaseFixPlaybook {
  readonly name = 'disk-space-cleanup';
  readonly tier = FixTier.TIER_1_INFRASTRUCTURE;
  readonly priority = FixPriority.HIGH;
  readonly description = 'Clean up disk space by removing temporary files, old logs, and WordPress cache';
  readonly applicableConditions = [
    'disk_space_low',
    'no_space_left_on_device',
    'write_failed_disk_full',
    'tmp_directory_full'
  ];

  constructor(
    sshService: SSHService,
    backupService: BackupService,
    evidenceService: EvidenceService,
  ) {
    super(sshService, backupService, evidenceService);
  }

  async canApply(context: FixContext, evidence: FixEvidence[]): Promise<boolean> {
    // Check if evidence indicates disk space issues
    const diskSpaceEvidence = evidence.some(e => 
      e.content.toLowerCase().includes('no space left on device') ||
      e.content.toLowerCase().includes('disk full') ||
      e.content.toLowerCase().includes('write failed') ||
      e.content.toLowerCase().includes('tmp') && e.content.toLowerCase().includes('full')
    );

    if (diskSpaceEvidence) {
      return true;
    }

    // Check current disk usage
    const diskUsage = await this.checkDiskUsage(context);
    return diskUsage > 85; // Apply if disk usage > 85%
  }

  async apply(context: FixContext): Promise<FixResult> {
    const changes: FixChange[] = [];
    const evidence: FixEvidence[] = [];
    const rollbackSteps: RollbackStep[] = [];

    try {
      this.logger.log(`Starting disk space cleanup for incident ${context.incidentId}`);

      // 1. Check initial disk usage
      const initialUsage = await this.checkDiskUsage(context);
      evidence.push({
        type: 'system_info',
        description: 'Initial disk usage',
        content: `Disk usage: ${initialUsage}%`,
        signature: this.generateSignature(`initial_disk_${initialUsage}`),
        timestamp: new Date(),
      });

      // 2. Clean temporary files
      const tempCleanResult = await this.cleanTemporaryFiles(context);
      if (tempCleanResult.change) {
        changes.push(tempCleanResult.change);
        rollbackSteps.push(...tempCleanResult.rollbackSteps);
      }
      evidence.push(...tempCleanResult.evidence);

      // 3. Clean old log files
      const logCleanResult = await this.cleanOldLogFiles(context);
      if (logCleanResult.change) {
        changes.push(logCleanResult.change);
        rollbackSteps.push(...logCleanResult.rollbackSteps);
      }
      evidence.push(...logCleanResult.evidence);

      // 4. Clean WordPress cache
      const cacheCleanResult = await this.cleanWordPressCache(context);
      if (cacheCleanResult.change) {
        changes.push(cacheCleanResult.change);
        rollbackSteps.push(...cacheCleanResult.rollbackSteps);
      }
      evidence.push(...cacheCleanResult.evidence);

      // 5. Clean package manager cache
      const packageCacheResult = await this.cleanPackageCache(context);
      if (packageCacheResult.change) {
        changes.push(packageCacheResult.change);
        rollbackSteps.push(...packageCacheResult.rollbackSteps);
      }
      evidence.push(...packageCacheResult.evidence);

      // 6. Check final disk usage
      const finalUsage = await this.checkDiskUsage(context);
      evidence.push({
        type: 'system_info',
        description: 'Final disk usage',
        content: `Disk usage: ${finalUsage}%`,
        signature: this.generateSignature(`final_disk_${finalUsage}`),
        timestamp: new Date(),
      });

      const spaceFreed = initialUsage - finalUsage;
      const success = spaceFreed > 0 && finalUsage < 90;

      return {
        success,
        applied: changes.length > 0,
        changes,
        evidence,
        rollbackPlan: rollbackSteps.length > 0 ? {
          steps: rollbackSteps,
          metadata: {
            initialUsage,
            finalUsage,
            spaceFreed,
          },
          createdAt: new Date(),
        } : undefined,
        metadata: {
          initialUsage,
          finalUsage,
          spaceFreed,
          cleanupActions: changes.length,
        },
      };

    } catch (error) {
      this.logger.error(`Disk space cleanup failed for incident ${context.incidentId}:`, error);
      
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
      this.logger.log(`Rolling back disk space cleanup for incident ${context.incidentId}`);

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
    const diskSpaceEvidence = evidence.find(e => 
      e.content.toLowerCase().includes('no space left') ||
      e.content.toLowerCase().includes('disk full')
    );

    if (diskSpaceEvidence) {
      return 'WordPress site is failing due to insufficient disk space. Cleaning temporary files, old logs, and cache should restore functionality.';
    }

    return 'Proactive disk space cleanup to prevent potential issues and improve site performance.';
  }

  private async checkDiskUsage(context: FixContext): Promise<number> {
    const result = await this.executeCommand(
      context,
      `df "${context.sitePath}" | awk 'NR==2 {print $5}' | sed 's/%//'`,
      'Check disk usage'
    );

    if (result.success && result.stdout.trim()) {
      return parseInt(result.stdout.trim(), 10);
    }

    return 0;
  }

  private async cleanTemporaryFiles(context: FixContext): Promise<{
    change?: FixChange;
    evidence: FixEvidence[];
    rollbackSteps: RollbackStep[];
  }> {
    const evidence: FixEvidence[] = [];
    const rollbackSteps: RollbackStep[] = [];

    // Find temporary files
    const findResult = await this.executeCommand(
      context,
      `find /tmp /var/tmp "${context.sitePath}/wp-content/uploads" -type f -name "*.tmp" -o -name "*.temp" -o -name "core.*" -mtime +7 2>/dev/null | head -100`,
      'Find temporary files older than 7 days'
    );

    evidence.push({
      type: 'command_output',
      description: 'Temporary files found',
      content: findResult.stdout,
      signature: this.generateSignature(findResult.stdout),
      timestamp: new Date(),
    });

    if (!findResult.success || !findResult.stdout.trim()) {
      return { evidence, rollbackSteps };
    }

    const tempFiles = findResult.stdout.trim().split('\n').filter(f => f.trim());
    if (tempFiles.length === 0) {
      return { evidence, rollbackSteps };
    }

    // Remove temporary files
    const removeResult = await this.executeCommand(
      context,
      `find /tmp /var/tmp "${context.sitePath}/wp-content/uploads" -type f -name "*.tmp" -o -name "*.temp" -o -name "core.*" -mtime +7 -delete 2>/dev/null`,
      'Remove old temporary files'
    );

    if (removeResult.success) {
      return {
        change: {
          type: 'command',
          description: `Removed ${tempFiles.length} temporary files`,
          command: 'find ... -delete',
          timestamp: new Date(),
        },
        evidence,
        rollbackSteps, // No rollback needed for temp files
      };
    }

    return { evidence, rollbackSteps };
  }

  private async cleanOldLogFiles(context: FixContext): Promise<{
    change?: FixChange;
    evidence: FixEvidence[];
    rollbackSteps: RollbackStep[];
  }> {
    const evidence: FixEvidence[] = [];
    const rollbackSteps: RollbackStep[] = [];

    // Find old log files
    const logPaths = [
      '/var/log',
      `${context.sitePath}/wp-content/debug.log`,
      `${context.sitePath}/error_log`,
      `${context.wordpressPath}/wp-content/debug.log`,
    ];

    const findResult = await this.executeCommand(
      context,
      `find ${logPaths.join(' ')} -type f -name "*.log" -size +100M -mtime +30 2>/dev/null | head -20`,
      'Find large old log files'
    );

    evidence.push({
      type: 'command_output',
      description: 'Large log files found',
      content: findResult.stdout,
      signature: this.generateSignature(findResult.stdout),
      timestamp: new Date(),
    });

    if (!findResult.success || !findResult.stdout.trim()) {
      return { evidence, rollbackSteps };
    }

    const logFiles = findResult.stdout.trim().split('\n').filter(f => f.trim());
    if (logFiles.length === 0) {
      return { evidence, rollbackSteps };
    }

    // Truncate large log files instead of deleting them
    let truncatedCount = 0;
    for (const logFile of logFiles) {
      const truncateResult = await this.executeCommand(
        context,
        `truncate -s 0 "${logFile}"`,
        `Truncate large log file: ${logFile}`
      );

      if (truncateResult.success) {
        truncatedCount++;
      }
    }

    if (truncatedCount > 0) {
      return {
        change: {
          type: 'command',
          description: `Truncated ${truncatedCount} large log files`,
          command: 'truncate -s 0',
          timestamp: new Date(),
        },
        evidence,
        rollbackSteps, // Log truncation is not reversible, but acceptable for cleanup
      };
    }

    return { evidence, rollbackSteps };
  }

  private async cleanWordPressCache(context: FixContext): Promise<{
    change?: FixChange;
    evidence: FixEvidence[];
    rollbackSteps: RollbackStep[];
  }> {
    const evidence: FixEvidence[] = [];
    const rollbackSteps: RollbackStep[] = [];

    const cachePaths = [
      `${context.wordpressPath}/wp-content/cache`,
      `${context.wordpressPath}/wp-content/uploads/cache`,
      `${context.wordpressPath}/wp-content/w3tc-cache`,
      `${context.wordpressPath}/wp-content/wp-rocket-cache`,
    ];

    let cleanedPaths = 0;

    for (const cachePath of cachePaths) {
      const exists = await this.fileExists(context, cachePath);
      if (!exists) continue;

      const sizeResult = await this.executeCommand(
        context,
        `du -sh "${cachePath}" 2>/dev/null || echo "0K ${cachePath}"`,
        `Check cache size: ${cachePath}`
      );

      evidence.push({
        type: 'system_info',
        description: `Cache directory size: ${cachePath}`,
        content: sizeResult.stdout,
        signature: this.generateSignature(sizeResult.stdout),
        timestamp: new Date(),
      });

      // Clean cache directory
      const cleanResult = await this.executeCommand(
        context,
        `find "${cachePath}" -type f -mtime +1 -delete 2>/dev/null`,
        `Clean cache directory: ${cachePath}`
      );

      if (cleanResult.success) {
        cleanedPaths++;
      }
    }

    if (cleanedPaths > 0) {
      return {
        change: {
          type: 'command',
          description: `Cleaned ${cleanedPaths} WordPress cache directories`,
          command: 'find ... -delete',
          timestamp: new Date(),
        },
        evidence,
        rollbackSteps, // Cache cleanup is not reversible, but acceptable
      };
    }

    return { evidence, rollbackSteps };
  }

  private async cleanPackageCache(context: FixContext): Promise<{
    change?: FixChange;
    evidence: FixEvidence[];
    rollbackSteps: RollbackStep[];
  }> {
    const evidence: FixEvidence[] = [];
    const rollbackSteps: RollbackStep[] = [];

    // Clean APT cache
    const aptResult = await this.executeCommand(
      context,
      'apt-get clean 2>/dev/null || yum clean all 2>/dev/null || true',
      'Clean package manager cache'
    );

    evidence.push({
      type: 'command_output',
      description: 'Package cache cleanup',
      content: aptResult.stdout + aptResult.stderr,
      signature: this.generateSignature(aptResult.stdout),
      timestamp: new Date(),
    });

    if (aptResult.success || aptResult.exitCode === 0) {
      return {
        change: {
          type: 'command',
          description: 'Cleaned package manager cache',
          command: 'apt-get clean / yum clean all',
          timestamp: new Date(),
        },
        evidence,
        rollbackSteps, // Package cache cleanup is not reversible, but safe
      };
    }

    return { evidence, rollbackSteps };
  }
}