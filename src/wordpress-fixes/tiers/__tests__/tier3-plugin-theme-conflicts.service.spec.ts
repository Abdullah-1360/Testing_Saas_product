import { Test, TestingModule } from '@nestjs/testing';
import { Tier3PluginThemeConflictsService } from '../tier3-plugin-theme-conflicts.service';
import { FixPlaybookRegistry } from '../../fix-playbook-registry.service';
import { PluginConflictDetectionService } from '../../playbooks/plugin-conflict-detection.service';
import { ThemeSwitchingService } from '../../playbooks/theme-switching.service';
import { PluginDeactivationService } from '../../playbooks/plugin-deactivation.service';
import { ThemeRollbackService } from '../../playbooks/theme-rollback.service';
import { FixTier, FixContext, FixEvidence } from '../../interfaces/fix-playbook.interface';

describe('Tier3PluginThemeConflictsService', () => {
  let service: Tier3PluginThemeConflictsService;
  let mockPlaybookRegistry: jest.Mocked<FixPlaybookRegistry>;
  let mockPluginConflictDetection: jest.Mocked<PluginConflictDetectionService>;
  let mockThemeSwitching: jest.Mocked<ThemeSwitchingService>;
  let mockPluginDeactivation: jest.Mocked<PluginDeactivationService>;
  let mockThemeRollback: jest.Mocked<ThemeRollbackService>;

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

  const mockEvidence: FixEvidence[] = [
    {
      type: 'log',
      description: 'Plugin error in logs',
      content: 'Fatal error in wp-content/plugins/problematic-plugin/plugin.php',
      signature: 'plugin-error-sig',
      timestamp: new Date(),
    },
  ];

  beforeEach(async () => {
    const mockPlaybookRegistryProvider = {
      provide: FixPlaybookRegistry,
      useValue: {
        registerPlaybook: jest.fn(),
        getPlaybooksForTier: jest.fn(),
        getApplicablePlaybooks: jest.fn(),
        getPlaybook: jest.fn(),
        getStats: jest.fn(),
      },
    };

    const mockPluginConflictDetectionProvider = {
      provide: PluginConflictDetectionService,
      useValue: {
        name: 'Plugin Conflict Detection',
        tier: FixTier.TIER_3_PLUGIN_THEME_CONFLICTS,
        canApply: jest.fn(),
        apply: jest.fn(),
        getHypothesis: jest.fn(),
      },
    };

    const mockThemeSwitchingProvider = {
      provide: ThemeSwitchingService,
      useValue: {
        name: 'Theme Switching for Conflict Resolution',
        tier: FixTier.TIER_3_PLUGIN_THEME_CONFLICTS,
        canApply: jest.fn(),
        apply: jest.fn(),
        getHypothesis: jest.fn(),
      },
    };

    const mockPluginDeactivationProvider = {
      provide: PluginDeactivationService,
      useValue: {
        name: 'Plugin Deactivation with Backup',
        tier: FixTier.TIER_3_PLUGIN_THEME_CONFLICTS,
        canApply: jest.fn(),
        apply: jest.fn(),
        getHypothesis: jest.fn(),
      },
    };

    const mockThemeRollbackProvider = {
      provide: ThemeRollbackService,
      useValue: {
        name: 'Theme Rollback Functionality',
        tier: FixTier.TIER_3_PLUGIN_THEME_CONFLICTS,
        canApply: jest.fn(),
        apply: jest.fn(),
        getHypothesis: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        Tier3PluginThemeConflictsService,
        mockPlaybookRegistryProvider,
        mockPluginConflictDetectionProvider,
        mockThemeSwitchingProvider,
        mockPluginDeactivationProvider,
        mockThemeRollbackProvider,
      ],
    }).compile();

    service = module.get<Tier3PluginThemeConflictsService>(Tier3PluginThemeConflictsService);
    mockPlaybookRegistry = module.get(FixPlaybookRegistry);
    mockPluginConflictDetection = module.get(PluginConflictDetectionService);
    mockThemeSwitching = module.get(ThemeSwitchingService);
    mockPluginDeactivation = module.get(PluginDeactivationService);
    mockThemeRollback = module.get(ThemeRollbackService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('onModuleInit', () => {
    it('should register all Tier 3 playbooks', () => {
      service.onModuleInit();

      expect(mockPlaybookRegistry.registerPlaybook).toHaveBeenCalledWith(mockPluginConflictDetection);
      expect(mockPlaybookRegistry.registerPlaybook).toHaveBeenCalledWith(mockPluginDeactivation);
      expect(mockPlaybookRegistry.registerPlaybook).toHaveBeenCalledWith(mockThemeSwitching);
      expect(mockPlaybookRegistry.registerPlaybook).toHaveBeenCalledWith(mockThemeRollback);
      expect(mockPlaybookRegistry.registerPlaybook).toHaveBeenCalledTimes(4);
    });
  });

  describe('executeTier3Fixes', () => {
    it('should execute applicable Tier 3 playbooks in order', async () => {
      const mockPlaybooks = [
        mockPluginConflictDetection,
        mockPluginDeactivation,
      ];

      mockPlaybookRegistry.getPlaybooksForTier.mockReturnValue(mockPlaybooks);
      mockPluginConflictDetection.canApply.mockResolvedValue(true);
      mockPluginConflictDetection.getHypothesis.mockReturnValue('Plugin conflict detected');
      mockPluginConflictDetection.apply.mockResolvedValue({
        success: true,
        applied: true,
        changes: [],
        evidence: [],
      });

      const results = await service.executeTier3Fixes(mockContext, mockEvidence);

      expect(mockPlaybookRegistry.getPlaybooksForTier).toHaveBeenCalledWith(FixTier.TIER_3_PLUGIN_THEME_CONFLICTS);
      expect(mockPluginConflictDetection.canApply).toHaveBeenCalledWith(mockContext, mockEvidence);
      expect(mockPluginConflictDetection.apply).toHaveBeenCalledWith(mockContext);
      expect(results).toHaveLength(1);
      expect(results[0]?.success).toBe(true);
      expect(results[0]?.applied).toBe(true);
    });

    it('should skip non-applicable playbooks', async () => {
      const mockPlaybooks = [mockPluginConflictDetection];

      mockPlaybookRegistry.getPlaybooksForTier.mockReturnValue(mockPlaybooks);
      mockPluginConflictDetection.canApply.mockResolvedValue(false);

      const results = await service.executeTier3Fixes(mockContext, mockEvidence);

      expect(mockPluginConflictDetection.canApply).toHaveBeenCalledWith(mockContext, mockEvidence);
      expect(mockPluginConflictDetection.apply).not.toHaveBeenCalled();
      expect(results).toHaveLength(0);
    });

    it('should stop after first successful fix (conservative approach)', async () => {
      const mockPlaybooks = [
        mockPluginConflictDetection,
        mockPluginDeactivation,
      ];

      mockPlaybookRegistry.getPlaybooksForTier.mockReturnValue(mockPlaybooks);
      
      // First playbook succeeds
      mockPluginConflictDetection.canApply.mockResolvedValue(true);
      mockPluginConflictDetection.getHypothesis.mockReturnValue('Plugin conflict detected');
      mockPluginConflictDetection.apply.mockResolvedValue({
        success: true,
        applied: true,
        changes: [],
        evidence: [],
      });

      // Second playbook should not be called
      mockPluginDeactivation.canApply.mockResolvedValue(true);

      const results = await service.executeTier3Fixes(mockContext, mockEvidence);

      expect(mockPluginConflictDetection.apply).toHaveBeenCalled();
      expect(mockPluginDeactivation.canApply).not.toHaveBeenCalled();
      expect(results).toHaveLength(1);
    });

    it('should handle playbook errors gracefully', async () => {
      const mockPlaybooks = [mockPluginConflictDetection];

      mockPlaybookRegistry.getPlaybooksForTier.mockReturnValue(mockPlaybooks);
      mockPluginConflictDetection.canApply.mockResolvedValue(true);
      mockPluginConflictDetection.getHypothesis.mockReturnValue('Plugin conflict detected');
      mockPluginConflictDetection.apply.mockRejectedValue(new Error('Playbook execution failed'));

      const results = await service.executeTier3Fixes(mockContext, mockEvidence);

      expect(results).toHaveLength(1);
      expect(results[0]?.success).toBe(false);
      expect(results[0]?.error).toBe('Playbook execution failed');
    });
  });

  describe('getApplicableTier3Playbooks', () => {
    it('should return names of applicable playbooks', async () => {
      const mockApplicablePlaybooks = [
        { name: 'Plugin Conflict Detection' },
        { name: 'Theme Switching for Conflict Resolution' },
      ];

      mockPlaybookRegistry.getApplicablePlaybooks.mockResolvedValue(mockApplicablePlaybooks as any);

      const result = await service.getApplicableTier3Playbooks(mockContext, mockEvidence);

      expect(mockPlaybookRegistry.getApplicablePlaybooks).toHaveBeenCalledWith(
        mockContext,
        mockEvidence,
        FixTier.TIER_3_PLUGIN_THEME_CONFLICTS
      );
      expect(result).toEqual(['Plugin Conflict Detection', 'Theme Switching for Conflict Resolution']);
    });
  });

  describe('getTier3Stats', () => {
    it('should return Tier 3 playbook statistics', () => {
      const mockTier3Playbooks = [
        { name: 'Plugin Conflict Detection' },
        { name: 'Theme Switching for Conflict Resolution' },
        { name: 'Plugin Deactivation with Backup' },
        { name: 'Theme Rollback Functionality' },
      ];

      mockPlaybookRegistry.getPlaybooksForTier.mockReturnValue(mockTier3Playbooks as any);

      const stats = service.getTier3Stats();

      expect(mockPlaybookRegistry.getPlaybooksForTier).toHaveBeenCalledWith(FixTier.TIER_3_PLUGIN_THEME_CONFLICTS);
      expect(stats.totalPlaybooks).toBe(4);
      expect(stats.playbookNames).toEqual([
        'Plugin Conflict Detection',
        'Theme Switching for Conflict Resolution',
        'Plugin Deactivation with Backup',
        'Theme Rollback Functionality',
      ]);
    });
  });

  describe('executeSpecificPlaybook', () => {
    it('should execute a specific Tier 3 playbook by name', async () => {
      const playbookName = 'Plugin Conflict Detection';
      
      mockPlaybookRegistry.getPlaybook.mockReturnValue(mockPluginConflictDetection as any);
      mockPluginConflictDetection.canApply.mockResolvedValue(true);
      mockPluginConflictDetection.getHypothesis.mockReturnValue('Plugin conflict detected');
      mockPluginConflictDetection.apply.mockResolvedValue({
        success: true,
        applied: true,
        changes: [],
        evidence: [],
      });

      const result = await service.executeSpecificPlaybook(playbookName, mockContext, mockEvidence);

      expect(mockPlaybookRegistry.getPlaybook).toHaveBeenCalledWith(playbookName);
      expect(mockPluginConflictDetection.canApply).toHaveBeenCalledWith(mockContext, mockEvidence);
      expect(mockPluginConflictDetection.apply).toHaveBeenCalledWith(mockContext);
      expect(result?.success).toBe(true);
      expect(result?.applied).toBe(true);
    });

    it('should return null for non-existent playbook', async () => {
      mockPlaybookRegistry.getPlaybook.mockReturnValue(undefined);

      const result = await service.executeSpecificPlaybook('Non-existent Playbook', mockContext, mockEvidence);

      expect(result).toBeNull();
    });

    it('should return error result for non-applicable playbook', async () => {
      const playbookName = 'Plugin Conflict Detection';
      
      mockPlaybookRegistry.getPlaybook.mockReturnValue(mockPluginConflictDetection as any);
      mockPluginConflictDetection.canApply.mockResolvedValue(false);

      const result = await service.executeSpecificPlaybook(playbookName, mockContext, mockEvidence);

      expect(result?.success).toBe(false);
      expect(result?.applied).toBe(false);
      expect(result?.error).toBe('Playbook not applicable for current context');
    });
  });

  describe('validateTier3Prerequisites', () => {
    it('should validate all prerequisites successfully', async () => {
      // Mock successful validation
      jest.spyOn(service as any, 'checkPluginsDirectory').mockResolvedValue({
        exists: true,
        evidence: [{ type: 'system_info', description: 'Plugins dir check', content: '{}', signature: 'sig', timestamp: new Date() }],
      });
      
      jest.spyOn(service as any, 'checkThemesDirectory').mockResolvedValue({
        exists: true,
        evidence: [{ type: 'system_info', description: 'Themes dir check', content: '{}', signature: 'sig', timestamp: new Date() }],
      });
      
      jest.spyOn(service as any, 'checkWordPressAccess').mockResolvedValue({
        accessible: true,
        evidence: [{ type: 'command_output', description: 'WP access check', content: 'accessible', signature: 'sig', timestamp: new Date() }],
      });
      
      jest.spyOn(service as any, 'checkPluginThemePermissions').mockResolvedValue({
        adequate: true,
        evidence: [{ type: 'command_output', description: 'Permissions check', content: 'adequate', signature: 'sig', timestamp: new Date() }],
      });

      const result = await service.validateTier3Prerequisites(mockContext);

      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
      expect(result.evidence).toHaveLength(4);
    });

    it('should identify missing prerequisites', async () => {
      // Mock failed validation
      jest.spyOn(service as any, 'checkPluginsDirectory').mockResolvedValue({
        exists: false,
        evidence: [],
      });
      
      jest.spyOn(service as any, 'checkThemesDirectory').mockResolvedValue({
        exists: false,
        evidence: [],
      });
      
      jest.spyOn(service as any, 'checkWordPressAccess').mockResolvedValue({
        accessible: false,
        evidence: [],
      });
      
      jest.spyOn(service as any, 'checkPluginThemePermissions').mockResolvedValue({
        adequate: false,
        evidence: [],
      });

      const result = await service.validateTier3Prerequisites(mockContext);

      expect(result.valid).toBe(false);
      expect(result.issues).toContain('WordPress plugins directory not found');
      expect(result.issues).toContain('WordPress themes directory not found');
      expect(result.issues).toContain('WordPress CLI or admin functions not accessible');
      expect(result.issues).toContain('Insufficient permissions for plugin/theme management');
    });
  });
});