import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseConnectionRestorationService } from './database-connection-restoration.service';
import { SSHService } from '../../ssh/services/ssh.service';
import { BackupService } from '../../backup/services/backup.service';
import { EvidenceService } from '../../evidence/services/evidence.service';
import { FixTier, FixPriority, FixContext, FixEvidence } from '../interfaces/fix-playbook.interface';

describe('DatabaseConnectionRestorationService', () => {
  let service: DatabaseConnectionRestorationService;
  let sshService: jest.Mocked<SSHService>;
  let backupService: jest.Mocked<BackupService>;
  let evidenceService: jest.Mocked<EvidenceService>;

  const mockContext: FixContext = {
    incidentId: 'incident-123',
    siteId: 'site-456',
    serverId: 'server-789',
    wordpressPath: '/var/www/html',
    siteUrl: 'https://example.com',
    adminUrl: 'https://example.com/wp-admin',
    traceId: 'trace-123',
    correlationId: 'corr-456',
  };

  const mockWpConfigContent = `<?php
define('DB_NAME', 'wordpress_db');
define('DB_USER', 'wp_user');
define('DB_PASSWORD', 'wp_password');
define('DB_HOST', 'localhost');
define('DB_CHARSET', 'utf8');
define('DB_COLLATE', '');
`;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DatabaseConnectionRestorationService,
        {
          provide: SSHService,
          useValue: {
            executeCommand: jest.fn(),
          },
        },
        {
          provide: BackupService,
          useValue: {
            createBackup: jest.fn(),
          },
        },
        {
          provide: EvidenceService,
          useValue: {
            collectEvidence: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<DatabaseConnectionRestorationService>(DatabaseConnectionRestorationService);
    sshService = module.get(SSHService);
    backupService = module.get(BackupService);
    evidenceService = module.get(EvidenceService);

    // Mock the base class methods
    jest.spyOn(service as any, 'executeCommand').mockImplementation(async (context, command, description) => ({
      success: true,
      stdout: 'success',
      stderr: '',
      exitCode: 0,
    }));

    jest.spyOn(service as any, 'fileExists').mockResolvedValue(true);
    jest.spyOn(service as any, 'getFileContent').mockResolvedValue(mockWpConfigContent);
    jest.spyOn(service as any, 'createBackup').mockResolvedValue('/backup/wp-config.php.backup');
    jest.spyOn(service as any, 'writeFileWithBackup').mockResolvedValue({
      type: 'file',
      description: 'Updated wp-config.php',
      filePath: '/var/www/html/wp-config.php',
      timestamp: new Date(),
    });
    jest.spyOn(service as any, 'generateSignature').mockImplementation((content) => `sig_${content.slice(0, 10)}`);
    jest.spyOn(service as any, 'createFileRollbackStep').mockImplementation((filePath, backupPath, order) => ({
      order,
      action: `cp "${backupPath}" "${filePath}"`,
      description: `Restore ${filePath} from backup`,
    }));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('service properties', () => {
    it('should have correct service properties', () => {
      expect(service.name).toBe('database-connection-restoration');
      expect(service.tier).toBe(FixTier.TIER_1_INFRASTRUCTURE);
      expect(service.priority).toBe(FixPriority.CRITICAL);
      expect(service.description).toBe('Restore database connectivity and fix common database connection issues');
      expect(service.applicableConditions).toContain('database_connection_error');
      expect(service.applicableConditions).toContain('mysql_server_gone_away');
    });
  });

  describe('canApply', () => {
    it('should return true for database connection errors', async () => {
      const evidence: FixEvidence[] = [
        {
          type: 'log',
          description: 'Error log',
          content: 'Error establishing a database connection',
          signature: 'sig1',
          timestamp: new Date(),
        },
      ];

      const result = await service.canApply(mockContext, evidence);
      expect(result).toBe(true);
    });

    it('should return true for MySQL server gone away errors', async () => {
      const evidence: FixEvidence[] = [
        {
          type: 'log',
          description: 'MySQL error',
          content: 'MySQL server has gone away',
          signature: 'sig2',
          timestamp: new Date(),
        },
      ];

      const result = await service.canApply(mockContext, evidence);
      expect(result).toBe(true);
    });

    it('should return true for access denied errors', async () => {
      const evidence: FixEvidence[] = [
        {
          type: 'log',
          description: 'Auth error',
          content: 'Access denied for user wp_user@localhost',
          signature: 'sig3',
          timestamp: new Date(),
        },
      ];

      const result = await service.canApply(mockContext, evidence);
      expect(result).toBe(true);
    });

    it('should return false for unrelated errors', async () => {
      const evidence: FixEvidence[] = [
        {
          type: 'log',
          description: 'Other error',
          content: 'Plugin activation failed',
          signature: 'sig4',
          timestamp: new Date(),
        },
      ];

      const result = await service.canApply(mockContext, evidence);
      expect(result).toBe(false);
    });

    it('should return false for empty evidence', async () => {
      const result = await service.canApply(mockContext, []);
      expect(result).toBe(false);
    });
  });

  describe('getHypothesis', () => {
    it('should return database connection hypothesis for database errors', () => {
      const evidence: FixEvidence[] = [
        {
          type: 'log',
          description: 'DB error',
          content: 'database connection failed',
          signature: 'sig1',
          timestamp: new Date(),
        },
      ];

      const hypothesis = service.getHypothesis(mockContext, evidence);
      expect(hypothesis).toContain('WordPress site cannot connect to the database');
    });

    it('should return optimization hypothesis for non-database errors', () => {
      const evidence: FixEvidence[] = [
        {
          type: 'log',
          description: 'Other error',
          content: 'some other issue',
          signature: 'sig1',
          timestamp: new Date(),
        },
      ];

      const hypothesis = service.getHypothesis(mockContext, evidence);
      expect(hypothesis).toContain('Proactive database connection optimization');
    });
  });

  describe('apply', () => {
    it('should successfully restore database connection when connection fails initially', async () => {
      // Mock database connection test to fail first, then succeed
      jest.spyOn(service as any, 'executeCommand')
        .mockResolvedValueOnce({ success: true, stdout: 'success', stderr: '', exitCode: 0 }) // extractDatabaseConfig
        .mockResolvedValueOnce({ success: false, stdout: 'ERROR 2002', stderr: 'Connection failed', exitCode: 1 }) // first connection test
        .mockResolvedValueOnce({ success: true, stdout: 'active', stderr: '', exitCode: 0 }) // MySQL service status
        .mockResolvedValueOnce({ success: true, stdout: '3 packets transmitted', stderr: '', exitCode: 0 }) // ping test
        .mockResolvedValueOnce({ success: true, stdout: 'port_open', stderr: '', exitCode: 0 }) // port test
        .mockResolvedValueOnce({ success: true, stdout: 'Tables repaired', stderr: '', exitCode: 0 }) // repair tables
        .mockResolvedValueOnce({ success: true, stdout: 'SELECT 1', stderr: '', exitCode: 0 }); // final connection test

      const result = await service.apply(mockContext);

      expect(result.success).toBe(true);
      expect(result.applied).toBe(true);
      expect(result.changes).toHaveLength(2); // config fix + repair
      expect(result.evidence.length).toBeGreaterThan(0);
      expect(result.metadata?.connectionRestored).toBe(true);
    });

    it('should handle successful database connection with optimization', async () => {
      // Mock database connection test to succeed
      jest.spyOn(service as any, 'executeCommand')
        .mockResolvedValueOnce({ success: true, stdout: 'success', stderr: '', exitCode: 0 }) // extractDatabaseConfig
        .mockResolvedValueOnce({ success: true, stdout: 'SELECT 1', stderr: '', exitCode: 0 }) // connection test succeeds
        .mockResolvedValueOnce({ success: true, stdout: 'Tables optimized', stderr: '', exitCode: 0 }); // optimization

      const result = await service.apply(mockContext);

      expect(result.success).toBe(true);
      expect(result.applied).toBe(true);
      expect(result.changes).toHaveLength(1); // optimization
      expect(result.metadata?.connectionWorking).toBe(true);
      expect(result.metadata?.optimizationsApplied).toBe(1);
    });

    it('should handle wp-config.php not found', async () => {
      jest.spyOn(service as any, 'fileExists').mockResolvedValue(false);

      const result = await service.apply(mockContext);

      expect(result.success).toBe(false);
      expect(result.applied).toBe(false);
      expect(result.error).toContain('Could not extract database configuration');
    });

    it('should handle database configuration extraction failure', async () => {
      jest.spyOn(service as any, 'getFileContent').mockResolvedValue(null);

      const result = await service.apply(mockContext);

      expect(result.success).toBe(false);
      expect(result.applied).toBe(false);
      expect(result.error).toContain('Could not extract database configuration');
    });

    it('should handle MySQL service start when service is down', async () => {
      jest.spyOn(service as any, 'executeCommand')
        .mockResolvedValueOnce({ success: true, stdout: 'success', stderr: '', exitCode: 0 }) // extractDatabaseConfig
        .mockResolvedValueOnce({ success: false, stdout: 'ERROR 2002', stderr: 'Connection failed', exitCode: 1 }) // connection test fails
        .mockResolvedValueOnce({ success: true, stdout: 'inactive', stderr: '', exitCode: 0 }) // MySQL service status (down)
        .mockResolvedValueOnce({ success: true, stdout: 'Service started', stderr: '', exitCode: 0 }) // start MySQL service
        .mockResolvedValueOnce({ success: true, stdout: '3 packets transmitted', stderr: '', exitCode: 0 }) // ping test
        .mockResolvedValueOnce({ success: true, stdout: 'port_open', stderr: '', exitCode: 0 }) // port test
        .mockResolvedValueOnce({ success: true, stdout: 'Tables repaired', stderr: '', exitCode: 0 }) // repair tables
        .mockResolvedValueOnce({ success: true, stdout: 'SELECT 1', stderr: '', exitCode: 0 }); // final connection test

      const result = await service.apply(mockContext);

      expect(result.success).toBe(true);
      expect(result.applied).toBe(true);
      expect(result.changes.some(c => c.description.includes('Started MySQL service'))).toBe(true);
    });

    it('should handle errors gracefully', async () => {
      jest.spyOn(service as any, 'executeCommand').mockRejectedValue(new Error('SSH connection failed'));

      const result = await service.apply(mockContext);

      expect(result.success).toBe(false);
      expect(result.applied).toBe(false);
      expect(result.error).toBe('SSH connection failed');
    });
  });

  describe('rollback', () => {
    it('should successfully rollback changes', async () => {
      const rollbackPlan = {
        steps: [
          {
            order: 1,
            action: 'cp "/backup/wp-config.php" "/var/www/html/wp-config.php"',
            description: 'Restore wp-config.php',
          },
        ],
        metadata: {},
        createdAt: new Date(),
      };

      jest.spyOn(service as any, 'executeCommand').mockResolvedValue({
        success: true,
        stdout: 'File restored',
        stderr: '',
        exitCode: 0,
      });

      const result = await service.rollback(mockContext, rollbackPlan);

      expect(result).toBe(true);
      expect(service['executeCommand']).toHaveBeenCalledWith(
        mockContext,
        'cp "/backup/wp-config.php" "/var/www/html/wp-config.php"',
        'Restore wp-config.php'
      );
    });

    it('should handle rollback step failure', async () => {
      const rollbackPlan = {
        steps: [
          {
            order: 1,
            action: 'cp "/backup/wp-config.php" "/var/www/html/wp-config.php"',
            description: 'Restore wp-config.php',
          },
        ],
        metadata: {},
        createdAt: new Date(),
      };

      jest.spyOn(service as any, 'executeCommand').mockResolvedValue({
        success: false,
        stdout: '',
        stderr: 'File not found',
        exitCode: 1,
      });

      const result = await service.rollback(mockContext, rollbackPlan);

      expect(result).toBe(false);
    });

    it('should handle rollback errors', async () => {
      const rollbackPlan = {
        steps: [
          {
            order: 1,
            action: 'test command',
            description: 'Test rollback',
          },
        ],
        metadata: {},
        createdAt: new Date(),
      };

      jest.spyOn(service as any, 'executeCommand').mockRejectedValue(new Error('Rollback failed'));

      const result = await service.rollback(mockContext, rollbackPlan);

      expect(result).toBe(false);
    });

    it('should execute rollback steps in reverse order', async () => {
      const rollbackPlan = {
        steps: [
          {
            order: 1,
            action: 'first command',
            description: 'First step',
          },
          {
            order: 2,
            action: 'second command',
            description: 'Second step',
          },
        ],
        metadata: {},
        createdAt: new Date(),
      };

      jest.spyOn(service as any, 'executeCommand').mockResolvedValue({
        success: true,
        stdout: 'success',
        stderr: '',
        exitCode: 0,
      });

      await service.rollback(mockContext, rollbackPlan);

      // Should execute in reverse order (2, then 1)
      expect(service['executeCommand']).toHaveBeenNthCalledWith(
        1,
        mockContext,
        'second command',
        'Second step'
      );
      expect(service['executeCommand']).toHaveBeenNthCalledWith(
        2,
        mockContext,
        'first command',
        'First step'
      );
    });
  });

  describe('database configuration extraction', () => {
    it('should extract database configuration correctly', async () => {
      const result = await (service as any).extractDatabaseConfig(mockContext);

      expect(result.success).toBe(true);
      expect(result.config).toEqual({
        host: 'localhost',
        port: '3306',
        name: 'wordpress_db',
        user: 'wp_user',
        password: 'wp_password',
        charset: 'utf8',
        collate: '',
      });
      expect(result.evidence).toHaveLength(1);
    });

    it('should handle wp-config.php with custom port', async () => {
      const configWithPort = mockWpConfigContent.replace(
        "define('DB_HOST', 'localhost');",
        "define('DB_HOST', 'localhost:3307');"
      );
      
      jest.spyOn(service as any, 'getFileContent').mockResolvedValue(configWithPort);

      const result = await (service as any).extractDatabaseConfig(mockContext);

      expect(result.config.host).toBe('localhost:3307');
      expect(result.config.port).toBe('3307');
    });

    it('should handle missing database configuration values', async () => {
      const incompleteConfig = `<?php
define('DB_NAME', 'wordpress_db');
// Missing other DB defines
`;
      
      jest.spyOn(service as any, 'getFileContent').mockResolvedValue(incompleteConfig);

      const result = await (service as any).extractDatabaseConfig(mockContext);

      expect(result.success).toBe(true);
      expect(result.config.name).toBe('wordpress_db');
      expect(result.config.user).toBe('');
      expect(result.config.password).toBe('');
      expect(result.config.host).toBe('localhost'); // default
    });
  });

  describe('database connection testing', () => {
    it('should test database connection successfully', async () => {
      const config = {
        host: 'localhost',
        port: '3306',
        name: 'test_db',
        user: 'test_user',
        password: 'test_pass',
        charset: 'utf8',
        collate: '',
      };

      jest.spyOn(service as any, 'executeCommand').mockResolvedValue({
        success: true,
        stdout: 'SELECT 1',
        stderr: '',
        exitCode: 0,
      });

      const result = await (service as any).testDatabaseConnection(mockContext, config);

      expect(result.success).toBe(true);
      expect(result.evidence).toHaveLength(1);
      expect(result.evidence[0].content).toBe('Connection successful');
    });

    it('should handle database connection failure', async () => {
      const config = {
        host: 'localhost',
        port: '3306',
        name: 'test_db',
        user: 'test_user',
        password: 'test_pass',
        charset: 'utf8',
        collate: '',
      };

      jest.spyOn(service as any, 'executeCommand').mockResolvedValue({
        success: false,
        stdout: 'ERROR 1045: Access denied',
        stderr: 'Connection failed',
        exitCode: 1,
      });

      const result = await (service as any).testDatabaseConnection(mockContext, config);

      expect(result.success).toBe(false);
      expect(result.evidence[0].content).toBe('Connection failed');
    });
  });

  describe('MySQL service management', () => {
    it('should detect running MySQL service', async () => {
      jest.spyOn(service as any, 'executeCommand').mockResolvedValue({
        success: true,
        stdout: 'active',
        stderr: '',
        exitCode: 0,
      });

      const result = await (service as any).checkAndStartMysqlService(mockContext);

      expect(result.change).toBeUndefined();
      expect(result.evidence).toHaveLength(1);
      expect(result.evidence[0].content).toBe('active');
    });

    it('should start inactive MySQL service', async () => {
      jest.spyOn(service as any, 'executeCommand')
        .mockResolvedValueOnce({
          success: true,
          stdout: 'inactive',
          stderr: '',
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          success: true,
          stdout: 'Service started',
          stderr: '',
          exitCode: 0,
        });

      const result = await (service as any).checkAndStartMysqlService(mockContext);

      expect(result.change).toBeDefined();
      expect(result.change.description).toBe('Started MySQL service');
      expect(result.evidence).toHaveLength(2);
    });

    it('should handle MySQL service start failure', async () => {
      jest.spyOn(service as any, 'executeCommand')
        .mockResolvedValueOnce({
          success: true,
          stdout: 'inactive',
          stderr: '',
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          success: false,
          stdout: '',
          stderr: 'Failed to start service',
          exitCode: 1,
        });

      const result = await (service as any).checkAndStartMysqlService(mockContext);

      expect(result.change).toBeUndefined();
      expect(result.evidence).toHaveLength(2);
    });
  });

  describe('database configuration fixes', () => {
    it('should fix charset and collation in wp-config.php', async () => {
      const result = await (service as any).fixDatabaseConfig(mockContext, {
        host: 'localhost',
        port: '3306',
        name: 'test_db',
        user: 'test_user',
        password: 'test_pass',
        charset: 'utf8', // Should be updated to utf8mb4
        collate: '', // Should be updated to utf8mb4_unicode_ci
      });

      expect(result.change).toBeDefined();
      expect(result.rollbackSteps).toHaveLength(1);
      expect(result.evidence).toHaveLength(1);
    });

    it('should not make changes when configuration is already optimal', async () => {
      const optimalConfig = mockWpConfigContent
        .replace("define('DB_CHARSET', 'utf8');", "define('DB_CHARSET', 'utf8mb4');")
        .replace("define('DB_COLLATE', '');", "define('DB_COLLATE', 'utf8mb4_unicode_ci');")
        + "\n// Database connection optimization - WP-AutoHealer\ndefine('MYSQL_CLIENT_FLAGS', MYSQLI_CLIENT_SSL_DONT_VERIFY_SERVER_CERT);";

      jest.spyOn(service as any, 'getFileContent').mockResolvedValue(optimalConfig);

      const result = await (service as any).fixDatabaseConfig(mockContext, {
        host: 'localhost',
        port: '3306',
        name: 'test_db',
        user: 'test_user',
        password: 'test_pass',
        charset: 'utf8mb4',
        collate: 'utf8mb4_unicode_ci',
      });

      expect(result.change).toBeUndefined();
      expect(result.rollbackSteps).toHaveLength(0);
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle malformed wp-config.php', async () => {
      const malformedConfig = `<?php
// Malformed configuration
define('DB_NAME' 'missing_comma');
`;
      
      jest.spyOn(service as any, 'getFileContent').mockResolvedValue(malformedConfig);

      const result = await (service as any).extractDatabaseConfig(mockContext);

      expect(result.success).toBe(true);
      expect(result.config.name).toBe(''); // Should handle missing values gracefully
    });

    it('should handle backup creation failure', async () => {
      jest.spyOn(service as any, 'createBackup').mockResolvedValue(null);

      const result = await (service as any).fixDatabaseConfig(mockContext, {
        host: 'localhost',
        port: '3306',
        name: 'test_db',
        user: 'test_user',
        password: 'test_pass',
        charset: 'utf8',
        collate: '',
      });

      expect(result.change).toBeUndefined();
      expect(result.rollbackSteps).toHaveLength(0);
    });

    it('should handle network connectivity issues', async () => {
      jest.spyOn(service as any, 'executeCommand')
        .mockResolvedValueOnce({
          success: true,
          stdout: 'ping_failed',
          stderr: '',
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          success: true,
          stdout: 'port_closed',
          stderr: '',
          exitCode: 0,
        });

      const result = await (service as any).checkDatabaseConnectivity(mockContext, {
        host: 'unreachable-host',
        port: '3306',
        name: 'test_db',
        user: 'test_user',
        password: 'test_pass',
        charset: 'utf8',
        collate: '',
      });

      expect(result.evidence).toHaveLength(2);
      expect(result.evidence[0].content).toBe('ping_failed');
      expect(result.evidence[1].content).toBe('port_closed');
    });
  });
});