import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { UserRole, IncidentState, TriggerType, Priority } from '@prisma/client';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/database/prisma.service';
import { JobsService } from '../../src/jobs/jobs.service';
import { SseService } from '../../src/sse/sse.service';
import * as bcrypt from 'bcrypt';

/**
 * Complete Incident Processing Workflow Integration Tests
 * **Validates: Complete system integration for incident processing**
 * 
 * This test suite validates the complete end-to-end incident processing workflow:
 * - Incident creation and state transitions
 * - Job engine processing through all states
 * - Evidence collection and storage
 * - Backup creation and rollback functionality
 * - Verification and resolution
 * - Real-time updates via SSE
 * - Complete audit trail creation
 */
describe('Incident Processing Workflow Integration (e2e)', () => {
  let app: INestApplication;
  let prismaService: PrismaService;
  let jobsService: JobsService;
  let sseService: SseService;
  let adminToken: string;
  let engineerToken: string;
  let testServerId: string;
  let testSiteId: string;
  let testIncidentId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    prismaService = moduleFixture.get<PrismaService>(PrismaService);
    jobsService = moduleFixture.get<JobsService>(JobsService);
    sseService = moduleFixture.get<SseService>(SseService);
    
    await app.init();
    await setupTestEnvironment();
  });

  afterAll(async () => {
    await cleanupTestEnvironment();
    await app.close();
  });

  async function setupTestEnvironment() {
    // Create test users
    const hashedPassword = await bcrypt.hash('TestPassword123!', 12);
    
    await prismaService.user.create({
      data: {
        email: 'admin@workflow.test',
        passwordHash: hashedPassword,
        role: UserRole.ADMIN,
        mfaEnabled: false,
      },
    });

    await prismaService.user.create({
      data: {
        email: 'engineer@workflow.test',
        passwordHash: hashedPassword,
        role: UserRole.ENGINEER,
        mfaEnabled: false,
      },
    });

    // Get authentication tokens
    const adminLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'admin@workflow.test', password: 'TestPassword123!' });
    adminToken = adminLogin.body.data.accessToken;

    const engineerLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'engineer@workflow.test', password: 'TestPassword123!' });
    engineerToken = engineerLogin.body.data.accessToken;

    // Create test server
    const serverResponse = await request(app.getHttpServer())
      .post('/api/v1/servers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Workflow Test Server',
        hostname: 'workflow.test.com',
        port: 22,
        username: 'root',
        authType: 'key',
        credentials: 'test-ssh-key-content-for-workflow',
      });
    testServerId = serverResponse.body.data.id;

    // Create test site
    const siteResponse = await request(app.getHttpServer())
      .post('/api/v1/sites')
      .set('Authorization', `Bearer ${engineerToken}`)
      .send({
        serverId: testServerId,
        domain: 'workflow-site.test',
        documentRoot: '/var/www/workflow',
        wordpressPath: '/var/www/workflow/wp',
        siteUrl: 'https://workflow-site.test',
        adminUrl: 'https://workflow-site.test/wp-admin',
        isMultisite: false,
      });
    testSiteId = siteResponse.body.data.id;
  }

  async function cleanupTestEnvironment() {
    // Clean up in reverse order of creation
    await prismaService.incidentEvent.deleteMany();
    await prismaService.commandExecution.deleteMany();
    await prismaService.evidence.deleteMany();
    await prismaService.backupArtifact.deleteMany();
    await prismaService.fileChange.deleteMany();
    await prismaService.verificationResult.deleteMany();
    await prismaService.incident.deleteMany();
    await prismaService.site.deleteMany();
    await prismaService.server.deleteMany();
    await prismaService.userSession.deleteMany();
    await prismaService.user.deleteMany();
  }

  describe('Complete Incident Lifecycle', () => {
    it('should process incident through complete workflow', async () => {
      // Step 1: Create incident
      const incidentResponse = await request(app.getHttpServer())
        .post('/api/v1/incidents')
        .set('Authorization', `Bearer ${engineerToken}`)
        .send({
          siteId: testSiteId,
          triggerType: TriggerType.MANUAL,
          priority: Priority.MEDIUM,
        })
        .expect(201);

      testIncidentId = incidentResponse.body.data.id;
      expect(incidentResponse.body.data.state).toBe(IncidentState.NEW);
      expect(incidentResponse.body.data.fixAttempts).toBe(0);

      // Verify incident creation event was logged
      const events = await prismaService.incidentEvent.findMany({
        where: { incidentId: testIncidentId },
        orderBy: { timestamp: 'asc' },
      });
      expect(events.length).toBeGreaterThan(0);
      expect(events[0].eventType).toBe('INCIDENT_CREATED');
      expect(events[0].phase).toBe(IncidentState.NEW);

      // Step 2: Start processing (simulate job engine)
      await request(app.getHttpServer())
        .post(`/api/v1/incidents/${testIncidentId}/process`)
        .set('Authorization', `Bearer ${engineerToken}`)
        .expect(200);

      // Wait for processing to begin
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Verify state transition to DISCOVERY
      const updatedIncident = await request(app.getHttpServer())
        .get(`/api/v1/incidents/${testIncidentId}`)
        .set('Authorization', `Bearer ${engineerToken}`)
        .expect(200);

      expect([IncidentState.DISCOVERY, IncidentState.BASELINE, IncidentState.BACKUP].includes(updatedIncident.body.data.state)).toBe(true);

      // Step 3: Verify timeline events are being created
      const timelineResponse = await request(app.getHttpServer())
        .get(`/api/v1/incidents/${testIncidentId}/timeline`)
        .set('Authorization', `Bearer ${engineerToken}`)
        .expect(200);

      expect(timelineResponse.body.data.length).toBeGreaterThan(1);
      expect(timelineResponse.body.data.some((event: any) => event.eventType === 'INCIDENT_CREATED')).toBe(true);
      expect(timelineResponse.body.data.some((event: any) => event.eventType === 'STATE_TRANSITION')).toBe(true);

      // Step 4: Verify evidence collection
      const evidenceResponse = await request(app.getHttpServer())
        .get(`/api/v1/incidents/${testIncidentId}/evidence`)
        .set('Authorization', `Bearer ${engineerToken}`)
        .expect(200);

      // Evidence should be collected during discovery phase
      expect(evidenceResponse.body.data).toBeDefined();

      // Step 5: Verify command execution logging
      const commandsResponse = await request(app.getHttpServer())
        .get(`/api/v1/incidents/${testIncidentId}/commands`)
        .set('Authorization', `Bearer ${engineerToken}`)
        .expect(200);

      expect(commandsResponse.body.data).toBeDefined();
      expect(Array.isArray(commandsResponse.body.data)).toBe(true);

      // Step 6: Verify backup artifacts are created
      const backupsResponse = await request(app.getHttpServer())
        .get(`/api/v1/incidents/${testIncidentId}/backups`)
        .set('Authorization', `Bearer ${engineerToken}`)
        .expect(200);

      expect(backupsResponse.body.data).toBeDefined();

      // Step 7: Simulate fix attempt
      await request(app.getHttpServer())
        .post(`/api/v1/incidents/${testIncidentId}/fix-attempt`)
        .set('Authorization', `Bearer ${engineerToken}`)
        .send({
          hypothesis: 'Test fix hypothesis',
          fixType: 'TIER_1_INFRASTRUCTURE',
          description: 'Testing fix attempt workflow',
        })
        .expect(200);

      // Verify fix attempt was recorded
      const incidentAfterFix = await request(app.getHttpServer())
        .get(`/api/v1/incidents/${testIncidentId}`)
        .set('Authorization', `Bearer ${engineerToken}`)
        .expect(200);

      expect(incidentAfterFix.body.data.fixAttempts).toBeGreaterThan(0);

      // Step 8: Verify verification results
      const verificationResponse = await request(app.getHttpServer())
        .get(`/api/v1/incidents/${testIncidentId}/verification`)
        .set('Authorization', `Bearer ${engineerToken}`)
        .expect(200);

      expect(verificationResponse.body.data).toBeDefined();

      // Step 9: Test manual resolution
      await request(app.getHttpServer())
        .post(`/api/v1/incidents/${testIncidentId}/resolve`)
        .set('Authorization', `Bearer ${engineerToken}`)
        .send({
          resolution: 'Manual resolution for testing',
          verificationPassed: true,
        })
        .expect(200);

      // Verify final state
      const finalIncident = await request(app.getHttpServer())
        .get(`/api/v1/incidents/${testIncidentId}`)
        .set('Authorization', `Bearer ${engineerToken}`)
        .expect(200);

      expect([IncidentState.FIXED, IncidentState.VERIFY].includes(finalIncident.body.data.state)).toBe(true);
      expect(finalIncident.body.data.resolvedAt).toBeDefined();
    }, 30000); // Extended timeout for complete workflow

    it('should enforce fix attempt limits', async () => {
      // Create incident for limit testing
      const incidentResponse = await request(app.getHttpServer())
        .post('/api/v1/incidents')
        .set('Authorization', `Bearer ${engineerToken}`)
        .send({
          siteId: testSiteId,
          triggerType: TriggerType.MANUAL,
          priority: Priority.LOW,
        })
        .expect(201);

      const limitTestIncidentId = incidentResponse.body.data.id;

      // Simulate multiple fix attempts up to the limit
      for (let i = 0; i < 15; i++) {
        await request(app.getHttpServer())
          .post(`/api/v1/incidents/${limitTestIncidentId}/fix-attempt`)
          .set('Authorization', `Bearer ${engineerToken}`)
          .send({
            hypothesis: `Fix attempt ${i + 1}`,
            fixType: 'TIER_1_INFRASTRUCTURE',
            description: `Testing fix attempt ${i + 1}`,
          })
          .expect(200);
      }

      // 16th attempt should be rejected
      await request(app.getHttpServer())
        .post(`/api/v1/incidents/${limitTestIncidentId}/fix-attempt`)
        .set('Authorization', `Bearer ${engineerToken}`)
        .send({
          hypothesis: 'This should fail',
          fixType: 'TIER_1_INFRASTRUCTURE',
          description: 'This should exceed the limit',
        })
        .expect(400);

      // Verify incident was escalated
      const escalatedIncident = await request(app.getHttpServer())
        .get(`/api/v1/incidents/${limitTestIncidentId}`)
        .set('Authorization', `Bearer ${engineerToken}`)
        .expect(200);

      expect(escalatedIncident.body.data.state).toBe(IncidentState.ESCALATED);
      expect(escalatedIncident.body.data.escalatedAt).toBeDefined();
      expect(escalatedIncident.body.data.escalationReason).toContain('Maximum fix attempts exceeded');
    });

    it('should handle rollback scenarios', async () => {
      // Create incident for rollback testing
      const incidentResponse = await request(app.getHttpServer())
        .post('/api/v1/incidents')
        .set('Authorization', `Bearer ${engineerToken}`)
        .send({
          siteId: testSiteId,
          triggerType: TriggerType.MANUAL,
          priority: Priority.HIGH,
        })
        .expect(201);

      const rollbackIncidentId = incidentResponse.body.data.id;

      // Simulate failed fix that requires rollback
      await request(app.getHttpServer())
        .post(`/api/v1/incidents/${rollbackIncidentId}/fix-attempt`)
        .set('Authorization', `Bearer ${engineerToken}`)
        .send({
          hypothesis: 'Fix that will fail verification',
          fixType: 'TIER_2_CORE_INTEGRITY',
          description: 'Testing rollback scenario',
        })
        .expect(200);

      // Simulate verification failure
      await request(app.getHttpServer())
        .post(`/api/v1/incidents/${rollbackIncidentId}/verification-failed`)
        .set('Authorization', `Bearer ${engineerToken}`)
        .send({
          reason: 'Site behavior changed after fix',
          details: 'Layout and SEO elements were modified',
        })
        .expect(200);

      // Verify rollback was initiated
      const rolledBackIncident = await request(app.getHttpServer())
        .get(`/api/v1/incidents/${rollbackIncidentId}`)
        .set('Authorization', `Bearer ${engineerToken}`)
        .expect(200);

      expect(rolledBackIncident.body.data.state).toBe(IncidentState.ROLLBACK);

      // Verify rollback events in timeline
      const timelineResponse = await request(app.getHttpServer())
        .get(`/api/v1/incidents/${rollbackIncidentId}/timeline`)
        .set('Authorization', `Bearer ${engineerToken}`)
        .expect(200);

      expect(timelineResponse.body.data.some((event: any) => event.eventType === 'ROLLBACK_INITIATED')).toBe(true);
    });
  });

  describe('Real-time Updates Integration', () => {
    it('should send SSE updates during incident processing', async () => {
      // Mock SSE service to capture events
      const sseEvents: any[] = [];
      const originalSendIncidentUpdate = sseService.sendIncidentUpdate;
      sseService.sendIncidentUpdate = jest.fn((data) => {
        sseEvents.push(data);
        return originalSendIncidentUpdate.call(sseService, data);
      });

      // Create incident
      const incidentResponse = await request(app.getHttpServer())
        .post('/api/v1/incidents')
        .set('Authorization', `Bearer ${engineerToken}`)
        .send({
          siteId: testSiteId,
          triggerType: TriggerType.AUTOMATIC,
          priority: Priority.CRITICAL,
        })
        .expect(201);

      const sseTestIncidentId = incidentResponse.body.data.id;

      // Start processing
      await request(app.getHttpServer())
        .post(`/api/v1/incidents/${sseTestIncidentId}/process`)
        .set('Authorization', `Bearer ${engineerToken}`)
        .expect(200);

      // Wait for SSE events
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Verify SSE events were sent
      expect(sseService.sendIncidentUpdate).toHaveBeenCalled();
      expect(sseEvents.length).toBeGreaterThan(0);
      expect(sseEvents.some(event => event.incidentId === sseTestIncidentId)).toBe(true);

      // Restore original method
      sseService.sendIncidentUpdate = originalSendIncidentUpdate;
    });

    it('should provide real-time connection status', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/sse/status')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.data).toHaveProperty('activeConnections');
      expect(response.body.data).toHaveProperty('totalEventsSent');
      expect(response.body.data).toHaveProperty('uptime');
    });
  });

  describe('Audit Trail Completeness', () => {
    it('should create complete audit trail for incident operations', async () => {
      // Create incident for audit testing
      const incidentResponse = await request(app.getHttpServer())
        .post('/api/v1/incidents')
        .set('Authorization', `Bearer ${engineerToken}`)
        .send({
          siteId: testSiteId,
          triggerType: TriggerType.MANUAL,
          priority: Priority.MEDIUM,
        })
        .expect(201);

      const auditIncidentId = incidentResponse.body.data.id;

      // Perform various operations
      await request(app.getHttpServer())
        .post(`/api/v1/incidents/${auditIncidentId}/process`)
        .set('Authorization', `Bearer ${engineerToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .post(`/api/v1/incidents/${auditIncidentId}/fix-attempt`)
        .set('Authorization', `Bearer ${engineerToken}`)
        .send({
          hypothesis: 'Audit trail test fix',
          fixType: 'TIER_1_INFRASTRUCTURE',
          description: 'Testing audit trail creation',
        })
        .expect(200);

      // Check audit events
      const auditResponse = await request(app.getHttpServer())
        .get('/api/v1/audit/events')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({
          resourceType: 'incident',
          resourceId: auditIncidentId,
        })
        .expect(200);

      expect(auditResponse.body.data.length).toBeGreaterThan(0);
      expect(auditResponse.body.data.some((event: any) => event.action === 'CREATE_INCIDENT')).toBe(true);
      expect(auditResponse.body.data.some((event: any) => event.action === 'START_PROCESSING')).toBe(true);
      expect(auditResponse.body.data.some((event: any) => event.action === 'FIX_ATTEMPT')).toBe(true);

      // Verify all audit events have required fields
      auditResponse.body.data.forEach((event: any) => {
        expect(event).toHaveProperty('id');
        expect(event).toHaveProperty('userId');
        expect(event).toHaveProperty('action');
        expect(event).toHaveProperty('resourceType');
        expect(event).toHaveProperty('resourceId');
        expect(event).toHaveProperty('timestamp');
        expect(event).toHaveProperty('ipAddress');
        expect(event).toHaveProperty('userAgent');
      });
    });

    it('should track unique trace and correlation IDs', async () => {
      const incidentResponse = await request(app.getHttpServer())
        .post('/api/v1/incidents')
        .set('Authorization', `Bearer ${engineerToken}`)
        .send({
          siteId: testSiteId,
          triggerType: TriggerType.MANUAL,
          priority: Priority.LOW,
        })
        .expect(201);

      const traceIncidentId = incidentResponse.body.data.id;

      // Verify trace ID is assigned
      expect(incidentResponse.headers).toHaveProperty('x-trace-id');
      expect(incidentResponse.headers).toHaveProperty('x-correlation-id');

      // Verify trace ID is consistent across related operations
      const processResponse = await request(app.getHttpServer())
        .post(`/api/v1/incidents/${traceIncidentId}/process`)
        .set('Authorization', `Bearer ${engineerToken}`)
        .set('x-correlation-id', incidentResponse.headers['x-correlation-id'])
        .expect(200);

      expect(processResponse.headers).toHaveProperty('x-trace-id');
      expect(processResponse.headers).toHaveProperty('x-correlation-id');
      expect(processResponse.headers['x-correlation-id']).toBe(incidentResponse.headers['x-correlation-id']);
    });
  });

  describe('Error Handling and Recovery', () => {
    it('should handle job processing failures gracefully', async () => {
      // Create incident that will encounter processing errors
      const incidentResponse = await request(app.getHttpServer())
        .post('/api/v1/incidents')
        .set('Authorization', `Bearer ${engineerToken}`)
        .send({
          siteId: testSiteId,
          triggerType: TriggerType.MANUAL,
          priority: Priority.MEDIUM,
        })
        .expect(201);

      const errorIncidentId = incidentResponse.body.data.id;

      // Simulate processing error
      await request(app.getHttpServer())
        .post(`/api/v1/incidents/${errorIncidentId}/simulate-error`)
        .set('Authorization', `Bearer ${engineerToken}`)
        .send({
          errorType: 'SSH_CONNECTION_FAILURE',
          phase: 'DISCOVERY',
        })
        .expect(200);

      // Verify error handling
      const errorIncident = await request(app.getHttpServer())
        .get(`/api/v1/incidents/${errorIncidentId}`)
        .set('Authorization', `Bearer ${engineerToken}`)
        .expect(200);

      // Should be escalated due to processing error
      expect([IncidentState.ESCALATED, IncidentState.NEW].includes(errorIncident.body.data.state)).toBe(true);

      // Verify error events in timeline
      const timelineResponse = await request(app.getHttpServer())
        .get(`/api/v1/incidents/${errorIncidentId}/timeline`)
        .set('Authorization', `Bearer ${engineerToken}`)
        .expect(200);

      expect(timelineResponse.body.data.some((event: any) => event.eventType === 'ERROR_OCCURRED')).toBe(true);
    });

    it('should support incident resumption after system restart', async () => {
      // Create incident
      const incidentResponse = await request(app.getHttpServer())
        .post('/api/v1/incidents')
        .set('Authorization', `Bearer ${engineerToken}`)
        .send({
          siteId: testSiteId,
          triggerType: TriggerType.MANUAL,
          priority: Priority.MEDIUM,
        })
        .expect(201);

      const resumeIncidentId = incidentResponse.body.data.id;

      // Start processing
      await request(app.getHttpServer())
        .post(`/api/v1/incidents/${resumeIncidentId}/process`)
        .set('Authorization', `Bearer ${engineerToken}`)
        .expect(200);

      // Simulate system restart by pausing and resuming
      await request(app.getHttpServer())
        .post(`/api/v1/incidents/${resumeIncidentId}/pause`)
        .set('Authorization', `Bearer ${engineerToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .post(`/api/v1/incidents/${resumeIncidentId}/resume`)
        .set('Authorization', `Bearer ${engineerToken}`)
        .expect(200);

      // Verify incident can continue processing
      const resumedIncident = await request(app.getHttpServer())
        .get(`/api/v1/incidents/${resumeIncidentId}`)
        .set('Authorization', `Bearer ${engineerToken}`)
        .expect(200);

      expect(resumedIncident.body.data.state).not.toBe(IncidentState.NEW);
    });
  });

  describe('Performance and Scalability', () => {
    it('should handle concurrent incident processing', async () => {
      const concurrentIncidents = [];

      // Create multiple incidents simultaneously
      for (let i = 0; i < 5; i++) {
        const incidentPromise = request(app.getHttpServer())
          .post('/api/v1/incidents')
          .set('Authorization', `Bearer ${engineerToken}`)
          .send({
            siteId: testSiteId,
            triggerType: TriggerType.MANUAL,
            priority: Priority.LOW,
          });
        concurrentIncidents.push(incidentPromise);
      }

      const responses = await Promise.all(concurrentIncidents);

      // All should succeed
      responses.forEach(response => {
        expect(response.status).toBe(201);
        expect(response.body.data.state).toBe(IncidentState.NEW);
      });

      // Start processing all incidents
      const processingPromises = responses.map(response =>
        request(app.getHttpServer())
          .post(`/api/v1/incidents/${response.body.data.id}/process`)
          .set('Authorization', `Bearer ${engineerToken}`)
      );

      const processingResponses = await Promise.all(processingPromises);

      // All should start processing successfully
      processingResponses.forEach(response => {
        expect(response.status).toBe(200);
      });
    });

    it('should maintain performance under load', async () => {
      const startTime = Date.now();

      // Create and process incident
      const incidentResponse = await request(app.getHttpServer())
        .post('/api/v1/incidents')
        .set('Authorization', `Bearer ${engineerToken}`)
        .send({
          siteId: testSiteId,
          triggerType: TriggerType.MANUAL,
          priority: Priority.MEDIUM,
        })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/v1/incidents/${incidentResponse.body.data.id}/process`)
        .set('Authorization', `Bearer ${engineerToken}`)
        .expect(200);

      const endTime = Date.now();
      const processingTime = endTime - startTime;

      // Should complete within reasonable time
      expect(processingTime).toBeLessThan(5000); // 5 seconds
    });
  });
});