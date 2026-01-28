import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { LoggerService } from '@/common/services/logger.service';
import {
  VerificationResult,
  HttpCheckResult,
  WordPressLoginResult,
  InternalUrlResult,
  ComprehensiveVerificationResult,
} from '../interfaces/verification.interface';
import { VerifyIncidentDto, VerifySiteDto, VerificationResultDto } from '../dto/verification.dto';

@Injectable()
export class VerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: LoggerService,
  ) {}

  /**
   * Perform comprehensive site verification for an incident
   * **Validates: Requirements 13.1-13.9**
   */
  async verifyIncident(verifyDto: VerifyIncidentDto): Promise<ComprehensiveVerificationResult> {
    const startTime = Date.now();

    try {
      this.logger.logAuditEvent(
        'incident_verification_started',
        'incident',
        {
          incidentId: verifyDto.incidentId,
          siteUrl: verifyDto.siteUrl,
          adminUrl: verifyDto.adminUrl,
          skipChecks: verifyDto.skipChecks || [],
        },
        'VerificationService'
      );

      const result = await this.performComprehensiveVerification(
        verifyDto.siteUrl,
        verifyDto.adminUrl,
        verifyDto.internalUrls || [],
        verifyDto.skipChecks || []
      );

      // Store verification results in database
      await this.storeVerificationResults(verifyDto.incidentId, result);

      this.logger.logAuditEvent(
        'incident_verification_completed',
        'incident',
        {
          incidentId: verifyDto.incidentId,
          success: result.overall.success,
          healthy: result.overall.healthy,
          totalChecks: result.overall.totalChecks,
          passedChecks: result.overall.passedChecks,
          failedChecks: result.overall.failedChecks,
          responseTime: result.overall.responseTime,
        },
        'VerificationService'
      );

      return result;
    } catch (error) {
      this.logger.error(
        `Incident verification failed for ${verifyDto.incidentId}: ${(error as Error).message}`,
        (error as Error).stack,
        'VerificationService'
      );

      // Create failed verification result
      const failedResult: ComprehensiveVerificationResult = {
        overall: {
          success: false,
          healthy: false,
          totalChecks: 0,
          passedChecks: 0,
          failedChecks: 1,
          responseTime: Date.now() - startTime,
        },
        httpStatus: this.createFailedVerificationResult('http_status', (error as Error).message),
        fatalErrorCheck: this.createFailedVerificationResult('fatal_error_check', 'Verification failed'),
        maintenanceCheck: this.createFailedVerificationResult('maintenance_check', 'Verification failed'),
        whiteScreenCheck: this.createFailedVerificationResult('white_screen_check', 'Verification failed'),
        titleTagCheck: this.createFailedVerificationResult('title_tag_check', 'Verification failed'),
        canonicalTagCheck: this.createFailedVerificationResult('canonical_tag_check', 'Verification failed'),
        footerMarkerCheck: this.createFailedVerificationResult('footer_marker_check', 'Verification failed'),
        headerMarkerCheck: this.createFailedVerificationResult('header_marker_check', 'Verification failed'),
        wpLoginCheck: this.createFailedVerificationResult('wp_login_check', 'Verification failed'),
        internalUrlCheck: this.createFailedVerificationResult('internal_url_check', 'Verification failed'),
        timestamp: new Date(),
      };

      // Store failed verification results
      await this.storeVerificationResults(verifyDto.incidentId, failedResult);

      return failedResult;
    }
  }

  /**
   * Perform comprehensive site verification for a site
   * **Validates: Requirements 13.1-13.9**
   */
  async verifySite(verifyDto: VerifySiteDto): Promise<VerificationResultDto> {
    const site = await this.prisma.site.findUnique({
      where: { id: verifyDto.siteId },
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

    if (!site) {
      throw new NotFoundException(`Site with ID ${verifyDto.siteId} not found`);
    }

    const result = await this.performComprehensiveVerification(
      site.siteUrl,
      site.adminUrl,
      verifyDto.internalUrls || [],
      verifyDto.skipChecks || []
    );

    return this.mapToVerificationResultDto(result);
  }
  /**
   * Perform comprehensive verification with all checks
   * **Validates: Requirements 13.1-13.9**
   */
  private async performComprehensiveVerification(
    siteUrl: string,
    adminUrl: string,
    internalUrls: string[],
    skipChecks: string[]
  ): Promise<ComprehensiveVerificationResult> {
    const startTime = Date.now();
    const checks: Array<Promise<VerificationResult>> = [];

    // 1. HTTP Status Check - **Validates: Requirements 13.1**
    if (!skipChecks.includes('http_status')) {
      checks.push(this.performHttpStatusCheck(siteUrl));
    }

    // 2. Fatal Error Detection - **Validates: Requirements 13.2**
    if (!skipChecks.includes('fatal_error_check')) {
      checks.push(this.performFatalErrorCheck(siteUrl));
    }

    // 3. Maintenance Mode Detection - **Validates: Requirements 13.2**
    if (!skipChecks.includes('maintenance_check')) {
      checks.push(this.performMaintenanceCheck(siteUrl));
    }

    // 4. White Screen Detection - **Validates: Requirements 13.2**
    if (!skipChecks.includes('white_screen_check')) {
      checks.push(this.performWhiteScreenCheck(siteUrl));
    }

    // 5. Title Tag Verification - **Validates: Requirements 13.3**
    if (!skipChecks.includes('title_tag_check')) {
      checks.push(this.performTitleTagCheck(siteUrl));
    }

    // 6. Canonical Tag Verification - **Validates: Requirements 13.4**
    if (!skipChecks.includes('canonical_tag_check')) {
      checks.push(this.performCanonicalTagCheck(siteUrl));
    }

    // 7. Footer Marker Detection - **Validates: Requirements 13.5**
    if (!skipChecks.includes('footer_marker_check')) {
      checks.push(this.performFooterMarkerCheck(siteUrl));
    }

    // 8. Header Marker Detection - **Validates: Requirements 13.5**
    if (!skipChecks.includes('header_marker_check')) {
      checks.push(this.performHeaderMarkerCheck(siteUrl));
    }

    // 9. WordPress Login Functionality - **Validates: Requirements 13.6**
    if (!skipChecks.includes('wp_login_check')) {
      checks.push(this.performWpLoginCheck(adminUrl));
    }

    // 10. Internal URL Accessibility - **Validates: Requirements 13.7**
    if (!skipChecks.includes('internal_url_check')) {
      checks.push(this.performInternalUrlCheck(siteUrl, internalUrls));
    }

    // Execute all checks in parallel
    const results = await Promise.allSettled(checks);
    const verificationResults: VerificationResult[] = [];

    // Process results
    for (const result of results) {
      if (result.status === 'fulfilled') {
        verificationResults.push(result.value);
      } else {
        verificationResults.push(
          this.createFailedVerificationResult('unknown_check', result.reason?.message || 'Check failed')
        );
      }
    }

    // Calculate overall results
    const totalChecks = verificationResults.length;
    const passedChecks = verificationResults.filter(r => r.success).length;
    const failedChecks = totalChecks - passedChecks;
    const overallSuccess = failedChecks === 0;
    const overallHealthy = this.determineOverallHealth(verificationResults);
    const totalResponseTime = Date.now() - startTime;

    // Map results to specific check types
    const mappedResults = this.mapVerificationResults(verificationResults);

    return {
      overall: {
        success: overallSuccess,
        healthy: overallHealthy,
        totalChecks,
        passedChecks,
        failedChecks,
        responseTime: totalResponseTime,
      },
      ...mappedResults,
      timestamp: new Date(),
    };
  }
  /**
   * HTTP Status Check - Beyond HTTP 200
   * **Validates: Requirements 13.1**
   */
  private async performHttpStatusCheck(siteUrl: string): Promise<VerificationResult> {
    const startTime = Date.now();
    const issues: string[] = [];

    try {
      const httpResult = await this.checkHttpConnectivity(siteUrl);
      const responseTime = Date.now() - startTime;

      let success = true;

      if (!httpResult.success) {
        success = false;
        issues.push(`HTTP request failed: ${httpResult.error}`);
      }

      if (httpResult.statusCode && httpResult.statusCode >= 400) {
        success = false;
        issues.push(`HTTP error status: ${httpResult.statusCode}`);
      }

      if (httpResult.statusCode && httpResult.statusCode >= 300 && httpResult.statusCode < 400) {
        issues.push(`HTTP redirect status: ${httpResult.statusCode}`);
      }

      return {
        success,
        verificationType: 'http_status',
        details: {
          statusCode: httpResult.statusCode,
          responseTime,
          contentLength: httpResult.content?.length || 0,
        },
        issues,
        timestamp: new Date(),
        responseTime,
      };
    } catch (error) {
      return this.createFailedVerificationResult('http_status', (error as Error).message);
    }
  }

  /**
   * Fatal Error Detection in Responses
   * **Validates: Requirements 13.2**
   */
  private async performFatalErrorCheck(siteUrl: string): Promise<VerificationResult> {
    const startTime = Date.now();
    const issues: string[] = [];

    try {
      const httpResult = await this.checkHttpConnectivity(siteUrl);
      const responseTime = Date.now() - startTime;

      const fatalErrors = this.detectFatalErrors(httpResult.content || '');
      const success = !fatalErrors;

      if (fatalErrors) {
        issues.push('Fatal PHP errors detected in response');
      }

      return {
        success,
        verificationType: 'fatal_error_check',
        details: {
          fatalErrorsDetected: fatalErrors,
          responseTime,
        },
        issues,
        timestamp: new Date(),
        responseTime,
      };
    } catch (error) {
      return this.createFailedVerificationResult('fatal_error_check', (error as Error).message);
    }
  }

  /**
   * Maintenance Mode Detection
   * **Validates: Requirements 13.2**
   */
  private async performMaintenanceCheck(siteUrl: string): Promise<VerificationResult> {
    const startTime = Date.now();
    const issues: string[] = [];

    try {
      const httpResult = await this.checkHttpConnectivity(siteUrl);
      const responseTime = Date.now() - startTime;

      const maintenanceMode = this.detectMaintenanceMode(httpResult.content || '');
      const success = !maintenanceMode;

      if (maintenanceMode) {
        issues.push('Site is in maintenance mode');
      }

      return {
        success,
        verificationType: 'maintenance_check',
        details: {
          maintenanceModeDetected: maintenanceMode,
          responseTime,
        },
        issues,
        timestamp: new Date(),
        responseTime,
      };
    } catch (error) {
      return this.createFailedVerificationResult('maintenance_check', (error as Error).message);
    }
  }

  /**
   * White Screen Detection
   * **Validates: Requirements 13.2**
   */
  private async performWhiteScreenCheck(siteUrl: string): Promise<VerificationResult> {
    const startTime = Date.now();
    const issues: string[] = [];

    try {
      const httpResult = await this.checkHttpConnectivity(siteUrl);
      const responseTime = Date.now() - startTime;

      const whiteScreen = this.detectWhiteScreen(httpResult.content || '');
      const success = !whiteScreen;

      if (whiteScreen) {
        issues.push('White screen of death detected');
      }

      return {
        success,
        verificationType: 'white_screen_check',
        details: {
          whiteScreenDetected: whiteScreen,
          contentLength: httpResult.content?.length || 0,
          responseTime,
        },
        issues,
        timestamp: new Date(),
        responseTime,
      };
    } catch (error) {
      return this.createFailedVerificationResult('white_screen_check', (error as Error).message);
    }
  }
  /**
   * Title Tag Verification
   * **Validates: Requirements 13.3**
   */
  private async performTitleTagCheck(siteUrl: string): Promise<VerificationResult> {
    const startTime = Date.now();
    const issues: string[] = [];

    try {
      const httpResult = await this.checkHttpConnectivity(siteUrl);
      const responseTime = Date.now() - startTime;

      const titleTagPresent = this.checkTitleTag(httpResult.content || '');
      const success = titleTagPresent;

      if (!titleTagPresent) {
        issues.push('Title tag missing from response');
      }

      return {
        success,
        verificationType: 'title_tag_check',
        details: {
          titleTagPresent,
          responseTime,
        },
        issues,
        timestamp: new Date(),
        responseTime,
      };
    } catch (error) {
      return this.createFailedVerificationResult('title_tag_check', (error as Error).message);
    }
  }

  /**
   * Canonical Tag Verification
   * **Validates: Requirements 13.4**
   */
  private async performCanonicalTagCheck(siteUrl: string): Promise<VerificationResult> {
    const startTime = Date.now();
    const issues: string[] = [];

    try {
      const httpResult = await this.checkHttpConnectivity(siteUrl);
      const responseTime = Date.now() - startTime;

      const canonicalTagPresent = this.checkCanonicalTag(httpResult.content || '');
      const success = canonicalTagPresent;

      if (!canonicalTagPresent) {
        issues.push('Canonical tag missing from response');
      }

      return {
        success,
        verificationType: 'canonical_tag_check',
        details: {
          canonicalTagPresent,
          responseTime,
        },
        issues,
        timestamp: new Date(),
        responseTime,
      };
    } catch (error) {
      return this.createFailedVerificationResult('canonical_tag_check', (error as Error).message);
    }
  }

  /**
   * Footer Marker Detection
   * **Validates: Requirements 13.5**
   */
  private async performFooterMarkerCheck(siteUrl: string): Promise<VerificationResult> {
    const startTime = Date.now();
    const issues: string[] = [];

    try {
      const httpResult = await this.checkHttpConnectivity(siteUrl);
      const responseTime = Date.now() - startTime;

      const footerMarkersPresent = this.checkFooterMarkers(httpResult.content || '');
      const success = footerMarkersPresent;

      if (!footerMarkersPresent) {
        issues.push('Footer markers missing from response');
      }

      return {
        success,
        verificationType: 'footer_marker_check',
        details: {
          footerMarkersPresent,
          responseTime,
        },
        issues,
        timestamp: new Date(),
        responseTime,
      };
    } catch (error) {
      return this.createFailedVerificationResult('footer_marker_check', (error as Error).message);
    }
  }

  /**
   * Header Marker Detection
   * **Validates: Requirements 13.5**
   */
  private async performHeaderMarkerCheck(siteUrl: string): Promise<VerificationResult> {
    const startTime = Date.now();
    const issues: string[] = [];

    try {
      const httpResult = await this.checkHttpConnectivity(siteUrl);
      const responseTime = Date.now() - startTime;

      const headerMarkersPresent = this.checkHeaderMarkers(httpResult.content || '');
      const success = headerMarkersPresent;

      if (!headerMarkersPresent) {
        issues.push('Header markers missing from response');
      }

      return {
        success,
        verificationType: 'header_marker_check',
        details: {
          headerMarkersPresent,
          responseTime,
        },
        issues,
        timestamp: new Date(),
        responseTime,
      };
    } catch (error) {
      return this.createFailedVerificationResult('header_marker_check', (error as Error).message);
    }
  }
  /**
   * WordPress Login Functionality Testing
   * **Validates: Requirements 13.6**
   */
  private async performWpLoginCheck(adminUrl: string): Promise<VerificationResult> {
    const startTime = Date.now();
    const issues: string[] = [];

    try {
      const loginResult = await this.checkWpLoginAccessibility(adminUrl);
      const responseTime = Date.now() - startTime;

      const success = loginResult.accessible && loginResult.loginFormPresent;

      if (!loginResult.accessible) {
        issues.push('WordPress login page not accessible');
      }

      if (!loginResult.loginFormPresent) {
        issues.push('WordPress login form not found');
      }

      return {
        success,
        verificationType: 'wp_login_check',
        details: {
          accessible: loginResult.accessible,
          loginFormPresent: loginResult.loginFormPresent,
          responseTime: loginResult.responseTime,
          error: loginResult.error,
        },
        issues,
        timestamp: new Date(),
        responseTime,
      };
    } catch (error) {
      return this.createFailedVerificationResult('wp_login_check', (error as Error).message);
    }
  }

  /**
   * Internal URL Accessibility Testing
   * **Validates: Requirements 13.7**
   */
  private async performInternalUrlCheck(siteUrl: string, internalUrls: string[]): Promise<VerificationResult> {
    const startTime = Date.now();
    const issues: string[] = [];

    try {
      // Default internal URLs to check if none provided
      const urlsToCheck = internalUrls.length > 0 ? internalUrls : [
        `${siteUrl}/wp-admin/`,
        `${siteUrl}/wp-content/`,
        `${siteUrl}/wp-includes/`,
        `${siteUrl}/wp-json/wp/v2/`,
      ];

      const urlResults: InternalUrlResult[] = [];

      for (const url of urlsToCheck) {
        try {
          const result = await this.checkInternalUrl(url);
          urlResults.push(result);

          if (!result.accessible) {
            issues.push(`Internal URL not accessible: ${url}`);
          }
        } catch (error) {
          urlResults.push({
            url,
            accessible: false,
            responseTime: 0,
            error: (error as Error).message,
          });
          issues.push(`Internal URL check failed: ${url} - ${(error as Error).message}`);
        }
      }

      const accessibleUrls = urlResults.filter(r => r.accessible).length;
      const success = accessibleUrls > 0; // At least one URL should be accessible

      const responseTime = Date.now() - startTime;

      return {
        success,
        verificationType: 'internal_url_check',
        details: {
          totalUrls: urlResults.length,
          accessibleUrls,
          inaccessibleUrls: urlResults.length - accessibleUrls,
          urlResults,
        },
        issues,
        timestamp: new Date(),
        responseTime,
      };
    } catch (error) {
      return this.createFailedVerificationResult('internal_url_check', (error as Error).message);
    }
  }
  /**
   * Store verification results in database
   * **Validates: Requirements 13.8**
   */
  private async storeVerificationResults(
    incidentId: string,
    result: ComprehensiveVerificationResult
  ): Promise<void> {
    try {
      // Store overall verification result
      await this.prisma.verificationResult.create({
        data: {
          incidentId,
          verificationType: 'comprehensive_verification',
          status: result.overall.success ? 'PASSED' : 'FAILED',
          details: {
            overall: result.overall,
            timestamp: result.timestamp,
          },
        },
      });

      // Store individual check results
      const checks = [
        result.httpStatus,
        result.fatalErrorCheck,
        result.maintenanceCheck,
        result.whiteScreenCheck,
        result.titleTagCheck,
        result.canonicalTagCheck,
        result.footerMarkerCheck,
        result.headerMarkerCheck,
        result.wpLoginCheck,
        result.internalUrlCheck,
      ];

      for (const check of checks) {
        await this.prisma.verificationResult.create({
          data: {
            incidentId,
            verificationType: check.verificationType,
            status: check.success ? 'PASSED' : 'FAILED',
            details: {
              ...check.details,
              issues: check.issues,
              timestamp: check.timestamp,
              responseTime: check.responseTime,
            },
          },
        });
      }

      this.logger.logAuditEvent(
        'verification_results_stored',
        'incident',
        {
          incidentId,
          totalChecks: result.overall.totalChecks,
          passedChecks: result.overall.passedChecks,
          failedChecks: result.overall.failedChecks,
        },
        'VerificationService'
      );
    } catch (error) {
      this.logger.error(
        `Failed to store verification results for incident ${incidentId}: ${(error as Error).message}`,
        (error as Error).stack,
        'VerificationService'
      );
      throw error;
    }
  }

  // Private helper methods

  private async checkHttpConnectivity(url: string): Promise<HttpCheckResult> {
    const startTime = Date.now();

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'WP-AutoHealer/1.0 Verification Service',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        signal: AbortSignal.timeout(30000),
        redirect: 'follow',
      });

      const content = await response.text();
      const responseTime = Date.now() - startTime;

      return {
        success: response.ok,
        statusCode: response.status,
        content,
        responseTime,
      };
    } catch (error) {
      return {
        success: false,
        responseTime: Date.now() - startTime,
        error: (error as Error).message,
      };
    }
  }
  private async checkWpLoginAccessibility(adminUrl: string): Promise<WordPressLoginResult> {
    const startTime = Date.now();

    try {
      const loginUrl = `${adminUrl}/wp-login.php`;
      const response = await fetch(loginUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'WP-AutoHealer/1.0 Verification Service',
        },
        signal: AbortSignal.timeout(15000),
      });

      const content = await response.text();
      const responseTime = Date.now() - startTime;

      const loginFormPresent = this.checkWordPressLoginForm(content);

      return {
        accessible: response.ok,
        loginFormPresent,
        responseTime,
      };
    } catch (error) {
      return {
        accessible: false,
        loginFormPresent: false,
        responseTime: Date.now() - startTime,
        error: (error as Error).message,
      };
    }
  }

  private async checkInternalUrl(url: string): Promise<InternalUrlResult> {
    const startTime = Date.now();

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'WP-AutoHealer/1.0 Verification Service',
        },
        signal: AbortSignal.timeout(15000),
      });

      const responseTime = Date.now() - startTime;

      return {
        url,
        accessible: response.ok,
        statusCode: response.status,
        responseTime,
      };
    } catch (error) {
      return {
        url,
        accessible: false,
        responseTime: Date.now() - startTime,
        error: (error as Error).message,
      };
    }
  }

  private detectFatalErrors(content: string): boolean {
    const errorIndicators = [
      'fatal error',
      'parse error',
      'call to undefined function',
      'class not found',
      'cannot redeclare',
      'memory exhausted',
      'maximum execution time',
      'uncaught error',
      'uncaught exception',
    ];

    const lowerContent = content.toLowerCase();
    return errorIndicators.some(indicator => lowerContent.includes(indicator));
  }

  private detectMaintenanceMode(content: string): boolean {
    const maintenanceIndicators = [
      'maintenance mode',
      'temporarily unavailable',
      'site is down for maintenance',
      'under maintenance',
      'coming soon',
      'wp-maintenance-mode',
      'briefly unavailable for scheduled maintenance',
    ];

    const lowerContent = content.toLowerCase();
    return maintenanceIndicators.some(indicator => lowerContent.includes(indicator));
  }

  private detectWhiteScreen(content: string): boolean {
    const trimmedContent = content.trim();
    
    // Check for completely empty response
    if (trimmedContent.length === 0) {
      return true;
    }

    // Check for minimal HTML that indicates white screen
    if (trimmedContent.length < 100 && 
        !trimmedContent.includes('<title>') && 
        !trimmedContent.includes('<body>')) {
      return true;
    }

    return false;
  }

  private checkTitleTag(content: string): boolean {
    return /<title[^>]*>.*<\/title>/i.test(content);
  }

  private checkCanonicalTag(content: string): boolean {
    return /<link[^>]*rel=["']canonical["'][^>]*>/i.test(content);
  }

  private checkFooterMarkers(content: string): boolean {
    const footerIndicators = [
      '</footer>',
      'wp-footer',
      'site-footer',
      'footer-content',
      'wp_footer',
    ];

    const lowerContent = content.toLowerCase();
    return footerIndicators.some(indicator => lowerContent.includes(indicator));
  }

  private checkHeaderMarkers(content: string): boolean {
    const headerIndicators = [
      '<header',
      'wp-header',
      'site-header',
      'header-content',
      '<nav',
      'navigation',
      'wp_head',
    ];

    const lowerContent = content.toLowerCase();
    return headerIndicators.some(indicator => lowerContent.includes(indicator));
  }

  private checkWordPressLoginForm(content: string): boolean {
    const loginFormIndicators = [
      'wp-login-form',
      'loginform',
      'user_login',
      'wp-submit',
      'name="log"',
      'name="pwd"',
      'wp-login.php',
    ];

    const lowerContent = content.toLowerCase();
    return loginFormIndicators.some(indicator => lowerContent.includes(indicator));
  }
  private createFailedVerificationResult(verificationType: string, error: string): VerificationResult {
    return {
      success: false,
      verificationType,
      details: { error },
      issues: [error],
      timestamp: new Date(),
    };
  }

  private determineOverallHealth(results: VerificationResult[]): boolean {
    // Critical checks that must pass for site to be considered healthy
    const criticalChecks = [
      'http_status',
      'fatal_error_check',
      'white_screen_check',
      'title_tag_check',
      'footer_marker_check',
      'header_marker_check',
    ];

    const criticalResults = results.filter(r => criticalChecks.includes(r.verificationType));
    const criticalFailures = criticalResults.filter(r => !r.success);

    // Site is healthy if no critical checks fail
    return criticalFailures.length === 0;
  }

  private mapVerificationResults(results: VerificationResult[]): Omit<ComprehensiveVerificationResult, 'overall' | 'timestamp'> {
    const defaultResult: VerificationResult = {
      success: false,
      verificationType: 'unknown',
      details: {},
      issues: ['Check not performed'],
      timestamp: new Date(),
    };

    return {
      httpStatus: results.find(r => r.verificationType === 'http_status') || defaultResult,
      fatalErrorCheck: results.find(r => r.verificationType === 'fatal_error_check') || defaultResult,
      maintenanceCheck: results.find(r => r.verificationType === 'maintenance_check') || defaultResult,
      whiteScreenCheck: results.find(r => r.verificationType === 'white_screen_check') || defaultResult,
      titleTagCheck: results.find(r => r.verificationType === 'title_tag_check') || defaultResult,
      canonicalTagCheck: results.find(r => r.verificationType === 'canonical_tag_check') || defaultResult,
      footerMarkerCheck: results.find(r => r.verificationType === 'footer_marker_check') || defaultResult,
      headerMarkerCheck: results.find(r => r.verificationType === 'header_marker_check') || defaultResult,
      wpLoginCheck: results.find(r => r.verificationType === 'wp_login_check') || defaultResult,
      internalUrlCheck: results.find(r => r.verificationType === 'internal_url_check') || defaultResult,
    };
  }

  private mapToVerificationResultDto(result: ComprehensiveVerificationResult): VerificationResultDto {
    return {
      success: result.overall.success,
      healthy: result.overall.healthy,
      totalChecks: result.overall.totalChecks,
      passedChecks: result.overall.passedChecks,
      failedChecks: result.overall.failedChecks,
      responseTime: result.overall.responseTime,
      checks: {
        httpStatus: {
          success: result.httpStatus.success,
          verificationType: result.httpStatus.verificationType,
          details: result.httpStatus.details,
          issues: result.httpStatus.issues,
          timestamp: result.httpStatus.timestamp,
          responseTime: result.httpStatus.responseTime || 0,
        },
        fatalErrorCheck: {
          success: result.fatalErrorCheck.success,
          verificationType: result.fatalErrorCheck.verificationType,
          details: result.fatalErrorCheck.details,
          issues: result.fatalErrorCheck.issues,
          timestamp: result.fatalErrorCheck.timestamp,
          responseTime: result.fatalErrorCheck.responseTime || 0,
        },
        maintenanceCheck: {
          success: result.maintenanceCheck.success,
          verificationType: result.maintenanceCheck.verificationType,
          details: result.maintenanceCheck.details,
          issues: result.maintenanceCheck.issues,
          timestamp: result.maintenanceCheck.timestamp,
          responseTime: result.maintenanceCheck.responseTime || 0,
        },
        whiteScreenCheck: {
          success: result.whiteScreenCheck.success,
          verificationType: result.whiteScreenCheck.verificationType,
          details: result.whiteScreenCheck.details,
          issues: result.whiteScreenCheck.issues,
          timestamp: result.whiteScreenCheck.timestamp,
          responseTime: result.whiteScreenCheck.responseTime || 0,
        },
        titleTagCheck: {
          success: result.titleTagCheck.success,
          verificationType: result.titleTagCheck.verificationType,
          details: result.titleTagCheck.details,
          issues: result.titleTagCheck.issues,
          timestamp: result.titleTagCheck.timestamp,
          responseTime: result.titleTagCheck.responseTime || 0,
        },
        canonicalTagCheck: {
          success: result.canonicalTagCheck.success,
          verificationType: result.canonicalTagCheck.verificationType,
          details: result.canonicalTagCheck.details,
          issues: result.canonicalTagCheck.issues,
          timestamp: result.canonicalTagCheck.timestamp,
          responseTime: result.canonicalTagCheck.responseTime || 0,
        },
        footerMarkerCheck: {
          success: result.footerMarkerCheck.success,
          verificationType: result.footerMarkerCheck.verificationType,
          details: result.footerMarkerCheck.details,
          issues: result.footerMarkerCheck.issues,
          timestamp: result.footerMarkerCheck.timestamp,
          responseTime: result.footerMarkerCheck.responseTime || 0,
        },
        headerMarkerCheck: {
          success: result.headerMarkerCheck.success,
          verificationType: result.headerMarkerCheck.verificationType,
          details: result.headerMarkerCheck.details,
          issues: result.headerMarkerCheck.issues,
          timestamp: result.headerMarkerCheck.timestamp,
          responseTime: result.headerMarkerCheck.responseTime || 0,
        },
        wpLoginCheck: {
          success: result.wpLoginCheck.success,
          verificationType: result.wpLoginCheck.verificationType,
          details: result.wpLoginCheck.details,
          issues: result.wpLoginCheck.issues,
          timestamp: result.wpLoginCheck.timestamp,
          responseTime: result.wpLoginCheck.responseTime || 0,
        },
        internalUrlCheck: {
          success: result.internalUrlCheck.success,
          verificationType: result.internalUrlCheck.verificationType,
          details: result.internalUrlCheck.details,
          issues: result.internalUrlCheck.issues,
          timestamp: result.internalUrlCheck.timestamp,
          responseTime: result.internalUrlCheck.responseTime || 0,
        },
      },
      timestamp: result.timestamp,
    };
  }
}