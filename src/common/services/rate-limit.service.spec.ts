import { Test, TestingModule } from '@nestjs/testing';
import { RateLimitService } from './rate-limit.service';

describe('RateLimitService', () => {
  let service: RateLimitService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RateLimitService],
    }).compile();

    service = module.get<RateLimitService>(RateLimitService);
  });

  afterEach(() => {
    // Clear all rate limit data between tests
    service.clearAll();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('checkRateLimit', () => {
    it('should allow requests within rate limit', () => {
      const key = 'user:123';
      const limit = 5;
      const windowMs = 60000; // 1 minute

      // First request should be allowed
      const result1 = service.checkRateLimit(key, limit, windowMs);
      expect(result1.allowed).toBe(true);
      expect(result1.remaining).toBe(4);
      expect(result1.resetTime).toBeGreaterThan(Date.now());

      // Second request should be allowed
      const result2 = service.checkRateLimit(key, limit, windowMs);
      expect(result2.allowed).toBe(true);
      expect(result2.remaining).toBe(3);
    });

    it('should deny requests when rate limit exceeded', () => {
      const key = 'user:456';
      const limit = 2;
      const windowMs = 60000;

      // First two requests should be allowed
      service.checkRateLimit(key, limit, windowMs);
      service.checkRateLimit(key, limit, windowMs);

      // Third request should be denied
      const result = service.checkRateLimit(key, limit, windowMs);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it('should reset rate limit after window expires', async () => {
      const key = 'user:789';
      const limit = 1;
      const windowMs = 100; // 100ms window

      // First request should be allowed
      const result1 = service.checkRateLimit(key, limit, windowMs);
      expect(result1.allowed).toBe(true);

      // Second request should be denied
      const result2 = service.checkRateLimit(key, limit, windowMs);
      expect(result2.allowed).toBe(false);

      // Wait for window to expire
      await new Promise(resolve => setTimeout(resolve, 150));

      // Request after window expiry should be allowed
      const result3 = service.checkRateLimit(key, limit, windowMs);
      expect(result3.allowed).toBe(true);
      expect(result3.remaining).toBe(0);
    });

    it('should handle different keys independently', () => {
      const limit = 2;
      const windowMs = 60000;

      // User 1 makes requests
      const result1 = service.checkRateLimit('user:1', limit, windowMs);
      const result2 = service.checkRateLimit('user:1', limit, windowMs);
      const result3 = service.checkRateLimit('user:1', limit, windowMs);

      // User 2 makes requests
      const result4 = service.checkRateLimit('user:2', limit, windowMs);
      const result5 = service.checkRateLimit('user:2', limit, windowMs);

      expect(result1.allowed).toBe(true);
      expect(result2.allowed).toBe(true);
      expect(result3.allowed).toBe(false); // User 1 exceeded limit
      expect(result4.allowed).toBe(true);  // User 2 still has quota
      expect(result5.allowed).toBe(true);  // User 2 still has quota
    });

    it('should return correct remaining count', () => {
      const key = 'user:remaining';
      const limit = 5;
      const windowMs = 60000;

      const results = [];
      for (let i = 0; i < 6; i++) {
        results.push(service.checkRateLimit(key, limit, windowMs));
      }

      expect(results[0].remaining).toBe(4);
      expect(results[1].remaining).toBe(3);
      expect(results[2].remaining).toBe(2);
      expect(results[3].remaining).toBe(1);
      expect(results[4].remaining).toBe(0);
      expect(results[5].remaining).toBe(0); // Still 0 when exceeded
    });

    it('should return correct reset time', () => {
      const key = 'user:reset';
      const limit = 1;
      const windowMs = 60000;

      const startTime = Date.now();
      const result = service.checkRateLimit(key, limit, windowMs);

      expect(result.resetTime).toBeGreaterThanOrEqual(startTime + windowMs - 1000); // Allow 1s tolerance
      expect(result.resetTime).toBeLessThanOrEqual(startTime + windowMs + 1000);
    });
  });

  describe('getRateLimitInfo', () => {
    it('should return rate limit info for existing key', () => {
      const key = 'user:info';
      const limit = 3;
      const windowMs = 60000;

      // Make some requests first
      service.checkRateLimit(key, limit, windowMs);
      service.checkRateLimit(key, limit, windowMs);

      const info = service.getRateLimitInfo(key);

      expect(info).toBeDefined();
      expect(info!.count).toBe(2);
      expect(info!.resetTime).toBeGreaterThan(Date.now());
    });

    it('should return null for non-existent key', () => {
      const info = service.getRateLimitInfo('non-existent-key');
      expect(info).toBeNull();
    });

    it('should return null for expired key', async () => {
      const key = 'user:expired';
      const limit = 1;
      const windowMs = 100;

      service.checkRateLimit(key, limit, windowMs);

      // Wait for expiry
      await new Promise(resolve => setTimeout(resolve, 150));

      const info = service.getRateLimitInfo(key);
      expect(info).toBeNull();
    });
  });

  describe('clearRateLimit', () => {
    it('should clear rate limit for specific key', () => {
      const key = 'user:clear';
      const limit = 1;
      const windowMs = 60000;

      // Exceed rate limit
      service.checkRateLimit(key, limit, windowMs);
      service.checkRateLimit(key, limit, windowMs);

      // Should be denied
      let result = service.checkRateLimit(key, limit, windowMs);
      expect(result.allowed).toBe(false);

      // Clear rate limit
      service.clearRateLimit(key);

      // Should be allowed again
      result = service.checkRateLimit(key, limit, windowMs);
      expect(result.allowed).toBe(true);
    });

    it('should not affect other keys when clearing specific key', () => {
      const key1 = 'user:1';
      const key2 = 'user:2';
      const limit = 1;
      const windowMs = 60000;

      // Exceed rate limit for both users
      service.checkRateLimit(key1, limit, windowMs);
      service.checkRateLimit(key1, limit, windowMs);
      service.checkRateLimit(key2, limit, windowMs);
      service.checkRateLimit(key2, limit, windowMs);

      // Clear only key1
      service.clearRateLimit(key1);

      // Key1 should be allowed, key2 should still be denied
      const result1 = service.checkRateLimit(key1, limit, windowMs);
      const result2 = service.checkRateLimit(key2, limit, windowMs);

      expect(result1.allowed).toBe(true);
      expect(result2.allowed).toBe(false);
    });
  });

  describe('clearAll', () => {
    it('should clear all rate limits', () => {
      const limit = 1;
      const windowMs = 60000;

      // Create rate limits for multiple keys
      service.checkRateLimit('user:1', limit, windowMs);
      service.checkRateLimit('user:1', limit, windowMs);
      service.checkRateLimit('user:2', limit, windowMs);
      service.checkRateLimit('user:2', limit, windowMs);

      // Both should be denied
      let result1 = service.checkRateLimit('user:1', limit, windowMs);
      let result2 = service.checkRateLimit('user:2', limit, windowMs);
      expect(result1.allowed).toBe(false);
      expect(result2.allowed).toBe(false);

      // Clear all
      service.clearAll();

      // Both should be allowed again
      result1 = service.checkRateLimit('user:1', limit, windowMs);
      result2 = service.checkRateLimit('user:2', limit, windowMs);
      expect(result1.allowed).toBe(true);
      expect(result2.allowed).toBe(true);
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', () => {
      const limit = 2;
      const windowMs = 60000;

      // Create some rate limit entries
      service.checkRateLimit('user:1', limit, windowMs);
      service.checkRateLimit('user:2', limit, windowMs);
      service.checkRateLimit('user:2', limit, windowMs);
      service.checkRateLimit('user:3', limit, windowMs);

      const stats = service.getStats();

      expect(stats.totalKeys).toBe(3);
      expect(stats.totalRequests).toBe(4);
      expect(stats.activeKeys).toBe(3);
    });

    it('should return zero stats when no rate limits exist', () => {
      const stats = service.getStats();

      expect(stats.totalKeys).toBe(0);
      expect(stats.totalRequests).toBe(0);
      expect(stats.activeKeys).toBe(0);
    });

    it('should exclude expired entries from active keys', async () => {
      const limit = 1;
      const windowMs = 100;

      service.checkRateLimit('user:1', limit, windowMs);
      service.checkRateLimit('user:2', limit, 60000); // Long window

      // Wait for first entry to expire
      await new Promise(resolve => setTimeout(resolve, 150));

      const stats = service.getStats();

      expect(stats.totalKeys).toBe(2);
      expect(stats.activeKeys).toBe(1); // Only user:2 should be active
    });
  });

  describe('cleanup', () => {
    it('should remove expired entries', async () => {
      const limit = 1;
      const shortWindow = 100;
      const longWindow = 60000;

      // Create entries with different expiry times
      service.checkRateLimit('user:short', limit, shortWindow);
      service.checkRateLimit('user:long', limit, longWindow);

      // Wait for short window to expire
      await new Promise(resolve => setTimeout(resolve, 150));

      // Trigger cleanup by calling getStats (which internally cleans up)
      const stats = service.getStats();

      expect(stats.activeKeys).toBe(1); // Only long window entry should remain
      expect(service.getRateLimitInfo('user:short')).toBeNull();
      expect(service.getRateLimitInfo('user:long')).toBeDefined();
    });
  });

  describe('edge cases', () => {
    it('should handle zero limit', () => {
      const result = service.checkRateLimit('user:zero', 0, 60000);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it('should handle negative limit', () => {
      const result = service.checkRateLimit('user:negative', -1, 60000);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it('should handle zero window', () => {
      const result = service.checkRateLimit('user:zerowindow', 1, 0);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(0);
    });

    it('should handle very large limits', () => {
      const largeLimit = 1000000;
      const result = service.checkRateLimit('user:large', largeLimit, 60000);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(largeLimit - 1);
    });

    it('should handle empty key', () => {
      const result = service.checkRateLimit('', 1, 60000);
      expect(result.allowed).toBe(true);
    });
  });
});