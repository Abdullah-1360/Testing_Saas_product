import { Test, TestingModule } from '@nestjs/testing';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

describe('DashboardController', () => {
  let controller: DashboardController;
  let service: DashboardService;

  const mockDashboardService = {
    getDashboardStats: jest.fn(),
    getQuickActions: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DashboardController],
      providers: [
        {
          provide: DashboardService,
          useValue: mockDashboardService,
        },
      ],
    }).compile();

    controller = module.get<DashboardController>(DashboardController);
    service = module.get<DashboardService>(DashboardService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getDashboardStats', () => {
    it('should return dashboard statistics', async () => {
      const mockStats = {
        activeSites: 5,
        activeIncidents: 3,
        fixedThisWeek: 10,
        successRate: 75,
        recentIncidents: [],
        systemHealth: {
          apiServer: 'operational' as const,
          jobEngine: 'idle' as const,
          database: 'connected' as const,
        },
      };

      mockDashboardService.getDashboardStats.mockResolvedValue(mockStats);

      const result = await controller.getDashboardStats();

      expect(result).toEqual(mockStats);
      expect(service.getDashboardStats).toHaveBeenCalled();
    });
  });

  describe('getQuickActions', () => {
    it('should return quick actions', async () => {
      const mockActions = [
        {
          id: 'create-incident',
          title: 'Create Incident',
          description: 'Manually trigger incident processing',
          icon: 'ExclamationTriangleIcon',
          href: '/incidents/create',
          color: 'yellow',
        },
      ];

      mockDashboardService.getQuickActions.mockResolvedValue(mockActions);

      const result = await controller.getQuickActions();

      expect(result).toEqual(mockActions);
      expect(service.getQuickActions).toHaveBeenCalled();
    });
  });
});