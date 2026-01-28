import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { LoggerService } from '@/common/services/logger.service';
import { SSHService } from '@/ssh/services/ssh.service';
import { DiscoveryService } from '@/servers/discovery.service';
import { Site } from '@prisma/client';
import { CreateSiteDto } from './dto/create-site.dto';
import { UpdateSiteDto } from './dto/update-site.dto';
import { HealthCheckResultDto } from './dto/site-health-check.dto';

export interface SiteWithServer extends Site {
  server: {
    id: string;
    name: string;
    hostname: string;
  };
}

export interface WordPressDetectionResult {
  detected: boolean;
  path?: string;
  version?: string;
  isMultisite?: boolean;
  siteUrl?: string;
  adminUrl?: string;
  dbHost?: string;
  dbName?: string;
  tablePrefix?: string;
  activeTheme?: string;
  activePlugins?: string[];
}

@Injectable()
export class SitesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: LoggerService,
    private readonly sshService: SSHService,
    private readonly discoveryService: DiscoveryService,
  ) {}

  /**
   * Create a new site with validation
   * **Validates: Requirements 4.6, 4.9** - Site management and WordPress detection
   */
  async create(createSiteDto: CreateSiteDto): Promise<Site> {
    try {
      // Verify server exists
      const server = await this.prisma.server.findUnique({
        where: { id: createSiteDto.serverId },
      });

      if (!server) {
        throw new NotFoundException(`Server with ID ${createSiteDto.serverId} not found`);
      }

      // Check if site with same domain already exists
      const existingSite = await this.prisma.site.findFirst({
        where: { domain: createSiteDto.domain },
      });

      if (existingSite) {
        throw new ConflictException(`Site with domain ${createSiteDto.domain} already exists`);
      }

      // Create the site
      const site = await this.prisma.site.create({
        data: {
          serverId: createSiteDto.serverId,
          domain: createSiteDto.domain,
          documentRoot: createSiteDto.documentRoot,
          wordpressPath: createSiteDto.wordpressPath,
          isMultisite: createSiteDto.isMultisite || false,
          siteUrl: createSiteDto.siteUrl,
          adminUrl: createSiteDto.adminUrl,
          isActive: createSiteDto.isActive !== undefined ? createSiteDto.isActive : true,
        },
      });

      this.logger.logAuditEvent(
        'site_created',
        'site',
        {
          siteId: site.id,
          domain: site.domain,
          serverId: site.serverId,
          serverHostname: server.hostname,
          isMultisite: site.isMultisite,
        },
        'SitesService'
      );

      // Perform initial health check asynchronously
      this.performHealthCheck(site.id).catch(error => {
        this.logger.error(
          `Initial health check failed for site ${site.id}: ${error.message}`,
          error.stack,
          'SitesService'
        );
      });

      return site;
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ConflictException) {
        throw error;
      }
      
      this.logger.error(
        `Failed to create site: ${(error as Error).message}`,
        (error as Error).stack,
        'SitesService'
      );
      throw new BadRequestException('Failed to create site');
    }
  }

  /**
   * Find all sites with optional server information
   */
  async findAll(includeServer: boolean = false): Promise<Site[] | SiteWithServer[]> {
    const sites = await this.prisma.site.findMany({
      orderBy: { createdAt: 'desc' },
      ...(includeServer && {
        include: {
          server: {
            select: {
              id: true,
              name: true,
              hostname: true,
            },
          },
        },
      }),
    });

    return sites;
  }

  /**
   * Find all sites with pagination and filtering
   */
  async findAllPaginated(
    skip: number, 
    limit: number, 
    filters: Record<string, any> = {},
    includeServer: boolean = false
  ): Promise<{ sites: Site[] | SiteWithServer[]; total: number }> {
    const where: any = {};

    // Apply filters
    if (filters.serverId) {
      where.serverId = filters.serverId;
    }
    if (filters.isActive !== undefined) {
      where.isActive = filters.isActive;
    }
    if (filters.isMultisite !== undefined) {
      where.isMultisite = filters.isMultisite;
    }
    if (filters.search) {
      where.domain = {
        contains: filters.search,
        mode: 'insensitive',
      };
    }

    const [sites, total] = await Promise.all([
      this.prisma.site.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        ...(includeServer && {
          include: {
            server: {
              select: {
                id: true,
                name: true,
                hostname: true,
              },
            },
          },
        }),
      }),
      this.prisma.site.count({ where }),
    ]);

    return { sites, total };
  }

  /**
   * Find sites by server ID
   */
  async findByServerId(serverId: string): Promise<Site[]> {
    return this.prisma.site.findMany({
      where: { serverId },
      orderBy: { domain: 'asc' },
    });
  }

  /**
   * Find site by ID
   */
  async findOne(id: string): Promise<Site> {
    const site = await this.prisma.site.findUnique({
      where: { id },
    });

    if (!site) {
      throw new NotFoundException(`Site with ID ${id} not found`);
    }

    return site;
  }

  /**
   * Find site by ID with server information
   */
  async findOneWithServer(id: string): Promise<SiteWithServer> {
    const site = await this.prisma.site.findUnique({
      where: { id },
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
      throw new NotFoundException(`Site with ID ${id} not found`);
    }

    return site as SiteWithServer;
  }

  /**
   * Find site by domain
   */
  async findByDomain(domain: string): Promise<Site | null> {
    return this.prisma.site.findFirst({
      where: { domain },
    });
  }

  /**
   * Update site
   */
  async update(id: string, updateSiteDto: UpdateSiteDto): Promise<Site> {
    // Verify site exists
    await this.findOne(id);

    try {
      // If domain is being updated, check for conflicts
      if (updateSiteDto.domain) {
        const existingSite = await this.prisma.site.findFirst({
          where: { 
            domain: updateSiteDto.domain,
            id: { not: id },
          },
        });

        if (existingSite) {
          throw new ConflictException(`Site with domain ${updateSiteDto.domain} already exists`);
        }
      }

      const updatedSite = await this.prisma.site.update({
        where: { id },
        data: updateSiteDto,
      });

      this.logger.logAuditEvent(
        'site_updated',
        'site',
        {
          siteId: updatedSite.id,
          domain: updatedSite.domain,
          fieldsUpdated: Object.keys(updateSiteDto),
        },
        'SitesService'
      );

      return updatedSite;
    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }
      
      this.logger.error(
        `Failed to update site ${id}: ${(error as Error).message}`,
        (error as Error).stack,
        'SitesService'
      );
      throw new BadRequestException('Failed to update site');
    }
  }

  /**
   * Delete site
   */
  async remove(id: string): Promise<void> {
    const site = await this.findOne(id);

    try {
      await this.prisma.site.delete({
        where: { id },
      });

      this.logger.logAuditEvent(
        'site_deleted',
        'site',
        {
          siteId: site.id,
          domain: site.domain,
        },
        'SitesService'
      );
    } catch (error) {
      this.logger.error(
        `Failed to delete site ${id}: ${(error as Error).message}`,
        (error as Error).stack,
        'SitesService'
      );
      throw new BadRequestException('Failed to delete site');
    }
  }

  /**
   * Perform comprehensive health check on a site
   * **Validates: Requirements 13.1-13.9** - Comprehensive verification logic
   */
  async performHealthCheck(siteId: string, force: boolean = false): Promise<HealthCheckResultDto> {
    const site = await this.findOneWithServer(siteId);

    // Check if we need to perform health check
    if (!force && site.lastHealthCheck) {
      const timeDiff = Date.now() - site.lastHealthCheck.getTime();
      const minutesDiff = timeDiff / (1000 * 60);
      
      if (minutesDiff < 5) { // Cache for 5 minutes
        // Return cached result if available
        const cachedResult = await this.getCachedHealthResult(siteId);
        if (cachedResult) {
          return cachedResult;
        }
      }
    }

    const startTime = Date.now();
    const issues: string[] = [];
    let healthy = true;

    try {
      this.logger.logAuditEvent(
        'health_check_started',
        'site',
        {
          siteId: site.id,
          domain: site.domain,
          force,
        },
        'SitesService'
      );

      // 1. Basic HTTP connectivity test
      const httpResult = await this.checkHttpConnectivity(site.siteUrl);
      const responseTime = Date.now() - startTime;

      if (!httpResult.success) {
        healthy = false;
        issues.push(`HTTP connectivity failed: ${httpResult.error}`);
      }

      // 2. Check for maintenance mode
      const maintenanceMode = this.detectMaintenanceMode(httpResult.content || '');
      if (maintenanceMode) {
        healthy = false;
        issues.push('Site is in maintenance mode');
      }

      // 3. Check for fatal errors
      const fatalErrors = this.detectFatalErrors(httpResult.content || '');
      if (fatalErrors) {
        healthy = false;
        issues.push('Fatal PHP errors detected');
      }

      // 4. Check for white screen of death
      const whiteScreen = this.detectWhiteScreen(httpResult.content || '');
      if (whiteScreen) {
        healthy = false;
        issues.push('White screen of death detected');
      }

      // 5. Check for required HTML elements
      const titleTagPresent = this.checkTitleTag(httpResult.content || '');
      if (!titleTagPresent) {
        healthy = false;
        issues.push('Title tag missing');
      }

      const canonicalTagPresent = this.checkCanonicalTag(httpResult.content || '');
      if (!canonicalTagPresent) {
        issues.push('Canonical tag missing'); // Warning, not critical
      }

      const footerMarkersPresent = this.checkFooterMarkers(httpResult.content || '');
      if (!footerMarkersPresent) {
        healthy = false;
        issues.push('Footer markers missing');
      }

      const headerMarkersPresent = this.checkHeaderMarkers(httpResult.content || '');
      if (!headerMarkersPresent) {
        healthy = false;
        issues.push('Header markers missing');
      }

      // 6. Check WordPress login accessibility
      const wpLoginAccessible = await this.checkWpLoginAccessibility(site.adminUrl);
      if (!wpLoginAccessible) {
        healthy = false;
        issues.push('WordPress login not accessible');
      }

      // 7. Detect WordPress version
      const wordpressDetected = this.detectWordPress(httpResult.content || '');
      const wordpressVersion = this.extractWordPressVersion(httpResult.content || '');

      // Create health check result
      const healthResult: HealthCheckResultDto = {
        healthy,
        statusCode: httpResult.statusCode || 0,
        responseTime,
        wordpressDetected,
        ...(wordpressVersion && { wordpressVersion }),
        maintenanceMode,
        fatalErrors,
        whiteScreen,
        titleTagPresent,
        canonicalTagPresent,
        footerMarkersPresent,
        headerMarkersPresent,
        wpLoginAccessible,
        issues,
        details: {
          siteUrl: site.siteUrl,
          adminUrl: site.adminUrl,
          isMultisite: site.isMultisite,
          serverHostname: site.server.hostname,
        },
        timestamp: new Date(),
      };

      // Update site's last health check timestamp
      await this.prisma.site.update({
        where: { id: siteId },
        data: { lastHealthCheck: new Date() },
      });

      // Cache the result
      await this.cacheHealthResult(siteId, healthResult);

      this.logger.logAuditEvent(
        'health_check_completed',
        'site',
        {
          siteId: site.id,
          domain: site.domain,
          healthy,
          responseTime,
          issuesCount: issues.length,
          issues: issues.slice(0, 3), // Log first 3 issues
        },
        'SitesService'
      );

      return healthResult;
    } catch (error) {
      this.logger.error(
        `Health check failed for site ${siteId}: ${(error as Error).message}`,
        (error as Error).stack,
        'SitesService'
      );

      return {
        healthy: false,
        statusCode: 0,
        responseTime: Date.now() - startTime,
        wordpressDetected: false,
        maintenanceMode: false,
        fatalErrors: true,
        whiteScreen: false,
        titleTagPresent: false,
        canonicalTagPresent: false,
        footerMarkersPresent: false,
        headerMarkersPresent: false,
        wpLoginAccessible: false,
        issues: [`Health check failed: ${(error as Error).message}`],
        timestamp: new Date(),
      };
    }
  }

  /**
   * Detect WordPress installation on a site
   * **Validates: Requirements 4.6** - Auto-detect WordPress installation paths
   */
  async detectWordPressInstallation(siteId: string): Promise<WordPressDetectionResult> {
    const site = await this.findOneWithServer(siteId);

    try {
      // Connect to server
      const connection = await this.sshService.connect(site.serverId);

      // Use discovery service to detect WordPress
      const wpInfo = await this.discoveryService.detectWordPressInstallation(
        connection.id,
        site.domain,
        site.documentRoot
      );

      // Disconnect from server
      await this.sshService.disconnect(connection.id);

      if (!wpInfo) {
        return { detected: false };
      }

      this.logger.logAuditEvent(
        'wordpress_detected',
        'site',
        {
          siteId: site.id,
          domain: site.domain,
          wordpressPath: wpInfo.path,
          version: wpInfo.version,
          isMultisite: wpInfo.isMultisite,
        },
        'SitesService'
      );

      return {
        detected: true,
        path: wpInfo.path,
        version: wpInfo.version,
        isMultisite: wpInfo.isMultisite,
        siteUrl: wpInfo.siteUrl,
        adminUrl: wpInfo.adminUrl,
        dbHost: wpInfo.dbHost,
        dbName: wpInfo.dbName,
        tablePrefix: wpInfo.tablePrefix,
        activeTheme: wpInfo.activeTheme,
        activePlugins: wpInfo.activePlugins,
      };
    } catch (error) {
      this.logger.error(
        `WordPress detection failed for site ${siteId}: ${(error as Error).message}`,
        (error as Error).stack,
        'SitesService'
      );

      return { detected: false };
    }
  }

  /**
   * Detect multisite configuration
   * **Validates: Requirements 4.9** - Auto-detect WordPress multisite configuration
   */
  async detectMultisiteConfiguration(siteId: string): Promise<{
    isMultisite: boolean;
    networkSites?: Array<{
      blogId: number;
      domain: string;
      path: string;
      siteUrl: string;
    }>;
    networkAdmin?: string;
  }> {
    const site = await this.findOneWithServer(siteId);

    try {
      // Connect to server
      const connection = await this.sshService.connect(site.serverId);

      // Check wp-config.php for multisite constants
      const wpConfigResult = await this.sshService.executeCommand(
        connection.id,
        `grep -E "(MULTISITE|WP_ALLOW_MULTISITE|SUBDOMAIN_INSTALL)" ${site.wordpressPath}/wp-config.php`
      );

      const isMultisite = wpConfigResult.exitCode === 0 && 
        wpConfigResult.stdout.includes('MULTISITE');

      let networkSites: any[] = [];
      let networkAdmin: string | undefined;

      if (isMultisite) {
        // Get network admin URL
        networkAdmin = `${site.adminUrl}/network/`;

        // Try to get network sites from database (if we have access)
        try {
          const dbConfigResult = await this.sshService.executeCommand(
            connection.id,
            `grep -E "DB_(NAME|HOST|USER|PASSWORD)" ${site.wordpressPath}/wp-config.php`
          );

          // Parse database configuration and query for sites
          // This is a simplified approach - in production, you'd want more robust DB access
          const dbLines = dbConfigResult.stdout.split('\n');
          let dbName = '';
          
          for (const line of dbLines) {
            if (line.includes('DB_NAME')) {
              const match = line.match(/'([^']+)'/);
              if (match && match[1]) dbName = match[1];
            }
          }

          if (dbName) {
            // Query for network sites (simplified - would need proper DB credentials)
            const sitesQuery = `mysql -e "SELECT blog_id, domain, path FROM ${dbName}.wp_blogs WHERE deleted = 0 LIMIT 10;"`;
            const sitesResult = await this.sshService.executeCommand(connection.id, sitesQuery);
            
            if (sitesResult.exitCode === 0) {
              // Parse sites result (simplified parsing)
              const lines = sitesResult.stdout.split('\n').slice(1); // Skip header
              networkSites = lines
                .filter(line => line.trim())
                .map(line => {
                  const parts = line.split('\t');
                  if (parts.length >= 3) {
                    const [blogId, domain, path] = parts;
                    return {
                      blogId: parseInt(blogId || '0', 10),
                      domain: (domain || '').trim(),
                      path: (path || '').trim(),
                      siteUrl: `https://${(domain || '').trim()}${(path || '').trim()}`,
                    };
                  }
                  return null;
                })
                .filter(site => site !== null);
            }
          }
        } catch (dbError) {
          this.logger.warn(
            `Could not query multisite database for site ${siteId}: ${(dbError as Error).message}`
          );
        }
      }

      // Disconnect from server
      await this.sshService.disconnect(connection.id);

      this.logger.logAuditEvent(
        'multisite_detection_completed',
        'site',
        {
          siteId: site.id,
          domain: site.domain,
          isMultisite,
          networkSitesCount: networkSites.length,
        },
        'SitesService'
      );

      return {
        isMultisite,
        ...(isMultisite && networkSites.length > 0 && { networkSites }),
        ...(isMultisite && networkAdmin && { networkAdmin }),
      };
    } catch (error) {
      this.logger.error(
        `Multisite detection failed for site ${siteId}: ${(error as Error).message}`,
        (error as Error).stack,
        'SitesService'
      );

      return { isMultisite: false };
    }
  }

  /**
   * Get site statistics
   */
  async getStats(): Promise<{
    total: number;
    active: number;
    inactive: number;
    multisite: number;
    healthyCount: number;
    unhealthyCount: number;
    byServer: Record<string, number>;
  }> {
    const sites = await this.findAll();
    
    // Get recent health check results
    const recentHealthChecks = await this.getRecentHealthChecks();
    const healthyCount = recentHealthChecks.filter(h => h.healthy).length;
    const unhealthyCount = recentHealthChecks.filter(h => !h.healthy).length;

    const stats = {
      total: sites.length,
      active: sites.filter(site => site.isActive).length,
      inactive: sites.filter(site => !site.isActive).length,
      multisite: sites.filter(site => site.isMultisite).length,
      healthyCount,
      unhealthyCount,
      byServer: sites.reduce((acc, site) => {
        acc[site.serverId] = (acc[site.serverId] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
    };

    return stats;
  }

  // Private helper methods

  private async checkHttpConnectivity(url: string): Promise<{
    success: boolean;
    statusCode?: number;
    content?: string;
    error?: string;
  }> {
    try {
      // Use a simple HTTP client to check connectivity
      // In a real implementation, you'd use axios or similar
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'WP-AutoHealer/1.0 Health Check',
        },
        signal: AbortSignal.timeout(30000),
      });

      const content = await response.text();

      return {
        success: response.ok,
        statusCode: response.status,
        content,
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  }

  private detectMaintenanceMode(content: string): boolean {
    const maintenanceIndicators = [
      'maintenance mode',
      'temporarily unavailable',
      'site is down for maintenance',
      'under maintenance',
      'coming soon',
      'wp-maintenance-mode',
    ];

    const lowerContent = content.toLowerCase();
    return maintenanceIndicators.some(indicator => lowerContent.includes(indicator));
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
    ];

    const lowerContent = content.toLowerCase();
    return errorIndicators.some(indicator => lowerContent.includes(indicator));
  }

  private detectWhiteScreen(content: string): boolean {
    const trimmedContent = content.trim();
    
    // Check for completely empty response or minimal HTML
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
      '</body>',
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
    ];

    const lowerContent = content.toLowerCase();
    return headerIndicators.some(indicator => lowerContent.includes(indicator));
  }

  private async checkWpLoginAccessibility(adminUrl: string): Promise<boolean> {
    try {
      const loginUrl = `${adminUrl}/wp-login.php`;
      const response = await fetch(loginUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'WP-AutoHealer/1.0 Health Check',
        },
        signal: AbortSignal.timeout(15000),
      });

      const content = await response.text();
      
      // Check for WordPress login form indicators
      return response.ok && (
        content.includes('wp-login-form') ||
        content.includes('loginform') ||
        content.includes('user_login') ||
        content.includes('wp-submit')
      );
    } catch (error) {
      return false;
    }
  }

  private detectWordPress(content: string): boolean {
    const wpIndicators = [
      'wp-content',
      'wp-includes',
      'wordpress',
      'wp-json',
      '/wp/',
      'wp_',
    ];

    const lowerContent = content.toLowerCase();
    return wpIndicators.some(indicator => lowerContent.includes(indicator));
  }

  private extractWordPressVersion(content: string): string | undefined {
    // Look for WordPress version in meta tags or comments
    const versionPatterns = [
      /<meta name=["']generator["'] content=["']WordPress ([^"']+)["']/i,
      /WordPress ([0-9.]+)/i,
    ];

    for (const pattern of versionPatterns) {
      const match = content.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }

    return undefined;
  }

  private async getCachedHealthResult(_siteId: string): Promise<HealthCheckResultDto | null> {
    // In a real implementation, you'd use Redis or similar for caching
    // For now, return null to always perform fresh checks
    return null;
  }

  private async cacheHealthResult(_siteId: string, _result: HealthCheckResultDto): Promise<void> {
    // In a real implementation, you'd cache the result in Redis
    // For now, this is a no-op
  }

  private async getRecentHealthChecks(): Promise<Array<{ healthy: boolean }>> {
    // In a real implementation, you'd query cached health check results
    // For now, return empty array
    return [];
  }
}