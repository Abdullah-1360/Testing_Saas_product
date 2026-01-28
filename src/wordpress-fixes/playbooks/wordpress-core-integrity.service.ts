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
export class WordPressCoreIntegrityService extends BaseFixPlaybook {
  readonly name = 'wordpress-core-integrity';
  readonly tier = FixTier.TIER_2_CORE_INTEGRITY;
  readonly priority = FixPriority.HIGH;
  readonly description = 'Check and restore WordPress core file integrity by comparing with official WordPress distribution';
  readonly applicableConditions = [
    'core_file_corrupted',
    'core_file_missing',
    'wordpress_core_modified',
    'file_integrity_check_failed',
    'wp_includes_error',
    'wp_admin_error'
  ];

  constructor(
    sshService: SSHService,
    backupService: BackupService,
    evidenceService: EvidenceService,
  ) {
    super(sshService, backupService, evidenceService);
  }

  async canApply(context: FixContext, evidence: FixEvidence[]): Promise<boolean> {
    // Check if evidence indicates core file issues
    const coreFileEvidence = evidence.some(e => 
      e.content.toLowerCase().includes('wp-includes') ||
      e.content.toLowerCase().includes('wp-admin') ||
      e.content.toLowerCase().includes('wp-config') ||
      e.content.toLowerCase().includes('core file') ||
      e.content.toLowerCase().includes('file not found') && (
        e.content.includes('/wp-') || 
        e.content.includes('wordpress')
      ) ||
      e.content.toLowerCase().includes('fatal error') && (
        e.content.includes('wp-includes') ||
        e.content.includes('wp-admin')
      )
    );

    if (coreFileEvidence) {
      return true;
    }

    // Check if WordPress core files exist and are accessible
    const coreFilesCheck = await this.checkCoreFilesExist(context);
    return !coreFilesCheck.allPresent;
  }

  async apply(context: FixContext): Promise<FixResult> {
    const changes: FixChange[] = [];
    const evidence: FixEvidence[] = [];
    const rollbackSteps: RollbackStep[] = [];

    try {
      this.logger.log(`Starting WordPress core integrity check for incident ${context.incidentId}`);

      // 1. Detect WordPress version
      const versionInfo = await this.detectWordPressVersion(context);
      evidence.push({
        type: 'system_info',
        description: 'WordPress version detection',
        content: JSON.stringify(versionInfo),
        signature: this.generateSignature(JSON.stringify(versionInfo)),
        timestamp: new Date(),
      });

      if (!versionInfo.version) {
        return {
          success: false,
          applied: false,
          changes,
          evidence,
          error: 'Could not detect WordPress version',
        };
      }

      // 2. Check core file integrity
      const integrityCheck = await this.checkCoreFileIntegrity(context, versionInfo.version);
      evidence.push(...integrityCheck.evidence);

      if (integrityCheck.corruptedFiles.length === 0 && integrityCheck.missingFiles.length === 0) {
        return {
          success: true,
          applied: false,
          changes,
          evidence,
          metadata: {
            version: versionInfo.version,
            integrityStatus: 'clean',
          },
        };
      }

      // 3. Download WordPress core files
      const downloadResult = await this.downloadWordPressCore(context, versionInfo.version);
      if (!downloadResult.success) {
        return {
          success: false,
          applied: false,
          changes,
          evidence,
          error: 'Failed to download WordPress core files',
        };
      }
      evidence.push(...downloadResult.evidence);

      // 4. Restore missing and corrupted core files
      const restorationResult = await this.restoreCoreFiles(
        context, 
        integrityCheck.missingFiles.concat(integrityCheck.corruptedFiles),
        downloadResult.extractPath!
      );
      
      changes.push(...restorationResult.changes);
      evidence.push(...restorationResult.evidence);
      rollbackSteps.push(...restorationResult.rollbackSteps);

      // 5. Verify restoration
      const verificationResult = await this.verifyCoreFileRestoration(context, versionInfo.version);
      evidence.push(...verificationResult.evidence);

      // 6. Cleanup downloaded files
      await this.cleanupDownloadedFiles(context, downloadResult.extractPath!);

      const success = restorationResult.restoredCount > 0 && verificationResult.success;

      const result: FixResult = {
        success,
        applied: restorationResult.restoredCount > 0,
        changes,
        evidence,
        metadata: {
          version: versionInfo.version,
          missingFiles: integrityCheck.missingFiles.length,
          corruptedFiles: integrityCheck.corruptedFiles.length,
          restoredFiles: restorationResult.restoredCount,
          verificationPassed: verificationResult.success,
        },
      };

      if (rollbackSteps.length > 0) {
        result.rollbackPlan = {
          steps: rollbackSteps,
          metadata: {
            version: versionInfo.version,
            restoredFiles: restorationResult.restoredCount,
            downloadPath: downloadResult.extractPath,
          },
          createdAt: new Date(),
        };
      }

      return result;

    } catch (error) {
      this.logger.error(`WordPress core integrity check failed for incident ${context.incidentId}:`, error);
      
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
      this.logger.log(`Rolling back WordPress core integrity fixes for incident ${context.incidentId}`);

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

  getHypothesis(_context: FixContext, evidence: FixEvidence[]): string {
    const coreFileEvidence = evidence.find(e => 
      e.content.toLowerCase().includes('wp-includes') ||
      e.content.toLowerCase().includes('wp-admin') ||
      e.content.toLowerCase().includes('core file')
    );

    if (coreFileEvidence) {
      return 'WordPress site is failing due to corrupted or missing core files. Restoring core files from the official WordPress distribution should resolve the issue.';
    }

    return 'Proactive WordPress core file integrity check and restoration to ensure site stability.';
  }

  private async detectWordPressVersion(context: FixContext): Promise<{
    version?: string;
    source: string;
  }> {
    // Try to get version from wp-includes/version.php
    const versionFileResult = await this.executeCommand(
      context,
      `grep "wp_version = " "${context.wordpressPath}/wp-includes/version.php" | cut -d"'" -f2 2>/dev/null || echo ""`,
      'Detect WordPress version from version.php'
    );

    if (versionFileResult.success && versionFileResult.stdout.trim()) {
      return {
        version: versionFileResult.stdout.trim(),
        source: 'version.php',
      };
    }

    // Try to get version from readme.html
    const readmeResult = await this.executeCommand(
      context,
      `grep -i "version" "${context.wordpressPath}/readme.html" | head -1 | grep -oE "[0-9]+\\.[0-9]+\\.?[0-9]*" 2>/dev/null || echo ""`,
      'Detect WordPress version from readme.html'
    );

    if (readmeResult.success && readmeResult.stdout.trim()) {
      return {
        version: readmeResult.stdout.trim(),
        source: 'readme.html',
      };
    }

    // Try WP-CLI if available
    const wpcliResult = await this.executeCommand(
      context,
      `cd "${context.wordpressPath}" && wp core version 2>/dev/null || echo ""`,
      'Detect WordPress version via WP-CLI'
    );

    if (wpcliResult.success && wpcliResult.stdout.trim()) {
      return {
        version: wpcliResult.stdout.trim(),
        source: 'wp-cli',
      };
    }

    return { source: 'unknown' };
  }

  private async checkCoreFilesExist(context: FixContext): Promise<{
    allPresent: boolean;
    missingFiles: string[];
  }> {
    const coreFiles = [
      'wp-config-sample.php',
      'wp-load.php',
      'wp-settings.php',
      'wp-blog-header.php',
      'index.php',
      'wp-includes/version.php',
      'wp-admin/index.php',
    ];

    const missingFiles: string[] = [];

    for (const file of coreFiles) {
      const exists = await this.fileExists(context, `${context.wordpressPath}/${file}`);
      if (!exists) {
        missingFiles.push(file);
      }
    }

    return {
      allPresent: missingFiles.length === 0,
      missingFiles,
    };
  }

  private async checkCoreFileIntegrity(context: FixContext, version: string): Promise<{
    missingFiles: string[];
    corruptedFiles: string[];
    evidence: FixEvidence[];
  }> {
    const evidence: FixEvidence[] = [];
    const missingFiles: string[] = [];
    const corruptedFiles: string[] = [];

    // Define critical core files to check
    const criticalFiles = [
      'wp-load.php',
      'wp-settings.php',
      'wp-blog-header.php',
      'index.php',
      'wp-includes/version.php',
      'wp-includes/functions.php',
      'wp-includes/class-wp.php',
      'wp-admin/index.php',
      'wp-admin/admin.php',
    ];

    for (const file of criticalFiles) {
      const filePath = `${context.wordpressPath}/${file}`;
      const exists = await this.fileExists(context, filePath);
      
      if (!exists) {
        missingFiles.push(file);
        continue;
      }

      // Check file size and basic integrity
      const statResult = await this.executeCommand(
        context,
        `stat -c "%s %Y" "${filePath}" 2>/dev/null || echo "0 0"`,
        `Check file stats: ${file}`
      );

      const [size, mtime] = statResult.stdout.trim().split(' ').map(Number);
      
      // Files that are suspiciously small (likely corrupted)
      if (size && size < 100 && file.endsWith('.php')) {
        corruptedFiles.push(file);
      }

      evidence.push({
        type: 'file_content',
        description: `File integrity check: ${file}`,
        content: JSON.stringify({ file, size, mtime, exists: true }),
        signature: this.generateSignature(`${file}_${size}_${mtime}`),
        timestamp: new Date(),
      });
    }

    evidence.push({
      type: 'system_info',
      description: 'Core file integrity summary',
      content: JSON.stringify({
        version,
        totalChecked: criticalFiles.length,
        missingCount: missingFiles.length,
        corruptedCount: corruptedFiles.length,
        missingFiles,
        corruptedFiles,
      }),
      signature: this.generateSignature(`integrity_${missingFiles.length}_${corruptedFiles.length}`),
      timestamp: new Date(),
    });

    return { missingFiles, corruptedFiles, evidence };
  }

  private async downloadWordPressCore(context: FixContext, version: string): Promise<{
    success: boolean;
    extractPath?: string;
    evidence: FixEvidence[];
  }> {
    const evidence: FixEvidence[] = [];
    const tempDir = `/tmp/wp-core-${context.incidentId}`;
    const downloadUrl = `https://wordpress.org/wordpress-${version}.tar.gz`;

    // Create temporary directory
    const mkdirResult = await this.executeCommand(
      context,
      `mkdir -p "${tempDir}"`,
      'Create temporary directory for WordPress download'
    );

    if (!mkdirResult.success) {
      evidence.push({
        type: 'command_output',
        description: 'Failed to create temporary directory',
        content: mkdirResult.stderr,
        signature: this.generateSignature(mkdirResult.stderr),
        timestamp: new Date(),
      });
      return { success: false, evidence };
    }

    // Download WordPress core
    const downloadResult = await this.executeCommand(
      context,
      `cd "${tempDir}" && wget -q "${downloadUrl}" -O wordpress.tar.gz`,
      `Download WordPress ${version} core files`
    );

    evidence.push({
      type: 'command_output',
      description: `WordPress ${version} download`,
      content: downloadResult.stdout + downloadResult.stderr,
      signature: this.generateSignature(downloadResult.stdout),
      timestamp: new Date(),
    });

    if (!downloadResult.success) {
      return { success: false, evidence };
    }

    // Extract WordPress core
    const extractResult = await this.executeCommand(
      context,
      `cd "${tempDir}" && tar -xzf wordpress.tar.gz`,
      'Extract WordPress core files'
    );

    evidence.push({
      type: 'command_output',
      description: 'WordPress core extraction',
      content: extractResult.stdout + extractResult.stderr,
      signature: this.generateSignature(extractResult.stdout),
      timestamp: new Date(),
    });

    if (!extractResult.success) {
      return { success: false, evidence };
    }

    return { 
      success: true, 
      extractPath: `${tempDir}/wordpress`,
      evidence 
    };
  }

  private async restoreCoreFiles(
    context: FixContext, 
    filesToRestore: string[], 
    sourcePath: string
  ): Promise<{
    changes: FixChange[];
    evidence: FixEvidence[];
    rollbackSteps: RollbackStep[];
    restoredCount: number;
  }> {
    const changes: FixChange[] = [];
    const evidence: FixEvidence[] = [];
    const rollbackSteps: RollbackStep[] = [];
    let restoredCount = 0;

    for (const file of filesToRestore) {
      const sourceFile = `${sourcePath}/${file}`;
      const targetFile = `${context.wordpressPath}/${file}`;

      // Check if source file exists
      const sourceExists = await this.fileExists(context, sourceFile);
      if (!sourceExists) {
        evidence.push({
          type: 'system_info',
          description: `Source file not found: ${file}`,
          content: `Source: ${sourceFile}`,
          signature: this.generateSignature(`missing_source_${file}`),
          timestamp: new Date(),
        });
        continue;
      }

      // Create backup if target file exists
      const targetExists = await this.fileExists(context, targetFile);
      if (targetExists) {
        const backupPath = await this.createBackup(
          context, 
          targetFile, 
          `Backup before restoring core file: ${file}`
        );
        
        if (backupPath) {
          rollbackSteps.push(this.createFileRollbackStep(targetFile, backupPath, restoredCount));
        }
      }

      // Ensure target directory exists
      const targetDir = targetFile.substring(0, targetFile.lastIndexOf('/'));
      await this.executeCommand(
        context,
        `mkdir -p "${targetDir}"`,
        `Create directory for: ${file}`
      );

      // Copy core file
      const copyResult = await this.executeCommand(
        context,
        `cp "${sourceFile}" "${targetFile}"`,
        `Restore core file: ${file}`
      );

      if (copyResult.success) {
        // Set proper permissions
        await this.executeCommand(
          context,
          `chmod 644 "${targetFile}"`,
          `Set permissions for: ${file}`
        );

        changes.push({
          type: 'file',
          description: `Restored WordPress core file: ${file}`,
          path: targetFile,
          newValue: 'restored_from_official_distribution',
          timestamp: new Date(),
        });

        restoredCount++;

        evidence.push({
          type: 'file_content',
          description: `Successfully restored: ${file}`,
          content: `Restored from ${sourceFile} to ${targetFile}`,
          signature: this.generateSignature(`restored_${file}`),
          timestamp: new Date(),
        });
      } else {
        evidence.push({
          type: 'command_output',
          description: `Failed to restore: ${file}`,
          content: copyResult.stderr,
          signature: this.generateSignature(copyResult.stderr),
          timestamp: new Date(),
        });
      }
    }

    return { changes, evidence, rollbackSteps, restoredCount };
  }

  private async verifyCoreFileRestoration(context: FixContext, _version: string): Promise<{
    success: boolean;
    evidence: FixEvidence[];
  }> {
    const evidence: FixEvidence[] = [];

    // Check if critical files are now present and accessible
    const coreFilesCheck = await this.checkCoreFilesExist(context);
    
    evidence.push({
      type: 'system_info',
      description: 'Post-restoration core files verification',
      content: JSON.stringify({
        allPresent: coreFilesCheck.allPresent,
        missingFiles: coreFilesCheck.missingFiles,
      }),
      signature: this.generateSignature(JSON.stringify(coreFilesCheck)),
      timestamp: new Date(),
    });

    // Try to load WordPress to see if it's functional
    const loadTest = await this.executeCommand(
      context,
      `cd "${context.wordpressPath}" && php -l wp-load.php 2>/dev/null && echo "syntax_ok" || echo "syntax_error"`,
      'Test WordPress core file syntax'
    );

    evidence.push({
      type: 'command_output',
      description: 'WordPress core syntax verification',
      content: loadTest.stdout + loadTest.stderr,
      signature: this.generateSignature(loadTest.stdout),
      timestamp: new Date(),
    });

    const success = coreFilesCheck.allPresent && loadTest.stdout.includes('syntax_ok');

    return { success, evidence };
  }

  private async cleanupDownloadedFiles(context: FixContext, downloadPath: string): Promise<void> {
    await this.executeCommand(
      context,
      `rm -rf "${downloadPath.replace('/wordpress', '')}"`,
      'Cleanup downloaded WordPress files'
    );
  }
}