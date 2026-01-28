import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ScheduledPurgeManagerService } from './scheduled-purge-manager.service';
import { PrismaService } from '@/database/prisma.service';
import { AuditService } from '@/audit/audit.service';
import { PurgeService } from './purge.service';
import { AnonymizationService } from './anonymization.service';
import { RetentionService } from './retention.service';
import { JobsService } from '@/jobs/jobs.service';

describe('ScheduledPurgeManagerService', () => {
  let service: ScheduledPurgeManagerService;
  let prismaService: jest.Mocked<PrismaService>;
  let auditService: jest.Mocked<AuditService>;
  let purgeService: jest.Mocked<PurgeService>;
  let anonymizationService: jest.Mocked<AnonymizationService>;
  let retentionService: jest.Mocked<RetentionService>;
  let jobsService: jest.Mocked<JobsService>;
  let configService: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    const mockPrismaService = {
      // Add mock methods as needed
    };

    const mockAuditService = {
      createAuditEvent: jest.fn(),
    };

    const mockPurgeService = {
      executeManualPurge: jest.fn(),
    };

    const mockAnonymizationService = {
      executeAnonymization: jest.fn(),
    };

    const mockRetentionService = {
      validateRetentionDays: jest.fn(),
      getOrCreateDefaultRetentionPolicy: jest.fn(),
    };

    const mockJobsService = {
      // Add mock methods as needed
    };

    const mockConfigService = {
      get: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScheduledPurgeManagerService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: AuditService, useValue: mockAuditService },
        { provide: PurgeService, useValue: mockPurgeService },
        { provide: AnonymizationService, useValue: mockAnonymizationService },
        { provide: RetentionService, useValue: mockRetentionService },
        { provide: JobsService, useValue: mockJobsService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<ScheduledPurgeManagerService>(ScheduledPurgeManagerService);
    prismaService = module.get(PrismaService);
    auditService = module.get(AuditService);
    purgeService = module.get(PurgeService);
    anonymizationService = module.get(AnonymizationService);
    retentionService = module.get(RetentionService);
    jobsService = module.get(JobsService);
    configService = module.get(ConfigService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createSchedule', () => {
    it('should create a custom purge schedule', async () => {
      // Arrange
      const userId = 'test-user-id';
      const scheduleConfig = {
        name: 'Test Schedule',
        description: 'Test description',
        cronExpression: '0 2 * * *',
        retentionDays: 3,
        purgeScope: 'all',
        isActive: true,
        createBackup: true,
        verifyIntegrity: true,
        createdBy: userId,
      };

      retentionService.validateRetentionDays.mockReturnValue(true);
      auditService.createAuditEvent.mockResolvedValue(undefined);

      // Act
      const result = await service.createSchedule(scheduleConfig, userId);

      // Assert
      expect(result).toBeDefined();
      expect(result.name).toBe(scheduleConfig.name);
      expect(result.retentionDays).toBe(scheduleConfig.retentionDays);
      expect(result.isActive).toBe(true);
      expect(result.executionCount).toBe(0);
      expect(result.failureCount).toBe(0);
      expect(auditService.createAuditEvent).toHaveBeenCalledWith({
        userId,
        action: 'CREATE_SCHEDULED_PURGE',
        resource: 'scheduled_purge',
        resourceId: expect.any(String),
        details: expect.objectContaining({
          scheduleName: scheduleConfig.name,
          cronExpression: scheduleConfig.cronExpression,
          retentionDays: scheduleConfig.retentionDays,
        }),
      });
    });

    it('should reject invalid retention days', async () => {
      // Arrange
      const userId = 'test-user-id';
      const scheduleConfig = {
        name: 'Test Schedule',
        description: 'Test description',
        cronExpression: '0 2 * * *',
        retentionDays: 10, // Invalid - exceeds hard cap
        purgeScope: 'all',
        isActive: true,
        createBackup: true,
        verifyIntegrity: true,
        createdBy: userId,
      };

      retentionService.validateRetentionDays.mockReturnValue(false);

      // Act & Assert
      await expect(service.createSchedule(scheduleConfig, userId))
        .rejects
        .toThrow('Invalid retention days: 10. Must be between 1-7 days.');
    });

    it('should reject invalid cron expression', async () => {
      // Arrange
      const userId = 'test-user-id';
      const scheduleConfig = {
        name: 'Test Schedule',
        description: 'Test description',
        cronExpression: 'invalid-cron', // Invalid cron expression
        retentionDays: 3,
        purgeScope: 'all',
        isActive: true,
        createBackup: true,
        verifyIntegrity: true,
        createdBy: userId,
      };

      retentionService.validateRetentionDays.mockReturnValue(true);

      // Act & Assert
      await expect(service.createSchedule(scheduleConfig, userId))
        .rejects
        .toThrow('Invalid cron expression: invalid-cron');
    });
  });

  describe('executeScheduledPurge', () => {
    it('should execute a regular purge schedule successfully', async () => {
      // Arrange
      const scheduleId = 'test-schedule';
      const schedule = {
        id: scheduleId,
        name: 'Test Schedule',
        description: 'Test description',
        cronExpression: '0 2 * * *',
        retentionDays: 3,
        purgeScope: 'all',
        isActive: true,
        createBackup: true,
        verifyIntegrity: true,
        createdBy: 'test-user',
        createdAt: new Date(),
        executionCount: 0,
        failureCount: 0,
      };

      // Mock the schedule exists
      service['schedules'].set(scheduleId, schedule);

      const mockPurgeResult = {
        success: true,
        totalRecordsPurged: 100,
        tablesProcessed: 5,
        results: [
          { tableName: 'incidents', recordsPurged: 50, executionTimeMs: 1000 },
          { tableName: 'audit_events', recordsPurged: 50, executionTimeMs: 1000 },
        ],
        executedAt: new Date().toISOString(),
        dryRun: false,
      };

      purgeService.executeManualPurge.mockResolvedValue(mockPurgeResult);

      // Act
      const result = await service.executeScheduledPurge(scheduleId);

      // Assert
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.recordsPurged).toBe(100);
      expect(result.tablesProcessed).toBe(5);
      expect(purgeService.executeManualPurge).toHaveBeenCalledWith({
        retentionDays: 3,
        purgeScope: 'all',
        dryRun: false,
        createBackup: true,
        verifyIntegrity: true,
        maxRecords: undefined,
        reason: 'Scheduled purge: Test Schedule',
      });

      // Check that schedule statistics were updated
      const updatedSchedule = service.getSchedule(scheduleId);
      expect(updatedSchedule?.executionCount).toBe(1);
      expect(updatedSchedule?.failureCount).toBe(0);
      expect(updatedSchedule?.lastExecuted).toBeDefined();
    });

    it('should execute an anonymization schedule successfully', async () => {
      // Arrange
      const scheduleId = 'anonymization-schedule';
      const schedule = {
        id: scheduleId,
        name: 'Anonymization Schedule',
        description: 'Test anonymization',
        cronExpression: '0 3 * * 0',
        retentionDays: 5,
        purgeScope: 'anonymization',
        isActive: true,
        createBackup: false,
        verifyIntegrity: false,
        createdBy: 'test-user',
        createdAt: new Date(),
        executionCount: 0,
        failureCount: 0,
      };

      service['schedules'].set(scheduleId, schedule);

      const mockAnonymizationResult = {
        success: true,
        totalRecordsAnonymized: 75,
        tablesProcessed: 3,
        results: [],
        executedAt: new Date().toISOString(),
        dryRun: false,
        executedBy: 'system',
      };

      anonymizationService.executeAnonymization.mockResolvedValue(mockAnonymizationResult);

      // Act
      const result = await service.executeScheduledPurge(scheduleId);

      // Assert
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.recordsPurged).toBe(75); // Records anonymized
      expect(result.tablesProcessed).toBe(3);
      expect(anonymizationService.executeAnonymization).toHaveBeenCalledWith({
        retentionDays: 5,
        anonymizePersonalData: true,
        anonymizeCredentials: true,
        anonymizeIpAddresses: true,
        dryRun: false,
      });
    });

    it('should handle schedule execution failure', async () => {
      // Arrange
      const scheduleId = 'failing-schedule';
      const schedule = {
        id: scheduleId,
        name: 'Failing Schedule',
        description: 'Test failure',
        cronExpression: '0 2 * * *',
        retentionDays: 3,
        purgeScope: 'all',
        isActive: true,
        createBackup: true,
        verifyIntegrity: true,
        createdBy: 'test-user',
        createdAt: new Date(),
        executionCount: 0,
        failureCount: 0,
      };

      service['schedules'].set(scheduleId, schedule);

      const error = new Error('Purge failed');
      purgeService.executeManualPurge.mockRejectedValue(error);

      // Act & Assert
      await expect(service.executeScheduledPurge(scheduleId))
        .rejects
        .toThrow('Purge failed');

      // Check that failure count was updated
      const updatedSchedule = service.getSchedule(scheduleId);
      expect(updatedSchedule?.failureCount).toBe(1);
      expect(updatedSchedule?.lastExecuted).toBeDefined();
    });

    it('should reject execution of inactive schedule', async () => {
      // Arrange
      const scheduleId = 'inactive-schedule';
      const schedule = {
        id: scheduleId,
        name: 'Inactive Schedule',
        description: 'Test inactive',
        cronExpression: '0 2 * * *',
        retentionDays: 3,
        purgeScope: 'all',
        isActive: false, // Inactive
        createBackup: true,
        verifyIntegrity: true,
        createdBy: 'test-user',
        createdAt: new Date(),
        executionCount: 0,
        failureCount: 0,
      };

      service['schedules'].set(scheduleId, schedule);

      // Act & Assert
      await expect(service.executeScheduledPurge(scheduleId))
        .rejects
        .toThrow('Schedule inactive-schedule is not active');
    });

    it('should reject execution of non-existent schedule', async () => {
      // Act & Assert
      await expect(service.executeScheduledPurge('non-existent'))
        .rejects
        .toThrow('Schedule non-existent not found');
    });
  });

  describe('updateSchedule', () => {
    it('should update schedule successfully', async () => {
      // Arrange
      const scheduleId = 'test-schedule';
      const schedule = {
        id: scheduleId,
        name: 'Original Name',
        description: 'Original description',
        cronExpression: '0 2 * * *',
        retentionDays: 3,
        purgeScope: 'all',
        isActive: true,
        createBackup: true,
        verifyIntegrity: true,
        createdBy: 'test-user',
        createdAt: new Date(),
        executionCount: 5,
        failureCount: 1,
      };

      service['schedules'].set(scheduleId, schedule);

      const updates = {
        name: 'Updated Name',
        retentionDays: 5,
        isActive: false,
      };

      const userId = 'updating-user';
      auditService.createAuditEvent.mockResolvedValue(undefined);

      // Act
      const result = await service.updateSchedule(scheduleId, updates, userId);

      // Assert
      expect(result).toBeDefined();
      expect(result.name).toBe('Updated Name');
      expect(result.retentionDays).toBe(5);
      expect(result.isActive).toBe(false);
      expect(result.description).toBe('Original description'); // Unchanged
      expect(auditService.createAuditEvent).toHaveBeenCalledWith({
        userId,
        action: 'UPDATE_SCHEDULED_PURGE',
        resource: 'scheduled_purge',
        resourceId: scheduleId,
        details: expect.objectContaining({
          previousConfig: expect.any(Object),
          newConfig: expect.any(Object),
          changes: updates,
        }),
      });
    });
  });

  describe('deleteSchedule', () => {
    it('should delete custom schedule successfully', async () => {
      // Arrange
      const scheduleId = 'custom-schedule';
      const schedule = {
        id: scheduleId,
        name: 'Custom Schedule',
        description: 'Custom description',
        cronExpression: '0 2 * * *',
        retentionDays: 3,
        purgeScope: 'all',
        isActive: true,
        createBackup: true,
        verifyIntegrity: true,
        createdBy: 'test-user', // Not system
        createdAt: new Date(),
        executionCount: 0,
        failureCount: 0,
      };

      service['schedules'].set(scheduleId, schedule);

      const userId = 'deleting-user';
      auditService.createAuditEvent.mockResolvedValue(undefined);

      // Act
      await service.deleteSchedule(scheduleId, userId);

      // Assert
      expect(service.getSchedule(scheduleId)).toBeUndefined();
      expect(auditService.createAuditEvent).toHaveBeenCalledWith({
        userId,
        action: 'DELETE_SCHEDULED_PURGE',
        resource: 'scheduled_purge',
        resourceId: scheduleId,
        details: expect.objectContaining({
          deletedSchedule: expect.any(Object),
        }),
      });
    });

    it('should reject deletion of system schedule', async () => {
      // Arrange
      const scheduleId = 'daily-purge'; // System schedule
      const schedule = {
        id: scheduleId,
        name: 'Daily Purge',
        description: 'System schedule',
        cronExpression: '0 2 * * *',
        retentionDays: 3,
        purgeScope: 'all',
        isActive: true,
        createBackup: true,
        verifyIntegrity: true,
        createdBy: 'system', // System schedule
        createdAt: new Date(),
        executionCount: 0,
        failureCount: 0,
      };

      service['schedules'].set(scheduleId, schedule);

      const userId = 'deleting-user';

      // Act & Assert
      await expect(service.deleteSchedule(scheduleId, userId))
        .rejects
        .toThrow('Cannot delete system schedules');
    });
  });

  describe('getScheduleStatistics', () => {
    it('should return correct statistics', () => {
      // Arrange
      const schedule1 = {
        id: 'schedule-1',
        name: 'Schedule 1',
        description: 'Test',
        cronExpression: '0 2 * * *',
        retentionDays: 3,
        purgeScope: 'all',
        isActive: true,
        createBackup: true,
        verifyIntegrity: true,
        createdBy: 'test-user',
        createdAt: new Date(),
        executionCount: 10,
        failureCount: 1,
      };

      const schedule2 = {
        id: 'schedule-2',
        name: 'Schedule 2',
        description: 'Test',
        cronExpression: '0 3 * * *',
        retentionDays: 5,
        purgeScope: 'incidents',
        isActive: false,
        createBackup: true,
        verifyIntegrity: true,
        createdBy: 'test-user',
        createdAt: new Date(),
        executionCount: 5,
        failureCount: 0,
      };

      service['schedules'].set('schedule-1', schedule1);
      service['schedules'].set('schedule-2', schedule2);

      const executionHistory1 = [
        {
          scheduleId: 'schedule-1',
          executionId: 'exec-1',
          startTime: new Date(),
          endTime: new Date(),
          success: true,
          recordsPurged: 100,
          tablesProcessed: 5,
          executionTimeMs: 5000,
        },
        {
          scheduleId: 'schedule-1',
          executionId: 'exec-2',
          startTime: new Date(),
          endTime: new Date(),
          success: false,
          recordsPurged: 0,
          tablesProcessed: 0,
          executionTimeMs: 1000,
        },
      ];

      service['executionHistory'].set('schedule-1', executionHistory1);

      // Act
      const stats = service.getScheduleStatistics();

      // Assert
      expect(stats).toEqual({
        totalSchedules: 2,
        activeSchedules: 1,
        totalExecutions: 2,
        successfulExecutions: 1,
        failedExecutions: 1,
        averageExecutionTime: 3000, // (5000 + 1000) / 2
        lastExecutionTime: expect.any(Date),
      });
    });
  });

  describe('enableEmergencyCleanup', () => {
    it('should enable emergency cleanup mode', async () => {
      // Arrange
      const reason = 'Storage threshold exceeded';
      const userId = 'admin-user';
      auditService.createAuditEvent.mockResolvedValue(undefined);

      // Act
      await service.enableEmergencyCleanup(reason, userId);

      // Assert
      const emergencySchedule = service.getSchedule('emergency-cleanup');
      expect(emergencySchedule?.isActive).toBe(true);
      expect(emergencySchedule?.nextExecution).toBeDefined();
      expect(auditService.createAuditEvent).toHaveBeenCalledWith({
        userId,
        action: 'ENABLE_EMERGENCY_CLEANUP',
        resource: 'scheduled_purge',
        resourceId: 'emergency-cleanup',
        details: {
          reason,
          enabledAt: expect.any(String),
        },
      });
    });
  });

  describe('disableEmergencyCleanup', () => {
    it('should disable emergency cleanup mode', async () => {
      // Arrange
      const userId = 'admin-user';
      auditService.createAuditEvent.mockResolvedValue(undefined);

      // Act
      await service.disableEmergencyCleanup(userId);

      // Assert
      const emergencySchedule = service.getSchedule('emergency-cleanup');
      expect(emergencySchedule?.isActive).toBe(false);
      expect(auditService.createAuditEvent).toHaveBeenCalledWith({
        userId,
        action: 'DISABLE_EMERGENCY_CLEANUP',
        resource: 'scheduled_purge',
        resourceId: 'emergency-cleanup',
        details: {
          disabledAt: expect.any(String),
        },
      });
    });
  });
});