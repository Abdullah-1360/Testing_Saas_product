import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JobsService } from './jobs.service';
import { QueueConfigService } from './queue.config';
import { RedisConfigService } from '@/config/redis.config';

// Mock BullMQ
jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: jest.fn().mockResolvedValue({ id: 'mock-job-id' }),
    getWaiting: jest.fn().mockResolvedValue([]),
    getActive: jest.fn().mockResolvedValue([]),
    getCompleted: jest.fn().mockResolvedValue([]),
    getFailed: jest.fn().mockResolvedValue([]),
    getDelayed: jest.fn().mockResolvedValue([]),
    pause: jest.fn().mockResolvedValue(undefined),
    resume: jest.fn().mockResolvedValue(undefined),
    clean: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
  })),
  Worker: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  })),
  QueueEvents: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  })),
}));

describe('JobsService', () => {
  let service: JobsService;
  let queueConfigService: QueueConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobsService,
        {
          provide: QueueConfigService,
          useValue: {
            addIncidentJob: jest.fn().mockResolvedValue({ id: 'mock-job-id' }),
            addDataRetentionJob: jest.fn().mockResolvedValue({ id: 'mock-job-id' }),
            addHealthCheckJob: jest.fn().mockResolvedValue({ id: 'mock-job-id' }),
            getAllQueueStats: jest.fn().mockResolvedValue([]),
            pauseQueue: jest.fn().mockResolvedValue(undefined),
            resumeQueue: jest.fn().mockResolvedValue(undefined),
            cleanQueue: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: RedisConfigService,
          useValue: {
            getRedisOptions: jest.fn().mockReturnValue({
              host: 'localhost',
              port: 6379,
              db: 0,
            }),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockImplementation((key: string, defaultValue?: any) => {
              const config: Record<string, any> = {
                REDIS_URL: 'redis://localhost:6379/0',
                MAX_FIX_ATTEMPTS: 15,
                DEFAULT_RETENTION_DAYS: 3,
              };
              return config[key] || defaultValue;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<JobsService>(JobsService);
    queueConfigService = module.get<QueueConfigService>(QueueConfigService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createIncident', () => {
    it('should create an incident processing job', async () => {
      const incidentData = {
        siteId: 'site-123',
        serverId: 'server-456',
        triggerType: 'http-500-error',
        priority: 'high',
      };

      const result = await service.createIncident(incidentData);

      expect(result).toHaveProperty('incidentId');
      expect(result).toHaveProperty('jobId', 'mock-job-id');
      expect(result).toHaveProperty('correlationId');
      expect(result).toHaveProperty('traceId');
      expect(result).toHaveProperty('state', 'NEW');

      expect(queueConfigService.addIncidentJob).toHaveBeenCalledWith(
        'process-incident',
        expect.objectContaining({
          siteId: 'site-123',
          serverId: 'server-456',
          currentState: 'NEW',
          fixAttempts: 0,
          maxFixAttempts: 15,
        }),
        expect.objectContaining({
          priority: 2, // High priority
        })
      );
    });

    it('should use default values for optional parameters', async () => {
      const incidentData = {
        siteId: 'site-123',
        serverId: 'server-456',
        triggerType: 'http-500-error',
      };

      await service.createIncident(incidentData);

      expect(queueConfigService.addIncidentJob).toHaveBeenCalledWith(
        'process-incident',
        expect.objectContaining({
          maxFixAttempts: 15,
          metadata: expect.objectContaining({
            priority: 'medium',
          }),
        }),
        expect.objectContaining({
          priority: 3, // Medium priority (default)
        })
      );
    });
  });

  describe('scheduleDataPurge', () => {
    it('should schedule a data purge job', async () => {
      const purgeData = {
        retentionDays: 3,
        tableName: 'incidents',
        dryRun: true,
      };

      const result = await service.scheduleDataPurge(purgeData);

      expect(result).toHaveProperty('jobId', 'mock-job-id');
      expect(result).toHaveProperty('correlationId');
      expect(result).toHaveProperty('retentionDays', 3);
      expect(result).toHaveProperty('cutoffDate');

      expect(queueConfigService.addDataRetentionJob).toHaveBeenCalledWith(
        'purge-expired-data',
        expect.objectContaining({
          retentionDays: 3,
          tableName: 'incidents',
          dryRun: true,
        }),
        expect.objectContaining({
          priority: 5, // Lower priority for maintenance
        })
      );
    });
  });

  describe('scheduleSiteHealthCheck', () => {
    it('should schedule a site health check job', async () => {
      const healthCheckData = {
        siteId: 'site-123',
        url: 'https://example.com',
        timeout: 30000,
      };

      const result = await service.scheduleSiteHealthCheck(healthCheckData);

      expect(result).toHaveProperty('jobId', 'mock-job-id');
      expect(result).toHaveProperty('correlationId');

      expect(queueConfigService.addHealthCheckJob).toHaveBeenCalledWith(
        'site-health-check',
        expect.objectContaining({
          siteId: 'site-123',
          checkType: 'site',
          url: 'https://example.com',
          timeout: 30000,
        }),
        expect.objectContaining({
          priority: 3,
        })
      );
    });
  });

  describe('getQueueStats', () => {
    it('should return queue statistics', async () => {
      const mockStats = [
        {
          queueName: 'incident-processing',
          counts: { waiting: 5, active: 2, completed: 100, failed: 3, delayed: 0 },
          jobs: { waiting: [], active: [], failed: [] },
        },
      ];

      (queueConfigService.getAllQueueStats as jest.Mock).mockResolvedValue(mockStats);

      const result = await service.getQueueStats();

      expect(result).toEqual(mockStats);
      expect(queueConfigService.getAllQueueStats).toHaveBeenCalled();
    });
  });

  describe('queue management', () => {
    it('should pause a queue', async () => {
      await service.pauseQueue('incident-processing');

      expect(queueConfigService.pauseQueue).toHaveBeenCalledWith('incident-processing');
    });

    it('should resume a queue', async () => {
      await service.resumeQueue('incident-processing');

      expect(queueConfigService.resumeQueue).toHaveBeenCalledWith('incident-processing');
    });

    it('should clean a queue', async () => {
      await service.cleanQueue('incident-processing', 48);

      expect(queueConfigService.cleanQueue).toHaveBeenCalledWith('incident-processing', 48 * 60 * 60 * 1000);
    });
  });

  describe('priority mapping', () => {
    it('should map priority strings to numeric values correctly', async () => {
      const testCases = [
        { priority: 'critical', expected: 1 },
        { priority: 'high', expected: 2 },
        { priority: 'medium', expected: 3 },
        { priority: 'low', expected: 4 },
        { priority: undefined, expected: 3 }, // default
        { priority: 'unknown', expected: 3 }, // default
      ];

      for (const testCase of testCases) {
        const incidentData: {
          siteId: string;
          serverId: string;
          triggerType: string;
          priority?: string;
        } = {
          siteId: 'site-123',
          serverId: 'server-456',
          triggerType: 'test',
        };

        if (testCase.priority) {
          incidentData.priority = testCase.priority;
        }

        await service.createIncident(incidentData);

        expect(queueConfigService.addIncidentJob).toHaveBeenLastCalledWith(
          'process-incident',
          expect.any(Object),
          expect.objectContaining({
            priority: testCase.expected,
          })
        );
      }
    });
  });
});