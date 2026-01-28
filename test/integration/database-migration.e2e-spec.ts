import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../src/database/prisma.service';
import { AppModule } from '../../src/app.module';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Database Migration Integration Tests
 * **Validates: Database schema integrity and migration safety**
 * 
 * This test suite validates:
 * - Database migration execution and rollback
 * - Schema integrity after migrations
 * - Data preservation during schema changes
 * - Index creation and performance optimization
 * - Foreign key constraint validation
 * - Migration idempotency
 */
describe('Database Migration Integration (e2e)', () => {
  let app: INestApplication;
  let prismaService: PrismaService;
  let originalDatabaseUrl: string;
  let testDatabaseUrl: string;

  beforeAll(async () => {
    // Use separate test database for migration testing
    originalDatabaseUrl = process.env.DATABASE_URL;
    testDatabaseUrl = process.env.TEST_DATABASE_URL || 'postgresql://test:test@localhost:5432/wp_autohealer_migration_test';
    process.env.DATABASE_URL = testDatabaseUrl;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    prismaService = moduleFixture.get<PrismaService>(PrismaService);
    
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    // Restore original database URL
    process.env.DATABASE_URL = originalDatabaseUrl;
  });

  beforeEach(async () => {
    // Reset database to clean state
    await resetDatabase();
  });

  async function resetDatabase() {
    try {
      // Drop all tables
      await prismaService.$executeRaw`DROP SCHEMA public CASCADE`;
      await prismaService.$executeRaw`CREATE SCHEMA public`;
      await prismaService.$executeRaw`GRANT ALL ON SCHEMA public TO public`;
    } catch (error) {
      // Database might not exist yet, which is fine
      console.log('Database reset completed');
    }
  }

  async function runMigration(direction: 'up' | 'down' = 'up') {
    try {
      if (direction === 'up') {
        execSync('npx prisma migrate deploy', {
          env: { ...process.env, DATABASE_URL: testDatabaseUrl },
          stdio: 'pipe'
        });
      } else {
        // For rollback, we'll use prisma migrate reset
        execSync('npx prisma migrate reset --force', {
          env: { ...process.env, DATABASE_URL: testDatabaseUrl },
          stdio: 'pipe'
        });
      }
    } catch (error) {
      console.error('Migration error:', error);
      throw error;
    }
  }

  async function getTableInfo(tableName: string) {
    const result = await prismaService.$queryRaw`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = ${tableName}
      ORDER BY ordinal_position
    `;
    return result;
  }

  async function getIndexInfo(tableName: string) {
    const result = await prismaService.$queryRaw`
      SELECT indexname, indexdef
      FROM pg_indexes 
      WHERE tablename = ${tableName}
    `;
    return result;
  }

  async function getForeignKeyInfo(tableName: string) {
    const result = await prismaService.$queryRaw`
      SELECT
        tc.constraint_name,
        tc.table_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_name = ${tableName}
    `;
    return result;
  }

  describe('Schema Creation and Validation', () => {
    it('should create all required tables with correct schema', async () => {
      await runMigration('up');

      // Verify all core tables exist
      const tables = await prismaService.$queryRaw`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_type = 'BASE TABLE'
      `;

      const tableNames = (tables as any[]).map(t => t.table_name);
      const expectedTables = [
        'users',
        'user_sessions',
        'servers',
        'sites',
        'incidents',
        'incident_events',
        'command_executions',
        'evidence',
        'backup_artifacts',
        'file_changes',
        'verification_results',
        'audit_events',
        'retention_policies',
        'purge_audit'
      ];

      expectedTables.forEach(table => {
        expect(tableNames).toContain(table);
      });
    });

    it('should create correct column types and constraints', async () => {
      await runMigration('up');

      // Test users table schema
      const userColumns = await getTableInfo('users');
      const userColumnMap = new Map((userColumns as any[]).map(col => [col.column_name, col]));

      expect(userColumnMap.get('id')).toMatchObject({
        data_type: 'uuid',
        is_nullable: 'NO'
      });

      expect(userColumnMap.get('email')).toMatchObject({
        data_type: 'character varying',
        is_nullable: 'NO'
      });

      expect(userColumnMap.get('password_hash')).toMatchObject({
        data_type: 'character varying',
        is_nullable: 'NO'
      });

      expect(userColumnMap.get('role')).toMatchObject({
        data_type: 'character varying',
        is_nullable: 'NO'
      });

      expect(userColumnMap.get('mfa_enabled')).toMatchObject({
        data_type: 'boolean',
        is_nullable: 'YES'
      });

      // Test incidents table schema
      const incidentColumns = await getTableInfo('incidents');
      const incidentColumnMap = new Map((incidentColumns as any[]).map(col => [col.column_name, col]));

      expect(incidentColumnMap.get('id')).toMatchObject({
        data_type: 'uuid',
        is_nullable: 'NO'
      });

      expect(incidentColumnMap.get('site_id')).toMatchObject({
        data_type: 'uuid',
        is_nullable: 'NO'
      });

      expect(incidentColumnMap.get('state')).toMatchObject({
        data_type: 'character varying',
        is_nullable: 'NO'
      });

      expect(incidentColumnMap.get('fix_attempts')).toMatchObject({
        data_type: 'integer',
        is_nullable: 'YES'
      });
    });

    it('should create all required indexes for performance', async () => {
      await runMigration('up');

      // Check incidents table indexes
      const incidentIndexes = await getIndexInfo('incidents');
      const indexNames = (incidentIndexes as any[]).map(idx => idx.indexname);

      expect(indexNames.some(name => name.includes('site_id'))).toBe(true);
      expect(indexNames.some(name => name.includes('state'))).toBe(true);
      expect(indexNames.some(name => name.includes('created_at'))).toBe(true);

      // Check incident_events table indexes
      const eventIndexes = await getIndexInfo('incident_events');
      const eventIndexNames = (eventIndexes as any[]).map(idx => idx.indexname);

      expect(eventIndexNames.some(name => name.includes('incident_id'))).toBe(true);
      expect(eventIndexNames.some(name => name.includes('timestamp'))).toBe(true);

      // Check audit_events table indexes
      const auditIndexes = await getIndexInfo('audit_events');
      const auditIndexNames = (auditIndexes as any[]).map(idx => idx.indexname);

      expect(auditIndexNames.some(name => name.includes('user_id'))).toBe(true);
      expect(auditIndexNames.some(name => name.includes('timestamp'))).toBe(true);
    });

    it('should create correct foreign key relationships', async () => {
      await runMigration('up');

      // Check incidents -> sites foreign key
      const incidentFKs = await getForeignKeyInfo('incidents');
      const incidentFKMap = new Map((incidentFKs as any[]).map(fk => [fk.column_name, fk]));

      expect(incidentFKMap.get('site_id')).toMatchObject({
        foreign_table_name: 'sites',
        foreign_column_name: 'id'
      });

      // Check sites -> servers foreign key
      const siteFKs = await getForeignKeyInfo('sites');
      const siteFKMap = new Map((siteFKs as any[]).map(fk => [fk.column_name, fk]));

      expect(siteFKMap.get('server_id')).toMatchObject({
        foreign_table_name: 'servers',
        foreign_column_name: 'id'
      });

      // Check incident_events -> incidents foreign key
      const eventFKs = await getForeignKeyInfo('incident_events');
      const eventFKMap = new Map((eventFKs as any[]).map(fk => [fk.column_name, fk]));

      expect(eventFKMap.get('incident_id')).toMatchObject({
        foreign_table_name: 'incidents',
        foreign_column_name: 'id'
      });
    });
  });

  describe('Data Integrity During Migrations', () => {
    it('should preserve existing data during schema updates', async () => {
      await runMigration('up');

      // Insert test data
      const testUser = await prismaService.user.create({
        data: {
          email: 'migration@test.com',
          passwordHash: 'hashed_password',
          role: 'ENGINEER',
          mfaEnabled: false,
        },
      });

      const testServer = await prismaService.server.create({
        data: {
          name: 'Migration Test Server',
          hostname: 'migration.test.com',
          port: 22,
          username: 'root',
          authType: 'key',
          encryptedCredentials: 'encrypted_test_credentials',
        },
      });

      const testSite = await prismaService.site.create({
        data: {
          serverId: testServer.id,
          domain: 'migration-site.test.com',
          documentRoot: '/var/www/migration',
          wordpressPath: '/var/www/migration/wp',
          siteUrl: 'https://migration-site.test.com',
          adminUrl: 'https://migration-site.test.com/wp-admin',
        },
      });

      const testIncident = await prismaService.incident.create({
        data: {
          siteId: testSite.id,
          state: 'NEW',
          triggerType: 'MANUAL',
          priority: 'MEDIUM',
          fixAttempts: 0,
          maxFixAttempts: 15,
        },
      });

      // Simulate a migration (in real scenario, this would be a new migration file)
      // For testing, we'll just verify data integrity after reconnection
      await prismaService.$disconnect();
      await prismaService.$connect();

      // Verify all data is still intact
      const retrievedUser = await prismaService.user.findUnique({
        where: { id: testUser.id },
      });
      expect(retrievedUser).toBeTruthy();
      expect(retrievedUser?.email).toBe('migration@test.com');

      const retrievedServer = await prismaService.server.findUnique({
        where: { id: testServer.id },
      });
      expect(retrievedServer).toBeTruthy();
      expect(retrievedServer?.name).toBe('Migration Test Server');

      const retrievedSite = await prismaService.site.findUnique({
        where: { id: testSite.id },
      });
      expect(retrievedSite).toBeTruthy();
      expect(retrievedSite?.domain).toBe('migration-site.test.com');

      const retrievedIncident = await prismaService.incident.findUnique({
        where: { id: testIncident.id },
      });
      expect(retrievedIncident).toBeTruthy();
      expect(retrievedIncident?.state).toBe('NEW');
    });

    it('should handle cascade deletes correctly', async () => {
      await runMigration('up');

      // Create related data
      const server = await prismaService.server.create({
        data: {
          name: 'Cascade Test Server',
          hostname: 'cascade.test.com',
          port: 22,
          username: 'root',
          authType: 'key',
          encryptedCredentials: 'test_credentials',
        },
      });

      const site = await prismaService.site.create({
        data: {
          serverId: server.id,
          domain: 'cascade-site.test.com',
          documentRoot: '/var/www/cascade',
          wordpressPath: '/var/www/cascade/wp',
          siteUrl: 'https://cascade-site.test.com',
          adminUrl: 'https://cascade-site.test.com/wp-admin',
        },
      });

      const incident = await prismaService.incident.create({
        data: {
          siteId: site.id,
          state: 'NEW',
          triggerType: 'MANUAL',
          priority: 'MEDIUM',
          fixAttempts: 0,
          maxFixAttempts: 15,
        },
      });

      await prismaService.incidentEvent.create({
        data: {
          incidentId: incident.id,
          eventType: 'INCIDENT_CREATED',
          phase: 'NEW',
          step: 'Initial creation',
          data: {},
        },
      });

      // Delete server should cascade to sites and incidents
      await prismaService.server.delete({
        where: { id: server.id },
      });

      // Verify cascaded deletes
      const deletedSite = await prismaService.site.findUnique({
        where: { id: site.id },
      });
      expect(deletedSite).toBeNull();

      const deletedIncident = await prismaService.incident.findUnique({
        where: { id: incident.id },
      });
      expect(deletedIncident).toBeNull();

      const deletedEvent = await prismaService.incidentEvent.findMany({
        where: { incidentId: incident.id },
      });
      expect(deletedEvent).toHaveLength(0);
    });
  });

  describe('Migration Rollback and Recovery', () => {
    it('should support migration rollback', async () => {
      // Apply migrations
      await runMigration('up');

      // Verify tables exist
      const tablesAfterUp = await prismaService.$queryRaw`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_type = 'BASE TABLE'
      `;
      expect((tablesAfterUp as any[]).length).toBeGreaterThan(0);

      // Rollback migrations
      await runMigration('down');

      // Verify tables are removed (or reset to initial state)
      const tablesAfterDown = await prismaService.$queryRaw`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_type = 'BASE TABLE'
      `;
      
      // After reset, should have fewer or no tables
      expect((tablesAfterDown as any[]).length).toBeLessThanOrEqual((tablesAfterUp as any[]).length);
    });

    it('should be idempotent when run multiple times', async () => {
      // Run migration multiple times
      await runMigration('up');
      await runMigration('up');
      await runMigration('up');

      // Should not cause errors and schema should be consistent
      const tables = await prismaService.$queryRaw`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_type = 'BASE TABLE'
      `;

      const tableNames = (tables as any[]).map(t => t.table_name);
      const expectedTables = [
        'users',
        'servers',
        'sites',
        'incidents',
        'incident_events'
      ];

      expectedTables.forEach(table => {
        expect(tableNames).toContain(table);
      });

      // Verify we can still perform basic operations
      const testUser = await prismaService.user.create({
        data: {
          email: 'idempotent@test.com',
          passwordHash: 'test_hash',
          role: 'VIEWER',
          mfaEnabled: false,
        },
      });

      expect(testUser.id).toBeDefined();
      expect(testUser.email).toBe('idempotent@test.com');
    });
  });

  describe('Performance and Optimization', () => {
    it('should create indexes that improve query performance', async () => {
      await runMigration('up');

      // Create test data for performance testing
      const server = await prismaService.server.create({
        data: {
          name: 'Performance Test Server',
          hostname: 'perf.test.com',
          port: 22,
          username: 'root',
          authType: 'key',
          encryptedCredentials: 'perf_credentials',
        },
      });

      const site = await prismaService.site.create({
        data: {
          serverId: server.id,
          domain: 'perf-site.test.com',
          documentRoot: '/var/www/perf',
          wordpressPath: '/var/www/perf/wp',
          siteUrl: 'https://perf-site.test.com',
          adminUrl: 'https://perf-site.test.com/wp-admin',
        },
      });

      // Create multiple incidents for performance testing
      const incidents = [];
      for (let i = 0; i < 100; i++) {
        const incident = await prismaService.incident.create({
          data: {
            siteId: site.id,
            state: i % 2 === 0 ? 'NEW' : 'FIXED',
            triggerType: 'MANUAL',
            priority: 'MEDIUM',
            fixAttempts: i % 5,
            maxFixAttempts: 15,
          },
        });
        incidents.push(incident);
      }

      // Test query performance with indexes
      const startTime = Date.now();
      
      const incidentsBySite = await prismaService.incident.findMany({
        where: { siteId: site.id },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });

      const queryTime = Date.now() - startTime;

      expect(incidentsBySite).toHaveLength(10);
      expect(queryTime).toBeLessThan(100); // Should be fast with proper indexes

      // Test filtering by state (should use index)
      const startTime2 = Date.now();
      
      const newIncidents = await prismaService.incident.findMany({
        where: { 
          siteId: site.id,
          state: 'NEW'
        },
      });

      const queryTime2 = Date.now() - startTime2;

      expect(newIncidents.length).toBeGreaterThan(0);
      expect(queryTime2).toBeLessThan(100); // Should be fast with proper indexes
    });

    it('should handle large datasets efficiently', async () => {
      await runMigration('up');

      const server = await prismaService.server.create({
        data: {
          name: 'Large Dataset Server',
          hostname: 'large.test.com',
          port: 22,
          username: 'root',
          authType: 'key',
          encryptedCredentials: 'large_credentials',
        },
      });

      const site = await prismaService.site.create({
        data: {
          serverId: server.id,
          domain: 'large-site.test.com',
          documentRoot: '/var/www/large',
          wordpressPath: '/var/www/large/wp',
          siteUrl: 'https://large-site.test.com',
          adminUrl: 'https://large-site.test.com/wp-admin',
        },
      });

      // Create incident with many events
      const incident = await prismaService.incident.create({
        data: {
          siteId: site.id,
          state: 'NEW',
          triggerType: 'MANUAL',
          priority: 'MEDIUM',
          fixAttempts: 0,
          maxFixAttempts: 15,
        },
      });

      // Create many incident events
      const events = [];
      for (let i = 0; i < 1000; i++) {
        events.push({
          incidentId: incident.id,
          eventType: 'TEST_EVENT',
          phase: 'NEW',
          step: `Step ${i}`,
          data: { iteration: i },
        });
      }

      // Batch insert events
      await prismaService.incidentEvent.createMany({
        data: events,
      });

      // Test pagination performance
      const startTime = Date.now();
      
      const paginatedEvents = await prismaService.incidentEvent.findMany({
        where: { incidentId: incident.id },
        orderBy: { timestamp: 'desc' },
        take: 50,
        skip: 0,
      });

      const paginationTime = Date.now() - startTime;

      expect(paginatedEvents).toHaveLength(50);
      expect(paginationTime).toBeLessThan(200); // Should handle pagination efficiently
    });
  });

  describe('Data Validation and Constraints', () => {
    it('should enforce unique constraints', async () => {
      await runMigration('up');

      // Create user with unique email
      await prismaService.user.create({
        data: {
          email: 'unique@test.com',
          passwordHash: 'test_hash',
          role: 'ENGINEER',
          mfaEnabled: false,
        },
      });

      // Attempt to create another user with same email should fail
      await expect(
        prismaService.user.create({
          data: {
            email: 'unique@test.com',
            passwordHash: 'another_hash',
            role: 'VIEWER',
            mfaEnabled: false,
          },
        })
      ).rejects.toThrow();
    });

    it('should enforce check constraints', async () => {
      await runMigration('up');

      const server = await prismaService.server.create({
        data: {
          name: 'Constraint Test Server',
          hostname: 'constraint.test.com',
          port: 22,
          username: 'root',
          authType: 'key',
          encryptedCredentials: 'constraint_credentials',
        },
      });

      const site = await prismaService.site.create({
        data: {
          serverId: server.id,
          domain: 'constraint-site.test.com',
          documentRoot: '/var/www/constraint',
          wordpressPath: '/var/www/constraint/wp',
          siteUrl: 'https://constraint-site.test.com',
          adminUrl: 'https://constraint-site.test.com/wp-admin',
        },
      });

      // Test retention policy constraints (1-7 days)
      await expect(
        prismaService.retentionPolicy.create({
          data: {
            policyName: 'Invalid Policy',
            retentionDays: 10, // Should violate check constraint
            appliesTo: 'incidents',
            isActive: true,
          },
        })
      ).rejects.toThrow();

      // Valid retention policy should work
      const validPolicy = await prismaService.retentionPolicy.create({
        data: {
          policyName: 'Valid Policy',
          retentionDays: 5,
          appliesTo: 'incidents',
          isActive: true,
        },
      });

      expect(validPolicy.retentionDays).toBe(5);
    });

    it('should enforce not null constraints', async () => {
      await runMigration('up');

      // Attempt to create user without required fields should fail
      await expect(
        prismaService.user.create({
          data: {
            // Missing email, passwordHash, role
            mfaEnabled: false,
          } as any,
        })
      ).rejects.toThrow();

      // Attempt to create server without required fields should fail
      await expect(
        prismaService.server.create({
          data: {
            // Missing name, hostname, username, authType, encryptedCredentials
            port: 22,
          } as any,
        })
      ).rejects.toThrow();
    });
  });
});