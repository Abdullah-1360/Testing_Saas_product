import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { VerificationService } from './verification.service';
import { PrismaService } from '@/database/prisma.service';
import { LoggerService } from '@/common/services/logger.service';
import { VerifyIncidentDto, VerifySiteDto } from '../dto/verification.dto';

// Mock fetch globally
global.fetch = jest.fn();

describe('VerificationService', () => {
  let service: VerificationService;
  let prismaService: any;
  let loggerService: jest.Mocked<LoggerService>;

  const mockSite = {
    id: 'site-1',
    serverId: 'server-1',
    domain: 'example.com',
    documentRoot: '/var/www/html',
    wordpressPath: '/var/www/html',
    isMultisite: false,
    siteUrl: 'https://example.com',
    adminUrl: 'https://example.com/wp-admin',
    isActive: true,
    lastHealthCheck: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    server: {
      id: 'server-1',
      name: 'Test Server',
      hostname: 'test.example.com',
    },
  };

  const mockHealthyResponse = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Test Site</title>
      <link rel="canonical" href="https://example.com/" />
    </head>
    <body>
      <header class="site-header">
        <nav>Navigation</nav>
      </header>
      <main>Content</main>
      <footer class="site-footer">
        Footer content
      </footer>
    </body>
    </html>
  `;

  const mockLoginResponse = `
    <!DOCTYPE html>
    <html>
    <head><title>Log In</title></head>
    <body>
      <form name="loginform" id="loginform" action="wp-login.php" method="post">
        <input type="text" name="log" id="user_login" />
        <input type="password" name="pwd" id="user_pass" />
        <input type="submit" name="wp-submit" id="wp-submit" value="Log In" />
      </form>
    </body>
    </html>
  `;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VerificationService,
        {
          provide: PrismaService,
          useValue: {
            site: {
              findUnique: jest.fn(),
            },
            verificationResult: {
              create: jest.fn(),
            },
          },
        },
        {
          provide: LoggerService,
          useValue: {
            logAuditEvent: jest.fn(),
            error: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<VerificationService>(VerificationService);
    prismaService = module.get(PrismaService);
    loggerService = module.get(LoggerService);

    // Reset mocks
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('verifyIncident', () => {
    const mockVerifyIncidentDto: VerifyIncidentDto = {
      incidentId: 'incident-1',
      siteUrl: 'https://example.com',
      adminUrl: 'https://example.com/wp-admin',
      internalUrls: ['https://example.com/wp-admin/', 'https://example.com/wp-content/'],
      skipChecks: [],
    };

    it('should perform comprehensive verification successfully', async () => {
      // Mock successful HTTP responses
      (fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: () => Promise.resolve(mockHealthyResponse),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: () => Promise.resolve(mockHealthyResponse),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: () => Promise.resolve(mockHealthyResponse),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: () => Promise.resolve(mockHealthyResponse),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: () => Promise.resolve(mockHealthyResponse),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: () => Promise.resolve(mockHealthyResponse),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: () => Promise.resolve(mockHealthyResponse),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: () => Promise.resolve(mockHealthyResponse),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: () => Promise.resolve(mockLoginResponse),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: () => Promise.resolve(''),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: () => Promise.resolve(''),
        });

      prismaService.verificationResult.create.mockResolvedValue({
        id: 'result-1',
        incidentId: 'incident-1',
        verificationType: 'comprehensive_verification',
        status: 'PASSED',
        details: {},
        timestamp: new Date(),
      });

      const result = await service.verifyIncident(mockVerifyIncidentDto);

      expect(result.overall.success).toBe(true);
      expect(result.overall.healthy).toBe(true);
      expect(result.overall.totalChecks).toBe(10);
      expect(result.overall.passedChecks).toBe(10);
      expect(result.overall.failedChecks).toBe(0);

      // Verify individual checks
      expect(result.httpStatus.success).toBe(true);
      expect(result.fatalErrorCheck.success).toBe(true);
      expect(result.maintenanceCheck.success).toBe(true);
      expect(result.whiteScreenCheck.success).toBe(true);
      expect(result.titleTagCheck.success).toBe(true);
      expect(result.canonicalTagCheck.success).toBe(true);
      expect(result.footerMarkerCheck.success).toBe(true);
      expect(result.headerMarkerCheck.success).toBe(true);
      expect(result.wpLoginCheck.success).toBe(true);
      expect(result.internalUrlCheck.success).toBe(true);

      // Verify database storage
      expect(prismaService.verificationResult.create).toHaveBeenCalledTimes(11); // 1 overall + 10 individual checks

      // Verify audit logging
      expect(loggerService.logAuditEvent).toHaveBeenCalledWith(
        'incident_verification_started',
        'incident',
        expect.objectContaining({
          incidentId: 'incident-1',
          siteUrl: 'https://example.com',
          adminUrl: 'https://example.com/wp-admin',
        }),
        'VerificationService'
      );

      expect(loggerService.logAuditEvent).toHaveBeenCalledWith(
        'incident_verification_completed',
        'incident',
        expect.objectContaining({
          incidentId: 'incident-1',
          success: true,
          healthy: true,
        }),
        'VerificationService'
      );
    });

    it('should handle HTTP connectivity failures', async () => {
      // Mock failed HTTP response
      (fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

      prismaService.verificationResult.create.mockResolvedValue({
        id: 'result-1',
        incidentId: 'incident-1',
        verificationType: 'comprehensive_verification',
        status: 'FAILED',
        details: {},
        timestamp: new Date(),
      });

      const result = await service.verifyIncident(mockVerifyIncidentDto);

      expect(result.overall.success).toBe(false);
      expect(result.overall.healthy).toBe(false);
      expect(result.overall.failedChecks).toBeGreaterThan(0);

      // Verify that the service handled the error gracefully
      expect(result.httpStatus.success).toBe(false);
      expect(result.httpStatus.issues.length).toBeGreaterThan(0);
    });

    it('should detect fatal errors in response', async () => {
      const fatalErrorResponse = `
        <br />
        <b>Fatal error</b>: Call to undefined function wp_get_current_user() in <b>/var/www/html/wp-content/themes/theme/functions.php</b> on line <b>123</b><br />
      `;

      (fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve(fatalErrorResponse),
      });

      prismaService.verificationResult.create.mockResolvedValue({
        id: 'result-1',
        incidentId: 'incident-1',
        verificationType: 'fatal_error_check',
        status: 'FAILED',
        details: {},
        timestamp: new Date(),
      });

      const result = await service.verifyIncident(mockVerifyIncidentDto);

      expect(result.fatalErrorCheck.success).toBe(false);
      expect(result.fatalErrorCheck.issues).toContain('Fatal PHP errors detected in response');
      expect(result.overall.healthy).toBe(false);
    });

    it('should detect maintenance mode', async () => {
      const maintenanceResponse = `
        <!DOCTYPE html>
        <html>
        <head><title>Maintenance Mode</title></head>
        <body>
          <h1>Site is down for maintenance</h1>
          <p>We'll be back soon!</p>
        </body>
        </html>
      `;

      (fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 503,
        text: () => Promise.resolve(maintenanceResponse),
      });

      prismaService.verificationResult.create.mockResolvedValue({
        id: 'result-1',
        incidentId: 'incident-1',
        verificationType: 'maintenance_check',
        status: 'FAILED',
        details: {},
        timestamp: new Date(),
      });

      const result = await service.verifyIncident(mockVerifyIncidentDto);

      expect(result.maintenanceCheck.success).toBe(false);
      expect(result.maintenanceCheck.issues).toContain('Site is in maintenance mode');
    });

    it('should detect white screen of death', async () => {
      const whiteScreenResponse = '';

      (fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve(whiteScreenResponse),
      });

      prismaService.verificationResult.create.mockResolvedValue({
        id: 'result-1',
        incidentId: 'incident-1',
        verificationType: 'white_screen_check',
        status: 'FAILED',
        details: {},
        timestamp: new Date(),
      });

      const result = await service.verifyIncident(mockVerifyIncidentDto);

      expect(result.whiteScreenCheck.success).toBe(false);
      expect(result.whiteScreenCheck.issues).toContain('White screen of death detected');
    });

    it('should detect missing title tag', async () => {
      const noTitleResponse = `
        <!DOCTYPE html>
        <html>
        <head></head>
        <body>Content without title</body>
        </html>
      `;

      (fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve(noTitleResponse),
      });

      prismaService.verificationResult.create.mockResolvedValue({
        id: 'result-1',
        incidentId: 'incident-1',
        verificationType: 'title_tag_check',
        status: 'FAILED',
        details: {},
        timestamp: new Date(),
      });

      const result = await service.verifyIncident(mockVerifyIncidentDto);

      expect(result.titleTagCheck.success).toBe(false);
      expect(result.titleTagCheck.issues).toContain('Title tag missing from response');
      expect(result.overall.healthy).toBe(false); // Title tag is critical
    });

    it('should detect missing canonical tag', async () => {
      const noCanonicalResponse = `
        <!DOCTYPE html>
        <html>
        <head><title>Test</title></head>
        <body>Content without canonical</body>
        </html>
      `;

      (fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve(noCanonicalResponse),
      });

      prismaService.verificationResult.create.mockResolvedValue({
        id: 'result-1',
        incidentId: 'incident-1',
        verificationType: 'canonical_tag_check',
        status: 'FAILED',
        details: {},
        timestamp: new Date(),
      });

      const result = await service.verifyIncident(mockVerifyIncidentDto);

      expect(result.canonicalTagCheck.success).toBe(false);
      expect(result.canonicalTagCheck.issues).toContain('Canonical tag missing from response');
      // Canonical tag is not critical for overall health
    });

    it('should skip specified checks', async () => {
      const skipChecksDto: VerifyIncidentDto = {
        ...mockVerifyIncidentDto,
        skipChecks: ['fatal_error_check', 'maintenance_check', 'canonical_tag_check'],
      };

      (fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve(mockHealthyResponse),
      });

      prismaService.verificationResult.create.mockResolvedValue({
        id: 'result-1',
        incidentId: 'incident-1',
        verificationType: 'comprehensive_verification',
        status: 'PASSED',
        details: {},
        timestamp: new Date(),
      });

      const result = await service.verifyIncident(skipChecksDto);

      expect(result.overall.totalChecks).toBe(7); // 10 - 3 skipped checks
      expect(result.fatalErrorCheck.issues).toContain('Check not performed');
      expect(result.maintenanceCheck.issues).toContain('Check not performed');
      expect(result.canonicalTagCheck.issues).toContain('Check not performed');
    });
  });

  describe('verifySite', () => {
    const mockVerifySiteDto: VerifySiteDto = {
      siteId: 'site-1',
      force: false,
      internalUrls: [],
      skipChecks: [],
    };

    it('should verify site successfully', async () => {
      prismaService.site.findUnique.mockResolvedValue(mockSite as any);

      // Mock successful HTTP responses for all checks
      (fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: () => Promise.resolve(mockHealthyResponse),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: () => Promise.resolve(mockHealthyResponse),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: () => Promise.resolve(mockHealthyResponse),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: () => Promise.resolve(mockHealthyResponse),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: () => Promise.resolve(mockHealthyResponse),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: () => Promise.resolve(mockHealthyResponse),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: () => Promise.resolve(mockHealthyResponse),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: () => Promise.resolve(mockHealthyResponse),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: () => Promise.resolve(mockLoginResponse),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: () => Promise.resolve(''),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: () => Promise.resolve(''),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: () => Promise.resolve(''),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: () => Promise.resolve(''),
        });

      const result = await service.verifySite(mockVerifySiteDto);

      expect(result.success).toBe(true);
      expect(result.healthy).toBe(true);
      expect(result.totalChecks).toBe(10);
      expect(result.passedChecks).toBe(10);
      expect(result.failedChecks).toBe(0);

      expect(prismaService.site.findUnique).toHaveBeenCalledWith({
        where: { id: 'site-1' },
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

    it('should throw NotFoundException for non-existent site', async () => {
      prismaService.site.findUnique.mockResolvedValue(null);

      await expect(service.verifySite(mockVerifySiteDto)).rejects.toThrow(
        new NotFoundException('Site with ID site-1 not found')
      );
    });
  });

  describe('WordPress login check', () => {
    it('should detect accessible WordPress login with form', async () => {
      (fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve(mockLoginResponse),
      });

      const verifyDto: VerifyIncidentDto = {
        incidentId: 'incident-1',
        siteUrl: 'https://example.com',
        adminUrl: 'https://example.com/wp-admin',
        skipChecks: ['http_status', 'fatal_error_check', 'maintenance_check', 'white_screen_check', 
                     'title_tag_check', 'canonical_tag_check', 'footer_marker_check', 
                     'header_marker_check', 'internal_url_check'],
      };

      prismaService.verificationResult.create.mockResolvedValue({
        id: 'result-1',
        incidentId: 'incident-1',
        verificationType: 'wp_login_check',
        status: 'PASSED',
        details: {},
        timestamp: new Date(),
      });

      const result = await service.verifyIncident(verifyDto);

      expect(result.wpLoginCheck.success).toBe(true);
      expect(result.wpLoginCheck.details['accessible']).toBe(true);
      expect(result.wpLoginCheck.details['loginFormPresent']).toBe(true);
    });

    it('should detect inaccessible WordPress login', async () => {
      (fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 404,
        text: () => Promise.resolve('Not Found'),
      });

      const verifyDto: VerifyIncidentDto = {
        incidentId: 'incident-1',
        siteUrl: 'https://example.com',
        adminUrl: 'https://example.com/wp-admin',
        skipChecks: ['http_status', 'fatal_error_check', 'maintenance_check', 'white_screen_check', 
                     'title_tag_check', 'canonical_tag_check', 'footer_marker_check', 
                     'header_marker_check', 'internal_url_check'],
      };

      prismaService.verificationResult.create.mockResolvedValue({
        id: 'result-1',
        incidentId: 'incident-1',
        verificationType: 'wp_login_check',
        status: 'FAILED',
        details: {},
        timestamp: new Date(),
      });

      const result = await service.verifyIncident(verifyDto);

      expect(result.wpLoginCheck.success).toBe(false);
      expect(result.wpLoginCheck.issues).toContain('WordPress login page not accessible');
    });
  });

  describe('Internal URL accessibility', () => {
    it('should check default internal URLs when none provided', async () => {
      (fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: () => Promise.resolve(''),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: () => Promise.resolve(''),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: () => Promise.resolve(''),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: () => Promise.resolve(''),
        });

      const verifyDto: VerifyIncidentDto = {
        incidentId: 'incident-1',
        siteUrl: 'https://example.com',
        adminUrl: 'https://example.com/wp-admin',
        skipChecks: ['http_status', 'fatal_error_check', 'maintenance_check', 'white_screen_check', 
                     'title_tag_check', 'canonical_tag_check', 'footer_marker_check', 
                     'header_marker_check', 'wp_login_check'],
      };

      prismaService.verificationResult.create.mockResolvedValue({
        id: 'result-1',
        incidentId: 'incident-1',
        verificationType: 'internal_url_check',
        status: 'PASSED',
        details: {},
        timestamp: new Date(),
      });

      const result = await service.verifyIncident(verifyDto);

      expect(result.internalUrlCheck.success).toBe(true);
      expect(result.internalUrlCheck.details['totalUrls']).toBe(4);
      expect(result.internalUrlCheck.details['accessibleUrls']).toBe(4);
      expect(result.internalUrlCheck.details['inaccessibleUrls']).toBe(0);

      // Verify default URLs were checked
      expect(fetch).toHaveBeenCalledWith('https://example.com/wp-admin/', expect.any(Object));
      expect(fetch).toHaveBeenCalledWith('https://example.com/wp-content/', expect.any(Object));
      expect(fetch).toHaveBeenCalledWith('https://example.com/wp-includes/', expect.any(Object));
      expect(fetch).toHaveBeenCalledWith('https://example.com/wp-json/wp/v2/', expect.any(Object));
    });

    it('should check custom internal URLs when provided', async () => {
      (fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: () => Promise.resolve(''),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          text: () => Promise.resolve(''),
        });

      const verifyDto: VerifyIncidentDto = {
        incidentId: 'incident-1',
        siteUrl: 'https://example.com',
        adminUrl: 'https://example.com/wp-admin',
        internalUrls: ['https://example.com/custom-page/', 'https://example.com/missing-page/'],
        skipChecks: ['http_status', 'fatal_error_check', 'maintenance_check', 'white_screen_check', 
                     'title_tag_check', 'canonical_tag_check', 'footer_marker_check', 
                     'header_marker_check', 'wp_login_check'],
      };

      prismaService.verificationResult.create.mockResolvedValue({
        id: 'result-1',
        incidentId: 'incident-1',
        verificationType: 'internal_url_check',
        status: 'PASSED',
        details: {},
        timestamp: new Date(),
      });

      const result = await service.verifyIncident(verifyDto);

      expect(result.internalUrlCheck.success).toBe(true); // At least one URL is accessible
      expect(result.internalUrlCheck.details['totalUrls']).toBe(2);
      expect(result.internalUrlCheck.details['accessibleUrls']).toBe(1);
      expect(result.internalUrlCheck.details['inaccessibleUrls']).toBe(1);
      expect(result.internalUrlCheck.issues).toContain('Internal URL not accessible: https://example.com/missing-page/');
    });
  });
});