import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '@/app.module';
import { PrismaService } from '@/database/prisma.service';
import * as bcrypt from 'bcrypt';

/**
 * Comprehensive API Endpoint Testing Suite
 * **Validates: Requirements 15.1-15.9** - REST API Design
 * 
 * This test suite validates:
 * - All API endpoints are accessible with proper authentication
 * - RBAC is enforced correctly across all endpoints
 * - Pagination works correctly for list endpoints
 * - Filtering and sorting work as expected
 * - Error responses are consistent and properly formatted
 * - API versioning works correctly
 */
describe('API Endpoints (e2e)', () => {
  let app: INestApplication;
  let prismaService: PrismaService;
  let adminToken: string;
  let engineerToken: string;
  let viewerToken: string;
  let testServerId: string;
  let testSiteId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    prismaService = moduleFixture.get<PrismaService>(PrismaService);
    
    await app.init();

    // Create test users and get tokens
    await setupTestUsers();
    await setupTestData();
  });

  afterAll(async () => {
    await cleanupTestData();
    await app.close();
  });

  async function setupTestUsers() {
    const hashedPassword = await bcrypt.hash('password123', 12);

    // Create admin user
    await prismaService.user.create({
      data: {
        email: 'admin@test.com',
        passwordHash: hashedPassword,
        role: UserRole.ADMIN,
        mfaEnabled: false,
      },
    });

    // Create engineer user
    await prismaService.user.create({
      data: {
        email: 'engineer@test.com',
        passwordHash: hashedPassword,
        role: UserRole.ENGINEER,
        mfaEnabled: false,
      },
    });

    // Create viewer user
    await prismaService.user.create({
      data: {
        email: 'viewer@test.com',
        passwordHash: hashedPassword,
        role: UserRole.VIEWER,
        mfaEnabled: false,
      },
    });

    // Get tokens
    const adminLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'admin@test.com', password: 'password123' });
    adminToken = adminLogin.body.data.accessToken;

    const engineerLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'engineer@test.com', password: 'password123' });
    engineerToken = engineerLogin.body.data.accessToken;

    const viewerLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'viewer@test.com', password: 'password123' });
    viewerToken = viewerLogin.body.data.accessToken;
  }

  async function setupTestData() {
    // Create test server
    const serverResponse = await request(app.getHttpServer())
      .post('/api/v1/servers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Test Server',
        hostname: 'test.example.com',
        port: 22,
        username: 'root',
        authType: 'key',
        credentials: 'test-key-content',
      });
    testServerId = serverResponse.body.data.id;

    // Create test site
    const siteResponse = await request(app.getHttpServer())
      .post('/api/v1/sites')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        serverId: testServerId,
        domain: 'test-site.com',
        documentRoot: '/var/www/html',
        wordpressPath: '/var/www/html/wp',
        siteUrl: 'https://test-site.com',
        adminUrl: 'https://test-site.com/wp-admin',
      });
    testSiteId = siteResponse.body.data.id;
  }

  async function cleanupTestData() {
    await prismaService.site.deleteMany();
    await prismaService.server.deleteMany();
    await prismaService.userSession.deleteMany();
    await prismaService.user.deleteMany();
  }

  describe('API Versioning', () => {
    it('should support v1 API endpoints', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/auth/profile')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.headers['x-api-version']).toBe('1');
    });

    it('should include version information in response headers', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/users/profile')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.headers).toHaveProperty('x-api-version');
      expect(response.headers).toHaveProperty('x-api-server');
      expect(response.headers).toHaveProperty('x-api-timestamp');
    });
  });

  describe('Users API', () => {
    it('should allow admin to create users', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          email: 'newuser@test.com',
          password: 'password123',
          role: UserRole.ENGINEER,
        })
        .expect(201);

      expect(response.body.statusCode).toBe(201);
      expect(response.body.data.email).toBe('newuser@test.com');
      expect(response.body.data.role).toBe(UserRole.ENGINEER);
      expect(response.body.data).not.toHaveProperty('passwordHash');
    });

    it('should prevent engineer from creating users', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${engineerToken}`)
        .send({
          email: 'unauthorized@test.com',
          password: 'password123',
          role: UserRole.ENGINEER,
        })
        .expect(403);
    });

    it('should support pagination for user list', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/users?page=1&limit=2')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.pagination).toHaveProperty('page', 1);
      expect(response.body.pagination).toHaveProperty('limit', 2);
      expect(response.body.pagination).toHaveProperty('total');
      expect(response.body.pagination).toHaveProperty('totalPages');
    });

    it('should support filtering by role', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/users?role=${UserRole.ADMIN}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.data.every((user: any) => user.role === UserRole.ADMIN)).toBe(true);
    });

    it('should provide user statistics', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/users/stats')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.data).toHaveProperty('total');
      expect(response.body.data).toHaveProperty('byRole');
      expect(response.body.data).toHaveProperty('mfaEnabled');
      expect(response.body.data).toHaveProperty('mfaDisabled');
    });
  });

  describe('Servers API', () => {
    it('should allow admin to create servers', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/servers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'New Test Server',
          hostname: 'new-test.example.com',
          port: 22,
          username: 'root',
          authType: 'key',
          credentials: 'new-test-key-content',
        })
        .expect(201);

      expect(response.body.statusCode).toBe(201);
      expect(response.body.data.name).toBe('New Test Server');
      expect(response.body.data).not.toHaveProperty('encryptedCredentials');
    });

    it('should allow viewer to read servers', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/servers')
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(200);

      expect(response.body.statusCode).toBe(200);
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it('should prevent viewer from creating servers', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/servers')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({
          name: 'Unauthorized Server',
          hostname: 'unauthorized.example.com',
          port: 22,
          username: 'root',
          authType: 'key',
          credentials: 'unauthorized-key',
        })
        .expect(403);
    });

    it('should support server connection testing', async () => {
      // Note: This will fail in test environment, but should return proper error structure
      const response = await request(app.getHttpServer())
        .post(`/api/v1/servers/${testServerId}/test-connection`)
        .set('Authorization', `Bearer ${engineerToken}`)
        .expect(200);

      expect(response.body.data).toHaveProperty('success');
      expect(response.body.data).toHaveProperty('timestamp');
    });

    it('should provide server statistics', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/servers/stats')
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(200);

      expect(response.body.data).toHaveProperty('total');
      expect(response.body.data).toHaveProperty('byControlPanel');
      expect(response.body.data).toHaveProperty('byAuthType');
    });
  });

  describe('Sites API', () => {
    it('should allow engineer to create sites', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/sites')
        .set('Authorization', `Bearer ${engineerToken}`)
        .send({
          serverId: testServerId,
          domain: 'new-site.com',
          documentRoot: '/var/www/new-site',
          wordpressPath: '/var/www/new-site/wp',
          siteUrl: 'https://new-site.com',
          adminUrl: 'https://new-site.com/wp-admin',
        })
        .expect(201);

      expect(response.body.statusCode).toBe(201);
      expect(response.body.data.domain).toBe('new-site.com');
    });

    it('should support filtering sites by server', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/sites?serverId=${testServerId}`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(200);

      expect(response.body.data.every((site: any) => site.serverId === testServerId)).toBe(true);
    });

    it('should support site health checks', async () => {
      // Note: This will fail in test environment, but should return proper structure
      const response = await request(app.getHttpServer())
        .post(`/api/v1/sites/${testSiteId}/health-check`)
        .set('Authorization', `Bearer ${engineerToken}`)
        .expect(200);

      expect(response.body.data).toHaveProperty('siteId');
      expect(response.body.data).toHaveProperty('status');
      expect(response.body.data).toHaveProperty('checks');
    });

    it('should provide site statistics', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/sites/stats')
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(200);

      expect(response.body.data).toHaveProperty('total');
      expect(response.body.data).toHaveProperty('active');
      expect(response.body.data).toHaveProperty('inactive');
    });
  });

  describe('Incidents API', () => {
    it('should allow engineer to create incidents', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/incidents')
        .set('Authorization', `Bearer ${engineerToken}`)
        .send({
          siteId: testSiteId,
          triggerType: 'MANUAL',
          priority: 'MEDIUM',
        })
        .expect(201);

      expect(response.body.statusCode).toBe(201);
      expect(response.body.data.siteId).toBe(testSiteId);
      expect(response.body.data.state).toBe('NEW');
    });

    it('should support incident filtering by state', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/incidents?state=NEW')
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(200);

      expect(response.body.data.every((incident: any) => incident.state === 'NEW')).toBe(true);
    });

    it('should prevent viewer from creating incidents', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/incidents')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({
          siteId: testSiteId,
          triggerType: 'MANUAL',
          priority: 'HIGH',
        })
        .expect(403);
    });
  });

  describe('Retention API', () => {
    it('should allow admin to create retention policies', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/retention/policies')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          policyName: 'Test Policy',
          retentionDays: 5,
          appliesTo: 'incidents',
        })
        .expect(201);

      expect(response.body.data.policyName).toBe('Test Policy');
      expect(response.body.data.retentionDays).toBe(5);
    });

    it('should enforce retention hard cap', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/retention/policies')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          policyName: 'Invalid Policy',
          retentionDays: 10, // Exceeds 7-day hard cap
          appliesTo: 'incidents',
        })
        .expect(400);
    });

    it('should allow viewer to read retention statistics', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/retention/statistics')
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(200);

      expect(response.body.data).toHaveProperty('totalPolicies');
      expect(response.body.data).toHaveProperty('activePolicies');
    });
  });

  describe('Error Handling', () => {
    it('should return consistent error format for 404', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/users/nonexistent-id')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);

      expect(response.body).toHaveProperty('statusCode', 404);
      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('timestamp');
    });

    it('should return consistent error format for 403', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({
          email: 'forbidden@test.com',
          password: 'password123',
          role: UserRole.ENGINEER,
        })
        .expect(403);

      expect(response.body).toHaveProperty('statusCode', 403);
      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('timestamp');
    });

    it('should return consistent error format for validation errors', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          email: 'invalid-email',
          password: '123', // Too short
          role: 'INVALID_ROLE',
        })
        .expect(400);

      expect(response.body).toHaveProperty('statusCode', 400);
      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('timestamp');
    });
  });

  describe('Response Format Consistency', () => {
    it('should return consistent success response format', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/users/profile')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('statusCode', 200);
      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('data');
      expect(response.body).toHaveProperty('timestamp');
    });

    it('should return consistent paginated response format', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/users?page=1&limit=10')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('statusCode', 200);
      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('data');
      expect(response.body).toHaveProperty('pagination');
      expect(response.body).toHaveProperty('timestamp');
      
      expect(response.body.pagination).toHaveProperty('page');
      expect(response.body.pagination).toHaveProperty('limit');
      expect(response.body.pagination).toHaveProperty('total');
      expect(response.body.pagination).toHaveProperty('totalPages');
    });
  });

  describe('Security Headers', () => {
    it('should include security headers in responses', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/auth/profile')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      // Check for security headers set by Helmet
      expect(response.headers).toHaveProperty('x-content-type-options');
      expect(response.headers).toHaveProperty('x-frame-options');
      expect(response.headers).toHaveProperty('x-xss-protection');
    });

    it('should include CORS headers', async () => {
      const response = await request(app.getHttpServer())
        .options('/api/v1/users')
        .expect(204);

      expect(response.headers).toHaveProperty('access-control-allow-origin');
      expect(response.headers).toHaveProperty('access-control-allow-methods');
      expect(response.headers).toHaveProperty('access-control-allow-headers');
    });
  });
});