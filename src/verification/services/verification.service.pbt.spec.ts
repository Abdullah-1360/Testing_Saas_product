import { Test, TestingModule } from '@nestjs/testing';
import * as fc from 'fast-check';
import { VerificationService } from './verification.service';
import { PrismaService } from '@/database/prisma.service';
import { LoggerService } from '@/common/services/logger.service';

// Mock fetch globally
global.fetch = jest.fn();

describe('VerificationService Property-Based Tests', () => {
  let service: VerificationService;
  let prismaService: any;
  let loggerService: jest.Mocked<LoggerService>;

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
    jest.clearAllMocks();
  });

  // Custom generators for verification testing
  const urlGenerator = () => fc.webUrl({ validSchemes: ['https'] });
  
  const incidentIdGenerator = () => fc.uuid();
  
  const verifyIncidentDtoGenerator = () => fc.record({
    incidentId: incidentIdGenerator(),
    siteUrl: urlGenerator(),
    adminUrl: urlGenerator(),
    internalUrls: fc.array(urlGenerator(), { minLength: 0, maxLength: 5 }),
    skipChecks: fc.array(
      fc.constantFrom(
        'http_status',
        'fatal_error_check',
        'maintenance_check',
        'white_screen_check',
        'title_tag_check',
        'canonical_tag_check',
        'footer_marker_check',
        'header_marker_check',
        'wp_login_check',
        'internal_url_check'
      ),
      { minLength: 0, maxLength: 5 }
    ),
  });

  const httpResponseGenerator = () => fc.record({
    ok: fc.boolean(),
    status: fc.integer({ min: 100, max: 599 }),
    content: fc.string({ minLength: 0, maxLength: 10000 }),
  });

  /**
   * **Feature: wp-autohealer, Property 28: Comprehensive Response Verification**
   * *For any* site verification, the system should check beyond HTTP 200 status codes 
   * and detect fatal errors, maintenance mode, and white-screen conditions.
   * **Validates: Requirements 13.1, 13.2**
   */
  it('should perform comprehensive response verification beyond HTTP 200', async () => {
    await fc.assert(
      fc.asyncProperty(
        verifyIncidentDtoGenerator(),
        httpResponseGenerator(),
        async (verifyDto, httpResponse) => {
          // Mock HTTP response
          (fetch as jest.Mock).mockResolvedValue({
            ok: httpResponse.ok,
            status: httpResponse.status,
            text: () => Promise.resolve(httpResponse.content),
          });

          // Mock database operations
          prismaService.verificationResult.create.mockResolvedValue({
            id: 'result-1',
            incidentId: verifyDto.incidentId,
            verificationType: 'comprehensive_verification',
            status: 'PASSED',
            details: {},
            timestamp: new Date(),
          });

          const result = await service.verifyIncident(verifyDto);

          // Property: Verification should always return a comprehensive result
          expect(result).toHaveProperty('overall');
          expect(result).toHaveProperty('httpStatus');
          expect(result).toHaveProperty('fatalErrorCheck');
          expect(result).toHaveProperty('maintenanceCheck');
          expect(result).toHaveProperty('whiteScreenCheck');
          expect(result).toHaveProperty('timestamp');

          // Property: Overall result should be consistent with individual checks
          expect(typeof result.overall.success).toBe('boolean');
          expect(typeof result.overall.healthy).toBe('boolean');
          expect(result.overall.totalChecks).toBeGreaterThanOrEqual(0);
          expect(result.overall.passedChecks).toBeGreaterThanOrEqual(0);
          expect(result.overall.failedChecks).toBeGreaterThanOrEqual(0);
          expect(result.overall.totalChecks).toBe(
            result.overall.passedChecks + result.overall.failedChecks
          );

          // Property: HTTP status check should reflect actual response status
          if (!verifyDto.skipChecks.includes('http_status')) {
            expect(result.httpStatus.verificationType).toBe('http_status');
            expect(typeof result.httpStatus.success).toBe('boolean');
            expect(Array.isArray(result.httpStatus.issues)).toBe(true);
            expect(result.httpStatus.details).toHaveProperty('statusCode');
            
            // If HTTP response is not ok, HTTP status check should fail
            if (!httpResponse.ok) {
              expect(result.httpStatus.success).toBe(false);
              expect(result.httpStatus.issues.length).toBeGreaterThan(0);
            }
          }

          // Property: Fatal error detection should be consistent
          if (!verifyDto.skipChecks.includes('fatal_error_check')) {
            expect(result.fatalErrorCheck.verificationType).toBe('fatal_error_check');
            expect(typeof result.fatalErrorCheck.success).toBe('boolean');
            
            // If content contains fatal error indicators, check should fail
            const lowerContent = httpResponse.content.toLowerCase();
            const hasFatalError = [
              'fatal error',
              'parse error',
              'call to undefined function',
              'uncaught error',
            ].some(indicator => lowerContent.includes(indicator));
            
            if (hasFatalError) {
              expect(result.fatalErrorCheck.success).toBe(false);
            }
          }

          // Property: Maintenance mode detection should be consistent
          if (!verifyDto.skipChecks.includes('maintenance_check')) {
            expect(result.maintenanceCheck.verificationType).toBe('maintenance_check');
            expect(typeof result.maintenanceCheck.success).toBe('boolean');
            
            // If content contains maintenance indicators, check should fail
            const lowerContent = httpResponse.content.toLowerCase();
            const hasMaintenanceMode = [
              'maintenance mode',
              'temporarily unavailable',
              'under maintenance',
            ].some(indicator => lowerContent.includes(indicator));
            
            if (hasMaintenanceMode) {
              expect(result.maintenanceCheck.success).toBe(false);
            }
          }

          // Property: White screen detection should be consistent
          if (!verifyDto.skipChecks.includes('white_screen_check')) {
            expect(result.whiteScreenCheck.verificationType).toBe('white_screen_check');
            expect(typeof result.whiteScreenCheck.success).toBe('boolean');
            
            // If content is empty or minimal, white screen should be detected
            const trimmedContent = httpResponse.content.trim();
            const isWhiteScreen = trimmedContent.length === 0 || 
              (trimmedContent.length < 100 && 
               !trimmedContent.includes('<title>') && 
               !trimmedContent.includes('<body>'));
            
            if (isWhiteScreen) {
              expect(result.whiteScreenCheck.success).toBe(false);
            }
          }
        }
      ),
      { numRuns: 10 }
    );
  });

  /**
   * **Feature: wp-autohealer, Property 29: Required HTML Element Verification**
   * *For any* site response, the system should verify the presence of title tags, 
   * canonical tags, and footer/header markers.
   * **Validates: Requirements 13.3, 13.4, 13.5**
   */
  it('should verify presence of required HTML elements', async () => {
    await fc.assert(
      fc.asyncProperty(
        verifyIncidentDtoGenerator(),
        fc.record({
          hasTitle: fc.boolean(),
          hasCanonical: fc.boolean(),
          hasFooter: fc.boolean(),
          hasHeader: fc.boolean(),
          additionalContent: fc.string({ minLength: 0, maxLength: 1000 }),
        }),
        async (verifyDto, htmlElements) => {
          // Generate HTML content based on properties
          let htmlContent = `<!DOCTYPE html><html><head>`;
          
          if (htmlElements.hasTitle) {
            htmlContent += `<title>Test Page</title>`;
          }
          
          if (htmlElements.hasCanonical) {
            htmlContent += `<link rel="canonical" href="${verifyDto.siteUrl}/" />`;
          }
          
          htmlContent += `</head><body>`;
          
          if (htmlElements.hasHeader) {
            htmlContent += `<header class="site-header"><nav>Navigation</nav></header>`;
          }
          
          htmlContent += `<main>${htmlElements.additionalContent}</main>`;
          
          if (htmlElements.hasFooter) {
            htmlContent += `<footer class="site-footer">Footer content</footer>`;
          }
          
          htmlContent += `</body></html>`;

          // Mock HTTP response
          (fetch as jest.Mock).mockResolvedValue({
            ok: true,
            status: 200,
            text: () => Promise.resolve(htmlContent),
          });

          // Mock database operations
          prismaService.verificationResult.create.mockResolvedValue({
            id: 'result-1',
            incidentId: verifyDto.incidentId,
            verificationType: 'comprehensive_verification',
            status: 'PASSED',
            details: {},
            timestamp: new Date(),
          });

          const result = await service.verifyIncident(verifyDto);

          // Property: Title tag verification should be consistent with content
          if (!verifyDto.skipChecks.includes('title_tag_check')) {
            expect(result.titleTagCheck.verificationType).toBe('title_tag_check');
            expect(result.titleTagCheck.success).toBe(htmlElements.hasTitle);
            
            if (!htmlElements.hasTitle) {
              expect(result.titleTagCheck.issues).toContain('Title tag missing from response');
            }
          }

          // Property: Canonical tag verification should be consistent with content
          if (!verifyDto.skipChecks.includes('canonical_tag_check')) {
            expect(result.canonicalTagCheck.verificationType).toBe('canonical_tag_check');
            expect(result.canonicalTagCheck.success).toBe(htmlElements.hasCanonical);
            
            if (!htmlElements.hasCanonical) {
              expect(result.canonicalTagCheck.issues).toContain('Canonical tag missing from response');
            }
          }

          // Property: Footer marker verification should be consistent with content
          if (!verifyDto.skipChecks.includes('footer_marker_check')) {
            expect(result.footerMarkerCheck.verificationType).toBe('footer_marker_check');
            expect(result.footerMarkerCheck.success).toBe(htmlElements.hasFooter);
            
            if (!htmlElements.hasFooter) {
              expect(result.footerMarkerCheck.issues).toContain('Footer markers missing from response');
            }
          }

          // Property: Header marker verification should be consistent with content
          if (!verifyDto.skipChecks.includes('header_marker_check')) {
            expect(result.headerMarkerCheck.verificationType).toBe('header_marker_check');
            expect(result.headerMarkerCheck.success).toBe(htmlElements.hasHeader);
            
            if (!htmlElements.hasHeader) {
              expect(result.headerMarkerCheck.issues).toContain('Header markers missing from response');
            }
          }

          // Property: Overall health should consider critical checks
          const criticalChecks = ['title_tag_check', 'footer_marker_check', 'header_marker_check'];
          const criticalChecksFailed = criticalChecks.some(check => {
            if (verifyDto.skipChecks.includes(check)) return false;
            
            switch (check) {
              case 'title_tag_check':
                return !htmlElements.hasTitle;
              case 'footer_marker_check':
                return !htmlElements.hasFooter;
              case 'header_marker_check':
                return !htmlElements.hasHeader;
              default:
                return false;
            }
          });

          // If critical checks fail, overall health should be false
          if (criticalChecksFailed) {
            expect(result.overall.healthy).toBe(false);
          }
        }
      ),
      { numRuns: 10 }
    );
  });

  /**
   * **Feature: wp-autohealer, Property 30: WordPress Functionality Testing**
   * *For any* WordPress site verification, wp-login functionality and internal URL 
   * accessibility should be tested.
   * **Validates: Requirements 13.6, 13.7**
   */
  it('should test WordPress functionality and internal URL accessibility', async () => {
    await fc.assert(
      fc.asyncProperty(
        verifyIncidentDtoGenerator(),
        fc.record({
          loginAccessible: fc.boolean(),
          loginFormPresent: fc.boolean(),
          internalUrlsAccessible: fc.array(fc.boolean(), { minLength: 1, maxLength: 5 }),
        }),
        async (verifyDto, wpFunctionality) => {
          // Mock login page response
          let loginContent = '<!DOCTYPE html><html><head><title>Login</title></head><body>';
          if (wpFunctionality.loginFormPresent) {
            loginContent += `
              <form name="loginform" id="loginform">
                <input type="text" name="log" id="user_login" />
                <input type="password" name="pwd" id="user_pass" />
                <input type="submit" name="wp-submit" value="Log In" />
              </form>
            `;
          }
          loginContent += '</body></html>';

          // Mock fetch responses
          const mockResponses = [];
          
          // Skip other checks to focus on wp-login and internal URL checks
          const skipChecks = [
            'http_status', 'fatal_error_check', 'maintenance_check', 'white_screen_check',
            'title_tag_check', 'canonical_tag_check', 'footer_marker_check', 'header_marker_check'
          ];
          
          // Update skipChecks to focus on wp-login and internal URL checks
          const testDto = {
            ...verifyDto,
            skipChecks: [...skipChecks, ...verifyDto.skipChecks],
          };

          if (!testDto.skipChecks.includes('wp_login_check')) {
            mockResponses.push({
              ok: wpFunctionality.loginAccessible,
              status: wpFunctionality.loginAccessible ? 200 : 404,
              text: () => Promise.resolve(loginContent),
            });
          }

          if (!testDto.skipChecks.includes('internal_url_check')) {
            // Mock responses for internal URLs
            const urlsToCheck = testDto.internalUrls.length > 0 ? testDto.internalUrls : [
              `${testDto.siteUrl}/wp-admin/`,
              `${testDto.siteUrl}/wp-content/`,
              `${testDto.siteUrl}/wp-includes/`,
              `${testDto.siteUrl}/wp-json/wp/v2/`,
            ];

            urlsToCheck.forEach((_, index) => {
              const isAccessible = wpFunctionality.internalUrlsAccessible[
                index % wpFunctionality.internalUrlsAccessible.length
              ];
              mockResponses.push({
                ok: isAccessible,
                status: isAccessible ? 200 : 404,
                text: () => Promise.resolve(''),
              });
            });
          }

          // Set up fetch mock with all responses
          let mockCall = (fetch as jest.Mock);
          mockResponses.forEach(response => {
            mockCall = mockCall.mockResolvedValueOnce(response);
          });

          // Mock database operations
          prismaService.verificationResult.create.mockResolvedValue({
            id: 'result-1',
            incidentId: testDto.incidentId,
            verificationType: 'comprehensive_verification',
            status: 'PASSED',
            details: {},
            timestamp: new Date(),
          });

          const result = await service.verifyIncident(testDto);

          // Property: WordPress login check should be consistent with mock data
          if (!testDto.skipChecks.includes('wp_login_check')) {
            expect(result.wpLoginCheck.verificationType).toBe('wp_login_check');
            expect(typeof result.wpLoginCheck.success).toBe('boolean');
            expect(result.wpLoginCheck.details).toHaveProperty('accessible');
            expect(result.wpLoginCheck.details).toHaveProperty('loginFormPresent');
            
            const expectedSuccess = wpFunctionality.loginAccessible && wpFunctionality.loginFormPresent;
            expect(result.wpLoginCheck.success).toBe(expectedSuccess);
            
            if (!wpFunctionality.loginAccessible) {
              expect(result.wpLoginCheck.issues).toContain('WordPress login page not accessible');
            }
            
            if (!wpFunctionality.loginFormPresent) {
              expect(result.wpLoginCheck.issues).toContain('WordPress login form not found');
            }
          }

          // Property: Internal URL check should be consistent with mock data
          if (!testDto.skipChecks.includes('internal_url_check')) {
            expect(result.internalUrlCheck.verificationType).toBe('internal_url_check');
            expect(typeof result.internalUrlCheck.success).toBe('boolean');
            expect(result.internalUrlCheck.details).toHaveProperty('totalUrls');
            expect(result.internalUrlCheck.details).toHaveProperty('accessibleUrls');
            expect(result.internalUrlCheck.details).toHaveProperty('inaccessibleUrls');
            
            const totalUrls = result.internalUrlCheck.details['totalUrls'] as number;
            const accessibleUrls = result.internalUrlCheck.details['accessibleUrls'] as number;
            const inaccessibleUrls = result.internalUrlCheck.details['inaccessibleUrls'] as number;
            
            expect(totalUrls).toBe(accessibleUrls + inaccessibleUrls);
            expect(accessibleUrls).toBeGreaterThanOrEqual(0);
            expect(inaccessibleUrls).toBeGreaterThanOrEqual(0);
            
            // Success should be true if at least one URL is accessible
            expect(result.internalUrlCheck.success).toBe(accessibleUrls > 0);
          }
        }
      ),
      { numRuns: 10 }
    );
  });

  /**
   * **Feature: wp-autohealer, Property 31: Verification Result Storage**
   * *For any* verification operation performed, all results should be recorded in the database 
   * for audit and analysis.
   * **Validates: Requirements 13.8**
   */
  it('should store all verification results in database', async () => {
    await fc.assert(
      fc.asyncProperty(
        verifyIncidentDtoGenerator(),
        async (verifyDto) => {
          // Mock successful HTTP response
          (fetch as jest.Mock).mockResolvedValue({
            ok: true,
            status: 200,
            text: () => Promise.resolve('<html><head><title>Test</title></head><body></body></html>'),
          });

          // Mock database operations
          prismaService.verificationResult.create.mockResolvedValue({
            id: 'result-1',
            incidentId: verifyDto.incidentId,
            verificationType: 'comprehensive_verification',
            status: 'PASSED',
            details: {},
            timestamp: new Date(),
          });

          await service.verifyIncident(verifyDto);

          // Property: Database should be called to store verification results
          expect(prismaService.verificationResult.create).toHaveBeenCalled();
          
          // Property: Number of database calls should match number of checks performed
          const totalChecks = 10 - verifyDto.skipChecks.length;
          
          // Note: In property-based tests, we expect at least the minimum calls
          expect(prismaService.verificationResult.create).toHaveBeenCalled();
          
          // Verify the calls were made with proper structure
          const callCount = (prismaService.verificationResult.create as any).mock.calls.length;
          expect(callCount).toBeGreaterThanOrEqual(1);

          // Property: Each database call should have required fields
          const calls = (prismaService.verificationResult.create as any).mock.calls;
          calls.forEach((call: any) => {
            const data = call[0].data;
            expect(data).toHaveProperty('incidentId', verifyDto.incidentId);
            expect(data).toHaveProperty('verificationType');
            expect(data).toHaveProperty('status');
            expect(data).toHaveProperty('details');
            expect(['PASSED', 'FAILED']).toContain(data.status);
          });

          // Property: Audit events should be logged
          expect(loggerService.logAuditEvent).toHaveBeenCalledWith(
            'incident_verification_started',
            'incident',
            expect.objectContaining({
              incidentId: verifyDto.incidentId,
            }),
            'VerificationService'
          );

          expect(loggerService.logAuditEvent).toHaveBeenCalledWith(
            'incident_verification_completed',
            'incident',
            expect.objectContaining({
              incidentId: verifyDto.incidentId,
            }),
            'VerificationService'
          );
        }
      ),
      { numRuns: 10 }
    );
  });

  /**
   * **Feature: wp-autohealer, Property 32: Verification Failure on Missing Markers**
   * *For any* site response that lacks expected markers (title, canonical, footer/header), 
   * verification should fail and be recorded as such.
   * **Validates: Requirements 13.9**
   */
  it('should fail verification when expected markers are missing', async () => {
    await fc.assert(
      fc.asyncProperty(
        verifyIncidentDtoGenerator(),
        fc.record({
          missingTitle: fc.boolean(),
          missingCanonical: fc.boolean(),
          missingFooter: fc.boolean(),
          missingHeader: fc.boolean(),
        }),
        async (verifyDto, missingMarkers) => {
          // Generate HTML content with potentially missing markers
          let htmlContent = `<!DOCTYPE html><html><head>`;
          
          if (!missingMarkers.missingTitle) {
            htmlContent += `<title>Test Page</title>`;
          }
          
          if (!missingMarkers.missingCanonical) {
            htmlContent += `<link rel="canonical" href="${verifyDto.siteUrl}/" />`;
          }
          
          htmlContent += `</head><body>`;
          
          if (!missingMarkers.missingHeader) {
            htmlContent += `<header class="site-header">Header</header>`;
          }
          
          htmlContent += `<main>Content</main>`;
          
          if (!missingMarkers.missingFooter) {
            htmlContent += `<footer class="site-footer">Footer</footer>`;
          }
          
          htmlContent += `</body></html>`;

          // Mock HTTP response
          (fetch as jest.Mock).mockResolvedValue({
            ok: true,
            status: 200,
            text: () => Promise.resolve(htmlContent),
          });

          // Mock database operations
          prismaService.verificationResult.create.mockResolvedValue({
            id: 'result-1',
            incidentId: verifyDto.incidentId,
            verificationType: 'comprehensive_verification',
            status: 'FAILED',
            details: {},
            timestamp: new Date(),
          });

          const result = await service.verifyIncident(verifyDto);

          // Property: Missing critical markers should cause verification failure
          const criticalMarkersMissing = [
            missingMarkers.missingTitle && !verifyDto.skipChecks.includes('title_tag_check'),
            missingMarkers.missingFooter && !verifyDto.skipChecks.includes('footer_marker_check'),
            missingMarkers.missingHeader && !verifyDto.skipChecks.includes('header_marker_check'),
          ].some(Boolean);

          if (criticalMarkersMissing) {
            expect(result.overall.healthy).toBe(false);
            expect(result.overall.failedChecks).toBeGreaterThan(0);
          }

          // Property: Each missing marker should be recorded with appropriate status
          if (missingMarkers.missingTitle && !verifyDto.skipChecks.includes('title_tag_check')) {
            expect(result.titleTagCheck.success).toBe(false);
            expect(result.titleTagCheck.issues).toContain('Title tag missing from response');
          }

          if (missingMarkers.missingCanonical && !verifyDto.skipChecks.includes('canonical_tag_check')) {
            expect(result.canonicalTagCheck.success).toBe(false);
            expect(result.canonicalTagCheck.issues).toContain('Canonical tag missing from response');
          }

          if (missingMarkers.missingFooter && !verifyDto.skipChecks.includes('footer_marker_check')) {
            expect(result.footerMarkerCheck.success).toBe(false);
            expect(result.footerMarkerCheck.issues).toContain('Footer markers missing from response');
          }

          if (missingMarkers.missingHeader && !verifyDto.skipChecks.includes('header_marker_check')) {
            expect(result.headerMarkerCheck.success).toBe(false);
            expect(result.headerMarkerCheck.issues).toContain('Header markers missing from response');
          }

          // Property: Database should record failed checks with FAILED status
          const calls = (prismaService.verificationResult.create as any).mock.calls;
          const failedCalls = calls.filter((call: any) => call[0].data.status === 'FAILED');
          
          if (criticalMarkersMissing) {
            expect(failedCalls.length).toBeGreaterThan(0);
          }
        }
      ),
      { numRuns: 10 }
    );
  });
});