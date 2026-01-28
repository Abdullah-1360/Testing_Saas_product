import { Test, TestingModule } from '@nestjs/testing';
import { PluginConflictDetectionService } from '../plugin-conflict-detection.service';
import { SSHService } from '../../ssh/services/ssh.service';
import { BackupService } from '../../backup/services/backup.service';
import { EvidenceService } from '../../evidence/services/evidence.service';
import { FixTier, FixPriority, FixContext, FixEvidence } from '../../interfaces/fix-playbook.interface';

describe('PluginConflictDetectionService', () => {
  let service: PluginConflictDetectionService;
  let mockSSHService: jest.Mocked<SSHService>;
  let mockBackupService: jest.Mocked<BackupService>;
  let mockEvidenceService: jest.Mocked<EvidenceService>;

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
    const mockSSHServiceProvider = {
      provide: SSHService,
      useValue: {
        getConnection: jest.fn(),
        executeCommand: jest.fn(),
      },
    };

    const mockBackupServiceProvider = {
      provide: BackupService,
      useValue: {
        createFileBackup: jest.fn(),
      },
    };

    const mockEvidenceServiceProvider = {
      provide: EvidenceService,
      useValue: {
        collectEvidence: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PluginConflictDetectionService,
        mockSSHServiceProvider,
        mockBackupServiceProvider,
        mockEvidenceServiceProvider,
      ],
    }).compile();

    service = module.get<PluginConflictDetectionService>(PluginConflictDetectionService);
    mockSSHService = module.get(SSHService);
    mockBackupService = module.get(BackupService);
    mockEvidenceService = module.get(EvidenceService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should have correct playbook properties', () => {
    expect(service.name).toBe('Plugin Conflict Detection');
    expect(service.tier).toBe(FixTier.TIER_3_PLUGIN_THEME_CONFLICTS);
    expect(service.priority).toBe(FixPriority.CRITICAL);
    expect(service.description).toBe('Detects and isolates conflicting WordPress plugins causing site errors');
    expect(service.applicableConditions).toContain('PHP fatal errors in plugin files');
    expect(service.applicableConditions).toContain('Plugin-related error messages in logs');
  });

  describe('canApply', () => {
    it('should return true when plugin errors are detected in evidence', async () => {
      const evidence: FixEvidence[] = [
        {
          type: 'log',
          description: 'Error log',
          content: 'Fatal error in wp-content/plugins/problematic-plugin/plugin.php',
          signature: 'sig1',
          timestamp: new Date(),
        },
      ];

      // Mock file exists check for plugins directory
      jest.spyOn(service as any, 'fileExists').mockResolvedValue(true);

      const result = await service.canApply(mockContext, evidence);

      expect(result).toBe(true);
    });

    it('should return false when no plugin errors are detected', async () => {
      const evidence: FixEvidence[] = [
        {
          type: 'log',
          description: 'Error log',
          content: 'Database connection error',
          signature: 'sig1',
          timestamp: new Date(),
        },
      ];

      const result = await service.canApply(mockContext, evidence);

      expect(result).toBe(false);
    });

    it('should return false when plugins directory does not exist', async () => {
      const evidence: FixEvidence[] = [
        {
          type: 'log',
          description: 'Error log',
          content: 'Fatal error in wp-content/plugins/problematic-plugin/plugin.php',
          signature: 'sig1',
          timestamp: new Date(),
        },
      ];

      // Mock file exists check for plugins directory
      jest.spyOn(service as any, 'fileExists').mockResolvedValue(false);

      const result = await service.canApply(mockContext, evidence);

      expect(result).toBe(false);
    });
  });

  describe('getHypothesis', () => {
    it('should return specific hypothesis when plugin errors are found', () => {
      const evidence: FixEvidence[] = [
        {
          type: 'log',
          description: 'Plugin error',
          content: 'Fatal error in wp-content/plugins/test-plugin/test.php',
          signature: 'sig1',
          timestamp: new Date(),
        },
        {
          type: 'log',
          description: 'Another plugin error',
          content: 'Plugin activation failed',
          signature: 'sig2',
          timestamp: new Date(),
        },
      ];

      const hypothesis = service.getHypothesis(mockContext, evidence);

      expect(hypothesis).toContain('Site errors appear to be caused by plugin conflicts');
      expect(hypothesis).toContain('Detected 2 plugin-related error(s)');
      expect(hypothesis).toContain('Will identify and temporarily deactivate problematic plugins');
    });

    it('should return general hypothesis when no specific plugin errors are found', () => {
      const evidence: FixEvidence[] = [
        {
          type: 'log',
          description: 'General error',
          content: 'Site is down',
          signature: 'sig1',
          timestamp: new Date(),
        },
      ];

      const hypothesis = service.getHypothesis(mockContext, evidence);

      expect(hypothesis).toContain('Site errors may be caused by plugin conflicts');
      expect(hypothesis).toContain('Will analyze active plugins and error logs');
    });
  });

  describe('apply', () => {
    beforeEach(() => {
      // Mock the executeCommand method used by the base class
      jest.spyOn(service as any, 'executeCommand').mockImplementation(async (context, command, description) => {
        if (command.includes('get_option')) {
          return {
            success: true,
            stdout: '["plugin1/plugin1.php", "plugin2/plugin2.php"]',
            stderr: '',
            exitCode: 0,
          };
        }
        if (command.includes('tail -n 100')) {
          return {
            success: true,
            stdout: 'Fatal error in plugin1/plugin1.php\nWarning in plugin2/plugin2.php',
            stderr: '',
            exitCode: 0,
          };
        }
        if (command.includes('deactivate_plugins')) {
          return {
            success: true,
            stdout: 'DEACTIVATED',
            stderr: '',
            exitCode: 0,
          };
        }
        if (command.includes('curl')) {
          return {
            success: true,
            stdout: '200',
            stderr: '',
            exitCode: 0,
          };
        }
        return {
          success: true,
          stdout: 'BACKUP_SUCCESS',
          stderr: '',
          exitCode: 0,
        };
      });

      // Mock other methods
      jest.spyOn(service as any, 'getActivePlugins').mockResolvedValue(['plugin1/plugin1.php', 'plugin2/plugin2.php']);
      jest.spyOn(service as any, 'analyzePluginErrors').mockResolvedValue([
        { plugin: 'plugin1', errors: ['Fatal error'], severity: 'critical' },
      ]);
      jest.spyOn(service as any, 'identifyProblematicPlugins').mockReturnValue(['plugin1']);
      jest.spyOn(service as any, 'backupPluginState').mockResolvedValue('/backup/path');
      jest.spyOn(service as any, 'deactivateProblematicPlugins').mockResolvedValue([
        { plugin: 'plugin1', success: true },
      ]);
      jest.spyOn(service as any, 'testSiteAfterPluginChanges').mockResolvedValue({
        working: true,
        httpCode: '200',
        accessible: true,
      });
    });

    it('should successfully detect and deactivate problematic plugins', async () => {
      const result = await service.apply(mockContext);

      expect(result.success).toBe(true);
      expect(result.applied).toBe(true);
      expect(result.changes).toHaveLength(1);
      expect(result.changes[0].description).toContain('Deactivated plugin: plugin1');
      expect(result.rollbackPlan).toBeDefined();
      expect(result.metadata?.problematicPlugins).toEqual(['plugin1']);
    });

    it('should return not applied when no active plugins found', async () => {
      jest.spyOn(service as any, 'getActivePlugins').mockResolvedValue([]);

      const result = await service.apply(mockContext);

      expect(result.success).toBe(true);
      expect(result.applied).toBe(false);
      expect(result.metadata?.reason).toBe('no_active_plugins');
    });

    it('should return not applied when no conflicts detected', async () => {
      jest.spyOn(service as any, 'analyzePluginErrors').mockResolvedValue([]);
      jest.spyOn(service as any, 'identifyProblematicPlugins').mockReturnValue([]);

      const result = await service.apply(mockContext);

      expect(result.success).toBe(true);
      expect(result.applied).toBe(false);
      expect(result.metadata?.reason).toBe('no_conflicts_detected');
    });

    it('should handle backup failure', async () => {
      jest.spyOn(service as any, 'backupPluginState').mockResolvedValue(null);

      const result = await service.apply(mockContext);

      expect(result.success).toBe(false);
      expect(result.applied).toBe(false);
      expect(result.error).toBe('Failed to create plugin state backup');
    });

    it('should handle errors gracefully', async () => {
      jest.spyOn(service as any, 'getActivePlugins').mockRejectedValue(new Error('Connection failed'));

      const result = await service.apply(mockContext);

      expect(result.success).toBe(false);
      expect(result.applied).toBe(false);
      expect(result.error).toBe('Connection failed');
    });
  });

  describe('rollback', () => {
    it('should execute rollback steps in reverse order', async () => {
      const rollbackPlan = {
        steps: [
          {
            type: 'execute_command' as const,
            description: 'Restore plugin state',
            action: 'restore command',
            parameters: {},
            order: 1,
          },
          {
            type: 'execute_command' as const,
            description: 'Reactivate plugin',
            action: 'reactivate command',
            parameters: {},
            order: 2,
          },
        ],
        metadata: {},
        createdAt: new Date(),
      };

      jest.spyOn(service as any, 'executeCommand').mockResolvedValue({
        success: true,
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const result = await service.rollback(mockContext, rollbackPlan);

      expect(result).toBe(true);
      expect(service['executeCommand']).toHaveBeenCalledTimes(2);
      // Should execute in reverse order (order 2 first, then order 1)
      expect(service['executeCommand']).toHaveBeenNthCalledWith(1, mockContext, 'reactivate command', 'Reactivate plugin');
      expect(service['executeCommand']).toHaveBeenNthCalledWith(2, mockContext, 'restore command', 'Restore plugin state');
    });

    it('should return false when rollback step fails', async () => {
      const rollbackPlan = {
        steps: [
          {
            type: 'execute_command' as const,
            description: 'Restore plugin state',
            action: 'restore command',
            parameters: {},
            order: 1,
          },
        ],
        metadata: {},
        createdAt: new Date(),
      };

      jest.spyOn(service as any, 'executeCommand').mockResolvedValue({
        success: false,
        stdout: '',
        stderr: 'Command failed',
        exitCode: 1,
      });

      const result = await service.rollback(mockContext, rollbackPlan);

      expect(result).toBe(false);
    });

    it('should handle rollback errors gracefully', async () => {
      const rollbackPlan = {
        steps: [
          {
            type: 'execute_command' as const,
            description: 'Restore plugin state',
            action: 'restore command',
            parameters: {},
            order: 1,
          },
        ],
        metadata: {},
        createdAt: new Date(),
      };

      jest.spyOn(service as any, 'executeCommand').mockRejectedValue(new Error('Connection failed'));

      const result = await service.rollback(mockContext, rollbackPlan);

      expect(result).toBe(false);
    });
  });
});