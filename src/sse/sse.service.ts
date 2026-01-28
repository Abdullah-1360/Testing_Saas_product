import { Injectable, Logger } from '@nestjs/common';
import { Subject, Observable } from 'rxjs';
import { filter, map } from 'rxjs/operators';
import { OnEvent } from '@nestjs/event-emitter';

export interface SseEvent {
  id?: string;
  type: string;
  data: any;
  retry?: number;
}

export interface IncidentUpdateEvent extends SseEvent {
  type: 'incident_update' | 'incident_created' | 'incident_resolved' | 'incident_escalated';
  data: {
    incidentId: string;
    siteId: string;
    domain: string;
    state: string;
    priority: string;
    fixAttempts: number;
    maxFixAttempts: number;
    timestamp: string;
    eventType?: string;
    phase?: string;
    step?: string;
    details?: any;
  };
}

export interface SystemStatusEvent extends SseEvent {
  type: 'system_status';
  data: {
    component: 'api_server' | 'job_engine' | 'database';
    status: 'operational' | 'degraded' | 'down' | 'processing' | 'idle' | 'error' | 'connected' | 'disconnected';
    timestamp: string;
    details?: any;
  };
}

export interface SiteHealthEvent extends SseEvent {
  type: 'site_health';
  data: {
    siteId: string;
    domain: string;
    status: 'healthy' | 'warning' | 'critical' | 'unknown';
    lastCheck: string;
    responseTime?: number;
    details?: any;
  };
}

export type RealTimeEvent = IncidentUpdateEvent | SystemStatusEvent | SiteHealthEvent;

@Injectable()
export class SseService {
  private readonly logger = new Logger(SseService.name);
  private readonly eventSubject = new Subject<RealTimeEvent>();
  private readonly connections = new Map<string, { userId: string; lastPing: Date }>();

  constructor() {
    // Clean up stale connections every 30 seconds
    setInterval(() => {
      this.cleanupStaleConnections();
    }, 30000);
  }

  /**
   * Get SSE observable for a specific user
   * Validates: Requirements 1.6
   */
  getEventStream(userId: string, connectionId: string): Observable<string> {
    this.logger.log(`New SSE connection established for user ${userId}`, {
      userId,
      connectionId,
      timestamp: new Date().toISOString()
    });

    // Register connection
    this.connections.set(connectionId, {
      userId,
      lastPing: new Date()
    });

    return this.eventSubject.asObservable().pipe(
      // Filter events based on user permissions if needed
      filter(event => this.shouldSendEventToUser(event, userId)),
      map(event => this.formatSseEvent(event))
    );
  }

  /**
   * Send incident update event
   * Validates: Requirements 1.6, 2.1
   */
  sendIncidentUpdate(incidentData: {
    incidentId: string;
    siteId: string;
    domain: string;
    state: string;
    priority: string;
    fixAttempts: number;
    maxFixAttempts: number;
    eventType?: string;
    phase?: string;
    step?: string;
    details?: any;
  }): void {
    const event: IncidentUpdateEvent = {
      id: `incident_${incidentData.incidentId}_${Date.now()}`,
      type: this.getIncidentEventType(incidentData.state, incidentData.eventType),
      data: {
        ...incidentData,
        timestamp: new Date().toISOString()
      },
      retry: 3000
    };

    this.logger.debug(`Broadcasting incident update event`, {
      incidentId: incidentData.incidentId,
      domain: incidentData.domain,
      state: incidentData.state,
      eventType: event.type
    });

    this.eventSubject.next(event);
  }

  /**
   * Send system status update
   * Validates: Requirements 1.6
   */
  sendSystemStatusUpdate(component: 'api_server' | 'job_engine' | 'database', status: string, details?: any): void {
    const event: SystemStatusEvent = {
      id: `system_${component}_${Date.now()}`,
      type: 'system_status',
      data: {
        component,
        status: status as any,
        timestamp: new Date().toISOString(),
        details
      },
      retry: 5000
    };

    this.logger.debug(`Broadcasting system status update`, {
      component,
      status,
      timestamp: event.data.timestamp
    });

    this.eventSubject.next(event);
  }

  /**
   * Send site health update
   * Validates: Requirements 1.6
   */
  sendSiteHealthUpdate(siteData: {
    siteId: string;
    domain: string;
    status: 'healthy' | 'warning' | 'critical' | 'unknown';
    lastCheck: string;
    responseTime?: number;
    details?: any;
  }): void {
    const event: SiteHealthEvent = {
      id: `site_${siteData.siteId}_${Date.now()}`,
      type: 'site_health',
      data: siteData,
      retry: 10000
    };

    this.logger.debug(`Broadcasting site health update`, {
      siteId: siteData.siteId,
      domain: siteData.domain,
      status: siteData.status
    });

    this.eventSubject.next(event);
  }

  /**
   * Send heartbeat to maintain connections
   */
  sendHeartbeat(): void {
    const event: SseEvent = {
      id: `heartbeat_${Date.now()}`,
      type: 'heartbeat',
      data: {
        timestamp: new Date().toISOString(),
        activeConnections: this.connections.size
      },
      retry: 30000
    };

    this.eventSubject.next(event as RealTimeEvent);
  }

  /**
   * Update connection ping time
   */
  updateConnectionPing(connectionId: string): void {
    const connection = this.connections.get(connectionId);
    if (connection) {
      connection.lastPing = new Date();
    }
  }

  /**
   * Remove connection
   */
  removeConnection(connectionId: string): void {
    const connection = this.connections.get(connectionId);
    if (connection) {
      this.logger.log(`SSE connection closed for user ${connection.userId}`, {
        userId: connection.userId,
        connectionId,
        duration: new Date().getTime() - connection.lastPing.getTime()
      });
      this.connections.delete(connectionId);
    }
  }

  /**
   * Get active connections count
   */
  getActiveConnectionsCount(): number {
    return this.connections.size;
  }

  /**
   * Get connections by user
   */
  getUserConnections(userId: string): string[] {
    const userConnections: string[] = [];
    for (const [connectionId, connection] of this.connections.entries()) {
      if (connection.userId === userId) {
        userConnections.push(connectionId);
      }
    }
    return userConnections;
  }

  /**
   * Determine incident event type based on state and event type
   */
  private getIncidentEventType(state: string, eventType?: string): IncidentUpdateEvent['type'] {
    if (eventType === 'INCIDENT_CREATED') return 'incident_created';
    if (eventType === 'INCIDENT_RESOLVED' || state === 'FIXED') return 'incident_resolved';
    if (eventType === 'INCIDENT_ESCALATED' || state === 'ESCALATED') return 'incident_escalated';
    return 'incident_update';
  }

  /**
   * Check if event should be sent to specific user (RBAC filtering)
   */
  private shouldSendEventToUser(_event: RealTimeEvent, _userId: string): boolean {
    // For now, send all events to all users
    // In the future, implement RBAC filtering based on user roles and permissions
    return true;
  }

  /**
   * Format event for SSE transmission
   */
  private formatSseEvent(event: RealTimeEvent): string {
    let formatted = '';
    
    if (event.id) {
      formatted += `id: ${event.id}\n`;
    }
    
    formatted += `event: ${event.type}\n`;
    formatted += `data: ${JSON.stringify(event.data)}\n`;
    
    if (event.retry) {
      formatted += `retry: ${event.retry}\n`;
    }
    
    formatted += '\n';
    
    return formatted;
  }

  /**
   * Clean up stale connections (older than 5 minutes without ping)
   */
  private cleanupStaleConnections(): void {
    const staleThreshold = 5 * 60 * 1000; // 5 minutes
    const now = new Date();
    const staleConnections: string[] = [];

    for (const [connectionId, connection] of this.connections.entries()) {
      if (now.getTime() - connection.lastPing.getTime() > staleThreshold) {
        staleConnections.push(connectionId);
      }
    }

    if (staleConnections.length > 0) {
      this.logger.debug(`Cleaning up ${staleConnections.length} stale SSE connections`);
      staleConnections.forEach(connectionId => {
        this.connections.delete(connectionId);
      });
    }
  }

  /**
   * Event listeners for incident events
   */
  @OnEvent('incident.created')
  handleIncidentCreated(payload: any) {
    this.sendIncidentUpdate(payload);
  }

  @OnEvent('incident.updated')
  handleIncidentUpdated(payload: any) {
    this.sendIncidentUpdate(payload);
  }

  @OnEvent('incident.resolved')
  handleIncidentResolved(payload: any) {
    this.sendIncidentUpdate(payload);
  }

  @OnEvent('incident.escalated')
  handleIncidentEscalated(payload: any) {
    this.sendIncidentUpdate(payload);
  }

  /**
   * Event listeners for system status events
   */
  @OnEvent('system.status.updated')
  handleSystemStatusUpdated(payload: any) {
    this.sendSystemStatusUpdate(payload.component, payload.status, payload.details);
  }

  /**
   * Event listeners for site health events
   */
  @OnEvent('site.health.updated')
  handleSiteHealthUpdated(payload: any) {
    this.sendSiteHealthUpdate(payload);
  }
}