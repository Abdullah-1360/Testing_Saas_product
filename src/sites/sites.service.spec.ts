import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { SitesService } from './sites.service';
import { PrismaService } from '@/database/prisma.service';
import { LoggerService } from '@/common/services/logger.service';
import { SSHService } from '@/ssh/services/ssh.service';
import { DiscoveryService } from '@/servers/discovery.service';
import { Site } from '@prisma/client';

describe('SitesService', () => {
  let service: SitesService;
  let prismaService: jest.Mocked<PrismaService>;
  let loggerService: jest.Mocked<LoggerService>;
  let sshService: jest.Mocked<SSHService>;
  let discoveryService: jest.Mocked<DiscoveryService>;

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

  const mockServer = {
    id: '123e4567-e89b-12d3-a456-426614174001',
    name: 'Test Server',
    hostname: 'test.example.com',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SitesService,
        {
          provide: PrismaService,
          useValue: {
            site: {
              create: jest.fn(),
              findMany: jest.fn(),
              findUnique: jest.fn(),
              findFirst: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
            },
            server: {
              findUnique: jest.fn(),
            },
          },
        },
        {
          provide: LoggerService,
          useValue: {
            logAuditEvent: jest.fn(),
            error: jest.fn(),
            warn: jest.fn(),
          },
        },
        {
          provide: SSHService,
          useValue: {
            connect: jest.fn(),
            disconnect: jest.fn(),
            executeCommand: jest.fn(),
          },
        },
        {
          provide: DiscoveryService,
          useValue: {
            detectWordPressInstallation: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<SitesService>(SitesService);
    prismaService = module.get(PrismaService);
    loggerService = module.get(LoggerService);
    sshService = module.get(SSHService);
    discoveryService = module.get(DiscoveryService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    const createSiteDto = {
      serverId: '123e4567-e89b-12d3-a456-426614174001',
      domain: 'example.com',
      documentRoot: '/var/www/html',
      wordpressPath: '/var/www/html/wp',
      siteUrl: 'https://example.com',
      adminUrl: 'https://example.com/wp-admin',
    };

    it('should create a site successfully', async () => {
      prismaService.server.findUnique.mockResolvedValue(mockServer as any);
      prismaService.site.findFirst.mockResolvedValue(null);
      prismaService.site.create.mockResolvedValue(mockSite);

      const result = await service.create(createSiteDto);

      expect(result).toEqual(mockSite);
      expect(prismaService.server.findUnique).toHaveBeenCalledWith({
        where: { id: createSiteDto.serverId },
      });
      expect(prismaService.site.findFirst).toHaveBeenCalledWith({
        where: { domain: createSiteDto.domain },
      });
      expect(prismaService.site.create).toHaveBeenCalledWith({
        data: {
          serverId: createSiteDto.serverId,
          domain: createSiteDto.domain,
          documentRoot: createSiteDto.documentRoot,
          wordpressPath: createSiteDto.wordpressPath,
          isMultisite: false,
          siteUrl: createSiteDto.siteUrl,
          adminUrl: createSiteDto.adminUrl,
          isActive: true,
        },
      });
      expect(loggerService.logAuditEvent).toHaveBeenCalledWith(
        'site_created',
        'site',
        expect.objectContaining({
          siteId: mockSite.id,
          domain: mockSite.domain,
          serverId: mockSite.serverId,
        }),
        'SitesService'
      );
    });

    it('should throw NotFoundException when server does not exist', async () => {
      prismaService.server.findUnique.mockResolvedValue(null);

      await expect(service.create(createSiteDto)).rejects.toThrow(NotFoundException);
      expect(prismaService.server.findUnique).toHaveBeenCalledWith({
        where: { id: createSiteDto.serverId },
      });
    });

    it('should throw ConflictException when site with domain already exists', async () => {
      prismaService.server.findUnique.mockResolvedValue(mockServer as any);
      prismaService.site.findFirst.mockResolvedValue(mockSite);

      await expect(service.create(createSiteDto)).rejects.toThrow(ConflictException);
      expect(prismaService.site.findFirst).toHaveBeenCalledWith({
        where: { domain: createSiteDto.domain },
      });
    });
  });

  describe('findAll', () => {
    it('should return all sites without server info', async () => {
      const sites = [mockSite];
      prismaService.site.findMany.mockResolvedValue(sites);

      const result = await service.findAll(false);

      expect(result).toEqual(sites);
      expect(prismaService.site.findMany).toHaveBeenCalledWith({
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should return all sites with server info', async () => {
      const sitesWithServer = [{ ...mockSite, server: mockServer }];
      prismaService.site.findMany.mockResolvedValue(sitesWithServer);

      const result = await service.findAll(true);

      expect(result).toEqual(sitesWithServer);
      expect(prismaService.site.findMany).toHaveBeenCalledWith({
        orderBy: { createdAt: 'desc' },
        include: {
          server: {
            select: {
              id: true,
              name: true,
              hostname: true,
            },
          },
        },
      });
    });
  });

  describe('findOne', () => {
    it('should return a site by ID', async () => {
      prismaService.site.findUnique.mockResolvedValue(mockSite);

      const result = await service.findOne(mockSite.id);

      expect(result).toEqual(mockSite);
      expect(prismaService.site.findUnique).toHaveBeenCalledWith({
        where: { id: mockSite.id },
      });
    });

    it('should throw NotFoundException when site does not exist', async () => {
      prismaService.site.findUnique.mockResolvedValue(null);

      await expect(service.findOne('nonexistent-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    const updateSiteDto = {
      domain: 'updated-example.com',
      isActive: false,
    };

    it('should update a site successfully', async () => {
      const updatedSite = { ...mockSite, ...updateSiteDto };
      prismaService.site.findUnique.mockResolvedValue(mockSite);
      prismaService.site.findFirst.mockResolvedValue(null);
      prismaService.site.update.mockResolvedValue(updatedSite);

      const result = await service.update(mockSite.id, updateSiteDto);

      expect(result).toEqual(updatedSite);
      expect(prismaService.site.update).toHaveBeenCalledWith({
        where: { id: mockSite.id },
        data: updateSiteDto,
      });
      expect(loggerService.logAuditEvent).toHaveBeenCalledWith(
        'site_updated',
        'site',
        expect.objectContaining({
          siteId: updatedSite.id,
          domain: updatedSite.domain,
          fieldsUpdated: Object.keys(updateSiteDto),
        }),
        'SitesService'
      );
    });

    it('should throw ConflictException when updating to existing domain', async () => {
      const existingSite = { ...mockSite, id: 'different-id' };
      prismaService.site.findUnique.mockResolvedValue(mockSite);
      prismaService.site.findFirst.mockResolvedValue(existingSite);

      await expect(service.update(mockSite.id, updateSiteDto)).rejects.toThrow(ConflictException);
    });
  });

  describe('remove', () => {
    it('should delete a site successfully', async () => {
      prismaService.site.findUnique.mockResolvedValue(mockSite);
      prismaService.site.delete.mockResolvedValue(mockSite);

      await service.remove(mockSite.id);

      expect(prismaService.site.delete).toHaveBeenCalledWith({
        where: { id: mockSite.id },
      });
      expect(loggerService.logAuditEvent).toHaveBeenCalledWith(
        'site_deleted',
        'site',
        expect.objectContaining({
          siteId: mockSite.id,
          domain: mockSite.domain,
        }),
        'SitesService'
      );
    });

    it('should throw NotFoundException when site does not exist', async () => {
      prismaService.site.findUnique.mockResolvedValue(null);

      await expect(service.remove('nonexistent-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findByServerId', () => {
    it('should return sites for a specific server', async () => {
      const sites = [mockSite];
      prismaService.site.findMany.mockResolvedValue(sites);

      const result = await service.findByServerId(mockServer.id);

      expect(result).toEqual(sites);
      expect(prismaService.site.findMany).toHaveBeenCalledWith({
        where: { serverId: mockServer.id },
        orderBy: { domain: 'asc' },
      });
    });
  });

  describe('findByDomain', () => {
    it('should return site by domain', async () => {
      prismaService.site.findFirst.mockResolvedValue(mockSite);

      const result = await service.findByDomain(mockSite.domain);

      expect(result).toEqual(mockSite);
      expect(prismaService.site.findFirst).toHaveBeenCalledWith({
        where: { domain: mockSite.domain },
      });
    });

    it('should return null when site not found', async () => {
      prismaService.site.findFirst.mockResolvedValue(null);

      const result = await service.findByDomain('nonexistent.com');

      expect(result).toBeNull();
    });
  });

  describe('detectWordPressInstallation', () => {
    it('should detect WordPress installation successfully', async () => {
      const siteWithServer = { ...mockSite, server: mockServer };
      const mockConnection = { id: 'connection-id' };
      const mockWpInfo = {
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

      prismaService.site.findUnique.mockResolvedValue(siteWithServer as any);
      sshService.connect.mockResolvedValue(mockConnection as any);
      discoveryService.detectWordPressInstallation.mockResolvedValue(mockWpInfo);
      sshService.disconnect.mockResolvedValue(undefined);

      const result = await service.detectWordPressInstallation(mockSite.id);

      expect(result).toEqual({
        detected: true,
        path: mockWpInfo.path,
        version: mockWpInfo.version,
        isMultisite: mockWpInfo.isMultisite,
        siteUrl: mockWpInfo.siteUrl,
        adminUrl: mockWpInfo.adminUrl,
        dbHost: mockWpInfo.dbHost,
        dbName: mockWpInfo.dbName,
        tablePrefix: mockWpInfo.tablePrefix,
        activeTheme: mockWpInfo.activeTheme,
        activePlugins: mockWpInfo.activePlugins,
      });

      expect(sshService.connect).toHaveBeenCalledWith(mockSite.serverId);
      expect(discoveryService.detectWordPressInstallation).toHaveBeenCalledWith(
        mockConnection.id,
        mockSite.domain,
        mockSite.documentRoot
      );
      expect(sshService.disconnect).toHaveBeenCalledWith(mockConnection.id);
      expect(loggerService.logAuditEvent).toHaveBeenCalledWith(
        'wordpress_detected',
        'site',
        expect.objectContaining({
          siteId: mockSite.id,
          domain: mockSite.domain,
          wordpressPath: mockWpInfo.path,
          version: mockWpInfo.version,
          isMultisite: mockWpInfo.isMultisite,
        }),
        'SitesService'
      );
    });

    it('should return not detected when WordPress not found', async () => {
      const siteWithServer = { ...mockSite, server: mockServer };
      const mockConnection = { id: 'connection-id' };

      prismaService.site.findUnique.mockResolvedValue(siteWithServer as any);
      sshService.connect.mockResolvedValue(mockConnection as any);
      discoveryService.detectWordPressInstallation.mockResolvedValue(null);
      sshService.disconnect.mockResolvedValue(undefined);

      const result = await service.detectWordPressInstallation(mockSite.id);

      expect(result).toEqual({ detected: false });
    });
  });

  describe('detectMultisiteConfiguration', () => {
    it('should detect multisite configuration', async () => {
      const siteWithServer = { ...mockSite, server: mockServer };
      const mockConnection = { id: 'connection-id' };

      prismaService.site.findUnique.mockResolvedValue(siteWithServer as any);
      sshService.connect.mockResolvedValue(mockConnection as any);
      sshService.executeCommand
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: 'define("MULTISITE", true);',
          stderr: '',
          executionTime: 100,
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: 'DB_NAME=wp_multisite\nDB_HOST=localhost',
          stderr: '',
          executionTime: 100,
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: '1\texample.com\t/\n2\tsub.example.com\t/',
          stderr: '',
          executionTime: 100,
        });
      sshService.disconnect.mockResolvedValue(undefined);

      const result = await service.detectMultisiteConfiguration(mockSite.id);

      expect(result.isMultisite).toBe(true);
      expect(result.networkAdmin).toBe('https://example.com/wp-admin/network/');
      expect(result.networkSites).toHaveLength(2);
      expect(loggerService.logAuditEvent).toHaveBeenCalledWith(
        'multisite_detection_completed',
        'site',
        expect.objectContaining({
          siteId: mockSite.id,
          domain: mockSite.domain,
          isMultisite: true,
          networkSitesCount: 2,
        }),
        'SitesService'
      );
    });

    it('should return not multisite when not detected', async () => {
      const siteWithServer = { ...mockSite, server: mockServer };
      const mockConnection = { id: 'connection-id' };

      prismaService.site.findUnique.mockResolvedValue(siteWithServer as any);
      sshService.connect.mockResolvedValue(mockConnection as any);
      sshService.executeCommand.mockResolvedValue({
        exitCode: 1,
        stdout: '',
        stderr: 'grep: pattern not found',
        executionTime: 100,
      });
      sshService.disconnect.mockResolvedValue(undefined);

      const result = await service.detectMultisiteConfiguration(mockSite.id);

      expect(result.isMultisite).toBe(false);
    });
  });

  describe('getStats', () => {
    it('should return site statistics', async () => {
      const sites = [
        mockSite,
        { ...mockSite, id: 'site-2', isActive: false, isMultisite: true },
      ];
      prismaService.site.findMany.mockResolvedValue(sites);

      const result = await service.getStats();

      expect(result).toEqual({
        total: 2,
        active: 1,
        inactive: 1,
        multisite: 1,
        healthyCount: 0,
        unhealthyCount: 0,
        byServer: {
          [mockSite.serverId]: 2,
        },
      });
    });
  });

  describe('performHealthCheck', () => {
    beforeEach(() => {
      // Mock fetch globally for health check tests
      global.fetch = jest.fn();
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should perform successful health check', async () => {
      const siteWithServer = { ...mockSite, server: mockServer };
      const mockResponse = {
        ok: true,
        status: 200,
        text: jest.fn().mockResolvedValue(`
          <html>
            <head><title>Test Site</title><link rel="canonical" href="https://example.com"/></head>
            <body>
              <header>Site Header</header>
              <div>Content with wp-content references</div>
              <footer>Site Footer</footer>
            </body>
          </html>
        `),
      };

      prismaService.site.findUnique.mockResolvedValue(siteWithServer as any);
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce(mockResponse) // Main site check
        .mockResolvedValueOnce({ // wp-login check
          ok: true,
          status: 200,
          text: jest.fn().mockResolvedValue('<form class="wp-login-form">'),
        });
      prismaService.site.update.mockResolvedValue(siteWithServer);

      const result = await service.performHealthCheck(mockSite.id, true);

      expect(result.healthy).toBe(true);
      expect(result.statusCode).toBe(200);
      expect(result.wordpressDetected).toBe(true);
      expect(result.titleTagPresent).toBe(true);
      expect(result.canonicalTagPresent).toBe(true);
      expect(result.footerMarkersPresent).toBe(true);
      expect(result.headerMarkersPresent).toBe(true);
      expect(result.wpLoginAccessible).toBe(true);
      expect(result.maintenanceMode).toBe(false);
      expect(result.fatalErrors).toBe(false);
      expect(result.whiteScreen).toBe(false);
      expect(result.issues).toHaveLength(0);

      expect(loggerService.logAuditEvent).toHaveBeenCalledWith(
        'health_check_started',
        'site',
        expect.objectContaining({
          siteId: mockSite.id,
          domain: mockSite.domain,
          force: true,
        }),
        'SitesService'
      );

      expect(loggerService.logAuditEvent).toHaveBeenCalledWith(
        'health_check_completed',
        'site',
        expect.objectContaining({
          siteId: mockSite.id,
          domain: mockSite.domain,
          healthy: true,
          issuesCount: 0,
        }),
        'SitesService'
      );
    });

    it('should detect maintenance mode', async () => {
      const siteWithServer = { ...mockSite, server: mockServer };
      const mockResponse = {
        ok: true,
        status: 200,
        text: jest.fn().mockResolvedValue('<html><body>Site is under maintenance</body></html>'),
      };

      prismaService.site.findUnique.mockResolvedValue(siteWithServer as any);
      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);
      prismaService.site.update.mockResolvedValue(siteWithServer);

      const result = await service.performHealthCheck(mockSite.id, true);

      expect(result.healthy).toBe(false);
      expect(result.maintenanceMode).toBe(true);
      expect(result.issues).toContain('Site is in maintenance mode');
    });

    it('should detect fatal errors', async () => {
      const siteWithServer = { ...mockSite, server: mockServer };
      const mockResponse = {
        ok: true,
        status: 200,
        text: jest.fn().mockResolvedValue('<html><body>Fatal error: Call to undefined function</body></html>'),
      };

      prismaService.site.findUnique.mockResolvedValue(siteWithServer as any);
      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);
      prismaService.site.update.mockResolvedValue(siteWithServer);

      const result = await service.performHealthCheck(mockSite.id, true);

      expect(result.healthy).toBe(false);
      expect(result.fatalErrors).toBe(true);
      expect(result.issues).toContain('Fatal PHP errors detected');
    });

    it('should detect white screen of death', async () => {
      const siteWithServer = { ...mockSite, server: mockServer };
      const mockResponse = {
        ok: true,
        status: 200,
        text: jest.fn().mockResolvedValue(''),
      };

      prismaService.site.findUnique.mockResolvedValue(siteWithServer as any);
      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);
      prismaService.site.update.mockResolvedValue(siteWithServer);

      const result = await service.performHealthCheck(mockSite.id, true);

      expect(result.healthy).toBe(false);
      expect(result.whiteScreen).toBe(true);
      expect(result.issues).toContain('White screen of death detected');
    });

    it('should handle HTTP connectivity failure', async () => {
      const siteWithServer = { ...mockSite, server: mockServer };

      prismaService.site.findUnique.mockResolvedValue(siteWithServer as any);
      (global.fetch as jest.Mock).mockRejectedValue(new Error('Connection failed'));
      prismaService.site.update.mockResolvedValue(siteWithServer);

      const result = await service.performHealthCheck(mockSite.id, true);

      expect(result.healthy).toBe(false);
      expect(result.issues).toContain('HTTP connectivity failed: Connection failed');
    });
  });
});