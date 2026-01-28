import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EncryptionService } from './encryption.service';
import * as fc from 'fast-check';

describe('EncryptionService Property-Based Tests', () => {
  let service: EncryptionService;

  const mockEncryptionKey = 'test-encryption-key-32-bytes!!';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EncryptionService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockImplementation((key: string) => {
              if (key === 'ENCRYPTION_KEY') {
                return mockEncryptionKey;
              }
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<EncryptionService>(EncryptionService);
    await service.onModuleInit();
  });

  describe('Property 13: Secret Encryption at Rest', () => {
    // **Validates: Requirements 6.2**
    it('should encrypt all secrets before storage', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 1000 }),
          (secret) => {
            const encrypted = service.encrypt(secret);
            
            // Property: Encrypted data should never equal original data
            expect(encrypted).not.toBe(secret);
            
            // Property: Encrypted data should be base64 encoded
            expect(encrypted).toMatch(/^[A-Za-z0-9+/]+=*$/);
            
            // Property: Decryption should recover original data
            const decrypted = service.decrypt(encrypted);
            expect(decrypted).toBe(secret);
          }
        ),
        { numRuns: 10 }
      );
    });

    it('should produce different ciphertexts for identical plaintexts', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 100 }),
          (plaintext) => {
            const encrypted1 = service.encrypt(plaintext);
            const encrypted2 = service.encrypt(plaintext);
            
            // Property: Same plaintext should produce different ciphertexts (semantic security)
            expect(encrypted1).not.toBe(encrypted2);
            
            // Property: Both should decrypt to original plaintext
            expect(service.decrypt(encrypted1)).toBe(plaintext);
            expect(service.decrypt(encrypted2)).toBe(plaintext);
          }
        ),
        { numRuns: 10 }
      );
    });

    it('should handle all valid string inputs without corruption', () => {
      fc.assert(
        fc.property(
          fc.string(),
          (input) => {
            if (input === '') {
              // Empty strings are handled specially
              expect(service.encrypt(input)).toBe(input);
              expect(service.decrypt(input)).toBe(input);
            } else {
              const encrypted = service.encrypt(input);
              const decrypted = service.decrypt(encrypted);
              
              // Property: Encryption/decryption should be lossless
              expect(decrypted).toBe(input);
              expect(decrypted.length).toBe(input.length);
            }
          }
        ),
        { numRuns: 10 }
      );
    });

    it('should handle unicode and special characters correctly', () => {
      fc.assert(
        fc.property(
          fc.string().filter(s => s.length > 0),
          fc.unicode(),
          fc.char(),
          (base, unicode, special) => {
            const complexString = base + unicode + special + '🔐💻🚀';
            const encrypted = service.encrypt(complexString);
            const decrypted = service.decrypt(encrypted);
            
            // Property: Unicode and special characters should be preserved
            expect(decrypted).toBe(complexString);
            expect(decrypted).toContain(unicode);
            expect(decrypted).toContain(special);
            expect(decrypted).toContain('🔐💻🚀');
          }
        ),
        { numRuns: 10 }
      );
    });
  });

  describe('Cryptographic Hash Properties', () => {
    it('should produce consistent hashes for identical inputs', () => {
      fc.assert(
        fc.property(
          fc.string(),
          (input) => {
            const hash1 = service.hash(input);
            const hash2 = service.hash(input);
            
            // Property: Hash function should be deterministic
            expect(hash1).toBe(hash2);
            
            // Property: Hash should be 64 hex characters (32 bytes)
            expect(hash1).toMatch(/^[a-f0-9]{64}$/);
          }
        ),
        { numRuns: 10 }
      );
    });

    it('should produce different hashes for different inputs', () => {
      fc.assert(
        fc.property(
          fc.string(),
          fc.string(),
          (input1, input2) => {
            fc.pre(input1 !== input2); // Only test different inputs
            
            const hash1 = service.hash(input1);
            const hash2 = service.hash(input2);
            
            // Property: Different inputs should produce different hashes (collision resistance)
            expect(hash1).not.toBe(hash2);
          }
        ),
        { numRuns: 10 }
      );
    });

    it('should verify hashes correctly', () => {
      fc.assert(
        fc.property(
          fc.string(),
          (input) => {
            const hash = service.hash(input);
            
            // Property: Hash verification should be consistent
            expect(service.verifyHash(input, hash)).toBe(true);
            
            // Property: Wrong data should not verify
            if (input !== 'wrong-data') {
              expect(service.verifyHash('wrong-data', hash)).toBe(false);
            }
          }
        ),
        { numRuns: 10 }
      );
    });
  });

  describe('Key Derivation Properties', () => {
    it('should derive consistent keys from same password and salt', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 100 }),
          fc.string({ minLength: 1, maxLength: 100 }),
          (password, saltBase) => {
            // Use a consistent salt for this test
            const salt = service.generateSalt();
            
            const key1 = service.deriveKey(password, salt);
            const key2 = service.deriveKey(password, salt);
            
            // Property: Key derivation should be deterministic
            expect(key1).toBe(key2);
            
            // Property: Derived key should be base64 encoded
            expect(key1).toMatch(/^[A-Za-z0-9+/]+=*$/);
          }
        ),
        { numRuns: 10 }
      );
    });

    it('should derive different keys for different passwords', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 50 }),
          fc.string({ minLength: 1, maxLength: 50 }),
          (password1, password2) => {
            fc.pre(password1 !== password2); // Only test different passwords
            
            const salt = service.generateSalt();
            const key1 = service.deriveKey(password1, salt);
            const key2 = service.deriveKey(password2, salt);
            
            // Property: Different passwords should produce different keys
            expect(key1).not.toBe(key2);
          }
        ),
        { numRuns: 10 }
      );
    });

    it('should derive different keys for different salts', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 50 }),
          (password) => {
            const salt1 = service.generateSalt();
            const salt2 = service.generateSalt();
            
            const key1 = service.deriveKey(password, salt1);
            const key2 = service.deriveKey(password, salt2);
            
            // Property: Different salts should produce different keys
            expect(key1).not.toBe(key2);
          }
        ),
        { numRuns: 10 }
      );
    });
  });

  describe('Random Generation Properties', () => {
    it('should generate unique random strings', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 100 }),
          (length) => {
            const strings = Array.from({ length: 10 }, () => 
              service.generateRandomString(length)
            );
            
            // Property: All generated strings should be unique
            const uniqueStrings = new Set(strings);
            expect(uniqueStrings.size).toBe(strings.length);
            
            // Property: All strings should have correct length
            strings.forEach(str => {
              expect(str.length).toBe(length);
            });
          }
        ),
        { numRuns: 10 }
      );
    });

    it('should generate unique salts', () => {
      const salts = Array.from({ length: 100 }, () => service.generateSalt());
      
      // Property: All salts should be unique
      const uniqueSalts = new Set(salts);
      expect(uniqueSalts.size).toBe(salts.length);
      
      // Property: All salts should be base64 encoded
      salts.forEach(salt => {
        expect(salt).toMatch(/^[A-Za-z0-9+/]+=*$/);
      });
    });

    it('should generate valid UUIDs', () => {
      const uuids = Array.from({ length: 100 }, () => service.generateSecureUUID());
      
      // Property: All UUIDs should be unique
      const uniqueUuids = new Set(uuids);
      expect(uniqueUuids.size).toBe(uuids.length);
      
      // Property: All UUIDs should match v4 format
      const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      uuids.forEach(uuid => {
        expect(uuid).toMatch(uuidPattern);
      });
    });
  });

  describe('Constant Time Comparison Properties', () => {
    it('should compare strings correctly', () => {
      fc.assert(
        fc.property(
          fc.string(),
          fc.string(),
          (str1, str2) => {
            const result = service.constantTimeCompare(str1, str2);
            
            // Property: Should return true for identical strings
            if (str1 === str2) {
              expect(result).toBe(true);
            } else {
              expect(result).toBe(false);
            }
          }
        ),
        { numRuns: 10 }
      );
    });

    it('should handle different length strings', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 50 }),
          fc.string({ minLength: 51, maxLength: 100 }),
          (shortStr, longStr) => {
            // Property: Different length strings should always return false
            expect(service.constantTimeCompare(shortStr, longStr)).toBe(false);
            expect(service.constantTimeCompare(longStr, shortStr)).toBe(false);
          }
        ),
        { numRuns: 10 }
      );
    });
  });

  describe('Error Handling Properties', () => {
    it('should handle invalid encrypted data gracefully', () => {
      fc.assert(
        fc.property(
          fc.string().filter(s => !s.match(/^[A-Za-z0-9+/]+=*$/)), // Invalid base64
          (invalidData) => {
            // Property: Invalid encrypted data should throw specific error
            expect(() => service.decrypt(invalidData)).toThrow('Decryption failed');
          }
        ),
        { numRuns: 10 }
      );
    });

    it('should handle edge cases consistently', () => {
      // Property: Empty string handling should be consistent
      expect(service.encrypt('')).toBe('');
      expect(service.decrypt('')).toBe('');
      
      // Property: Null/undefined handling should be consistent
      expect(service.encrypt(null as any)).toBe(null);
      expect(service.encrypt(undefined as any)).toBe(undefined);
      expect(service.decrypt(null as any)).toBe(null);
      expect(service.decrypt(undefined as any)).toBe(undefined);
    });
  });

  describe('Performance Properties', () => {
    it('should encrypt and decrypt within reasonable time bounds', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 10000 }),
          (data) => {
            const startTime = Date.now();
            const encrypted = service.encrypt(data);
            const encryptTime = Date.now() - startTime;
            
            const decryptStart = Date.now();
            const decrypted = service.decrypt(encrypted);
            const decryptTime = Date.now() - decryptStart;
            
            // Property: Operations should complete within reasonable time (1 second)
            expect(encryptTime).toBeLessThan(1000);
            expect(decryptTime).toBeLessThan(1000);
            
            // Property: Decryption should recover original data
            expect(decrypted).toBe(data);
          }
        ),
        { numRuns: 10 }
      );
    });
  });
});