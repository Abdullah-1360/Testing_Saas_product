import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { SseModule } from '../src/sse/sse.module';
import { SseService } from '../src/sse/sse.service';
import { JwtModule } from '@nestjs/jwt';

describe('SSE (e2e)', () => {
  let app: INestApplication;
  let sseService: SseService;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        EventEmitterModule.forRoot(),
        JwtModule.register({
          secret: 'test-secret',
          signOptions: { expiresIn: '1h' },
        }),
        SseModule,
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    sseService = moduleFixture.get<SseService>(SseService);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('SseService', () => {
    it('should be defined', () => {
      expect(sseService).toBeDefined();
    });

    it('should send incident update events', () => {
      const testIncidentData = {
        incidentId: 'test-incident-123',
        siteId: 'test-site-456',
        domain: 'test.example.com',
        state: 'FIX_ATTEMPT',
        priority: 'MEDIUM',
        fixAttempts: 2,
        maxFixAttempts: 15,
        eventType: 'FIX_ATTEMPT_INCREMENT',
        phase: 'FIX_ATTEMPT',
        step: 'Testing SSE functionality',
        details: {
          testMessage: 'This is a test event for SSE functionality',
          timestamp: new Date().toISOString()
        }
      };

      // This should not throw an error
      expect(() => {
        sseService.sendIncidentUpdate(testIncidentData);
      }).not.toThrow();
    });

    it('should send system status updates', () => {
      expect(() => {
        sseService.sendSystemStatusUpdate('api_server', 'operational', { test: true });
      }).not.toThrow();
    });

    it('should send site health updates', () => {
      const siteHealthData = {
        siteId: 'test-site-123',
        domain: 'test.example.com',
        status: 'healthy' as const,
        lastCheck: new Date().toISOString(),
        responseTime: 150,
        details: { test: true }
      };

      expect(() => {
        sseService.sendSiteHealthUpdate(siteHealthData);
      }).not.toThrow();
    });

    it('should track active connections', () => {
      expect(sseService.getActiveConnectionsCount()).toBe(0);
    });

    it('should handle event listeners', () => {
      const testPayload = {
        incidentId: 'test-incident-123',
        siteId: 'test-site-456',
        domain: 'test.example.com',
        state: 'NEW',
        priority: 'MEDIUM',
        fixAttempts: 0,
        maxFixAttempts: 15,
        eventType: 'INCIDENT_CREATED',
        phase: 'NEW',
        step: 'Initial incident creation',
        details: { test: true }
      };

      // Test event handlers
      expect(() => {
        sseService.handleIncidentCreated(testPayload);
        sseService.handleIncidentUpdated(testPayload);
        sseService.handleIncidentResolved(testPayload);
        sseService.handleIncidentEscalated(testPayload);
      }).not.toThrow();
    });
  });
});