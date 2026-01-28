import { Test, TestingModule } from '@nestjs/testing';
import { FixPlaybookRegistryService } from './fix-playbook-registry.service';
import { FixTier } from './interfaces/fix.interface';
import { BaseFixPlaybook } from './base/base-fix-playbook';

// Mock playbook classes
class MockTier1Playbook extends BaseFixPlaybook {
  readonly name = 'mock-tier1-playbook';
  readonly tier = FixTier.TIER_1_INFRASTRUCTURE;
  readonly description = 'Mock Tier 1 playbook';

  async canApply(): Promise<boolean> {
    return true;
  }

  async apply(): Promise<any> {
    return { success: true, message: 'Mock fix applied' };
  }

  async rollback(): Promise<any> {
    return { success: true, message: 'Mock rollback completed' };
  }

  async verify(): Promise<any> {
    return { success: true, message: 'Mock verification passed' };
  }
}

class MockTier2Playbook extends BaseFixPlaybook {
  readonly name = 'mock-tier2-playbook';
  readonly tier = FixTier.TIER_2_CORE_INTEGRITY;
  readonly description = 'Mock Tier 2 playbook';

  async canApply(): Promise<boolean> {
    return true;
  }

  async apply(): Promise<any> {
    return { success: true, message: 'Mock fix applied' };
  }

  async rollback(): Promise<any> {
    return { success: true, message: 'Mock rollback completed' };
  }

  async verify(): Promise<any> {
    return { success: true, message: 'Mock verification passed' };
  }
}

class MockTier3Playbook extends BaseFixPlaybook {
  readonly name = 'mock-tier3-playbook';
  readonly tier = FixTier.TIER_3_PLUGIN_THEME_CONFLICTS;
  readonly description = 'Mock Tier 3 playbook';

  async canApply(): Promise<boolean> {
    return false; // This one cannot be applied
  }

  async apply(): Promise<any> {
    return { success: true, message: 'Mock fix applied' };
  }

  async rollback(): Promise<any> {
    return { success: true, message: 'Mock rollback completed' };
  }

  async verify(): Promise<any> {
    return { success: true, message: 'Mock verification passed' };
  }
}

describe('FixPlaybookRegistryService', () => {
  let service: FixPlaybookRegistryService;
  let mockTier1Playbook: MockTier1Playbook;
  let mockTier2Playbook: MockTier2Playbook;
  let mockTier3Playbook: MockTier3Playbook;

  beforeEach(async () => {
    mockTier1Playbook = new MockTier1Playbook();
    mockTier2Playbook = new MockTier2Playbook();
    mockTier3Playbook = new MockTier3Playbook();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FixPlaybookRegistryService,
        {
          provide: 'PLAYBOOKS',
          useValue: [mockTier1Playbook, mockTier2Playbook, mockTier3Playbook],
        },
      ],
    }).compile();

    service = module.get<FixPlaybookRegistryService>(FixPlaybookRegistryService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('onModuleInit', () => {
    it('should register all playbooks on module initialization', async () => {
      // The service should have registered playbooks during module initialization
      const allPlaybooks = service.getAllPlaybooks();
      
      expect(allPlaybooks).toHaveLength(3);
      expect(allPlaybooks.map(p => p.name)).toContain('mock-tier1-playbook');
      expect(allPlaybooks.map(p => p.name)).toContain('mock-tier2-playbook');
      expect(allPlaybooks.map(p => p.name)).toContain('mock-tier3-playbook');
    });
  });

  describe('registerPlaybook', () => {
    it('should register a new playbook', () => {
      class NewPlaybook extends BaseFixPlaybook {
        readonly name = 'new-playbook';
        readonly tier = FixTier.TIER_4_CACHE_FLUSH;
        readonly description = 'New test playbook';

        async canApply(): Promise<boolean> { return true; }
        async apply(): Promise<any> { return { success: true }; }
        async rollback(): Promise<any> { return { success: true }; }
        async verify(): Promise<any> { return { success: true }; }
      }

      const newPlaybook = new NewPlaybook();
      service.registerPlaybook(newPlaybook);

      const allPlaybooks = service.getAllPlaybooks();
      expect(allPlaybooks).toHaveLength(4);
      expect(allPlaybooks.map(p => p.name)).toContain('new-playbook');
    });

    it('should not register duplicate playbooks', () => {
      const initialCount = service.getAllPlaybooks().length;
      
      // Try to register the same playbook again
      service.registerPlaybook(mockTier1Playbook);
      
      const finalCount = service.getAllPlaybooks().length;
      expect(finalCount).toBe(initialCount); // Should not increase
    });

    it('should log warning when registering duplicate playbook', () => {
      const loggerSpy = jest.spyOn(service['logger'], 'warn');
      
      service.registerPlaybook(mockTier1Playbook);
      
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('already registered'),
        expect.stringContaining('mock-tier1-playbook')
      );
    });
  });

  describe('unregisterPlaybook', () => {
    it('should unregister an existing playbook', () => {
      const initialCount = service.getAllPlaybooks().length;
      
      service.unregisterPlaybook('mock-tier1-playbook');
      
      const finalCount = service.getAllPlaybooks().length;
      expect(finalCount).toBe(initialCount - 1);
      expect(service.getPlaybookByName('mock-tier1-playbook')).toBeNull();
    });

    it('should handle unregistering non-existent playbook gracefully', () => {
      const initialCount = service.getAllPlaybooks().length;
      
      service.unregisterPlaybook('non-existent-playbook');
      
      const finalCount = service.getAllPlaybooks().length;
      expect(finalCount).toBe(initialCount); // Should not change
    });

    it('should log warning when unregistering non-existent playbook', () => {
      const loggerSpy = jest.spyOn(service['logger'], 'warn');
      
      service.unregisterPlaybook('non-existent-playbook');
      
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('not found'),
        expect.stringContaining('non-existent-playbook')
      );
    });
  });

  describe('getPlaybookByName', () => {
    it('should return playbook by name', () => {
      const playbook = service.getPlaybookByName('mock-tier1-playbook');
      
      expect(playbook).toBe(mockTier1Playbook);
      expect(playbook?.name).toBe('mock-tier1-playbook');
    });

    it('should return null for non-existent playbook', () => {
      const playbook = service.getPlaybookByName('non-existent-playbook');
      
      expect(playbook).toBeNull();
    });

    it('should be case sensitive', () => {
      const playbook = service.getPlaybookByName('MOCK-TIER1-PLAYBOOK');
      
      expect(playbook).toBeNull();
    });
  });

  describe('getPlaybooksForTier', () => {
    it('should return playbooks for specific tier', () => {
      const tier1Playbooks = service.getPlaybooksForTier(FixTier.TIER_1_INFRASTRUCTURE);
      
      expect(tier1Playbooks).toHaveLength(1);
      expect(tier1Playbooks[0]).toBe(mockTier1Playbook);
    });

    it('should return multiple playbooks for same tier', () => {
      // Register another Tier 1 playbook
      class AnotherTier1Playbook extends BaseFixPlaybook {
        readonly name = 'another-tier1-playbook';
        readonly tier = FixTier.TIER_1_INFRASTRUCTURE;
        readonly description = 'Another Tier 1 playbook';

        async canApply(): Promise<boolean> { return true; }
        async apply(): Promise<any> { return { success: true }; }
        async rollback(): Promise<any> { return { success: true }; }
        async verify(): Promise<any> { return { success: true }; }
      }

      const anotherPlaybook = new AnotherTier1Playbook();
      service.registerPlaybook(anotherPlaybook);

      const tier1Playbooks = service.getPlaybooksForTier(FixTier.TIER_1_INFRASTRUCTURE);
      
      expect(tier1Playbooks).toHaveLength(2);
      expect(tier1Playbooks.map(p => p.name)).toContain('mock-tier1-playbook');
      expect(tier1Playbooks.map(p => p.name)).toContain('another-tier1-playbook');
    });

    it('should return empty array for tier with no playbooks', () => {
      const tier4Playbooks = service.getPlaybooksForTier(FixTier.TIER_4_CACHE_FLUSH);
      
      expect(tier4Playbooks).toHaveLength(0);
    });

    it('should sort playbooks by priority within tier', () => {
      // Register playbooks with different priorities
      class HighPriorityPlaybook extends BaseFixPlaybook {
        readonly name = 'high-priority-playbook';
        readonly tier = FixTier.TIER_1_INFRASTRUCTURE;
        readonly description = 'High priority playbook';
        readonly priority = 1;

        async canApply(): Promise<boolean> { return true; }
        async apply(): Promise<any> { return { success: true }; }
        async rollback(): Promise<any> { return { success: true }; }
        async verify(): Promise<any> { return { success: true }; }
      }

      class LowPriorityPlaybook extends BaseFixPlaybook {
        readonly name = 'low-priority-playbook';
        readonly tier = FixTier.TIER_1_INFRASTRUCTURE;
        readonly description = 'Low priority playbook';
        readonly priority = 10;

        async canApply(): Promise<boolean> { return true; }
        async apply(): Promise<any> { return { success: true }; }
        async rollback(): Promise<any> { return { success: true }; }
        async verify(): Promise<any> { return { success: true }; }
      }

      const highPriorityPlaybook = new HighPriorityPlaybook();
      const lowPriorityPlaybook = new LowPriorityPlaybook();

      service.registerPlaybook(highPriorityPlaybook);
      service.registerPlaybook(lowPriorityPlaybook);

      const tier1Playbooks = service.getPlaybooksForTier(FixTier.TIER_1_INFRASTRUCTURE);
      
      expect(tier1Playbooks[0].name).toBe('high-priority-playbook');
      expect(tier1Playbooks[tier1Playbooks.length - 1].name).toBe('low-priority-playbook');
    });
  });

  describe('getAllPlaybooks', () => {
    it('should return all registered playbooks', () => {
      const allPlaybooks = service.getAllPlaybooks();
      
      expect(allPlaybooks).toHaveLength(3);
      expect(allPlaybooks.map(p => p.name)).toContain('mock-tier1-playbook');
      expect(allPlaybooks.map(p => p.name)).toContain('mock-tier2-playbook');
      expect(allPlaybooks.map(p => p.name)).toContain('mock-tier3-playbook');
    });

    it('should return playbooks sorted by tier and priority', () => {
      const allPlaybooks = service.getAllPlaybooks();
      
      // Should be sorted by tier first (Tier 1, then Tier 2, then Tier 3)
      expect(allPlaybooks[0].tier).toBe(FixTier.TIER_1_INFRASTRUCTURE);
      expect(allPlaybooks[1].tier).toBe(FixTier.TIER_2_CORE_INTEGRITY);
      expect(allPlaybooks[2].tier).toBe(FixTier.TIER_3_PLUGIN_THEME_CONFLICTS);
    });

    it('should return empty array when no playbooks registered', () => {
      // Create a new service instance with no playbooks
      const emptyService = new FixPlaybookRegistryService();
      
      const allPlaybooks = emptyService.getAllPlaybooks();
      expect(allPlaybooks).toHaveLength(0);
    });
  });

  describe('getPlaybooksByTier', () => {
    it('should return playbooks grouped by tier', () => {
      const playbooksByTier = service.getPlaybooksByTier();
      
      expect(playbooksByTier[FixTier.TIER_1_INFRASTRUCTURE]).toHaveLength(1);
      expect(playbooksByTier[FixTier.TIER_2_CORE_INTEGRITY]).toHaveLength(1);
      expect(playbooksByTier[FixTier.TIER_3_PLUGIN_THEME_CONFLICTS]).toHaveLength(1);
      expect(playbooksByTier[FixTier.TIER_4_CACHE_FLUSH]).toHaveLength(0);
      expect(playbooksByTier[FixTier.TIER_5_DEPENDENCY_REPAIR]).toHaveLength(0);
      expect(playbooksByTier[FixTier.TIER_6_COMPONENT_ROLLBACK]).toHaveLength(0);
    });

    it('should include all tiers even if empty', () => {
      const playbooksByTier = service.getPlaybooksByTier();
      
      expect(Object.keys(playbooksByTier)).toHaveLength(6);
      expect(playbooksByTier).toHaveProperty(FixTier.TIER_1_INFRASTRUCTURE);
      expect(playbooksByTier).toHaveProperty(FixTier.TIER_2_CORE_INTEGRITY);
      expect(playbooksByTier).toHaveProperty(FixTier.TIER_3_PLUGIN_THEME_CONFLICTS);
      expect(playbooksByTier).toHaveProperty(FixTier.TIER_4_CACHE_FLUSH);
      expect(playbooksByTier).toHaveProperty(FixTier.TIER_5_DEPENDENCY_REPAIR);
      expect(playbooksByTier).toHaveProperty(FixTier.TIER_6_COMPONENT_ROLLBACK);
    });
  });

  describe('getApplicablePlaybooks', () => {
    it('should return only applicable playbooks for given context', async () => {
      const mockContext = {
        siteId: 'site-123',
        serverId: 'server-123',
        connectionId: 'conn-123',
      };

      const applicablePlaybooks = await service.getApplicablePlaybooks(mockContext);
      
      // Should return tier1 and tier2 (canApply returns true) but not tier3 (canApply returns false)
      expect(applicablePlaybooks).toHaveLength(2);
      expect(applicablePlaybooks.map(p => p.name)).toContain('mock-tier1-playbook');
      expect(applicablePlaybooks.map(p => p.name)).toContain('mock-tier2-playbook');
      expect(applicablePlaybooks.map(p => p.name)).not.toContain('mock-tier3-playbook');
    });

    it('should handle errors in canApply gracefully', async () => {
      // Mock one playbook to throw an error
      jest.spyOn(mockTier2Playbook, 'canApply').mockRejectedValue(new Error('Check failed'));

      const mockContext = {
        siteId: 'site-123',
        serverId: 'server-123',
        connectionId: 'conn-123',
      };

      const applicablePlaybooks = await service.getApplicablePlaybooks(mockContext);
      
      // Should still return the working playbooks
      expect(applicablePlaybooks).toHaveLength(1);
      expect(applicablePlaybooks[0].name).toBe('mock-tier1-playbook');
    });

    it('should return empty array when no playbooks are applicable', async () => {
      // Mock all playbooks to return false for canApply
      jest.spyOn(mockTier1Playbook, 'canApply').mockResolvedValue(false);
      jest.spyOn(mockTier2Playbook, 'canApply').mockResolvedValue(false);

      const mockContext = {
        siteId: 'site-123',
        serverId: 'server-123',
        connectionId: 'conn-123',
      };

      const applicablePlaybooks = await service.getApplicablePlaybooks(mockContext);
      
      expect(applicablePlaybooks).toHaveLength(0);
    });
  });

  describe('getPlaybookStats', () => {
    it('should return statistics about registered playbooks', () => {
      const stats = service.getPlaybookStats();
      
      expect(stats.totalPlaybooks).toBe(3);
      expect(stats.playbooksByTier[FixTier.TIER_1_INFRASTRUCTURE]).toBe(1);
      expect(stats.playbooksByTier[FixTier.TIER_2_CORE_INTEGRITY]).toBe(1);
      expect(stats.playbooksByTier[FixTier.TIER_3_PLUGIN_THEME_CONFLICTS]).toBe(1);
      expect(stats.playbooksByTier[FixTier.TIER_4_CACHE_FLUSH]).toBe(0);
      expect(stats.playbooksByTier[FixTier.TIER_5_DEPENDENCY_REPAIR]).toBe(0);
      expect(stats.playbooksByTier[FixTier.TIER_6_COMPONENT_ROLLBACK]).toBe(0);
    });

    it('should return zero stats when no playbooks registered', () => {
      const emptyService = new FixPlaybookRegistryService();
      const stats = emptyService.getPlaybookStats();
      
      expect(stats.totalPlaybooks).toBe(0);
      expect(Object.values(stats.playbooksByTier).every(count => count === 0)).toBe(true);
    });
  });

  describe('validatePlaybook', () => {
    it('should validate a properly implemented playbook', () => {
      const isValid = service.validatePlaybook(mockTier1Playbook);
      
      expect(isValid).toBe(true);
    });

    it('should reject playbook with missing name', () => {
      class InvalidPlaybook extends BaseFixPlaybook {
        readonly name = '';
        readonly tier = FixTier.TIER_1_INFRASTRUCTURE;
        readonly description = 'Invalid playbook';

        async canApply(): Promise<boolean> { return true; }
        async apply(): Promise<any> { return { success: true }; }
        async rollback(): Promise<any> { return { success: true }; }
        async verify(): Promise<any> { return { success: true }; }
      }

      const invalidPlaybook = new InvalidPlaybook();
      const isValid = service.validatePlaybook(invalidPlaybook);
      
      expect(isValid).toBe(false);
    });

    it('should reject playbook with missing description', () => {
      class InvalidPlaybook extends BaseFixPlaybook {
        readonly name = 'invalid-playbook';
        readonly tier = FixTier.TIER_1_INFRASTRUCTURE;
        readonly description = '';

        async canApply(): Promise<boolean> { return true; }
        async apply(): Promise<any> { return { success: true }; }
        async rollback(): Promise<any> { return { success: true }; }
        async verify(): Promise<any> { return { success: true }; }
      }

      const invalidPlaybook = new InvalidPlaybook();
      const isValid = service.validatePlaybook(invalidPlaybook);
      
      expect(isValid).toBe(false);
    });

    it('should reject playbook with missing required methods', () => {
      class InvalidPlaybook {
        readonly name = 'invalid-playbook';
        readonly tier = FixTier.TIER_1_INFRASTRUCTURE;
        readonly description = 'Invalid playbook';
        // Missing canApply, apply, rollback, verify methods
      }

      const invalidPlaybook = new InvalidPlaybook() as any;
      const isValid = service.validatePlaybook(invalidPlaybook);
      
      expect(isValid).toBe(false);
    });
  });
});