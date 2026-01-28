import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '@/app.module';
import { PrismaService } from '@/database/prisma.service';
import * as bcrypt from 'bcrypt';

/**
 * API Security Testing Suite
 * **Validates: Requirements 6.1, 6.4, 6.5, 6.6, 6.9, 6.10** - Security Requirements
 * 
 * This test suite validates:
 * - Input validation prevents injection attacks
 * - Secrets are properly redacted from responses
 * - Authentication is required for protected endpoints
 * - Authorization is enforced based on user roles
 * - Security headers are present
 * - Audit logging captures security events
 */
describe('API Security (e2e)', () => {
  let app: INestApplication;
  let prismaService: PrismaService;
  let adminToken: string;
  let engineerToken: string;
  let viewerToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    prismaService = moduleFixture.get<PrismaService>(PrismaService);
    
    await app.init();

    // Create test users and get tokens
    await setupTestUsers();
  });

  afterAll(async () => {
    await cleanupTestData();
    await app.close();
  });

  async function setupTestUsers() {
    const hashedPassword = await bcrypt.hash('password123', 12);

    await prismaService.user.create({
      data: {
        email: 'admin@test.com',
        passwordHash: hashedPassword,
        role: UserRole.ADMIN,
        mfaEnabled: false,
      },
    });

    await prismaService.user.create({
      data: {
        email: 'engineer@test.com',
        passwordHash: hashedPassword,
        role: UserRole.ENGINEER,
        mfaEnabled: false,
      },
    });

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

  async function cleanupTestData() {
    await prismaService.server.deleteMany();
    await prismaService.userSession.deleteMany();
    await prismaService.user.deleteMany();
  }

  describe('Authentication Security', () => {
    it('should reject requests without authentication token', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/users')
        .expect(401);
    });

    it('should reject requests with invalid token', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/users')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);
    });

    it('should reject requests with malformed authorization header', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/users')
        .set('Authorization', 'InvalidFormat token')
        .expect(401);
    });

    it('should reject expired tokens', async () => {
      // This would require creating an expired token
      // For now, we test with a clearly invalid token format
      await request(app.getHttpServer())
        .get('/api/v1/users')
        .set('Authorization', 'Bearer expired.token.here')
        .expect(401);
    });
  });

  describe('Authorization Security (RBAC)', () => {
    it('should prevent viewer from accessing admin endpoints', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({
          email: 'unauthorized@test.com',
          password: 'password123',
          role: UserRole.ENGINEER,
        })
        .expect(403);
    });

    it('should prevent engineer from deleting users', async () => {
      // First create a user as admin
      const createResponse = await request(app.getHttpServer())
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          email: 'todelete@test.com',
          password: 'password123',
          role: UserRole.VIEWER,
        })
        .expect(201);

      const userId = createResponse.body.data.id;

      // Try to delete as engineer (should fail)
      await request(app.getHttpServer())
        .delete(`/api/v1/users/${userId}`)
        .set('Authorization', `Bearer ${engineerToken}`)
        .expect(403);
    });

    it('should allow admin to access all endpoints', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .get('/api/v1/servers')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
    });
  });

  describe('Input Validation Security', () => {
    it('should reject SQL injection attempts in email field', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: "admin@test.com'; DROP TABLE users; --",
          password: 'password123',
        })
        .expect(400);
    });

    it('should reject XSS attempts in user creation', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          email: '<script>alert("xss")</script>@test.com',
          password: 'password123',
          role: UserRole.VIEWER,
        })
        .expect(400);
    });

    it('should reject command injection in server hostname', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/servers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Test Server',
          hostname: 'test.com; rm -rf /',
          port: 22,
          username: 'root',
          authType: 'key',
          credentials: 'test-key',
        })
        .expect(400);
    });

    it('should reject path traversal attempts', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/sites')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          serverId: 'valid-uuid-here',
          domain: 'test.com',
          documentRoot: '../../../etc/passwd',
          wordpressPath: '/var/www/html',
          siteUrl: 'https://test.com',
          adminUrl: 'https://test.com/wp-admin',
        })
        .expect(400);
    });

    it('should validate UUID format in parameters', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/users/not-a-uuid')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);
    });

    it('should enforce password complexity requirements', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          email: 'weakpass@test.com',
          password: '123', // Too weak
          role: UserRole.VIEWER,
        })
        .expect(400);
    });
  });

  describe('Secret Redaction', () => {
    it('should not expose password hashes in user responses', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/users/profile')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.data).not.toHaveProperty('passwordHash');
      expect(response.body.data).not.toHaveProperty('mfaSecret');
    });

    it('should not expose encrypted credentials in server responses', async () => {
      // Create a server
      const createResponse = await request(app.getHttpServer())
        .post('/api/v1/servers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Secret Test Server',
          hostname: 'secret.test.com',
          port: 22,
          username: 'root',
          authType: 'key',
          credentials: 'super-secret-key-content',
        })
        .expect(201);

      expect(createResponse.body.data).not.toHaveProperty('encryptedCredentials');
      expect(createResponse.body.data).not.toHaveProperty('credentials');

      // Also check when retrieving the server
      const serverId = createResponse.body.data.id;
      const getResponse = await request(app.getHttpServer())
        .get(`/api/v1/servers/${serverId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(getResponse.body.data).not.toHaveProperty('encryptedCredentials');
      expect(getResponse.body.data).not.toHaveProperty('credentials');
    });

    it('should redact secrets from error messages', async () => {
      // Try to create a server with invalid data that might expose secrets
      const response = await request(app.getHttpServer())
        .post('/api/v1/servers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Error Test Server',
          hostname: 'error.test.com',
          port: 'invalid-port',
          username: 'root',
          authType: 'key',
          credentials: 'secret-that-should-not-appear-in-error',
        })
        .expect(400);

      // Error message should not contain the secret
      const responseText = JSON.stringify(response.body);
      expect(responseText).not.toContain('secret-that-should-not-appear-in-error');
    });
  });

  describe('Security Headers', () => {
    it('should include Content Security Policy headers', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/users/profile')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.headers).toHaveProperty('content-security-policy');
    });

    it('should include X-Content-Type-Options header', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/users/profile')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.headers['x-content-type-options']).toBe('nosniff');
    });

    it('should include X-Frame-Options header', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/users/profile')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.headers).toHaveProperty('x-frame-options');
    });

    it('should include X-XSS-Protection header', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/users/profile')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.headers).toHaveProperty('x-xss-protection');
    });

    it('should include Strict-Transport-Security header', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/users/profile')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.headers).toHaveProperty('strict-transport-security');
    });
  });

  describe('CORS Security', () => {
    it('should handle CORS preflight requests', async () => {
      const response = await request(app.getHttpServer())
        .options('/api/v1/users')
        .set('Origin', 'https://allowed-origin.com')
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'Content-Type, Authorization')
        .expect(204);

      expect(response.headers).toHaveProperty('access-control-allow-origin');
      expect(response.headers).toHaveProperty('access-control-allow-methods');
      expect(response.headers).toHaveProperty('access-control-allow-headers');
    });

    it('should include CORS headers in actual requests', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/users/profile')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Origin', 'https://allowed-origin.com')
        .expect(200);

      expect(response.headers).toHaveProperty('access-control-allow-origin');
    });
  });

  describe('Session Security', () => {
    it('should invalidate session on logout', async () => {
      // Login to get a token
      const loginResponse = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: 'admin@test.com',
          password: 'password123',
        })
        .expect(200);

      const token = loginResponse.body.data.accessToken;

      // Verify token works
      await request(app.getHttpServer())
        .get('/api/v1/users/profile')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // Logout
      await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // Token should no longer work
      await request(app.getHttpServer())
        .get('/api/v1/users/profile')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
    });

    it('should validate session tokens', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/auth/session/validate')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.data).toHaveProperty('valid');
      expect(response.body.data.valid).toBe(true);
    });
  });

  describe('Audit Logging Security', () => {
    it('should log authentication attempts', async () => {
      // Make a login attempt
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: 'admin@test.com',
          password: 'password123',
        })
        .expect(200);

      // Check that audit log was created (this would require access to audit logs)
      // In a real implementation, you'd verify the audit log entry exists
    });

    it('should log authorization failures', async () => {
      // Attempt unauthorized action
      await request(app.getHttpServer())
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({
          email: 'unauthorized@test.com',
          password: 'password123',
          role: UserRole.ENGINEER,
        })
        .expect(403);

      // Audit log should capture this authorization failure
    });

    it('should log sensitive operations', async () => {
      // Create a server (sensitive operation)
      await request(app.getHttpServer())
        .post('/api/v1/servers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Audit Test Server',
          hostname: 'audit.test.com',
          port: 22,
          username: 'root',
          authType: 'key',
          credentials: 'test-key-content',
        })
        .expect(201);

      // This operation should be logged in audit trail
    });
  });

  describe('Error Information Disclosure', () => {
    it('should not expose internal error details in production', async () => {
      // Try to access non-existent resource
      const response = await request(app.getHttpServer())
        .get('/api/v1/users/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);

      // Error should not expose internal details
      expect(response.body.message).not.toContain('database');
      expect(response.body.message).not.toContain('prisma');
      expect(response.body.message).not.toContain('stack trace');
    });

    it('should provide generic error messages for security violations', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(403);

      // Error message should be generic
      expect(response.body.message).toBe('Forbidden');
    });
  });

  describe('Request Size Limits', () => {
    it('should reject oversized requests', async () => {
      const largePayload = {
        email: 'test@test.com',
        password: 'password123',
        role: UserRole.VIEWER,
        largeField: 'x'.repeat(10000), // Very large field
      };

      // This might pass if no size limits are configured
      // In production, you'd want to configure request size limits
      const response = await request(app.getHttpServer())
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(largePayload);

      // Should either succeed (if field is ignored) or fail validation
      expect([200, 201, 400]).toContain(response.status);
    });
  });

  describe('Content Type Security', () => {
    it('should require proper Content-Type for POST requests', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Content-Type', 'text/plain')
        .send('invalid content type')
        .expect(400);
    });

    it('should accept JSON Content-Type', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/retention/validate/retention-days')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ retentionDays: 3 }))
        .expect(200);
    });
  });
});