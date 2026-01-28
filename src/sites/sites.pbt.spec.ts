import { Test, TestingModule } from '@nestjs/testing';
import { SitesService } from './sites.service';
import { PrismaService } from '@/database/prisma.service';
import { LoggerService } from '@/common/services/logger.service';
import { SSHService } from '@/ssh/services/ssh.service';
import { DiscoveryService } from '@/servers/discovery.service';
import fc from 'fast-check';

/**
 * Property-Based Tests for Sites Service
 * **Feature: wp-autohealer**
 * 
 * These tests verify universal properties that should hold across all valid inputs
 * for the WordPress site management functionality.
 */
describe('SitesService Property-Based Tests', () => {
  let service: SitesService;
  let prismaService: jest.Mocked<PrismaService>;
  let loggerService: jest.Mocked<LoggerService>;
  let sshService: jest.Mocked<SSHService>;
  let discoveryService: jest.Mocked<DiscoveryService>;

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

  // Custom generators for domain-specific types
  const siteGenerator = () => fc.record({
    id: fc.uuid(),
    serverId: fc.uuid(),
    domain: fc.domain(),
    documentRoot: fc.string({ minLength: 1, maxLength: 500 }).map(s => `/var/www/${s}`),
    wordpressPath: fc.string({ minLength: 1, maxLength: 500 }).map(s => `/var/www/${s}/wp`),
    isMultisite: fc.boolean(),
    siteUrl: fc.webUrl(),
    adminUrl: fc.webUrl(),
    isActive: fc.boolean(),
    lastHealthCheck: fc.option(fc.date()),
    createdAt: fc.date(),
    updatedAt: fc.date(),
  });

  const createSiteDtoGenerator = () => fc.record({
    serverId: fc.uuid(),
    domain: fc.domain(),
    documentRoot: fc.string({ minLength: 1, maxLength: 500 }).map(s => `/var/www/${s}`),
    wordpressPath: fc.string({ minLength: 1, maxLength: 500 }).map(s => `/var/www/${s}/wp`),
    isMultisite: fc.option(fc.boolean()),
    siteUrl: fc.webUrl(),
    adminUrl: fc.webUrl(),
    isActive: fc.option(fc.boolean()),
  });

  const serverGenerator = () => fc.record({
    id: fc.uuid(),
    name: fc.string({ minLength: 1, maxLength: 255 }),
    hostname: fc.domain(),
  });

  const healthCheckResponseGenerator = () => fc.record({
    ok: fc.boolean(),
    status: fc.integer({ min: 100, max: 599 }),
    text: fc.constantFrom(
      // Healthy responses
      '<html><head><title>Test Site</title><link rel="canonical" href="https://example.com"/></head><body><header>Header</header><div>wp-content</div><footer>Footer</footer></body></html>',
      // Maintenance mode
      '<html><body>Site is under maintenance</body></html>',
      // Fatal error
      '<html><body>Fatal error: Call to undefined function</body></html>',
      // White screen
      '',
      // Missing elements
      '<html><body>Content without required elements</body></html>'
    ),
  });

  /**
   * **Feature: wp-autohealer, Property 1: Site Creation Audit Trail**
   * *For any* valid site creation, an audit event should be logged with complete details.
   * **Validates: Requirements 2.1, 2.4, 2.5**
   */
  it('should log audit events for all site creations', () => {
    fc.assert(
      fc.asyncProperty(
        createSiteDtoGenerator(),
        serverGenerator(),
        siteGenerator(),
        async (createDto, server, createdSite) => {
          // Setup mocks
          prismaService.server.findUnique.mockResolvedValue(server as any);
          prismaService.site.findFirst.mockResolvedValue(null);
          prismaService.site.create.mockResolvedValue(createdSite as any);

          // Execute
          await service.create(createDto);

          // Verify audit logging
          expect(loggerService.logAuditEvent).toHaveBeenCalledWith(
            'site_created',
            'site',
            expect.objectContaining({
              siteId: createdSite.id,
              domain: createdSite.domain,
              serverId: createdSite.serverId,
              serverHostname: server.hostname,
              isMultisite: createdSite.isMultisite,
            }),
            'SitesService'
          );
        }
      ),
      { numRuns: 10 }
    );
  });

  /**
   * **Feature: wp-autohealer, Property 2: Site Domain Uniqueness Enforcement**
   * *For any* site creation attempt with an existing domain, a ConflictException should be thrown.
   * **Validates: Requirements 4.6**
   */
  it('should enforce domain uniqueness across all sites', () => {
    fc.assert(
      fc.asyncProperty(
        createSiteDtoGenerator(),
        serverGenerator(),
        siteGenerator(),
        async (createDto, server, existingSite) => {
          // Setup: existing site with same domain
          const existingSiteWithSameDomain = { ...existingSite, domain: createDto.domain };
          
          prismaService.server.findUnique.mockResolvedValue(server as any);
          prismaService.site.findFirst.mockResolvedValue(existingSiteWithSameDomain as any);

          // Execute and verify
          await expect(service.create(createDto)).rejects.toThrow('Site with domain');
        }
      ),
      { numRuns: 10 }
    );
  });

  /**
   * **Feature: wp-autohealer, Property 3: Site Update Audit Trail**
   * *For any* site update operation, an audit event should be logged with field changes.
   * **Validates: Requirements 2.1, 2.5**
   */
  it('should log audit events for all site updates', () => {
    fc.assert(
      fc.asyncProperty(
        siteGenerator(),
        fc.record({
          domain: fc.option(fc.domain()),
          isActive: fc.option(fc.boolean()),
          documentRoot: fc.option(fc.string({ minLength: 1, maxLength: 500 }).map(s => `/var/www/${s}`)),
        }),
        async (existingSite, updateDto) => {
          // Filter out undefined values
          const cleanUpdateDto = Object.fromEntries(
            Object.entries(updateDto).filter(([_, value]) => value !== null)
          );

          if (Object.keys(cleanUpdateDto).length === 0) {
            return; // Skip if no fields to update
          }

          const updatedSite = { ...existingSite, ...cleanUpdateDto };

          // Setup mocks
          prismaService.site.findUnique.mockResolvedValue(existingSite as any);
          prismaService.site.findFirst.mockResolvedValue(null); // No domain conflict
          prismaService.site.update.mockResolvedValue(updatedSite as any);

          // Execute
          await service.update(existingSite.id, cleanUpdateDto);

          // Verify audit logging
          expect(loggerService.logAuditEvent).toHaveBeenCalledWith(
            'site_updated',
            'site',
            expect.objectContaining({
              siteId: updatedSite.id,
              domain: updatedSite.domain,
              fieldsUpdated: Object.keys(cleanUpdateDto),
            }),
            'SitesService'
          );
        }
      ),
      { numRuns: 10 }
    );
  });

  /**
   * **Feature: wp-autohealer, Property 4: Site Deletion Audit Trail**
   * *For any* site deletion, an audit event should be logged with site details.
   * **Validates: Requirements 2.1, 2.5**
   */
  it('should log audit events for all site deletions', () => {
    fc.assert(
      fc.asyncProperty(
        siteGenerator(),
        async (site) => {
          // Setup mocks
          prismaService.site.findUnique.mockResolvedValue(site as any);
          prismaService.site.delete.mockResolvedValue(site as any);

          // Execute
          await service.remove(site.id);

          // Verify audit logging
          expect(loggerService.logAuditEvent).toHaveBeenCalledWith(
            'site_deleted',
            'site',
            expect.objectContaining({
              siteId: site.id,
              domain: site.domain,
            }),
            'SitesService'
          );
        }
      ),
      { numRuns: 10 }
    );
  });

  /**
   * **Feature: wp-autohealer, Property 5: WordPress Detection Audit Trail**
   * *For any* WordPress detection operation, an audit event should be logged when WordPress is found.
   * **Validates: Requirements 4.6, 2.1**
   */
  it('should log audit events for WordPress detection', () => {
    fc.assert(
      fc.asyncProperty(
        siteGenerator(),
        serverGenerator(),
        fc.record({
          path: fc.string({ minLength: 1, maxLength: 500 }).map(s => `/var/www/${s}/wp`),
          version: fc.string({ minLength: 1, maxLength: 20 }),
          isMultisite: fc.boolean(),
          siteUrl: fc.webUrl(),
          adminUrl: fc.webUrl(),
          dbHost: fc.constantFrom('localhost', '127.0.0.1', 'mysql.example.com'),
          dbName: fc.string({ minLength: 1, maxLength: 64 }),
          tablePrefix: fc.constantFrom('wp_', 'wordpress_', 'site_'),
          activeTheme: fc.string({ minLength: 1, maxLength: 100 }),
          activePlugins: fc.array(fc.string({ minLength: 1, maxLength: 100 }), { maxLength: 10 }),
        }),
        async (site, server, wpInfo) => {
          const siteWithServer = { ...site, server };
          const mockConnection = { id: 'connection-id' };

          // Setup mocks
          prismaService.site.findUnique.mockResolvedValue(siteWithServer as any);
          sshService.connect.mockResolvedValue(mockConnection as any);
          discoveryService.detectWordPressInstallation.mockResolvedValue(wpInfo);
          sshService.disconnect.mockResolvedValue(undefined);

          // Execute
          await service.detectWordPressInstallation(site.id);

          // Verify audit logging
          expect(loggerService.logAuditEvent).toHaveBeenCalledWith(
            'wordpress_detected',
            'site',
            expect.objectContaining({
              siteId: site.id,
              domain: site.domain,
              wordpressPath: wpInfo.path,
              version: wpInfo.version,
              isMultisite: wpInfo.isMultisite,
            }),
            'SitesService'
          );
        }
      ),
      { numRuns: 10 }
    );
  });

  /**
   * **Feature: wp-autohealer, Property 6: Multisite Detection Audit Trail**
   * *For any* multisite detection operation, an audit event should be logged with results.
   * **Validates: Requirements 4.9, 2.1**
   */
  it('should log audit events for multisite detection', () => {
    fc.assert(
      fc.asyncProperty(
        siteGenerator(),
        serverGenerator(),
        fc.boolean(),
        fc.integer({ min: 0, max: 10 }),
        async (site, server, isMultisite, networkSitesCount) => {
          const siteWithServer = { ...site, server };
          const mockConnection = { id: 'connection-id' };

          // Setup mocks
          prismaService.site.findUnique.mockResolvedValue(siteWithServer as any);
          sshService.connect.mockResolvedValue(mockConnection as any);
          
          if (isMultisite) {
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
                stdout: Array.from({ length: networkSitesCount }, (_, i) => 
                  `${i + 1}\tsite${i}.example.com\t/`
                ).join('\n'),
                stderr: '',
                executionTime: 100,
              });
          } else {
            sshService.executeCommand.mockResolvedValue({
              exitCode: 1,
              stdout: '',
              stderr: 'grep: pattern not found',
              executionTime: 100,
            });
          }
          
          sshService.disconnect.mockResolvedValue(undefined);

          // Execute
          await service.detectMultisiteConfiguration(site.id);

          // Verify audit logging
          expect(loggerService.logAuditEvent).toHaveBeenCalledWith(
            'multisite_detection_completed',
            'site',
            expect.objectContaining({
              siteId: site.id,
              domain: site.domain,
              isMultisite,
              networkSitesCount: isMultisite ? networkSitesCount : 0,
            }),
            'SitesService'
          );
        }
      ),
      { numRuns: 10 }
    );
  });

  /**
   * **Feature: wp-autohealer, Property 7: Health Check Audit Trail**
   * *For any* health check operation, audit events should be logged for start and completion.
   * **Validates: Requirements 13.1-13.9, 2.1**
   */
  it('should log audit events for health check operations', () => {
    fc.assert(
      fc.asyncProperty(
        siteGenerator(),
        serverGenerator(),
        healthCheckResponseGenerator(),
        fc.boolean(),
        async (site, server, httpResponse, force) => {
          const siteWithServer = { ...site, server };

          // Mock fetch globally
          global.fetch = jest.fn().mockResolvedValue({
            ...httpResponse,
            text: jest.fn().mockResolvedValue(httpResponse.text),
          });

          // Setup mocks
          prismaService.site.findUnique.mockResolvedValue(siteWithServer as any);
          prismaService.site.update.mockResolvedValue(siteWithServer);

          // Execute
          await service.performHealthCheck(site.id, force);

          // Verify audit logging for start
          expect(loggerService.logAuditEvent).toHaveBeenCalledWith(
            'health_check_started',
            'site',
            expect.objectContaining({
              siteId: site.id,
              domain: site.domain,
              force,
            }),
            'SitesService'
          );

          // Verify audit logging for completion
          expect(loggerService.logAuditEvent).toHaveBeenCalledWith(
            'health_check_completed',
            'site',
            expect.objectContaining({
              siteId: site.id,
              domain: site.domain,
              healthy: expect.any(Boolean),
              responseTime: expect.any(Number),
              issuesCount: expect.any(Number),
            }),
            'SitesService'
          );

          // Cleanup
          jest.restoreAllMocks();
        }
      ),
      { numRuns: 10 } // Reduced runs due to complexity
    );
  });

  /**
   * **Feature: wp-autohealer, Property 8: Health Check Comprehensive Verification**
   * *For any* health check, all verification criteria should be evaluated and recorded.
   * **Validates: Requirements 13.1-13.9**
   */
  it('should perform comprehensive verification for all health checks', () => {
    fc.assert(
      fc.asyncProperty(
        siteGenerator(),
        serverGenerator(),
        healthCheckResponseGenerator(),
        async (site, server, httpResponse) => {
          const siteWithServer = { ...site, server };

          // Mock fetch globally
          global.fetch = jest.fn()
            .mockResolvedValueOnce({ // Main site check
              ...httpResponse,
              text: jest.fn().mockResolvedValue(httpResponse.text),
            })
            .mockResolvedValueOnce({ // wp-login check
              ok: true,
              status: 200,
              text: jest.fn().mockResolvedValue('<form class="wp-login-form">'),
            });

          // Setup mocks
          prismaService.site.findUnique.mockResolvedValue(siteWithServer as any);
          prismaService.site.update.mockResolvedValue(siteWithServer);

          // Execute
          const result = await service.performHealthCheck(site.id, true);

          // Verify all verification criteria are present
          expect(result).toHaveProperty('healthy');
          expect(result).toHaveProperty('statusCode');
          expect(result).toHaveProperty('responseTime');
          expect(result).toHaveProperty('wordpressDetected');
          expect(result).toHaveProperty('maintenanceMode');
          expect(result).toHaveProperty('fatalErrors');
          expect(result).toHaveProperty('whiteScreen');
          expect(result).toHaveProperty('titleTagPresent');
          expect(result).toHaveProperty('canonicalTagPresent');
          expect(result).toHaveProperty('footerMarkersPresent');
          expect(result).toHaveProperty('headerMarkersPresent');
          expect(result).toHaveProperty('wpLoginAccessible');
          expect(result).toHaveProperty('issues');
          expect(result).toHaveProperty('timestamp');

          // Verify response time is reasonable
          expect(result.responseTime).toBeGreaterThanOrEqual(0);
          expect(result.responseTime).toBeLessThan(60000); // Less than 60 seconds

          // Verify issues array is always present
          expect(Array.isArray(result.issues)).toBe(true);

          // Cleanup
          jest.restoreAllMocks();
        }
      ),
      { numRuns: 10 }
    );
  });

  /**
   * **Feature: wp-autohealer, Property 9: Site Statistics Consistency**
   * *For any* set of sites, statistics should be mathematically consistent.
   * **Validates: Requirements 4.6**
   */
  it('should maintain consistent site statistics', () => {
    fc.assert(
      fc.asyncProperty(
        fc.array(siteGenerator(), { minLength: 0, maxLength: 20 }),
        async (sites) => {
          // Setup mocks
          prismaService.site.findMany.mockResolvedValue(sites as any);

          // Execute
          const stats = await service.getStats();

          // Verify mathematical consistency
          expect(stats.total).toBe(sites.length);
          expect(stats.active + stats.inactive).toBe(stats.total);
          expect(stats.active).toBe(sites.filter(s => s.isActive).length);
          expect(stats.inactive).toBe(sites.filter(s => !s.isActive).length);
          expect(stats.multisite).toBe(sites.filter(s => s.isMultisite).length);

          // Verify byServer counts sum to total
          const serverCounts = Object.values(stats.byServer);
          const totalByServer = serverCounts.reduce((sum, count) => sum + count, 0);
          expect(totalByServer).toBe(stats.total);

          // Verify all counts are non-negative
          expect(stats.total).toBeGreaterThanOrEqual(0);
          expect(stats.active).toBeGreaterThanOrEqual(0);
          expect(stats.inactive).toBeGreaterThanOrEqual(0);
          expect(stats.multisite).toBeGreaterThanOrEqual(0);
          expect(stats.healthyCount).toBeGreaterThanOrEqual(0);
          expect(stats.unhealthyCount).toBeGreaterThanOrEqual(0);
        }
      ),
      { numRuns: 10 }
    );
  });

  /**
   * **Feature: wp-autohealer, Property 10: SSH Connection Management**
   * *For any* operation requiring SSH, connections should be properly opened and closed.
   * **Validates: Requirements 6.4**
   */
  it('should properly manage SSH connections for all operations', () => {
    fc.assert(
      fc.asyncProperty(
        siteGenerator(),
        serverGenerator(),
        async (site, server) => {
          const siteWithServer = { ...site, server };
          const mockConnection = { id: 'connection-id' };

          // Setup mocks
          prismaService.site.findUnique.mockResolvedValue(siteWithServer as any);
          sshService.connect.mockResolvedValue(mockConnection as any);
          discoveryService.detectWordPressInstallation.mockResolvedValue(null);
          sshService.disconnect.mockResolvedValue(undefined);

          // Execute WordPress detection (requires SSH)
          await service.detectWordPressInstallation(site.id);

          // Verify SSH connection lifecycle
          expect(sshService.connect).toHaveBeenCalledWith(site.serverId);
          expect(sshService.disconnect).toHaveBeenCalledWith(mockConnection.id);

          // Verify connection is opened before use and closed after
          const connectCall = sshService.connect.mock.invocationCallOrder[0];
          const disconnectCall = sshService.disconnect.mock.invocationCallOrder[0];
          expect(connectCall).toBeLessThan(disconnectCall);
        }
      ),
      { numRuns: 10 }
    );
  });
});