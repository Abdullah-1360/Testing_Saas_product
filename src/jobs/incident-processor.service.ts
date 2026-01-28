import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QueueConfigService, JobTypes } from './queue.config';
import { CircuitBreakerService } from './circuit-breaker.service';
import { FlappingPreventionService } from './flapping-prevention.service';
import { JobIdempotencyService } from './job-idempotency.service';
import { BoundedLoopsService } from './bounded-loops.service';

export enum IncidentState {
  NEW = 'NEW',
  DISCOVERY = 'DISCOVERY',
  BASELINE = 'BASELINE',
  BACKUP = 'BACKUP',
  OBSERVABILITY = 'OBSERVABILITY',
  FIX_ATTEMPT = 'FIX_ATTEMPT',
  VERIFY = 'VERIFY',
  FIXED = 'FIXED',
  ROLLBACK = 'ROLLBACK',
  ESCALATED = 'ESCALATED',
}

export interface IncidentJobData {
  incidentId: string;
  siteId: string;
  serverId: string;
  currentState: IncidentState;
  fixAttempts: number;
  maxFixAttempts: number;
  metadata?: Record<string, any>;
  correlationId?: string;
  traceId?: string;
}

export interface StateTransition {
  from: IncidentState;
  to: IncidentState;
  jobType: JobTypes;
  condition?: (data: IncidentJobData) => boolean;
}

@Injectable()
export class IncidentProcessorService {
  private readonly logger = new Logger(IncidentProcessorService.name);

  // State machine transitions
  private readonly stateTransitions: StateTransition[] = [
    { from: IncidentState.NEW, to: IncidentState.DISCOVERY, jobType: JobTypes.DISCOVERY_PHASE },
    { from: IncidentState.DISCOVERY, to: IncidentState.BASELINE, jobType: JobTypes.BASELINE_PHASE },
    { from: IncidentState.BASELINE, to: IncidentState.BACKUP, jobType: JobTypes.BACKUP_PHASE },
    { from: IncidentState.BACKUP, to: IncidentState.OBSERVABILITY, jobType: JobTypes.OBSERVABILITY_PHASE },
    { from: IncidentState.OBSERVABILITY, to: IncidentState.FIX_ATTEMPT, jobType: JobTypes.FIX_ATTEMPT_PHASE },
    { from: IncidentState.FIX_ATTEMPT, to: IncidentState.VERIFY, jobType: JobTypes.VERIFY_PHASE },
    { 
      from: IncidentState.VERIFY, 
      to: IncidentState.FIXED, 
      jobType: JobTypes.PROCESS_INCIDENT,
      condition: (data) => data.metadata?.['verificationPassed'] === true
    },
    { 
      from: IncidentState.VERIFY, 
      to: IncidentState.FIX_ATTEMPT, 
      jobType: JobTypes.FIX_ATTEMPT_PHASE,
      condition: (data) => data.metadata?.['verificationPassed'] === false && data.fixAttempts < data.maxFixAttempts
    },
    { 
      from: IncidentState.VERIFY, 
      to: IncidentState.ROLLBACK, 
      jobType: JobTypes.ROLLBACK_PHASE,
      condition: (data) => data.metadata?.['verificationPassed'] === false && data.fixAttempts >= data.maxFixAttempts
    },
    { from: IncidentState.ROLLBACK, to: IncidentState.ESCALATED, jobType: JobTypes.ESCALATE_INCIDENT },
    { from: IncidentState.FIX_ATTEMPT, to: IncidentState.ESCALATED, jobType: JobTypes.ESCALATE_INCIDENT },
  ];

  constructor(
    private readonly queueConfig: QueueConfigService,
    private readonly circuitBreaker: CircuitBreakerService,
    private readonly flappingPrevention: FlappingPreventionService,
    private readonly idempotency: JobIdempotencyService,
    private readonly boundedLoops: BoundedLoopsService,
  ) {
    // Register circuit breakers for different operations
    this.initializeCircuitBreakers();
  }

  /**
   * Initialize circuit breakers for different incident operations
   */
  private initializeCircuitBreakers(): void {
    // SSH operations circuit breaker
    this.circuitBreaker.registerCircuit('ssh-operations', {
      failureThreshold: 3,
      recoveryTimeout: 30000, // 30 seconds
      monitoringPeriod: 300000, // 5 minutes
    });

    // Fix attempt circuit breaker
    this.circuitBreaker.registerCircuit('fix-attempts', {
      failureThreshold: 5,
      recoveryTimeout: 60000, // 1 minute
      monitoringPeriod: 600000, // 10 minutes
    });

    // Verification circuit breaker
    this.circuitBreaker.registerCircuit('verification', {
      failureThreshold: 3,
      recoveryTimeout: 30000, // 30 seconds
      monitoringPeriod: 300000, // 5 minutes
    });

    // Database operations circuit breaker
    this.circuitBreaker.registerCircuit('database-operations', {
      failureThreshold: 5,
      recoveryTimeout: 30000, // 30 seconds
      monitoringPeriod: 300000, // 5 minutes
    });
  }

  /**
   * Process an incident through the state machine with full protection
   */
  async processIncident(job: Job<IncidentJobData>): Promise<any> {
    const { data } = job;
    const { incidentId, currentState, correlationId, traceId, siteId } = data;

    this.logger.log(`Processing incident ${incidentId} in state ${currentState}`, {
      correlationId,
      traceId,
      jobId: job.id,
    });

    // Start bounded loop for incident processing
    const loopId = `incident-${incidentId}-${currentState}`;
    const loopContext = this.boundedLoops.startLoop(
      loopId,
      'incident-processing',
      undefined,
      { incidentId, currentState, jobId: job.id }
    );

    try {
      // Check for flapping before processing
      const flappingCheck = this.flappingPrevention.canCreateIncident(siteId);
      if (!flappingCheck.allowed) {
        this.logger.warn(`Incident processing blocked due to flapping for site ${siteId}`, {
          reason: flappingCheck.reason,
          cooldownUntil: flappingCheck.cooldownUntil,
          shouldEscalate: flappingCheck.shouldEscalate,
        });

        if (flappingCheck.shouldEscalate) {
          await this.escalateIncident(data, flappingCheck.reason || 'Site flapping detected');
        }

        return {
          success: false,
          reason: flappingCheck.reason,
          flapping: true,
          cooldownUntil: flappingCheck.cooldownUntil,
        };
      }

      // Check idempotency
      const idempotencyCheck = await this.idempotency.checkIdempotency(
        incidentId,
        currentState,
        data.fixAttempts,
        data
      );

      if (idempotencyCheck.isIdempotent) {
        this.logger.log(`Returning idempotent result for incident ${incidentId}`, {
          state: currentState,
          attempt: data.fixAttempts,
        });

        this.boundedLoops.completeLoop(loopId, true, 'Idempotent result returned');
        return idempotencyCheck.existingResult;
      }

      // Update job progress
      await job.updateProgress(10);
      await this.idempotency.createCheckpoint(incidentId, currentState, data.fixAttempts, 10, data);

      // Validate state transition
      const nextTransition = this.getNextTransition(data);
      if (!nextTransition) {
        this.logger.warn(`No valid transition found for incident ${incidentId} in state ${currentState}`);
        this.boundedLoops.completeLoop(loopId, false, 'No valid state transition');
        return { success: false, reason: 'No valid state transition' };
      }

      // Record loop iteration
      this.boundedLoops.recordIteration(loopId, { transition: nextTransition.to });

      // Update job progress
      await job.updateProgress(30);
      await this.idempotency.createCheckpoint(incidentId, currentState, data.fixAttempts, 30, {
        ...data,
        nextTransition: nextTransition.to,
      });

      // Execute the current state logic with circuit breaker protection
      const stateResult = await this.circuitBreaker.execute(
        `state-${currentState.toLowerCase()}`,
        async () => {
          // Check bounded loop before state execution
          const boundsCheck = this.boundedLoops.canContinue(loopId);
          if (!boundsCheck.canContinue) {
            throw new Error(`Loop bounds exceeded: ${boundsCheck.reason}`);
          }

          return await this.executeStateLogic(currentState, data, job);
        },
        async () => {
          // Fallback for circuit breaker
          this.logger.warn(`Circuit breaker fallback triggered for state ${currentState}`);
          return { success: false, error: 'Circuit breaker activated' };
        }
      );
      
      // Update job progress
      await job.updateProgress(70);
      await this.idempotency.createCheckpoint(incidentId, currentState, data.fixAttempts, 70, {
        ...data,
        stateResult,
      });

      // If state execution was successful, transition to next state
      if (stateResult.success) {
        await this.transitionToNextState(data, nextTransition, stateResult.data);
        
        // Record successful incident processing (helps with flapping detection)
        this.flappingPrevention.recordResolution(siteId, incidentId, true);
      } else {
        // Handle state execution failure
        await this.handleStateFailure(data, stateResult.error || 'Unknown error');
        
        // Record failed incident processing
        this.flappingPrevention.recordResolution(siteId, incidentId, false);
        
        // Record retry in bounded loop
        this.boundedLoops.recordRetry(loopId, stateResult.error || 'State execution failed');
      }

      // Update job progress
      await job.updateProgress(100);

      const result = {
        success: stateResult.success,
        currentState,
        nextState: nextTransition.to,
        result: stateResult,
        loopStats: {
          iterations: loopContext.iterations,
          retries: loopContext.retries,
        },
      };

      // Store result for idempotency
      await this.idempotency.storeResult(idempotencyCheck.key, result);

      this.logger.log(`Incident ${incidentId} processed successfully`, {
        correlationId,
        traceId,
        currentState,
        nextState: nextTransition.to,
        success: stateResult.success,
      });

      this.boundedLoops.completeLoop(loopId, stateResult.success, 'State processing completed');
      return result;

    } catch (error) {
      this.logger.error(`Error processing incident ${incidentId}:`, error, {
        correlationId,
        traceId,
        currentState,
      });

      // Record failure in flapping prevention
      this.flappingPrevention.recordResolution(siteId, incidentId, false);

      // Complete bounded loop with failure
      this.boundedLoops.completeLoop(loopId, false, error instanceof Error ? error.message : 'Unknown error');

      // Handle critical errors by escalating
      await this.escalateIncident(data, error instanceof Error ? error.message : 'Unknown error');
      
      throw error;
    }
  }

  /**
   * Get the next valid transition for the current state
   */
  private getNextTransition(data: IncidentJobData): StateTransition | null {
    const validTransitions = this.stateTransitions.filter(
      transition => transition.from === data.currentState
    );

    // Find the first transition that meets the condition (if any)
    for (const transition of validTransitions) {
      if (!transition.condition || transition.condition(data)) {
        return transition;
      }
    }

    return null;
  }

  /**
   * Execute the logic for the current state
   */
  private async executeStateLogic(
    state: IncidentState, 
    data: IncidentJobData, 
    job: Job
  ): Promise<{ success: boolean; data?: any; error?: string }> {
    
    switch (state) {
      case IncidentState.NEW:
        return await this.executeNewState(data, job);
      
      case IncidentState.DISCOVERY:
        return await this.executeDiscoveryState(data, job);
      
      case IncidentState.BASELINE:
        return await this.executeBaselineState(data, job);
      
      case IncidentState.BACKUP:
        return await this.executeBackupState(data, job);
      
      case IncidentState.OBSERVABILITY:
        return await this.executeObservabilityState(data, job);
      
      case IncidentState.FIX_ATTEMPT:
        return await this.executeFixAttemptState(data, job);
      
      case IncidentState.VERIFY:
        return await this.executeVerifyState(data, job);
      
      case IncidentState.ROLLBACK:
        return await this.executeRollbackState(data, job);
      
      default:
        return { success: false, error: `Unknown state: ${state}` };
    }
  }

  /**
   * Transition to the next state by adding a new job
   */
  private async transitionToNextState(
    data: IncidentJobData, 
    transition: StateTransition, 
    stateData?: any
  ): Promise<void> {
    const nextData: IncidentJobData = {
      ...data,
      currentState: transition.to,
      metadata: {
        ...data.metadata,
        ...stateData,
        previousState: data.currentState,
        transitionTime: new Date().toISOString(),
      },
    };

    // Add delay for cooldown if needed
    const delay = this.getStateTransitionDelay(transition.to);

    await this.queueConfig.addIncidentJob(transition.jobType, nextData, {
      delay,
      jobId: `${data.incidentId}-${transition.to}-${Date.now()}`,
    });

    this.logger.log(`Transitioned incident ${data.incidentId} from ${data.currentState} to ${transition.to}`);
  }

  /**
   * Handle state execution failure
   */
  private async handleStateFailure(data: IncidentJobData, error: string): Promise<void> {
    this.logger.error(`State ${data.currentState} failed for incident ${data.incidentId}: ${error}`);

    // Increment fix attempts if this was a fix attempt
    if (data.currentState === IncidentState.FIX_ATTEMPT) {
      data.fixAttempts += 1;
    }

    // Check if we should escalate
    if (data.fixAttempts >= data.maxFixAttempts) {
      await this.escalateIncident(data, `Max fix attempts reached: ${error}`);
    } else {
      // Retry with exponential backoff
      const retryDelay = Math.min(1000 * Math.pow(2, data.fixAttempts), 30000);
      await this.queueConfig.addIncidentJob(JobTypes.PROCESS_INCIDENT, data, {
        delay: retryDelay,
      });
    }
  }

  /**
   * Escalate an incident
   */
  private async escalateIncident(data: IncidentJobData, reason: string): Promise<void> {
    const escalationData: IncidentJobData = {
      ...data,
      currentState: IncidentState.ESCALATED,
      metadata: {
        ...data.metadata,
        escalationReason: reason,
        escalationTime: new Date().toISOString(),
      },
    };

    await this.queueConfig.addIncidentJob(JobTypes.ESCALATE_INCIDENT, escalationData);
    
    this.logger.warn(`Incident ${data.incidentId} escalated: ${reason}`);
  }

  /**
   * Get delay for state transitions (for cooldown/rate limiting)
   */
  private getStateTransitionDelay(state: IncidentState): number {
    switch (state) {
      case IncidentState.FIX_ATTEMPT:
        return 5000; // 5 second delay before fix attempts
      case IncidentState.VERIFY:
        return 10000; // 10 second delay before verification
      default:
        return 1000; // 1 second default delay
    }
  }

  // State execution methods (placeholders for now - will be implemented in later tasks)
  
  private async executeNewState(data: IncidentJobData, _job: Job): Promise<{ success: boolean; data?: any }> {
    // TODO: Implement new incident initialization logic
    this.logger.log(`Executing NEW state for incident ${data.incidentId}`);
    return { success: true, data: { initialized: true } };
  }

  private async executeDiscoveryState(data: IncidentJobData, _job: Job): Promise<{ success: boolean; data?: any }> {
    // TODO: Implement discovery phase logic
    this.logger.log(`Executing DISCOVERY state for incident ${data.incidentId}`);
    return { success: true, data: { discoveryComplete: true } };
  }

  private async executeBaselineState(data: IncidentJobData, _job: Job): Promise<{ success: boolean; data?: any }> {
    // TODO: Implement baseline phase logic
    this.logger.log(`Executing BASELINE state for incident ${data.incidentId}`);
    return { success: true, data: { baselineComplete: true } };
  }

  private async executeBackupState(data: IncidentJobData, _job: Job): Promise<{ success: boolean; data?: any }> {
    // TODO: Implement backup phase logic
    this.logger.log(`Executing BACKUP state for incident ${data.incidentId}`);
    return { success: true, data: { backupComplete: true } };
  }

  private async executeObservabilityState(data: IncidentJobData, _job: Job): Promise<{ success: boolean; data?: any }> {
    // TODO: Implement observability phase logic
    this.logger.log(`Executing OBSERVABILITY state for incident ${data.incidentId}`);
    return { success: true, data: { observabilityComplete: true } };
  }

  private async executeFixAttemptState(data: IncidentJobData, _job: Job): Promise<{ success: boolean; data?: any }> {
    // TODO: Implement fix attempt phase logic using WordPress fixes service
    this.logger.log(`Executing FIX_ATTEMPT state for incident ${data.incidentId} (attempt ${data.fixAttempts + 1})`);
    
    // For now, return placeholder - will be fully implemented when WordPress fixes service is integrated
    return { success: true, data: { fixAttempted: true, fixAttempts: data.fixAttempts + 1 } };
  }

  private async executeVerifyState(data: IncidentJobData, _job: Job): Promise<{ success: boolean; data?: any }> {
    // TODO: Implement verification phase logic
    this.logger.log(`Executing VERIFY state for incident ${data.incidentId}`);
    // Simulate verification result for now
    const verificationPassed = Math.random() > 0.3; // 70% success rate for testing
    return { success: true, data: { verificationPassed } };
  }

  private async executeRollbackState(data: IncidentJobData, _job: Job): Promise<{ success: boolean; data?: any }> {
    // TODO: Implement rollback phase logic
    this.logger.log(`Executing ROLLBACK state for incident ${data.incidentId}`);
    return { success: true, data: { rollbackComplete: true } };
  }
}