import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { DiscoveryService } from './discovery.service';
import { PrismaService } from '@/database/prisma.service';
import { SSHService } from '@/ssh/services/ssh.service';
import { LoggerService } from '@/common/services/logger.service';
import { ControlPanelType } from '@prisma/client';

describe('DiscoveryService', () => {
  let service: DiscoveryService;
  let prismaService: jest.Mocked<PrismaService>;
  let sshService: jest.Mocked<SSHService>;
  let loggerService: jest.Mocked<LoggerService>;

  const mockServer = {
    id: 'server-1',
    hostname: 'test.example.com',
    name: 'Test Server',
    port: 22,
    username: 'testuser',
    authType: 'key',
    encryptedCredentials: 'encrypted-key',
    hostKeyFingerprint: 'test-fingerprint',
    controlPanel: null,
    osInfo: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockConnection = {
    id: 'connection-1',
    serverId: 'server-1',
    isConnected: true,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DiscoveryService,
        {
          provide: PrismaService,
          useValue: {
            server: {
              findUnique: jest.fn(),
              update: jest.fn(),
            },
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
          provide: LoggerService,
          useValue: {
            logAuditEvent: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<DiscoveryService>(DiscoveryService);
    prismaService = module.get(PrismaService);
    sshService = module.get(SSHService);
    loggerService = module.get(LoggerService);

    // Suppress console logs during testing
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('discoverServerEnvironment', () => {
    it('should discover complete server environment successfully', async () => {
      // Arrange
      (prismaService.server.findUnique as jest.Mock).mockResolvedValue(mockServer);
      (sshService.connect as jest.Mock).mockResolvedValue(mockConnection);
      (sshService.disconnect as jest.Mock).mockResolvedValue(undefined);
      (prismaService.server.update as jest.Mock).mockResolvedValue(mockServer);

      // Mock all detection methods
      jest.spyOn(service, 'detectOperatingSystem').mockResolvedValue({
        name: 'Ubuntu',
        version: '22.04',
        architecture: 'x86_64',
        kernel: '5.15.0-generic',
        distribution: 'ubuntu',
      });

      jest.spyOn(service, 'detectWebServer').mockResolvedValue({
        type: 'apache',
        version: '2.4.52',
        configPath: '/etc/apache2',
        documentRoot: '/var/www/html',
        modules: ['mod_rewrite', 'mod_ssl'],
      });

      jest.spyOn(service, 'detectControlPanel').mockResolvedValue({
        type: ControlPanelType.CPANEL,
        version: '108.0.18',
        configPath: '/usr/local/cpanel',
        webRoot: '/home',
      });

      jest.spyOn(service, 'detectPHPHandler').mockResolvedValue({
        version: '8.1.2',
        handler: 'php-fpm',
        configPath: '/etc/php/8.1',
        extensions: ['mysqli', 'curl', 'gd'],
        memoryLimit: '256M',
        maxExecutionTime: '30',
      });

      jest.spyOn(service, 'detectDatabaseEngine').mockResolvedValue({
        engine: 'mysql',
        version: '8.0.32',
        host: 'localhost',
        port: 3306,
        configPath: '/etc/mysql',
      });

      jest.spyOn(service, 'detectCachingSystems').mockResolvedValue([
        {
          type: 'redis',
          version: '6.2.6',
          status: 'active',
          configPath: '/etc/redis',
        },
      ]);

      // Act
      const result = await service.discoverServerEnvironment('server-1');

      // Assert
      expect(result).toBeDefined();
      expect(result.serverId).toBe('server-1');
      expect(result.hostname).toBe('test.example.com');
      expect(result.osInfo.name).toBe('Ubuntu');
      expect(result.webServer.type).toBe('apache');
      expect(result.controlPanel.type).toBe(ControlPanelType.CPANEL);
      expect(result.php.handler).toBe('php-fpm');
      expect(result.database.engine).toBe('mysql');
      expect(result.caching).toHaveLength(1);
      expect(result.discoveryDuration).toBeGreaterThanOrEqual(0);

      expect(sshService.connect).toHaveBeenCalledWith('server-1');
      expect(sshService.disconnect).toHaveBeenCalledWith(mockConnection.id);
      expect(prismaService.server.update).toHaveBeenCalled();
      expect(loggerService.logAuditEvent).toHaveBeenCalled();
    });

    it('should throw error if server not found', async () => {
      // Arrange
      (prismaService.server.findUnique as jest.Mock).mockResolvedValue(null);

      // Act & Assert
      await expect(service.discoverServerEnvironment('nonexistent-server'))
        .rejects
        .toThrow('Server with ID nonexistent-server not found');
    });

    it('should handle SSH connection failure', async () => {
      // Arrange
      (prismaService.server.findUnique as jest.Mock).mockResolvedValue(mockServer);
      (sshService.connect as jest.Mock).mockRejectedValue(new Error('Connection failed'));

      // Act & Assert
      await expect(service.discoverServerEnvironment('server-1'))
        .rejects
        .toThrow('Connection failed');
    });
  });

  describe('detectOperatingSystem', () => {
    it('should detect Ubuntu OS correctly', async () => {
      // Arrange
      const osReleaseOutput = `NAME="Ubuntu"
VERSION="22.04.1 LTS (Jammy Jellyfish)"
ID=ubuntu
ID_LIKE=debian
PRETTY_NAME="Ubuntu 22.04.1 LTS"
VERSION_ID="22.04"`;

      (sshService.executeCommand as jest.Mock)
        .mockResolvedValueOnce({
          stdout: osReleaseOutput,
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
          command: 'cat /etc/os-release',
        })
        .mockResolvedValueOnce({
          stdout: '5.15.0-generic',
          stderr: '',
          exitCode: 0,
          executionTime: 50,
          timestamp: new Date(),
          command: 'uname -r',
        })
        .mockResolvedValueOnce({
          stdout: 'x86_64',
          stderr: '',
          exitCode: 0,
          executionTime: 50,
          timestamp: new Date(),
          command: 'uname -m',
        });

      // Act
      const result = await service.detectOperatingSystem('connection-1');

      // Assert
      expect(result.name).toBe('Ubuntu');
      expect(result.version).toBe('22.04.1 LTS (Jammy Jellyfish)');
      expect(result.architecture).toBe('x86_64');
      expect(result.kernel).toBe('5.15.0-generic');
      expect(result.distribution).toBe('ubuntu');
    });

    it('should detect CentOS OS correctly', async () => {
      // Arrange
      const redhatReleaseOutput = 'CentOS Linux release 8.4.2105 (Core)';

      (sshService.executeCommand as jest.Mock)
        .mockResolvedValueOnce({
          stdout: redhatReleaseOutput,
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
          command: 'cat /etc/redhat-release',
        })
        .mockResolvedValueOnce({
          stdout: '4.18.0-305.el8.x86_64',
          stderr: '',
          exitCode: 0,
          executionTime: 50,
          timestamp: new Date(),
          command: 'uname -r',
        })
        .mockResolvedValueOnce({
          stdout: 'x86_64',
          stderr: '',
          exitCode: 0,
          executionTime: 50,
          timestamp: new Date(),
          command: 'uname -m',
        });

      // Act
      const result = await service.detectOperatingSystem('connection-1');

      // Assert
      expect(result.name).toBe('CentOS Linux');
      expect(result.version).toBe('8.4.2105');
      expect(result.architecture).toBe('x86_64');
      expect(result.kernel).toBe('4.18.0-305.el8.x86_64');
    });

    it('should handle OS detection failure gracefully', async () => {
      // Arrange
      (sshService.executeCommand as jest.Mock).mockRejectedValue(new Error('Command failed'));

      // Act
      const result = await service.detectOperatingSystem('connection-1');

      // Assert
      expect(result.name).toBe('unknown');
      expect(result.version).toBe('unknown');
      expect(result.architecture).toBe('unknown');
      expect(result.kernel).toBe('unknown');
    });
  });

  describe('detectWebServer', () => {
    it('should detect Apache web server', async () => {
      // Arrange
      (sshService.executeCommand as jest.Mock)
        .mockResolvedValueOnce({
          stdout: '/usr/sbin/apache2',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
          command: 'which apache2',
        });

      jest.spyOn(service as any, 'detectApache').mockResolvedValue({
        type: 'apache',
        version: '2.4.52',
        configPath: '/etc/apache2',
        documentRoot: '/var/www/html',
        modules: ['mod_rewrite', 'mod_ssl'],
      });

      // Act
      const result = await service.detectWebServer('connection-1');

      // Assert
      expect(result.type).toBe('apache');
      expect(result.version).toBe('2.4.52');
      expect(result.configPath).toBe('/etc/apache2');
      expect(result.documentRoot).toBe('/var/www/html');
      expect(result.modules).toContain('mod_rewrite');
    });

    it('should detect Nginx web server', async () => {
      // Arrange
      (sshService.executeCommand as jest.Mock)
        .mockResolvedValueOnce({
          stdout: '',
          stderr: '',
          exitCode: 1,
          executionTime: 100,
          timestamp: new Date(),
          command: 'which apache2',
        })
        .mockResolvedValueOnce({
          stdout: '/usr/sbin/nginx',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
          command: 'which nginx',
        });

      jest.spyOn(service as any, 'detectNginx').mockResolvedValue({
        type: 'nginx',
        version: '1.18.0',
        configPath: '/etc/nginx/nginx.conf',
        documentRoot: '/var/www/html',
      });

      // Act
      const result = await service.detectWebServer('connection-1');

      // Assert
      expect(result.type).toBe('nginx');
      expect(result.version).toBe('1.18.0');
      expect(result.configPath).toBe('/etc/nginx/nginx.conf');
    });

    it('should detect LiteSpeed web server', async () => {
      // Arrange
      (sshService.executeCommand as jest.Mock)
        .mockResolvedValueOnce({
          stdout: '',
          stderr: '',
          exitCode: 1,
          executionTime: 100,
          timestamp: new Date(),
          command: 'which apache2',
        })
        .mockResolvedValueOnce({
          stdout: '',
          stderr: '',
          exitCode: 1,
          executionTime: 100,
          timestamp: new Date(),
          command: 'which nginx',
        })
        .mockResolvedValueOnce({
          stdout: '/usr/local/lsws/bin/lshttpd',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
          command: 'which lshttpd',
        });

      jest.spyOn(service as any, 'detectLiteSpeed').mockResolvedValue({
        type: 'litespeed',
        version: '6.0.12',
        configPath: '/usr/local/lsws/conf',
        documentRoot: '/usr/local/lsws/Example/html',
      });

      // Act
      const result = await service.detectWebServer('connection-1');

      // Assert
      expect(result.type).toBe('litespeed');
      expect(result.version).toBe('6.0.12');
    });

    it('should return unknown when no web server detected', async () => {
      // Arrange
      (sshService.executeCommand as jest.Mock)
        .mockResolvedValue({
          stdout: '',
          stderr: '',
          exitCode: 1,
          executionTime: 100,
          timestamp: new Date(),
          command: 'which apache2',
        });

      // Act
      const result = await service.detectWebServer('connection-1');

      // Assert
      expect(result.type).toBe('unknown');
      expect(result.version).toBe('unknown');
      expect(result.documentRoot).toBe('/var/www/html');
    });
  });

  describe('detectControlPanel', () => {
    it('should detect cPanel', async () => {
      // Arrange
      (sshService.executeCommand as jest.Mock)
        .mockResolvedValueOnce({
          stdout: '/usr/local/cpanel/version',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
          command: 'ls /usr/local/cpanel/version',
        })
        .mockResolvedValueOnce({
          stdout: '108.0.18',
          stderr: '',
          exitCode: 0,
          executionTime: 50,
          timestamp: new Date(),
          command: 'cat /usr/local/cpanel/version',
        });

      // Act
      const result = await service.detectControlPanel('connection-1');

      // Assert
      expect(result.type).toBe(ControlPanelType.CPANEL);
      expect(result.version).toBe('108.0.18');
      expect(result.configPath).toBe('/usr/local/cpanel');
      expect(result.webRoot).toBe('/home');
    });

    it('should detect Plesk', async () => {
      // Arrange
      (sshService.executeCommand as jest.Mock)
        .mockResolvedValueOnce({
          stdout: '',
          stderr: '',
          exitCode: 1,
          executionTime: 100,
          timestamp: new Date(),
          command: 'ls /usr/local/cpanel/version',
        })
        .mockResolvedValueOnce({
          stdout: '/usr/local/psa/version',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
          command: 'ls /usr/local/psa/version',
        })
        .mockResolvedValueOnce({
          stdout: '18.0.47',
          stderr: '',
          exitCode: 0,
          executionTime: 50,
          timestamp: new Date(),
          command: 'cat /usr/local/psa/version',
        });

      // Act
      const result = await service.detectControlPanel('connection-1');

      // Assert
      expect(result.type).toBe(ControlPanelType.PLESK);
      expect(result.version).toBe('18.0.47');
      expect(result.configPath).toBe('/usr/local/psa');
      expect(result.webRoot).toBe('/var/www/vhosts');
    });

    it('should detect DirectAdmin', async () => {
      // Arrange
      (sshService.executeCommand as jest.Mock)
        .mockResolvedValueOnce({
          stdout: '',
          stderr: '',
          exitCode: 1,
          executionTime: 100,
          timestamp: new Date(),
          command: 'ls /usr/local/cpanel/version',
        })
        .mockResolvedValueOnce({
          stdout: '',
          stderr: '',
          exitCode: 1,
          executionTime: 100,
          timestamp: new Date(),
          command: 'ls /usr/local/psa/version',
        })
        .mockResolvedValueOnce({
          stdout: '/usr/local/directadmin/conf/directadmin.conf',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
          command: 'ls /usr/local/directadmin/conf/directadmin.conf',
        });

      // Act
      const result = await service.detectControlPanel('connection-1');

      // Assert
      expect(result.type).toBe(ControlPanelType.DIRECTADMIN);
      expect(result.configPath).toBe('/usr/local/directadmin');
      expect(result.webRoot).toBe('/home');
    });

    it('should detect CyberPanel', async () => {
      // Arrange
      (sshService.executeCommand as jest.Mock)
        .mockResolvedValueOnce({
          stdout: '',
          stderr: '',
          exitCode: 1,
          executionTime: 100,
          timestamp: new Date(),
          command: 'ls /usr/local/cpanel/version',
        })
        .mockResolvedValueOnce({
          stdout: '',
          stderr: '',
          exitCode: 1,
          executionTime: 100,
          timestamp: new Date(),
          command: 'ls /usr/local/psa/version',
        })
        .mockResolvedValueOnce({
          stdout: '',
          stderr: '',
          exitCode: 1,
          executionTime: 100,
          timestamp: new Date(),
          command: 'ls /usr/local/directadmin/conf/directadmin.conf',
        })
        .mockResolvedValueOnce({
          stdout: '/usr/local/CyberCP',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
          command: 'ls /usr/local/CyberCP',
        });

      // Act
      const result = await service.detectControlPanel('connection-1');

      // Assert
      expect(result.type).toBe(ControlPanelType.CYBERPANEL);
      expect(result.configPath).toBe('/usr/local/CyberCP');
      expect(result.webRoot).toBe('/home');
    });

    it('should return null when no control panel detected', async () => {
      // Arrange
      (sshService.executeCommand as jest.Mock)
        .mockResolvedValue({
          stdout: '',
          stderr: '',
          exitCode: 1,
          executionTime: 100,
          timestamp: new Date(),
          command: 'ls /usr/local/cpanel/version',
        });

      // Act
      const result = await service.detectControlPanel('connection-1');

      // Assert
      expect(result.type).toBeNull();
    });
  });

  describe('detectPHPHandler', () => {
    it('should detect PHP-FPM handler', async () => {
      // Arrange
      (sshService.executeCommand as jest.Mock)
        .mockResolvedValueOnce({
          stdout: 'PHP 8.1.2-1ubuntu2.14 (cli) (built: Aug 18 2023 11:41:11) ( NTS )',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
          command: 'php -v',
        })
        .mockResolvedValueOnce({
          stdout: 'Configuration File (php.ini) Path: /etc/php/8.1/cli',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
          command: 'php --ini',
        })
        .mockResolvedValueOnce({
          stdout: 'mysqli\ncurl\ngd\nmbstring',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
          command: 'php -m',
        })
        .mockResolvedValueOnce({
          stdout: 'fpm-fcgi',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
          command: 'php -r "echo php_sapi_name();"',
        });

      // Act
      const result = await service.detectPHPHandler('connection-1');

      // Assert
      expect(result.version).toBe('8.1.2');
      expect(result.handler).toBe('php-fpm');
      expect(result.configPath).toBe('/etc/php/8.1/cli');
      expect(result.extensions).toContain('mysqli');
      expect(result.extensions).toContain('curl');
      expect(result.extensions).toContain('gd');
    });

    it('should detect mod_php handler', async () => {
      // Arrange
      (sshService.executeCommand as jest.Mock)
        .mockResolvedValueOnce({
          stdout: 'PHP 7.4.33 (cli) (built: Nov 13 2022 08:18:05) ( NTS )',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
          command: 'php -v',
        })
        .mockResolvedValueOnce({
          stdout: 'Configuration File (php.ini) Path: /etc/php/7.4/apache2',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
          command: 'php --ini',
        })
        .mockResolvedValueOnce({
          stdout: 'mysqli\ncurl\ngd',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
          command: 'php -m',
        })
        .mockResolvedValueOnce({
          stdout: 'apache2handler',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
          command: 'php -r "echo php_sapi_name();"',
        });

      // Act
      const result = await service.detectPHPHandler('connection-1');

      // Assert
      expect(result.version).toBe('7.4.33');
      expect(result.handler).toBe('mod_php');
      expect(result.configPath).toBe('/etc/php/7.4/apache2');
    });

    it('should handle PHP detection failure gracefully', async () => {
      // Arrange
      (sshService.executeCommand as jest.Mock).mockRejectedValue(new Error('PHP not found'));

      // Act
      const result = await service.detectPHPHandler('connection-1');

      // Assert
      expect(result.version).toBe('unknown');
      expect(result.handler).toBe('unknown');
      expect(result.configPath).toBe('');
      expect(result.extensions).toEqual([]);
    });
  });

  describe('detectDatabaseEngine', () => {
    it('should detect MySQL database', async () => {
      // Arrange
      (sshService.executeCommand as jest.Mock)
        .mockResolvedValueOnce({
          stdout: '/usr/bin/mysql',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
          command: 'which mysql',
        })
        .mockResolvedValueOnce({
          stdout: 'mysql  Ver 8.0.32-0ubuntu0.22.04.2 for Linux on x86_64 ((Ubuntu))',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
          command: 'mysql --version',
        });

      // Act
      const result = await service.detectDatabaseEngine('connection-1');

      // Assert
      expect(result.engine).toBe('mysql');
      expect(result.version).toBe('8.0.32');
      expect(result.host).toBe('localhost');
      expect(result.port).toBe(3306);
    });

    it('should detect MariaDB database', async () => {
      // Arrange
      (sshService.executeCommand as jest.Mock)
        .mockResolvedValueOnce({
          stdout: '/usr/bin/mariadb',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
          command: 'which mysql || which mariadb',
        })
        .mockResolvedValueOnce({
          stdout: 'mariadb  Ver 15.1 Distrib 10.6.12-MariaDB, for debian-linux-gnu (x86_64)',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
          command: 'mysql --version 2>/dev/null || mariadb --version 2>/dev/null',
        });

      // Act
      const result = await service.detectDatabaseEngine('connection-1');

      // Assert
      expect(result.engine).toBe('mariadb');
      expect(result.version).toBe('15.1');
      expect(result.host).toBe('localhost');
      expect(result.port).toBe(3306);
    });

    it('should detect PostgreSQL database', async () => {
      // Arrange
      (sshService.executeCommand as jest.Mock)
        .mockResolvedValueOnce({
          stdout: '',
          stderr: '',
          exitCode: 1,
          executionTime: 100,
          timestamp: new Date(),
          command: 'which mysql || which mariadb',
        })
        .mockResolvedValueOnce({
          stdout: '/usr/bin/psql',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
          command: 'which psql',
        })
        .mockResolvedValueOnce({
          stdout: 'psql (PostgreSQL) 14.7 (Ubuntu 14.7-0ubuntu0.22.04.1)',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
          command: 'psql --version',
        });

      // Act
      const result = await service.detectDatabaseEngine('connection-1');

      // Assert
      expect(result.engine).toBe('postgresql');
      expect(result.version).toBe('14.7');
      expect(result.host).toBe('localhost');
      expect(result.port).toBe(5432);
    });

    it('should return unknown when no database detected', async () => {
      // Arrange
      (sshService.executeCommand as jest.Mock)
        .mockResolvedValue({
          stdout: '',
          stderr: '',
          exitCode: 1,
          executionTime: 100,
          timestamp: new Date(),
          command: 'which mysql',
        });

      // Act
      const result = await service.detectDatabaseEngine('connection-1');

      // Assert
      expect(result.engine).toBe('unknown');
      expect(result.version).toBe('unknown');
    });
  });

  describe('detectCachingSystems', () => {
    it('should detect Redis caching system', async () => {
      // Arrange
      (sshService.executeCommand as jest.Mock)
        .mockResolvedValueOnce({
          stdout: '/usr/bin/redis-server',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
          command: 'which redis-server',
        })
        .mockResolvedValueOnce({
          stdout: 'Redis server v=6.2.6 sha=00000000:0 malloc=jemalloc-5.2.1 bits=64 build=a307f3f5ec682ec5',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
          command: 'redis-server --version',
        })
        .mockResolvedValueOnce({
          stdout: 'active',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
          command: 'systemctl is-active redis',
        })
        .mockResolvedValueOnce({
          stdout: '',
          stderr: '',
          exitCode: 1,
          executionTime: 100,
          timestamp: new Date(),
          command: 'which memcached',
        })
        .mockResolvedValueOnce({
          stdout: '',
          stderr: '',
          exitCode: 1,
          executionTime: 100,
          timestamp: new Date(),
          command: 'php -m | grep -i opcache',
        });

      // Act
      const result = await service.detectCachingSystems('connection-1');

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0]?.type).toBe('redis');
      expect(result[0]?.version).toBe('6.2.6');
      expect(result[0]?.status).toBe('active');
    });

    it('should detect multiple caching systems', async () => {
      // Arrange
      (sshService.executeCommand as jest.Mock)
        .mockResolvedValueOnce({
          stdout: '/usr/bin/redis-server',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
          command: 'which redis-server',
        })
        .mockResolvedValueOnce({
          stdout: 'Redis server v=6.2.6',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
          command: 'redis-server --version',
        })
        .mockResolvedValueOnce({
          stdout: 'active',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
          command: 'systemctl is-active redis',
        })
        .mockResolvedValueOnce({
          stdout: '/usr/bin/memcached',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
          command: 'which memcached',
        })
        .mockResolvedValueOnce({
          stdout: 'active',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
          command: 'systemctl is-active memcached',
        })
        .mockResolvedValueOnce({
          stdout: 'Zend OPcache',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
          command: 'php -m | grep -i opcache',
        });

      // Act
      const result = await service.detectCachingSystems('connection-1');

      // Assert
      expect(result).toHaveLength(3);
      expect(result.find(c => c.type === 'redis')).toBeDefined();
      expect(result.find(c => c.type === 'memcached')).toBeDefined();
      expect(result.find(c => c.type === 'opcache')).toBeDefined();
    });

    it('should return empty array when no caching systems detected', async () => {
      // Arrange
      (sshService.executeCommand as jest.Mock)
        .mockResolvedValue({
          stdout: '',
          stderr: '',
          exitCode: 1,
          executionTime: 100,
          timestamp: new Date(),
          command: 'which redis-server',
        });

      // Act
      const result = await service.detectCachingSystems('connection-1');

      // Assert
      expect(result).toEqual([]);
    });
  });

  describe('detectWordPressInstallation', () => {
    it('should detect WordPress installation successfully', async () => {
      // Arrange
      const domain = 'example.com';
      const documentRoot = '/var/www/html';

      (sshService.executeCommand as jest.Mock)
        .mockResolvedValueOnce({
          stdout: '/var/www/html/wp-config.php',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
          command: `find ${documentRoot} -name "wp-config.php" -type f | head -1`,
        })
        .mockResolvedValueOnce({
          stdout: '6.4.2',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
          command: `grep "wp_version = " /var/www/html/wp-includes/version.php | cut -d"'" -f2`,
        })
        .mockResolvedValueOnce({
          stdout: '',
          stderr: '',
          exitCode: 1,
          executionTime: 100,
          timestamp: new Date(),
          command: `grep -i "MULTISITE" /var/www/html/wp-config.php`,
        })
        .mockResolvedValueOnce({
          stdout: `define('DB_NAME', 'wordpress_db');
define('DB_HOST', 'localhost');`,
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
          command: `grep -E "DB_(NAME|HOST|USER)" /var/www/html/wp-config.php`,
        });

      // Act
      const result = await service.detectWordPressInstallation('connection-1', domain, documentRoot);

      // Assert
      expect(result).toBeDefined();
      expect(result!.path).toBe('/var/www/html');
      expect(result!.version).toBe('6.4.2');
      expect(result!.isMultisite).toBe(false);
      expect(result!.siteUrl).toBe(`https://${domain}`);
      expect(result!.adminUrl).toBe(`https://${domain}/wp-admin`);
      expect(result!.dbHost).toBe('localhost');
      expect(result!.dbName).toBe('wordpress_db');
    });

    it('should detect WordPress multisite installation', async () => {
      // Arrange
      const domain = 'multisite.com';
      const documentRoot = '/var/www/multisite';

      (sshService.executeCommand as jest.Mock)
        .mockResolvedValueOnce({
          stdout: '/var/www/multisite/wp-config.php',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
          command: `find ${documentRoot} -name "wp-config.php" -type f | head -1`,
        })
        .mockResolvedValueOnce({
          stdout: '6.4.2',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
          command: `grep "wp_version = " /var/www/multisite/wp-includes/version.php | cut -d"'" -f2`,
        })
        .mockResolvedValueOnce({
          stdout: "define('MULTISITE', true);",
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
          command: `grep -i "MULTISITE" /var/www/multisite/wp-config.php`,
        })
        .mockResolvedValueOnce({
          stdout: `define('DB_NAME', 'multisite_db');
define('DB_HOST', 'localhost');`,
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          timestamp: new Date(),
          command: `grep -E "DB_(NAME|HOST|USER)" /var/www/multisite/wp-config.php`,
        });

      // Act
      const result = await service.detectWordPressInstallation('connection-1', domain, documentRoot);

      // Assert
      expect(result).toBeDefined();
      expect(result!.isMultisite).toBe(true);
      expect(result!.dbName).toBe('multisite_db');
    });

    it('should return null when WordPress not found', async () => {
      // Arrange
      const domain = 'example.com';
      const documentRoot = '/var/www/html';

      (sshService.executeCommand as jest.Mock)
        .mockResolvedValueOnce({
          stdout: '',
          stderr: '',
          exitCode: 1,
          executionTime: 100,
          timestamp: new Date(),
          command: `find ${documentRoot} -name "wp-config.php" -type f | head -1`,
        });

      // Act
      const result = await service.detectWordPressInstallation('connection-1', domain, documentRoot);

      // Assert
      expect(result).toBeNull();
    });

    it('should handle WordPress detection failure gracefully', async () => {
      // Arrange
      const domain = 'example.com';
      const documentRoot = '/var/www/html';

      (sshService.executeCommand as jest.Mock).mockRejectedValue(new Error('SSH command failed'));

      // Act
      const result = await service.detectWordPressInstallation('connection-1', domain, documentRoot);

      // Assert
      expect(result).toBeNull();
    });
  });
});