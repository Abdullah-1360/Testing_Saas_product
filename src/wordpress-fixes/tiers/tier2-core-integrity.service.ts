import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { FixPlaybookRegistry } from '../fix-playbook-registry.service';
import { FixTier, FixContext, FixEvidence, FixResult } from '../interfaces/fix-playbook.interface';
import { WordPressCoreIntegrityService } from '../playbooks/wordpress-core-integrity.service';
import { WpConfigValidationService } from '../playbooks/wp-config-validation.service';
import { DatabaseTableRepairService } from '../playbooks/database-table-repair.service';

@Injectable()
export class Tier2CoreIntegrityService implements OnModuleInit {
  private readonly logger = new Logger(Tier2CoreIntegrityService.name);

  constructor(
    private readonly playbookRegistry: FixPlaybookRegistry,
    private readonly wordpressCoreIntegrity: WordPressCoreIntegrityService,
    private readonly wpConfigValidation: WpConfigValidationService,
    private readonly databaseTableRepair: DatabaseTableRepairService,
  ) {}

  onModuleInit() {
    // Register all Tier 2 playbooks
    this.playbookRegistry.registerPlaybook(this.wpConfigValidation);
    this.playbookRegistry.registerPlaybook(this.wordpressCoreIntegrity);
    this.playbookRegistry.registerPlaybook(this.databaseTableRepair);

    this.logger.log('Tier 2 Core Integrity playbooks registered');
  }

  /**
   * Execute Tier 2 core integrity fixes in priority order
   */
  async executeTier2Fixes(
    context: FixContext,
    evidence: FixEvidence[]
  ): Promise<FixResult[]> {
    this.logger.log(`Executing Tier 2 core integrity fixes for incident ${context.incidentId}`);

    const tier2Playbooks = this.playbookRegistry.getPlaybooksForTier(FixTier.TIER_2_CORE_INTEGRITY);
    const results: FixResult[] = [];

    for (const playbook of tier2Playbooks) {
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
          
          // For Tier 2 fixes, we might want to continue with other fixes
          // since they address different aspects of core integrity
          // But we'll be conservative and apply one at a time for safety
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

    this.logger.log(`Completed Tier 2 fixes for incident ${context.incidentId}. Applied ${results.filter(r => r.applied).length} fixes.`);
    return results;
  }

  /**
   * Get applicable Tier 2 playbooks for the given context and evidence
   */
  async getApplicableTier2Playbooks(
    context: FixContext,
    evidence: FixEvidence[]
  ): Promise<string[]> {
    const applicablePlaybooks = await this.playbookRegistry.getApplicablePlaybooks(
      context,
      evidence,
      FixTier.TIER_2_CORE_INTEGRITY
    );

    return applicablePlaybooks.map(p => p.name);
  }

  /**
   * Get Tier 2 playbook statistics
   */
  getTier2Stats(): {
    totalPlaybooks: number;
    playbookNames: string[];
  } {
    const tier2Playbooks = this.playbookRegistry.getPlaybooksForTier(FixTier.TIER_2_CORE_INTEGRITY);
    
    return {
      totalPlaybooks: tier2Playbooks.length,
      playbookNames: tier2Playbooks.map(p => p.name),
    };
  }

  /**
   * Execute a specific Tier 2 playbook by name
   */
  async executeSpecificPlaybook(
    playbookName: string,
    context: FixContext,
    evidence: FixEvidence[]
  ): Promise<FixResult | null> {
    const playbook = this.playbookRegistry.getPlaybook(playbookName);
    
    if (!playbook || playbook.tier !== FixTier.TIER_2_CORE_INTEGRITY) {
      this.logger.error(`Tier 2 playbook not found: ${playbookName}`);
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
   * Validate Tier 2 fixes prerequisites
   */
  async validateTier2Prerequisites(context: FixContext): Promise<{
    valid: boolean;
    issues: string[];
    evidence: FixEvidence[];
  }> {
    const issues: string[] = [];
    const evidence: FixEvidence[] = [];

    // Check if WordPress path exists
    const wpPathExists = await this.checkWordPressPath(context);
    evidence.push(...wpPathExists.evidence);
    
    if (!wpPathExists.exists) {
      issues.push('WordPress installation path not found');
    }

    // Check if we can access the database
    const dbAccess = await this.checkDatabaseAccess(context);
    evidence.push(...dbAccess.evidence);
    
    if (!dbAccess.accessible) {
      issues.push('Database not accessible');
    }

    // Check if we have necessary permissions
    const permissions = await this.checkFilePermissions(context);
    evidence.push(...permissions.evidence);
    
    if (!permissions.adequate) {
      issues.push('Insufficient file system permissions');
    }

    return {
      valid: issues.length === 0,
      issues,
      evidence,
    };
  }

  private async checkWordPressPath(context: FixContext): Promise<{
    exists: boolean;
    evidence: FixEvidence[];
  }> {
    const evidence: FixEvidence[] = [];

    // Check if WordPress core files exist
    const coreFiles = ['wp-load.php', 'wp-settings.php', 'wp-config-sample.php'];
    let existingFiles = 0;

    for (const file of coreFiles) {
      const filePath = `${context.wordpressPath}/${file}`;
      const checkResult = await this.executeCommand(
        context,
        `test -f "${filePath}" && echo "exists" || echo "missing"`,
        `Check WordPress core file: ${file}`
      );

      if (checkResult.stdout.includes('exists')) {
        existingFiles++;
      }
    }

    const exists = existingFiles >= 2; // At least 2 core files should exist

    evidence.push({
      type: 'system_info',
      description: 'WordPress path validation',
      content: JSON.stringify({
        path: context.wordpressPath,
        coreFilesFound: existingFiles,
        totalChecked: coreFiles.length,
        exists,
      }),
      signature: this.generateSignature(`wp_path_${existingFiles}`),
      timestamp: new Date(),
    });

    return { exists, evidence };
  }

  private async checkDatabaseAccess(context: FixContext): Promise<{
    accessible: boolean;
    evidence: FixEvidence[];
  }> {
    const evidence: FixEvidence[] = [];

    const testResult = await this.executeCommand(
      context,
      `cd "${context.wordpressPath}" && php -r "
        if (file_exists('wp-config.php')) {
          require_once('wp-config.php');
          try {
            \$conn = new mysqli(DB_HOST, DB_USER, DB_PASSWORD, DB_NAME);
            if (\$conn->connect_error) {
              echo 'CONNECTION_FAILED';
            } else {
              echo 'CONNECTION_SUCCESS';
              \$conn->close();
            }
          } catch (Exception \$e) {
            echo 'CONNECTION_ERROR';
          }
        } else {
          echo 'NO_CONFIG';
        }
      "`,
      'Test database accessibility'
    );

    const accessible = testResult.stdout.includes('CONNECTION_SUCCESS');

    evidence.push({
      type: 'command_output',
      description: 'Database accessibility check',
      content: accessible ? 'Database accessible' : testResult.stdout,
      signature: this.generateSignature(testResult.stdout),
      timestamp: new Date(),
    });

    return { accessible, evidence };
  }

  private async checkFilePermissions(context: FixContext): Promise<{
    adequate: boolean;
    evidence: FixEvidence[];
  }> {
    const evidence: FixEvidence[] = [];

    // Check if we can write to WordPress directory
    const writeTest = await this.executeCommand(
      context,
      `touch "${context.wordpressPath}/.wp-autohealer-test" && rm "${context.wordpressPath}/.wp-autohealer-test" && echo "WRITE_OK" || echo "WRITE_FAILED"`,
      'Test write permissions to WordPress directory'
    );

    const adequate = writeTest.stdout.includes('WRITE_OK');

    evidence.push({
      type: 'command_output',
      description: 'File permissions check',
      content: adequate ? 'Write permissions adequate' : 'Insufficient write permissions',
      signature: this.generateSignature(writeTest.stdout),
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