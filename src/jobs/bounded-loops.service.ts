import { Injectable, Logger } from '@nestjs/common';

export interface LoopBounds {
  maxIterations: number;
  maxDuration: number; // milliseconds
  maxRetries: number;
}

export interface LoopContext {
  loopId: string;
  startTime: Date;
  iterations: number;
  retries: number;
  lastIterationTime: Date;
  bounds: LoopBounds;
  metadata?: Record<string, any> | undefined;
}

export interface LoopResult {
  completed: boolean;
  reason: string;
  iterations: number;
  duration: number;
  exceededBounds: boolean;
  boundType?: 'iterations' | 'duration' | 'retries' | undefined;
}

@Injectable()
export class BoundedLoopsService {
  private readonly logger = new Logger(BoundedLoopsService.name);
  private activeLoops: Map<string, LoopContext> = new Map();
  
  // Default bounds for different loop types
  private readonly defaultBounds: Record<string, LoopBounds> = {
    'incident-processing': {
      maxIterations: 50,
      maxDuration: 30 * 60 * 1000, // 30 minutes
      maxRetries: 15,
    },
    'fix-attempt': {
      maxIterations: 15,
      maxDuration: 10 * 60 * 1000, // 10 minutes
      maxRetries: 5,
    },
    'verification': {
      maxIterations: 10,
      maxDuration: 5 * 60 * 1000, // 5 minutes
      maxRetries: 3,
    },
    'discovery': {
      maxIterations: 20,
      maxDuration: 15 * 60 * 1000, // 15 minutes
      maxRetries: 3,
    },
    'backup': {
      maxIterations: 5,
      maxDuration: 20 * 60 * 1000, // 20 minutes
      maxRetries: 2,
    },
    'rollback': {
      maxIterations: 10,
      maxDuration: 15 * 60 * 1000, // 15 minutes
      maxRetries: 3,
    },
  };

  /**
   * Start a bounded loop
   */
  startLoop(
    loopId: string,
    loopType: string,
    customBounds?: Partial<LoopBounds>,
    metadata?: Record<string, any>
  ): LoopContext {
    const defaultBounds = this.defaultBounds[loopType] || this.defaultBounds['incident-processing'];
    const bounds: LoopBounds = {
      maxIterations: defaultBounds!.maxIterations,
      maxDuration: defaultBounds!.maxDuration,
      maxRetries: defaultBounds!.maxRetries,
      ...customBounds,
    };

    const context: LoopContext = {
      loopId,
      startTime: new Date(),
      iterations: 0,
      retries: 0,
      lastIterationTime: new Date(),
      bounds,
      metadata,
    };

    this.activeLoops.set(loopId, context);

    this.logger.log(`Started bounded loop ${loopId}`, {
      loopType,
      bounds,
      metadata,
    });

    return context;
  }

  /**
   * Check if loop can continue (within bounds)
   */
  canContinue(loopId: string): {
    canContinue: boolean;
    reason?: string;
    boundType?: 'iterations' | 'duration' | 'retries';
    context?: LoopContext;
  } {
    const context = this.activeLoops.get(loopId);
    if (!context) {
      return {
        canContinue: false,
        reason: 'Loop context not found',
      };
    }

    const now = new Date();
    const duration = now.getTime() - context.startTime.getTime();

    // Check iteration bounds
    if (context.iterations >= context.bounds.maxIterations) {
      this.logger.warn(`Loop ${loopId} exceeded max iterations`, {
        iterations: context.iterations,
        maxIterations: context.bounds.maxIterations,
      });
      
      return {
        canContinue: false,
        reason: `Exceeded maximum iterations (${context.bounds.maxIterations})`,
        boundType: 'iterations',
        context,
      };
    }

    // Check duration bounds
    if (duration >= context.bounds.maxDuration) {
      this.logger.warn(`Loop ${loopId} exceeded max duration`, {
        duration,
        maxDuration: context.bounds.maxDuration,
      });
      
      return {
        canContinue: false,
        reason: `Exceeded maximum duration (${context.bounds.maxDuration}ms)`,
        boundType: 'duration',
        context,
      };
    }

    // Check retry bounds
    if (context.retries >= context.bounds.maxRetries) {
      this.logger.warn(`Loop ${loopId} exceeded max retries`, {
        retries: context.retries,
        maxRetries: context.bounds.maxRetries,
      });
      
      return {
        canContinue: false,
        reason: `Exceeded maximum retries (${context.bounds.maxRetries})`,
        boundType: 'retries',
        context,
      };
    }

    return {
      canContinue: true,
      context,
    };
  }

  /**
   * Record an iteration
   */
  recordIteration(loopId: string, metadata?: Record<string, any>): boolean {
    const context = this.activeLoops.get(loopId);
    if (!context) {
      this.logger.warn(`Attempted to record iteration for unknown loop ${loopId}`);
      return false;
    }

    context.iterations++;
    context.lastIterationTime = new Date();
    
    if (metadata) {
      context.metadata = { ...context.metadata, ...metadata };
    }

    this.logger.debug(`Recorded iteration ${context.iterations} for loop ${loopId}`, {
      iterations: context.iterations,
      maxIterations: context.bounds.maxIterations,
      metadata,
    });

    return true;
  }

  /**
   * Record a retry
   */
  recordRetry(loopId: string, reason?: string, metadata?: Record<string, any>): boolean {
    const context = this.activeLoops.get(loopId);
    if (!context) {
      this.logger.warn(`Attempted to record retry for unknown loop ${loopId}`);
      return false;
    }

    context.retries++;
    context.lastIterationTime = new Date();
    
    if (metadata) {
      context.metadata = { ...context.metadata, ...metadata };
    }

    this.logger.log(`Recorded retry ${context.retries} for loop ${loopId}`, {
      reason,
      retries: context.retries,
      maxRetries: context.bounds.maxRetries,
      metadata,
    });

    return true;
  }

  /**
   * Complete a loop
   */
  completeLoop(loopId: string, successful: boolean = true, reason?: string): LoopResult {
    const context = this.activeLoops.get(loopId);
    if (!context) {
      this.logger.warn(`Attempted to complete unknown loop ${loopId}`);
      return {
        completed: false,
        reason: 'Loop context not found',
        iterations: 0,
        duration: 0,
        exceededBounds: false,
      };
    }

    const endTime = new Date();
    const duration = endTime.getTime() - context.startTime.getTime();
    
    // Check if bounds were exceeded
    const boundsCheck = this.canContinue(loopId);
    const exceededBounds = !boundsCheck.canContinue;

    const result: LoopResult = {
      completed: successful,
      reason: reason || (successful ? 'Completed successfully' : 'Failed'),
      iterations: context.iterations,
      duration,
      exceededBounds,
      boundType: boundsCheck.boundType,
    };

    // Remove from active loops
    this.activeLoops.delete(loopId);

    this.logger.log(`Completed loop ${loopId}`, {
      successful,
      iterations: context.iterations,
      retries: context.retries,
      duration,
      exceededBounds,
      boundType: boundsCheck.boundType,
      reason,
    });

    return result;
  }

  /**
   * Get loop context
   */
  getLoopContext(loopId: string): LoopContext | null {
    const context = this.activeLoops.get(loopId);
    return context ? { ...context } : null;
  }

  /**
   * Get all active loops
   */
  getActiveLoops(): Record<string, LoopContext> {
    const activeLoops: Record<string, LoopContext> = {};
    for (const [loopId, context] of this.activeLoops.entries()) {
      activeLoops[loopId] = { ...context };
    }
    return activeLoops;
  }

  /**
   * Get loops that are approaching bounds
   */
  getLoopsApproachingBounds(threshold: number = 0.8): string[] {
    const approachingLoops: string[] = [];
    const now = new Date();

    for (const [loopId, context] of this.activeLoops.entries()) {
      const duration = now.getTime() - context.startTime.getTime();
      
      // Check if approaching any bounds
      const iterationRatio = context.iterations / context.bounds.maxIterations;
      const durationRatio = duration / context.bounds.maxDuration;
      const retryRatio = context.retries / context.bounds.maxRetries;

      if (iterationRatio >= threshold || durationRatio >= threshold || retryRatio >= threshold) {
        approachingLoops.push(loopId);
      }
    }

    return approachingLoops;
  }

  /**
   * Force terminate a loop (emergency stop)
   */
  forceTerminate(loopId: string, reason: string): LoopResult | null {
    const context = this.activeLoops.get(loopId);
    if (!context) {
      return null;
    }

    this.logger.warn(`Force terminating loop ${loopId}`, { reason });

    return this.completeLoop(loopId, false, `Force terminated: ${reason}`);
  }

  /**
   * Update loop bounds dynamically
   */
  updateBounds(loopId: string, newBounds: Partial<LoopBounds>): boolean {
    const context = this.activeLoops.get(loopId);
    if (!context) {
      return false;
    }

    const oldBounds = { ...context.bounds };
    context.bounds = { ...context.bounds, ...newBounds };

    this.logger.log(`Updated bounds for loop ${loopId}`, {
      oldBounds,
      newBounds: context.bounds,
    });

    return true;
  }

  /**
   * Get statistics about loop usage
   */
  getStats(): {
    activeLoops: number;
    totalLoopsStarted: number;
    averageIterations: number;
    averageDuration: number;
    boundsExceededCount: number;
  } {
    // This is a simplified implementation
    // In a production system, you'd want to persist these stats
    
    const activeLoops = this.activeLoops.size;
    let totalIterations = 0;
    let totalDuration = 0;
    const now = new Date();

    for (const context of this.activeLoops.values()) {
      totalIterations += context.iterations;
      totalDuration += now.getTime() - context.startTime.getTime();
    }

    return {
      activeLoops,
      totalLoopsStarted: activeLoops, // Simplified - would track historical data
      averageIterations: activeLoops > 0 ? totalIterations / activeLoops : 0,
      averageDuration: activeLoops > 0 ? totalDuration / activeLoops : 0,
      boundsExceededCount: 0, // Would track historical data
    };
  }

  /**
   * Clean up stale loops (emergency cleanup)
   */
  cleanupStaleLoops(maxAgeHours: number = 2): number {
    const cutoffTime = Date.now() - (maxAgeHours * 60 * 60 * 1000);
    const staleLoops: string[] = [];

    for (const [loopId, context] of this.activeLoops.entries()) {
      if (context.startTime.getTime() < cutoffTime) {
        staleLoops.push(loopId);
      }
    }

    for (const loopId of staleLoops) {
      this.forceTerminate(loopId, `Stale loop cleanup (older than ${maxAgeHours} hours)`);
    }

    if (staleLoops.length > 0) {
      this.logger.warn(`Cleaned up ${staleLoops.length} stale loops`);
    }

    return staleLoops.length;
  }

  /**
   * Update default bounds for a loop type
   */
  updateDefaultBounds(loopType: string, bounds: Partial<LoopBounds>): void {
    const currentBounds = this.defaultBounds[loopType] || this.defaultBounds['incident-processing'];
    this.defaultBounds[loopType] = {
      maxIterations: currentBounds!.maxIterations,
      maxDuration: currentBounds!.maxDuration,
      maxRetries: currentBounds!.maxRetries,
      ...bounds,
    };

    this.logger.log(`Updated default bounds for loop type ${loopType}`, {
      bounds: this.defaultBounds[loopType],
    });
  }

  /**
   * Get default bounds for a loop type
   */
  getDefaultBounds(loopType: string): LoopBounds {
    const defaultBounds = this.defaultBounds[loopType] || this.defaultBounds['incident-processing'];
    return {
      maxIterations: defaultBounds!.maxIterations,
      maxDuration: defaultBounds!.maxDuration,
      maxRetries: defaultBounds!.maxRetries,
    };
  }
}