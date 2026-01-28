import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AppService } from './app.service';

describe('AppService', () => {
  let service: AppService;
  let configService: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AppService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<AppService>(AppService);
    configService = module.get(ConfigService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getAppInfo', () => {
    it('should return app information', () => {
      configService.get.mockReturnValue('production');

      const result = service.getAppInfo();

      expect(result).toEqual({
        name: 'WP-AutoHealer',
        version: '1.0.0',
        description: 'Production-grade WordPress self-healing system',
        environment: 'production',
        timestamp: expect.any(String),
      });
      expect(configService.get).toHaveBeenCalledWith('NODE_ENV', 'development');
    });

    it('should return current timestamp in ISO format', () => {
      configService.get.mockReturnValue('development');

      const result = service.getAppInfo();
      const timestamp = new Date(result.timestamp);

      expect(timestamp).toBeInstanceOf(Date);
      expect(timestamp.getTime()).toBeCloseTo(Date.now(), -3); // Within 1 second
    });
  });

  describe('getHealth', () => {
    it('should return health status', () => {
      configService.get.mockReturnValue('development');

      const result = service.getHealth();

      expect(result).toEqual({
        status: 'ok',
        timestamp: expect.any(String),
        uptime: expect.any(Number),
        environment: 'development',
      });
    });

    it('should return current timestamp in ISO format', () => {
      configService.get.mockReturnValue('development');

      const result = service.getHealth();
      const timestamp = new Date(result.timestamp as string);

      expect(timestamp).toBeInstanceOf(Date);
      expect(timestamp.getTime()).toBeCloseTo(Date.now(), -3); // Within 1 second
    });

    it('should return positive uptime', () => {
      configService.get.mockReturnValue('development');

      const result = service.getHealth();

      expect(result.uptime).toBeGreaterThan(0);
    });
  });

  describe('getVersion', () => {
    it('should return version information', () => {
      configService.get.mockReturnValue('v2');

      const result = service.getVersion();

      expect(result).toEqual({
        version: '1.0.0',
        apiVersion: 'v2',
      });
      expect(configService.get).toHaveBeenCalledWith('API_VERSION', 'v1');
    });

    it('should return default API version when not configured', () => {
      configService.get.mockReturnValue('v1');

      const result = service.getVersion();

      expect(result.apiVersion).toBe('v1');
    });
  });
});