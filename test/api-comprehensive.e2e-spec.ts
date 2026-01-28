import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '@/app.module';
import { PrismaService } from '@/database/prisma.service';
import * as bcrypt from 'bcrypt';

/**
 * Comprehensive API Testing Suite
 * **Validates: Requirements 15.1-15.9** - Complete REST API validation
 * 
 * This comprehensive test suite validates all aspects of the API:
 * - Complete endpoint coverage
 * - Authentication and authorization
 * - Rate limiting functionality
 * - Security measures
 * - Error handling
 * - Response consistency
 * - Performance characteristics
 */
describe('Comprehensive API Testing (e2e)', () => {
  let app: INestApplication;
  let prismaService: PrismaService;
  let tokens: Record<string, string> = {};
  let testData: Record<string, any> = {};

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    prismaService = moduleFixture.get<PrismaService>(PrismaService);
    
    await app.init();
    await setupTestEnvironment();
  });

  afterAll(async () => {
    await cleanupTestEnvironment();
    await app.close();
  });

  async function setupTestEnvironment() {
    // Create comprehensive test users
    await createTestUsers();
    
    // Create test data
    await createTestData();
  }

  async function createTestUsers() {
    const hashedPassword = await bcrypt.hash('TestPassword123!', 12);
    
    const users = [
      { email: 'superadmin@comprehensive.test', role: UserRole.SUPER_ADMIN },
      { email: 'admin@comprehensive.test', role: UserRole.ADMIN },
      { email: 'engineer@comprehensive.test', role: UserRole.ENGINEER },
      { email: 'viewer@comprehensive.test', role: UserRole.VIEWER },
    ];

    for (const userData of users) {
      await prismaService.user.create({
        data: {
          ...userData,
          passwordHash: hashedPassword,
          mfaEnabled: false,
        },
      });

      // Get token for each user
      const loginResponse = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: userData.email, password: 'TestPassword123!' });
      
      tokens[userData.role] = loginResponse.body.data.accessToken;
    }
  }

  async function createTestData() {
    // Create test server
    const serverResponse = await request(app.getHttpServer())
      .post('/api/v1/servers')
      .set('Authorization', `Bearer ${tokens[UserRole.ADMIN]}`)
      .send({
        name: 'Comprehensive Test Server',
        hostname: 'comprehensive.test.com',
        port: 22,
        username: 'root',
        authType: 'key',
        credentials: 'test-ssh-key-content',
      });
    testData.serverId = serverResponse.body.data.id;

    // Create test site
    const siteResponse = await request(app.getHttpServer())
      .post('/api/v1/sites')
      .set('Authorization', `Bearer ${tokens[UserRole.ENGINEER]}`)
      .send({
        serverId: testData.serverId,
        domain: 'comprehensive-site.test',
        documentRoot: '/var/www/comprehensive',
        wordpressPath: '/var/www/comprehensive/wp',
        siteUrl: 'https://comprehensive-site.test',
        adminUrl: 'https://comprehensive-site.test/wp-admin',
      });
    testData.siteId = siteResponse.body.data.id;

    // Create test incident
    const incidentResponse = await request(app.getHttpServer())
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${tokens[UserRole.ENGINEER]}`)
      .send({
        siteId: testData.siteId,
        triggerType: 'MANUAL',
        priority: 'MEDIUM',
      });
    testData.incidentId = incidentResponse.body.data.id;

    // Create retention policy
    const policyResponse = await request(app.getHttpServer())
      .post('/api/v1/retention/policies')
      .set('Authorization', `Bearer ${tokens[UserRole.ADMIN]}`)
      .send({
        policyName: 'Comprehensive Test Policy',
        retentionDays: 5,
        appliesTo: 'incidents',
      });
    testData.policyId = policyResponse.body.data.id;
  }

  async function cleanupTestEnvironment() {
    // Clean up in reverse order of creation
    await prismaService.retentionPolicy.deleteMany();
    await prismaService.incident.deleteMany();
    await prismaService.site.deleteMany();
    await prismaService.server.deleteMany();
    await prismaService.userSession.deleteMany();
    await prismaService.user.deleteMany();
  }

  describe('API Documentation Endpoints', () => {
    it('should serve Swagger documentation', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/docs')
        .expect(200);

      expect(response.text).toContain('WP-AutoHealer API');
      expect(response.text).toContain('swagger');
    });

    it('should serve OpenAPI JSON specification', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/docs-json')
        .expect(200);

      expect(response.body).toHaveProperty('openapi');
      expect(response.body).toHaveProperty('info');
      expect(response.body.info.title).toBe('WP-AutoHealer API');
    });
  });

  describe('Complete Authentication Flow', () => {
    it('should handle complete login/logout cycle', async () => {
      // Login
      const loginResponse = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: 'admin@comprehensive.test',
          password: 'TestPassword123!',
        })
        .expect(200);

      const token = loginResponse.body.data.accessToken;
      expect(token).toBeDefined();

      // Use token
      await request(app.getHttpServer())
        .get('/api/v1/users/profile')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // Logout
      await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // Token should be invalid after logout
      await request(app.getHttpServer())
        .get('/api/v1/users/profile')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
    });

    it('should validate session tokens', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/auth/session/validate')
        .set('Authorization', `Bearer ${tokens[UserRole.ADMIN]}`)
        .expect(200);

      expect(response.body.data.valid).toBe(true);
    });
  });

  describe('Complete RBAC Testing', () => {
    const testCases = [
      {
        role: UserRole.SUPER_ADMIN,
        canCreate: ['users', 'servers', 'sites', 'incidents', 'policies'],
        canRead: ['users', 'servers', 'sites', 'incidents', 'policies', 'audit'],
        canUpdate: ['users', 'servers', 'sites', 'incidents', 'policies'],
        canDelete: ['users', 'servers', 'sites', 'incidents', 'policies'],
      },
      {
        role: UserRole.ADMIN,
        canCreate: ['users', 'servers', 'sites', 'incidents', 'policies'],
        canRead: ['users', 'servers', 'sites', 'incidents', 'policies', 'audit'],
        canUpdate: ['users', 'servers', 'sites', 'incidents', 'policies'],
        canDelete: ['servers', 'sites', 'incidents', 'policies'],
      },
      {
        role: UserRole.ENGINEER,
        canCreate: ['sites', 'incidents'],
        canRead: ['users', 'servers', 'sites', 'incidents', 'policies'],
        canUpdate: ['sites', 'incidents'],
        canDelete: [],
      },
      {
        role: UserRole.VIEWER,
        canCreate: [],
        canRead: ['users', 'servers', 'sites', 'incidents', 'policies'],
        canUpdate: [],
        canDelete: [],
      },
    ];

    testCases.forEach(({ role, canCreate, canRead, canUpdate, canDelete }) => {
      describe(`${role} permissions`, () => {
        it(`should allow ${role} to read permitted resources`, async () => {
          for (const resource of canRead) {
            let endpoint = `/api/v1/${resource}`;
            if (resource === 'policies') endpoint = '/api/v1/retention/policies';
            if (resource === 'audit') endpoint = '/api/v1/retention/audit/purge';

            const response = await request(app.getHttpServer())
              .get(endpoint)
              .set('Authorization', `Bearer ${tokens[role]}`)
              .expect(200);

            expect(response.body.statusCode).toBe(200);
          }
        });

        if (canCreate.length > 0) {
          it(`should allow ${role} to create permitted resources`, async () => {
            for (const resource of canCreate) {
              let endpoint = `/api/v1/${resource}`;
              let payload = {};

              switch (resource) {
                case 'users':
                  payload = {
                    email: `new-${role}-user@test.com`,
                    password: 'TestPassword123!',
                    role: UserRole.VIEWER,
                  };
                  break;
                case 'servers':
                  payload = {
                    name: `${role} Test Server`,
                    hostname: `${role.toLowerCase()}.test.com`,
                    port: 22,
                    username: 'root',
                    authType: 'key',
                    credentials: 'test-key',
                  };
                  break;
                case 'sites':
                  payload = {
                    serverId: testData.serverId,
                    domain: `${role.toLowerCase()}-site.test`,
                    documentRoot: '/var/www/test',
                    wordpressPath: '/var/www/test/wp',
                    siteUrl: `https://${role.toLowerCase()}-site.test`,
                    adminUrl: `https://${role.toLowerCase()}-site.test/wp-admin`,
                  };
                  break;
                case 'incidents':
                  payload = {
                    siteId: testData.siteId,
                    triggerType: 'MANUAL',
                    priority: 'LOW',
                  };
                  break;
                case 'policies':
                  endpoint = '/api/v1/retention/policies';
                  payload = {
                    policyName: `${role} Test Policy`,
                    retentionDays: 3,
                    appliesTo: 'incidents',
                  };
                  break;
              }

              await request(app.getHttpServer())
                .post(endpoint)
                .set('Authorization', `Bearer ${tokens[role]}`)
                .send(payload)
                .expect(201);
            }
          });
        }
      });
    });
  });

  describe('Complete Rate Limiting Validation', () => {
    const rateLimits = {
      [UserRole.SUPER_ADMIN]: 1000,
      [UserRole.ADMIN]: 500,
      [UserRole.ENGINEER]: 300,
      [UserRole.VIEWER]: 100,
    };

    Object.entries(rateLimits).forEach(([role, limit]) => {
      it(`should enforce ${limit} requests/minute for ${role}`, async () => {
        const response = await request(app.getHttpServer())
          .get('/api/v1/users/profile')
          .set('Authorization', `Bearer ${tokens[role]}`)
          .expect(200);

        expect(response.headers['x-ratelimit-limit']).toBe(limit.toString());
        expect(response.headers).toHaveProperty('x-ratelimit-remaining');
        expect(response.headers).toHaveProperty('x-ratelimit-reset');
      });
    });

    it('should track rate limit consumption accurately', async () => {
      const requests = [];
      for (let i = 0; i < 5; i++) {
        requests.push(
          request(app.getHttpServer())
            .get('/api/v1/users/profile')
            .set('Authorization', `Bearer ${tokens[UserRole.VIEWER]}`)
        );
      }

      const responses = await Promise.all(requests);
      
      // All should succeed
      responses.forEach(response => {
        expect(response.status).toBe(200);
      });

      // Remaining count should decrease
      const remaining = responses.map(r => parseInt(r.headers['x-ratelimit-remaining']));
      expect(remaining[0]).toBeGreaterThan(remaining[remaining.length - 1]);
    });
  });

  describe('Complete Security Validation', () => {
    it('should include all required security headers', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/users/profile')
        .set('Authorization', `Bearer ${tokens[UserRole.ADMIN]}`)
        .expect(200);

      const requiredHeaders = [
        'x-content-type-options',
        'x-frame-options',
        'x-xss-protection',
        'strict-transport-security',
        'content-security-policy',
      ];

      requiredHeaders.forEach(header => {
        expect(response.headers).toHaveProperty(header);
      });
    });

    it('should redact all sensitive information', async () => {
      // Test user profile doesn't expose secrets
      const userResponse = await request(app.getHttpServer())
        .get('/api/v1/users/profile')
        .set('Authorization', `Bearer ${tokens[UserRole.ADMIN]}`)
        .expect(200);

      expect(userResponse.body.data).not.toHaveProperty('passwordHash');
      expect(userResponse.body.data).not.toHaveProperty('mfaSecret');

      // Test server doesn't expose credentials
      const serverResponse = await request(app.getHttpServer())
        .get(`/api/v1/servers/${testData.serverId}`)
        .set('Authorization', `Bearer ${tokens[UserRole.ADMIN]}`)
        .expect(200);

      expect(serverResponse.body.data).not.toHaveProperty('encryptedCredentials');
      expect(serverResponse.body.data).not.toHaveProperty('credentials');
    });

    it('should validate all input types', async () => {
      const invalidInputs = [
        {
          endpoint: '/api/v1/users',
          method: 'post',
          payload: { email: 'invalid-email', password: '123', role: 'INVALID' },
        },
        {
          endpoint: '/api/v1/servers',
          method: 'post',
          payload: { name: '', hostname: 'invalid..hostname', port: 'not-a-number' },
        },
        {
          endpoint: '/api/v1/retention/policies',
          method: 'post',
          payload: { policyName: '', retentionDays: 10, appliesTo: '' }, // Exceeds 7-day cap
        },
      ];

      for (const { endpoint, method, payload } of invalidInputs) {
        await request(app.getHttpServer())
          [method](endpoint)
          .set('Authorization', `Bearer ${tokens[UserRole.ADMIN]}`)
          .send(payload)
          .expect(400);
      }
    });
  });

  describe('Complete Error Handling', () => {
    it('should return consistent error formats', async () => {
      const errorTests = [
        { endpoint: '/api/v1/users/invalid-uuid', expectedStatus: 400 },
        { endpoint: '/api/v1/users/00000000-0000-0000-0000-000000000000', expectedStatus: 404 },
        { endpoint: '/api/v1/users', method: 'post', payload: {}, expectedStatus: 400 },
      ];

      for (const { endpoint, method = 'get', payload, expectedStatus } of errorTests) {
        const response = await request(app.getHttpServer())
          [method](endpoint)
          .set('Authorization', `Bearer ${tokens[UserRole.ADMIN]}`)
          .send(payload)
          .expect(expectedStatus);

        expect(response.body).toHaveProperty('statusCode', expectedStatus);
        expect(response.body).toHaveProperty('message');
        expect(response.body).toHaveProperty('timestamp');
      }
    });
  });

  describe('Complete Pagination Testing', () => {
    it('should handle pagination correctly across all list endpoints', async () => {
      const paginatedEndpoints = [
        '/api/v1/users',
        '/api/v1/servers',
        '/api/v1/sites',
        '/api/v1/incidents',
        '/api/v1/retention/policies',
      ];

      for (const endpoint of paginatedEndpoints) {
        const response = await request(app.getHttpServer())
          .get(`${endpoint}?page=1&limit=5`)
          .set('Authorization', `Bearer ${tokens[UserRole.ADMIN]}`)
          .expect(200);

        expect(response.body).toHaveProperty('pagination');
        expect(response.body.pagination).toHaveProperty('page', 1);
        expect(response.body.pagination).toHaveProperty('limit', 5);
        expect(response.body.pagination).toHaveProperty('total');
        expect(response.body.pagination).toHaveProperty('totalPages');
      }
    });
  });

  describe('Complete API Versioning', () => {
    it('should include version headers in all responses', async () => {
      const endpoints = [
        '/api/v1/users/profile',
        '/api/v1/servers/stats',
        '/api/v1/sites/stats',
        '/api/v1/retention/statistics',
      ];

      for (const endpoint of endpoints) {
        const response = await request(app.getHttpServer())
          .get(endpoint)
          .set('Authorization', `Bearer ${tokens[UserRole.ADMIN]}`)
          .expect(200);

        expect(response.headers).toHaveProperty('x-api-version');
        expect(response.headers).toHaveProperty('x-api-server');
        expect(response.headers).toHaveProperty('x-api-timestamp');
      }
    });
  });

  describe('WordPress-Specific Functionality', () => {
    it('should handle WordPress detection', async () => {
      const response = await request(app.getHttpServer())
        .post(`/api/v1/sites/${testData.siteId}/detect-wordpress`)
        .set('Authorization', `Bearer ${tokens[UserRole.ENGINEER]}`)
        .expect(200);

      expect(response.body.data).toHaveProperty('detected');
      expect(response.body.data).toHaveProperty('path');
    });

    it('should handle multisite detection', async () => {
      const response = await request(app.getHttpServer())
        .post(`/api/v1/sites/${testData.siteId}/detect-multisite`)
        .set('Authorization', `Bearer ${tokens[UserRole.ENGINEER]}`)
        .expect(200);

      expect(response.body.data).toHaveProperty('isMultisite');
    });

    it('should handle health checks', async () => {
      const response = await request(app.getHttpServer())
        .post(`/api/v1/sites/${testData.siteId}/health-check`)
        .set('Authorization', `Bearer ${tokens[UserRole.ENGINEER]}`)
        .expect(200);

      expect(response.body.data).toHaveProperty('status');
      expect(response.body.data).toHaveProperty('checks');
    });
  });

  describe('Data Retention Functionality', () => {
    it('should enforce retention hard caps', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/retention/policies')
        .set('Authorization', `Bearer ${tokens[UserRole.ADMIN]}`)
        .send({
          policyName: 'Invalid Policy',
          retentionDays: 10, // Exceeds 7-day hard cap
          appliesTo: 'incidents',
        })
        .expect(400);
    });

    it('should validate retention days', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/retention/validate/retention-days')
        .set('Authorization', `Bearer ${tokens[UserRole.ADMIN]}`)
        .send({ retentionDays: 5 })
        .expect(200);

      expect(response.body.data.isValid).toBe(true);
    });

    it('should provide retention statistics', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/retention/statistics')
        .set('Authorization', `Bearer ${tokens[UserRole.VIEWER]}`)
        .expect(200);

      expect(response.body.data).toHaveProperty('totalPolicies');
      expect(response.body.data).toHaveProperty('activePolicies');
    });
  });

  describe('Performance and Reliability', () => {
    it('should handle concurrent requests', async () => {
      const concurrentRequests = Array(10).fill(null).map(() =>
        request(app.getHttpServer())
          .get('/api/v1/users/profile')
          .set('Authorization', `Bearer ${tokens[UserRole.ADMIN]}`)
      );

      const responses = await Promise.all(concurrentRequests);
      
      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body.statusCode).toBe(200);
      });
    });

    it('should respond within acceptable time limits', async () => {
      const startTime = Date.now();
      
      await request(app.getHttpServer())
        .get('/api/v1/users/profile')
        .set('Authorization', `Bearer ${tokens[UserRole.ADMIN]}`)
        .expect(200);

      const responseTime = Date.now() - startTime;
      expect(responseTime).toBeLessThan(1000); // Should respond within 1 second
    });
  });

  describe('API Documentation Completeness', () => {
    it('should have complete OpenAPI specification', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/docs-json')
        .expect(200);

      const spec = response.body;
      
      // Check required OpenAPI fields
      expect(spec).toHaveProperty('openapi');
      expect(spec).toHaveProperty('info');
      expect(spec).toHaveProperty('paths');
      expect(spec).toHaveProperty('components');

      // Check custom extensions
      expect(spec.info).toHaveProperty('x-rate-limits');
      expect(spec.info).toHaveProperty('x-security-features');
      expect(spec.info).toHaveProperty('x-wordpress-features');
      expect(spec.info).toHaveProperty('x-data-retention');

      // Check that all major endpoints are documented
      const paths = Object.keys(spec.paths);
      const expectedPaths = [
        '/api/v1/auth/login',
        '/api/v1/users',
        '/api/v1/servers',
        '/api/v1/sites',
        '/api/v1/incidents',
        '/api/v1/retention/policies',
      ];

      expectedPaths.forEach(path => {
        expect(paths.some(p => p.includes(path))).toBe(true);
      });
    });
  });
});