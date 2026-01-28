import { Injectable, Logger } from '@nestjs/common';
import { FixPlaybookRegistry } from './fix-playbook-registry.service';
import { Tier1InfrastructureService } from './tiers/tier1-infrastructure.service';
import { Tier2CoreIntegrityService } from './tiers/tier2-core-integrity.service';
import { Tier3PluginThemeConflictsService } from './tiers/tier3-plugin-theme-conflicts.service';
import { 
  FixTier, 
  FixContext, 
  FixEvidence, 
  FixResult 
} from './interfaces/fix-playbook.interface';

@Injectable()
export class WordPressFixesService {
  private readonly logger = new Logger(WordPressFixesService.name);

  constructor(
    private readonly playbookRegistry: FixPlaybookRegistry,
    private readonly tier1Infrastructure: Tier1InfrastructureService,
    private readonly tier2CoreIntegrity: Tier2CoreIntegrityService,
    private readonly tier3PluginThemeConflicts: Tier3PluginThemeConflictsService,
  ) {}

  /**
   * Execute WordPress fixes following tier priority order
   */
  async executeWordPressFixes(
    context: FixContext,
    evidence: FixEvidence[],
    maxTier: FixTier = FixTier.TIER_6_COMPONENT_ROLLBACK
  ): Promise<{
    success: boolean;
    results: FixResult[];
    tierExecuted: FixTier | null;
    totalFixesApplied: number;
  }> {
    this.logger.log(`Starting WordPress fixes for incident ${context.incidentId}`);

    const allResults: FixResult[] = [];
    let tierExecuted: FixTier | null = null;
    let totalFixesApplied = 0;

    // Execute fixes in tier priority order (Tier 1 through maxTier)
    for (let tier = FixTier.TIER_1_INFRASTRUCTURE; tier <= maxTier; tier++) {
      this.logger.log(`Executing Tier ${tier} fixes for incident ${context.incidentId}`);

      let tierResults: FixResult[] = [];

      switch (tier) {
        case FixTier.TIER_1_INFRASTRUCTURE:
          tierResults = await this.tier1Infrastructure.executeTier1Fixes(context, evidence);
          break;
        
        case FixTier.TIER_2_CORE_INTEGRITY:
          tierResults = await this.tier2CoreIntegrity.executeTier2Fixes(context, evidence);
          break;
        
        case FixTier.TIER_3_PLUGIN_THEME_CONFLICTS:
          tierResults = await this.tier3PluginThemeConflicts.executeTier3Fixes(context, evidence);
          break;
        
        // TODO: Implement remaining tiers in future tasks
        case FixTier.TIER_4_CACHE_FLUSH:
        case FixTier.TIER_5_DEPENDENCY_REPAIR:
        case FixTier.TIER_6_COMPONENT_ROLLBACK:
          this.logger.log(`Tier ${tier} not yet implemented, skipping`);
          continue;
        
        default:
          continue;
      }

      allResults.push(...tierResults);

      // Check if any fixes were successfully applied in this tier
      const appliedFixes = tierResults.filter(r => r.success && r.applied);
      if (appliedFixes.length > 0) {
        tierExecuted = tier;
        totalFixesApplied += appliedFixes.length;

        this.logger.log(`Tier ${tier} applied ${appliedFixes.length} fixes for incident ${context.incidentId}`);

        // Conservative approach: stop after first successful tier
        // This prevents over-fixing and maintains system stability
        break;
      }
    }

    const overallSuccess = totalFixesApplied > 0;

    this.logger.log(`WordPress fixes completed for incident ${context.incidentId}. Success: ${overallSuccess}, Fixes applied: ${totalFixesApplied}`);

    return {
      success: overallSuccess,
      results: allResults,
      tierExecuted,
      totalFixesApplied,
    };
  }

  /**
   * Get applicable playbooks for the given context and evidence
   */
  async getApplicablePlaybooks(
    context: FixContext,
    evidence: FixEvidence[],
    tier?: FixTier
  ): Promise<string[]> {
    const applicablePlaybooks = await this.playbookRegistry.getApplicablePlaybooks(
      context,
      evidence,
      tier
    );

    return applicablePlaybooks.map(p => p.name);
  }

  /**
   * Execute a specific playbook by name
   */
  async executeSpecificPlaybook(
    playbookName: string,
    context: FixContext
  ): Promise<FixResult | null> {
    const playbook = this.playbookRegistry.getPlaybook(playbookName);
    if (!playbook) {
      this.logger.error(`Playbook not found: ${playbookName}`);
      return null;
    }

    try {
      this.logger.log(`Executing specific playbook ${playbookName} for incident ${context.incidentId}`);
      
      const result = await playbook.apply(context);
      
      this.logger.log(`Playbook ${playbookName} completed for incident ${context.incidentId}. Success: ${result.success}, Applied: ${result.applied}`);
      
      return {
        ...result,
        metadata: {
          ...result.metadata,
          playbookName: playbook.name,
          tier: playbook.tier,
          priority: playbook.priority,
        },
      };
    } catch (error) {
      this.logger.error(`Error executing playbook ${playbookName} for incident ${context.incidentId}:`, error);
      
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
   * Get playbook registry statistics
   */
  getPlaybookStats(): {
    totalPlaybooks: number;
    playbooksByTier: Record<number, number>;
    tier1Stats: {
      totalPlaybooks: number;
      playbookNames: string[];
    };
    tier2Stats: {
      totalPlaybooks: number;
      playbookNames: string[];
    };
    tier3Stats: {
      totalPlaybooks: number;
      playbookNames: string[];
    };
  } {
    const registryStats = this.playbookRegistry.getStats();
    const tier1Stats = this.tier1Infrastructure.getTier1Stats();
    const tier2Stats = this.tier2CoreIntegrity.getTier2Stats();
    const tier3Stats = this.tier3PluginThemeConflicts.getTier3Stats();

    return {
      ...registryStats,
      tier1Stats,
      tier2Stats,
      tier3Stats,
    };
  }

  /**
   * Validate fix context
   */
  validateFixContext(context: FixContext): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    if (!context.incidentId) {
      errors.push('Missing incident ID');
    }

    if (!context.siteId) {
      errors.push('Missing site ID');
    }

    if (!context.serverId) {
      errors.push('Missing server ID');
    }

    if (!context.sitePath) {
      errors.push('Missing site path');
    }

    if (!context.wordpressPath) {
      errors.push('Missing WordPress path');
    }

    if (!context.domain) {
      errors.push('Missing domain');
    }

    if (!context.correlationId) {
      errors.push('Missing correlation ID');
    }

    if (!context.traceId) {
      errors.push('Missing trace ID');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Create fix context from incident data
   */
  createFixContext(incidentData: {
    incidentId: string;
    siteId: string;
    serverId: string;
    sitePath: string;
    wordpressPath: string;
    domain: string;
    correlationId: string;
    traceId: string;
    metadata?: Record<string, any>;
  }): FixContext {
    return {
      incidentId: incidentData.incidentId,
      siteId: incidentData.siteId,
      serverId: incidentData.serverId,
      sitePath: incidentData.sitePath,
      wordpressPath: incidentData.wordpressPath,
      domain: incidentData.domain,
      correlationId: incidentData.correlationId,
      traceId: incidentData.traceId,
      metadata: incidentData.metadata || {},
    };
  }
}