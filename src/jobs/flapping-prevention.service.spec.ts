import { Test, TestingModule } from '@nestjs/testing';
import { FlappingPreventionService } from './flapping-prevention.service';

describe('FlappingPreventionService', () => {
  let service: FlappingPreventionService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [FlappingPreventionService],
    }).compile();

    service = module.get<FlappingPreventionService>(FlappingPreventionService);
  });

  afterEach(() => {
    // Clear all flapping data between tests
    service.clearAll();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('checkFlapping', () => {
    it('should allow first incident for a site', () => {
      const siteId = 'site-123';
      const cooldownMs = 300000; // 5 minutes

      const result = service.checkFlapping(siteId, cooldownMs);

      expect(result.isFlapping).toBe(false);
      expect(result.canProceed).toBe(true);
      expect(result.remainingCooldown).toBe(0);
      expect(result.incidentCount).toBe(1);
    });

    it('should prevent incidents during cooldown period', () => {
      const siteId = 'site-456';
      const cooldownMs = 300000; // 5 minutes

      // First incident
      const result1 = service.checkFlapping(siteId, cooldownMs);
      expect(result1.canProceed).toBe(true);

      // Second incident immediately after
      const result2 = service.checkFlapping(siteId, cooldownMs);
      expect(result2.canProceed).toBe(false);
      expect(result2.isFlapping).toBe(true);
      expect(result2.remainingCooldown).toBeGreaterThan(0);
      expect(result2.incidentCount).toBe(1); // Count doesn't increase when blocked
    });

    it('should allow incidents after cooldown period expires', async () => {
      const siteId = 'site-789';
      const cooldownMs = 100; // 100ms for quick test

      // First incident
      const result1 = service.checkFlapping(siteId, cooldownMs);
      expect(result1.canProceed).toBe(true);

      // Second incident during cooldown
      const result2 = service.checkFlapping(siteId, cooldownMs);
      expect(result2.canProceed).toBe(false);

      // Wait for cooldown to expire
      await new Promise(resolve => setTimeout(resolve, 150));

      // Third incident after cooldown
      const result3 = service.checkFlapping(siteId, cooldownMs);
      expect(result3.canProceed).toBe(true);
      expect(result3.isFlapping).toBe(false);
      expect(result3.incidentCount).toBe(2);
    });

    it('should track incident count correctly', () => {
      const siteId = 'site-count';
      const cooldownMs = 100;

      // Multiple incidents with delays
      const result1 = service.checkFlapping(siteId, cooldownMs);
      expect(result1.incidentCount).toBe(1);

      // Wait for cooldown
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const result2 = service.checkFlapping(siteId, cooldownMs);
          expect(result2.incidentCount).toBe(2);

          setTimeout(() => {
            const result3 = service.checkFlapping(siteId, cooldownMs);
            expect(result3.incidentCount).toBe(3);
            resolve();
          }, 150);
        }, 150);
      });
    });

    it('should handle different sites independently', () => {
      const cooldownMs = 300000;

      // Site 1 creates incident
      const result1 = service.checkFlapping('site-1', cooldownMs);
      expect(result1.canProceed).toBe(true);

      // Site 1 tries again (should be blocked)
      const result2 = service.checkFlapping('site-1', cooldownMs);
      expect(result2.canProceed).toBe(false);

      // Site 2 creates incident (should be allowed)
      const result3 = service.checkFlapping('site-2', cooldownMs);
      expect(result3.canProceed).toBe(true);

      // Site 2 tries again (should be blocked)
      const result4 = service.checkFlapping('site-2', cooldownMs);
      expect(result4.canProceed).toBe(false);
    });

    it('should return correct remaining cooldown time', () => {
      const siteId = 'site-cooldown';
      const cooldownMs = 60000; // 1 minute

      // First incident
      service.checkFlapping(siteId, cooldownMs);

      // Check remaining cooldown
      const result = service.checkFlapping(siteId, cooldownMs);
      expect(result.remainingCooldown).toBeGreaterThan(59000); // Should be close to 60 seconds
      expect(result.remainingCooldown).toBeLessThanOrEqual(60000);
    });
  });

  describe('getFlappingStats', () => {
    it('should return stats for existing site', () => {
      const siteId = 'site-stats';
      const cooldownMs = 300000;

      // Create some incidents
      service.checkFlapping(siteId, cooldownMs);

      const stats = service.getFlappingStats(siteId);

      expect(stats).toBeDefined();
      expect(stats!.incidentCount).toBe(1);
      expect(stats!.lastIncidentTime).toBeInstanceOf(Date);
      expect(stats!.isInCooldown).toBe(true);
    });

    it('should return null for non-existent site', () => {
      const stats = service.getFlappingStats('non-existent-site');
      expect(stats).toBeNull();
    });

    it('should indicate cooldown status correctly', async () => {
      const siteId = 'site-cooldown-status';
      const cooldownMs = 100;

      // Create incident
      service.checkFlapping(siteId, cooldownMs);

      // Should be in cooldown
      let stats = service.getFlappingStats(siteId);
      expect(stats!.isInCooldown).toBe(true);

      // Wait for cooldown to expire
      await new Promise(resolve => setTimeout(resolve, 150));

      // Should not be in cooldown
      stats = service.getFlappingStats(siteId);
      expect(stats!.isInCooldown).toBe(false);
    });
  });

  describe('clearFlappingData', () => {
    it('should clear flapping data for specific site', () => {
      const siteId = 'site-clear';
      const cooldownMs = 300000;

      // Create incident and block
      service.checkFlapping(siteId, cooldownMs);
      let result = service.checkFlapping(siteId, cooldownMs);
      expect(result.canProceed).toBe(false);

      // Clear flapping data
      service.clearFlappingData(siteId);

      // Should be able to proceed now
      result = service.checkFlapping(siteId, cooldownMs);
      expect(result.canProceed).toBe(true);
      expect(result.incidentCount).toBe(1); // Reset to 1
    });

    it('should not affect other sites when clearing specific site', () => {
      const cooldownMs = 300000;

      // Create incidents for both sites
      service.checkFlapping('site-1', cooldownMs);
      service.checkFlapping('site-2', cooldownMs);

      // Both should be blocked on second attempt
      let result1 = service.checkFlapping('site-1', cooldownMs);
      let result2 = service.checkFlapping('site-2', cooldownMs);
      expect(result1.canProceed).toBe(false);
      expect(result2.canProceed).toBe(false);

      // Clear only site-1
      service.clearFlappingData('site-1');

      // Site-1 should be allowed, site-2 should still be blocked
      result1 = service.checkFlapping('site-1', cooldownMs);
      result2 = service.checkFlapping('site-2', cooldownMs);
      expect(result1.canProceed).toBe(true);
      expect(result2.canProceed).toBe(false);
    });
  });

  describe('clearAll', () => {
    it('should clear all flapping data', () => {
      const cooldownMs = 300000;

      // Create incidents for multiple sites
      service.checkFlapping('site-1', cooldownMs);
      service.checkFlapping('site-2', cooldownMs);
      service.checkFlapping('site-3', cooldownMs);

      // All should be blocked on second attempt
      let result1 = service.checkFlapping('site-1', cooldownMs);
      let result2 = service.checkFlapping('site-2', cooldownMs);
      let result3 = service.checkFlapping('site-3', cooldownMs);
      expect(result1.canProceed).toBe(false);
      expect(result2.canProceed).toBe(false);
      expect(result3.canProceed).toBe(false);

      // Clear all
      service.clearAll();

      // All should be allowed now
      result1 = service.checkFlapping('site-1', cooldownMs);
      result2 = service.checkFlapping('site-2', cooldownMs);
      result3 = service.checkFlapping('site-3', cooldownMs);
      expect(result1.canProceed).toBe(true);
      expect(result2.canProceed).toBe(true);
      expect(result3.canProceed).toBe(true);
    });
  });

  describe('getAllStats', () => {
    it('should return stats for all sites', () => {
      const cooldownMs = 300000;

      // Create incidents for multiple sites
      service.checkFlapping('site-1', cooldownMs);
      service.checkFlapping('site-2', cooldownMs);
      service.checkFlapping('site-2', cooldownMs); // Second attempt for site-2

      const allStats = service.getAllStats();

      expect(Object.keys(allStats)).toHaveLength(2);
      expect(allStats['site-1']).toBeDefined();
      expect(allStats['site-2']).toBeDefined();
      expect(allStats['site-1'].incidentCount).toBe(1);
      expect(allStats['site-2'].incidentCount).toBe(1); // Blocked attempt doesn't count
    });

    it('should return empty object when no flapping data exists', () => {
      const allStats = service.getAllStats();
      expect(allStats).toEqual({});
    });
  });

  describe('isInCooldown', () => {
    it('should return true during cooldown period', () => {
      const siteId = 'site-cooldown-check';
      const cooldownMs = 300000;

      service.checkFlapping(siteId, cooldownMs);

      expect(service.isInCooldown(siteId, cooldownMs)).toBe(true);
    });

    it('should return false after cooldown period', async () => {
      const siteId = 'site-cooldown-expired';
      const cooldownMs = 100;

      service.checkFlapping(siteId, cooldownMs);

      // Wait for cooldown to expire
      await new Promise(resolve => setTimeout(resolve, 150));

      expect(service.isInCooldown(siteId, cooldownMs)).toBe(false);
    });

    it('should return false for non-existent site', () => {
      expect(service.isInCooldown('non-existent', 300000)).toBe(false);
    });
  });

  describe('getRemainingCooldown', () => {
    it('should return remaining cooldown time', () => {
      const siteId = 'site-remaining';
      const cooldownMs = 60000; // 1 minute

      service.checkFlapping(siteId, cooldownMs);

      const remaining = service.getRemainingCooldown(siteId, cooldownMs);
      expect(remaining).toBeGreaterThan(59000);
      expect(remaining).toBeLessThanOrEqual(60000);
    });

    it('should return 0 after cooldown expires', async () => {
      const siteId = 'site-remaining-expired';
      const cooldownMs = 100;

      service.checkFlapping(siteId, cooldownMs);

      // Wait for cooldown to expire
      await new Promise(resolve => setTimeout(resolve, 150));

      const remaining = service.getRemainingCooldown(siteId, cooldownMs);
      expect(remaining).toBe(0);
    });

    it('should return 0 for non-existent site', () => {
      const remaining = service.getRemainingCooldown('non-existent', 300000);
      expect(remaining).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('should handle zero cooldown', () => {
      const siteId = 'site-zero-cooldown';
      const cooldownMs = 0;

      // First incident
      const result1 = service.checkFlapping(siteId, cooldownMs);
      expect(result1.canProceed).toBe(true);

      // Second incident with zero cooldown should be allowed
      const result2 = service.checkFlapping(siteId, cooldownMs);
      expect(result2.canProceed).toBe(true);
      expect(result2.isFlapping).toBe(false);
    });

    it('should handle negative cooldown', () => {
      const siteId = 'site-negative-cooldown';
      const cooldownMs = -1000;

      // First incident
      const result1 = service.checkFlapping(siteId, cooldownMs);
      expect(result1.canProceed).toBe(true);

      // Second incident with negative cooldown should be allowed
      const result2 = service.checkFlapping(siteId, cooldownMs);
      expect(result2.canProceed).toBe(true);
    });

    it('should handle very large cooldown', () => {
      const siteId = 'site-large-cooldown';
      const cooldownMs = Number.MAX_SAFE_INTEGER;

      // First incident
      const result1 = service.checkFlapping(siteId, cooldownMs);
      expect(result1.canProceed).toBe(true);

      // Second incident should be blocked for a very long time
      const result2 = service.checkFlapping(siteId, cooldownMs);
      expect(result2.canProceed).toBe(false);
      expect(result2.remainingCooldown).toBeGreaterThan(1000000);
    });

    it('should handle empty site ID', () => {
      const result = service.checkFlapping('', 300000);
      expect(result.canProceed).toBe(true);
      expect(result.incidentCount).toBe(1);
    });
  });
});