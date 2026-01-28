import { Test, TestingModule } from '@nestjs/testing';
import { Job } from 'bullmq';
import { IncidentProcessorService, IncidentState, IncidentJobData } from './incident-processor.service';
import { QueueConfigService } from './queue.config';
import { CircuitBreakerService } from './circuit-breaker.service';
import { FlappingPreventionService } from './flapping-prevention.service';
import { JobIdempotencyService } from './job-idempotency.service';
import { BoundedLoopsService } from './bounded-loops.service';

describe('IncidentProcessorService', () => {
  let service: IncidentProcessorService;
  let circuitBreaker: jest.Mocked<CircuitBreakerService>;
  let flappingPrevention: jest.Mocked<FlappingPreventionService>;
  let idempotency: jest.Mocked<JobIdempotencyService>;
  let boundedLoops: jest.Mocked<BoundedLoopsService>;

  const mockIncidentData: IncidentJobData = {
    incidentId: 'test-incident-123',
    siteId: 'test-site-456',
    serverId: 'test-server-789',
    currentState: IncidentState.NEW,
    fixAttempts: 0,
    maxFixAttempts: 15,
    correlationId: 'test-correlation-123',
    traceId: 'test-trace-456',
    metadata: {
      triggerType: 'http-error',
      priority: 'medium',
    },
  };

  beforeEach(async () => {
    const mockQueueConfig = {
      addIncidentJob: jest.fn(),
    };

    const mockCircuitBreaker = {
      registerCircuit: jest.fn(),
      execute: jest.fn(),
      canExecute: jest.fn().mockReturnValue(true),
      getStats: jest.fn(),
    };

    const mockFlappingPrevention = {
      canCreateIncident: jest.fn().mockReturnValue({ allowed: true }),
      recordIncident: jest.fn(),
      recordResolution: jest.fn(),
    };

    const mockIdempotency = {
      checkIdempotency: jest.fn().mockResolvedValue({ isIdempotent: false, key: 'test-key' }),
      storeResult: jest.fn(),
      createCheckpoint: jest.fn(),
    };

    const mockBoundedLoops = {
      startLoop: jest.fn().mockReturnValue({
        loopId: 'test-loop',
        iterations: 0,
        retries: 0,
        startTime: new Date(),
      }),
      canContinue: jest.fn().mockReturnValue({ canContinue: true }),
      recordIteration: jest.fn(),
      recordRetry: jest.fn(),
      completeLoop: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IncidentProcessorService,
        { provide: QueueConfigService, useValue: mockQueueConfig },
        { provide: CircuitBreakerService, useValue: mockCircuitBreaker },
        { provide: FlappingPreventionService, useValue: mockFlappingPrevention },
        { provide: JobIdempotencyService, useValue: mockIdempotency },
        { provide: BoundedLoopsService, useValue: mockBoundedLoops },
      ],
    }).compile();

    service = module.get<IncidentProcessorService>(IncidentProcessorService);
    circuitBreaker = module.get(CircuitBreakerService);
    flappingPrevention = module.get(FlappingPreventionService);
    idempotency = module.get(JobIdempotencyService);
    boundedLoops = module.get(BoundedLoopsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('processIncident', () => {
    let mockJob: Partial<Job<IncidentJobData>>;

    beforeEach(() => {
      mockJob = {
        id: 'test-job-123',
        data: mockIncidentData,
        updateProgress: jest.fn(),
      };
    });

    it('should process incident successfully through state machine', async () => {
      // Mock successful state execution
      circuitBreaker.execute.mockResolvedValue({
        success: true,
        data: { initialized: true },
      });

      const result = await service.processIncident(mockJob as Job<IncidentJobData>);

      expect(result.success).toBe(true);
      expect(result.currentState).toBe(IncidentState.NEW);
      expect(boundedLoops.startLoop).toHaveBeenCalled();
      expect(boundedLoops.completeLoop).toHaveBeenCalled();
      expect(flappingPrevention.canCreateIncident).toHaveBeenCalledWith(mockIncidentData.siteId);
      expect(idempotency.checkIdempotency).toHaveBeenCalled();
    });

    it('should block processing when site is flapping', async () => {
      flappingPrevention.canCreateIncident.mockReturnValue({
        allowed: false,
        reason: 'Site is flapping',
        cooldownUntil: new Date(Date.now() + 60000),
        shouldEscalate: false,
      });

      const result = await service.processIncident(mockJob as Job<IncidentJobData>);

      expect(result.success).toBe(false);
      expect(result.flapping).toBe(true);
      expect(result.reason).toBe('Site is flapping');
    });

    it('should return idempotent result when available', async () => {
      const idempotentResult = { success: true, cached: true };
      idempotency.checkIdempotency.mockResolvedValue({
        isIdempotent: true,
        existingResult: idempotentResult,
        key: 'test-key',
      });

      const result = await service.processIncident(mockJob as Job<IncidentJobData>);

      expect(result).toEqual(idempotentResult);
      expect(boundedLoops.completeLoop).toHaveBeenCalledWith(
        expect.any(String),
        true,
        'Idempotent result returned'
      );
    });

    it('should handle circuit breaker activation', async () => {
      circuitBreaker.execute.mockResolvedValue({
        success: false,
        error: 'Circuit breaker activated',
      });

      const result = await service.processIncident(mockJob as Job<IncidentJobData>);

      expect(result.success).toBe(false);
      expect(flappingPrevention.recordResolution).toHaveBeenCalledWith(
        mockIncidentData.siteId,
        mockIncidentData.incidentId,
        false
      );
    });

    it('should handle bounded loop limits', async () => {
      boundedLoops.canContinue.mockReturnValue({
        canContinue: false,
        reason: 'Exceeded maximum iterations',
        boundType: 'iterations',
      });

      circuitBreaker.execute.mockRejectedValue(new Error('Loop bounds exceeded: Exceeded maximum iterations'));

      await expect(service.processIncident(mockJob as Job<IncidentJobData>)).rejects.toThrow();
      expect(boundedLoops.completeLoop).toHaveBeenCalledWith(
        expect.any(String),
        false,
        expect.stringContaining('Loop bounds exceeded')
      );
    });

    it('should create checkpoints during processing', async () => {
      circuitBreaker.execute.mockResolvedValue({
        success: true,
        data: { initialized: true },
      });

      await service.processIncident(mockJob as Job<IncidentJobData>);

      expect(idempotency.createCheckpoint).toHaveBeenCalledTimes(3);
      expect(idempotency.createCheckpoint).toHaveBeenCalledWith(
        mockIncidentData.incidentId,
        mockIncidentData.currentState,
        mockIncidentData.fixAttempts,
        10,
        mockIncidentData
      );
    });

    it('should store result for idempotency', async () => {
      circuitBreaker.execute.mockResolvedValue({
        success: true,
        data: { initialized: true },
      });

      await service.processIncident(mockJob as Job<IncidentJobData>);

      expect(idempotency.storeResult).toHaveBeenCalledWith(
        'test-key',
        expect.objectContaining({
          success: true,
          currentState: IncidentState.NEW,
        })
      );
    });
  });

  describe('state transitions', () => {
    it('should validate state transitions correctly', () => {
      const newStateData = { ...mockIncidentData, currentState: IncidentState.NEW };
      const transition = service['getNextTransition'](newStateData);
      
      expect(transition).toBeDefined();
      expect(transition?.from).toBe(IncidentState.NEW);
      expect(transition?.to).toBe(IncidentState.DISCOVERY);
    });

    it('should handle conditional transitions', () => {
      const verifyStateData = {
        ...mockIncidentData,
        currentState: IncidentState.VERIFY,
        metadata: { verificationPassed: true },
      };
      
      const transition = service['getNextTransition'](verifyStateData);
      
      expect(transition).toBeDefined();
      expect(transition?.from).toBe(IncidentState.VERIFY);
      expect(transition?.to).toBe(IncidentState.FIXED);
    });

    it('should handle retry transitions when verification fails', () => {
      const verifyStateData = {
        ...mockIncidentData,
        currentState: IncidentState.VERIFY,
        fixAttempts: 5,
        maxFixAttempts: 15,
        metadata: { verificationPassed: false },
      };
      
      const transition = service['getNextTransition'](verifyStateData);
      
      expect(transition).toBeDefined();
      expect(transition?.from).toBe(IncidentState.VERIFY);
      expect(transition?.to).toBe(IncidentState.FIX_ATTEMPT);
    });

    it('should transition to rollback when max attempts reached', () => {
      const verifyStateData = {
        ...mockIncidentData,
        currentState: IncidentState.VERIFY,
        fixAttempts: 15,
        maxFixAttempts: 15,
        metadata: { verificationPassed: false },
      };
      
      const transition = service['getNextTransition'](verifyStateData);
      
      expect(transition).toBeDefined();
      expect(transition?.from).toBe(IncidentState.VERIFY);
      expect(transition?.to).toBe(IncidentState.ROLLBACK);
    });
  });

  describe('circuit breaker integration', () => {
    it('should register circuit breakers on initialization', () => {
      expect(circuitBreaker.registerCircuit).toHaveBeenCalledWith('ssh-operations', expect.any(Object));
      expect(circuitBreaker.registerCircuit).toHaveBeenCalledWith('fix-attempts', expect.any(Object));
      expect(circuitBreaker.registerCircuit).toHaveBeenCalledWith('verification', expect.any(Object));
      expect(circuitBreaker.registerCircuit).toHaveBeenCalledWith('database-operations', expect.any(Object));
    });
  });
});