import { Test, TestingModule } from '@nestjs/testing';
import { SitesController } from './sites.controller';
import { SitesService } from './sites.service';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/auth/guards/roles.guard';
import { Site } from '@prisma/client';

describe('SitesController', () => {
  let controller: SitesController;
  let sitesService: jest.Mocked<SitesService>;

  const mockSite: Site = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    serverId: '123e4567-e89b-12d3-a456-426614174001',
    domain: 'example.com',
    documentRoot: '/var/www/html',
    wordpressPath: '/var/www/html/wp',
    isMultisite: false,
    siteUrl: 'https://example.com',
    adminUrl: 'https://example.com/wp-admin',
    isActive: true,
    lastHealthCheck: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockHealthCheckResult = {
    healthy: true,
    statusCode: 200,
    responseTime: 150,
    wordpressDetected: true,
    wordpressVersion: '6.4.2',
    maintenanceMode: false,
    fatalErrors: false,
    whiteScreen: false,
    titleTagPresent: true,
    canonicalTagPresent: true,
    footerMarkersPresent: true,
    headerMarkersPresent: true,
    wpLoginAccessible: true,
    issues: [],
    details: {
      siteUrl: 'https://example.com',
      adminUrl: 'https://example.com/wp-admin',
      isMultisite: false,
      serverHostname: 'test.example.com',
    },
    timestamp: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SitesController],
      providers: [
        {
          provide: SitesService,
          useValue: {
            create: jest.fn(),
            findAll: jest.fn(),
            findByServerId: jest.fn(),
            getStats: jest.fn(),
            findOne: jest.fn(),
            findOneWithServer: jest.fn(),
            update: jest.fn(),
            remove: jest.fn(),
            performHealthCheck: jest.fn(),
            detectWordPressInstallation: jest.fn(),
            detectMultisiteConfiguration: jest.fn(),
            findByDomain: jest.fn(),
          },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<SitesController>(SitesController);
    sitesService = module.get(SitesService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    it('should create a site', async () => {
      const createSiteDto = {
        serverId: '123e4567-e89b-12d3-a456-426614174001',
        domain: 'example.com',
        documentRoot: '/var/www/html',
        wordpressPath: '/var/www/html/wp',
        siteUrl: 'https://example.com',
        adminUrl: 'https://example.com/wp-admin',
      };

      sitesService.create.mockResolvedValue(mockSite);

      const result = await controller.create(createSiteDto);

      expect(result).toEqual(mockSite);
      expect(sitesService.create).toHaveBeenCalledWith(createSiteDto);
    });
  });

  describe('findAll', () => {
    it('should return all sites without server info', async () => {
      const sites = [mockSite];
      sitesService.findAll.mockResolvedValue(sites);

      const result = await controller.findAll(false);

      expect(result).toEqual(sites);
      expect(sitesService.findAll).toHaveBeenCalledWith(false);
    });

    it('should return all sites with server info', async () => {
      const sitesWithServer = [{ ...mockSite, server: { id: 'server-id', name: 'Test Server', hostname: 'test.example.com' } }];
      sitesService.findAll.mockResolvedValue(sitesWithServer);

      const result = await controller.findAll(true);

      expect(result).toEqual(sitesWithServer);
      expect(sitesService.findAll).toHaveBeenCalledWith(true);
    });
  });

  describe('findByServerId', () => {
    it('should return sites by server ID', async () => {
      const sites = [mockSite];
      sitesService.findByServerId.mockResolvedValue(sites);

      const result = await controller.findByServerId('server-id');

      expect(result).toEqual(sites);
      expect(sitesService.findByServerId).toHaveBeenCalledWith('server-id');
    });
  });

  describe('getStats', () => {
    it('should return site statistics', async () => {
      const stats = {
        total: 5,
        active: 4,
        inactive: 1,
        multisite: 2,
        healthyCount: 3,
        unhealthyCount: 1,
        byServer: { 'server-1': 3, 'server-2': 2 },
      };
      sitesService.getStats.mockResolvedValue(stats);

      const result = await controller.getStats();

      expect(result).toEqual(stats);
      expect(sitesService.getStats).toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('should return a site by ID without server info', async () => {
      sitesService.findOne.mockResolvedValue(mockSite);

      const result = await controller.findOne('site-id', false);

      expect(result).toEqual(mockSite);
      expect(sitesService.findOne).toHaveBeenCalledWith('site-id');
    });

    it('should return a site by ID with server info', async () => {
      const siteWithServer = { ...mockSite, server: { id: 'server-id', name: 'Test Server', hostname: 'test.example.com' } };
      sitesService.findOneWithServer.mockResolvedValue(siteWithServer);

      const result = await controller.findOne('site-id', true);

      expect(result).toEqual(siteWithServer);
      expect(sitesService.findOneWithServer).toHaveBeenCalledWith('site-id');
    });
  });

  describe('update', () => {
    it('should update a site', async () => {
      const updateSiteDto = { domain: 'updated-example.com' };
      const updatedSite = { ...mockSite, ...updateSiteDto };
      sitesService.update.mockResolvedValue(updatedSite);

      const result = await controller.update('site-id', updateSiteDto);

      expect(result).toEqual(updatedSite);
      expect(sitesService.update).toHaveBeenCalledWith('site-id', updateSiteDto);
    });
  });

  describe('remove', () => {
    it('should delete a site', async () => {
      sitesService.remove.mockResolvedValue(undefined);

      await controller.remove('site-id');

      expect(sitesService.remove).toHaveBeenCalledWith('site-id');
    });
  });

  describe('performHealthCheck', () => {
    it('should perform health check without force', async () => {
      sitesService.performHealthCheck.mockResolvedValue(mockHealthCheckResult);

      const result = await controller.performHealthCheck('site-id', false);

      expect(result).toEqual(mockHealthCheckResult);
      expect(sitesService.performHealthCheck).toHaveBeenCalledWith('site-id', false);
    });

    it('should perform health check with force', async () => {
      sitesService.performHealthCheck.mockResolvedValue(mockHealthCheckResult);

      const result = await controller.performHealthCheck('site-id', true);

      expect(result).toEqual(mockHealthCheckResult);
      expect(sitesService.performHealthCheck).toHaveBeenCalledWith('site-id', true);
    });
  });

  describe('detectWordPressInstallation', () => {
    it('should detect WordPress installation', async () => {
      const detectionResult = {
        detected: true,
        path: '/var/www/html/wp',
        version: '6.4.2',
        isMultisite: false,
        siteUrl: 'https://example.com',
        adminUrl: 'https://example.com/wp-admin',
        dbHost: 'localhost',
        dbName: 'wp_database',
        tablePrefix: 'wp_',
        activeTheme: 'twentytwentyfour',
        activePlugins: ['akismet'],
      };
      sitesService.detectWordPressInstallation.mockResolvedValue(detectionResult);

      const result = await controller.detectWordPressInstallation('site-id');

      expect(result).toEqual(detectionResult);
      expect(sitesService.detectWordPressInstallation).toHaveBeenCalledWith('site-id');
    });
  });

  describe('detectMultisiteConfiguration', () => {
    it('should detect multisite configuration', async () => {
      const multisiteResult = {
        isMultisite: true,
        networkSites: [
          { blogId: 1, domain: 'example.com', path: '/', siteUrl: 'https://example.com/' },
          { blogId: 2, domain: 'sub.example.com', path: '/', siteUrl: 'https://sub.example.com/' },
        ],
        networkAdmin: 'https://example.com/wp-admin/network/',
      };
      sitesService.detectMultisiteConfiguration.mockResolvedValue(multisiteResult);

      const result = await controller.detectMultisiteConfiguration('site-id');

      expect(result).toEqual(multisiteResult);
      expect(sitesService.detectMultisiteConfiguration).toHaveBeenCalledWith('site-id');
    });
  });

  describe('findByDomain', () => {
    it('should find site by domain', async () => {
      sitesService.findByDomain.mockResolvedValue(mockSite);

      const result = await controller.findByDomain('example.com');

      expect(result).toEqual(mockSite);
      expect(sitesService.findByDomain).toHaveBeenCalledWith('example.com');
    });

    it('should return null when site not found by domain', async () => {
      sitesService.findByDomain.mockResolvedValue(null);

      const result = await controller.findByDomain('nonexistent.com');

      expect(result).toBeNull();
      expect(sitesService.findByDomain).toHaveBeenCalledWith('nonexistent.com');
    });
  });
});