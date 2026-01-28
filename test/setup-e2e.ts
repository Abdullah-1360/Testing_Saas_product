import 'reflect-metadata';

// End-to-end test setup
beforeAll(async () => {
  // Set test environment
  process.env['NODE_ENV'] = 'test';
  process.env['DATABASE_URL'] = process.env['TEST_DATABASE_URL'] || 'postgresql://test:test@localhost:5432/wp_autohealer_test';
  process.env['REDIS_URL'] = process.env['TEST_REDIS_URL'] || 'redis://localhost:6379/1';
  
  // Increase timeout for e2e tests
  jest.setTimeout(60000);
});

afterAll(async () => {
  // Cleanup after e2e tests
  jest.restoreAllMocks();
});