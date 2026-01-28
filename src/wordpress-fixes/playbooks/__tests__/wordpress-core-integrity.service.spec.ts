import { Test, TestingModule } from '@nestjs/testing';
import { WordPressCoreIntegrityService } from '../wordpress-core-integrity.service';
import { FixContext, FixEvidence } from '../../interfaces/fix-playbook.interface';

// Mock the dependencies
const mockSSHService = {
  getConnection: jest.fn(),
  executeCommand: jest.fn(),
};

const mockBackupService = {
  createFileBackup: jest.fn(),
};

const mockEvidenceService = {
  collectEvidence: jest.fn(),
};

describe('WordPressCoreIntegrityService', () => {
  let service: WordPressCoreIntegrityService;

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
        WordPressCoreIntegrityService,
        { provide: 'SSHService', useValue: mockSSHService },
        { provide: 'BackupService', useValue: mockBackupService },
        { provide: 'EvidenceService', useValue: mockEvidenceService },
      ],
    }).compile();

    service = module.get<WordPressCoreIntegrityService>(WordPressCoreIntegrityService);
    
    // Reset mocks
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('canApply', () => {
    it('should return true when evidence indicates core file issues', async () => {
      const evidence: FixEvidence[] = [
        {
          type: 'log',
          description: 'Error log',
          content: 'Fatal error in wp-includes/functions.php',
          signature: 'test-sig',
          timestamp: new Date(),
        },
      ];

      const result = await service.canApply(mockContext, evidence);
      expect(result).toBe(true);
    });

    it('should return true when core files are missing', async () => {
      const evidence: FixEvidence[] = [];
      
      // Mock core files check to indicate missing files
      mockSSHService.getConnection.mockResolvedValue({} as any);
      mockSSHService.executeCommand
        .mockResolvedValueOnce({
          stdout: 'not_found',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
        });

      const result = await service.canApply(mockContext, evidence);
      expect(result).toBe(true);
    });

    it('should return false when all core files are present', async () => {
      const evidence: FixEvidence[] = [];
      
      // Mock all core files as existing
      mockSSHService.getConnection.mockResolvedValue({} as any);
      mockSSHService.executeCommand
        .mockResolvedValue({
          stdout: 'exists',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
        });

      const result = await service.canApply(mockContext, evidence);
      expect(result).toBe(false);
    });
  });

  describe('getHypothesis', () => {
    it('should return appropriate hypothesis for core file issues', () => {
      const evidence: FixEvidence[] = [
        {
          type: 'log',
          description: 'Error log',
          content: 'wp-includes error detected',
          signature: 'test-sig',
          timestamp: new Date(),
        },
      ];

      const hypothesis = service.getHypothesis(mockContext, evidence);
      expect(hypothesis).toContain('corrupted or missing core files');
      expect(hypothesis).toContain('official WordPress distribution');
    });

    it('should return proactive hypothesis when no specific errors found', () => {
      const evidence: FixEvidence[] = [];

      const hypothesis = service.getHypothesis(mockContext, evidence);
      expect(hypothesis).toContain('Proactive WordPress core file integrity');
    });
  });

  describe('apply', () => {
    beforeEach(() => {
      mockSSHService.getConnection.mockResolvedValue({} as any);
      mockEvidenceService.collectEvidence.mockResolvedValue(undefined);
      mockBackupService.createFileBackup.mockResolvedValue('/tmp/backup-path');
    });

    it('should successfully restore corrupted core files', async () => {
      // Mock WordPress version detection
      mockSSHService.executeCommand
        .mockResolvedValueOnce({
          stdout: '6.4.2',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
        })
        // Mock integrity check finding corrupted files
        .mockResolvedValueOnce({
          stdout: 'exists',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
        })
        .mockResolvedValueOnce({
          stdout: '50 1234567890',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
        })
        // Mock download directory creation
        .mockResolvedValueOnce({
          stdout: '',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
        })
        // Mock WordPress download
        .mockResolvedValueOnce({
          stdout: '',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
        })
        // Mock extraction
        .mockResolvedValueOnce({
          stdout: '',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
        })
        // Mock file restoration
        .mockResolvedValueOnce({
          stdout: 'exists',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
        })
        .mockResolvedValueOnce({
          stdout: '',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
        })
        .mockResolvedValueOnce({
          stdout: '',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
        })
        .mockResolvedValueOnce({
          stdout: '',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
        })
        // Mock verification
        .mockResolvedValueOnce({
          stdout: 'exists',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
        })
        .mockResolvedValueOnce({
          stdout: 'No syntax errors detected',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
        })
        // Mock cleanup
        .mockResolvedValueOnce({
          stdout: '',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
        });

      const result = await service.apply(mockContext);

      expect(result.success).toBe(true);
      expect(result.applied).toBe(true);
      expect(result.changes.length).toBeGreaterThan(0);
      expect(result.evidence.length).toBeGreaterThan(0);
      expect(result.metadata?.['version']).toBe('6.4.2');
    });

    it('should handle version detection failure', async () => {
      // Mock version detection failure
      mockSSHService.executeCommand
        .mockResolvedValueOnce({
          stdout: '',
          stderr: 'File not found',
          exitCode: 1,
          executionTime: 100,
          timestamp: new Date(),
        })
        .mockResolvedValueOnce({
          stdout: '',
          stderr: 'File not found',
          exitCode: 1,
          executionTime: 100,
          timestamp: new Date(),
        })
        .mockResolvedValueOnce({
          stdout: '',
          stderr: 'Command not found',
          exitCode: 1,
          executionTime: 100,
          timestamp: new Date(),
        });

      const result = await service.apply(mockContext);

      expect(result.success).toBe(false);
      expect(result.applied).toBe(false);
      expect(result.error).toContain('Could not detect WordPress version');
    });

    it('should handle download failure', async () => {
      // Mock version detection success but download failure
      mockSSHService.executeCommand
        .mockResolvedValueOnce({
          stdout: '6.4.2',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
        })
        // Mock integrity check
        .mockResolvedValueOnce({
          stdout: 'not_found',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
        })
        // Mock download directory creation success
        .mockResolvedValueOnce({
          stdout: '',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
        })
        // Mock download failure
        .mockResolvedValueOnce({
          stdout: '',
          stderr: 'Connection failed',
          exitCode: 1,
          executionTime: 100,
          timestamp: new Date(),
        });

      const result = await service.apply(mockContext);

      expect(result.success).toBe(false);
      expect(result.applied).toBe(false);
      expect(result.error).toContain('Failed to download WordPress core files');
    });
  });

  describe('rollback', () => {
    it('should successfully rollback changes', async () => {
      const rollbackPlan = {
        steps: [
          {
            type: 'restore_file' as const,
            description: 'Restore wp-load.php',
            action: 'cp "/tmp/backup" "/var/www/html/wp/wp-load.php"',
            parameters: {},
            order: 0,
          },
        ],
        metadata: {},
        createdAt: new Date(),
      };

      mockSSHService.getConnection.mockResolvedValue({} as any);
      mockSSHService.executeCommand.mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
        executionTime: 100,
        timestamp: new Date(),
      });

      const result = await service.rollback(mockContext, rollbackPlan);

      expect(result).toBe(true);
      expect(mockSSHService.executeCommand).toHaveBeenCalledWith(
        expect.anything(),
        'cp "/tmp/backup" "/var/www/html/wp/wp-load.php"',
        'Restore wp-load.php'
      );
    });

    it('should handle rollback failure', async () => {
      const rollbackPlan = {
        steps: [
          {
            type: 'restore_file' as const,
            description: 'Restore wp-load.php',
            action: 'cp "/tmp/backup" "/var/www/html/wp/wp-load.php"',
            parameters: {},
            order: 0,
          },
        ],
        metadata: {},
        createdAt: new Date(),
      };

      mockSSHService.getConnection.mockResolvedValue({} as any);
      mockSSHService.executeCommand.mockResolvedValue({
        stdout: '',
        stderr: 'File not found',
        exitCode: 1,
        executionTime: 100,
        timestamp: new Date(),
      });

      const result = await service.rollback(mockContext, rollbackPlan);

      expect(result).toBe(false);
    });
  });
});