import { Test, TestingModule } from '@nestjs/testing';
import { SessionCleanupService } from './session-cleanup.service';
import { AuthService } from './auth.service';

describe('SessionCleanupService', () => {
  let service: SessionCleanupService;
  let authService: jest.Mocked<AuthService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionCleanupService,
        {
          provide: AuthService,
          useValue: {
            cleanupExpiredSessions: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<SessionCleanupService>(SessionCleanupService);
    authService = module.get(AuthService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('cleanupExpiredSessions', () => {
    it('should call authService.cleanupExpiredSessions successfully', async () => {
      authService.cleanupExpiredSessions.mockResolvedValue(undefined);

      await service.cleanupExpiredSessions();

      expect(authService.cleanupExpiredSessions).toHaveBeenCalledTimes(1);
    });

    it('should handle cleanup errors gracefully', async () => {
      const error = new Error('Database connection failed');
      authService.cleanupExpiredSessions.mockRejectedValue(error);

      // Should not throw error
      await expect(service.cleanupExpiredSessions()).resolves.not.toThrow();

      expect(authService.cleanupExpiredSessions).toHaveBeenCalledTimes(1);
    });

    it('should log success message when cleanup succeeds', async () => {
      const logSpy = jest.spyOn(service['logger'], 'log').mockImplementation();
      authService.cleanupExpiredSessions.mockResolvedValue(undefined);

      await service.cleanupExpiredSessions();

      expect(logSpy).toHaveBeenCalledWith('Starting cleanup of expired sessions');
      expect(logSpy).toHaveBeenCalledWith('Successfully cleaned up expired sessions');
    });

    it('should log error message when cleanup fails', async () => {
      const logSpy = jest.spyOn(service['logger'], 'log').mockImplementation();
      const errorSpy = jest.spyOn(service['logger'], 'error').mockImplementation();
      const error = new Error('Cleanup failed');
      authService.cleanupExpiredSessions.mockRejectedValue(error);

      await service.cleanupExpiredSessions();

      expect(logSpy).toHaveBeenCalledWith('Starting cleanup of expired sessions');
      expect(errorSpy).toHaveBeenCalledWith('Failed to cleanup expired sessions', error);
    });

    it('should handle undefined/null errors', async () => {
      const errorSpy = jest.spyOn(service['logger'], 'error').mockImplementation();
      authService.cleanupExpiredSessions.mockRejectedValue(null);

      await service.cleanupExpiredSessions();

      expect(errorSpy).toHaveBeenCalledWith('Failed to cleanup expired sessions', null);
    });

    it('should handle string errors', async () => {
      const errorSpy = jest.spyOn(service['logger'], 'error').mockImplementation();
      authService.cleanupExpiredSessions.mockRejectedValue('String error');

      await service.cleanupExpiredSessions();

      expect(errorSpy).toHaveBeenCalledWith('Failed to cleanup expired sessions', 'String error');
    });
  });

  describe('cron scheduling', () => {
    it('should have the correct cron decorator', () => {
      // Check that the method has the @Cron decorator
      const cronMetadata = Reflect.getMetadata('__cron__', service.cleanupExpiredSessions);
      expect(cronMetadata).toBeDefined();
    });
  });

  describe('error resilience', () => {
    it('should continue working after multiple failures', async () => {
      const error = new Error('Persistent error');
      authService.cleanupExpiredSessions.mockRejectedValue(error);

      // Run cleanup multiple times
      await service.cleanupExpiredSessions();
      await service.cleanupExpiredSessions();
      await service.cleanupExpiredSessions();

      expect(authService.cleanupExpiredSessions).toHaveBeenCalledTimes(3);
    });

    it('should work correctly after error recovery', async () => {
      const error = new Error('Temporary error');
      
      // First call fails
      authService.cleanupExpiredSessions.mockRejectedValueOnce(error);
      // Second call succeeds
      authService.cleanupExpiredSessions.mockResolvedValueOnce(undefined);

      await service.cleanupExpiredSessions();
      await service.cleanupExpiredSessions();

      expect(authService.cleanupExpiredSessions).toHaveBeenCalledTimes(2);
    });
  });

  describe('logging behavior', () => {
    it('should always log start message regardless of outcome', async () => {
      const logSpy = jest.spyOn(service['logger'], 'log').mockImplementation();
      
      // Test success case
      authService.cleanupExpiredSessions.mockResolvedValueOnce(undefined);
      await service.cleanupExpiredSessions();
      
      // Test failure case
      authService.cleanupExpiredSessions.mockRejectedValueOnce(new Error('Test error'));
      await service.cleanupExpiredSessions();

      // Should have logged start message twice
      expect(logSpy).toHaveBeenCalledWith('Starting cleanup of expired sessions');
      expect(logSpy).toHaveBeenCalledTimes(3); // 2 start messages + 1 success message
    });

    it('should not log success message when cleanup fails', async () => {
      const logSpy = jest.spyOn(service['logger'], 'log').mockImplementation();
      const errorSpy = jest.spyOn(service['logger'], 'error').mockImplementation();
      
      authService.cleanupExpiredSessions.mockRejectedValue(new Error('Test error'));
      await service.cleanupExpiredSessions();

      expect(logSpy).toHaveBeenCalledWith('Starting cleanup of expired sessions');
      expect(logSpy).not.toHaveBeenCalledWith('Successfully cleaned up expired sessions');
      expect(errorSpy).toHaveBeenCalled();
    });
  });
});