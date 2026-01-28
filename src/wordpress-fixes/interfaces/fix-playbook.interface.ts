export enum FixTier {
  TIER_1_INFRASTRUCTURE = 1,
  TIER_2_CORE_INTEGRITY = 2,
  TIER_3_PLUGIN_THEME_CONFLICTS = 3,
  TIER_4_CACHE_FLUSH = 4,
  TIER_5_DEPENDENCY_REPAIR = 5,
  TIER_6_COMPONENT_ROLLBACK = 6,
}

export enum FixPriority {
  CRITICAL = 1,
  HIGH = 2,
  MEDIUM = 3,
  LOW = 4,
}

export interface FixContext {
  incidentId: string;
  siteId: string;
  serverId: string;
  sitePath: string;
  wordpressPath: string;
  domain: string;
  correlationId: string;
  traceId: string;
  metadata?: Record<string, any>;
}

export interface FixResult {
  success: boolean;
  applied: boolean;
  changes: FixChange[];
  evidence: FixEvidence[];
  rollbackPlan?: RollbackPlan;
  error?: string;
  metadata?: Record<string, any>;
}

export interface FixChange {
  type: 'file' | 'command' | 'config' | 'database';
  description: string;
  path?: string;
  command?: string;
  originalValue?: string;
  newValue?: string;
  checksum?: string;
  timestamp: Date;
}

export interface FixEvidence {
  type: 'log' | 'command_output' | 'file_content' | 'system_info';
  description: string;
  content: string;
  signature: string;
  timestamp: Date;
  metadata?: Record<string, any>;
}

export interface RollbackPlan {
  steps: RollbackStep[];
  metadata: Record<string, any>;
  createdAt: Date;
}

export interface RollbackStep {
  type: 'restore_file' | 'execute_command' | 'revert_config';
  description: string;
  action: string;
  parameters: Record<string, any>;
  order: number;
}

export interface IFixPlaybook {
  readonly name: string;
  readonly tier: FixTier;
  readonly priority: FixPriority;
  readonly description: string;
  readonly applicableConditions: string[];
  
  canApply(context: FixContext, evidence: FixEvidence[]): Promise<boolean>;
  apply(context: FixContext): Promise<FixResult>;
  rollback(context: FixContext, rollbackPlan: RollbackPlan): Promise<boolean>;
  getHypothesis(context: FixContext, evidence: FixEvidence[]): string;
}