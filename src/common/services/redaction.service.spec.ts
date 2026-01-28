import { Test, TestingModule } from '@nestjs/testing';
import { RedactionService } from './redaction.service';

describe('RedactionService', () => {
  let service: RedactionService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RedactionService],
    }).compile();

    service = module.get<RedactionService>(RedactionService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('redactSecrets', () => {
    it('should redact password patterns', () => {
      const input = 'password=secret123 and PASSWORD=another_secret';
      const result = service.redactSecrets(input);

      expect(result).toBe('password=*** and PASSWORD=***');
    });

    it('should redact key patterns', () => {
      const input = 'api_key=abc123 and API-KEY: xyz789';
      const result = service.redactSecrets(input);

      expect(result).toBe('api_key=*** and API-KEY: ***');
    });

    it('should redact token patterns', () => {
      const input = 'token=bearer_token123 and access_token: jwt.token.here';
      const result = service.redactSecrets(input);

      expect(result).toBe('token=*** and access_token: ***');
    });

    it('should redact secret patterns', () => {
      const input = 'secret=mysecret and client_secret: oauth_secret';
      const result = service.redactSecrets(input);

      expect(result).toBe('secret=*** and client_secret: ***');
    });

    it('should redact authorization headers', () => {
      const input = 'Authorization: Bearer jwt.token.here';
      const result = service.redactSecrets(input);

      expect(result).toBe('Authorization: ***');
    });

    it('should redact SSH private keys', () => {
      const input = '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC...\n-----END PRIVATE KEY-----';
      const result = service.redactSecrets(input);

      expect(result).toBe('-----BEGIN PRIVATE KEY-----\n***\n-----END PRIVATE KEY-----');
    });

    it('should redact database connection strings', () => {
      const input = 'mysql://user:password@localhost:3306/database';
      const result = service.redactSecrets(input);

      expect(result).toBe('mysql://user:***@localhost:3306/database');
    });

    it('should redact multiple secrets in same string', () => {
      const input = 'password=secret123 api_key=abc123 token=xyz789';
      const result = service.redactSecrets(input);

      expect(result).toBe('password=*** api_key=*** token=***');
    });

    it('should handle empty string', () => {
      const result = service.redactSecrets('');
      expect(result).toBe('');
    });

    it('should handle string with no secrets', () => {
      const input = 'This is a normal log message with no secrets';
      const result = service.redactSecrets(input);

      expect(result).toBe(input);
    });

    it('should be case insensitive for common patterns', () => {
      const input = 'PASSWORD=secret123 API_KEY=abc123 TOKEN=xyz789';
      const result = service.redactSecrets(input);

      expect(result).toBe('PASSWORD=*** API_KEY=*** TOKEN=***');
    });
  });

  describe('redactObject', () => {
    it('should redact secrets in object values', () => {
      const input = {
        username: 'user123',
        password: 'secret123',
        apiKey: 'abc123',
        normalField: 'normal value',
      };

      const result = service.redactObject(input);

      expect(result).toEqual({
        username: 'user123',
        password: '***',
        apiKey: '***',
        normalField: 'normal value',
      });
    });

    it('should redact secrets in nested objects', () => {
      const input = {
        user: {
          name: 'John',
          credentials: {
            password: 'secret123',
            token: 'bearer_token',
          },
        },
        config: {
          database: {
            host: 'localhost',
            password: 'db_password',
          },
        },
      };

      const result = service.redactObject(input);

      expect(result).toEqual({
        user: {
          name: 'John',
          credentials: {
            password: '***',
            token: '***',
          },
        },
        config: {
          database: {
            host: 'localhost',
            password: '***',
          },
        },
      });
    });

    it('should redact secrets in arrays', () => {
      const input = {
        servers: [
          { name: 'server1', password: 'secret1' },
          { name: 'server2', apiKey: 'key123' },
        ],
        tokens: ['token1', 'token2'],
      };

      const result = service.redactObject(input);

      expect(result).toEqual({
        servers: [
          { name: 'server1', password: '***' },
          { name: 'server2', apiKey: '***' },
        ],
        tokens: ['***', '***'],
      });
    });

    it('should handle null and undefined values', () => {
      const input = {
        password: null,
        token: undefined,
        normalField: 'value',
      };

      const result = service.redactObject(input);

      expect(result).toEqual({
        password: null,
        token: undefined,
        normalField: 'value',
      });
    });

    it('should handle circular references', () => {
      const input: any = {
        name: 'test',
        password: 'secret123',
      };
      input.self = input; // Create circular reference

      const result = service.redactObject(input);

      expect(result.name).toBe('test');
      expect(result.password).toBe('***');
      expect(result.self).toBe('[Circular Reference]');
    });

    it('should preserve non-object types', () => {
      expect(service.redactObject('string')).toBe('string');
      expect(service.redactObject(123)).toBe(123);
      expect(service.redactObject(true)).toBe(true);
      expect(service.redactObject(null)).toBe(null);
      expect(service.redactObject(undefined)).toBe(undefined);
    });
  });

  describe('isSensitiveField', () => {
    it('should identify password fields', () => {
      expect(service.isSensitiveField('password')).toBe(true);
      expect(service.isSensitiveField('PASSWORD')).toBe(true);
      expect(service.isSensitiveField('passwordHash')).toBe(true);
      expect(service.isSensitiveField('user_password')).toBe(true);
    });

    it('should identify key fields', () => {
      expect(service.isSensitiveField('key')).toBe(true);
      expect(service.isSensitiveField('apiKey')).toBe(true);
      expect(service.isSensitiveField('api_key')).toBe(true);
      expect(service.isSensitiveField('privateKey')).toBe(true);
      expect(service.isSensitiveField('publicKey')).toBe(false); // Public keys are not sensitive
    });

    it('should identify token fields', () => {
      expect(service.isSensitiveField('token')).toBe(true);
      expect(service.isSensitiveField('accessToken')).toBe(true);
      expect(service.isSensitiveField('refreshToken')).toBe(true);
      expect(service.isSensitiveField('bearerToken')).toBe(true);
    });

    it('should identify secret fields', () => {
      expect(service.isSensitiveField('secret')).toBe(true);
      expect(service.isSensitiveField('clientSecret')).toBe(true);
      expect(service.isSensitiveField('mfaSecret')).toBe(true);
    });

    it('should identify credential fields', () => {
      expect(service.isSensitiveField('credentials')).toBe(true);
      expect(service.isSensitiveField('auth')).toBe(true);
      expect(service.isSensitiveField('authorization')).toBe(true);
    });

    it('should not identify non-sensitive fields', () => {
      expect(service.isSensitiveField('username')).toBe(false);
      expect(service.isSensitiveField('email')).toBe(false);
      expect(service.isSensitiveField('name')).toBe(false);
      expect(service.isSensitiveField('id')).toBe(false);
      expect(service.isSensitiveField('hostname')).toBe(false);
    });
  });

  describe('redactCommandOutput', () => {
    it('should redact secrets from command stdout', () => {
      const commandResult = {
        command: 'mysql -u user -p',
        stdout: 'password=secret123\nConnection successful',
        stderr: '',
        exitCode: 0,
      };

      const result = service.redactCommandOutput(commandResult);

      expect(result.stdout).toBe('password=***\nConnection successful');
      expect(result.command).toBe('mysql -u user -p');
      expect(result.stderr).toBe('');
      expect(result.exitCode).toBe(0);
    });

    it('should redact secrets from command stderr', () => {
      const commandResult = {
        command: 'curl -H "Authorization: Bearer token123"',
        stdout: '',
        stderr: 'Error: Invalid token=abc123',
        exitCode: 1,
      };

      const result = service.redactCommandOutput(commandResult);

      expect(result.stderr).toBe('Error: Invalid token=***');
      expect(result.command).toBe('curl -H "Authorization: Bearer token123"');
    });

    it('should redact secrets from command itself', () => {
      const commandResult = {
        command: 'mysql -u user -ppassword123 database',
        stdout: 'Query executed',
        stderr: '',
        exitCode: 0,
      };

      const result = service.redactCommandOutput(commandResult);

      expect(result.command).toBe('mysql -u user -p*** database');
    });

    it('should handle command result with no secrets', () => {
      const commandResult = {
        command: 'ls -la',
        stdout: 'total 0\ndrwxr-xr-x 2 user user 4096 Jan 1 12:00 .',
        stderr: '',
        exitCode: 0,
      };

      const result = service.redactCommandOutput(commandResult);

      expect(result).toEqual(commandResult);
    });
  });

  describe('redactUrl', () => {
    it('should redact passwords from URLs', () => {
      const url = 'mysql://user:password123@localhost:3306/database';
      const result = service.redactUrl(url);

      expect(result).toBe('mysql://user:***@localhost:3306/database');
    });

    it('should redact tokens from query parameters', () => {
      const url = 'https://api.example.com/data?token=abc123&user=john';
      const result = service.redactUrl(url);

      expect(result).toBe('https://api.example.com/data?token=***&user=john');
    });

    it('should handle URLs with no credentials', () => {
      const url = 'https://example.com/path';
      const result = service.redactUrl(url);

      expect(result).toBe(url);
    });

    it('should handle malformed URLs gracefully', () => {
      const url = 'not-a-url';
      const result = service.redactUrl(url);

      expect(result).toBe(url);
    });
  });
});