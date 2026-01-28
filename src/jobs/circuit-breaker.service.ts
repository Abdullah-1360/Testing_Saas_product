import { Injectable, Logger } from '@nestjs/common';

export interface CircuitBreakerConfig {
  failureThreshold: number;
  recoveryTimeout: number;
  monitoringPeriod: number;
}

export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

export interface CircuitBreakerStats {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailureTime?: Date | undefined;
  lastSuccessTime?: Date | undefined;
  nextAttemptTime?: Date | undefined;
}

@Injectable()
export class CircuitBreakerService {
  private readonly logger = new Logger(CircuitBreakerService.name);
  private circuits: Map<string, CircuitBreakerStats> = new Map();
  private configs: Map<string, CircuitBreakerConfig> = new Map();

  /**
   * Register a circuit breaker for a specific operation
   */
  registerCircuit(
    circuitId: string,
    config: CircuitBreakerConfig = {
      failureThreshold: 5,
      recoveryTimeout: 60000, // 1 minute
      monitoringPeriod: 300000, // 5 minutes
    }
  ): void {
    this.configs.set(circuitId, config);
    this.circuits.set(circuitId, {
      state: CircuitState.CLOSED,
      failures: 0,
      successes: 0,
    });

    this.logger.log(`Circuit breaker registered for ${circuitId}`, config);
  }

  /**
   * Execute an operation with circuit breaker protection
   */
  async execute<T>(
    circuitId: string,
    operation: () => Promise<T>,
    fallback?: () => Promise<T>
  ): Promise<T> {
    const circuit = this.getCircuit(circuitId);
    const config = this.getConfig(circuitId);

    // Check if circuit is open
    if (circuit.state === CircuitState.OPEN) {
      if (this.shouldAttemptReset(circuit, config)) {
        circuit.state = CircuitState.HALF_OPEN;
        this.logger.log(`Circuit ${circuitId} moved to HALF_OPEN state`);
      } else {
        const error = new Error(`Circuit breaker is OPEN for ${circuitId}`);
        this.logger.warn(`Circuit breaker blocked operation for ${circuitId}`);
        
        if (fallback) {
          return await fallback();
        }
        throw error;
      }
    }

    try {
      const result = await operation();
      this.onSuccess(circuitId);
      return result;
    } catch (error) {
      this.onFailure(circuitId, error);
      throw error;
    }
  }

  /**
   * Check if an operation should be allowed based on circuit state
   */
  canExecute(circuitId: string): boolean {
    const circuit = this.getCircuit(circuitId);
    const config = this.getConfig(circuitId);

    if (circuit.state === CircuitState.CLOSED) {
      return true;
    }

    if (circuit.state === CircuitState.HALF_OPEN) {
      return true;
    }

    if (circuit.state === CircuitState.OPEN) {
      return this.shouldAttemptReset(circuit, config);
    }

    return false;
  }

  /**
   * Get circuit breaker statistics
   */
  getStats(circuitId: string): CircuitBreakerStats {
    return { ...this.getCircuit(circuitId) };
  }

  /**
   * Get all circuit breaker statistics
   */
  getAllStats(): Record<string, CircuitBreakerStats> {
    const stats: Record<string, CircuitBreakerStats> = {};
    for (const [circuitId, circuit] of this.circuits.entries()) {
      stats[circuitId] = { ...circuit };
    }
    return stats;
  }

  /**
   * Reset a circuit breaker to closed state
   */
  reset(circuitId: string): void {
    const circuit = this.getCircuit(circuitId);
    circuit.state = CircuitState.CLOSED;
    circuit.failures = 0;
    circuit.successes = 0;
    circuit.lastFailureTime = undefined;
    circuit.nextAttemptTime = undefined;

    this.logger.log(`Circuit breaker ${circuitId} reset to CLOSED state`);
  }

  /**
   * Force a circuit breaker to open state
   */
  forceOpen(circuitId: string): void {
    const circuit = this.getCircuit(circuitId);
    const config = this.getConfig(circuitId);
    
    circuit.state = CircuitState.OPEN;
    circuit.lastFailureTime = new Date();
    circuit.nextAttemptTime = new Date(Date.now() + config.recoveryTimeout);

    this.logger.warn(`Circuit breaker ${circuitId} forced to OPEN state`);
  }

  /**
   * Handle successful operation
   */
  private onSuccess(circuitId: string): void {
    const circuit = this.getCircuit(circuitId);
    
    circuit.successes++;
    circuit.lastSuccessTime = new Date();

    if (circuit.state === CircuitState.HALF_OPEN) {
      // Reset to closed state after successful operation in half-open
      circuit.state = CircuitState.CLOSED;
      circuit.failures = 0;
      this.logger.log(`Circuit ${circuitId} reset to CLOSED state after successful recovery`);
    }

    // Clean up old failure data in monitoring period
    this.cleanupOldData(circuitId);
  }

  /**
   * Handle failed operation
   */
  private onFailure(circuitId: string, error: any): void {
    const circuit = this.getCircuit(circuitId);
    const config = this.getConfig(circuitId);
    
    circuit.failures++;
    circuit.lastFailureTime = new Date();

    this.logger.warn(`Circuit ${circuitId} recorded failure ${circuit.failures}/${config.failureThreshold}`, {
      error: error instanceof Error ? error.message : String(error),
    });

    // Check if we should open the circuit
    if (circuit.failures >= config.failureThreshold) {
      circuit.state = CircuitState.OPEN;
      circuit.nextAttemptTime = new Date(Date.now() + config.recoveryTimeout);
      
      this.logger.error(`Circuit ${circuitId} opened due to ${circuit.failures} failures`, {
        nextAttemptTime: circuit.nextAttemptTime,
      });
    }
  }

  /**
   * Check if we should attempt to reset the circuit from open to half-open
   */
  private shouldAttemptReset(circuit: CircuitBreakerStats, _config: CircuitBreakerConfig): boolean {
    if (circuit.state !== CircuitState.OPEN) {
      return false;
    }

    if (!circuit.nextAttemptTime) {
      return true;
    }

    return Date.now() >= circuit.nextAttemptTime.getTime();
  }

  /**
   * Clean up old failure/success data outside monitoring period
   */
  private cleanupOldData(circuitId: string): void {
    const circuit = this.getCircuit(circuitId);
    const config = this.getConfig(circuitId);
    const cutoffTime = Date.now() - config.monitoringPeriod;

    // Reset counters if last failure was outside monitoring period
    if (circuit.lastFailureTime && circuit.lastFailureTime.getTime() < cutoffTime) {
      circuit.failures = 0;
    }

    // Reset success counter if last success was outside monitoring period
    if (circuit.lastSuccessTime && circuit.lastSuccessTime.getTime() < cutoffTime) {
      circuit.successes = 0;
    }
  }

  /**
   * Get circuit stats, creating if not exists
   */
  private getCircuit(circuitId: string): CircuitBreakerStats {
    if (!this.circuits.has(circuitId)) {
      // Auto-register with default config if not exists
      this.registerCircuit(circuitId);
    }
    return this.circuits.get(circuitId)!;
  }

  /**
   * Get circuit config, creating if not exists
   */
  private getConfig(circuitId: string): CircuitBreakerConfig {
    if (!this.configs.has(circuitId)) {
      // Auto-register with default config if not exists
      this.registerCircuit(circuitId);
    }
    return this.configs.get(circuitId)!;
  }
}