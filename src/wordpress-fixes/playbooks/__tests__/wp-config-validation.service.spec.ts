import { Test, TestingModule } from '@nestjs/testing';
import { WpConfigValidationService } from '../wp-config-validation.service';
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

describe('WpConfigValidationService', () => {
  let service: WpConfigValidationService;

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
        WpConfigValidationService,
        { provide: 'SSHService', useValue: mockSSHService },
        { provide: 'BackupService', useValue: mockBackupService },
        { provide: 'EvidenceService', useValue: mockEvidenceService },
      ],
    }).compile();

    service = module.get<WpConfigValidationService>(WpConfigValidationService);
    
    // Reset mocks
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('canApply', () => {
    it('should return true when evidence indicates wp-config issues', async () => {
      const evidence: FixEvidence[] = [
        {
          type: 'log',
          description: 'Error log',
          content: 'wp-config.php error: database connection failed',
          signature: 'test-sig',
          timestamp: new Date(),
        },
      ];

      const result = await service.canApply(mockContext, evidence);
      expect(result).toBe(true);
    });

    it('should return true when wp-config.php is missing', async () => {
      const evidence: FixEvidence[] = [];
      
      // Mock wp-config.php as missing
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

    it('should return true when wp-config.php has missing constants', async () => {
      const evidence: FixEvidence[] = [];
      
      // Mock wp-config.php exists but has missing constants
      mockSSHService.getConnection.mockResolvedValue({} as any);
      mockSSHService.executeCommand
        .mockResolvedValueOnce({
          stdout: 'exists',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
        })
        .mockResolvedValueOnce({
          stdout: '2', // Only 2 out of 4 required constants
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
        });

      const result = await service.canApply(mockContext, evidence);
      expect(result).toBe(true);
    });

    it('should return false when wp-config.php is valid', async () => {
      const evidence: FixEvidence[] = [];
      
      // Mock wp-config.php exists and has all required constants
      mockSSHService.getConnection.mockResolvedValue({} as any);
      mockSSHService.executeCommand
        .mockResolvedValueOnce({
          stdout: 'exists',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
        })
        .mockResolvedValueOnce({
          stdout: '4', // All 4 required constants present
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
    it('should return appropriate hypothesis for wp-config issues', () => {
      const evidence: FixEvidence[] = [
        {
          type: 'log',
          description: 'Error log',
          content: 'wp-config.php database connection error',
          signature: 'test-sig',
          timestamp: new Date(),
        },
      ];

      const hypothesis = service.getHypothesis(mockContext, evidence);
      expect(hypothesis).toContain('wp-config.php issues');
      expect(hypothesis).toContain('database settings');
    });

    it('should return proactive hypothesis when no specific errors found', () => {
      const evidence: FixEvidence[] = [];

      const hypothesis = service.getHypothesis(mockContext, evidence);
      expect(hypothesis).toContain('Proactive wp-config.php validation');
    });
  });

  describe('apply', () => {
    beforeEach(() => {
      mockSSHService.getConnection.mockResolvedValue({} as any);
      mockEvidenceService.collectEvidence.mockResolvedValue(undefined);
      mockBackupService.createFileBackup.mockResolvedValue('/tmp/backup-path');
    });

    it('should successfully repair wp-config.php with missing constants', async () => {
      const invalidConfig = `<?php
define('DB_NAME', 'database_name_here');
define('DB_USER', 'username_here');
// Missing DB_PASSWORD and DB_HOST
?>`;

      // Mock wp-config.php exists but is invalid
      mockSSHService.executeCommand
        .mockResolvedValueOnce({
          stdout: 'exists',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
        })
        // Mock reading current config
        .mockResolvedValueOnce({
          stdout: invalidConfig,
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
        })
        // Mock config validation (invalid)
        .mockResolvedValueOnce({
          stdout: 'Parse error',
          stderr: '',
          exitCode: 1,
          executionTime: 100,
          timestamp: new Date(),
        })
        // Mock writing repaired config
        .mockResolvedValueOnce({
          stdout: '',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
        })
        // Mock setting permissions
        .mockResolvedValueOnce({
          stdout: '',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
        })
        // Mock database connection test
        .mockResolvedValueOnce({
          stdout: 'CONNECTION_SUCCESS',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
        })
        // Mock final validation
        .mockResolvedValueOnce({
          stdout: 'No syntax errors detected',
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
      expect(result.metadata?.['databaseConnectionTest']).toBe(true);
    });

    it('should create wp-config.php when missing', async () => {
      // Mock wp-config.php doesn't exist
      mockSSHService.executeCommand
        .mockResolvedValueOnce({
          stdout: 'not_found',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
        })
        // Mock wp-config-sample.php exists
        .mockResolvedValueOnce({
          stdout: 'exists',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
        })
        // Mock reading sample config
        .mockResolvedValueOnce({
          stdout: '<?php\n// Sample config\ndefine("DB_NAME", "database_name_here");\n?>',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
        })
        // Mock writing new config
        .mockResolvedValueOnce({
          stdout: '',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
        })
        // Mock setting permissions
        .mockResolvedValueOnce({
          stdout: '',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
        })
        // Mock database connection test
        .mockResolvedValueOnce({
          stdout: 'CONNECTION_SUCCESS',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
        })
        // Mock final validation
        .mockResolvedValueOnce({
          stdout: 'No syntax errors detected',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
        });

      const result = await service.apply(mockContext);

      expect(result.success).toBe(true);
      expect(result.applied).toBe(true);
      expect(result.changes.length).toBeGreaterThan(0);
      expect(result.metadata?.['originalExists']).toBe(false);
    });

    it('should handle database connection test failure', async () => {
      const validConfig = `<?php
define('DB_NAME', 'wordpress');
define('DB_USER', 'wp_user');
define('DB_PASSWORD', 'wp_pass');
define('DB_HOST', 'localhost');
?>`;

      // Mock wp-config.php exists and is valid but database connection fails
      mockSSHService.executeCommand
        .mockResolvedValueOnce({
          stdout: 'exists',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
        })
        .mockResolvedValueOnce({
          stdout: validConfig,
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
        // Mock database connection failure
        .mockResolvedValueOnce({
          stdout: 'CONNECTION_FAILED: Access denied',
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
        });

      const result = await service.apply(mockContext);

      expect(result.success).toBe(false); // Should fail due to database connection
      expect(result.applied).toBe(true); // But config was still written
      expect(result.metadata?.['databaseConnectionTest']).toBe(false);
    });

    it('should handle errors gracefully', async () => {
      // Mock SSH connection failure
      mockSSHService.executeCommand.mockRejectedValue(new Error('SSH connection failed'));

      const result = await service.apply(mockContext);

      expect(result.success).toBe(false);
      expect(result.applied).toBe(false);
      expect(result.error).toContain('SSH connection failed');
    });
  });

  describe('rollback', () => {
    it('should successfully rollback changes', async () => {
      const rollbackPlan = {
        steps: [
          {
            type: 'restore_file' as const,
            description: 'Restore wp-config.php',
            action: 'cp "/tmp/backup" "/var/www/html/wp/wp-config.php"',
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
        'cp "/tmp/backup" "/var/www/html/wp/wp-config.php"',
        'Restore wp-config.php'
      );
    });

    it('should handle rollback failure', async () => {
      const rollbackPlan = {
        steps: [
          {
            type: 'restore_file' as const,
            description: 'Restore wp-config.php',
            action: 'cp "/tmp/backup" "/var/www/html/wp/wp-config.php"',
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