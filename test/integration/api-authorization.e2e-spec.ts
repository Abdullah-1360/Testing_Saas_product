import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/database/prisma.service';
import * as bcrypt from 'bcrypt';

/**
 * Comprehensive API Authentication and Authorization Integration Tests
 * **Validates: Complete API security and RBAC implementation**
 * 
 * This test suite validates:
 * - Multi-factor authentication flows
 * - Role-based access control across all endpoints
 * - Session management and token validation
 * - Permission inheritance and restrictions
 * - Security boundary enforcement
 * - Rate limiting per role
 * - Audit logging for security events
 */
describe('API Authentication and Authorization Integration (e2e)', () => {
  let app: INestApplication;
  let prismaService: PrismaService;
  let tokens: Record<UserRole, string> = {} as Record<UserRole, string>;
  let userIds: Record<UserRole, string> = {} as Record<UserRole, string>;
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
    await createTestUsers();
    await createTestData();
  }

  async function createTestUsers() {
    const hashedPassword = await bcrypt.hash('AuthTest123!', 12);
    const roles = [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.ENGINEER, UserRole.VIEWER];
    
    for (const role of roles) {
      const user = await prismaService.user.create({
        data: {
          email: `${role.toLowerCase()}@auth.test`,
          passwordHash: hashedPassword,
          role,
          mfaEnabled: false,
        },
      });
      
      userIds[role] = user.id;

      const loginResponse = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ 
          email: `${role.toLowerCase()}@auth.test`, 
          password: 'AuthTest123!' 
        });
      
      tokens[role] = loginResponse.body.data.accessToken;
    }
  }