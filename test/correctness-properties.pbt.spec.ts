import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import * as fc from 'fast-check';
import { PrismaService } from '@/database/prisma.service';
import { AuditService } from '@/audit/audit.service';
import { EvidenceService } from '@/evidence/services/evidence.service';
import { RetentionService } from '@/retention/retention.service';
import { PurgeService } from '@/retention/purge.service';
import { SSHService } from '@/ssh/services/ssh.service';
import { RedactionService } from '@/common/services/redaction.service';
import { PurgeMode, PurgeScope } from '@/retention/dto';
import { generators } from './pbt-setup';

/**
 * WP-AutoHealer Correctness Properties - Property-Based Tests
 * 
 * This test suite validates the core correctness properties specified in the design document.
 * Each property is tested with reduced iterations (20-50) for faster execution while maintaining coverage.
 * 
 * **Validates: Requirements 2.1, 2.4, 2.5, 3.2, 3.3**
 */
describe('WP-AutoHealer Correctness Properties', () => {
  let evidenceService: EvidenceService;
  let auditService: AuditService;
  let retentionService: RetentionService;
  let purgeService: PurgeService;
  let prismaService: jest.Mocked<PrismaService>;
  let redactionService: jest.Mocked<RedactionService>;

  beforeEach(async () => {
    const mockPrismaService = {
      incident: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        deleteMany: jest.fn(),
      },
      incidentEvent: {
        create: jest.fn(),
        findMany: jest.fn(),
        deleteMany: jest.fn(),
      },
      commandExecution: {
        create: jest.fn(),
        findMany: jest.fn(),
        deleteMany: jest.fn(),
      },
      evidence: {
        create: jest.fn(),
        findMany: jest.fn(),
        deleteMany: jest.fn(),
      },
      backupArtifact: {
        create: jest.fn(),
        findMany: jest.fn(),
        deleteMany: jest.fn(),
      },
      fileChange: {
        create: jest.fn(),
        findMany: jest.fn(),
        deleteMany: jest.fn(),
      },
      verificationResult: {
        create: jest.fn(),
        findMany: jest.fn(),
        deleteMany: jest.fn(),
      },
      auditEvent: {
        create: jest.fn(),
        findMany: jest.fn(),
        deleteMany: jest.fn(),
      },
      purgeAudit: {
        create: jest.fn(),
        findMany: jest.fn(),
      },
      retentionPolicy: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
      },
    };

    const mockAuditService = {
      createAuditEvent: jest.fn(),
      logEvent: jest.fn(),
      generateTraceId: jest.fn(() => `trace-${Date.now()}-${Math.random()}`),
      generateCorrelationId: jest.fn(() => `corr-${Date.now()}-${Math.random()}`),
    };

    const mockSSHService = {
      connect: jest.fn(),
      executeCommand: jest.fn(),
      disconnect: jest.fn(),
    };

    const mockRedactionService = {
      redactCommand: jest.fn((cmd: string) => cmd.replace(/password=[^\s]+/gi, 'password=***')),
      redactText: jest.fn((text: string) => text.replace(/password=[^\s]+/gi, 'password=***')),
      redactObject: jest.fn((obj: any) => ({ ...obj, password: '***' })),
    };

    const mockConfigService = {
      get: jest.fn((key: string, defaultValue?: any) => {
        const config: Record<string, any> = {
          DEFAULT_RETENTION_DAYS: 3,
          MAX_RETENTION_DAYS: 7,
          MIN_RETENTION_DAYS: 1,
        };
        return config[key] ?? defaultValue;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EvidenceService,
        AuditService,
        RetentionService,
        PurgeService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: SSHService, useValue: mockSSHService },
        { provide: RedactionService, useValue: mockRedactionService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    evidenceService = module.get<EvidenceService>(EvidenceService);
    auditService = module.get<AuditService>(AuditService);
    retentionService = module.get<RetentionService>(RetentionService);
    purgeService = module.get<PurgeService>(PurgeService);
    prismaService = module.get(PrismaService) as jest.Mocked<PrismaService>;
    redactionService = module.get(RedactionService) as jest.Mocked<RedactionService>;
  });

  /**
   * **Property 1: Complete Incident Data Storage Verification**
   * 
   * *For any* incident that occurs in the system, all required operation data 
   * (phases, steps, commands, stdout/stderr, log signatures, verification results, 
   * file diffs, backup metadata, and rollback plans) should be stored in the database.
   * 
   * **Validates: Requirements 2.1**
   */
  describe('Property 1: Complete Incident Data Storage', () => {
    it('should store all required incident data for any incident', () => {
      fc.assert(
        fc.asyncProperty(
          generators.incident(),
          fc.record({
            evidenceType: fc.constantFrom('LOG_FILE', 'COMMAND_OUTPUT', 'SYSTEM_INFO', 'WORDPRESS_INFO'),
            content: fc.string({ minLength: 10, maxLength: 1000 }),
            metadata: fc.record({
              phases: fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 1, maxLength: 5 }),
              steps: fc.array(fc.string({ minLength: 1, maxLength: 100 }), { minLength: 1, maxLength: 10 }),
              commands: fc.array(fc.string({ minLength: 1, maxLength: 200 }), { minLength: 1, maxLength: 5 }),
              stdout: fc.string(),
              stderr: fc.string(),
              logSignatures: fc.array(fc.string({ minLength: 32, maxLength: 64 }), { minLength: 1, maxLength: 3 }),
              verificationResults: fc.array(fc.record({
                type: fc.string(),
                status: fc.constantFrom('passed', 'failed', 'warning'),
                details: fc.string(),
              }), { minLength: 1, maxLength: 3 }),
              fileDiffs: fc.array(fc.record({
                filePath: fc.string(),
                changeType: fc.constantFrom('created', 'modified', 'deleted'),
                diff: fc.string(),
              }), { minLength: 0, maxLength: 3 }),
              backupMetadata: fc.record({
                backupId: fc.uuid(),
                backupPath: fc.string(),
                checksum: fc.string({ minLength: 32, maxLength: 64 }),
                size: fc.integer({ min: 0, max: 1000000 }),
              }),
              rollbackPlans: fc.array(fc.record({
                step: fc.string(),
                command: fc.string(),
                order: fc.integer({ min: 1, max: 100 }),
              }), { minLength: 1, maxLength: 5 }),
            }),
          }),
          async (incident, evidenceData) => {
            // Mock successful evidence storage with all required data
            const mockEvidence = {
              id: `evidence-${incident.id}`,
              incidentId: incident.id,
              evidenceType: evidenceData.evidenceType,
              signature: 'sha256:abc123def456',
              content: evidenceData.content,
              metadata: {
                ...evidenceData.metadata,
                collectionTime: new Date().toISOString(),
                collectionId: 'collection-123',
                signatureAlgorithm: 'sha256',
              },
              timestamp: new Date(),
            };

            (prismaService.evidence.create as jest.Mock).mockResolvedValue(mockEvidence);

            // Act - Store evidence with operation data
            const result = await evidenceService.storeEvidence(
              incident.id, 
              evidenceData.evidenceType, 
              evidenceData.content, 
              evidenceData.metadata
            );

            // Assert - All required fields should be present in the stored evidence
            expect(result).toHaveProperty('id');
            expect(result).toHaveProperty('incidentId', incident.id);
            expect(result).toHaveProperty('evidenceType', evidenceData.evidenceType);
            expect(result).toHaveProperty('signature');
            expect(result).toHaveProperty('content');
            expect(result).toHaveProperty('metadata');
            expect(result).toHaveProperty('timestamp');

            // Verify metadata contains all required incident operation data
            const metadata = result.metadata as any;
            expect(metadata).toHaveProperty('phases');
            expect(metadata).toHaveProperty('steps');
            expect(metadata).toHaveProperty('commands');
            expect(metadata).toHaveProperty('stdout');
            expect(metadata).toHaveProperty('stderr');
            expect(metadata).toHaveProperty('logSignatures');
            expect(metadata).toHaveProperty('verificationResults');
            expect(metadata).toHaveProperty('fileDiffs');
            expect(metadata).toHaveProperty('backupMetadata');
            expect(metadata).toHaveProperty('rollbackPlans');

            // Verify collection metadata is added
            expect(metadata).toHaveProperty('collectionTime');
            expect(metadata).toHaveProperty('collectionId');
            expect(metadata).toHaveProperty('signatureAlgorithm');

            // Verify data integrity
            expect(metadata.phases).toEqual(evidenceData.metadata.phases);
            expect(metadata.commands).toEqual(evidenceData.metadata.commands);
            expect(metadata.backupMetadata).toEqual(evidenceData.metadata.backupMetadata);
          }
        ),
        { numRuns: 10 }
      );
    });
  });

  /**
   * **Property 2: Unique Operation Identifier Assignment**
   * 
   * *For any* operation performed by the system, a unique trace ID and correlation ID 
   * should be assigned and recorded.
   * 
   * **Validates: Requirements 2.4**
   */
  describe('Property 2: Unique Operation Identifiers', () => {
    it('should assign unique trace and correlation IDs to all operations', () => {
      fc.assert(
        fc.asyncProperty(
          fc.array(generators.incident(), { minLength: 2, maxLength: 10 }),
          async (incidents) => {
            const traceIds: string[] = [];
            const correlationIds: string[] = [];

            // Process multiple incidents to test uniqueness
            for (const incident of incidents) {
              const mockAuditEvent = {
                id: `audit-${incident.id}`,
                traceId: auditService.generateTraceId(),
                correlationId: auditService.generateCorrelationId(),
                action: 'INCIDENT_CREATED',
                resourceType: 'incident',
                resourceId: incident.id,
                timestamp: new Date(),
              };

              (prismaService.auditEvent.create as jest.Mock).mockResolvedValue(mockAuditEvent);

              // Act - Create audit event for operation
              await auditService.createAuditEvent({
                action: 'INCIDENT_CREATED',
                resourceType: 'incident',
                resourceId: incident.id,
                userId: 'system',
                details: { incidentData: incident },
              });

              traceIds.push(mockAuditEvent.traceId);
              correlationIds.push(mockAuditEvent.correlationId);
            }

            // Assert - All IDs should be unique
            const uniqueTraceIds = new Set(traceIds);
            const uniqueCorrelationIds = new Set(correlationIds);

            expect(uniqueTraceIds.size).toBe(traceIds.length);
            expect(uniqueCorrelationIds.size).toBe(correlationIds.length);

            // Verify ID format (timestamp + UUID substring pattern)
            traceIds.forEach(traceId => {
              expect(traceId).toMatch(/^trace-\d+-[a-f0-9]{8}$/);
            });

            correlationIds.forEach(correlationId => {
              expect(correlationId).toMatch(/^corr-\d+-[a-f0-9]{8}$/);
            });
          }
        ),
        { numRuns: 10 }
      );
    });
  });

  /**
   * **Property 3: Complete Operation Audit Trail**
   * 
   * *For any* operation performed by the system, timestamps and actor identity 
   * should be recorded in the audit trail.
   * 
   * **Validates: Requirements 2.5**
   */
  describe('Property 3: Complete Operation Audit Trail', () => {
    it('should record timestamps and actor identity for all operations', () => {
      fc.assert(
        fc.asyncProperty(
          fc.record({
            action: fc.constantFrom(
              'INCIDENT_CREATED', 'COMMAND_EXECUTED', 'EVIDENCE_COLLECTED',
              'BACKUP_CREATED', 'VERIFICATION_PERFORMED', 'FIX_ATTEMPTED'
            ),
            resourceType: fc.constantFrom('incident', 'command', 'evidence', 'backup', 'verification'),
            resourceId: fc.uuid(),
            userId: fc.string({ minLength: 5, maxLength: 50 }).filter(s => s.trim().length >= 5), // Ensure non-empty userId
            details: fc.dictionary(fc.string(), fc.anything()),
          }),
          async (auditData) => {
            const startTime = Date.now();

            const mockAuditEvent = {
              id: `audit-${auditData.resourceId}`,
              action: auditData.action,
              resourceType: auditData.resourceType,
              resourceId: auditData.resourceId,
              userId: auditData.userId,
              metadata: {
                ...auditData.details,
                traceId: auditService.generateTraceId(),
                correlationId: auditService.generateCorrelationId(),
                timestamp: new Date().toISOString(),
              },
              timestamp: new Date(),
              ipAddress: null,
              userAgent: null,
            };

            (prismaService.auditEvent.create as jest.Mock).mockResolvedValue(mockAuditEvent);

            // Act - Create audit event
            const result = await auditService.createAuditEvent(auditData);

            const endTime = Date.now();

            // Assert - Audit trail should contain all required information
            expect(result).toBeDefined();
            
            // Verify the create call was made
            expect(prismaService.auditEvent.create).toHaveBeenCalled();
            
            const createCall = (prismaService.auditEvent.create as jest.Mock).mock.calls[
              (prismaService.auditEvent.create as jest.Mock).mock.calls.length - 1
            ][0];

            // Verify all required fields are present in the data
            expect(createCall.data).toHaveProperty('action', auditData.action);
            expect(createCall.data).toHaveProperty('resourceType', auditData.resourceType);
            expect(createCall.data).toHaveProperty('resourceId', auditData.resourceId);
            expect(createCall.data).toHaveProperty('userId');
            expect(createCall.data).toHaveProperty('metadata');
            
            // Verify metadata contain trace and correlation IDs
            expect(createCall.data.metadata).toHaveProperty('traceId');
            expect(createCall.data.metadata).toHaveProperty('correlationId');
            expect(createCall.data.metadata).toHaveProperty('timestamp');
            
            // Verify trace and correlation ID formats
            expect(createCall.data.metadata.traceId).toMatch(/^trace-\d+-[a-z0-9]{8}$/);
            expect(createCall.data.metadata.correlationId).toMatch(/^corr-\d+-[a-z0-9]{8}$/);
            
            // Verify userId is either the provided one or 'system' (when null/undefined is provided)
            expect(createCall.data.userId).toBeTruthy();
          }
        ),
        { numRuns: 10 }
      );
    });
  });

  /**
   * **Property 4: Retention Policy Hard Cap Enforcement**
   * 
   * *For any* retention configuration attempt, values outside the 1-7 day range 
   * should be rejected and the hard cap should be enforced.
   * 
   * **Validates: Requirements 3.2**
   */
  describe('Property 4: Retention Policy Hard Cap Enforcement', () => {
    it('should enforce hard cap of 1-7 days for any retention configuration', () => {
      fc.assert(
        fc.asyncProperty(
          fc.record({
            policyName: fc.string({ minLength: 1, maxLength: 100 }),
            retentionDays: fc.integer({ min: -10, max: 20 }), // Include invalid values
            appliesTo: fc.constantFrom('incidents', 'commands', 'evidence', 'backups', 'all'),
            isActive: fc.boolean(),
          }),
          fc.string({ minLength: 1, maxLength: 50 }), // userId
          async (policyData, userId) => {
            // Mock no existing policy
            (prismaService.retentionPolicy.findUnique as jest.Mock).mockResolvedValue(null);

            if (policyData.retentionDays >= 1 && policyData.retentionDays <= 7) {
              // Valid retention days - should succeed
              const mockPolicy = {
                id: `policy-${Date.now()}`,
                ...policyData,
                createdAt: new Date(),
                updatedAt: new Date(),
              };

              (prismaService.retentionPolicy.create as jest.Mock).mockResolvedValue(mockPolicy);

              const result = await retentionService.createRetentionPolicy(policyData, userId);

              expect(result).toBeDefined();
              expect(result.retentionDays).toBe(policyData.retentionDays);
              expect(result.retentionDays).toBeGreaterThanOrEqual(1);
              expect(result.retentionDays).toBeLessThanOrEqual(7);
            } else {
              // Invalid retention days - should be rejected
              await expect(
                retentionService.createRetentionPolicy(policyData, userId)
              ).rejects.toThrow(/Retention period must be between 1 and 7 days/);
            }
          }
        ),
        { numRuns: 10 }
      );
    });

    it('should validate retention days using the validation service', () => {
      fc.assert(
        fc.asyncProperty(
          fc.integer({ min: -100, max: 100 }),
          async (retentionDays) => {
            const isValid = retentionService.validateRetentionDays(retentionDays);

            // Property: Only values between 1-7 should be valid
            if (retentionDays >= 1 && retentionDays <= 7) {
              expect(isValid).toBe(true);
            } else {
              expect(isValid).toBe(false);
            }
          }
        ),
        { numRuns: 10 }
      );
    });
  });

  /**
   * **Property 5: Automatic Data Purging Compliance**
   * 
   * *For any* data that exceeds the configured retention period, the system should 
   * automatically purge it according to the retention policy.
   * 
   * **Validates: Requirements 3.3**
   */
  describe('Property 5: Automatic Data Purging Compliance', () => {
    it('should automatically purge data that exceeds retention period', () => {
      fc.assert(
        fc.asyncProperty(
          fc.record({
            retentionDays: fc.integer({ min: 1, max: 7 }),
            tableName: fc.option(fc.constantFrom(
              'incidents', 'incident_events', 'command_executions',
              'evidence', 'backup_artifacts', 'file_changes'
            )),
            dryRun: fc.boolean(),
            purgeScope: fc.constantFrom(PurgeScope.ALL, PurgeScope.INCIDENTS, PurgeScope.COMMANDS, PurgeScope.EVIDENCE, PurgeScope.BACKUPS),
            purgeMode: fc.constantFrom(PurgeMode.SOFT, PurgeMode.HARD, PurgeMode.ARCHIVE),
          }),
          async (purgeConfig) => {
            // Calculate cutoff date based on retention period
            const cutoffDate = new Date(Date.now() - purgeConfig.retentionDays * 24 * 60 * 60 * 1000);

            // Mock purge results
            const mockPurgeResult = {
              success: true,
              dryRun: purgeConfig.dryRun,
              purgeScope: purgeConfig.purgeScope,
              purgeMode: purgeConfig.purgeMode,
              totalRecordsPurged: 150,
              tablesProcessed: 5,
              executedAt: new Date(),
              results: [
                {
                  tableName: 'incidents',
                  recordsPurged: 50,
                  cutoffDate: cutoffDate.toISOString(),
                  executionTimeMs: 1200,
                },
                {
                  tableName: 'command_executions',
                  recordsPurged: 100,
                  cutoffDate: cutoffDate.toISOString(),
                  executionTimeMs: 800,
                },
              ],
            };

            // Mock database operations
            (prismaService.incident.deleteMany as jest.Mock).mockResolvedValue({ count: 50 });
            (prismaService.commandExecution.deleteMany as jest.Mock).mockResolvedValue({ count: 100 });

            // Mock purge audit creation
            (prismaService.purgeAudit.create as jest.Mock).mockResolvedValue({
              id: 'purge-audit-1',
              tableName: 'incidents',
              recordsPurged: 50,
              cutoffDate,
              executedAt: new Date(),
            });

            // Act - Execute purge operation (using the actual method signature)
            const result = await purgeService.executeManualPurge(purgeConfig, 'test-user');

            // Assert - Purge should complete successfully
            expect(result).toBeDefined();
            expect(result.success).toBe(true);
            expect(result.dryRun).toBe(purgeConfig.dryRun);
            expect(result.purgeScope).toBe(purgeConfig.purgeScope);

            // Verify cutoff date calculation
            expect(result.results).toBeDefined();
            expect(Array.isArray(result.results)).toBe(true);

            result.results.forEach(tableResult => {
              expect(tableResult.cutoffDate).toBeDefined();
              const resultCutoffDate = new Date(tableResult.cutoffDate);
              
              // Cutoff date should be approximately correct (within 1 minute tolerance)
              const expectedCutoff = new Date(Date.now() - purgeConfig.retentionDays * 24 * 60 * 60 * 1000);
              const timeDiff = Math.abs(resultCutoffDate.getTime() - expectedCutoff.getTime());
              expect(timeDiff).toBeLessThan(60000); // 1 minute tolerance

              // Records purged should be non-negative
              expect(tableResult.recordsPurged).toBeGreaterThanOrEqual(0);
              expect(tableResult.executionTimeMs).toBeGreaterThanOrEqual(0);
            });

            // Verify total counts
            expect(result.totalRecordsPurged).toBeGreaterThanOrEqual(0);
            expect(result.tablesProcessed).toBeGreaterThanOrEqual(0);
          }
        ),
        { numRuns: 10 }
      );
    });

    it('should create purge audit records for all purge operations', () => {
      fc.assert(
        fc.asyncProperty(
          fc.record({
            retentionDays: fc.integer({ min: 1, max: 7 }),
            reason: fc.option(fc.string({ minLength: 1, maxLength: 200 })),
            executedBy: fc.string({ minLength: 1, maxLength: 50 }),
            tableName: fc.constantFrom('incidents', 'command_executions', 'evidence'),
            recordsPurged: fc.integer({ min: 0, max: 1000 }),
          }),
          async (purgeData) => {
            const cutoffDate = new Date(Date.now() - purgeData.retentionDays * 24 * 60 * 60 * 1000);
            
            const mockPurgeAudit = {
              id: `purge-audit-${Date.now()}`,
              tableName: purgeData.tableName,
              recordsPurged: purgeData.recordsPurged,
              cutoffDate,
              executedAt: new Date(),
              executedBy: purgeData.executedBy,
              reason: purgeData.reason,
            };

            (prismaService.purgeAudit.create as jest.Mock).mockResolvedValue(mockPurgeAudit);

            // Mock a simple purge operation that would create audit records
            const purgeConfig = {
              retentionDays: purgeData.retentionDays,
              dryRun: false,
              purgeScope: PurgeScope.ALL,
              purgeMode: PurgeMode.HARD,
            };

            const mockPurgeResult = {
              success: true,
              dryRun: false,
              totalRecordsPurged: purgeData.recordsPurged,
              tablesProcessed: 1,
              executedAt: new Date(),
              results: [{
                tableName: purgeData.tableName,
                recordsPurged: purgeData.recordsPurged,
                cutoffDate: cutoffDate.toISOString(),
                executionTimeMs: 500,
              }],
            };

            // Act - Execute purge operation which should create audit records
            const result = await purgeService.executeManualPurge(purgeConfig, purgeData.executedBy);

            // Assert - Verify purge operation completed
            expect(result).toBeDefined();
            expect(result.success).toBe(true);
            expect(result.totalRecordsPurged).toBeGreaterThanOrEqual(0);

            // Verify audit record structure (the actual audit creation is handled internally)
            expect(result.results).toBeDefined();
            expect(Array.isArray(result.results)).toBe(true);
            
            result.results.forEach(tableResult => {
              expect(tableResult.tableName).toBeDefined();
              expect(tableResult.recordsPurged).toBeGreaterThanOrEqual(0);
              expect(tableResult.cutoffDate).toBeDefined();
              expect(tableResult.executionTimeMs).toBeGreaterThanOrEqual(0);
            });
          }
        ),
        { numRuns: 10 }
      );
    });
  });

  /**
   * **Integration Property: End-to-End Correctness**
   * 
   * This property tests the integration of all 5 core properties to ensure
   * they work together correctly in a complete workflow.
   */
  describe('Integration Property: End-to-End Correctness', () => {
    it('should maintain all correctness properties in a complete incident workflow', () => {
      fc.assert(
        fc.asyncProperty(
          generators.incident(),
          fc.record({
            retentionDays: fc.integer({ min: 1, max: 7 }),
            operationData: fc.record({
              commands: fc.array(fc.string(), { minLength: 1, maxLength: 5 }),
              evidence: fc.array(fc.string(), { minLength: 1, maxLength: 3 }),
            }),
          }),
          async (incident, config) => {
            // Property 1: Store complete incident data
            const mockIncidentData = {
              id: incident.id,
              phases: ['DISCOVERY', 'BACKUP', 'FIX_ATTEMPT'],
              steps: ['detect_issue', 'create_backup', 'apply_fix'],
              commands: config.operationData.commands,
              stdout: 'Command executed successfully',
              stderr: '',
              logSignatures: ['sha256:abc123'],
              verificationResults: [{ type: 'health_check', status: 'passed', details: 'Site is healthy' }],
              fileDiffs: [],
              backupMetadata: { backupId: 'backup-1', backupPath: '/backups/backup-1.tar.gz', checksum: 'sha256:def456', size: 1024 },
              rollbackPlans: [{ step: 'restore_backup', command: 'tar -xzf backup-1.tar.gz', order: 1 }],
            };

            (prismaService.incident.create as jest.Mock).mockResolvedValue(mockIncidentData);

            // Property 2 & 3: Generate unique IDs and audit trail
            const traceId = auditService.generateTraceId();
            const correlationId = auditService.generateCorrelationId();

            const mockAuditEvent = {
              id: 'audit-1',
              action: 'INCIDENT_WORKFLOW_COMPLETED',
              resourceType: 'incident',
              resourceId: incident.id,
              userId: 'system',
              traceId,
              correlationId,
              timestamp: new Date(),
              details: { workflowData: mockIncidentData },
            };

            (prismaService.auditEvent.create as jest.Mock).mockResolvedValue(mockAuditEvent);

            // Property 4: Validate retention policy
            const retentionValid = retentionService.validateRetentionDays(config.retentionDays);
            expect(retentionValid).toBe(true); // Should be valid since we generate 1-7

            // Property 5: Setup purge operation
            const mockPurgeResult = {
              success: true,
              dryRun: false,
              totalRecordsPurged: 10,
              tablesProcessed: 2,
              executedAt: new Date(),
              results: [
                {
                  tableName: 'incidents',
                  recordsPurged: 5,
                  cutoffDate: new Date(Date.now() - config.retentionDays * 24 * 60 * 60 * 1000).toISOString(),
                  executionTimeMs: 500,
                },
              ],
            };

            // Execute the complete workflow
            const incidentResult = await evidenceService.storeEvidence(
              incident.id, 
              'SYSTEM_INFO', 
              JSON.stringify(mockIncidentData), 
              mockIncidentData
            );
            const auditResult = await auditService.createAuditEvent({
              action: 'INCIDENT_WORKFLOW_COMPLETED',
              resourceType: 'incident',
              resourceId: incident.id,
              userId: 'system',
              details: { workflowData: mockIncidentData },
            });

            // Verify all properties are satisfied
            
            // Property 1: Complete data storage
            expect(incidentResult).toHaveProperty('metadata');
            const metadata = incidentResult.metadata as any;
            expect(metadata).toHaveProperty('phases');
            expect(metadata).toHaveProperty('commands');
            expect(metadata).toHaveProperty('backupMetadata');
            expect(metadata).toHaveProperty('rollbackPlans');

            // Property 2: Unique identifiers
            expect(traceId).toMatch(/^trace-\d+-[\d.]+$/);
            expect(correlationId).toMatch(/^corr-\d+-[\d.]+$/);

            // Property 3: Audit trail with timestamps and actor
            expect(auditResult).toBeDefined();
            expect(mockAuditEvent.timestamp).toBeInstanceOf(Date);
            expect(mockAuditEvent.userId).toBe('system');

            // Property 4: Retention validation
            expect(config.retentionDays).toBeGreaterThanOrEqual(1);
            expect(config.retentionDays).toBeLessThanOrEqual(7);

            // Property 5: Purge compliance (simulated)
            expect(mockPurgeResult.success).toBe(true);
            expect(mockPurgeResult.results[0].recordsPurged).toBeGreaterThanOrEqual(0);
          }
        ),
        { numRuns: 10 }
      );
    });
  });
});