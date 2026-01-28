import { Test, TestingModule } from '@nestjs/testing';
import { SseService } from './sse.service';
import { take } from 'rxjs/operators';

describe('SseService', () => {
  let service: SseService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SseService],
    }).compile();

    service = module.get<SseService>(SseService);
  });

  afterEach(() => {
    jest.clearAllTimers();
  });

  describe('getEventStream', () => {
    it('should create event stream for user', (done) => {
      const userId = 'user-1';
      const connectionId = 'conn-1';

      const stream = service.getEventStream(userId, connectionId);

      expect(stream).toBeDefined();
      expect(service.getActiveConnectionsCount()).toBe(1);
      expect(service.getUserConnections(userId)).toEqual([connectionId]);

      service.sendIncidentUpdate({
        incidentId: 'incident-1',
        siteId: 'site-1',
        domain: 'example.com',
        state: 'NEW',
        priority: 'MEDIUM',
        fixAttempts: 0,
        maxFixAttempts: 15,
      });

      stream.pipe(take(1)).subscribe(event => {
        expect(event).toContain('event: incident_update');
        expect(event).toContain('data: ');
        expect(event).toContain('incident-1');
        done();
      });
    });

    it('should track multiple connections for same user', () => {
      const userId = 'user-1';
      const connectionId1 = 'conn-1';
      const connectionId2 = 'conn-2';

      service.getEventStream(userId, connectionId1);
      service.getEventStream(userId, connectionId2);

      expect(service.getActiveConnectionsCount()).toBe(2);
      expect(service.getUserConnections(userId)).toEqual([connectionId1, connectionId2]);
    });
  });

  describe('sendIncidentUpdate', () => {
    it('should broadcast incident created event', (done) => {
      const userId = 'user-1';
      const connectionId = 'conn-1';
      const stream = service.getEventStream(userId, connectionId);

      const incidentData = {
        incidentId: 'incident-1',
        siteId: 'site-1',
        domain: 'example.com',
        state: 'NEW',
        priority: 'MEDIUM',
        fixAttempts: 0,
        maxFixAttempts: 15,
        eventType: 'INCIDENT_CREATED',
      };

      service.sendIncidentUpdate(incidentData);

      stream.pipe(take(1)).subscribe(event => {
        expect(event).toContain('event: incident_created');
        expect(event).toContain('id: incident_incident-1_');
        expect(event).toContain('retry: 3000');
        
        const dataMatch = event.match(/data: (.+)/);
        if (dataMatch && dataMatch[1]) {
          const eventData = JSON.parse(dataMatch[1]);
          expect(eventData).toMatchObject({
            incidentId: 'incident-1',
            siteId: 'site-1',
            domain: 'example.com',
            state: 'NEW',
            priority: 'MEDIUM',
            fixAttempts: 0,
            maxFixAttempts: 15,
            timestamp: expect.any(String),
          });
        }
        done();
      });
    });

    it('should broadcast incident resolved event', (done) => {
      const userId = 'user-1';
      const connectionId = 'conn-1';
      const stream = service.getEventStream(userId, connectionId);

      const incidentData = {
        incidentId: 'incident-1',
        siteId: 'site-1',
        domain: 'example.com',
        state: 'FIXED',
        priority: 'MEDIUM',
        fixAttempts: 3,
        maxFixAttempts: 15,
        eventType: 'INCIDENT_RESOLVED',
      };

      service.sendIncidentUpdate(incidentData);

      stream.pipe(take(1)).subscribe(event => {
        expect(event).toContain('event: incident_resolved');
        done();
      });
    });
  });

  describe('sendSystemStatusUpdate', () => {
    it('should broadcast system status update', (done) => {
      const userId = 'user-1';
      const connectionId = 'conn-1';
      const stream = service.getEventStream(userId, connectionId);

      service.sendSystemStatusUpdate('api_server', 'operational', { uptime: 3600 });

      stream.pipe(take(1)).subscribe(event => {
        expect(event).toContain('event: system_status');
        expect(event).toContain('id: system_api_server_');
        expect(event).toContain('retry: 5000');
        
        const dataMatch = event.match(/data: (.+)/);
        if (dataMatch && dataMatch[1]) {
          const eventData = JSON.parse(dataMatch[1]);
          expect(eventData).toMatchObject({
            component: 'api_server',
            status: 'operational',
            timestamp: expect.any(String),
            details: { uptime: 3600 },
          });
        }
        done();
      });
    });
  });

  describe('sendSiteHealthUpdate', () => {
    it('should broadcast site health update', (done) => {
      const userId = 'user-1';
      const connectionId = 'conn-1';
      const stream = service.getEventStream(userId, connectionId);

      const siteData = {
        siteId: 'site-1',
        domain: 'example.com',
        status: 'healthy' as const,
        lastCheck: '2024-01-15T10:00:00Z',
        responseTime: 250,
        details: { httpStatus: 200 },
      };

      service.sendSiteHealthUpdate(siteData);

      stream.pipe(take(1)).subscribe(event => {
        expect(event).toContain('event: site_health');
        expect(event).toContain('id: site_site-1_');
        expect(event).toContain('retry: 10000');
        
        const dataMatch = event.match(/data: (.+)/);
        if (dataMatch && dataMatch[1]) {
          const eventData = JSON.parse(dataMatch[1]);
          expect(eventData).toEqual(siteData);
        }
        done();
      });
    });
  });

  describe('sendHeartbeat', () => {
    it('should broadcast heartbeat event', (done) => {
      const userId = 'user-1';
      const connectionId = 'conn-1';
      const stream = service.getEventStream(userId, connectionId);

      service.sendHeartbeat();

      stream.pipe(take(1)).subscribe(event => {
        expect(event).toContain('event: heartbeat');
        expect(event).toContain('id: heartbeat_');
        expect(event).toContain('retry: 30000');
        
        const dataMatch = event.match(/data: (.+)/);
        if (dataMatch && dataMatch[1]) {
          const eventData = JSON.parse(dataMatch[1]);
          expect(eventData).toMatchObject({
            timestamp: expect.any(String),
            activeConnections: 1,
          });
        }
        done();
      });
    });
  });

  describe('connection management', () => {
    it('should update connection ping time', () => {
      const userId = 'user-1';
      const connectionId = 'conn-1';
      service.getEventStream(userId, connectionId);

      service.updateConnectionPing(connectionId);

      expect(service.getActiveConnectionsCount()).toBe(1);
    });

    it('should remove connection', () => {
      const userId = 'user-1';
      const connectionId = 'conn-1';
      service.getEventStream(userId, connectionId);
      expect(service.getActiveConnectionsCount()).toBe(1);

      service.removeConnection(connectionId);

      expect(service.getActiveConnectionsCount()).toBe(0);
      expect(service.getUserConnections(userId)).toEqual([]);
    });

    it('should handle removing non-existent connection gracefully', () => {
      service.removeConnection('non-existent-connection');
      expect(service.getActiveConnectionsCount()).toBe(0);
    });
  });

  describe('event listeners', () => {
    it('should handle incident.created event', (done) => {
      const userId = 'user-1';
      const connectionId = 'conn-1';
      const stream = service.getEventStream(userId, connectionId);

      const payload = {
        incidentId: 'incident-1',
        siteId: 'site-1',
        domain: 'example.com',
        state: 'NEW',
        priority: 'MEDIUM',
        fixAttempts: 0,
        maxFixAttempts: 15,
      };

      service.handleIncidentCreated(payload);

      stream.pipe(take(1)).subscribe(event => {
        expect(event).toContain('event: incident_update');
        done();
      });
    });
  });

  describe('event formatting', () => {
    it('should format SSE event correctly with all fields', (done) => {
      const userId = 'user-1';
      const connectionId = 'conn-1';
      const stream = service.getEventStream(userId, connectionId);

      service.sendIncidentUpdate({
        incidentId: 'incident-1',
        siteId: 'site-1',
        domain: 'example.com',
        state: 'NEW',
        priority: 'MEDIUM',
        fixAttempts: 0,
        maxFixAttempts: 15,
      });

      stream.pipe(take(1)).subscribe(event => {
        const lines = event.split('\n');
        
        expect(lines[0]).toMatch(/^id: incident_incident-1_\d+$/);
        expect(lines[1]).toBe('event: incident_update');
        expect(lines[2]).toMatch(/^data: \{.+\}$/);
        expect(lines[3]).toBe('retry: 3000');
        expect(lines[4]).toBe('');
        
        done();
      });
    });
  });
});