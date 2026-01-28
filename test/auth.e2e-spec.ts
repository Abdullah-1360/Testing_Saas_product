import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '@/app.module';
import { PrismaService } from '@/database/prisma.service';
import * as bcrypt from 'bcrypt';

describe('Authentication (e2e)', () => {
  let app: INestApplication;
  let prismaService: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    prismaService = moduleFixture.get<PrismaService>(PrismaService);
    
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Clean up test data
    await prismaService.userSession.deleteMany();
    await prismaService.user.deleteMany();
  });

  describe('/auth/login (POST)', () => {
    it('should login with valid credentials', async () => {
      // Create test user
      const hashedPassword = await bcrypt.hash('password123', 12);
      await prismaService.user.create({
        data: {
          email: 'test@example.com',
          passwordHash: hashedPassword,
          role: UserRole.ENGINEER,
          mfaEnabled: false,
        },
      });

      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'test@example.com',
          password: 'password123',
        })
        .expect(200);

      expect(response.body).toHaveProperty('access_token');
      expect(response.body).toHaveProperty('user');
      expect(response.body.user.email).toBe('test@example.com');
      expect(response.body.user).not.toHaveProperty('passwordHash');
      expect(response.body.user).not.toHaveProperty('mfaSecret');
    });

    it('should reject invalid credentials', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'nonexistent@example.com',
          password: 'wrongpassword',
        })
        .expect(401);

      expect(response.body.message).toBe('Invalid credentials');
    });

    it('should require MFA token when MFA is enabled', async () => {
      // Create test user with MFA enabled
      const hashedPassword = await bcrypt.hash('password123', 12);
      await prismaService.user.create({
        data: {
          email: 'mfa@example.com',
          passwordHash: hashedPassword,
          role: UserRole.ENGINEER,
          mfaEnabled: true,
          mfaSecret: 'JBSWY3DPEHPK3PXP',
        },
      });

      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'mfa@example.com',
          password: 'password123',
        })
        .expect(200);

      expect(response.body.access_token).toBe('');
      expect(response.body.mfaRequired).toBe(true);
    });
  });

  describe('/auth/profile (GET)', () => {
    it('should return user profile when authenticated', async () => {
      // Create test user and login
      const hashedPassword = await bcrypt.hash('password123', 12);
      await prismaService.user.create({
        data: {
          email: 'profile@example.com',
          passwordHash: hashedPassword,
          role: UserRole.ENGINEER,
          mfaEnabled: false,
        },
      });

      const loginResponse = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'profile@example.com',
          password: 'password123',
        });

      const token = loginResponse.body.access_token;

      const response = await request(app.getHttpServer())
        .get('/auth/profile')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.email).toBe('profile@example.com');
      expect(response.body.role).toBe(UserRole.ENGINEER);
      expect(response.body).not.toHaveProperty('passwordHash');
    });

    it('should reject unauthenticated requests', async () => {
      await request(app.getHttpServer())
        .get('/auth/profile')
        .expect(401);
    });
  });

  describe('/users (GET)', () => {
    it('should allow admin to view all users', async () => {
      // Create admin user
      const hashedPassword = await bcrypt.hash('password123', 12);
      await prismaService.user.create({
        data: {
          email: 'admin@example.com',
          passwordHash: hashedPassword,
          role: UserRole.ADMIN,
          mfaEnabled: false,
        },
      });

      // Create regular user
      await prismaService.user.create({
        data: {
          email: 'user@example.com',
          passwordHash: hashedPassword,
          role: UserRole.ENGINEER,
          mfaEnabled: false,
        },
      });

      // Login as admin
      const loginResponse = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'admin@example.com',
          password: 'password123',
        });

      const token = loginResponse.body.access_token;

      const response = await request(app.getHttpServer())
        .get('/users')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body).toHaveLength(2);
      expect(response.body[0]).not.toHaveProperty('passwordHash');
    });

    it('should reject non-admin users', async () => {
      // Create regular user
      const hashedPassword = await bcrypt.hash('password123', 12);
      await prismaService.user.create({
        data: {
          email: 'user@example.com',
          passwordHash: hashedPassword,
          role: UserRole.ENGINEER,
          mfaEnabled: false,
        },
      });

      // Login as regular user
      const loginResponse = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'user@example.com',
          password: 'password123',
        });

      const token = loginResponse.body.access_token;

      await request(app.getHttpServer())
        .get('/users')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    });
  });

  describe('Public endpoints', () => {
    it('should allow access to health endpoint without authentication', async () => {
      await request(app.getHttpServer())
        .get('/health')
        .expect(200);
    });

    it('should allow access to root endpoint without authentication', async () => {
      await request(app.getHttpServer())
        .get('/')
        .expect(200);
    });
  });
});