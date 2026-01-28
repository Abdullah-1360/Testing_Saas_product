import { Test, TestingModule } from '@nestjs/testing';
import { DiskSpaceCleanupService } from '../disk-space-cleanup.service';
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

describe('DiskSpaceCleanupService', () => {
  let service: DiskSpaceCleanupService;

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
        DiskSpaceCleanupService,
        { provide: 'SSHService', useValue: mockSSHService },
        { provide: 'BackupService', useValue: mockBackupService },
        { provide: 'EvidenceService', useValue: mockEvidenceService },
      ],
    }).compile();

    service = module.get<DiskSpaceCleanupService>(DiskSpaceCleanupService);
    
    // Reset mocks
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('canApply', () => {
    it('should return true when evidence indicates disk space issues', async () => {
      const evidence: FixEvidence[] = [
        {
          type: 'log',
          description: 'Error log',
          content: 'No space left on device',
          signature: 'test-sig',
          timestamp: new Date(),
        },
      ];

      const result = await service.canApply(mockContext, evidence);
      expect(result).toBe(true);
    });

    it('should return true when disk usage is high', async () => {
      const evidence: FixEvidence[] = [];
      
      // Mock disk usage check to return 90%
      mockSSHService.getConnection.mockResolvedValue({} as any);
      mockSSHService.executeCommand.mockResolvedValue({
        stdout: '90',
        stderr: '',
        exitCode: 0,
        executionTime: 100,
        timestamp: new Date(),
      });

      const result = await service.canApply(mockContext, evidence);
      expect(result).toBe(true);
    });

    it('should return false when no disk space issues detected', async () => {
      const evidence: FixEvidence[] = [
        {
          type: 'log',
          description: 'Normal log',
          content: 'Everything is working fine',
          signature: 'test-sig',
          timestamp: new Date(),
        },
      ];

      // Mock disk usage check to return 50%
      mockSSHService.getConnection.mockResolvedValue({} as any);
      mockSSHService.executeCommand.mockResolvedValue({
        stdout: '50',
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
    it('should return appropriate hypothesis for disk space issues', () => {
      const evidence: FixEvidence[] = [
        {
          type: 'log',
          description: 'Error log',
          content: 'No space left on device',
          signature: 'test-sig',
          timestamp: new Date(),
        },
      ];

      const hypothesis = service.getHypothesis(mockContext, evidence);
      expect(hypothesis).toContain('insufficient disk space');
      expect(hypothesis).toContain('Cleaning temporary files');
    });

    it('should return proactive hypothesis when no specific errors found', () => {
      const evidence: FixEvidence[] = [];

      const hypothesis = service.getHypothesis(mockContext, evidence);
      expect(hypothesis).toContain('Proactive disk space cleanup');
    });
  });

  describe('apply', () => {
    beforeEach(() => {
      mockSSHService.getConnection.mockResolvedValue({} as any);
      mockEvidenceService.collectEvidence.mockResolvedValue();
    });

    it('should successfully clean up disk space', async () => {
      // Mock initial disk usage (90%)
      mockSSHService.executeCommand
        .mockResolvedValueOnce({
          stdout: '90',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
        })
        // Mock temp files found
        .mockResolvedValueOnce({
          stdout: '/tmp/file1.tmp\n/tmp/file2.temp',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
        })
        // Mock temp files removal
        .mockResolvedValueOnce({
          stdout: '',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
        })
        // Mock log files found
        .mockResolvedValueOnce({
          stdout: '/var/log/large.log',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
        })
        // Mock log truncation
        .mockResolvedValueOnce({
          stdout: '',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
        })
        // Mock cache cleanup
        .mockResolvedValueOnce({
          stdout: 'exists',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
        })
        .mockResolvedValueOnce({
          stdout: '100M /var/www/html/wp/wp-content/cache',
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
        // Mock package cache cleanup
        .mockResolvedValueOnce({
          stdout: 'Reading package lists...',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
        })
        // Mock final disk usage (75%)
        .mockResolvedValueOnce({
          stdout: '75',
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
      expect(result.metadata?.['spaceFreed']).toBe(15); // 90% - 75% = 15%
    });

    it('should handle errors gracefully', async () => {
      // Mock disk usage check failure
      mockSSHService.executeCommand.mockRejectedValue(new Error('SSH connection failed'));

      const result = await service.apply(mockContext);

      expect(result.success).toBe(false);
      expect(result.applied).toBe(false);
      expect(result.error).toContain('SSH connection failed');
    });
  });
});