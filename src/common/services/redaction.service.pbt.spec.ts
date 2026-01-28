import { Test, TestingModule } from '@nestjs/testing';
import { RedactionService } from './redaction.service';
import * as fc from 'fast-check';

describe('RedactionService Property-Based Tests', () => {
  let service: RedactionService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RedactionService],
    }).compile();

    service = module.get<RedactionService>(RedactionService);
  });

  describe('Property 12: Secret Redaction in Logs and APIs', () => {
    // **Validates: Requirements 6.1, 6.10**
    it('should never expose secrets in redacted text', () => {
      fc.assert(
        fc.property(
          fc.record({
            secretType: fc.constantFrom('password', 'key', 'token', 'secret', 'apikey'),
            secretValue: fc.string({ minLength: 8, maxLength: 50 }),
            safeText: fc.string({ minLength: 1, maxLength: 100 }),
          }),
          ({ secretType, secretValue, safeText }) => {
            const sensitiveText = `${safeText} ${secretType}=${secretValue} more text`;
            const redacted = service.redactText(sensitiveText);
            
            // Property: Secret values should never appear in redacted output
            expect(redacted).not.toContain(secretValue);
            
            // Property: Safe text should be preserved
            expect(redacted).toContain(safeText);
            expect(redacted).toContain('more text');
            
            // Property: Redacted output should contain redaction marker
            expect(redacted).toContain('***');
          }
        ),
        { numRuns: 10 }
      );
    });

    it('should redact all sensitive field names in objects', () => {
      fc.assert(
        fc.property(
          fc.record({
            sensitiveField: fc.constantFrom(
              'password', 'pwd', 'passwd', 'key', 'apikey', 'api_key',
              'token', 'secret', 'credentials', 'auth', 'privatekey'
            ),
            sensitiveValue: fc.string({ minLength: 1, maxLength: 100 }),
            safeField: fc.constantFrom('username', 'email', 'name', 'id', 'status'),
            safeValue: fc.string({ minLength: 1, maxLength: 50 }),
          }),
          ({ sensitiveField, sensitiveValue, safeField, safeValue }) => {
            const obj = {
              [sensitiveField]: sensitiveValue,
              [safeField]: safeValue,
            };
            
            const redacted = service.redactObject(obj);
            
            // Property: Sensitive field values should be redacted
            expect(redacted[sensitiveField]).toBe('***');
            
            // Property: Safe field values should be preserved
            expect(redacted[safeField]).toBe(safeValue);
            
            // Property: Original sensitive value should not appear anywhere
            expect(JSON.stringify(redacted)).not.toContain(sensitiveValue);
          }
        ),
        { numRuns: 10 }
      );
    });

    it('should handle nested objects with sensitive data', () => {
      fc.assert(
        fc.property(
          fc.record({
            level1Secret: fc.string({ minLength: 8, maxLength: 30 }),
            level2Secret: fc.string({ minLength: 8, maxLength: 30 }),
            level3Secret: fc.string({ minLength: 8, maxLength: 30 }),
            safeData: fc.string({ minLength: 1, maxLength: 30 }),
          }),
          ({ level1Secret, level2Secret, level3Secret, safeData }) => {
            const nestedObj = {
              safe: safeData,
              password: level1Secret,
              config: {
                safe: safeData,
                apikey: level2Secret,
                database: {
                  safe: safeData,
                  secret: level3Secret,
                },
              },
            };
            
            const redacted = service.redactObject(nestedObj);
            const redactedJson = JSON.stringify(redacted);
            
            // Property: No secret values should appear in redacted output
            expect(redactedJson).not.toContain(level1Secret);
            expect(redactedJson).not.toContain(level2Secret);
            expect(redactedJson).not.toContain(level3Secret);
            
            // Property: Safe data should be preserved at all levels
            expect(redacted.safe).toBe(safeData);
            expect(redacted.config.safe).toBe(safeData);
            expect(redacted.config.database.safe).toBe(safeData);
            
            // Property: Sensitive fields should be redacted at all levels
            expect(redacted.password).toBe('***');
            expect(redacted.config.apikey).toBe('***');
            expect(redacted.config.database.secret).toBe('***');
          }
        ),
        { numRuns: 10 }
      );
    });

    it('should redact database connection strings consistently', () => {
      fc.assert(
        fc.property(
          fc.record({
            protocol: fc.constantFrom('postgresql', 'mysql', 'mongodb', 'redis'),
            username: fc.string({ minLength: 3, maxLength: 20 }),
            password: fc.string({ minLength: 8, maxLength: 30 }),
            host: fc.domain(),
            port: fc.integer({ min: 1000, max: 65535 }),
            database: fc.string({ minLength: 3, maxLength: 20 }),
          }),
          ({ protocol, username, password, host, port, database }) => {
            const connectionString = `${protocol}://${username}:${password}@${host}:${port}/${database}`;
            const redacted = service.redactText(connectionString);
            
            // Property: Password should never appear in redacted output
            expect(redacted).not.toContain(password);
            
            // Property: Username should not appear in redacted output (part of credentials)
            expect(redacted).not.toContain(username);
            
            // Property: Connection string should be redacted to safe form
            expect(redacted).toBe(`${protocol}://***`);
          }
        ),
        { numRuns: 10 }
      );
    });

    it('should handle arrays with sensitive data', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              id: fc.integer({ min: 1, max: 1000 }),
              password: fc.string({ minLength: 8, maxLength: 30 }),
              name: fc.string({ minLength: 3, maxLength: 20 }),
            }),
            { minLength: 1, maxLength: 10 }
          ),
          (users) => {
            const redacted = service.redactArray(users);
            const redactedJson = JSON.stringify(redacted);
            
            // Property: No password should appear in redacted output
            users.forEach(user => {
              expect(redactedJson).not.toContain(user.password);
            });
            
            // Property: Safe data should be preserved
            users.forEach((user, index) => {
              expect(redacted[index].id).toBe(user.id);
              expect(redacted[index].name).toBe(user.name);
              expect(redacted[index].password).toBe('***');
            });
          }
        ),
        { numRuns: 10 }
      );
    });

    it('should detect sensitive information correctly', () => {
      fc.assert(
        fc.property(
          fc.record({
            sensitivePattern: fc.constantFrom(
              'password=', 'key=', 'token=', 'secret=', 'apikey:'
            ),
            sensitiveValue: fc.string({ minLength: 8, maxLength: 30 }),
            safeText: fc.string({ minLength: 10, maxLength: 50 }),
          }),
          ({ sensitivePattern, sensitiveValue, safeText }) => {
            const sensitiveText = `${safeText} ${sensitivePattern}${sensitiveValue}`;
            const purelySeafeText = safeText.replace(/password|key|token|secret|api/gi, 'data');
            
            // Property: Text with sensitive patterns should be detected
            expect(service.containsSensitiveInfo(sensitiveText)).toBe(true);
            
            // Property: Safe text should not be detected as sensitive
            expect(service.containsSensitiveInfo(purelySeafeText)).toBe(false);
          }
        ),
        { numRuns: 10 }
      );
    });
  });

  describe('Command Redaction Properties', () => {
    it('should redact password flags in commands', () => {
      fc.assert(
        fc.property(
          fc.record({
            command: fc.constantFrom('mysql', 'psql', 'ssh', 'scp'),
            passwordFlag: fc.constantFrom('-p', '--password', '-i', '--identity'),
            password: fc.string({ minLength: 8, maxLength: 30 }),
            otherArgs: fc.string({ minLength: 5, maxLength: 50 }),
          }),
          ({ command, passwordFlag, password, otherArgs }) => {
            const fullCommand = `${command} ${passwordFlag} ${password} ${otherArgs}`;
            const redacted = service.redactCommand(fullCommand);
            
            // Property: Password should never appear in redacted command
            expect(redacted).not.toContain(password);
            
            // Property: Command and safe arguments should be preserved
            expect(redacted).toContain(command);
            expect(redacted).toContain(otherArgs);
            
            // Property: Redacted command should contain redaction marker
            expect(redacted).toContain('***');
          }
        ),
        { numRuns: 10 }
      );
    });

    it('should redact environment variables with sensitive names', () => {
      fc.assert(
        fc.property(
          fc.record({
            envVar: fc.constantFrom(
              'API_SECRET', 'DATABASE_PASSWORD', 'JWT_SECRET', 
              'ENCRYPTION_KEY', 'PRIVATE_KEY', 'ACCESS_TOKEN'
            ),
            envValue: fc.string({ minLength: 8, maxLength: 30 }),
            command: fc.string({ minLength: 5, maxLength: 20 }),
          }),
          ({ envVar, envValue, command }) => {
            const fullCommand = `${envVar}=${envValue} ${command}`;
            const redacted = service.redactCommand(fullCommand);
            
            // Property: Environment variable value should be redacted
            expect(redacted).not.toContain(envValue);
            
            // Property: Environment variable name and command should be preserved
            expect(redacted).toContain(envVar);
            expect(redacted).toContain(command);
            
            // Property: Should contain redaction marker
            expect(redacted).toContain('***');
          }
        ),
        { numRuns: 10 }
      );
    });
  });

  describe('Consistency Properties', () => {
    it('should be idempotent - redacting twice should produce same result', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 10, maxLength: 100 }),
          fc.string({ minLength: 8, maxLength: 30 }),
          (baseText, secret) => {
            const sensitiveText = `${baseText} password=${secret}`;
            const redacted1 = service.redactText(sensitiveText);
            const redacted2 = service.redactText(redacted1);
            
            // Property: Redaction should be idempotent
            expect(redacted1).toBe(redacted2);
          }
        ),
        { numRuns: 10 }
      );
    });

    it('should handle mixed case sensitivity consistently', () => {
      fc.assert(
        fc.property(
          fc.record({
            fieldName: fc.constantFrom('password', 'PASSWORD', 'Password', 'PassWord'),
            secretValue: fc.string({ minLength: 8, maxLength: 30 }),
          }),
          ({ fieldName, secretValue }) => {
            const obj = { [fieldName]: secretValue };
            const redacted = service.redactObject(obj);
            
            // Property: All case variations should be redacted
            expect(redacted[fieldName]).toBe('***');
            
            // Property: Secret value should not appear in output
            expect(JSON.stringify(redacted)).not.toContain(secretValue);
          }
        ),
        { numRuns: 10 }
      );
    });

    it('should preserve data types for non-sensitive fields', () => {
      fc.assert(
        fc.property(
          fc.record({
            stringField: fc.string(),
            numberField: fc.integer(),
            booleanField: fc.boolean(),
            nullField: fc.constant(null),
            secretField: fc.string({ minLength: 8, maxLength: 30 }),
          }),
          (obj) => {
            const testObj = {
              ...obj,
              password: obj.secretField, // Make one field sensitive
            };
            
            const redacted = service.redactObject(testObj);
            
            // Property: Non-sensitive field types should be preserved
            expect(typeof redacted.stringField).toBe('string');
            expect(typeof redacted.numberField).toBe('number');
            expect(typeof redacted.booleanField).toBe('boolean');
            expect(redacted.nullField).toBe(null);
            
            // Property: Values should be preserved for non-sensitive fields
            expect(redacted.stringField).toBe(obj.stringField);
            expect(redacted.numberField).toBe(obj.numberField);
            expect(redacted.booleanField).toBe(obj.booleanField);
            
            // Property: Sensitive field should be redacted
            expect(redacted.password).toBe('***');
          }
        ),
        { numRuns: 10 }
      );
    });
  });

  describe('Edge Case Properties', () => {
    it('should handle empty and null inputs gracefully', () => {
      // Property: Empty inputs should be handled consistently
      expect(service.redactText('')).toBe('');
      expect(service.redactText(null as any)).toBe(null);
      expect(service.redactText(undefined as any)).toBe(undefined);
      
      expect(service.redactObject(null)).toBe(null);
      expect(service.redactObject(undefined)).toBe(undefined);
      expect(service.redactObject({})).toEqual({});
      
      expect(service.redactCommand('')).toBe('');
      expect(service.redactCommand(null as any)).toBe(null);
      expect(service.redactCommand(undefined as any)).toBe(undefined);
      
      expect(service.containsSensitiveInfo('')).toBe(false);
      expect(service.containsSensitiveInfo(null as any)).toBe(false);
      expect(service.containsSensitiveInfo(undefined as any)).toBe(false);
    });

    it('should handle non-string, non-object inputs correctly', () => {
      fc.assert(
        fc.property(
          fc.oneof(fc.integer(), fc.boolean(), fc.float()),
          (primitiveValue) => {
            // Property: Primitive values should pass through unchanged
            expect(service.redactText(primitiveValue as any)).toBe(primitiveValue);
            expect(service.redactObject(primitiveValue as any)).toBe(primitiveValue);
            expect(service.redactCommand(primitiveValue as any)).toBe(primitiveValue);
            expect(service.containsSensitiveInfo(primitiveValue as any)).toBe(false);
          }
        ),
        { numRuns: 10 }
      );
    });

    it('should handle deeply nested structures without stack overflow', () => {
      // Create a deeply nested object
      let deepObj: any = { safe: 'data', password: 'secret' };
      for (let i = 0; i < 100; i++) {
        deepObj = { 
          level: i, 
          nested: deepObj, 
          password: `secret-${i}`,
          safe: `safe-${i}` 
        };
      }
      
      // Property: Should handle deep nesting without errors
      expect(() => service.redactObject(deepObj)).not.toThrow();
      
      const redacted = service.redactObject(deepObj);
      
      // Property: All password fields should be redacted at all levels
      const checkRedaction = (obj: any): void => {
        if (obj && typeof obj === 'object') {
          if (obj.password) {
            expect(obj.password).toBe('***');
          }
          if (obj.nested) {
            checkRedaction(obj.nested);
          }
        }
      };
      
      checkRedaction(redacted);
    });
  });

  describe('Performance Properties', () => {
    it('should redact large objects within reasonable time', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              id: fc.integer(),
              password: fc.string({ minLength: 8, maxLength: 30 }),
              data: fc.string({ minLength: 10, maxLength: 100 }),
            }),
            { minLength: 100, maxLength: 1000 }
          ),
          (largeArray) => {
            const startTime = Date.now();
            const redacted = service.redactArray(largeArray);
            const endTime = Date.now();
            
            // Property: Large object redaction should complete within reasonable time (5 seconds)
            expect(endTime - startTime).toBeLessThan(5000);
            
            // Property: All passwords should be redacted
            redacted.forEach(item => {
              expect(item.password).toBe('***');
            });
          }
        ),
        { numRuns: 5 } // Fewer runs for performance tests
      );
    });
  });
});