import { Injectable, Logger } from '@nestjs/common';
import { IFixPlaybook, FixTier, FixContext, FixEvidence } from './interfaces/fix-playbook.interface';

@Injectable()
export class FixPlaybookRegistry {
  private readonly logger = new Logger(FixPlaybookRegistry.name);
  private readonly playbooks = new Map<string, IFixPlaybook>();
  private readonly playbooksByTier = new Map<FixTier, IFixPlaybook[]>();

  /**
   * Register a fix playbook
   */
  registerPlaybook(playbook: IFixPlaybook): void {
    this.playbooks.set(playbook.name, playbook);
    
    // Add to tier-based index
    if (!this.playbooksByTier.has(playbook.tier)) {
      this.playbooksByTier.set(playbook.tier, []);
    }
    this.playbooksByTier.get(playbook.tier)!.push(playbook);
    
    // Sort by priority within tier
    this.playbooksByTier.get(playbook.tier)!.sort((a, b) => a.priority - b.priority);
    
    this.logger.log(`Registered fix playbook: ${playbook.name} (Tier ${playbook.tier})`);
  }

  /**
   * Get all playbooks for a specific tier
   */
  getPlaybooksForTier(tier: FixTier): IFixPlaybook[] {
    return this.playbooksByTier.get(tier) || [];
  }

  /**
   * Get applicable playbooks for a context and evidence
   */
  async getApplicablePlaybooks(
    context: FixContext, 
    evidence: FixEvidence[], 
    tier?: FixTier
  ): Promise<IFixPlaybook[]> {
    const playbooks = tier 
      ? this.getPlaybooksForTier(tier)
      : Array.from(this.playbooks.values());

    const applicablePlaybooks: IFixPlaybook[] = [];

    for (const playbook of playbooks) {
      try {
        const canApply = await playbook.canApply(context, evidence);
        if (canApply) {
          applicablePlaybooks.push(playbook);
        }
      } catch (error) {
        this.logger.error(`Error checking applicability for playbook ${playbook.name}:`, error);
      }
    }

    // Sort by tier first, then by priority
    return applicablePlaybooks.sort((a, b) => {
      if (a.tier !== b.tier) {
        return a.tier - b.tier;
      }
      return a.priority - b.priority;
    });
  }

  /**
   * Get a specific playbook by name
   */
  getPlaybook(name: string): IFixPlaybook | undefined {
    return this.playbooks.get(name);
  }

  /**
   * Get all registered playbooks
   */
  getAllPlaybooks(): IFixPlaybook[] {
    return Array.from(this.playbooks.values());
  }

  /**
   * Get playbook statistics
   */
  getStats(): {
    totalPlaybooks: number;
    playbooksByTier: Record<number, number>;
  } {
    const playbooksByTier: Record<number, number> = {};
    
    for (const [tier, playbooks] of this.playbooksByTier.entries()) {
      playbooksByTier[tier] = playbooks.length;
    }

    return {
      totalPlaybooks: this.playbooks.size,
      playbooksByTier,
    };
  }
}