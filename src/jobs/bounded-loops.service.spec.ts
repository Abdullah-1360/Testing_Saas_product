import { Test, TestingModule } from '@nestjs/testing';
import { BoundedLoopsService, LoopBounds, LoopContext } from './bounded-loops.service';

describe('BoundedLoopsService', () => {
  let service: BoundedLoopsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [BoundedLoopsService],
    }).compile();

    service = module.get<BoundedLoopsService>(BoundedLoopsService);
    
    // Use fake timers for consistent testing
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('startLoop', () => {
    it('should start a loop with default bounds for known loop type', () => {
      const context = service.startLoop('test-loop-1', 'incident-processing');

      expect(context.loopId).toBe('test-loop-1');
      expect(context.iterations).toBe(0);
      expect(context.retries).toBe(0);
      expect(context.startTime).toBeInstanceOf(Date);
      expect(context.bounds.maxIterations).toBe(50);
      expect(context.bounds.maxDuration).toBe(30 * 60 * 1000);
      expect(context.bounds.maxRetries).toBe(15);
    });

    it('should start a loop with custom bounds', () => {
      const customBounds: Partial<LoopBounds> = {
        maxIterations: 10,
        maxDuration: 5000,
      };

      const context = service.startLoop('test-loop-2', 'fix-attempt', customBounds);

      expect(context.bounds.maxIterations).toBe(10);
      expect(context.bounds.maxDuration).toBe(5000);
      expect(context.bounds.maxRetries).toBe(5); // Should keep default for fix-attempt
    });

    it('should start a loop with metadata', () => {
      const metadata = { incidentId: 'inc-123', serverId: 'srv-456' };
      const context = service.startLoop('test-loop-3', 'verification', undefined, metadata);

      expect(context.metadata).toEqual(metadata);
    });

    it('should use default bounds for unknown loop type', () => {
      const context = service.startLoop('test-loop-4', 'unknown-type');

      expect(context.bounds.maxIterations).toBe(50); // incident-processing defaults
      expect(context.bounds.maxDuration).toBe(30 * 60 * 1000);
      expect(context.bounds.maxRetries).toBe(15);
    });
  });

  describe('canContinue', () => {
    it('should allow continuation when within all bounds', () => {
      service.startLoop('test-loop', 'fix-attempt');

      const result = service.canContinue('test-loop');

      expect(result.canContinue).toBe(true);
      expect(result.reason).toBeUndefined();
      expect(result.context).toBeDefined();
    });

    it('should prevent continuation when max iterations exceeded', () => {
      const context = service.startLoop('test-loop', 'fix-attempt', { maxIterations: 2 });
      
      // Record iterations to exceed limit
      service.recordIteration('test-loop');
      service.recordIteration('test-loop');

      const result = service.canContinue('test-loop');

      expect(result.canContinue).toBe(false);
      expect(result.reason).toContain('Exceeded maximum iterations (2)');
      expect(result.boundType).toBe('iterations');
    });

    it('should prevent continuation when max duration exceeded', () => {
      service.startLoop('test-loop', 'fix-attempt', { maxDuration: 5000 });

      // Advance time beyond limit
      jest.advanceTimersByTime(6000);

      const result = service.canContinue('test-loop');

      expect(result.canContinue).toBe(false);
      expect(result.reason).toContain('Exceeded maximum duration (5000ms)');
      expect(result.boundType).toBe('duration');
    });

    it('should prevent continuation when max retries exceeded', () => {
      service.startLoop('test-loop', 'fix-attempt', { maxRetries: 2 });
      
      // Record retries to exceed limit
      service.recordRetry('test-loop', 'First retry');
      service.recordRetry('test-loop', 'Second retry');

      const result = service.canContinue('test-loop');

      expect(result.canContinue).toBe(false);
      expect(result.reason).toContain('Exceeded maximum retries (2)');
      expect(result.boundType).toBe('retries');
    });

    it('should return false for non-existent loop', () => {
      const result = service.canContinue('non-existent-loop');

      expect(result.canContinue).toBe(false);
      expect(result.reason).toBe('Loop context not found');
    });
  });

  describe('recordIteration', () => {
    it('should record iteration and update context', () => {
      service.startLoop('test-loop', 'fix-attempt');

      const result = service.recordIteration('test-loop');

      expect(result).toBe(true);
      
      const context = service.getLoopContext('test-loop');
      expect(context?.iterations).toBe(1);
      expect(context?.lastIterationTime).toBeInstanceOf(Date);
    });

    it('should record iteration with metadata', () => {
      service.startLoop('test-loop', 'fix-attempt');
      const metadata = { step: 'database-check' };

      service.recordIteration('test-loop', metadata);

      const context = service.getLoopContext('test-loop');
      expect(context?.metadata).toEqual(metadata);
    });

    it('should merge metadata with existing metadata', () => {
      service.startLoop('test-loop', 'fix-attempt', undefined, { initial: 'data' });
      
      service.recordIteration('test-loop', { step: 'database-check' });

      const context = service.getLoopContext('test-loop');
      expect(context?.metadata).toEqual({
        initial: 'data',
        step: 'database-check',
      });
    });

    it('should return false for non-existent loop', () => {
      const result = service.recordIteration('non-existent-loop');

      expect(result).toBe(false);
    });
  });

  describe('recordRetry', () => {
    it('should record retry and update context', () => {
      service.startLoop('test-loop', 'fix-attempt');

      const result = service.recordRetry('test-loop', 'Connection failed');

      expect(result).toBe(true);
      
      const context = service.getLoopContext('test-loop');
      expect(context?.retries).toBe(1);
      expect(context?.lastIterationTime).toBeInstanceOf(Date);
    });

    it('should record retry with metadata', () => {
      service.startLoop('test-loop', 'fix-attempt');
      const metadata = { errorCode: 'CONN_FAILED' };

      service.recordRetry('test-loop', 'Connection failed', metadata);

      const context = service.getLoopContext('test-loop');
      expect(context?.metadata).toEqual(metadata);
    });

    it('should return false for non-existent loop', () => {
      const result = service.recordRetry('non-existent-loop', 'Test retry');

      expect(result).toBe(false);
    });
  });

  describe('completeLoop', () => {
    it('should complete loop successfully', () => {
      service.startLoop('test-loop', 'fix-attempt');
      service.recordIteration('test-loop');
      service.recordRetry('test-loop', 'Test retry');

      jest.advanceTimersByTime(5000);

      const result = service.completeLoop('test-loop', true, 'Fixed successfully');

      expect(result.completed).toBe(true);
      expect(result.reason).toBe('Fixed successfully');
      expect(result.iterations).toBe(1);
      expect(result.duration).toBe(5000);
      expect(result.exceededBounds).toBe(false);

      // Loop should be removed from active loops
      expect(service.getLoopContext('test-loop')).toBeNull();
    });

    it('should complete loop with failure', () => {
      service.startLoop('test-loop', 'fix-attempt');

      const result = service.completeLoop('test-loop', false, 'Fix failed');

      expect(result.completed).toBe(false);
      expect(result.reason).toBe('Fix failed');
    });

    it('should detect exceeded bounds on completion', () => {
      service.startLoop('test-loop', 'fix-attempt', { maxIterations: 1 });
      service.recordIteration('test-loop');

      const result = service.completeLoop('test-loop', true);

      expect(result.exceededBounds).toBe(true);
      expect(result.boundType).toBe('iterations');
    });

    it('should handle non-existent loop', () => {
      const result = service.completeLoop('non-existent-loop');

      expect(result.completed).toBe(false);
      expect(result.reason).toBe('Loop context not found');
      expect(result.iterations).toBe(0);
      expect(result.duration).toBe(0);
    });

    it('should use default reason for successful completion', () => {
      service.startLoop('test-loop', 'fix-attempt');

      const result = service.completeLoop('test-loop', true);

      expect(result.reason).toBe('Completed successfully');
    });

    it('should use default reason for failed completion', () => {
      service.startLoop('test-loop', 'fix-attempt');

      const result = service.completeLoop('test-loop', false);

      expect(result.reason).toBe('Failed');
    });
  });

  describe('getLoopContext', () => {
    it('should return loop context for existing loop', () => {
      const originalContext = service.startLoop('test-loop', 'fix-attempt');

      const context = service.getLoopContext('test-loop');

      expect(context).toEqual(originalContext);
      expect(context).not.toBe(originalContext); // Should be a copy
    });

    it('should return null for non-existent loop', () => {
      const context = service.getLoopContext('non-existent-loop');

      expect(context).toBeNull();
    });
  });

  describe('getActiveLoops', () => {
    it('should return all active loops', () => {
      service.startLoop('loop-1', 'fix-attempt');
      service.startLoop('loop-2', 'verification');

      const activeLoops = service.getActiveLoops();

      expect(Object.keys(activeLoops)).toHaveLength(2);
      expect(activeLoops['loop-1']).toBeDefined();
      expect(activeLoops['loop-2']).toBeDefined();
    });

    it('should return empty object when no active loops', () => {
      const activeLoops = service.getActiveLoops();

      expect(activeLoops).toEqual({});
    });

    it('should return copies of contexts', () => {
      const originalContext = service.startLoop('test-loop', 'fix-attempt');
      const activeLoops = service.getActiveLoops();

      expect(activeLoops['test-loop']).toEqual(originalContext);
      expect(activeLoops['test-loop']).not.toBe(originalContext);
    });
  });

  describe('getLoopsApproachingBounds', () => {
    it('should identify loops approaching iteration bounds', () => {
      service.startLoop('loop-1', 'fix-attempt', { maxIterations: 10 });
      service.startLoop('loop-2', 'fix-attempt', { maxIterations: 10 });

      // Loop 1: 8/10 iterations (80% - at threshold)
      for (let i = 0; i < 8; i++) {
        service.recordIteration('loop-1');
      }

      // Loop 2: 5/10 iterations (50% - below threshold)
      for (let i = 0; i < 5; i++) {
        service.recordIteration('loop-2');
      }

      const approaching = service.getLoopsApproachingBounds(0.8);

      expect(approaching).toContain('loop-1');
      expect(approaching).not.toContain('loop-2');
    });

    it('should identify loops approaching duration bounds', () => {
      service.startLoop('loop-1', 'fix-attempt', { maxDuration: 10000 });
      service.startLoop('loop-2', 'fix-attempt', { maxDuration: 10000 });

      // Advance time to 8 seconds (80% of 10 seconds)
      jest.advanceTimersByTime(8000);

      const approaching = service.getLoopsApproachingBounds(0.8);

      expect(approaching).toContain('loop-1');
      expect(approaching).toContain('loop-2');
    });

    it('should identify loops approaching retry bounds', () => {
      service.startLoop('loop-1', 'fix-attempt', { maxRetries: 5 });

      // 4/5 retries (80% - at threshold)
      for (let i = 0; i < 4; i++) {
        service.recordRetry('loop-1', `Retry ${i + 1}`);
      }

      const approaching = service.getLoopsApproachingBounds(0.8);

      expect(approaching).toContain('loop-1');
    });

    it('should use custom threshold', () => {
      service.startLoop('loop-1', 'fix-attempt', { maxIterations: 10 });

      // 6/10 iterations (60%)
      for (let i = 0; i < 6; i++) {
        service.recordIteration('loop-1');
      }

      const approaching50 = service.getLoopsApproachingBounds(0.5);
      const approaching70 = service.getLoopsApproachingBounds(0.7);

      expect(approaching50).toContain('loop-1');
      expect(approaching70).not.toContain('loop-1');
    });
  });

  describe('forceTerminate', () => {
    it('should force terminate an active loop', () => {
      service.startLoop('test-loop', 'fix-attempt');
      service.recordIteration('test-loop');

      const result = service.forceTerminate('test-loop', 'Emergency stop');

      expect(result).toBeDefined();
      expect(result!.completed).toBe(false);
      expect(result!.reason).toBe('Force terminated: Emergency stop');
      expect(result!.iterations).toBe(1);

      // Loop should be removed
      expect(service.getLoopContext('test-loop')).toBeNull();
    });

    it('should return null for non-existent loop', () => {
      const result = service.forceTerminate('non-existent-loop', 'Test reason');

      expect(result).toBeNull();
    });
  });

  describe('updateBounds', () => {
    it('should update bounds for active loop', () => {
      service.startLoop('test-loop', 'fix-attempt');

      const result = service.updateBounds('test-loop', {
        maxIterations: 20,
        maxDuration: 15000,
      });

      expect(result).toBe(true);

      const context = service.getLoopContext('test-loop');
      expect(context?.bounds.maxIterations).toBe(20);
      expect(context?.bounds.maxDuration).toBe(15000);
      expect(context?.bounds.maxRetries).toBe(5); // Should keep original
    });

    it('should return false for non-existent loop', () => {
      const result = service.updateBounds('non-existent-loop', { maxIterations: 10 });

      expect(result).toBe(false);
    });
  });

  describe('getStats', () => {
    it('should return statistics for active loops', () => {
      service.startLoop('loop-1', 'fix-attempt');
      service.startLoop('loop-2', 'verification');

      service.recordIteration('loop-1');
      service.recordIteration('loop-1');
      service.recordIteration('loop-2');

      jest.advanceTimersByTime(5000);

      const stats = service.getStats();

      expect(stats.activeLoops).toBe(2);
      expect(stats.totalLoopsStarted).toBe(2);
      expect(stats.averageIterations).toBe(1.5); // (2 + 1) / 2
      expect(stats.averageDuration).toBe(5000);
    });

    it('should handle no active loops', () => {
      const stats = service.getStats();

      expect(stats.activeLoops).toBe(0);
      expect(stats.averageIterations).toBe(0);
      expect(stats.averageDuration).toBe(0);
    });
  });

  describe('cleanupStaleLoops', () => {
    it('should clean up loops older than specified age', () => {
      // Start a loop
      service.startLoop('old-loop', 'fix-attempt');
      service.startLoop('new-loop', 'fix-attempt');

      // Advance time by 3 hours
      jest.advanceTimersByTime(3 * 60 * 60 * 1000);

      // Start another loop (this should not be cleaned up)
      service.startLoop('newer-loop', 'fix-attempt');

      const cleanedCount = service.cleanupStaleLoops(2); // 2 hours max age

      expect(cleanedCount).toBe(2); // old-loop and new-loop should be cleaned
      expect(service.getLoopContext('old-loop')).toBeNull();
      expect(service.getLoopContext('new-loop')).toBeNull();
      expect(service.getLoopContext('newer-loop')).toBeDefined();
    });

    it('should not clean up recent loops', () => {
      service.startLoop('recent-loop', 'fix-attempt');

      jest.advanceTimersByTime(30 * 60 * 1000); // 30 minutes

      const cleanedCount = service.cleanupStaleLoops(2);

      expect(cleanedCount).toBe(0);
      expect(service.getLoopContext('recent-loop')).toBeDefined();
    });
  });

  describe('default bounds management', () => {
    it('should update default bounds for loop type', () => {
      const newBounds: Partial<LoopBounds> = {
        maxIterations: 25,
        maxDuration: 20000,
      };

      service.updateDefaultBounds('custom-type', newBounds);

      const bounds = service.getDefaultBounds('custom-type');
      expect(bounds.maxIterations).toBe(25);
      expect(bounds.maxDuration).toBe(20000);
      expect(bounds.maxRetries).toBe(15); // Should use incident-processing default
    });

    it('should get default bounds for known loop type', () => {
      const bounds = service.getDefaultBounds('fix-attempt');

      expect(bounds.maxIterations).toBe(15);
      expect(bounds.maxDuration).toBe(10 * 60 * 1000);
      expect(bounds.maxRetries).toBe(5);
    });

    it('should get fallback bounds for unknown loop type', () => {
      const bounds = service.getDefaultBounds('unknown-type');

      expect(bounds.maxIterations).toBe(50); // incident-processing defaults
      expect(bounds.maxDuration).toBe(30 * 60 * 1000);
      expect(bounds.maxRetries).toBe(15);
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle multiple operations on same loop', () => {
      service.startLoop('test-loop', 'fix-attempt');

      service.recordIteration('test-loop');
      service.recordRetry('test-loop', 'First retry');
      service.recordIteration('test-loop');
      service.recordRetry('test-loop', 'Second retry');

      const context = service.getLoopContext('test-loop');
      expect(context?.iterations).toBe(2);
      expect(context?.retries).toBe(2);
    });

    it('should handle zero bounds gracefully', () => {
      service.startLoop('test-loop', 'fix-attempt', {
        maxIterations: 0,
        maxDuration: 0,
        maxRetries: 0,
      });

      const result = service.canContinue('test-loop');

      expect(result.canContinue).toBe(false);
      expect(result.boundType).toBe('iterations');
    });

    it('should handle negative bounds gracefully', () => {
      service.startLoop('test-loop', 'fix-attempt', {
        maxIterations: -1,
        maxDuration: -1,
        maxRetries: -1,
      });

      const result = service.canContinue('test-loop');

      expect(result.canContinue).toBe(false);
    });

    it('should handle concurrent loop operations', () => {
      service.startLoop('loop-1', 'fix-attempt');
      service.startLoop('loop-2', 'verification');

      service.recordIteration('loop-1');
      service.recordIteration('loop-2');
      service.recordRetry('loop-1', 'Retry');

      const context1 = service.getLoopContext('loop-1');
      const context2 = service.getLoopContext('loop-2');

      expect(context1?.iterations).toBe(1);
      expect(context1?.retries).toBe(1);
      expect(context2?.iterations).toBe(1);
      expect(context2?.retries).toBe(0);
    });

    it('should handle loop completion after bounds exceeded', () => {
      service.startLoop('test-loop', 'fix-attempt', { maxIterations: 1 });
      service.recordIteration('test-loop');

      // Loop is now at bounds
      const canContinue = service.canContinue('test-loop');
      expect(canContinue.canContinue).toBe(false);

      // Should still be able to complete
      const result = service.completeLoop('test-loop', false, 'Exceeded bounds');
      expect(result.completed).toBe(false);
      expect(result.exceededBounds).toBe(true);
    });
  });
});