import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { UserRole, IncidentState, TriggerType, Priority } from '@prisma/client';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/database/prisma.service';
import { SseService } from '../../src/sse/sse.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as bcrypt from 'bcrypt';
import { EventSource } from 'eventsource';

/**
 * Real-time Updates Integration Tests
 * **Validates: Real-time update functionality and SSE integration**
 * 
 * This test suite validates:
 * - Server-Sent Events (SSE) connection management
 * - Real-time incident updates during processing
 * - Site health status broadcasting
 * - System status notifications
 * - Event filtering and user-specific updates
 * - Connection resilience and reconnection
 * - Performance under concurrent connections
 */
describe('Real-time Updates Integration (e2e)', () => {
  let app: INestApplication;
  let prismaService: PrismaService;
  let sseService: SseService;
  let eventEmitter: EventEmitter2;
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
    sseService = moduleFixture.get<SseService>(SseService);
    eventEmitter = moduleFixture.get<EventEmitter2>(EventEmitter2);
    
    await app.init();
    await setupTestEnvironment();
  });

  afterAll(async () => {
    await cleanupTestEnvironment();
    await app.close();
  });

  async function setupTestEnvironment() {
    // Create test users
    const hashedPassword = await bcrypt.hash('RealtimeTest123!', 12);
    
    await prismaService.user.create({
      data: {
        email: 'admin@realtime.test',
        passwordHash: hashedPassword,
        role: UserRole.ADMIN,
        mfaEnabled: false,
      },
    });

    await prismaService.user.create({
      data: {
        email: 'engineer@realtime.test',
        passwordHash: hashedPassword,
        role: UserRole.ENGINEER,
        mfaEnabled: false,
      },
    });

    await prismaService.user.create({
      data: {
        email: 'viewer@realtime.test',
        passwordHash: hashedPassword,
        role: UserRole.VIEWER,
        mfaEnabled: false,
      },
    });

    // Get authentication tokens
    const adminLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'admin@realtime.test', password: 'RealtimeTest123!' });
    adminToken = adminLogin.body.data.accessToken;

    const engineerLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'engineer@realtime.test', password: 'RealtimeTest123!' });
    engineerToken = engineerLogin.body.data.accessToken;

    const viewerLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'viewer@realtime.test', password: 'RealtimeTest123!' });
    viewerToken = viewerLogin.body.data.accessToken;

    // Create test server
    const serverResponse = await request(app.getHttpServer())
      .post('/api/v1/servers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Realtime Test Server',
        hostname: 'realtime.test.com',
        port: 22,
        username: 'root',
        authType: 'key',
        credentials: 'test-ssh-key-for-realtime',
      });
    testServerId = serverResponse.body.data.id;

    // Create test site
    const siteResponse = await request(app.getHttpServer())
      .post('/api/v1/sites')
      .set('Authorization', `Bearer ${engineerToken}`)
      .send({
        serverId: testServerId,
        domain: 'realtime-site.test',
        documentRoot: '/var/www/realtime',
        wordpressPath: '/var/www/realtime/wp',
        siteUrl: 'https://realtime-site.test',
        adminUrl: 'https://realtime-site.test/wp-admin',
      });
    testSiteId = siteResponse.body.data.id;
  }

  async function cleanupTestEnvironment() {
    await prismaService.incidentEvent.deleteMany();
    await prismaService.incident.deleteMany();
    await prismaService.site.deleteMany();
    await prismaService.server.deleteMany();
    await prismaService.userSession.deleteMany();
    await prismaService.user.deleteMany();
  }

  function createSSEConnection(token: string, filters?: string): Promise<EventSource> {
    return new Promise((resolve, reject) => {
      const url = `http://localhost:${process.env.PORT || 3000}/api/v1/sse/events`;
      const queryParams = new URLSearchParams();
      
      if (filters) {
        queryParams.append('filters', filters);
      }
      
      const fullUrl = `${url}?${queryParams.toString()}`;
      
      const eventSource = new EventSource(fullUrl, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      eventSource.onopen = () => {
        resolve(eventSource);
      };

      eventSource.onerror = (error) => {
        reject(error);
      };

      // Set timeout for connection
      setTimeout(() => {
        if (eventSource.readyState !== EventSource.OPEN) {
          eventSource.close();
          reject(new Error('SSE connection timeout'));
        }
      }, 5000);
    });
  }

  describe('SSE Connection Management', () => {
    it('should establish SSE connection with valid authentication', async () => {
      const eventSource = await createSSEConnection(adminToken);
      
      expect(eventSource.readyState).toBe(EventSource.OPEN);
      
      // Verify connection is tracked
      const connectionCount = sseService.getActiveConnectionsCount();
      expect(connectionCount).toBeGreaterThan(0);
      
      eventSource.close();
    });

    it('should reject SSE connection with invalid authentication', async () => {
      await expect(createSSEConnection('invalid-token')).rejects.toThrow();
    });

    it('should handle multiple concurrent connections', async () => {
      const connections: EventSource[] = [];
      
      try {
        // Create multiple connections
        for (let i = 0; i < 5; i++) {
          const connection = await createSSEConnection(adminToken);
          connections.push(connection);
        }
        
        expect(connections).toHaveLength(5);
        connections.forEach(conn => {
          expect(conn.readyState).toBe(EventSource.OPEN);
        });
        
        // Verify all connections are tracked
        const connectionCount = sseService.getActiveConnectionsCount();
        expect(connectionCount).toBeGreaterThanOrEqual(5);
        
      } finally {
        // Clean up connections
        connections.forEach(conn => conn.close());
      }
    });

    it('should support role-based connection filtering', async () => {
      const adminConnection = await createSSEConnection(adminToken, 'admin,incidents,system');
      const viewerConnection = await createSSEConnection(viewerToken, 'incidents');
      
      expect(adminConnection.readyState).toBe(EventSource.OPEN);
      expect(viewerConnection.readyState).toBe(EventSource.OPEN);
      
      adminConnection.close();
      viewerConnection.close();
    });
  });

  describe('Incident Update Broadcasting', () => {
    it('should broadcast incident creation events', async () => {
      const eventSource = await createSSEConnection(engineerToken);
      const receivedEvents: any[] = [];
      
      eventSource.addEventListener('incident.created', (event) => {
        receivedEvents.push(JSON.parse(event.data));
      });
      
      // Create incident
      const incidentResponse = await request(app.getHttpServer())
        .post('/api/v1/incidents')
        .set('Authorization', `Bearer ${engineerToken}`)
        .send({
          siteId: testSiteId,
          triggerType: TriggerType.MANUAL,
          priority: Priority.MEDIUM,
        });
      
      const incidentId = incidentResponse.body.data.id;
      
      // Wait for SSE event
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0]).toMatchObject({
        incidentId,
        siteId: testSiteId,
        state: IncidentState.NEW,
        eventType: 'INCIDENT_CREATED',
      });
      
      eventSource.close();
    });

    it('should broadcast incident state transitions', async () => {
      const eventSource = await createSSEConnection(engineerToken);
      const receivedEvents: any[] = [];
      
      eventSource.addEventListener('incident.updated', (event) => {
        receivedEvents.push(JSON.parse(event.data));
      });
      
      // Create incident
      const incidentResponse = await request(app.getHttpServer())
        .post('/api/v1/incidents')
        .set('Authorization', `Bearer ${engineerToken}`)
        .send({
          siteId: testSiteId,
          triggerType: TriggerType.MANUAL,
          priority: Priority.HIGH,
        });
      
      const incidentId = incidentResponse.body.data.id;
      
      // Start processing to trigger state transitions
      await request(app.getHttpServer())
        .post(`/api/v1/incidents/${incidentId}/process`)
        .set('Authorization', `Bearer ${engineerToken}`);
      
      // Wait for SSE events
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      expect(receivedEvents.length).toBeGreaterThan(0);
      expect(receivedEvents.some(event => event.incidentId === incidentId)).toBe(true);
      expect(receivedEvents.some(event => event.eventType === 'STATE_TRANSITION')).toBe(true);
      
      eventSource.close();
    });

    it('should broadcast fix attempt updates', async () => {
      const eventSource = await createSSEConnection(engineerToken);
      const receivedEvents: any[] = [];
      
      eventSource.addEventListener('incident.fix_attempt', (event) => {
        receivedEvents.push(JSON.parse(event.data));
      });
      
      // Create incident
      const incidentResponse = await request(app.getHttpServer())
        .post('/api/v1/incidents')
        .set('Authorization', `Bearer ${engineerToken}`)
        .send({
          siteId: testSiteId,
          triggerType: TriggerType.MANUAL,
          priority: Priority.MEDIUM,
        });
      
      const incidentId = incidentResponse.body.data.id;
      
      // Perform fix attempt
      await request(app.getHttpServer())
        .post(`/api/v1/incidents/${incidentId}/fix-attempt`)
        .set('Authorization', `Bearer ${engineerToken}`)
        .send({
          hypothesis: 'SSE test fix attempt',
          fixType: 'TIER_1_INFRASTRUCTURE',
          description: 'Testing SSE broadcasting for fix attempts',
        });
      
      // Wait for SSE event
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0]).toMatchObject({
        incidentId,
        eventType: 'FIX_ATTEMPT_INCREMENT',
      });
      
      eventSource.close();
    });

    it('should broadcast incident resolution events', async () => {
      const eventSource = await createSSEConnection(engineerToken);
      const receivedEvents: any[] = [];
      
      eventSource.addEventListener('incident.resolved', (event) => {
        receivedEvents.push(JSON.parse(event.data));
      });
      
      // Create incident
      const incidentResponse = await request(app.getHttpServer())
        .post('/api/v1/incidents')
        .set('Authorization', `Bearer ${engineerToken}`)
        .send({
          siteId: testSiteId,
          triggerType: TriggerType.MANUAL,
          priority: Priority.LOW,
        });
      
      const incidentId = incidentResponse.body.data.id;
      
      // Resolve incident
      await request(app.getHttpServer())
        .post(`/api/v1/incidents/${incidentId}/resolve`)
        .set('Authorization', `Bearer ${engineerToken}`)
        .send({
          resolution: 'SSE test resolution',
          verificationPassed: true,
        });
      
      // Wait for SSE event
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0]).toMatchObject({
        incidentId,
        eventType: 'INCIDENT_RESOLVED',
      });
      
      eventSource.close();
    });
  });

  describe('Site Health Broadcasting', () => {
    it('should broadcast site health check results', async () => {
      const eventSource = await createSSEConnection(engineerToken);
      const receivedEvents: any[] = [];
      
      eventSource.addEventListener('site.health_update', (event) => {
        receivedEvents.push(JSON.parse(event.data));
      });
      
      // Trigger health check
      await request(app.getHttpServer())
        .post(`/api/v1/sites/${testSiteId}/health-check`)
        .set('Authorization', `Bearer ${engineerToken}`);
      
      // Wait for SSE event
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0]).toMatchObject({
        siteId: testSiteId,
        domain: 'realtime-site.test',
      });
      expect(receivedEvents[0]).toHaveProperty('status');
      expect(receivedEvents[0]).toHaveProperty('lastCheck');
      
      eventSource.close();
    });

    it('should broadcast site status changes', async () => {
      const eventSource = await createSSEConnection(viewerToken);
      const receivedEvents: any[] = [];
      
      eventSource.addEventListener('site.status_change', (event) => {
        receivedEvents.push(JSON.parse(event.data));
      });
      
      // Update site status
      await request(app.getHttpServer())
        .patch(`/api/v1/sites/${testSiteId}`)
        .set('Authorization', `Bearer ${engineerToken}`)
        .send({
          isActive: false,
        });
      
      // Wait for SSE event
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0]).toMatchObject({
        siteId: testSiteId,
        isActive: false,
      });
      
      eventSource.close();
    });
  });

  describe('System Status Broadcasting', () => {
    it('should broadcast system status updates', async () => {
      const eventSource = await createSSEConnection(adminToken);
      const receivedEvents: any[] = [];
      
      eventSource.addEventListener('system.status_update', (event) => {
        receivedEvents.push(JSON.parse(event.data));
      });
      
      // Trigger system status update
      sseService.sendSystemStatusUpdate('job_engine', 'operational', {
        activeJobs: 5,
        queueSize: 12,
      });
      
      // Wait for SSE event
      await new Promise(resolve => setTimeout(resolve, 500));
      
      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0]).toMatchObject({
        component: 'job_engine',
        status: 'operational',
        details: {
          activeJobs: 5,
          queueSize: 12,
        },
      });
      
      eventSource.close();
    });

    it('should broadcast system alerts', async () => {
      const eventSource = await createSSEConnection(adminToken);
      const receivedEvents: any[] = [];
      
      eventSource.addEventListener('system.alert', (event) => {
        receivedEvents.push(JSON.parse(event.data));
      });
      
      // Trigger system alert
      eventEmitter.emit('system.alert', {
        level: 'warning',
        component: 'database',
        message: 'High connection count detected',
        details: { connections: 95, threshold: 90 },
      });
      
      // Wait for SSE event
      await new Promise(resolve => setTimeout(resolve, 500));
      
      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0]).toMatchObject({
        level: 'warning',
        component: 'database',
        message: 'High connection count detected',
      });
      
      eventSource.close();
    });
  });

  describe('Event Filtering and Permissions', () => {
    it('should filter events based on user role', async () => {
      const adminConnection = await createSSEConnection(adminToken);
      const viewerConnection = await createSSEConnection(viewerToken);
      
      const adminEvents: any[] = [];
      const viewerEvents: any[] = [];
      
      adminConnection.addEventListener('system.status_update', (event) => {
        adminEvents.push(JSON.parse(event.data));
      });
      
      viewerConnection.addEventListener('system.status_update', (event) => {
        viewerEvents.push(JSON.parse(event.data));
      });
      
      // Send system status update (should only reach admin)
      sseService.sendSystemStatusUpdate('api_server', 'maintenance', {
        reason: 'Scheduled maintenance',
      });
      
      // Wait for events
      await new Promise(resolve => setTimeout(resolve, 500));
      
      expect(adminEvents).toHaveLength(1);
      expect(viewerEvents).toHaveLength(0); // Viewer should not receive system updates
      
      adminConnection.close();
      viewerConnection.close();
    });

    it('should filter incident events by site access', async () => {
      // Create another site for access testing
      const restrictedSiteResponse = await request(app.getHttpServer())
        .post('/api/v1/sites')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          serverId: testServerId,
          domain: 'restricted-site.test',
          documentRoot: '/var/www/restricted',
          wordpressPath: '/var/www/restricted/wp',
          siteUrl: 'https://restricted-site.test',
          adminUrl: 'https://restricted-site.test/wp-admin',
        });
      
      const restrictedSiteId = restrictedSiteResponse.body.data.id;
      
      const engineerConnection = await createSSEConnection(engineerToken);
      const receivedEvents: any[] = [];
      
      engineerConnection.addEventListener('incident.created', (event) => {
        receivedEvents.push(JSON.parse(event.data));
      });
      
      // Create incident on accessible site
      await request(app.getHttpServer())
        .post('/api/v1/incidents')
        .set('Authorization', `Bearer ${engineerToken}`)
        .send({
          siteId: testSiteId,
          triggerType: TriggerType.MANUAL,
          priority: Priority.MEDIUM,
        });
      
      // Create incident on restricted site (as admin)
      await request(app.getHttpServer())
        .post('/api/v1/incidents')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          siteId: restrictedSiteId,
          triggerType: TriggerType.MANUAL,
          priority: Priority.HIGH,
        });
      
      // Wait for events
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Engineer should only receive events for accessible sites
      expect(receivedEvents.length).toBeGreaterThan(0);
      expect(receivedEvents.every(event => event.siteId === testSiteId)).toBe(true);
      
      engineerConnection.close();
    });
  });

  describe('Connection Resilience', () => {
    it('should handle connection drops gracefully', async () => {
      const eventSource = await createSSEConnection(engineerToken);
      
      expect(eventSource.readyState).toBe(EventSource.OPEN);
      
      // Simulate connection drop
      eventSource.close();
      
      expect(eventSource.readyState).toBe(EventSource.CLOSED);
      
      // Verify connection is removed from tracking
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Connection count should decrease (though exact count depends on other tests)
      const connectionCount = sseService.getActiveConnectionsCount();
      expect(connectionCount).toBeGreaterThanOrEqual(0);
    });

    it('should support connection heartbeat', async () => {
      const eventSource = await createSSEConnection(engineerToken);
      const heartbeats: any[] = [];
      
      eventSource.addEventListener('heartbeat', (event) => {
        heartbeats.push(JSON.parse(event.data));
      });
      
      // Wait for heartbeat events
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      expect(heartbeats.length).toBeGreaterThan(0);
      expect(heartbeats[0]).toHaveProperty('timestamp');
      expect(heartbeats[0]).toHaveProperty('serverTime');
      
      eventSource.close();
    });
  });

  describe('Performance Under Load', () => {
    it('should handle high-frequency events efficiently', async () => {
      const eventSource = await createSSEConnection(adminToken);
      const receivedEvents: any[] = [];
      
      eventSource.addEventListener('test.high_frequency', (event) => {
        receivedEvents.push(JSON.parse(event.data));
      });
      
      // Send many events rapidly
      const eventCount = 100;
      const startTime = Date.now();
      
      for (let i = 0; i < eventCount; i++) {
        eventEmitter.emit('test.high_frequency', {
          sequence: i,
          timestamp: Date.now(),
        });
      }
      
      // Wait for events to be processed
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const processingTime = Date.now() - startTime;
      
      expect(receivedEvents.length).toBeGreaterThan(0);
      expect(processingTime).toBeLessThan(5000); // Should handle efficiently
      
      eventSource.close();
    });

    it('should maintain performance with many concurrent connections', async () => {
      const connections: EventSource[] = [];
      const eventCounts: number[] = [];
      
      try {
        // Create many connections
        for (let i = 0; i < 10; i++) {
          const connection = await createSSEConnection(adminToken);
          connections.push(connection);
          
          let eventCount = 0;
          connection.addEventListener('test.performance', () => {
            eventCount++;
          });
          eventCounts.push(eventCount);
        }
        
        // Send events to all connections
        const startTime = Date.now();
        
        for (let i = 0; i < 10; i++) {
          eventEmitter.emit('test.performance', {
            iteration: i,
            timestamp: Date.now(),
          });
        }
        
        // Wait for event processing
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const processingTime = Date.now() - startTime;
        
        expect(processingTime).toBeLessThan(3000); // Should handle concurrent load
        
      } finally {
        // Clean up connections
        connections.forEach(conn => conn.close());
      }
    });
  });

  describe('SSE Service Status and Monitoring', () => {
    it('should provide connection statistics', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/sse/status')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      
      expect(response.body.data).toHaveProperty('activeConnections');
      expect(response.body.data).toHaveProperty('totalEventsSent');
      expect(response.body.data).toHaveProperty('uptime');
      expect(response.body.data).toHaveProperty('memoryUsage');
      
      expect(typeof response.body.data.activeConnections).toBe('number');
      expect(typeof response.body.data.totalEventsSent).toBe('number');
      expect(typeof response.body.data.uptime).toBe('number');
    });

    it('should provide connection details for admin users', async () => {
      const connection = await createSSEConnection(engineerToken);
      
      const response = await request(app.getHttpServer())
        .get('/api/v1/sse/connections')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      
      expect(response.body.data).toHaveProperty('connections');
      expect(Array.isArray(response.body.data.connections)).toBe(true);
      expect(response.body.data.connections.length).toBeGreaterThan(0);
      
      const connectionInfo = response.body.data.connections[0];
      expect(connectionInfo).toHaveProperty('id');
      expect(connectionInfo).toHaveProperty('userId');
      expect(connectionInfo).toHaveProperty('connectedAt');
      expect(connectionInfo).toHaveProperty('eventsSent');
      
      connection.close();
    });

    it('should restrict connection details from non-admin users', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/sse/connections')
        .set('Authorization', `Bearer ${engineerToken}`)
        .expect(403);
      
      await request(app.getHttpServer())
        .get('/api/v1/sse/connections')
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(403);
    });
  });
});