import 'reflect-metadata';
import * as sodium from 'libsodium-wrappers';

// Global test setup
beforeAll(async () => {
  // Initialize libsodium for tests
  await sodium.ready;
  
  // Set test environment variables
  process.env['NODE_ENV'] = 'test';
  process.env['LOG_LEVEL'] = 'error';
  
  // Suppress console output during tests unless explicitly needed
  if (!process.env['VERBOSE_TESTS']) {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  }
});

afterAll(async () => {
  // Cleanup after all tests
  jest.restoreAllMocks();
});

// Custom Jest matchers
declare global {
  namespace jest {
    interface Matchers<R> {
      toBeValidUUID(): R;
      toBeValidTimestamp(): R;
      toContainRedactedSecrets(): R;
    }
  }
}

// Custom Jest matchers
expect.extend({
  toBeValidUUID(received: string) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const pass = uuidRegex.test(received);
    
    if (pass) {
      return {
        message: () => `expected ${received} not to be a valid UUID`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected ${received} to be a valid UUID`,
        pass: false,
      };
    }
  },
  
  toBeValidTimestamp(received: string | Date) {
    const date = new Date(received);
    const pass = !isNaN(date.getTime());
    
    if (pass) {
      return {
        message: () => `expected ${received} not to be a valid timestamp`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected ${received} to be a valid timestamp`,
        pass: false,
      };
    }
  },
  
  toContainRedactedSecrets(received: string) {
    const hasRedactedPasswords = /password[=:]\s*\*{3,}/i.test(received);
    const hasRedactedKeys = /key[=:]\s*\*{3,}/i.test(received);
    const hasRedactedTokens = /token[=:]\s*\*{3,}/i.test(received);
    const hasRedactedSecrets = /secret[=:]\s*\*{3,}/i.test(received);
    
    const pass = hasRedactedPasswords || hasRedactedKeys || hasRedactedTokens || hasRedactedSecrets;
    
    if (pass) {
      return {
        message: () => `expected ${received} not to contain redacted secrets`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected ${received} to contain redacted secrets (password=***, key=***, token=***, secret=***)`,
        pass: false,
      };
    }
  },
});