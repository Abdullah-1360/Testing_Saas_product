import { Test, TestingModule } from '@nestjs/testing';
import { WordPressFixesService } from './wordpress-fixes.service';
import { FixPlaybookRegistryService } from './fix-playbook-registry.service';
import { SSHService } from '../ssh/services/ssh.service';
import { BackupService } from '../backup/services/backup.service';
import { VerificationService } from '../verification/services/verification.service';
import { FixTier, FixResult, FixStatus } from './interfaces/fix.interface';

describe('WordPressFixesService', () => {
  let service: WordPressFixesService;
  let registryService: jest.Mocked<FixPlaybookRegistryService>;
  let sshService: jest.Mocked<SSHService>;
  let backupService: jest.Mocked<BackupService>;
  let verificationService: jest.Mocked<VerificationService>;

  const mockPlaybook = {
    name: 'test-playbook',
    tier: FixTier.TIER_1_INFRASTRUCTURE,
    description: 'Test playbook',
    canApply: jest.fn(),
    apply: jest.fn(),
    rollback: jest.fn(),
    verify: jest.fn(),
  };

  const mockIncident = {
    id: 'incident-123',
    siteId: 'site-123',
    serverId: 'server-123',
    fixAttempts: 0,
    maxFixAttempts: 15,
  };

  const mockSite = {
    id: 'site-123',
    domain: 'example.com',
    documentRoot: '/var/www/html',
    wordpressPath: '/var/www/html/wp',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WordPressFixesService,
        {
          provide: FixPlaybookRegistryService,
          useValue: {
            getPlaybooksForTier: jest.fn(),
            getAllPlaybooks: jest.fn(),
            getPlaybookByName: jest.fn(),
          },
        },
        {
          provide: SSHService,
          useValue: {
            connect: jest.fn(),
            disconnect: jest.fn(),
            executeCommand: jest.fn(),
          },
        },
        {
          provide: BackupService,
          useValue: {
            createBackup: jest.fn(),
            restoreBackup: jest.fn(),
          },
        },
        {
          provide: VerificationService,
          useValue: {
            verifySiteHealth: jest.fn(),
            verifyWordPressCore: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<WordPressFixesService>(WordPressFixesService);
    registryService = module.get(FixPlaybookRegistryService);
    sshService = module.get(SSHService);
    backupService = module.get(BackupService);
    verificationService = module.get(VerificationService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('applyFixes', () => {
    it('should apply fixes in tier order', async () => {
      const tier1Playbook = { ...mockPlaybook, tier: FixTier.TIER_1_INFRASTRUCTURE };
      const tier2Playbook = { ...mockPlaybook, tier: FixTier.TIER_2_CORE_INTEGRITY, name: 'tier2-playbook' };

      registryService.getPlaybooksForTier
        .mockReturnValueOnce([tier1Playbook])
        .mockReturnValueOnce([tier2Playbook])
        .mockReturnValue([]);

      tier1Playbook.canApply.mockResolvedValue(true);
      tier1Playbook.apply.mockResolvedValue({
        success: true,
        message: 'Tier 1 fix applied',
        changes: [],
      });

      backupService.createBackup.mockResolvedValue({
        id: 'backup-123',
        path: '/backups/backup-123',
      });

      verificationService.verifySiteHealth.mockResolvedValue({
        healthy: true,
        issues: [],
      });

      const result = await service.applyFixes(mockIncident as any, mockSite as any);

      expect(result.success).toBe(true);
      expect(result.appliedFixes).toHaveLength(1);
      expect(result.appliedFixes[0].playbookName).toBe('test-playbook');
      expect(tier1Playbook.apply).toHaveBeenCalled();
    });

    it('should stop after successful fix and verification', async () => {
      const tier1Playbook = { ...mockPlaybook, tier: FixTier.TIER_1_INFRASTRUCTURE };
      const tier2Playbook = { ...mockPlaybook, tier: FixTier.TIER_2_CORE_INTEGRITY, name: 'tier2-playbook' };

      registryService.getPlaybooksForTier
        .mockReturnValueOnce([tier1Playbook])
        .mockReturnValueOnce([tier2Playbook]);

      tier1Playbook.canApply.mockResolvedValue(true);
      tier1Playbook.apply.mockResolvedValue({
        success: true,
        message: 'Fix applied successfully',
        changes: [],
      });

      backupService.createBackup.mockResolvedValue({
        id: 'backup-123',
        path: '/backups/backup-123',
      });

      verificationService.verifySiteHealth.mockResolvedValue({
        healthy: true,
        issues: [],
      });

      const result = await service.applyFixes(mockIncident as any, mockSite as any);

      expect(result.success).toBe(true);
      expect(result.appliedFixes).toHaveLength(1);
      expect(tier2Playbook.apply).not.toHaveBeenCalled();
    });

    it('should continue to next tier if verification fails', async () => {
      const tier1Playbook = { ...mockPlaybook, tier: FixTier.TIER_1_INFRASTRUCTURE };
      const tier2Playbook = { ...mockPlaybook, tier: FixTier.TIER_2_CORE_INTEGRITY, name: 'tier2-playbook' };

      registryService.getPlaybooksForTier
        .mockReturnValueOnce([tier1Playbook])
        .mockReturnValueOnce([tier2Playbook])
        .mockReturnValue([]);

      tier1Playbook.canApply.mockResolvedValue(true);
      tier1Playbook.apply.mockResolvedValue({
        success: true,
        message: 'Tier 1 fix applied',
        changes: [],
      });

      tier2Playbook.canApply.mockResolvedValue(true);
      tier2Playbook.apply.mockResolvedValue({
        success: true,
        message: 'Tier 2 fix applied',
        changes: [],
      });

      backupService.createBackup.mockResolvedValue({
        id: 'backup-123',
        path: '/backups/backup-123',
      });

      verificationService.verifySiteHealth
        .mockResolvedValueOnce({
          healthy: false,
          issues: ['Still has issues'],
        })
        .mockResolvedValueOnce({
          healthy: true,
          issues: [],
        });

      const result = await service.applyFixes(mockIncident as any, mockSite as any);

      expect(result.success).toBe(true);
      expect(result.appliedFixes).toHaveLength(2);
      expect(tier1Playbook.apply).toHaveBeenCalled();
      expect(tier2Playbook.apply).toHaveBeenCalled();
    });

    it('should skip playbooks that cannot be applied', async () => {
      const playbook1 = { ...mockPlaybook, name: 'playbook1' };
      const playbook2 = { ...mockPlaybook, name: 'playbook2' };

      registryService.getPlaybooksForTier
        .mockReturnValueOnce([playbook1, playbook2])
        .mockReturnValue([]);

      playbook1.canApply.mockResolvedValue(false);
      playbook2.canApply.mockResolvedValue(true);
      playbook2.apply.mockResolvedValue({
        success: true,
        message: 'Fix applied',
        changes: [],
      });

      backupService.createBackup.mockResolvedValue({
        id: 'backup-123',
        path: '/backups/backup-123',
      });

      verificationService.verifySiteHealth.mockResolvedValue({
        healthy: true,
        issues: [],
      });

      const result = await service.applyFixes(mockIncident as any, mockSite as any);

      expect(result.success).toBe(true);
      expect(result.appliedFixes).toHaveLength(1);
      expect(result.appliedFixes[0].playbookName).toBe('playbook2');
      expect(playbook1.apply).not.toHaveBeenCalled();
      expect(playbook2.apply).toHaveBeenCalled();
    });

    it('should handle playbook application failures', async () => {
      const playbook = { ...mockPlaybook };

      registryService.getPlaybooksForTier
        .mockReturnValueOnce([playbook])
        .mockReturnValue([]);

      playbook.canApply.mockResolvedValue(true);
      playbook.apply.mockResolvedValue({
        success: false,
        message: 'Fix failed',
        error: 'Something went wrong',
        changes: [],
      });

      backupService.createBackup.mockResolvedValue({
        id: 'backup-123',
        path: '/backups/backup-123',
      });

      const result = await service.applyFixes(mockIncident as any, mockSite as any);

      expect(result.success).toBe(false);
      expect(result.appliedFixes).toHaveLength(1);
      expect(result.appliedFixes[0].status).toBe(FixStatus.FAILED);
      expect(result.appliedFixes[0].error).toBe('Something went wrong');
    });

    it('should enforce maximum fix attempts', async () => {
      const incidentWithMaxAttempts = {
        ...mockIncident,
        fixAttempts: 15,
        maxFixAttempts: 15,
      };

      const result = await service.applyFixes(incidentWithMaxAttempts as any, mockSite as any);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Maximum fix attempts');
      expect(result.appliedFixes).toHaveLength(0);
    });

    it('should create backup before applying fixes', async () => {
      const playbook = { ...mockPlaybook };

      registryService.getPlaybooksForTier
        .mockReturnValueOnce([playbook])
        .mockReturnValue([]);

      playbook.canApply.mockResolvedValue(true);
      playbook.apply.mockResolvedValue({
        success: true,
        message: 'Fix applied',
        changes: [],
      });

      backupService.createBackup.mockResolvedValue({
        id: 'backup-123',
        path: '/backups/backup-123',
      });

      verificationService.verifySiteHealth.mockResolvedValue({
        healthy: true,
        issues: [],
      });

      await service.applyFixes(mockIncident as any, mockSite as any);

      expect(backupService.createBackup).toHaveBeenCalledWith(
        mockIncident.id,
        mockSite.wordpressPath,
        'pre-fix-backup'
      );
    });
  });

  describe('rollbackFix', () => {
    it('should rollback specific fix', async () => {
      const fixResult: FixResult = {
        playbookName: 'test-playbook',
        status: FixStatus.SUCCESS,
        message: 'Fix applied',
        appliedAt: new Date(),
        changes: [],
        backupId: 'backup-123',
      };

      registryService.getPlaybookByName.mockReturnValue(mockPlaybook);
      mockPlaybook.rollback.mockResolvedValue({
        success: true,
        message: 'Rollback successful',
      });

      backupService.restoreBackup.mockResolvedValue({
        success: true,
        restoredFiles: ['file1.php', 'file2.php'],
      });

      const result = await service.rollbackFix(mockIncident as any, mockSite as any, fixResult);

      expect(result.success).toBe(true);
      expect(mockPlaybook.rollback).toHaveBeenCalled();
      expect(backupService.restoreBackup).toHaveBeenCalledWith('backup-123');
    });

    it('should handle rollback failures', async () => {
      const fixResult: FixResult = {
        playbookName: 'test-playbook',
        status: FixStatus.SUCCESS,
        message: 'Fix applied',
        appliedAt: new Date(),
        changes: [],
        backupId: 'backup-123',
      };

      registryService.getPlaybookByName.mockReturnValue(mockPlaybook);
      mockPlaybook.rollback.mockResolvedValue({
        success: false,
        message: 'Rollback failed',
        error: 'Cannot restore files',
      });

      const result = await service.rollbackFix(mockIncident as any, mockSite as any, fixResult);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Cannot restore files');
    });

    it('should handle missing playbook', async () => {
      const fixResult: FixResult = {
        playbookName: 'non-existent-playbook',
        status: FixStatus.SUCCESS,
        message: 'Fix applied',
        appliedAt: new Date(),
        changes: [],
        backupId: 'backup-123',
      };

      registryService.getPlaybookByName.mockReturnValue(null);

      const result = await service.rollbackFix(mockIncident as any, mockSite as any, fixResult);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Playbook not found');
    });
  });

  describe('getAvailableFixes', () => {
    it('should return all available playbooks grouped by tier', () => {
      const tier1Playbooks = [
        { ...mockPlaybook, name: 'disk-cleanup', tier: FixTier.TIER_1_INFRASTRUCTURE },
        { ...mockPlaybook, name: 'memory-fix', tier: FixTier.TIER_1_INFRASTRUCTURE },
      ];

      const tier2Playbooks = [
        { ...mockPlaybook, name: 'core-integrity', tier: FixTier.TIER_2_CORE_INTEGRITY },
      ];

      registryService.getAllPlaybooks.mockReturnValue([
        ...tier1Playbooks,
        ...tier2Playbooks,
      ]);

      const result = service.getAvailableFixes();

      expect(result).toEqual({
        [FixTier.TIER_1_INFRASTRUCTURE]: tier1Playbooks,
        [FixTier.TIER_2_CORE_INTEGRITY]: tier2Playbooks,
        [FixTier.TIER_3_PLUGIN_THEME_CONFLICTS]: [],
        [FixTier.TIER_4_CACHE_FLUSH]: [],
        [FixTier.TIER_5_DEPENDENCY_REPAIR]: [],
        [FixTier.TIER_6_COMPONENT_ROLLBACK]: [],
      });
    });

    it('should handle empty playbook registry', () => {
      registryService.getAllPlaybooks.mockReturnValue([]);

      const result = service.getAvailableFixes();

      expect(result).toEqual({
        [FixTier.TIER_1_INFRASTRUCTURE]: [],
        [FixTier.TIER_2_CORE_INTEGRITY]: [],
        [FixTier.TIER_3_PLUGIN_THEME_CONFLICTS]: [],
        [FixTier.TIER_4_CACHE_FLUSH]: [],
        [FixTier.TIER_5_DEPENDENCY_REPAIR]: [],
        [FixTier.TIER_6_COMPONENT_ROLLBACK]: [],
      });
    });
  });

  describe('validateFixEligibility', () => {
    it('should return eligible when fix attempts are within limit', () => {
      const incident = { ...mockIncident, fixAttempts: 5, maxFixAttempts: 15 };

      const result = service.validateFixEligibility(incident as any);

      expect(result.eligible).toBe(true);
      expect(result.reason).toBeUndefined();
      expect(result.remainingAttempts).toBe(10);
    });

    it('should return ineligible when fix attempts exceed limit', () => {
      const incident = { ...mockIncident, fixAttempts: 15, maxFixAttempts: 15 };

      const result = service.validateFixEligibility(incident as any);

      expect(result.eligible).toBe(false);
      expect(result.reason).toContain('Maximum fix attempts');
      expect(result.remainingAttempts).toBe(0);
    });

    it('should return ineligible when incident is already resolved', () => {
      const incident = { ...mockIncident, resolvedAt: new Date() };

      const result = service.validateFixEligibility(incident as any);

      expect(result.eligible).toBe(false);
      expect(result.reason).toContain('already resolved');
    });

    it('should return ineligible when incident is escalated', () => {
      const incident = { ...mockIncident, escalatedAt: new Date() };

      const result = service.validateFixEligibility(incident as any);

      expect(result.eligible).toBe(false);
      expect(result.reason).toContain('already escalated');
    });
  });

  describe('getFixHistory', () => {
    it('should return fix history for incident', async () => {
      const mockHistory = [
        {
          id: 'fix-1',
          playbookName: 'disk-cleanup',
          status: FixStatus.SUCCESS,
          appliedAt: new Date(),
          message: 'Disk cleanup successful',
        },
        {
          id: 'fix-2',
          playbookName: 'memory-fix',
          status: FixStatus.FAILED,
          appliedAt: new Date(),
          message: 'Memory fix failed',
          error: 'Insufficient permissions',
        },
      ];

      // Mock the database call (this would typically go through a repository)
      jest.spyOn(service as any, 'getFixHistoryFromDatabase').mockResolvedValue(mockHistory);

      const result = await service.getFixHistory(mockIncident.id);

      expect(result).toEqual(mockHistory);
    });

    it('should return empty array when no fix history exists', async () => {
      jest.spyOn(service as any, 'getFixHistoryFromDatabase').mockResolvedValue([]);

      const result = await service.getFixHistory(mockIncident.id);

      expect(result).toEqual([]);
    });
  });

  describe('estimateFixDuration', () => {
    it('should estimate duration based on playbook complexity', () => {
      const tier1Playbooks = [
        { ...mockPlaybook, tier: FixTier.TIER_1_INFRASTRUCTURE },
      ];

      const tier3Playbooks = [
        { ...mockPlaybook, tier: FixTier.TIER_3_PLUGIN_THEME_CONFLICTS },
      ];

      registryService.getPlaybooksForTier
        .mockReturnValueOnce(tier1Playbooks)
        .mockReturnValueOnce([])
        .mockReturnValueOnce(tier3Playbooks);

      const result = service.estimateFixDuration(mockSite as any);

      expect(result.estimatedMinutes).toBeGreaterThan(0);
      expect(result.breakdown).toBeDefined();
      expect(result.breakdown[FixTier.TIER_1_INFRASTRUCTURE]).toBeGreaterThan(0);
      expect(result.breakdown[FixTier.TIER_3_PLUGIN_THEME_CONFLICTS]).toBeGreaterThan(0);
    });

    it('should return zero duration when no applicable playbooks', () => {
      registryService.getPlaybooksForTier.mockReturnValue([]);

      const result = service.estimateFixDuration(mockSite as any);

      expect(result.estimatedMinutes).toBe(0);
      expect(Object.values(result.breakdown).every(duration => duration === 0)).toBe(true);
    });
  });
});