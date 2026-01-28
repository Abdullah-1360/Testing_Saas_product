import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { SystemConfigService, UpdateSystemConfigDto } from './system-config.service';
import { PrismaService } from '@/database/prisma.service';
import { AuditService } from '@/audit/audit.service';

describe('SystemConfigService', () => {
  let service: SystemConfigService;
  let configService: jest.Mocked<ConfigService>;
  let auditService: jest.Mocked<AuditService>;

  beforeEach(async () => {
    const mockConfigService = {
      get: jest.fn(),
    };

    const mockPrismaService = {};

    const mockAuditService = {
      createAuditEvent: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SystemConfigService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: AuditService,
          useValue: mockAuditService,
        },
      ],
    }).compile();

    service = module.get<SystemConfigService>(SystemConfigService);
    configService = module.get(ConfigService);
    auditService = module.get(AuditService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getSystemConfiguration', () => {
    it('should return system configuration with default values', () => {
      // Arrange
      configService.get
        .mockReturnValueOnce(15) // MAX_FIX_ATTEMPTS
        .mockReturnValueOnce(600) // INCIDENT_COOLDOWN_WINDOW
        .mockReturnValueOnce(30000) // SSH_CONNECTION_TIMEOUT
        .mockReturnValueOnce(5) // CIRCUIT_BREAKER_THRESHOLD
        .mockReturnValueOnce(300000) // CIRCUIT_BREAKER_TIMEOUT
        .mockReturnValueOnce(30000) // VERIFICATION_TIMEOUT
        .mockReturnValueOnce(3) // VERIFICATION_RETRY_ATTEMPTS
        .mockReturnValueOnce(3) // DEFAULT_RETENTION_DAYS
        .mockReturnValueOnce(7); // MAX_RETENTION_DAYS

      // Act
      const result = service.getSystemConfiguration();

      // Assert
      expect(result).toEqual({
        maxFixAttempts: 15,
        cooldownWindow: 600,
        sshTimeout: 30, // Converted from milliseconds to seconds
        circuitBreakerThreshold: 5,
        circuitBreakerTimeout: 300, // Converted from milliseconds to seconds
        verificationTimeout: 30, // Converted from milliseconds to seconds
        verificationRetryAttempts: 3,
        defaultRetentionDays: 3,
        maxRetentionDays: 7,
      });
    });

    it('should use fallback values when config values are not set', () => {
      // Arrange
      configService.get.mockImplementation((_key, defaultValue) => defaultValue);

      // Act
      const result = service.getSystemConfiguration();

      // Assert
      expect(result).toEqual({
        maxFixAttempts: 15,
        cooldownWindow: 600,
        sshTimeout: 30,
        circuitBreakerThreshold: 5,
        circuitBreakerTimeout: 300,
        verificationTimeout: 30,
        verificationRetryAttempts: 3,
        defaultRetentionDays: 3,
        maxRetentionDays: 7,
      });
    });
  });

  describe('validateConfiguration', () => {
    it('should return empty array for valid configuration', () => {
      // Arrange
      const validConfig: UpdateSystemConfigDto = {
        maxFixAttempts: 10,
        cooldownWindow: 300,
        sshTimeout: 60,
        circuitBreakerThreshold: 3,
        circuitBreakerTimeout: 600,
        verificationTimeout: 45,
        verificationRetryAttempts: 5,
        defaultRetentionDays: 5,
      };

      // Act
      const errors = service.validateConfiguration(validConfig);

      // Assert
      expect(errors).toEqual([]);
    });

    it('should return errors for invalid maxFixAttempts', () => {
      // Arrange
      const invalidConfigs = [
        { maxFixAttempts: 0 },
        { maxFixAttempts: 21 },
        { maxFixAttempts: -1 },
      ];

      // Act & Assert
      invalidConfigs.forEach(config => {
        const errors = service.validateConfiguration(config);
        expect(errors).toContain('Max fix attempts must be between 1 and 20');
      });
    });

    it('should return multiple errors for multiple invalid fields', () => {
      // Arrange
      const invalidConfig: UpdateSystemConfigDto = {
        maxFixAttempts: 0,
        cooldownWindow: 30,
        sshTimeout: 200,
        defaultRetentionDays: 10,
      };

      // Act
      const errors = service.validateConfiguration(invalidConfig);

      // Assert
      expect(errors).toHaveLength(4);
      expect(errors).toContain('Max fix attempts must be between 1 and 20');
      expect(errors).toContain('Cooldown window must be between 60 and 3600 seconds (1 minute to 1 hour)');
      expect(errors).toContain('SSH timeout must be between 10 and 120 seconds');
      expect(errors).toContain('Default retention days must be between 1 and 7');
    });
  });

  describe('updateSystemConfiguration', () => {
    it('should update configuration successfully with valid data', async () => {
      // Arrange
      const updates: UpdateSystemConfigDto = {
        maxFixAttempts: 10,
        cooldownWindow: 900,
      };

      configService.get.mockImplementation((_key, defaultValue) => defaultValue);
      auditService.createAuditEvent.mockResolvedValue({} as any);

      // Act
      const result = await service.updateSystemConfiguration(updates, 'user-1');

      // Assert
      expect(result).toEqual({
        maxFixAttempts: 10, // Updated value
        cooldownWindow: 900, // Updated value
        sshTimeout: 30, // Default value
        circuitBreakerThreshold: 5, // Default value
        circuitBreakerTimeout: 300, // Default value
        verificationTimeout: 30, // Default value
        verificationRetryAttempts: 3, // Default value
        defaultRetentionDays: 3, // Default value
        maxRetentionDays: 7, // Default value
      });

      expect(auditService.createAuditEvent).toHaveBeenCalledWith({
        userId: 'user-1',
        action: 'UPDATE_SYSTEM_CONFIGURATION',
        resource: 'system_config',
        resourceId: 'system',
        details: {
          previousValues: expect.any(Object),
          newValues: updates,
          changes: ['maxFixAttempts', 'cooldownWindow'],
        },
      });
    });

    it('should throw BadRequestException for invalid configuration', async () => {
      // Arrange
      const invalidUpdates: UpdateSystemConfigDto = {
        maxFixAttempts: 0,
        sshTimeout: 200,
      };

      // Act & Assert
      await expect(service.updateSystemConfiguration(invalidUpdates)).rejects.toThrow(
        new BadRequestException(
          'Configuration validation failed: Max fix attempts must be between 1 and 20, SSH timeout must be between 10 and 120 seconds'
        )
      );

      expect(auditService.createAuditEvent).not.toHaveBeenCalled();
    });
  });

  describe('getSystemHealthStatus', () => {
    beforeEach(() => {
      configService.get.mockImplementation((_key, defaultValue) => defaultValue);
    });

    it('should return HEALTHY status for good configuration', () => {
      // Act
      const result = service.getSystemHealthStatus();

      // Assert
      expect(result.status).toBe('HEALTHY');
      expect(result.checks).toHaveLength(4);
      expect(result.checks.every(check => check.status === 'PASS')).toBe(true);
    });

    it('should return WARNING status for aggressive retention', () => {
      // Arrange
      configService.get.mockImplementation((_key, defaultValue) => {
        if (_key === 'DEFAULT_RETENTION_DAYS') return 1;
        return defaultValue;
      });

      // Act
      const result = service.getSystemHealthStatus();

      // Assert
      expect(result.status).toBe('WARNING');
      const retentionCheck = result.checks.find(c => c.name === 'Retention Policy');
      expect(retentionCheck?.status).toBe('WARN');
      expect(retentionCheck?.message).toContain('Very aggressive retention period');
    });
  });

  describe('getConfigurationRecommendations', () => {
    beforeEach(() => {
      configService.get.mockImplementation((_key, defaultValue) => defaultValue);
    });

    it('should return empty recommendations for optimal configuration', () => {
      // Act
      const result = service.getConfigurationRecommendations();

      // Assert
      expect(result).toEqual([]);
    });

    it('should recommend increasing retention period', () => {
      // Arrange
      configService.get.mockImplementation((_key, defaultValue) => {
        if (_key === 'DEFAULT_RETENTION_DAYS') return 1;
        return defaultValue;
      });

      // Act
      const result = service.getConfigurationRecommendations();

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        category: 'Data Retention',
        recommendation: 'Consider increasing retention period to at least 3 days for better incident analysis',
        priority: 'MEDIUM',
        currentValue: 1,
        recommendedValue: 3,
      });
    });
  });
});