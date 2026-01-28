import { Test, TestingModule } from '@nestjs/testing';
import { EvidenceService } from './evidence.service';
import { PrismaService } from '../../database/prisma.service';
import { SSHService } from '../../ssh/services/ssh.service';
import { EncryptionService } from '../../common/services/encryption.service';
import { RedactionService } from '../../common/services/redaction.service';
import { NotFoundException } from '@nestjs/common';
import { Evidence, IncidentState, TriggerType, Priority } from '@prisma/client';
import { EvidenceType } from '../dto/create-evidence.dto';

describe('EvidenceService', () => {
  let service: EvidenceService;
  let prismaService: any;
  let sshService: any;
  let redactionService: any;

  const mockIncident = {
    id: 'incident-1',
    siteId: 'site-1',
    state: IncidentState.DISCOVERY,
    triggerType: TriggerType.MANUAL,
    priority: Priority.MEDIUM,
    fixAttempts: 0,
    maxFixAttempts: 15,
    createdAt: new Date(),
    updatedAt: new Date(),
    resolvedAt: null,
    escalatedAt: null,
    escalationReason: null
  };

  const mockSite = {
    id: 'site-1',
    serverId: 'server-1',
    domain: 'example.com',
    documentRoot: '/var/www/html',
    wordpressPath: '/var/www/html/wp',
    isMultisite: false,
    siteUrl: 'https://example.com',
    adminUrl: 'https://example.com/wp-admin',
    isActive: true,
    lastHealthCheck: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    server: {
      id: 'server-1',
      name: 'Test Server',
      hostname: 'test.example.com',
      port: 22,
      username: 'root',
      authType: 'KEY' as any,
      encryptedCredentials: 'encrypted-creds',
      hostKeyFingerprint: 'fingerprint',
      controlPanel: null,
      osInfo: null,
      createdAt: new Date(),
      updatedAt: new Date()
    }
  };

  const mockSSHConnection = {
    id: 'conn-1',
    config: {
      hostname: 'test.example.com',
      port: 22,
      username: 'root',
      authType: 'key' as any,
      strictHostKeyChecking: true
    },
    connection: {},
    isConnected: true,
    lastUsed: new Date(),
    createdAt: new Date()
  };

  const mockEvidence: Evidence = {
    id: 'evidence-1',
    incidentId: 'incident-1',
    evidenceType: EvidenceType.LOG_FILE,
    signature: 'sha256:abc123',
    content: 'Log file content',
    metadata: { filePath: '/var/log/test.log' },
    timestamp: new Date()
  };

  beforeEach(async () => {
    const mockPrismaService = {
      incident: {
        findUnique: jest.fn(),
      },
      site: {
        findUnique: jest.fn(),
      },
      evidence: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        delete: jest.fn(),
        count: jest.fn(),
      },
    };

    const mockSSHService = {
      connect: jest.fn(),
      disconnect: jest.fn(),
      executeCommand: jest.fn(),
    };

    const mockEncryptionService = {
      hash: jest.fn(),
    };

    const mockRedactionService = {
      redactCommand: jest.fn(),
      redactText: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EvidenceService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: SSHService, useValue: mockSSHService },
        { provide: EncryptionService, useValue: mockEncryptionService },
        { provide: RedactionService, useValue: mockRedactionService },
      ],
    }).compile();

    service = module.get<EvidenceService>(EvidenceService);
    prismaService = module.get(PrismaService);
    sshService = module.get(SSHService);
    redactionService = module.get(RedactionService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('storeEvidence', () => {
    it('should store evidence successfully', async () => {
      // Arrange
      const incidentId = 'incident-1';
      const evidenceType = EvidenceType.LOG_FILE;
      const content = 'Test log content';
      const metadata = { filePath: '/var/log/test.log' };

      prismaService.evidence.create.mockResolvedValue(mockEvidence);

      // Act
      const result = await service.storeEvidence(incidentId, evidenceType, content, metadata);

      // Assert
      expect(result).toEqual(mockEvidence);
      expect(prismaService.evidence.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          incidentId,
          evidenceType,
          content: expect.any(String),
          metadata: expect.objectContaining({
            ...metadata,
            collectionTime: expect.any(String),
            collectionId: expect.any(String),
            signatureAlgorithm: 'sha256'
          })
        })
      });
    });

    it('should generate signature for evidence', async () => {
      // Arrange
      const content = 'Test content';

      // Act
      const signature = await service.generateSignature(content);

      // Assert
      expect(signature).toEqual({
        algorithm: 'sha256',
        hash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        timestamp: expect.any(Date),
        contentLength: Buffer.byteLength(content, 'utf8'),
        metadata: {
          encoding: 'utf8',
          generatedBy: 'wp-autohealer-evidence-service'
        }
      });
    });
  });

  describe('collectLogFiles', () => {
    it('should collect log files successfully', async () => {
      // Arrange
      const incidentId = 'incident-1';
      const serverId = 'server-1';
      const logPaths = ['/var/log/test.log'];

      prismaService.incident.findUnique.mockResolvedValue(mockIncident);
      sshService.connect.mockResolvedValue(mockSSHConnection);
      sshService.executeCommand
        .mockResolvedValueOnce({
          stdout: '1024 1640995200 -rw-r--r-- root root',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
          command: 'stat'
        })
        .mockResolvedValueOnce({
          stdout: 'Log line 1\nLog line 2\nLog line 3',
          stderr: '',
          exitCode: 0,
          executionTime: 200,
          timestamp: new Date(),
          command: 'cat'
        });
      sshService.disconnect.mockResolvedValue();
      prismaService.evidence.create.mockResolvedValue(mockEvidence);

      // Act
      const results = await service.collectLogFiles(incidentId, serverId, logPaths);

      // Assert
      expect(results).toHaveLength(1);
      expect(results[0]?.success).toBe(true);
      expect(results[0]?.filePath).toBe('/var/log/test.log');
      expect(results[0]?.linesCollected).toBe(3);
      expect(sshService.connect).toHaveBeenCalledWith(serverId);
      expect(sshService.disconnect).toHaveBeenCalledWith(mockSSHConnection.id);
    });

    it('should handle non-existent log files', async () => {
      // Arrange
      const incidentId = 'incident-1';
      const serverId = 'server-1';
      const logPaths = ['/var/log/nonexistent.log'];

      prismaService.incident.findUnique.mockResolvedValue(mockIncident);
      sshService.connect.mockResolvedValue(mockSSHConnection);
      sshService.executeCommand.mockResolvedValue({
        stdout: 'NOT_FOUND',
        stderr: '',
        exitCode: 0,
        executionTime: 100,
        timestamp: new Date(),
        command: 'stat'
      });
      sshService.disconnect.mockResolvedValue();

      // Act
      const results = await service.collectLogFiles(incidentId, serverId, logPaths);

      // Assert
      expect(results).toHaveLength(1);
      expect(results[0]?.success).toBe(false);
      expect(results[0]?.error).toContain('Log file does not exist');
    });

    it('should throw NotFoundException for invalid incident', async () => {
      // Arrange
      const incidentId = 'invalid-incident';
      const serverId = 'server-1';
      const logPaths = ['/var/log/test.log'];

      prismaService.incident.findUnique.mockResolvedValue(null);

      // Act & Assert
      await expect(service.collectLogFiles(incidentId, serverId, logPaths))
        .rejects.toThrow(NotFoundException);
    });
  });

  describe('captureCommandOutput', () => {
    it('should capture command output successfully', async () => {
      // Arrange
      const incidentId = 'incident-1';
      const serverId = 'server-1';
      const command = 'ps aux | head -5';

      prismaService.incident.findUnique.mockResolvedValue(mockIncident);
      sshService.connect.mockResolvedValue(mockSSHConnection);
      sshService.executeCommand.mockResolvedValue({
        stdout: 'USER PID %CPU %MEM\nroot 1 0.0 0.1',
        stderr: '',
        exitCode: 0,
        executionTime: 500,
        timestamp: new Date(),
        command
      });
      sshService.disconnect.mockResolvedValue();
      redactionService.redactCommand.mockReturnValue(command);
      prismaService.evidence.create.mockResolvedValue(mockEvidence);

      // Act
      const result = await service.captureCommandOutput(incidentId, serverId, command);

      // Assert
      expect(result.command).toBe(command);
      expect(result.stdout).toBe('USER PID %CPU %MEM\nroot 1 0.0 0.1');
      expect(result.exitCode).toBe(0);
      expect(result.executionTime).toBe(500);
      expect(sshService.connect).toHaveBeenCalledWith(serverId);
      expect(sshService.executeCommand).toHaveBeenCalledWith(
        mockSSHConnection.id,
        command,
        expect.objectContaining({
          timeout: 30000,
          sanitizeOutput: true
        })
      );
    });

    it('should throw NotFoundException for invalid incident', async () => {
      // Arrange
      const incidentId = 'invalid-incident';
      const serverId = 'server-1';
      const command = 'ps aux';

      prismaService.incident.findUnique.mockResolvedValue(null);

      // Act & Assert
      await expect(service.captureCommandOutput(incidentId, serverId, command))
        .rejects.toThrow(NotFoundException);
    });
  });

  describe('collectSystemDiagnostics', () => {
    it('should collect system diagnostics successfully', async () => {
      // Arrange
      const incidentId = 'incident-1';
      const serverId = 'server-1';

      sshService.connect.mockResolvedValue(mockSSHConnection);
      sshService.executeCommand
        .mockResolvedValueOnce({
          stdout: 'test-server',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
          command: 'hostname'
        })
        .mockResolvedValueOnce({
          stdout: '10:30:45 up 5 days, 2:15, 1 user, load average: 0.15, 0.10, 0.05',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
          command: 'uptime'
        })
        .mockResolvedValueOnce({
          stdout: '0.15 0.10 0.05 1/123 12345',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
          command: 'cat /proc/loadavg'
        })
        .mockResolvedValueOnce({
          stdout: 'total used free shared buff/cache available\n2048 512 1024 0 512 1536',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
          command: 'free -m'
        })
        .mockResolvedValueOnce({
          stdout: 'Filesystem Size Used Avail Use% Mounted on\n/dev/sda1 20G 5G 14G 27% /',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
          command: 'df -h'
        })
        .mockResolvedValueOnce({
          stdout: '45',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
          command: 'ps aux | wc -l'
        })
        .mockResolvedValueOnce({
          stdout: 'tcp 0 0 0.0.0.0:22 0.0.0.0:* LISTEN 1234/sshd',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
          command: 'netstat -tulpn | head -20'
        })
        .mockResolvedValueOnce({
          stdout: '/var/log/syslog\n/var/log/auth.log\n/var/log/kern.log',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
          command: 'find /var/log -name "*.log" -type f | head -10'
        });
      sshService.disconnect.mockResolvedValue();
      prismaService.evidence.create.mockResolvedValue(mockEvidence);

      // Act
      const result = await service.collectSystemDiagnostics(incidentId, serverId);

      // Assert
      expect(result.hostname).toBe('test-server');
      expect(result.uptime).toContain('up 5 days');
      expect(result.loadAverage).toBe('0.15 0.10 0.05 1/123 12345');
      expect(result.memoryUsage).toContain('2048');
      expect(result.diskUsage).toContain('/dev/sda1');
      expect(result.processCount).toBe('45');
      expect(result.networkConnections).toContain('tcp');
      expect(result.systemLogs).toEqual(['/var/log/syslog', '/var/log/auth.log', '/var/log/kern.log']);
      expect(result.timestamp).toBeInstanceOf(Date);
    });
  });

  describe('collectWordPressDiagnostics', () => {
    it('should collect WordPress diagnostics successfully', async () => {
      // Arrange
      const incidentId = 'incident-1';
      const siteId = 'site-1';

      prismaService.site.findUnique.mockResolvedValue(mockSite);
      sshService.connect.mockResolvedValue(mockSSHConnection);
      sshService.executeCommand
        .mockResolvedValueOnce({
          stdout: '6.4.2',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
          command: 'grep wp_version'
        })
        .mockResolvedValueOnce({
          stdout: 'define(\'DB_HOST\', \'localhost\');\ndefine(\'DB_NAME\', \'wordpress\');',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
          command: 'grep DB_'
        })
        .mockResolvedValueOnce({
          stdout: 'lrwxrwxrwx 1 www-data www-data 15 Jan 15 14:30 current -> twentytwentythree',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
          command: 'ls -la themes'
        })
        .mockResolvedValueOnce({
          stdout: 'akismet\nhello-dolly\nwoocommerce',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
          command: 'ls plugins'
        })
        .mockResolvedValueOnce({
          stdout: 'Log not found',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
          command: 'tail debug.log'
        })
        .mockResolvedValueOnce({
          stdout: 'Log not found',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
          command: 'tail error_log'
        })
        .mockResolvedValueOnce({
          stdout: 'Log not found',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
          command: 'tail php_errors.log'
        })
        .mockResolvedValueOnce({
          stdout: 'define(\'WP_DEBUG\', true);\ndefine(\'WP_DEBUG_LOG\', true);',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
          command: 'grep WP_DEBUG'
        });
      sshService.disconnect.mockResolvedValue();
      prismaService.evidence.create.mockResolvedValue(mockEvidence);

      // Act
      const result = await service.collectWordPressDiagnostics(incidentId, siteId);

      // Assert
      expect(result.version).toBe('6.4.2');
      expect(result.activeTheme).toContain('twentytwentythree');
      expect(result.activePlugins).toEqual(['akismet', 'hello-dolly', 'woocommerce']);
      expect(result.errorLogs).toEqual([]);
      expect((result.debugInfo as any)['dbConfig']).toContain('DB_HOST');
      expect((result.debugInfo as any)['debugSettings']).toContain('WP_DEBUG');
      expect(result.timestamp).toBeInstanceOf(Date);
    });

    it('should throw NotFoundException for invalid site', async () => {
      // Arrange
      const incidentId = 'incident-1';
      const siteId = 'invalid-site';

      prismaService.site.findUnique.mockResolvedValue(null);

      // Act & Assert
      await expect(service.collectWordPressDiagnostics(incidentId, siteId))
        .rejects.toThrow(NotFoundException);
    });
  });

  describe('searchEvidence', () => {
    it('should search evidence with filters', async () => {
      // Arrange
      const filter = {
        incidentId: 'incident-1',
        evidenceType: EvidenceType.LOG_FILE,
        limit: 10,
        offset: 0
      };

      const mockEvidenceList = [mockEvidence];
      prismaService.evidence.findMany.mockResolvedValue(mockEvidenceList);
      prismaService.evidence.count.mockResolvedValue(1);

      // Act
      const result = await service.searchEvidence(filter);

      // Assert
      expect(result.evidence).toEqual(mockEvidenceList);
      expect(result.total).toBe(1);
      expect(result.hasMore).toBe(false);
      expect(result.searchMetadata.resultCount).toBe(1);
      expect(prismaService.evidence.findMany).toHaveBeenCalledWith({
        where: {
          incidentId: 'incident-1',
          evidenceType: EvidenceType.LOG_FILE
        },
        orderBy: { timestamp: 'desc' },
        take: 10,
        skip: 0
      });
    });
  });

  describe('getEvidenceById', () => {
    it('should return evidence by ID', async () => {
      // Arrange
      const evidenceId = 'evidence-1';
      prismaService.evidence.findUnique.mockResolvedValue(mockEvidence);

      // Act
      const result = await service.getEvidenceById(evidenceId);

      // Assert
      expect(result).toEqual(mockEvidence);
      expect(prismaService.evidence.findUnique).toHaveBeenCalledWith({
        where: { id: evidenceId }
      });
    });

    it('should return null for non-existent evidence', async () => {
      // Arrange
      const evidenceId = 'nonexistent';
      prismaService.evidence.findUnique.mockResolvedValue(null);

      // Act
      const result = await service.getEvidenceById(evidenceId);

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('deleteEvidence', () => {
    it('should delete evidence successfully', async () => {
      // Arrange
      const evidenceId = 'evidence-1';
      prismaService.evidence.delete.mockResolvedValue(mockEvidence);

      // Act
      await service.deleteEvidence(evidenceId);

      // Assert
      expect(prismaService.evidence.delete).toHaveBeenCalledWith({
        where: { id: evidenceId }
      });
    });
  });

  describe('analyzeLogPatterns', () => {
    it('should analyze log patterns successfully', async () => {
      // Arrange
      const incidentId = 'incident-1';
      const pattern = 'ERROR|FATAL';
      const mockEvidenceList = [mockEvidence];

      prismaService.evidence.findMany.mockResolvedValue(mockEvidenceList);

      // Act
      const result = await service.analyzeLogPatterns(incidentId, pattern);

      // Assert
      expect(result).toEqual(mockEvidenceList);
      expect(prismaService.evidence.findMany).toHaveBeenCalledWith({
        where: {
          incidentId,
          evidenceType: { in: ['LOG_FILE', 'ERROR_LOG', 'ACCESS_LOG'] },
          content: { contains: pattern }
        },
        orderBy: { timestamp: 'desc' }
      });
    });
  });
});