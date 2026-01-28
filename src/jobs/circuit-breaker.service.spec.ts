import { Test, TestingModule } from '@nestjs/testing';
import { CircuitBreakerService, CircuitState, CircuitBreakerConfig } from './circuit-breaker.service';

describe('CircuitBreakerService', () => {
  let service: CircuitBreakerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CircuitBreakerService],
    }).compile();

    service = module.get<CircuitBreakerService>(CircuitBreakerService);
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe('registerCircuit', () => {
    it('should register circuit with default config', () => {
      // Arrange
      const circuitId = 'test-circuit';

      // Act
      service.registerCircuit(circuitId);

      // Assert
      const stats = service.getStats(circuitId);
      expect(stats).toEqual({
        state: CircuitState.CLOSED,
        failures: 0,
        successes: 0,
      });
    });

    it('should register circuit with custom config', () => {
      // Arrange
      const circuitId = 'custom-circuit';
      const config: CircuitBreakerConfig = {
        failureThreshold: 3,
        recoveryTimeout: 30000,
        monitoringPeriod: 120000,
      };

      // Act
      service.registerCircuit(circuitId, config);

      // Assert
      const stats = service.getStats(circuitId);
      expect(stats.state).toBe(CircuitState.CLOSED);
      expect(stats.failures).toBe(0);
      expect(stats.successes).toBe(0);
    });
  });

  describe('execute', () => {
    it('should execute operation successfully when circuit is closed', async () => {
      // Arrange
      const circuitId = 'test-circuit';
      const mockOperation = jest.fn().mockResolvedValue('success');
      service.registerCircuit(circuitId);

      // Act
      const result = await service.execute(circuitId, mockOperation);

      // Assert
      expect(result).toBe('success');
      expect(mockOperation).toHaveBeenCalledTimes(1);
      
      const stats = service.getStats(circuitId);
      expect(stats.successes).toBe(1);
      expect(stats.failures).toBe(0);
      expect(stats.state).toBe(CircuitState.CLOSED);
    });

    it('should record failure when operation throws error', async () => {
      // Arrange
      const circuitId = 'test-circuit';
      const error = new Error('Operation failed');
      const mockOperation = jest.fn().mockRejectedValue(error);
      service.registerCircuit(circuitId);

      // Act & Assert
      await expect(service.execute(circuitId, mockOperation)).rejects.toThrow('Operation failed');
      
      const stats = service.getStats(circuitId);
      expect(stats.failures).toBe(1);
      expect(stats.successes).toBe(0);
      expect(stats.state).toBe(CircuitState.CLOSED);
    });

    it('should open circuit after reaching failure threshold', async () => {
      // Arrange
      const circuitId = 'test-circuit';
      const config: CircuitBreakerConfig = {
        failureThreshold: 3,
        recoveryTimeout: 60000,
        monitoringPeriod: 300000,
      };
      const error = new Error('Operation failed');
      const mockOperation = jest.fn().mockRejectedValue(error);
      service.registerCircuit(circuitId, config);

      // Act - Execute 3 failing operations
      for (let i = 0; i < 3; i++) {
        try {
          await service.execute(circuitId, mockOperation);
        } catch (e) {
          // Expected to fail
        }
      }

      // Assert
      const stats = service.getStats(circuitId);
      expect(stats.failures).toBe(3);
      expect(stats.state).toBe(CircuitState.OPEN);
      expect(stats.nextAttemptTime).toBeDefined();
    });

    it('should block operations when circuit is open', async () => {
      // Arrange
      const circuitId = 'test-circuit';
      const config: CircuitBreakerConfig = {
        failureThreshold: 2,
        recoveryTimeout: 60000,
        monitoringPeriod: 300000,
      };
      const error = new Error('Operation failed');
      const mockOperation = jest.fn().mockRejectedValue(error);
      service.registerCircuit(circuitId, config);

      // Open the circuit by causing failures
      for (let i = 0; i < 2; i++) {
        try {
          await service.execute(circuitId, mockOperation);
        } catch (e) {
          // Expected to fail
        }
      }

      // Act - Try to execute when circuit is open
      const newOperation = jest.fn().mockResolvedValue('success');
      
      // Assert
      await expect(service.execute(circuitId, newOperation)).rejects.toThrow(
        `Circuit breaker is OPEN for ${circuitId}`
      );
      expect(newOperation).not.toHaveBeenCalled();
    });

    it('should use fallback when circuit is open and fallback provided', async () => {
      // Arrange
      const circuitId = 'test-circuit';
      const config: CircuitBreakerConfig = {
        failureThreshold: 2,
        recoveryTimeout: 60000,
        monitoringPeriod: 300000,
      };
      const error = new Error('Operation failed');
      const mockOperation = jest.fn().mockRejectedValue(error);
      const mockFallback = jest.fn().mockResolvedValue('fallback-result');
      service.registerCircuit(circuitId, config);

      // Open the circuit
      for (let i = 0; i < 2; i++) {
        try {
          await service.execute(circuitId, mockOperation);
        } catch (e) {
          // Expected to fail
        }
      }

      // Act
      const result = await service.execute(circuitId, mockOperation, mockFallback);

      // Assert
      expect(result).toBe('fallback-result');
      expect(mockFallback).toHaveBeenCalledTimes(1);
    });

    it('should transition to half-open after recovery timeout', async () => {
      // Arrange
      jest.useFakeTimers();
      const circuitId = 'test-circuit';
      const config: CircuitBreakerConfig = {
        failureThreshold: 2,
        recoveryTimeout: 60000,
        monitoringPeriod: 300000,
      };
      const error = new Error('Operation failed');
      const mockFailingOperation = jest.fn().mockRejectedValue(error);
      const mockSuccessOperation = jest.fn().mockResolvedValue('success');
      service.registerCircuit(circuitId, config);

      // Open the circuit
      for (let i = 0; i < 2; i++) {
        try {
          await service.execute(circuitId, mockFailingOperation);
        } catch (e) {
          // Expected to fail
        }
      }

      // Fast-forward time past recovery timeout
      jest.advanceTimersByTime(60001);

      // Act - Execute operation after timeout
      const result = await service.execute(circuitId, mockSuccessOperation);

      // Assert
      expect(result).toBe('success');
      const stats = service.getStats(circuitId);
      expect(stats.state).toBe(CircuitState.CLOSED); // Should reset to closed after success
      expect(stats.successes).toBe(1);
    });

    it('should auto-register circuit with default config if not exists', async () => {
      // Arrange
      const circuitId = 'auto-registered-circuit';
      const mockOperation = jest.fn().mockResolvedValue('success');

      // Act
      const result = await service.execute(circuitId, mockOperation);

      // Assert
      expect(result).toBe('success');
      const stats = service.getStats(circuitId);
      expect(stats.state).toBe(CircuitState.CLOSED);
      expect(stats.successes).toBe(1);
    });
  });

  describe('canExecute', () => {
    it('should return true when circuit is closed', () => {
      // Arrange
      const circuitId = 'test-circuit';
      service.registerCircuit(circuitId);

      // Act
      const canExecute = service.canExecute(circuitId);

      // Assert
      expect(canExecute).toBe(true);
    });

    it('should return true when circuit is half-open', () => {
      // Arrange
      const circuitId = 'test-circuit';
      service.registerCircuit(circuitId);
      service.forceOpen(circuitId);
      
      // Manually set to half-open for testing
      const stats = service.getStats(circuitId);
      (stats as any).state = CircuitState.HALF_OPEN;

      // Act
      const canExecute = service.canExecute(circuitId);

      // Assert
      expect(canExecute).toBe(true);
    });

    it('should return false when circuit is open and within recovery timeout', () => {
      // Arrange
      const circuitId = 'test-circuit';
      service.registerCircuit(circuitId);
      service.forceOpen(circuitId);

      // Act
      const canExecute = service.canExecute(circuitId);

      // Assert
      expect(canExecute).toBe(false);
    });

    it('should return true when circuit is open but recovery timeout has passed', () => {
      // Arrange
      jest.useFakeTimers();
      const circuitId = 'test-circuit';
      const config: CircuitBreakerConfig = {
        failureThreshold: 2,
        recoveryTimeout: 60000,
        monitoringPeriod: 300000,
      };
      service.registerCircuit(circuitId, config);
      service.forceOpen(circuitId);

      // Fast-forward time past recovery timeout
      jest.advanceTimersByTime(60001);

      // Act
      const canExecute = service.canExecute(circuitId);

      // Assert
      expect(canExecute).toBe(true);
    });
  });

  describe('getStats', () => {
    it('should return circuit statistics', () => {
      // Arrange
      const circuitId = 'test-circuit';
      service.registerCircuit(circuitId);

      // Act
      const stats = service.getStats(circuitId);

      // Assert
      expect(stats).toEqual({
        state: CircuitState.CLOSED,
        failures: 0,
        successes: 0,
      });
    });

    it('should return copy of stats to prevent mutation', () => {
      // Arrange
      const circuitId = 'test-circuit';
      service.registerCircuit(circuitId);

      // Act
      const stats1 = service.getStats(circuitId);
      const stats2 = service.getStats(circuitId);
      stats1.failures = 999;

      // Assert
      expect(stats2.failures).toBe(0); // Should not be affected by mutation
    });
  });

  describe('getAllStats', () => {
    it('should return all circuit statistics', () => {
      // Arrange
      service.registerCircuit('circuit-1');
      service.registerCircuit('circuit-2');

      // Act
      const allStats = service.getAllStats();

      // Assert
      expect(Object.keys(allStats)).toEqual(['circuit-1', 'circuit-2']);
      expect(allStats['circuit-1'].state).toBe(CircuitState.CLOSED);
      expect(allStats['circuit-2'].state).toBe(CircuitState.CLOSED);
    });

    it('should return empty object when no circuits registered', () => {
      // Act
      const allStats = service.getAllStats();

      // Assert
      expect(allStats).toEqual({});
    });
  });

  describe('reset', () => {
    it('should reset circuit to closed state', async () => {
      // Arrange
      const circuitId = 'test-circuit';
      const config: CircuitBreakerConfig = {
        failureThreshold: 2,
        recoveryTimeout: 60000,
        monitoringPeriod: 300000,
      };
      const error = new Error('Operation failed');
      const mockOperation = jest.fn().mockRejectedValue(error);
      service.registerCircuit(circuitId, config);

      // Open the circuit by causing failures
      for (let i = 0; i < 2; i++) {
        try {
          await service.execute(circuitId, mockOperation);
        } catch (e) {
          // Expected to fail
        }
      }

      // Verify circuit is open
      expect(service.getStats(circuitId).state).toBe(CircuitState.OPEN);

      // Act
      service.reset(circuitId);

      // Assert
      const stats = service.getStats(circuitId);
      expect(stats.state).toBe(CircuitState.CLOSED);
      expect(stats.failures).toBe(0);
      expect(stats.successes).toBe(0);
      expect(stats.lastFailureTime).toBeUndefined();
      expect(stats.nextAttemptTime).toBeUndefined();
    });
  });

  describe('forceOpen', () => {
    it('should force circuit to open state', () => {
      // Arrange
      const circuitId = 'test-circuit';
      const config: CircuitBreakerConfig = {
        failureThreshold: 5,
        recoveryTimeout: 60000,
        monitoringPeriod: 300000,
      };
      service.registerCircuit(circuitId, config);

      // Act
      service.forceOpen(circuitId);

      // Assert
      const stats = service.getStats(circuitId);
      expect(stats.state).toBe(CircuitState.OPEN);
      expect(stats.lastFailureTime).toBeDefined();
      expect(stats.nextAttemptTime).toBeDefined();
    });
  });

  describe('error handling', () => {
    it('should handle different types of errors', async () => {
      // Arrange
      const circuitId = 'test-circuit';
      service.registerCircuit(circuitId);

      const errorTypes = [
        new Error('Standard error'),
        new TypeError('Type error'),
        'String error',
        { message: 'Object error' },
        null,
        undefined,
      ];

      // Act & Assert
      for (const error of errorTypes) {
        const mockOperation = jest.fn().mockRejectedValue(error);
        
        await expect(service.execute(circuitId, mockOperation)).rejects.toBe(error);
        
        const stats = service.getStats(circuitId);
        expect(stats.failures).toBeGreaterThan(0);
      }
    });
  });

  describe('monitoring period cleanup', () => {
    it('should clean up old failure data outside monitoring period', async () => {
      // Arrange
      jest.useFakeTimers();
      const circuitId = 'test-circuit';
      const config: CircuitBreakerConfig = {
        failureThreshold: 5,
        recoveryTimeout: 60000,
        monitoringPeriod: 300000, // 5 minutes
      };
      const error = new Error('Operation failed');
      const mockFailingOperation = jest.fn().mockRejectedValue(error);
      const mockSuccessOperation = jest.fn().mockResolvedValue('success');
      service.registerCircuit(circuitId, config);

      // Cause some failures
      try {
        await service.execute(circuitId, mockFailingOperation);
      } catch (e) {
        // Expected to fail
      }

      // Fast-forward time past monitoring period
      jest.advanceTimersByTime(300001);

      // Execute successful operation to trigger cleanup
      await service.execute(circuitId, mockSuccessOperation);

      // Assert
      const stats = service.getStats(circuitId);
      expect(stats.failures).toBe(0); // Should be cleaned up
      expect(stats.successes).toBe(1);
    });
  });

  describe('concurrent operations', () => {
    it('should handle concurrent operations correctly', async () => {
      // Arrange
      const circuitId = 'concurrent-circuit';
      service.registerCircuit(circuitId);

      const operations = Array.from({ length: 10 }, (_, i) => 
        service.execute(circuitId, async () => `result-${i}`)
      );

      // Act
      const results = await Promise.all(operations);

      // Assert
      expect(results).toHaveLength(10);
      results.forEach((result, i) => {
        expect(result).toBe(`result-${i}`);
      });

      const stats = service.getStats(circuitId);
      expect(stats.successes).toBe(10);
      expect(stats.failures).toBe(0);
    });
  });
});