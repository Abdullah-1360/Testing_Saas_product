import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { SSHService } from '@/ssh/services/ssh.service';
import { LoggerService } from '@/common/services/logger.service';
import { ControlPanelType } from '@prisma/client';

export interface OSInfo {
  name: string;
  version: string;
  architecture: string;
  kernel: string;
  distribution?: string;
}

export interface WebServerInfo {
  type: 'apache' | 'nginx' | 'litespeed' | 'unknown';
  version: string;
  configPath: string;
  documentRoot: string;
  modules?: string[];
}

export interface ControlPanelInfo {
  type: ControlPanelType | null;
  version?: string;
  configPath?: string;
  webRoot?: string;
}

export interface PHPInfo {
  version: string;
  handler: 'mod_php' | 'php-fpm' | 'cgi' | 'fastcgi' | 'unknown';
  configPath: string;
  extensions: string[];
  memoryLimit: string;
  maxExecutionTime: string;
}

export interface WordPressInfo {
  path: string;
  version: string;
  isMultisite: boolean;
  siteUrl: string;
  adminUrl: string;
  dbHost: string;
  dbName: string;
  tablePrefix: string;
  activeTheme: string;
  activePlugins: string[];
}

export interface DatabaseInfo {
  engine: 'mysql' | 'mariadb' | 'postgresql' | 'unknown';
  version: string;
  host: string;
  port: number;
  configPath?: string;
}

export interface CacheInfo {
  type: 'redis' | 'memcached' | 'opcache' | 'file' | 'unknown';
  version?: string;
  status: 'active' | 'inactive';
  configPath?: string;
}

export interface ServerDiscoveryResult {
  serverId: string;
  hostname: string;
  osInfo: OSInfo;
  webServer: WebServerInfo;
  controlPanel: ControlPanelInfo;
  php: PHPInfo;
  database: DatabaseInfo;
  caching: CacheInfo[];
  discoveredAt: Date;
  discoveryDuration: number;
}

@Injectable()
export class DiscoveryService {
  private readonly logger = new Logger(DiscoveryService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly sshService: SSHService,
    private readonly loggerService: LoggerService,
  ) {}

  /**
   * Discover complete server environment
   * **Validates: Requirements 4.1-4.9** - Auto-detect server environment
   */
  async discoverServerEnvironment(serverId: string): Promise<ServerDiscoveryResult> {
    const startTime = Date.now();
    
    try {
      // Get server info
      const server = await this.prismaService.server.findUnique({
        where: { id: serverId },
      });

      if (!server) {
        throw new Error(`Server with ID ${serverId} not found`);
      }

      // Connect to server
      const connection = await this.sshService.connect(serverId);

      this.logger.log(`Starting environment discovery for server ${serverId} (${server.hostname})`);

      // Perform discovery in parallel where possible
      const [osInfo, webServer, controlPanel, php, database, caching] = await Promise.all([
        this.detectOperatingSystem(connection.id),
        this.detectWebServer(connection.id),
        this.detectControlPanel(connection.id),
        this.detectPHPHandler(connection.id),
        this.detectDatabaseEngine(connection.id),
        this.detectCachingSystems(connection.id),
      ]);

      // Update server with discovered information
      await this.prismaService.server.update({
        where: { id: serverId },
        data: {
          osInfo: osInfo as any,
          controlPanel: controlPanel.type,
          updatedAt: new Date(),
        },
      });

      // Disconnect from server
      await this.sshService.disconnect(connection.id);

      const discoveryDuration = Date.now() - startTime;

      const result: ServerDiscoveryResult = {
        serverId,
        hostname: server.hostname,
        osInfo,
        webServer,
        controlPanel,
        php,
        database,
        caching,
        discoveredAt: new Date(),
        discoveryDuration,
      };

      this.loggerService.logAuditEvent(
        'server_discovery_completed',
        'server',
        {
          serverId,
          hostname: server.hostname,
          osInfo: osInfo.name,
          webServer: webServer.type,
          controlPanel: controlPanel.type,
          discoveryDuration,
        },
        'DiscoveryService'
      );

      this.logger.log(
        `Environment discovery completed for server ${serverId} in ${discoveryDuration}ms`
      );

      return result;
    } catch (error) {
      this.logger.error(
        `Environment discovery failed for server ${serverId}: ${(error as Error).message}`,
        (error as Error).stack
      );
      throw error;
    }
  }

  /**
   * Detect operating system information
   * **Validates: Requirements 4.1** - Auto-detect operating system
   */
  async detectOperatingSystem(connectionId: string): Promise<OSInfo> {
    try {
      // Get OS release information
      const releaseResult = await this.sshService.executeCommand(
        connectionId,
        'cat /etc/os-release 2>/dev/null || cat /etc/redhat-release 2>/dev/null || uname -a'
      );

      // Get kernel information
      const kernelResult = await this.sshService.executeCommand(connectionId, 'uname -r');
      
      // Get architecture
      const archResult = await this.sshService.executeCommand(connectionId, 'uname -m');

      const osInfo = this.parseOSInfo(releaseResult.stdout, kernelResult.stdout, archResult.stdout);
      
      this.logger.debug(`Detected OS: ${osInfo.name} ${osInfo.version} (${osInfo.architecture})`);
      
      return osInfo;
    } catch (error) {
      this.logger.warn(`Failed to detect OS: ${(error as Error).message}`);
      return {
        name: 'unknown',
        version: 'unknown',
        architecture: 'unknown',
        kernel: 'unknown',
      };
    }
  }

  /**
   * Detect web server type and configuration
   * **Validates: Requirements 4.2** - Auto-detect web server type
   */
  async detectWebServer(connectionId: string): Promise<WebServerInfo> {
    try {
      // Check for Apache
      const apacheResult = await this.sshService.executeCommand(
        connectionId,
        'which apache2 || which httpd || which apache'
      );

      if (apacheResult.exitCode === 0) {
        return await this.detectApache(connectionId);
      }

      // Check for Nginx
      const nginxResult = await this.sshService.executeCommand(connectionId, 'which nginx');
      
      if (nginxResult.exitCode === 0) {
        return await this.detectNginx(connectionId);
      }

      // Check for LiteSpeed
      const litespeedResult = await this.sshService.executeCommand(
        connectionId,
        'which lshttpd || ls /usr/local/lsws/bin/lshttpd'
      );

      if (litespeedResult.exitCode === 0) {
        return await this.detectLiteSpeed(connectionId);
      }

      this.logger.warn('No supported web server detected');
      return {
        type: 'unknown',
        version: 'unknown',
        configPath: '',
        documentRoot: '/var/www/html',
      };
    } catch (error) {
      this.logger.warn(`Failed to detect web server: ${(error as Error).message}`);
      return {
        type: 'unknown',
        version: 'unknown',
        configPath: '',
        documentRoot: '/var/www/html',
      };
    }
  }

  /**
   * Detect control panel software
   * **Validates: Requirements 4.3** - Auto-detect control panel software
   */
  async detectControlPanel(connectionId: string): Promise<ControlPanelInfo> {
    try {
      // Check for cPanel
      const cpanelResult = await this.sshService.executeCommand(
        connectionId,
        'ls /usr/local/cpanel/version 2>/dev/null'
      );

      if (cpanelResult.exitCode === 0) {
        const versionResult = await this.sshService.executeCommand(
          connectionId,
          'cat /usr/local/cpanel/version'
        );
        return {
          type: ControlPanelType.CPANEL,
          version: versionResult.stdout.trim(),
          configPath: '/usr/local/cpanel',
          webRoot: '/home',
        };
      }

      // Check for Plesk
      const pleskResult = await this.sshService.executeCommand(
        connectionId,
        'ls /usr/local/psa/version 2>/dev/null'
      );

      if (pleskResult.exitCode === 0) {
        const versionResult = await this.sshService.executeCommand(
          connectionId,
          'cat /usr/local/psa/version'
        );
        return {
          type: ControlPanelType.PLESK,
          version: versionResult.stdout.trim(),
          configPath: '/usr/local/psa',
          webRoot: '/var/www/vhosts',
        };
      }

      // Check for DirectAdmin
      const daResult = await this.sshService.executeCommand(
        connectionId,
        'ls /usr/local/directadmin/conf/directadmin.conf 2>/dev/null'
      );

      if (daResult.exitCode === 0) {
        return {
          type: ControlPanelType.DIRECTADMIN,
          configPath: '/usr/local/directadmin',
          webRoot: '/home',
        };
      }

      // Check for CyberPanel
      const cyberResult = await this.sshService.executeCommand(
        connectionId,
        'ls /usr/local/CyberCP 2>/dev/null'
      );

      if (cyberResult.exitCode === 0) {
        return {
          type: ControlPanelType.CYBERPANEL,
          configPath: '/usr/local/CyberCP',
          webRoot: '/home',
        };
      }

      return { type: null };
    } catch (error) {
      this.logger.warn(`Failed to detect control panel: ${(error as Error).message}`);
      return { type: null };
    }
  }

  /**
   * Detect PHP handler and configuration
   * **Validates: Requirements 4.4** - Auto-detect PHP handler configuration
   */
  async detectPHPHandler(connectionId: string): Promise<PHPInfo> {
    try {
      // Get PHP version
      const versionResult = await this.sshService.executeCommand(connectionId, 'php -v');
      
      // Get PHP configuration
      const configResult = await this.sshService.executeCommand(connectionId, 'php --ini');
      
      // Get PHP modules
      const modulesResult = await this.sshService.executeCommand(connectionId, 'php -m');

      // Detect PHP handler
      const handlerResult = await this.sshService.executeCommand(
        connectionId,
        'php -r "echo php_sapi_name();"'
      );

      const phpInfo = this.parsePHPInfo(
        versionResult.stdout,
        configResult.stdout,
        modulesResult.stdout,
        handlerResult.stdout
      );

      this.logger.debug(`Detected PHP: ${phpInfo.version} (${phpInfo.handler})`);
      
      return phpInfo;
    } catch (error) {
      this.logger.warn(`Failed to detect PHP: ${(error as Error).message}`);
      return {
        version: 'unknown',
        handler: 'unknown',
        configPath: '',
        extensions: [],
        memoryLimit: 'unknown',
        maxExecutionTime: 'unknown',
      };
    }
  }

  /**
   * Detect database engine and configuration
   * **Validates: Requirements 4.7** - Auto-detect database engine
   */
  async detectDatabaseEngine(connectionId: string): Promise<DatabaseInfo> {
    try {
      // Check for MySQL/MariaDB
      const mysqlResult = await this.sshService.executeCommand(
        connectionId,
        'which mysql || which mariadb'
      );

      if (mysqlResult.exitCode === 0) {
        const versionResult = await this.sshService.executeCommand(
          connectionId,
          'mysql --version 2>/dev/null || mariadb --version 2>/dev/null'
        );

        const dbInfo = this.parseDatabaseInfo(versionResult.stdout);
        this.logger.debug(`Detected database: ${dbInfo.engine} ${dbInfo.version}`);
        return dbInfo;
      }

      // Check for PostgreSQL
      const pgResult = await this.sshService.executeCommand(connectionId, 'which psql');
      
      if (pgResult.exitCode === 0) {
        const versionResult = await this.sshService.executeCommand(connectionId, 'psql --version');
        return {
          engine: 'postgresql',
          version: this.extractVersion(versionResult.stdout),
          host: 'localhost',
          port: 5432,
        };
      }

      return {
        engine: 'unknown',
        version: 'unknown',
        host: 'localhost',
        port: 3306,
      };
    } catch (error) {
      this.logger.warn(`Failed to detect database: ${(error as Error).message}`);
      return {
        engine: 'unknown',
        version: 'unknown',
        host: 'localhost',
        port: 3306,
      };
    }
  }

  /**
   * Detect caching systems
   * **Validates: Requirements 4.8** - Auto-detect caching systems
   */
  async detectCachingSystems(connectionId: string): Promise<CacheInfo[]> {
    const caches: CacheInfo[] = [];

    try {
      // Check for Redis
      const redisResult = await this.sshService.executeCommand(connectionId, 'which redis-server');
      if (redisResult.exitCode === 0) {
        const versionResult = await this.sshService.executeCommand(
          connectionId,
          'redis-server --version'
        );
        const statusResult = await this.sshService.executeCommand(
          connectionId,
          'systemctl is-active redis 2>/dev/null || service redis status 2>/dev/null'
        );

        caches.push({
          type: 'redis',
          version: this.extractVersion(versionResult.stdout),
          status: statusResult.stdout.includes('active') ? 'active' : 'inactive',
        });
      }

      // Check for Memcached
      const memcachedResult = await this.sshService.executeCommand(connectionId, 'which memcached');
      if (memcachedResult.exitCode === 0) {
        const statusResult = await this.sshService.executeCommand(
          connectionId,
          'systemctl is-active memcached 2>/dev/null || service memcached status 2>/dev/null'
        );

        caches.push({
          type: 'memcached',
          status: statusResult.stdout.includes('active') ? 'active' : 'inactive',
        });
      }

      // Check for OPcache
      const opcacheResult = await this.sshService.executeCommand(
        connectionId,
        'php -m | grep -i opcache'
      );
      if (opcacheResult.exitCode === 0) {
        caches.push({
          type: 'opcache',
          status: 'active',
        });
      }

      this.logger.debug(`Detected ${caches.length} caching systems`);
      return caches;
    } catch (error) {
      this.logger.warn(`Failed to detect caching systems: ${(error as Error).message}`);
      return caches;
    }
  }

  /**
   * Detect WordPress installation for a specific domain
   * **Validates: Requirements 4.6** - Auto-detect WordPress installation paths
   */
  async detectWordPressInstallation(
    connectionId: string,
    domain: string,
    documentRoot: string
  ): Promise<WordPressInfo | null> {
    try {
      // Check for wp-config.php
      const wpConfigResult = await this.sshService.executeCommand(
        connectionId,
        `find ${documentRoot} -name "wp-config.php" -type f | head -1`
      );

      if (wpConfigResult.exitCode !== 0 || !wpConfigResult.stdout.trim()) {
        return null;
      }

      const wpPath = wpConfigResult.stdout.trim().replace('/wp-config.php', '');

      // Get WordPress version
      const versionResult = await this.sshService.executeCommand(
        connectionId,
        `grep "wp_version = " ${wpPath}/wp-includes/version.php | cut -d"'" -f2`
      );

      // Check if multisite
      const multisiteResult = await this.sshService.executeCommand(
        connectionId,
        `grep -i "MULTISITE" ${wpPath}/wp-config.php`
      );

      // Get database configuration
      const dbConfigResult = await this.sshService.executeCommand(
        connectionId,
        `grep -E "DB_(NAME|HOST|USER)" ${wpPath}/wp-config.php`
      );

      const wpInfo = this.parseWordPressInfo(
        wpPath,
        versionResult.stdout,
        multisiteResult.exitCode === 0,
        dbConfigResult.stdout,
        domain
      );

      this.logger.debug(`Detected WordPress: ${wpInfo.version} at ${wpInfo.path}`);
      return wpInfo;
    } catch (error) {
      this.logger.warn(`Failed to detect WordPress for ${domain}: ${(error as Error).message}`);
      return null;
    }
  }

  // Helper methods for parsing detection results

  private parseOSInfo(releaseOutput: string, kernelOutput: string, archOutput: string): OSInfo {
    const lines = releaseOutput.split('\n');
    let name = 'unknown';
    let version = 'unknown';
    let distribution = undefined;

    // Parse /etc/os-release format
    for (const line of lines) {
      if (line.startsWith('NAME=')) {
        const value = line.split('=')[1];
        if (value) name = value.replace(/"/g, '');
      } else if (line.startsWith('VERSION=')) {
        const value = line.split('=')[1];
        if (value) version = value.replace(/"/g, '');
      } else if (line.startsWith('ID=')) {
        const value = line.split('=')[1];
        if (value) distribution = value.replace(/"/g, '');
      }
    }

    // Fallback for RedHat-style release files
    if (name === 'unknown' && releaseOutput.includes('release')) {
      const match = releaseOutput.match(/^(.+?)\s+release\s+([^\s]+)/);
      if (match && match[1] && match[2]) {
        name = match[1];
        version = match[2];
      }
    }

    return {
      name,
      version,
      architecture: archOutput.trim(),
      kernel: kernelOutput.trim(),
      ...(distribution && { distribution }),
    };
  }

  private async detectApache(connectionId: string): Promise<WebServerInfo> {
    const versionResult = await this.sshService.executeCommand(
      connectionId,
      'apache2 -v 2>/dev/null || httpd -v 2>/dev/null'
    );

    const configResult = await this.sshService.executeCommand(
      connectionId,
      'apache2ctl -S 2>/dev/null || httpd -S 2>/dev/null'
    );

    const modulesResult = await this.sshService.executeCommand(
      connectionId,
      'apache2ctl -M 2>/dev/null || httpd -M 2>/dev/null'
    );

    return {
      type: 'apache',
      version: this.extractVersion(versionResult.stdout),
      configPath: this.extractApacheConfigPath(configResult.stdout),
      documentRoot: this.extractDocumentRoot(configResult.stdout, '/var/www/html'),
      modules: modulesResult.stdout.split('\n').filter((line: string) => line.trim()),
    };
  }

  private async detectNginx(connectionId: string): Promise<WebServerInfo> {
    const versionResult = await this.sshService.executeCommand(connectionId, 'nginx -v');
    const configResult = await this.sshService.executeCommand(connectionId, 'nginx -T 2>/dev/null');

    return {
      type: 'nginx',
      version: this.extractVersion(versionResult.stderr), // nginx outputs version to stderr
      configPath: '/etc/nginx/nginx.conf',
      documentRoot: this.extractNginxDocumentRoot(configResult.stdout),
    };
  }

  private async detectLiteSpeed(connectionId: string): Promise<WebServerInfo> {
    const versionResult = await this.sshService.executeCommand(
      connectionId,
      '/usr/local/lsws/bin/lshttpd -v'
    );

    return {
      type: 'litespeed',
      version: this.extractVersion(versionResult.stdout),
      configPath: '/usr/local/lsws/conf',
      documentRoot: '/usr/local/lsws/Example/html',
    };
  }

  private parsePHPInfo(
    versionOutput: string,
    configOutput: string,
    modulesOutput: string,
    handlerOutput: string
  ): PHPInfo {
    const version = this.extractVersion(versionOutput);
    const configPath = this.extractPHPConfigPath(configOutput);
    const extensions = modulesOutput.split('\n').filter(line => line.trim() && !line.startsWith('['));
    
    let handler: PHPInfo['handler'] = 'unknown';
    const sapi = handlerOutput.trim().toLowerCase();
    
    if (sapi.includes('fpm')) {
      handler = 'php-fpm';
    } else if (sapi.includes('apache') || sapi.includes('mod_php')) {
      handler = 'mod_php';
    } else if (sapi.includes('cgi')) {
      handler = 'cgi';
    } else if (sapi.includes('fastcgi')) {
      handler = 'fastcgi';
    }

    return {
      version,
      handler,
      configPath,
      extensions,
      memoryLimit: 'unknown', // Would need php.ini parsing
      maxExecutionTime: 'unknown', // Would need php.ini parsing
    };
  }

  private parseDatabaseInfo(versionOutput: string): DatabaseInfo {
    const version = this.extractVersion(versionOutput);
    let engine: DatabaseInfo['engine'] = 'unknown';

    if (versionOutput.toLowerCase().includes('mariadb')) {
      engine = 'mariadb';
    } else if (versionOutput.toLowerCase().includes('mysql')) {
      engine = 'mysql';
    }

    return {
      engine,
      version,
      host: 'localhost',
      port: 3306,
    };
  }

  private parseWordPressInfo(
    path: string,
    versionOutput: string,
    isMultisite: boolean,
    dbConfigOutput: string,
    domain: string
  ): WordPressInfo {
    const version = versionOutput.trim() || 'unknown';
    
    // Parse database configuration
    const dbLines = dbConfigOutput.split('\n');
    let dbHost = 'localhost';
    let dbName = 'unknown';
    
    for (const line of dbLines) {
      if (line.includes('DB_HOST')) {
        const match = line.match(/,\s*'([^']+)'/);
        if (match && match[1]) dbHost = match[1];
      } else if (line.includes('DB_NAME')) {
        const match = line.match(/,\s*'([^']+)'/);
        if (match && match[1]) dbName = match[1];
      }
    }

    return {
      path,
      version,
      isMultisite,
      siteUrl: `https://${domain}`,
      adminUrl: `https://${domain}/wp-admin`,
      dbHost,
      dbName,
      tablePrefix: 'wp_', // Default, would need wp-config.php parsing
      activeTheme: 'unknown',
      activePlugins: [],
    };
  }

  // Utility methods for extracting information

  private extractVersion(output: string): string {
    const versionMatch = output.match(/(\d+\.\d+(?:\.\d+)?)/);
    return versionMatch && versionMatch[1] ? versionMatch[1] : 'unknown';
  }

  private extractApacheConfigPath(output: string): string {
    const match = output.match(/ServerRoot:\s*"([^"]+)"/);
    return match && match[1] ? match[1] : '/etc/apache2';
  }

  private extractDocumentRoot(output: string, defaultRoot: string): string {
    const match = output.match(/DocumentRoot:\s*"([^"]+)"/);
    return match && match[1] ? match[1] : defaultRoot;
  }

  private extractNginxDocumentRoot(output: string): string {
    const match = output.match(/root\s+([^;]+);/);
    return match && match[1] ? match[1].trim() : '/var/www/html';
  }

  private extractPHPConfigPath(output: string): string {
    const match = output.match(/Configuration File \(php\.ini\) Path:\s*(.+)/);
    return match && match[1] ? match[1].trim() : '/etc/php';
  }
}