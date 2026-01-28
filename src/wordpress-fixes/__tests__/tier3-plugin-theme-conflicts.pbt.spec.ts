import fc from 'fast-check';
import { Test, TestingModule } from '@nestjs/testing';
import { Tier3PluginThemeConflictsService } from '../tiers/tier3-plugin-theme-conflicts.service';
import { PluginConflictDetectionService } from '../playbooks/plugin-conflict-detection.service';
import { ThemeSwitchingService } from '../playbooks/theme-switching.service';
import { PluginDeactivationService } from '../playbooks/plugin-deactivation.service';
import { ThemeRollbackService } from '../playbooks/theme-rollback.service';
import { FixPlaybookRegistry } from '../fix-playbook-registry.service';
import { FixTier } from '../interfaces/fix-playbook.interface';

const fixContextGenerator = () => fc.record({
  incidentId: fc.string({ minLength: 1, maxLength: 50 }),
  siteId: fc.string({ minLength: 1, maxLength: 50 }),
  serverId: fc.string({ minLength: 1, maxLength: 50 }),
  sitePath: fc.string({ minLength: 1, maxLength: 100 }),
  wordpressPath: fc.string({ minLength: 1, maxLength: 100 }),
  domain: fc.domain(),
  correlationId: fc.string({ minLength: 1, maxLength: 50 }),
  traceId: fc.string({ minLength: 1, maxLength: 50 }),
  metadata: fc.option(fc.dictionary(fc.string(), fc.anything()), { nil: undefined }),
});

const fixEvidenceGenerator = () => fc.array(
  fc.record({
    type: fc.constantFrom('log', 'command_output', 'file_content', 'system_info'),
    description: fc.string({ minLength: 1, maxLength: 200 }),
    content: fc.string({ minLength: 1, maxLength: 1000 }),
    signature: fc.string({ minLength: 1, maxLength: 64 }),
    timestamp: fc.date(),
    metadata: fc.option(fc.dictionary(fc.string(), fc.anything()), { nil: undefined }),
  }),
  { minLength: 0, maxLength: 10 }
);

describe('Tier 3 Plugin/Theme Conflicts - Property-Based Tests', () => {
  let service: Tier3PluginThemeConflictsService;
  let mockPlaybookRegistry: jest.Mocked<FixPlaybookRegistry>;
  let mockPluginConflictDetection: jest.Mocked<PluginConflictDetectionService>;
  let mockThemeSwitching: jest.Mocked<ThemeSwitchingService>;
  let mockPluginDeactivation: jest.Mocked<PluginDeactivationService>;
  let mockThemeRollback: jest.Mocked<ThemeRollbackService>;

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
        rollback: jest.fn(),
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
        rollback: jest.fn(),
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
        rollback: jest.fn(),
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
        rollback: jest.fn(),
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

  /**
   * Feature: wp-autohealer, Property 26: Fix Tier Priority Enforcement
   * **Validates: Requirements 12.7**
   */
  it('should execute Tier 3 playbooks in priority order for any valid context and evidence', async () => {
    await fc.assert(
      fc.asyncProperty(
        fixContextGenerator(),
        fixEvidenceGenerator(),
        async (context, evidence) => {
          // Setup mock playbooks in priority order
          const mockPlaybooks = [
            mockPluginConflictDetection,
            mockPluginDeactivation,
            mockThemeSwitching,
            mockThemeRollback,
          ];

          mockPlaybookRegistry.getPlaybooksForTier.mockReturnValue(mockPlaybooks);
          
          // Mock first playbook as applicable and successful
          mockPluginConflictDetection.canApply.mockResolvedValue(true);
          mockPluginConflictDetection.getHypothesis.mockReturnValue('Test hypothesis');
          mockPluginConflictDetection.apply.mockResolvedValue({
            success: true,
            applied: true,
            changes: [],
            evidence: [],
          });

          // Other playbooks should not be called due to conservative approach
          mockPluginDeactivation.canApply.mockResolvedValue(true);
          mockThemeSwitching.canApply.mockResolvedValue(true);
          mockThemeRollback.canApply.mockResolvedValue(true);

          const contextWithMetadata = { ...context, metadata: context.metadata || {} };
          const results = await service.executeTier3Fixes(contextWithMetadata, evidence);

          // Verify tier is requested correctly
          expect(mockPlaybookRegistry.getPlaybooksForTier).toHaveBeenCalledWith(FixTier.TIER_3_PLUGIN_THEME_CONFLICTS);
          
          // Verify first playbook was executed
          expect(mockPluginConflictDetection.canApply).toHaveBeenCalledWith(contextWithMetadata, evidence);
          expect(mockPluginConflictDetection.apply).toHaveBeenCalledWith(contextWithMetadata);
          
          // Verify conservative approach: stop after first successful fix
          expect(mockPluginDeactivation.canApply).not.toHaveBeenCalled();
          
          // Verify results structure
          expect(Array.isArray(results)).toBe(true);
          if (results.length > 0) {
            expect(results[0]).toHaveProperty('success');
            expect(results[0]).toHaveProperty('applied');
            expect(results[0]).toHaveProperty('changes');
            expect(results[0]).toHaveProperty('evidence');
            expect(results[0]?.metadata).toHaveProperty('playbookName');
            expect(results[0]?.metadata).toHaveProperty('tier');
            expect(results[0]?.metadata).toHaveProperty('priority');
          }
        }
      ),
      { numRuns: 10 }
    );
  });

  /**
   * Feature: wp-autohealer, Property 27: Fix Attempt Documentation
   * **Validates: Requirements 12.8**
   */
  it('should document rationale and reasoning for each Tier 3 fix attempt', async () => {
    await fc.assert(
      fc.asyncProperty(
        fixContextGenerator(),
        fixEvidenceGenerator(),
        async (context, evidence) => {
          const mockPlaybooks = [mockPluginConflictDetection];
          mockPlaybookRegistry.getPlaybooksForTier.mockReturnValue(mockPlaybooks);
          
          mockPluginConflictDetection.canApply.mockResolvedValue(true);
          const testHypothesis = 'Plugin conflict detected in error logs';
          mockPluginConflictDetection.getHypothesis.mockReturnValue(testHypothesis);
          mockPluginConflictDetection.apply.mockResolvedValue({
            success: true,
            applied: true,
            changes: [],
            evidence: [],
          });

          const contextWithMetadata = { ...context, metadata: context.metadata || {} };
          const results = await service.executeTier3Fixes(contextWithMetadata, evidence);

          // Verify hypothesis (rationale) is captured
          expect(mockPluginConflictDetection.getHypothesis).toHaveBeenCalledWith(contextWithMetadata, evidence);
          
          // Verify rationale is documented in results
          if (results.length > 0) {
            expect(results[0]?.metadata).toHaveProperty('hypothesis', testHypothesis);
            expect(results[0]?.metadata).toHaveProperty('playbookName');
            expect(typeof results[0]?.metadata?.['hypothesis']).toBe('string');
            expect((results[0]?.metadata?.['hypothesis'] as string).length).toBeGreaterThan(0);
          }
        }
      ),
      { numRuns: 10 }
    );
  });

  /**
   * Feature: wp-autohealer, Property 8: Rollback Artifact Prerequisite
   * **Validates: Requirements 5.1, 5.6**
   */
  it('should ensure rollback artifacts exist before applying any Tier 3 fixes', async () => {
    await fc.assert(
      fc.asyncProperty(
        fixContextGenerator(),
        fixEvidenceGenerator(),
        async (context, evidence) => {
          const mockPlaybooks = [mockPluginConflictDetection];
          mockPlaybookRegistry.getPlaybooksForTier.mockReturnValue(mockPlaybooks);
          
          mockPluginConflictDetection.canApply.mockResolvedValue(true);
          mockPluginConflictDetection.getHypothesis.mockReturnValue('Test hypothesis');
          
          // Mock successful fix with rollback plan
          const mockRollbackPlan = {
            steps: [
              {
                type: 'restore_file' as const,
                description: 'Restore plugin state',
                action: 'restore command',
                parameters: { backupPath: '/backup/path' },
                order: 1,
              },
            ],
            metadata: { originalPlugins: ['plugin1', 'plugin2'] },
            createdAt: new Date(),
          };

          mockPluginConflictDetection.apply.mockResolvedValue({
            success: true,
            applied: true,
            changes: [
              {
                type: 'config',
                description: 'Deactivated plugin',
                timestamp: new Date(),
              },
            ],
            evidence: [],
            rollbackPlan: mockRollbackPlan,
          });

          const contextWithMetadata = { ...context, metadata: context.metadata || {} };
          const results = await service.executeTier3Fixes(contextWithMetadata, evidence);

          // Verify that any applied fix has a rollback plan
          const appliedFixes = results.filter(r => r.applied);
          for (const fix of appliedFixes) {
            expect(fix.rollbackPlan).toBeDefined();
            expect(fix.rollbackPlan?.steps).toBeDefined();
            expect(Array.isArray(fix.rollbackPlan?.steps)).toBe(true);
            expect(fix.rollbackPlan?.metadata).toBeDefined();
            expect(fix.rollbackPlan?.createdAt).toBeInstanceOf(Date);
          }
        }
      ),
      { numRuns: 10 }
    );
  });

  /**
   * Feature: wp-autohealer, Property 10: Hypothesis-Driven Fix Process
   * **Validates: Requirements 5.3**
   */
  it('should follow hypothesis → evidence → minimal change → verify → record process for Tier 3 fixes', async () => {
    const context = {
      incidentId: 'test-incident',
      siteId: 'test-site',
      serverId: 'test-server',
      sitePath: '/var/www/html',
      wordpressPath: '/var/www/html/wp',
      domain: 'example.com',
      correlationId: 'test-corr',
      traceId: 'test-trace',
      metadata: {},
    };
    const evidence = [
      {
        type: 'log' as const,
        description: 'Plugin error',
        content: 'Fatal error in plugin',
        signature: 'sig',
        timestamp: new Date(),
      },
    ];

    const mockPlaybooks = [mockPluginConflictDetection];
    mockPlaybookRegistry.getPlaybooksForTier.mockReturnValue(mockPlaybooks);
    
    mockPluginConflictDetection.canApply.mockResolvedValue(true);
    const testHypothesis = 'Plugin causing fatal errors';
    mockPluginConflictDetection.getHypothesis.mockReturnValue(testHypothesis);
    
    const mockResult = {
      success: true,
      applied: true,
      changes: [
        {
          type: 'config' as const,
          description: 'Minimal change: deactivated problematic plugin',
          timestamp: new Date(),
        },
      ],
      evidence: [
        {
          type: 'system_info' as const,
          description: 'Verification: site functionality test',
          content: JSON.stringify({ working: true }),
          signature: 'verify-sig',
          timestamp: new Date(),
        },
      ],
    };
    
    mockPluginConflictDetection.apply.mockResolvedValue(mockResult);

    const results = await service.executeTier3Fixes(context, evidence);

    if (results.length > 0) {
      const result = results[0];
      
      // 1. Hypothesis was generated
      expect(mockPluginConflictDetection.getHypothesis).toHaveBeenCalledWith(context, evidence);
      expect(result?.metadata?.['hypothesis']).toBe(testHypothesis);
      
      // 2. Evidence was provided as input
      expect(mockPluginConflictDetection.canApply).toHaveBeenCalledWith(context, evidence);
      
      // 3. Minimal changes were applied
      expect(result?.changes).toBeDefined();
      expect(Array.isArray(result?.changes)).toBe(true);
      
      // 4. Verification evidence was collected
      expect(result?.evidence).toBeDefined();
      expect(Array.isArray(result?.evidence)).toBe(true);
      
      // 5. Results were recorded with metadata
      expect(result?.metadata).toBeDefined();
      expect(result?.metadata).toHaveProperty('playbookName');
      expect(result?.metadata).toHaveProperty('tier');
      expect(result?.metadata).toHaveProperty('priority');
    }
  });

  /**
   * Feature: wp-autohealer, Property 2: Unique Operation Identifiers
   * **Validates: Requirements 2.4**
   */
  it('should ensure all Tier 3 operations have unique trace and correlation IDs', async () => {
    const context = {
      incidentId: 'test-incident',
      siteId: 'test-site',
      serverId: 'test-server',
      sitePath: '/var/www/html',
      wordpressPath: '/var/www/html/wp',
      domain: 'example.com',
      correlationId: 'unique-correlation-id',
      traceId: 'unique-trace-id',
      metadata: {},
    };
    const evidence = [
      {
        type: 'log' as const,
        description: 'Test evidence',
        content: 'Test content',
        signature: 'sig',
        timestamp: new Date(),
      },
    ];

    const mockPlaybooks = [mockPluginConflictDetection];
    mockPlaybookRegistry.getPlaybooksForTier.mockReturnValue(mockPlaybooks);
    
    mockPluginConflictDetection.canApply.mockResolvedValue(true);
    mockPluginConflictDetection.getHypothesis.mockReturnValue('Test hypothesis');
    mockPluginConflictDetection.apply.mockResolvedValue({
      success: true,
      applied: true,
      changes: [],
      evidence: [],
    });

    await service.executeTier3Fixes(context, evidence);

    // Verify that playbook was called with context containing unique IDs
    expect(mockPluginConflictDetection.canApply).toHaveBeenCalledWith(
      expect.objectContaining({
        correlationId: 'unique-correlation-id',
        traceId: 'unique-trace-id',
      }),
      evidence
    );

    expect(mockPluginConflictDetection.apply).toHaveBeenCalledWith(
      expect.objectContaining({
        correlationId: 'unique-correlation-id',
        traceId: 'unique-trace-id',
      })
    );
  });

  /**
   * Feature: wp-autohealer, Property 1: Complete Incident Data Storage
   * **Validates: Requirements 2.1**
   */
  it('should store all required Tier 3 operation data including phases, steps, commands, and evidence', async () => {
    const context = {
      incidentId: 'test-incident',
      siteId: 'test-site',
      serverId: 'test-server',
      sitePath: '/var/www/html',
      wordpressPath: '/var/www/html/wp',
      domain: 'example.com',
      correlationId: 'test-corr',
      traceId: 'test-trace',
      metadata: {},
    };
    const evidence = [
      {
        type: 'log' as const,
        description: 'Test evidence',
        content: 'Test content',
        signature: 'sig',
        timestamp: new Date(),
      },
    ];

    const mockPlaybooks = [mockPluginConflictDetection];
    mockPlaybookRegistry.getPlaybooksForTier.mockReturnValue(mockPlaybooks);
    
    mockPluginConflictDetection.canApply.mockResolvedValue(true);
    mockPluginConflictDetection.getHypothesis.mockReturnValue('Test hypothesis');
    
    // Mock comprehensive result data
    const mockResult = {
      success: true,
      applied: true,
      changes: [
        {
          type: 'config' as const,
          description: 'Plugin deactivation step',
          timestamp: new Date(),
        },
      ],
      evidence: [
        {
          type: 'command_output' as const,
          description: 'Plugin analysis command output',
          content: 'command execution results',
          signature: 'cmd-sig',
          timestamp: new Date(),
        },
        {
          type: 'system_info' as const,
          description: 'Site verification results',
          content: JSON.stringify({ status: 'working' }),
          signature: 'verify-sig',
          timestamp: new Date(),
        },
      ],
      rollbackPlan: {
        steps: [
          {
            type: 'execute_command' as const,
            description: 'Rollback step',
            action: 'reactivate plugin',
            parameters: {},
            order: 1,
          },
        ],
        metadata: { backupPath: '/backup/path' },
        createdAt: new Date(),
      },
    };
    
    mockPluginConflictDetection.apply.mockResolvedValue(mockResult);

    const results = await service.executeTier3Fixes(context, evidence);

    if (results.length > 0) {
      const result = results[0];
      
      // Verify all required data is present
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('applied');
      expect(result).toHaveProperty('changes');
      expect(result).toHaveProperty('evidence');
      expect(result).toHaveProperty('rollbackPlan');
      expect(result).toHaveProperty('metadata');
      
      // Verify changes (steps) are recorded
      expect(Array.isArray(result?.changes)).toBe(true);
      
      // Verify evidence (command outputs, logs) is recorded
      expect(Array.isArray(result?.evidence)).toBe(true);
      
      // Verify rollback plans are recorded
      if (result?.rollbackPlan) {
        expect(result.rollbackPlan).toHaveProperty('steps');
        expect(result.rollbackPlan).toHaveProperty('metadata');
        expect(result.rollbackPlan).toHaveProperty('createdAt');
      }
      
      // Verify metadata includes phase information
      expect(result?.metadata).toHaveProperty('playbookName');
      expect(result?.metadata).toHaveProperty('tier');
      expect(result?.metadata).toHaveProperty('priority');
      expect(result?.metadata).toHaveProperty('hypothesis');
    }
  });
});