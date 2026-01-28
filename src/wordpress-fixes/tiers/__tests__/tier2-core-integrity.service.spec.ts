import { Test, TestingModule } from '@nestjs/testing';
import { Tier2CoreIntegrityService } from '../tier2-core-integrity.service';
import { FixPlaybookRegistry } from '../../fix-playbook-registry.service';
import { WordPressCoreIntegrityService } from '../../playbooks/wordpress-core-integrity.service';
import { WpConfigValidationService } from '../../playbooks/wp-config-validation.service';
import { DatabaseTableRepairService } from '../../playbooks/database-table-repair.service';
import { FixContext, FixEvidence, FixTier, FixPriority } from '../../interfaces/fix-playbook.interface';

// Mock the dependencies
const mockPlaybookRegistry = {
  registerPlaybook: jest.fn(),
  getPlaybooksForTier: jest.fn(),
  getApplicablePlaybooks: jest.fn(),
  getPlaybook: jest.fn(),
};

const mockWordPressCoreIntegrity = {
  name: 'wordpress-core-integrity',
  tier: FixTier.TIER_2_CORE_INTEGRITY,
  priority: FixPriority.HIGH,
  canApply: jest.fn(),
  apply: jest.fn(),
  getHypothesis: jest.fn(),
};

const mockWpConfigValidation = {
  name: 'wp-config-validation',
  tier: FixTier.TIER_2_CORE_INTEGRITY,
  priority: FixPriority.CRITICAL,
  canApply: jest.fn(),
  apply: jest.fn(),
  getHypothesis: jest.fn(),
};

const mockDatabaseTableRepair = {
  name: 'database-table-repair',
  tier: FixTier.TIER_2_CORE_INTEGRITY,
  priority: FixPriority.HIGH,
  canApply: jest.fn(),
  apply: jest.fn(),
  getHypothesis: jest.fn(),
};

describe('Tier2CoreIntegrityService', () => {
  let service: Tier2CoreIntegrityService;

  const mockContext: FixContext = {
    incidentId: 'test-incident-123',
    siteId: 'test-site-456',
    serverId: 'test-server-789',
    sitePath: '/var/www/html',
    wordpressPath: '/var/www/html/wp',
    domain: 'example.com',
    correlationId: 'corr-123',
    traceId: 'trace-456',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        Tier2CoreIntegrityService,
        { provide: FixPlaybookRegistry, useValue: mockPlaybookRegistry },
        { provide: WordPressCoreIntegrityService, useValue: mockWordPressCoreIntegrity },
        { provide: WpConfigValidationService, useValue: mockWpConfigValidation },
        { provide: DatabaseTableRepairService, useValue: mockDatabaseTableRepair },
      ],
    }).compile();

    service = module.get<Tier2CoreIntegrityService>(Tier2CoreIntegrityService);
    
    // Reset mocks
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('onModuleInit', () => {
    it('should register all Tier 2 playbooks', () => {
      service.onModuleInit();

      expect(mockPlaybookRegistry.registerPlaybook).toHaveBeenCalledTimes(3);
      expect(mockPlaybookRegistry.registerPlaybook).toHaveBeenCalledWith(mockWpConfigValidation);
      expect(mockPlaybookRegistry.registerPlaybook).toHaveBeenCalledWith(mockWordPressCoreIntegrity);
      expect(mockPlaybookRegistry.registerPlaybook).toHaveBeenCalledWith(mockDatabaseTableRepair);
    });
  });

  describe('executeTier2Fixes', () => {
    const mockEvidence: FixEvidence[] = [
      {
        type: 'log',
        description: 'Error log',
        content: 'wp-config.php error detected',
        signature: 'test-sig',
        timestamp: new Date(),
      },
    ];

    beforeEach(() => {
      mockPlaybookRegistry.getPlaybooksForTier.mockReturnValue([
        mockWpConfigValidation,
        mockWordPressCoreIntegrity,
        mockDatabaseTableRepair,
      ]);
    });

    it('should execute applicable Tier 2 fixes in priority order', async () => {
      // Mock wp-config validation as applicable and successful
      mockWpConfigValidation.canApply.mockResolvedValue(true);
      mockWpConfigValidation.getHypothesis.mockReturnValue('wp-config.php needs repair');
      mockWpConfigValidation.apply.mockResolvedValue({
        success: true,
        applied: true,
        changes: [{ type: 'config', description: 'Fixed wp-config.php', timestamp: new Date() }],
        evidence: [],
      });

      // Mock other playbooks as not applicable
      mockWordPressCoreIntegrity.canApply.mockResolvedValue(false);
      mockDatabaseTableRepair.canApply.mockResolvedValue(false);

      const results = await service.executeTier2Fixes(mockContext, mockEvidence);

      expect(results).toHaveLength(1);
      expect(results[0]!.success).toBe(true);
      expect(results[0]!.applied).toBe(true);
      expect(results[0]!.metadata?.['playbookName']).toBe('wp-config-validation');
      expect(results[0]!.metadata?.['hypothesis']).toBe('wp-config.php needs repair');

      // Should stop after first successful fix (conservative approach)
      expect(mockWpConfigValidation.apply).toHaveBeenCalledTimes(1);
      expect(mockWordPressCoreIntegrity.apply).not.toHaveBeenCalled();
      expect(mockDatabaseTableRepair.apply).not.toHaveBeenCalled();
    });

    it('should continue to next playbook if first one is not applicable', async () => {
      // Mock wp-config validation as not applicable
      mockWpConfigValidation.canApply.mockResolvedValue(false);

      // Mock core integrity as applicable and successful
      mockWordPressCoreIntegrity.canApply.mockResolvedValue(true);
      mockWordPressCoreIntegrity.getHypothesis.mockReturnValue('Core files need restoration');
      mockWordPressCoreIntegrity.apply.mockResolvedValue({
        success: true,
        applied: true,
        changes: [{ type: 'file', description: 'Restored core files', timestamp: new Date() }],
        evidence: [],
      });

      // Mock database repair as not applicable
      mockDatabaseTableRepair.canApply.mockResolvedValue(false);

      const results = await service.executeTier2Fixes(mockContext, mockEvidence);

      expect(results).toHaveLength(1);
      expect(results[0]!.success).toBe(true);
      expect(results[0]!.applied).toBe(true);
      expect(results[0]!.metadata?.['playbookName']).toBe('wordpress-core-integrity');

      expect(mockWpConfigValidation.apply).not.toHaveBeenCalled();
      expect(mockWordPressCoreIntegrity.apply).toHaveBeenCalledTimes(1);
      expect(mockDatabaseTableRepair.apply).not.toHaveBeenCalled();
    });

    it('should handle playbook execution errors gracefully', async () => {
      // Mock wp-config validation as applicable but failing
      mockWpConfigValidation.canApply.mockResolvedValue(true);
      mockWpConfigValidation.getHypothesis.mockReturnValue('wp-config.php needs repair');
      mockWpConfigValidation.apply.mockRejectedValue(new Error('SSH connection failed'));

      // Mock other playbooks as not applicable
      mockWordPressCoreIntegrity.canApply.mockResolvedValue(false);
      mockDatabaseTableRepair.canApply.mockResolvedValue(false);

      const results = await service.executeTier2Fixes(mockContext, mockEvidence);

      expect(results).toHaveLength(1);
      expect(results[0]!.success).toBe(false);
      expect(results[0]!.applied).toBe(false);
      expect(results[0]!.error).toBe('SSH connection failed');
      expect(results[0]!.metadata?.['playbookName']).toBe('wp-config-validation');
    });

    it('should return empty results when no playbooks are applicable', async () => {
      // Mock all playbooks as not applicable
      mockWpConfigValidation.canApply.mockResolvedValue(false);
      mockWordPressCoreIntegrity.canApply.mockResolvedValue(false);
      mockDatabaseTableRepair.canApply.mockResolvedValue(false);

      const results = await service.executeTier2Fixes(mockContext, mockEvidence);

      expect(results).toHaveLength(0);
      expect(mockWpConfigValidation.apply).not.toHaveBeenCalled();
      expect(mockWordPressCoreIntegrity.apply).not.toHaveBeenCalled();
      expect(mockDatabaseTableRepair.apply).not.toHaveBeenCalled();
    });
  });

  describe('getApplicableTier2Playbooks', () => {
    it('should return applicable playbook names', async () => {
      const mockEvidence: FixEvidence[] = [];
      
      mockPlaybookRegistry.getApplicablePlaybooks.mockResolvedValue([
        mockWpConfigValidation,
        mockDatabaseTableRepair,
      ]);

      const result = await service.getApplicableTier2Playbooks(mockContext, mockEvidence);

      expect(result).toEqual(['wp-config-validation', 'database-table-repair']);
      expect(mockPlaybookRegistry.getApplicablePlaybooks).toHaveBeenCalledWith(
        mockContext,
        mockEvidence,
        FixTier.TIER_2_CORE_INTEGRITY
      );
    });
  });

  describe('getTier2Stats', () => {
    it('should return Tier 2 playbook statistics', () => {
      mockPlaybookRegistry.getPlaybooksForTier.mockReturnValue([
        mockWpConfigValidation,
        mockWordPressCoreIntegrity,
        mockDatabaseTableRepair,
      ]);

      const stats = service.getTier2Stats();

      expect(stats.totalPlaybooks).toBe(3);
      expect(stats.playbookNames).toEqual([
        'wp-config-validation',
        'wordpress-core-integrity',
        'database-table-repair',
      ]);
    });
  });

  describe('executeSpecificPlaybook', () => {
    const mockEvidence: FixEvidence[] = [];

    it('should execute a specific playbook by name', async () => {
      mockPlaybookRegistry.getPlaybook.mockReturnValue(mockWpConfigValidation);
      mockWpConfigValidation.canApply.mockResolvedValue(true);
      mockWpConfigValidation.getHypothesis.mockReturnValue('wp-config.php needs repair');
      mockWpConfigValidation.apply.mockResolvedValue({
        success: true,
        applied: true,
        changes: [],
        evidence: [],
      });

      const result = await service.executeSpecificPlaybook(
        'wp-config-validation',
        mockContext,
        mockEvidence
      );

      expect(result).toBeDefined();
      expect(result!.success).toBe(true);
      expect(result!.applied).toBe(true);
      expect(result!.metadata?.['playbookName']).toBe('wp-config-validation');
      expect(result!.metadata?.['hypothesis']).toBe('wp-config.php needs repair');
    });

    it('should return null for non-existent playbook', async () => {
      mockPlaybookRegistry.getPlaybook.mockReturnValue(undefined);

      const result = await service.executeSpecificPlaybook(
        'non-existent-playbook',
        mockContext,
        mockEvidence
      );

      expect(result).toBeNull();
    });

    it('should return error result for non-applicable playbook', async () => {
      mockPlaybookRegistry.getPlaybook.mockReturnValue(mockWpConfigValidation);
      mockWpConfigValidation.canApply.mockResolvedValue(false);

      const result = await service.executeSpecificPlaybook(
        'wp-config-validation',
        mockContext,
        mockEvidence
      );

      expect(result).toBeDefined();
      expect(result!.success).toBe(false);
      expect(result!.applied).toBe(false);
      expect(result!.error).toContain('not applicable');
      expect(result!.metadata?.['reason']).toBe('not_applicable');
    });

    it('should handle playbook execution errors', async () => {
      mockPlaybookRegistry.getPlaybook.mockReturnValue(mockWpConfigValidation);
      mockWpConfigValidation.canApply.mockResolvedValue(true);
      mockWpConfigValidation.getHypothesis.mockReturnValue('wp-config.php needs repair');
      mockWpConfigValidation.apply.mockRejectedValue(new Error('Execution failed'));

      const result = await service.executeSpecificPlaybook(
        'wp-config-validation',
        mockContext,
        mockEvidence
      );

      expect(result).toBeDefined();
      expect(result!.success).toBe(false);
      expect(result!.applied).toBe(false);
      expect(result!.error).toBe('Execution failed');
    });
  });

  describe('validateTier2Prerequisites', () => {
    it('should validate all prerequisites successfully', async () => {
      // Mock all prerequisite checks as passing
      const mockExecuteCommand = jest.fn()
        // WordPress path check (3 files exist)
        .mockResolvedValueOnce({ stdout: 'exists', stderr: '', exitCode: 0 })
        .mockResolvedValueOnce({ stdout: 'exists', stderr: '', exitCode: 0 })
        .mockResolvedValueOnce({ stdout: 'exists', stderr: '', exitCode: 0 })
        // Database access check
        .mockResolvedValueOnce({ stdout: 'CONNECTION_SUCCESS', stderr: '', exitCode: 0 })
        // File permissions check
        .mockResolvedValueOnce({ stdout: 'WRITE_OK', stderr: '', exitCode: 0 });

      // Mock the private method
      (service as any).executeCommand = mockExecuteCommand;

      const result = await service.validateTier2Prerequisites(mockContext);

      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
      expect(result.evidence).toHaveLength(3); // WordPress path, database access, file permissions
    });

    it('should detect missing WordPress installation', async () => {
      // Mock WordPress path check as failing (only 1 file exists)
      const mockExecuteCommand = jest.fn()
        .mockResolvedValueOnce({ stdout: 'exists', stderr: '', exitCode: 0 })
        .mockResolvedValueOnce({ stdout: 'missing', stderr: '', exitCode: 0 })
        .mockResolvedValueOnce({ stdout: 'missing', stderr: '', exitCode: 0 })
        // Database access check
        .mockResolvedValueOnce({ stdout: 'CONNECTION_SUCCESS', stderr: '', exitCode: 0 })
        // File permissions check
        .mockResolvedValueOnce({ stdout: 'WRITE_OK', stderr: '', exitCode: 0 });

      (service as any).executeCommand = mockExecuteCommand;

      const result = await service.validateTier2Prerequisites(mockContext);

      expect(result.valid).toBe(false);
      expect(result.issues).toContain('WordPress installation path not found');
    });

    it('should detect database access issues', async () => {
      // Mock WordPress path check as passing
      const mockExecuteCommand = jest.fn()
        .mockResolvedValueOnce({ stdout: 'exists', stderr: '', exitCode: 0 })
        .mockResolvedValueOnce({ stdout: 'exists', stderr: '', exitCode: 0 })
        .mockResolvedValueOnce({ stdout: 'exists', stderr: '', exitCode: 0 })
        // Database access check fails
        .mockResolvedValueOnce({ stdout: 'CONNECTION_FAILED', stderr: '', exitCode: 0 })
        // File permissions check
        .mockResolvedValueOnce({ stdout: 'WRITE_OK', stderr: '', exitCode: 0 });

      (service as any).executeCommand = mockExecuteCommand;

      const result = await service.validateTier2Prerequisites(mockContext);

      expect(result.valid).toBe(false);
      expect(result.issues).toContain('Database not accessible');
    });

    it('should detect insufficient file permissions', async () => {
      // Mock WordPress path and database checks as passing
      const mockExecuteCommand = jest.fn()
        .mockResolvedValueOnce({ stdout: 'exists', stderr: '', exitCode: 0 })
        .mockResolvedValueOnce({ stdout: 'exists', stderr: '', exitCode: 0 })
        .mockResolvedValueOnce({ stdout: 'exists', stderr: '', exitCode: 0 })
        .mockResolvedValueOnce({ stdout: 'CONNECTION_SUCCESS', stderr: '', exitCode: 0 })
        // File permissions check fails
        .mockResolvedValueOnce({ stdout: 'WRITE_FAILED', stderr: '', exitCode: 0 });

      (service as any).executeCommand = mockExecuteCommand;

      const result = await service.validateTier2Prerequisites(mockContext);

      expect(result.valid).toBe(false);
      expect(result.issues).toContain('Insufficient file system permissions');
    });
  });
});