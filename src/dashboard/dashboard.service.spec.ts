import { Test, TestingModule } from '@nestjs/testing';
import { DashboardService } from './dashboard.service';
import { PrismaService } from '@/database/prisma.service';

describe('DashboardService', () => {
  let service: DashboardService;

  const mockPrismaService = {
    site: {
      count: jest.fn(),
    },
    incident: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
    $queryRaw: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DashboardService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<DashboardService>(DashboardService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getDashboardStats', () => {
    it('should return dashboard statistics', async () => {
      // Mock data
      mockPrismaService.site.count.mockResolvedValue(5);
      mockPrismaService.incident.count
        .mockResolvedValueOnce(3) // active incidents
        .mockResolvedValueOnce(10) // fixed this week
        .mockResolvedValueOnce(20) // total last 30 days
        .mockResolvedValueOnce(15); // fixed last 30 days

      mockPrismaService.incident.findMany.mockResolvedValue([
        {
          id: '1',
          state: 'NEW',
          triggerType: 'MANUAL',
          createdAt: new Date(),
          priority: 'HIGH',
          site: { domain: 'example.com' },
        },
      ]);

      mockPrismaService.$queryRaw.mockResolvedValue([{ result: 1 }]);

      const result = await service.getDashboardStats();

      expect(result).toEqual({
        activeSites: 5,
        activeIncidents: 3,
        fixedThisWeek: 10,
        successRate: 75, // 15/20 * 100
        recentIncidents: expect.any(Array),
        systemHealth: expect.objectContaining({
          apiServer: 'operational',
          database: 'connected',
        }),
      });
    });

    it('should handle zero incidents gracefully', async () => {
      mockPrismaService.site.count.mockResolvedValue(0);
      mockPrismaService.incident.count.mockResolvedValue(0);
      mockPrismaService.incident.findMany.mockResolvedValue([]);
      mockPrismaService.$queryRaw.mockResolvedValue([{ result: 1 }]);

      const result = await service.getDashboardStats();

      expect(result.successRate).toBe(0);
      expect(result.recentIncidents).toEqual([]);
    });
  });

  describe('getQuickActions', () => {
    it('should return quick actions array', async () => {
      const result = await service.getQuickActions();

      expect(result).toBeInstanceOf(Array);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]).toHaveProperty('id');
      expect(result[0]).toHaveProperty('title');
      expect(result[0]).toHaveProperty('description');
      expect(result[0]).toHaveProperty('icon');
      expect(result[0]).toHaveProperty('href');
      expect(result[0]).toHaveProperty('color');
    });
  });
});