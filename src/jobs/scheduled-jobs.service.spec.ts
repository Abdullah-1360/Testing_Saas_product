import { Test, TestingModule } from '@nestjs/testing';
import { ScheduledJobsService } from './scheduled-jobs.service';
import { JobsService } from './jobs.service';
import { RetentionService } from '../retention/retention.service';
import { SitesService } from '../sites/sites.service';
import { ConfigService } from '@nestjs/config';

describe('ScheduledJobsService', () => {
  let service: ScheduledJobsService;
  let jobsService: jest.Mocked<JobsService>;
  let retentionService: jest.Mocked<RetentionService>;
  let sitesService: jest.Mocked<SitesService>;
  let configService: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScheduledJobsService,
        {
          provide: JobsService,
          useValue: {
            scheduleDataPurge: jest.fn(),
            scheduleSiteHealthCheck: jest.fn(),
          },
        },
        {
          provide: RetentionService,
          useValue: {
            getActiveRetentionPolicies: jest.fn(),
            purgeExpiredData: jest.fn(),
          },
        },
        {
          provide: SitesService,
          useValue: {
            findAll: jest.fn(),
            performHealthCheck: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ScheduledJobsService>(ScheduledJobsService);
    jobsService = module.get(JobsService);
    retentionService = module.get(RetentionService);
    sitesService = module.get(SitesService);
    configService = module.get(ConfigService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('scheduleDataPurge', () => {
    it('should schedule data purge for active retention policies', async () => {
      const mockPolicies = [
        {
          id: 'policy-1',
          policyName: 'incidents',
          retentionDays: 3,
          appliesTo: 'incidents',
          isActive: true,
        },
        {
          id: 'policy-2',
          policyName: 'audit_logs',
          retentionDays: 7,
          appliesTo: 'audit_events',
          isActive: true,
        },
      ];

      retentionService.getActiveRetentionPolicies.mockResolvedValue(mockPolicies as any);
      jobsService.scheduleDataPurge.mockResolvedValue('job-1');

      await service.scheduleDataPurge();

      expect(retentionService.getActiveRetentionPolicies).toHaveBeenCalled();
      expect(jobsService.scheduleDataPurge).toHaveBeenCalledTimes(2);
      expect(jobsService.scheduleDataPurge).toHaveBeenCalledWith({
        policyId: 'policy-1',
        retentionDays: 3,
        appliesTo: 'incidents',
      });
      expect(jobsService.scheduleDataPurge).toHaveBeenCalledWith({
        policyId: 'policy-2',
        retentionDays: 7,
        appliesTo: 'audit_events',
      });
    });

    it('should handle empty retention policies', async () => {
      retentionService.getActiveRetentionPolicies.mockResolvedValue([]);

      await service.scheduleDataPurge();

      expect(retentionService.getActiveRetentionPolicies).toHaveBeenCalled();
      expect(jobsService.scheduleDataPurge).not.toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      retentionService.getActiveRetentionPolicies.mockRejectedValue(
        new Error('Database error')
      );

      // Should not throw
      await expect(service.scheduleDataPurge()).resolves.toBeUndefined();
    });

    it('should continue scheduling even if one policy fails', async () => {
      const mockPolicies = [
        {
          id: 'policy-1',
          policyName: 'incidents',
          retentionDays: 3,
          appliesTo: 'incidents',
          isActive: true,
        },
        {
          id: 'policy-2',
          policyName: 'audit_logs',
          retentionDays: 7,
          appliesTo: 'audit_events',
          isActive: true,
        },
      ];

      retentionService.getActiveRetentionPolicies.mockResolvedValue(mockPolicies as any);
      jobsService.scheduleDataPurge
        .mockRejectedValueOnce(new Error('Job scheduling failed'))
        .mockResolvedValueOnce('job-2');

      await service.scheduleDataPurge();

      expect(jobsService.scheduleDataPurge).toHaveBeenCalledTimes(2);
    });
  });

  describe('scheduleSiteHealthChecks', () => {
    it('should schedule health checks for active sites', async () => {
      const mockSites = [
        {
          id: 'site-1',
          domain: 'example.com',
          isActive: true,
          serverId: 'server-1',
        },
        {
          id: 'site-2',
          domain: 'test.com',
          isActive: true,
          serverId: 'server-2',
        },
        {
          id: 'site-3',
          domain: 'inactive.com',
          isActive: false,
          serverId: 'server-3',
        },
      ];

      sitesService.findAll.mockResolvedValue(mockSites as any);
      jobsService.scheduleSiteHealthCheck.mockResolvedValue('job-1');

      await service.scheduleSiteHealthChecks();

      expect(sitesService.findAll).toHaveBeenCalledWith(false);
      expect(jobsService.scheduleSiteHealthCheck).toHaveBeenCalledTimes(2); // Only active sites
      expect(jobsService.scheduleSiteHealthCheck).toHaveBeenCalledWith({
        siteId: 'site-1',
        domain: 'example.com',
        force: false,
      });
      expect(jobsService.scheduleSiteHealthCheck).toHaveBeenCalledWith({
        siteId: 'site-2',
        domain: 'test.com',
        force: false,
      });
    });

    it('should handle sites with no active sites', async () => {
      sitesService.findAll.mockResolvedValue([]);

      await service.scheduleSiteHealthChecks();

      expect(sitesService.findAll).toHaveBeenCalled();
      expect(jobsService.scheduleSiteHealthCheck).not.toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      sitesService.findAll.mockRejectedValue(new Error('Database error'));

      // Should not throw
      await expect(service.scheduleSiteHealthChecks()).resolves.toBeUndefined();
    });

    it('should continue scheduling even if one site fails', async () => {
      const mockSites = [
        {
          id: 'site-1',
          domain: 'example.com',
          isActive: true,
          serverId: 'server-1',
        },
        {
          id: 'site-2',
          domain: 'test.com',
          isActive: true,
          serverId: 'server-2',
        },
      ];

      sitesService.findAll.mockResolvedValue(mockSites as any);
      jobsService.scheduleSiteHealthCheck
        .mockRejectedValueOnce(new Error('Job scheduling failed'))
        .mockResolvedValueOnce('job-2');

      await service.scheduleSiteHealthChecks();

      expect(jobsService.scheduleSiteHealthCheck).toHaveBeenCalledTimes(2);
    });

    it('should schedule forced health checks when specified', async () => {
      const mockSites = [
        {
          id: 'site-1',
          domain: 'example.com',
          isActive: true,
          serverId: 'server-1',
        },
      ];

      sitesService.findAll.mockResolvedValue(mockSites as any);
      jobsService.scheduleSiteHealthCheck.mockResolvedValue('job-1');

      await service.scheduleSiteHealthChecks(true);

      expect(jobsService.scheduleSiteHealthCheck).toHaveBeenCalledWith({
        siteId: 'site-1',
        domain: 'example.com',
        force: true,
      });
    });
  });

  describe('executeDataPurge', () => {
    it('should execute data purge for specified policy', async () => {
      const policyId = 'policy-123';
      const retentionDays = 3;
      const appliesTo = 'incidents';

      const mockResult = {
        policyId,
        recordsPurged: 150,
        cutoffDate: new Date(),
        executedAt: new Date(),
      };

      retentionService.purgeExpiredData.mockResolvedValue(mockResult as any);

      const result = await service.executeDataPurge(policyId, retentionDays, appliesTo);

      expect(result).toEqual(mockResult);
      expect(retentionService.purgeExpiredData).toHaveBeenCalledWith(
        policyId,
        retentionDays,
        appliesTo
      );
    });

    it('should handle purge errors', async () => {
      const policyId = 'policy-123';
      const retentionDays = 3;
      const appliesTo = 'incidents';

      retentionService.purgeExpiredData.mockRejectedValue(
        new Error('Purge failed')
      );

      await expect(
        service.executeDataPurge(policyId, retentionDays, appliesTo)
      ).rejects.toThrow('Purge failed');
    });
  });

  describe('executeSiteHealthCheck', () => {
    it('should execute health check for specified site', async () => {
      const siteId = 'site-123';
      const force = false;

      const mockResult = {
        siteId,
        healthy: true,
        statusCode: 200,
        responseTime: 150,
        issues: [],
      };

      sitesService.performHealthCheck.mockResolvedValue(mockResult as any);

      const result = await service.executeSiteHealthCheck(siteId, force);

      expect(result).toEqual(mockResult);
      expect(sitesService.performHealthCheck).toHaveBeenCalledWith(siteId, force);
    });

    it('should handle health check errors', async () => {
      const siteId = 'site-123';
      const force = false;

      sitesService.performHealthCheck.mockRejectedValue(
        new Error('Health check failed')
      );

      await expect(
        service.executeSiteHealthCheck(siteId, force)
      ).rejects.toThrow('Health check failed');
    });

    it('should pass force parameter correctly', async () => {
      const siteId = 'site-123';
      const force = true;

      sitesService.performHealthCheck.mockResolvedValue({} as any);

      await service.executeSiteHealthCheck(siteId, force);

      expect(sitesService.performHealthCheck).toHaveBeenCalledWith(siteId, true);
    });
  });

  describe('getScheduledJobsConfig', () => {
    it('should return default configuration when no config provided', () => {
      configService.get.mockImplementation((key: string, defaultValue: any) => defaultValue);

      const config = service.getScheduledJobsConfig();

      expect(config).toEqual({
        dataPurgeEnabled: true,
        dataPurgeCron: '0 2 * * *', // Daily at 2 AM
        healthCheckEnabled: true,
        healthCheckCron: '0 */6 * * *', // Every 6 hours
        healthCheckForced: false,
      });
    });

    it('should return custom configuration when provided', () => {
      configService.get.mockImplementation((key: string, defaultValue: any) => {
        const config = {
          'SCHEDULED_JOBS_DATA_PURGE_ENABLED': 'false',
          'SCHEDULED_JOBS_DATA_PURGE_CRON': '0 3 * * *',
          'SCHEDULED_JOBS_HEALTH_CHECK_ENABLED': 'false',
          'SCHEDULED_JOBS_HEALTH_CHECK_CRON': '0 */12 * * *',
          'SCHEDULED_JOBS_HEALTH_CHECK_FORCED': 'true',
        };
        return config[key] || defaultValue;
      });

      const config = service.getScheduledJobsConfig();

      expect(config).toEqual({
        dataPurgeEnabled: false,
        dataPurgeCron: '0 3 * * *',
        healthCheckEnabled: false,
        healthCheckCron: '0 */12 * * *',
        healthCheckForced: true,
      });
    });

    it('should handle boolean string conversion', () => {
      configService.get.mockImplementation((key: string, defaultValue: any) => {
        const config = {
          'SCHEDULED_JOBS_DATA_PURGE_ENABLED': 'true',
          'SCHEDULED_JOBS_HEALTH_CHECK_ENABLED': 'false',
          'SCHEDULED_JOBS_HEALTH_CHECK_FORCED': 'yes', // Non-standard boolean
        };
        return config[key] || defaultValue;
      });

      const config = service.getScheduledJobsConfig();

      expect(config.dataPurgeEnabled).toBe(true);
      expect(config.healthCheckEnabled).toBe(false);
      expect(config.healthCheckForced).toBe(false); // 'yes' should be false
    });
  });

  describe('isJobEnabled', () => {
    it('should return true for enabled data purge job', () => {
      configService.get.mockReturnValue('true');

      const enabled = service.isJobEnabled('dataPurge');

      expect(enabled).toBe(true);
      expect(configService.get).toHaveBeenCalledWith(
        'SCHEDULED_JOBS_DATA_PURGE_ENABLED',
        'true'
      );
    });

    it('should return false for disabled health check job', () => {
      configService.get.mockReturnValue('false');

      const enabled = service.isJobEnabled('healthCheck');

      expect(enabled).toBe(false);
      expect(configService.get).toHaveBeenCalledWith(
        'SCHEDULED_JOBS_HEALTH_CHECK_ENABLED',
        'true'
      );
    });

    it('should return false for unknown job type', () => {
      const enabled = service.isJobEnabled('unknownJob' as any);

      expect(enabled).toBe(false);
    });
  });

  describe('getJobCron', () => {
    it('should return cron expression for data purge job', () => {
      configService.get.mockReturnValue('0 1 * * *');

      const cron = service.getJobCron('dataPurge');

      expect(cron).toBe('0 1 * * *');
      expect(configService.get).toHaveBeenCalledWith(
        'SCHEDULED_JOBS_DATA_PURGE_CRON',
        '0 2 * * *'
      );
    });

    it('should return cron expression for health check job', () => {
      configService.get.mockReturnValue('0 */4 * * *');

      const cron = service.getJobCron('healthCheck');

      expect(cron).toBe('0 */4 * * *');
      expect(configService.get).toHaveBeenCalledWith(
        'SCHEDULED_JOBS_HEALTH_CHECK_CRON',
        '0 */6 * * *'
      );
    });

    it('should return default cron for unknown job type', () => {
      const cron = service.getJobCron('unknownJob' as any);

      expect(cron).toBe('0 0 * * *'); // Default: daily at midnight
    });
  });

  describe('validateCronExpression', () => {
    it('should return true for valid cron expressions', () => {
      const validExpressions = [
        '0 0 * * *',     // Daily at midnight
        '0 */6 * * *',   // Every 6 hours
        '30 2 * * 1',    // Weekly on Monday at 2:30 AM
        '0 0 1 * *',     // Monthly on 1st at midnight
        '*/15 * * * *',  // Every 15 minutes
      ];

      validExpressions.forEach(expr => {
        expect(service.validateCronExpression(expr)).toBe(true);
      });
    });

    it('should return false for invalid cron expressions', () => {
      const invalidExpressions = [
        '',
        'invalid',
        '0 0 * *',       // Missing field
        '60 0 * * *',    // Invalid minute (60)
        '0 25 * * *',    // Invalid hour (25)
        '0 0 32 * *',    // Invalid day (32)
        '0 0 * 13 *',    // Invalid month (13)
        '0 0 * * 8',     // Invalid day of week (8)
      ];

      invalidExpressions.forEach(expr => {
        expect(service.validateCronExpression(expr)).toBe(false);
      });
    });
  });
});