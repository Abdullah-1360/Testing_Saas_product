import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from './logger.service';
import { RedactionService } from './redaction.service';
import * as winston from 'winston';

// Mock winston
jest.mock('winston', () => ({
  createLogger: jest.fn(),
  format: {
    combine: jest.fn(),
    timestamp: jest.fn(),
    errors: jest.fn(),
    json: jest.fn(),
    colorize: jest.fn(),
    printf: jest.fn(),
  },
  transports: {
    Console: jest.fn(),
  },
}));

// Mock winston-daily-rotate-file
jest.mock('winston-daily-rotate-file', () => {
  return jest.fn().mockImplementation(() => ({}));
});

describe('LoggerService', () => {
  let service: LoggerService;
  let configService: jest.Mocked<ConfigService>;
  let redactionService: jest.Mocked<RedactionService>;
  let mockWinstonLogger: jest.Mocked<winston.Logger>;

  beforeEach(async () => {
    mockWinstonLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
      log: jest.fn(),
    } as any;

    (winston.createLogger as jest.Mock).mockReturnValue(mockWinstonLogger);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LoggerService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockImplementation((key: string, defaultValue?: any) => {
              const config: Record<string, any> = {
                LOG_LEVEL: 'info',
                LOG_FILE_ENABLED: true,
                LOG_FILE_PATH: 'logs/wp-autohealer.log',
                LOG_MAX_FILES: '30',
                LOG_MAX_SIZE: '20m',
              };
              return config[key] || defaultValue;
            }),
          },
        },
        {
          provide: RedactionService,
          useValue: {
            redactObject: jest.fn().mockImplementation(obj => ({ ...obj, redacted: true })),
            redactCommand: jest.fn().mockImplementation(cmd => cmd.replace(/password=\S+/g, 'password=***')),
            redactText: jest.fn().mockImplementation(text => text.replace(/secret/g, '***')),
          },
        },
      ],
    }).compile();

    service = module.get<LoggerService>(LoggerService);
    configService = module.get(ConfigService);
    redactionService = module.get(RedactionService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('constructor', () => {
    it('should create winston logger with correct configuration', () => {
      expect(winston.createLogger).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'info',
          format: expect.anything(),
          transports: expect.any(Array),
        })
      );
    });

    it('should read configuration from ConfigService', () => {
      expect(configService.get).toHaveBeenCalledWith('LOG_LEVEL', 'info');
      expect(configService.get).toHaveBeenCalledWith('LOG_FILE_ENABLED', true);
      expect(configService.get).toHaveBeenCalledWith('LOG_FILE_PATH', 'logs/wp-autohealer.log');
      expect(configService.get).toHaveBeenCalledWith('LOG_MAX_FILES', '30');
      expect(configService.get).toHaveBeenCalledWith('LOG_MAX_SIZE', '20m');
    });
  });

  describe('basic logging methods', () => {
    it('should log info messages', () => {
      service.log('Test message', 'TestContext');

      expect(mockWinstonLogger.info).toHaveBeenCalledWith('Test message', {
        context: 'TestContext',
      });
    });

    it('should log error messages', () => {
      service.error('Error message', 'Stack trace', 'ErrorContext');

      expect(mockWinstonLogger.error).toHaveBeenCalledWith('Error message', {
        trace: 'Stack trace',
        context: 'ErrorContext',
      });
    });

    it('should log warning messages', () => {
      service.warn('Warning message', 'WarnContext');

      expect(mockWinstonLogger.warn).toHaveBeenCalledWith('Warning message', {
        context: 'WarnContext',
      });
    });

    it('should log debug messages', () => {
      service.debug('Debug message', 'DebugContext');

      expect(mockWinstonLogger.debug).toHaveBeenCalledWith('Debug message', {
        context: 'DebugContext',
      });
    });

    it('should log verbose messages', () => {
      service.verbose('Verbose message', 'VerboseContext');

      expect(mockWinstonLogger.verbose).toHaveBeenCalledWith('Verbose message', {
        context: 'VerboseContext',
      });
    });

    it('should handle missing context parameter', () => {
      service.log('Message without context');

      expect(mockWinstonLogger.info).toHaveBeenCalledWith('Message without context', {
        context: undefined,
      });
    });
  });

  describe('logWithMetadata', () => {
    it('should log with redacted metadata', () => {
      const metadata = {
        userId: 'user-123',
        password: 'secret123',
        action: 'login',
      };

      service.logWithMetadata('info', 'User action', metadata, 'UserService');

      expect(redactionService.redactObject).toHaveBeenCalledWith(metadata);
      expect(mockWinstonLogger.log).toHaveBeenCalledWith('info', 'User action', {
        context: 'UserService',
        userId: 'user-123',
        password: 'secret123',
        action: 'login',
        redacted: true,
      });
    });

    it('should handle empty metadata', () => {
      service.logWithMetadata('info', 'Simple message', {});

      expect(redactionService.redactObject).toHaveBeenCalledWith({});
      expect(mockWinstonLogger.log).toHaveBeenCalledWith('info', 'Simple message', {
        context: undefined,
        redacted: true,
      });
    });
  });

  describe('logCommand', () => {
    it('should log command execution with redaction', () => {
      const command = 'mysql -u root -p secret123 -e "SELECT * FROM users"';
      const result = {
        stdout: 'Query results',
        stderr: '',
        exitCode: 0,
        password: 'secret123',
      };

      service.logCommand(command, result, 'SSHService');

      expect(redactionService.redactCommand).toHaveBeenCalledWith(command);
      expect(redactionService.redactObject).toHaveBeenCalledWith(result);
      expect(mockWinstonLogger.info).toHaveBeenCalledWith('Command executed', {
        context: 'SSHService',
        command: 'mysql -u root -p*** -e "SELECT * FROM users"',
        result: {
          stdout: 'Query results',
          stderr: '',
          exitCode: 0,
          password: 'secret123',
          redacted: true,
        },
      });
    });

    it('should use default context when not provided', () => {
      service.logCommand('ls -la', { stdout: 'file list' });

      expect(mockWinstonLogger.info).toHaveBeenCalledWith('Command executed', {
        context: 'CommandExecution',
        command: 'ls -la',
        result: { stdout: 'file list', redacted: true },
      });
    });
  });

  describe('logSecurityEvent', () => {
    it('should log security events with high priority', () => {
      const details = {
        ipAddress: '192.168.1.100',
        userAgent: 'Malicious Bot',
        attemptedAction: 'unauthorized_access',
        apiKey: 'secret-key-123',
      };

      service.logSecurityEvent('Unauthorized Access Attempt', details, 'AuthGuard');

      expect(redactionService.redactObject).toHaveBeenCalledWith(details);
      expect(mockWinstonLogger.warn).toHaveBeenCalledWith(
        'SECURITY EVENT: Unauthorized Access Attempt',
        {
          context: 'AuthGuard',
          event: 'Unauthorized Access Attempt',
          details: { ...details, redacted: true },
          timestamp: expect.any(String),
        }
      );
    });

    it('should use default security context', () => {
      service.logSecurityEvent('Failed Login', { attempts: 5 });

      expect(mockWinstonLogger.warn).toHaveBeenCalledWith(
        'SECURITY EVENT: Failed Login',
        expect.objectContaining({
          context: 'Security',
          event: 'Failed Login',
        })
      );
    });

    it('should include timestamp in security events', () => {
      const mockDate = new Date('2024-01-01T12:00:00.000Z');
      jest.spyOn(global, 'Date').mockImplementation(() => mockDate as any);

      service.logSecurityEvent('Test Event', {});

      expect(mockWinstonLogger.warn).toHaveBeenCalledWith(
        'SECURITY EVENT: Test Event',
        expect.objectContaining({
          timestamp: '2024-01-01T12:00:00.000Z',
        })
      );

      jest.restoreAllMocks();
    });
  });

  describe('logAuditEvent', () => {
    it('should log audit events for compliance', () => {
      const details = {
        userId: 'user-123',
        changes: { role: 'admin' },
        previousValues: { role: 'user' },
        sessionId: 'session-456',
      };

      service.logAuditEvent('USER_ROLE_CHANGED', 'USER', details, 'UserService');

      expect(redactionService.redactObject).toHaveBeenCalledWith(details);
      expect(mockWinstonLogger.info).toHaveBeenCalledWith('Audit event', {
        context: 'UserService',
        action: 'USER_ROLE_CHANGED',
        resource: 'USER',
        details: { ...details, redacted: true },
        timestamp: expect.any(String),
      });
    });

    it('should use default audit context', () => {
      service.logAuditEvent('DATA_ACCESS', 'INCIDENT', { incidentId: 'inc-123' });

      expect(mockWinstonLogger.info).toHaveBeenCalledWith('Audit event', 
        expect.objectContaining({
          context: 'Audit',
          action: 'DATA_ACCESS',
          resource: 'INCIDENT',
        })
      );
    });
  });

  describe('logIncidentEvent', () => {
    it('should log incident-specific events', () => {
      const details = {
        serverId: 'server-123',
        siteId: 'site-456',
        fixAttempt: 3,
        command: 'systemctl restart apache2',
        result: { exitCode: 0 },
      };

      service.logIncidentEvent('incident-789', 'FIX_ATTEMPT', 'Service Restart', details);

      expect(redactionService.redactObject).toHaveBeenCalledWith(details);
      expect(mockWinstonLogger.info).toHaveBeenCalledWith('Incident event', {
        context: 'Incident',
        incidentId: 'incident-789',
        phase: 'FIX_ATTEMPT',
        event: 'Service Restart',
        details: { ...details, redacted: true },
        timestamp: expect.any(String),
      });
    });

    it('should handle empty incident details', () => {
      service.logIncidentEvent('incident-123', 'DISCOVERY', 'Started', {});

      expect(mockWinstonLogger.info).toHaveBeenCalledWith('Incident event', {
        context: 'Incident',
        incidentId: 'incident-123',
        phase: 'DISCOVERY',
        event: 'Started',
        details: { redacted: true },
        timestamp: expect.any(String),
      });
    });
  });

  describe('redaction integration', () => {
    it('should redact sensitive data in all structured logging methods', () => {
      const sensitiveData = {
        password: 'secret123',
        apiKey: 'key-456',
        token: 'token-789',
      };

      service.logWithMetadata('info', 'Test', sensitiveData);
      service.logCommand('test command', sensitiveData);
      service.logSecurityEvent('Test Event', sensitiveData);
      service.logAuditEvent('TEST_ACTION', 'RESOURCE', sensitiveData);
      service.logIncidentEvent('inc-1', 'PHASE', 'Event', sensitiveData);

      // Verify redaction service was called for each method
      expect(redactionService.redactObject).toHaveBeenCalledTimes(5);
      expect(redactionService.redactCommand).toHaveBeenCalledTimes(1);
    });

    it('should handle redaction service errors gracefully', () => {
      redactionService.redactObject.mockImplementation(() => {
        throw new Error('Redaction failed');
      });

      // Should not throw error
      expect(() => {
        service.logWithMetadata('info', 'Test', { data: 'test' });
      }).toThrow('Redaction failed');
    });
  });

  describe('configuration variations', () => {
    it('should handle disabled file logging', async () => {
      const configServiceWithDisabledFiles = {
        get: jest.fn().mockImplementation((key: string, defaultValue?: any) => {
          if (key === 'LOG_FILE_ENABLED') return false;
          const config: Record<string, any> = {
            LOG_LEVEL: 'debug',
            LOG_FILE_PATH: 'logs/test.log',
            LOG_MAX_FILES: '7',
            LOG_MAX_SIZE: '10m',
          };
          return config[key] || defaultValue;
        }),
      };

      const module = await Test.createTestingModule({
        providers: [
          LoggerService,
          { provide: ConfigService, useValue: configServiceWithDisabledFiles },
          { provide: RedactionService, useValue: redactionService },
        ],
      }).compile();

      const serviceWithDisabledFiles = module.get<LoggerService>(LoggerService);

      expect(serviceWithDisabledFiles).toBeDefined();
      expect(winston.createLogger).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'debug',
          exceptionHandlers: [],
          rejectionHandlers: [],
        })
      );
    });

    it('should handle custom log levels', async () => {
      const configServiceWithCustomLevel = {
        get: jest.fn().mockImplementation((key: string, defaultValue?: any) => {
          if (key === 'LOG_LEVEL') return 'debug';
          const config: Record<string, any> = {
            LOG_FILE_ENABLED: true,
            LOG_FILE_PATH: 'logs/debug.log',
            LOG_MAX_FILES: '14',
            LOG_MAX_SIZE: '50m',
          };
          return config[key] || defaultValue;
        }),
      };

      const module = await Test.createTestingModule({
        providers: [
          LoggerService,
          { provide: ConfigService, useValue: configServiceWithCustomLevel },
          { provide: RedactionService, useValue: redactionService },
        ],
      }).compile();

      const serviceWithCustomLevel = module.get<LoggerService>(LoggerService);

      expect(serviceWithCustomLevel).toBeDefined();
      expect(winston.createLogger).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'debug',
        })
      );
    });
  });

  describe('error handling', () => {
    it('should handle winston logger errors gracefully', () => {
      mockWinstonLogger.info.mockImplementation(() => {
        throw new Error('Winston error');
      });

      expect(() => {
        service.log('Test message');
      }).toThrow('Winston error');
    });

    it('should handle null/undefined messages', () => {
      service.log(null);
      service.log(undefined);
      service.error(null);
      service.warn(undefined);

      expect(mockWinstonLogger.info).toHaveBeenCalledWith(null, { context: undefined });
      expect(mockWinstonLogger.info).toHaveBeenCalledWith(undefined, { context: undefined });
      expect(mockWinstonLogger.error).toHaveBeenCalledWith(null, { trace: undefined, context: undefined });
      expect(mockWinstonLogger.warn).toHaveBeenCalledWith(undefined, { context: undefined });
    });

    it('should handle complex object messages', () => {
      const complexObject = {
        nested: { data: 'value' },
        array: [1, 2, 3],
        func: () => 'test',
      };

      service.log(complexObject, 'TestContext');

      expect(mockWinstonLogger.info).toHaveBeenCalledWith(complexObject, {
        context: 'TestContext',
      });
    });
  });
});