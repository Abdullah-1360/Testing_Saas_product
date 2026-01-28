import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import fc from 'fast-check';
import { PurgeService } from './purge.service';
import { ScheduledPurgeManagerService } from './scheduled-purge-manager.service';
import { PurgeValidationService } from './purge-validation.service';
import { AnonymizationService } from './anonymization.service';
import { RetentionService } from './retention.service';
import { PrismaService } from '@/database/prisma.service';
import { AuditService } from '@/audit/audit.service';
import { JobsService } from '@/jobs/jobs.service';
import { ManualPurgeDto, PurgeMode, PurgeScope } from './dto';

describe('Automated Data Cleanup System - Property-Based Tests', () => {
  let purgeService: PurgeService;
  let scheduledPurgeManager: ScheduledPurgeManagerService;
  let purgeValidation: PurgeValidationService;
  let anonymizationService: AnonymizationService;
  let retentionService: RetentionService;

  beforeEach(async () => {
    const mockPrismaService = {
      incident: {
        count: jest.fn().mockResolvedValue(0),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn().mockResolvedValue([]),
        aggregate: jest.fn().mockResolvedValue({ _min: { createdAt: null }, _max: { createdAt: null } }),
      },
      incidentEvent: {
        count: jest.fn().mockResolvedValue(0),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        aggregate: jest.fn().mockResolvedValue({ _min: { timestamp: null }, _max: { timestamp: null } }),
      },
      commandExecution: {
        count: jest.fn().mockResolvedValue(0),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        aggregate: jest.fn().mockResolvedValue({ _min: { timestamp: null }, _max: { timestamp: null } }),
      },
      evidence: {
        count: jest.fn().mockResolvedValue(0),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        aggregate: jest.fn().mockResolvedValue({ _min: { timestamp: null }, _max: { timestamp: null } }),
      },
      backupArtifact: {
        count: jest.fn().mockResolvedValue(0),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        aggregate: jest.fn().mockResolvedValue({ _min: { createdAt: null }, _max: { createdAt: null } }),
      },
      fileChange: {
        count: jest.fn().mockResolvedValue(0),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        aggregate: jest.fn().mockResolvedValue({ _min: { timestamp: null }, _max: { timestamp: null } }),
      },
      verificationResult: {
        count: jest.fn().mockResolvedValue(0),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        aggregate: jest.fn().mockResolvedValue({ _min: { timestamp: null }, _max: { timestamp: null } }),
      },
      auditEvent: {
        count: jest.fn().mockResolvedValue(0),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        aggregate: jest.fn().mockResolvedValue({ _min: { timestamp: null }, _max: { timestamp: null } }),
      },
      purgeAudit: {
        create: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      retentionPolicy: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: 'test-policy',
          policyName: 'default-retention',
          retentionDays: 3,
          appliesTo: 'all',
          isActive: true,
        }),
      },
    };

    const mockAuditService = {
      createAuditEvent: jest.fn().mockResolvedValue(undefined),
    };

    const mockJobsService = {
      scheduleDataPurge: jest.fn().mockResolvedValue({ jobId: 'test-job' }),
    };

    const mockConfigService = {
      get: jest.fn((key: string, defaultValue?: any) => {
        const config: Record<string, any> = {
          DEFAULT_RETENTION_DAYS: 3,
          ENABLE_AUTO_PURGE: true,
          ENABLE_DATA_ANONYMIZATION: true,
          ANONYMIZATION_RETENTION_DAYS: 5,
        };
        return config[key] ?? defaultValue;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PurgeService,
        ScheduledPurgeManagerService,
        PurgeValidationService,
        AnonymizationService,
        RetentionService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: AuditService, useValue: mockAuditService },
        { provide: JobsService, useValue: mockJobsService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    purgeService = module.get<PurgeService>(PurgeService);
    scheduledPurgeManager = module.get<ScheduledPurgeManagerService>(ScheduledPurgeManagerService);
    purgeValidation = module.get<PurgeValidationService>(PurgeValidationService);
    anonymizationService = module.get<AnonymizationService>(AnonymizationService);
    retentionService = module.get<RetentionService>(RetentionService);
  });

  // Custom generators for property-based testing
  const validRetentionDaysGenerator = () => fc.integer({ min: 1, max: 7 });
  
  const purgeConfigGenerator = () => fc.record({
    retentionDays: validRetentionDaysGenerator(),
    tableName: fc.option(fc.constantFrom(
      'incidents', 'incident_events', 'command_executions',
      'evidence', 'backup_artifacts', 'file_changes',
      'verification_results', 'audit_events'
    )),
    dryRun: fc.boolean(),
    purgeMode: fc.constantFrom(PurgeMode.SOFT, PurgeMode.HARD, PurgeMode.ARCHIVE),
    purgeScope: fc.constantFrom(
      PurgeScope.ALL, PurgeScope.INCIDENTS, PurgeScope.COMMANDS,
      PurgeScope.EVIDENCE, PurgeScope.BACKUPS, PurgeScope.AUDIT
    ),
    createBackup: fc.boolean(),
    verifyIntegrity: fc.boolean(),
    maxRecords: fc.option(fc.integer({ min: 1, max: 100000 })),
    reason: fc.option(fc.string({ minLength: 1, maxLength: 200 })),
  });

  const scheduleConfigGenerator = () => fc.record({
    name: fc.string({ minLength: 1, maxLength: 100 }),
    description: fc.string({ minLength: 1, maxLength: 500 }),
    cronExpression: fc.constantFrom('0 2 * * *', '0 3 * * 0', '*/15 * * * *', '0 6 * * *'),
    retentionDays: validRetentionDaysGenerator(),
    purgeScope: fc.constantFrom('all', 'incidents', 'commands', 'evidence', 'backups', 'audit', 'anonymization'),
    isActive: fc.boolean(),
    createBackup: fc.boolean(),
    verifyIntegrity: fc.boolean(),
    maxRecords: fc.option(fc.integer({ min: 1, max: 100000 })),
    createdBy: fc.string({ minLength: 1, maxLength: 50 }),
  });

  const anonymizationConfigGenerator = () => fc.record({
    retentionDays: validRetentionDaysGenerator(),
    tableName: fc.option(fc.constantFrom(
      'audit_events', 'command_executions', 'evidence', 'user_sessions', 'servers'
    )),
    dryRun: fc.boolean(),
    anonymizePersonalData: fc.boolean(),
    anonymizeCredentials: fc.boolean(),
    anonymizeIpAddresses: fc.boolean(),
  });

  describe('Property 5: Automatic Data Purging', () => {
    /**
     * Feature: wp-autohealer, Property 5: Automatic Data Purging
     * **Validates: Requirements 3.3** - Automatically purge expired data according to retention policies
     */
    it('should automatically purge data that exceeds the configured retention period', () => {
      fc.assert(
        fc.property(
          purgeConfigGenerator(),
          async (config) => {
            // Execute purge operation
            const result = await purgeService.executeManualPurge(config);

            // Property: All purged data should be older than retention period
            const cutoffDate = new Date(Date.now() - config.retentionDays * 24 * 60 * 60 * 1000);
            
            expect(result).toBeDefined();
            expect(result.success).toBe(true);
            expect(result.dryRun).toBe(config.dryRun);
            expect(result.purgeMode).toBe(config.purgeMode || PurgeMode.HARD);
            expect(result.purgeScope).toBe(config.purgeScope || PurgeScope.ALL);
            
            // Verify cutoff date is correctly calculated
            expect(result.results).toBeDefined();
            expect(Array.isArray(result.results)).toBe(true);
            
            // Each result should have a valid cutoff date
            result.results.forEach(tableResult => {
              expect(tableResult.cutoffDate).toBeDefined();
              const resultCutoffDate = new Date(tableResult.cutoffDate);
              expect(resultCutoffDate.getTime()).toBeLessThanOrEqual(cutoffDate.getTime() + 1000); // Allow 1s tolerance
            });
          }
        ),
        { numRuns: 10 }
      );
    });
  });

  describe('Property 6: Purge Operation Audit Trail', () => {
    /**
     * Feature: wp-autohealer, Property 6: Purge Operation Audit Trail
     * **Validates: Requirements 3.4** - Maintain audit trail of all purge operations
     */
    it('should create audit records for all purge operations', () => {
      fc.assert(
        fc.property(
          purgeConfigGenerator(),
          async (config) => {
            // Execute purge operation
            const result = await purgeService.executeManualPurge(config);

            // Property: Every purge operation should generate audit records
            expect(result).toBeDefined();
            expect(result.success).toBe(true);
            
            // Verify audit information is captured
            expect(result.executedAt).toBeDefined();
            expect(result.totalRecordsPurged).toBeGreaterThanOrEqual(0);
            expect(result.tablesProcessed).toBeGreaterThanOrEqual(0);
            
            // Verify execution metadata
            if (config.reason) {
              expect(result.reason).toBe(config.reason);
            }
            
            // Verify backup and integrity flags are preserved
            if (config.createBackup !== undefined) {
              expect(result.backupsCreated).toBeGreaterThanOrEqual(0);
            }
            
            if (config.verifyIntegrity !== undefined) {
              expect(result.integrityChecksPerformed).toBeGreaterThanOrEqual(0);
            }
          }
        ),
        { numRuns: 10 }
      );
    });
  });

  describe('Property 4: Retention Policy Hard Cap Enforcement', () => {
    /**
     * Feature: wp-autohealer, Property 4: Retention Policy Hard Cap Enforcement
     * **Validates: Requirements 3.2** - Enforce hard cap of 1-7 days for retention
     */
    it('should enforce retention hard cap and reject invalid values', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: -10, max: 20 }), // Include invalid values
          async (retentionDays) => {
            const isValid = retentionService.validateRetentionDays(retentionDays);
            
            // Property: Only values between 1-7 should be valid
            if (retentionDays >= 1 && retentionDays <= 7) {
              expect(isValid).toBe(true);
            } else {
              expect(isValid).toBe(false);
            }
            
            // Test with purge configuration
            const config: ManualPurgeDto = {
              retentionDays,
              dryRun: true,
              purgeScope: PurgeScope.ALL,
              purgeMode: PurgeMode.HARD,
            };
            
            if (isValid) {
              // Valid retention days should work
              const result = await purgeService.executeManualPurge(config);
              expect(result.success).toBe(true);
            } else {
              // Invalid retention days should be rejected
              await expect(purgeService.executeManualPurge(config))
                .rejects
                .toThrow();
            }
          }
        ),
        { numRuns: 10 }
      );
    });
  });

  describe('Scheduled Purge Management Properties', () => {
    /**
     * Feature: wp-autohealer, Property: Scheduled Purge Configuration Validation
     * **Validates: Requirements 3.3** - Scheduled purge jobs should validate configuration
     */
    it('should validate all scheduled purge configurations', () => {
      fc.assert(
        fc.property(
          scheduleConfigGenerator(),
          async (config) => {
            const userId = 'test-user';
            
            try {
              const schedule = await scheduledPurgeManager.createSchedule(config, userId);
              
              // Property: Successfully created schedules should have valid configuration
              expect(schedule).toBeDefined();
              expect(schedule.name).toBe(config.name);
              expect(schedule.retentionDays).toBe(config.retentionDays);
              expect(schedule.purgeScope).toBe(config.purgeScope);
              expect(schedule.isActive).toBe(config.isActive);
              expect(schedule.createBackup).toBe(config.createBackup);
              expect(schedule.verifyIntegrity).toBe(config.verifyIntegrity);
              expect(schedule.executionCount).toBe(0);
              expect(schedule.failureCount).toBe(0);
              expect(schedule.createdAt).toBeInstanceOf(Date);
              
              // Verify retention days are within valid range
              expect(schedule.retentionDays).toBeGreaterThanOrEqual(1);
              expect(schedule.retentionDays).toBeLessThanOrEqual(7);
              
              // Verify max records constraint if specified
              if (config.maxRecords) {
                expect(schedule.maxRecords).toBe(config.maxRecords);
                expect(schedule.maxRecords).toBeGreaterThanOrEqual(1);
                expect(schedule.maxRecords).toBeLessThanOrEqual(100000);
              }
              
            } catch (error) {
              // Property: Failures should be due to validation errors
              expect(error).toBeInstanceOf(Error);
              const errorMessage = (error as Error).message;
              
              // Should fail for specific validation reasons
              const validationErrors = [
                'Invalid retention days',
                'Invalid cron expression',
                'Invalid purge scope',
                'Invalid max records',
              ];
              
              const hasValidationError = validationErrors.some(validError => 
                errorMessage.includes(validError)
              );
              
              expect(hasValidationError).toBe(true);
            }
          }
        ),
        { numRuns: 10 }
      );
    });
  });

  describe('Data Anonymization Properties', () => {
    /**
     * Feature: wp-autohealer, Property: Data Anonymization Compliance
     * **Validates: Requirements 3.4** - Data anonymization should maintain audit trail
     */
    it('should anonymize data while maintaining audit trail', () => {
      fc.assert(
        fc.property(
          anonymizationConfigGenerator(),
          async (config) => {
            const result = await anonymizationService.executeAnonymization(config);
            
            // Property: Anonymization should complete successfully and maintain audit
            expect(result).toBeDefined();
            expect(result.success).toBe(true);
            expect(result.totalRecordsAnonymized).toBeGreaterThanOrEqual(0);
            expect(result.tablesProcessed).toBeGreaterThanOrEqual(0);
            expect(result.executedAt).toBeDefined();
            expect(result.dryRun).toBe(config.dryRun);
            
            // Verify anonymization configuration is preserved
            if (config.tableName) {
              const tableResult = result.results.find(r => r.tableName === config.tableName);
              if (tableResult) {
                expect(tableResult.fieldsAnonymized).toBeDefined();
                expect(Array.isArray(tableResult.fieldsAnonymized)).toBe(true);
              }
            }
            
            // Verify execution time is recorded
            result.results.forEach(tableResult => {
              expect(tableResult.executionTimeMs).toBeGreaterThanOrEqual(0);
              expect(typeof tableResult.executionTimeMs).toBe('number');
            });
          }
        ),
        { numRuns: 10 }
      );
    });
  });

  describe('Purge Validation Properties', () => {
    /**
     * Feature: wp-autohealer, Property: Purge Validation Accuracy
     * **Validates: Requirements 3.3** - Purge validation should accurately assess impact
     */
    it('should provide accurate purge impact validation', () => {
      fc.assert(
        fc.property(
          purgeConfigGenerator(),
          async (config) => {
            const validation = await purgeValidation.validatePurgeOperation(config);
            
            // Property: Validation should provide comprehensive impact assessment
            expect(validation).toBeDefined();
            expect(typeof validation.isValid).toBe('boolean');
            expect(Array.isArray(validation.errors)).toBe(true);
            expect(Array.isArray(validation.warnings)).toBe(true);
            expect(Array.isArray(validation.recommendations)).toBe(true);
            expect(validation.estimatedImpact).toBeDefined();
            expect(typeof validation.requiresConfirmation).toBe('boolean');
            
            // Verify risk level is valid
            const validRiskLevels = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
            expect(validRiskLevels).toContain(validation.riskLevel);
            
            // Verify estimated impact structure
            expect(validation.estimatedImpact.recordsToDelete).toBeGreaterThanOrEqual(0);
            expect(validation.estimatedImpact.tablesAffected).toBeDefined();
            expect(Array.isArray(validation.estimatedImpact.tablesAffected)).toBe(true);
            expect(validation.estimatedImpact.estimatedExecutionTime).toBeGreaterThanOrEqual(0);
            expect(validation.estimatedImpact.diskSpaceToFree).toBeGreaterThanOrEqual(0);
            
            // Property: Invalid configurations should have errors
            if (!validation.isValid) {
              expect(validation.errors.length).toBeGreaterThan(0);
            }
            
            // Property: High-risk operations should require confirmation
            if (validation.riskLevel === 'HIGH' || validation.riskLevel === 'CRITICAL') {
              expect(validation.requiresConfirmation).toBe(true);
            }
          }
        ),
        { numRuns: 10 }
      );
    });
  });

  describe('System Integration Properties', () => {
    /**
     * Feature: wp-autohealer, Property: Automated Cleanup System Integration
     * **Validates: Requirements 3.3, 3.4** - All components should work together seamlessly
     */
    it('should maintain consistency across all cleanup components', () => {
      fc.assert(
        fc.property(
          fc.record({
            purgeConfig: purgeConfigGenerator(),
            scheduleConfig: scheduleConfigGenerator(),
            anonymizationConfig: anonymizationConfigGenerator(),
          }),
          async ({ purgeConfig, scheduleConfig, anonymizationConfig }) => {
            // Property: All components should use consistent retention validation
            const purgeRetentionValid = retentionService.validateRetentionDays(purgeConfig.retentionDays);
            const scheduleRetentionValid = retentionService.validateRetentionDays(scheduleConfig.retentionDays);
            const anonymizationRetentionValid = retentionService.validateRetentionDays(anonymizationConfig.retentionDays);
            
            // All should follow the same validation rules
            expect(purgeRetentionValid).toBe(
              purgeConfig.retentionDays >= 1 && purgeConfig.retentionDays <= 7
            );
            expect(scheduleRetentionValid).toBe(
              scheduleConfig.retentionDays >= 1 && scheduleConfig.retentionDays <= 7
            );
            expect(anonymizationRetentionValid).toBe(
              anonymizationConfig.retentionDays >= 1 && anonymizationConfig.retentionDays <= 7
            );
            
            // Property: Valid configurations should work across all components
            if (purgeRetentionValid) {
              const purgeResult = await purgeService.executeManualPurge(purgeConfig);
              expect(purgeResult.success).toBe(true);
            }
            
            if (anonymizationRetentionValid) {
              const anonymizationResult = await anonymizationService.executeAnonymization(anonymizationConfig);
              expect(anonymizationResult.success).toBe(true);
            }
            
            // Property: Validation should be consistent across components
            const validation = await purgeValidation.validatePurgeOperation(purgeConfig);
            if (purgeRetentionValid) {
              // Should not have retention-related errors
              const hasRetentionError = validation.errors.some(error => 
                error.includes('retention') || error.includes('hard cap')
              );
              expect(hasRetentionError).toBe(false);
            } else {
              // Should have retention-related errors
              expect(validation.isValid).toBe(false);
            }
          }
        ),
        { numRuns: 10 }
      );
    });
  });
});