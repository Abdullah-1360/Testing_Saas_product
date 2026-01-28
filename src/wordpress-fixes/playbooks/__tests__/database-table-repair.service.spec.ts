import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseTableRepairService } from '../database-table-repair.service';
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

describe('DatabaseTableRepairService', () => {
  let service: DatabaseTableRepairService;

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
        DatabaseTableRepairService,
        { provide: 'SSHService', useValue: mockSSHService },
        { provide: 'BackupService', useValue: mockBackupService },
        { provide: 'EvidenceService', useValue: mockEvidenceService },
      ],
    }).compile();

    service = module.get<DatabaseTableRepairService>(DatabaseTableRepairService);
    
    // Reset mocks
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('canApply', () => {
    it('should return true when evidence indicates database table issues', async () => {
      const evidence: FixEvidence[] = [
        {
          type: 'log',
          description: 'Database error',
          content: 'Table wp_posts is marked as crashed and should be repaired',
          signature: 'test-sig',
          timestamp: new Date(),
        },
      ];

      const result = await service.canApply(mockContext, evidence);
      expect(result).toBe(true);
    });

    it('should return true when database connection fails', async () => {
      const evidence: FixEvidence[] = [];
      
      // Mock database health check failure
      mockSSHService.getConnection.mockResolvedValue({} as any);
      mockSSHService.executeCommand
        .mockResolvedValueOnce({
          stdout: 'CONNECTION_FAILED',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
        });

      const result = await service.canApply(mockContext, evidence);
      expect(result).toBe(true);
    });

    it('should return false when database is healthy', async () => {
      const evidence: FixEvidence[] = [];
      
      // Mock database health check success
      mockSSHService.getConnection.mockResolvedValue({} as any);
      mockSSHService.executeCommand
        .mockResolvedValueOnce({
          stdout: 'CONNECTION_SUCCESS',
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
    it('should return appropriate hypothesis for database table issues', () => {
      const evidence: FixEvidence[] = [
        {
          type: 'log',
          description: 'Database error',
          content: 'Table crashed and needs repair',
          signature: 'test-sig',
          timestamp: new Date(),
        },
      ];

      const hypothesis = service.getHypothesis(mockContext, evidence);
      expect(hypothesis).toContain('corrupted database tables');
      expect(hypothesis).toContain('Repairing the affected tables');
    });

    it('should return proactive hypothesis when no specific errors found', () => {
      const evidence: FixEvidence[] = [];

      const hypothesis = service.getHypothesis(mockContext, evidence);
      expect(hypothesis).toContain('Proactive database table integrity');
    });
  });

  describe('apply', () => {
    beforeEach(() => {
      mockSSHService.getConnection.mockResolvedValue({} as any);
      mockEvidenceService.collectEvidence.mockResolvedValue(undefined);
    });

    it('should successfully repair corrupted database tables', async () => {
      // Mock database info extraction
      mockSSHService.executeCommand
        .mockResolvedValueOnce({
          stdout: '{"host":"localhost","user":"wp_user","password":"wp_pass","database":"wordpress"}',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
        })
        // Mock database backup
        .mockResolvedValueOnce({
          stdout: 'BACKUP_SUCCESS',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
        })
        // Mock table status check showing corrupted tables
        .mockResolvedValueOnce({
          stdout: 'wp_posts\tcheck\terror\tTable is marked as crashed\nwp_options\tcheck\tOK\t',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
        })
        // Mock table repair
        .mockResolvedValueOnce({
          stdout: 'wp_posts\trepair\tOK\tTable repaired successfully',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
        })
        // Mock table optimization
        .mockResolvedValueOnce({
          stdout: 'wp_posts\toptimize\tOK\tTable optimized',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
        })
        // Mock verification
        .mockResolvedValueOnce({
          stdout: 'wp_posts\tcheck\tOK\t\nwp_options\tcheck\tOK\t',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
        })
        // Mock WordPress options check
        .mockResolvedValueOnce({
          stdout: '3',
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
      expect(result.metadata?.['tablesRepaired']).toBe(1);
      expect(result.metadata?.['tablesOptimized']).toBe(1);
    });

    it('should handle case when no corrupted tables found', async () => {
      // Mock database info extraction
      mockSSHService.executeCommand
        .mockResolvedValueOnce({
          stdout: '{"host":"localhost","user":"wp_user","password":"wp_pass","database":"wordpress"}',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
        })
        // Mock database backup
        .mockResolvedValueOnce({
          stdout: 'BACKUP_SUCCESS',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
        })
        // Mock table status check showing all tables OK
        .mockResolvedValueOnce({
          stdout: 'wp_posts\tcheck\tOK\t\nwp_options\tcheck\tOK\t',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
        });

      const result = await service.apply(mockContext);

      expect(result.success).toBe(true);
      expect(result.applied).toBe(false);
      expect(result.changes.length).toBe(0);
      expect(result.metadata?.['databaseStatus']).toBe('healthy');
    });

    it('should handle database info extraction failure', async () => {
      // Mock database info extraction failure
      mockSSHService.executeCommand
        .mockResolvedValueOnce({
          stdout: '',
          stderr: 'wp-config.php not found',
          exitCode: 1,
          executionTime: 100,
          timestamp: new Date(),
        });

      const result = await service.apply(mockContext);

      expect(result.success).toBe(false);
      expect(result.applied).toBe(false);
      expect(result.error).toContain('Could not extract database connection information');
    });

    it('should handle backup creation failure gracefully', async () => {
      // Mock database info extraction success
      mockSSHService.executeCommand
        .mockResolvedValueOnce({
          stdout: '{"host":"localhost","user":"wp_user","password":"wp_pass","database":"wordpress"}',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
        })
        // Mock backup failure
        .mockResolvedValueOnce({
          stdout: 'BACKUP_FAILED',
          stderr: 'Access denied',
          exitCode: 1,
          executionTime: 100,
          timestamp: new Date(),
        })
        // Mock table status check
        .mockResolvedValueOnce({
          stdout: 'wp_posts\tcheck\terror\tTable is crashed',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
        })
        // Mock table repair
        .mockResolvedValueOnce({
          stdout: 'wp_posts\trepair\tOK\tRepaired',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
        })
        // Mock optimization
        .mockResolvedValueOnce({
          stdout: 'wp_posts\toptimize\tOK\t',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
        })
        // Mock verification
        .mockResolvedValueOnce({
          stdout: 'wp_posts\tcheck\tOK\t',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
        })
        // Mock options check
        .mockResolvedValueOnce({
          stdout: '3',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
        });

      const result = await service.apply(mockContext);

      expect(result.success).toBe(true);
      expect(result.applied).toBe(true);
      expect(result.metadata?.['databaseBackupCreated']).toBe(false);
      expect(result.rollbackPlan).toBeUndefined(); // No rollback plan without backup
    });

    it('should repair WordPress options when needed', async () => {
      // Mock database info extraction
      mockSSHService.executeCommand
        .mockResolvedValueOnce({
          stdout: '{"host":"localhost","user":"wp_user","password":"wp_pass","database":"wordpress"}',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
        })
        // Mock backup
        .mockResolvedValueOnce({
          stdout: 'BACKUP_SUCCESS',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
        })
        // Mock no corrupted tables
        .mockResolvedValueOnce({
          stdout: 'wp_posts\tcheck\tOK\t',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
        })
        // Mock verification
        .mockResolvedValueOnce({
          stdout: 'wp_posts\tcheck\tOK\t',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
        })
        // Mock WordPress options check showing missing options
        .mockResolvedValueOnce({
          stdout: '1', // Only 1 out of 3 critical options
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
        })
        // Mock options restoration (3 INSERT queries)
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
        });

      const result = await service.apply(mockContext);

      expect(result.success).toBe(true);
      expect(result.applied).toBe(true);
      expect(result.metadata?.['optionsRepaired']).toBe(true);
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
    it('should successfully rollback database changes', async () => {
      const rollbackPlan = {
        steps: [
          {
            type: 'execute_command' as const,
            description: 'Restore database from backup',
            action: 'mysql -h "localhost" -u "wp_user" -p"wp_pass" "wordpress" < "/tmp/backup.sql"',
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
        'mysql -h "localhost" -u "wp_user" -p"wp_pass" "wordpress" < "/tmp/backup.sql"',
        'Restore database from backup'
      );
    });

    it('should handle rollback failure', async () => {
      const rollbackPlan = {
        steps: [
          {
            type: 'execute_command' as const,
            description: 'Restore database from backup',
            action: 'mysql -h "localhost" -u "wp_user" -p"wp_pass" "wordpress" < "/tmp/backup.sql"',
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
        stderr: 'Access denied',
        exitCode: 1,
        executionTime: 100,
        timestamp: new Date(),
      });

      const result = await service.rollback(mockContext, rollbackPlan);

      expect(result).toBe(false);
    });
  });
});