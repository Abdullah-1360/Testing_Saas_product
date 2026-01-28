import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { FixPlaybookRegistry } from '../fix-playbook-registry.service';
import { FixTier, FixContext, FixEvidence, FixResult } from '../interfaces/fix-playbook.interface';
import { DiskSpaceCleanupService } from '../playbooks/disk-space-cleanup.service';
import { MemoryLimitAdjustmentService } from '../playbooks/memory-limit-adjustment.service';
import { PhpErrorLogAnalysisService } from '../playbooks/php-error-log-analysis.service';
import { WebServerConfigFixesService } from '../playbooks/web-server-config-fixes.service';
import { DatabaseConnectionRestorationService } from '../playbooks/database-connection-restoration.service';

@Injectable()
export class Tier1InfrastructureService implements OnModuleInit {
  private readonly logger = new Logger(Tier1InfrastructureService.name);

  constructor(
    private readonly playbookRegistry: FixPlaybookRegistry,
    private readonly diskSpaceCleanup: DiskSpaceCleanupService,
    private readonly memoryLimitAdjustment: MemoryLimitAdjustmentService,
    private readonly phpErrorLogAnalysis: PhpErrorLogAnalysisService,
    private readonly webServerConfigFixes: WebServerConfigFixesService,
    private readonly databaseConnectionRestoration: DatabaseConnectionRestorationService,
  ) {}

  onModuleInit() {
    // Register all Tier 1 playbooks
    this.playbookRegistry.registerPlaybook(this.diskSpaceCleanup);
    this.playbookRegistry.registerPlaybook(this.memoryLimitAdjustment);
    this.playbookRegistry.registerPlaybook(this.phpErrorLogAnalysis);
    this.playbookRegistry.registerPlaybook(this.webServerConfigFixes);
    this.playbookRegistry.registerPlaybook(this.databaseConnectionRestoration);

    this.logger.log('Tier 1 Infrastructure playbooks registered');
  }

  /**
   * Execute Tier 1 infrastructure fixes in priority order
   */
  async executeTier1Fixes(
    context: FixContext,
    evidence: FixEvidence[]
  ): Promise<FixResult[]> {
    this.logger.log(`Executing Tier 1 infrastructure fixes for incident ${context.incidentId}`);

    const tier1Playbooks = this.playbookRegistry.getPlaybooksForTier(FixTier.TIER_1_INFRASTRUCTURE);
    const results: FixResult[] = [];

    for (const playbook of tier1Playbooks) {
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
          break; // Conservative approach: apply one fix at a time
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

    this.logger.log(`Completed Tier 1 fixes for incident ${context.incidentId}. Applied ${results.filter(r => r.applied).length} fixes.`);
    return results;
  }

  /**
   * Get applicable Tier 1 playbooks for the given context and evidence
   */
  async getApplicableTier1Playbooks(
    context: FixContext,
    evidence: FixEvidence[]
  ): Promise<string[]> {
    const applicablePlaybooks = await this.playbookRegistry.getApplicablePlaybooks(
      context,
      evidence,
      FixTier.TIER_1_INFRASTRUCTURE
    );

    return applicablePlaybooks.map(p => p.name);
  }

  /**
   * Get Tier 1 playbook statistics
   */
  getTier1Stats(): {
    totalPlaybooks: number;
    playbookNames: string[];
  } {
    const tier1Playbooks = this.playbookRegistry.getPlaybooksForTier(FixTier.TIER_1_INFRASTRUCTURE);
    
    return {
      totalPlaybooks: tier1Playbooks.length,
      playbookNames: tier1Playbooks.map(p => p.name),
    };
  }
}