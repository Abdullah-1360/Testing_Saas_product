import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { Incident, IncidentEvent, IncidentState, TriggerType, Priority } from '@prisma/client';
import { CreateIncidentDto } from './dto/create-incident.dto';
import { UpdateIncidentDto } from './dto/update-incident.dto';
import { CreateIncidentEventDto } from './dto/create-incident-event.dto';
import { IncidentTimelineQueryDto, IncidentTimelineResponseDto } from './dto/incident-timeline.dto';
import { EscalationTicketDto, TicketPayloadDto } from './dto/escalation-ticket.dto';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class IncidentsService {
  private readonly logger = new Logger(IncidentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2
  ) {}

  /**
   * Create a new incident
   * Validates: Requirements 2.1, 5.2
   */
  async create(createIncidentDto: CreateIncidentDto): Promise<Incident> {
    const { siteId, triggerType, priority, maxFixAttempts = 15, metadata } = createIncidentDto;

    try {
      // Verify site exists
      const site = await this.prisma.site.findUnique({
        where: { id: siteId },
        include: { server: true }
      });

      if (!site) {
        throw new NotFoundException(`Site with ID ${siteId} not found`);
      }

      // Generate correlation and trace IDs for tracking
      const correlationId = uuidv4();
      const traceId = uuidv4();

      // Create the incident
      const incident = await this.prisma.incident.create({
        data: {
          siteId,
          state: IncidentState.NEW,
          triggerType,
          priority,
          fixAttempts: 0,
          maxFixAttempts,
        },
        include: {
          site: {
            include: {
              server: true
            }
          }
        }
      });

      // Create initial incident event (append-only logging)
      await this.createEvent({
        incidentId: incident.id,
        eventType: 'INCIDENT_CREATED',
        phase: IncidentState.NEW,
        step: 'Initial incident creation',
        data: {
          triggerType,
          priority,
          maxFixAttempts,
          correlationId,
          traceId,
          siteInfo: {
            domain: site.domain,
            serverName: site.server.name,
            hostname: site.server.hostname
          },
          metadata
        }
      });

      this.logger.log(`Created incident ${incident.id} for site ${site.domain}`, {
        incidentId: incident.id,
        siteId,
        domain: site.domain,
        triggerType,
        priority,
        correlationId,
        traceId
      });

      // Emit incident creation event for SSE broadcasting
      this.eventEmitter.emit('incident.created', {
        incidentId: incident.id,
        siteId: incident.siteId,
        domain: site.domain,
        state: incident.state,
        priority: incident.priority,
        fixAttempts: incident.fixAttempts,
        maxFixAttempts: incident.maxFixAttempts,
        eventType: 'INCIDENT_CREATED',
        phase: incident.state,
        step: 'Initial incident creation',
        details: {
          triggerType,
          correlationId,
          traceId
        }
      });

      return incident;
    } catch (error) {
      this.logger.error(`Failed to create incident for site ${siteId}:`, error);
      throw error;
    }
  }

  /**
   * Find all incidents with optional filtering
   */
  async findAll(query?: {
    siteId?: string;
    state?: IncidentState;
    priority?: Priority;
    triggerType?: TriggerType;
    limit?: number;
    offset?: number;
  }): Promise<{ incidents: Incident[]; total: number }> {
    const { siteId, state, priority, triggerType, limit = 50, offset = 0 } = query || {};

    const where: any = {};
    if (siteId) where.siteId = siteId;
    if (state) where.state = state;
    if (priority) where.priority = priority;
    if (triggerType) where.triggerType = triggerType;

    const [incidents, total] = await Promise.all([
      this.prisma.incident.findMany({
        where,
        include: {
          site: {
            include: {
              server: true
            }
          },
          _count: {
            select: {
              events: true,
              commandExecutions: true,
              evidence: true,
              backupArtifacts: true,
              fileChanges: true,
              verificationResults: true
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset
      }),
      this.prisma.incident.count({ where })
    ]);

    return { incidents, total };
  }

  /**
   * Find all incidents with pagination and filtering
   */
  async findAllPaginated(
    skip: number, 
    limit: number, 
    filters: Record<string, any> = {}
  ): Promise<{ incidents: Incident[]; total: number }> {
    const where: any = {};

    // Apply filters
    if (filters.siteId) {
      where.siteId = filters.siteId;
    }
    if (filters.state) {
      where.state = filters.state;
    }
    if (filters.priority) {
      where.priority = filters.priority;
    }
    if (filters.triggerType) {
      where.triggerType = filters.triggerType;
    }
    if (filters.search) {
      // Search in site domain or incident ID
      where.OR = [
        { id: { contains: filters.search, mode: 'insensitive' } },
        { site: { domain: { contains: filters.search, mode: 'insensitive' } } },
      ];
    }

    const [incidents, total] = await Promise.all([
      this.prisma.incident.findMany({
        where,
        include: {
          site: {
            include: {
              server: {
                select: {
                  id: true,
                  name: true,
                  hostname: true,
                },
              },
            },
          },
          _count: {
            select: {
              events: true,
              commandExecutions: true,
              evidence: true,
              backupArtifacts: true,
              fileChanges: true,
              verificationResults: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip,
      }),
      this.prisma.incident.count({ where }),
    ]);

    return { incidents, total };
  }

  /**
   * Find incident by ID with full details
   */
  async findOne(id: string): Promise<Incident | null> {
    const incident = await this.prisma.incident.findUnique({
      where: { id },
      include: {
        site: {
          include: {
            server: true
          }
        },
        events: {
          orderBy: { timestamp: 'asc' }
        },
        commandExecutions: {
          orderBy: { timestamp: 'asc' }
        },
        evidence: {
          orderBy: { timestamp: 'asc' }
        },
        backupArtifacts: {
          orderBy: { createdAt: 'asc' }
        },
        fileChanges: {
          orderBy: { timestamp: 'asc' }
        },
        verificationResults: {
          orderBy: { timestamp: 'asc' }
        }
      }
    });

    if (!incident) {
      throw new NotFoundException(`Incident with ID ${id} not found`);
    }

    return incident;
  }

  /**
   * Update incident with state transitions and fix attempt tracking
   * Validates: Requirements 5.2, 5.3
   */
  async update(id: string, updateIncidentDto: UpdateIncidentDto): Promise<Incident> {
    const { state, priority, fixAttempts, maxFixAttempts, resolvedAt, escalatedAt, escalationReason } = updateIncidentDto;

    try {
      const existingIncident = await this.prisma.incident.findUnique({
        where: { id },
        include: { site: true }
      });

      if (!existingIncident) {
        throw new NotFoundException(`Incident with ID ${id} not found`);
      }

      // Validate fix attempt limits (Requirement 5.2)
      if (fixAttempts !== undefined && fixAttempts > (maxFixAttempts || existingIncident.maxFixAttempts)) {
        throw new BadRequestException(`Fix attempts (${fixAttempts}) cannot exceed maximum (${maxFixAttempts || existingIncident.maxFixAttempts})`);
      }

      // Prepare update data
      const updateData: any = {};
      if (state !== undefined) updateData.state = state;
      if (priority !== undefined) updateData.priority = priority;
      if (fixAttempts !== undefined) updateData.fixAttempts = fixAttempts;
      if (maxFixAttempts !== undefined) updateData.maxFixAttempts = maxFixAttempts;
      if (resolvedAt !== undefined) updateData.resolvedAt = new Date(resolvedAt);
      if (escalatedAt !== undefined) updateData.escalatedAt = new Date(escalatedAt);
      if (escalationReason !== undefined) updateData.escalationReason = escalationReason;

      // Update the incident
      const updatedIncident = await this.prisma.incident.update({
        where: { id },
        data: updateData,
        include: {
          site: {
            include: {
              server: true
            }
          }
        }
      });

      // Log state transition if state changed
      if (state !== undefined && state !== existingIncident.state) {
        await this.createEvent({
          incidentId: id,
          eventType: 'STATE_TRANSITION',
          phase: state,
          step: `Transitioned from ${existingIncident.state} to ${state}`,
          data: {
            previousState: existingIncident.state,
            newState: state,
            reason: escalationReason || 'State transition',
            fixAttempts: updatedIncident.fixAttempts,
            maxFixAttempts: updatedIncident.maxFixAttempts
          }
        });

        // Emit state transition event for SSE broadcasting
        this.eventEmitter.emit('incident.updated', {
          incidentId: id,
          siteId: updatedIncident.siteId,
          domain: updatedIncident.site.domain,
          state: updatedIncident.state,
          priority: updatedIncident.priority,
          fixAttempts: updatedIncident.fixAttempts,
          maxFixAttempts: updatedIncident.maxFixAttempts,
          eventType: 'STATE_TRANSITION',
          phase: state,
          step: `Transitioned from ${existingIncident.state} to ${state}`,
          details: {
            previousState: existingIncident.state,
            newState: state,
            reason: escalationReason || 'State transition'
          }
        });
      }

      // Log fix attempt increment
      if (fixAttempts !== undefined && fixAttempts > existingIncident.fixAttempts) {
        await this.createEvent({
          incidentId: id,
          eventType: 'FIX_ATTEMPT_INCREMENT',
          phase: updatedIncident.state,
          step: `Fix attempt ${fixAttempts} of ${updatedIncident.maxFixAttempts}`,
          data: {
            previousAttempts: existingIncident.fixAttempts,
            newAttempts: fixAttempts,
            maxAttempts: updatedIncident.maxFixAttempts,
            remainingAttempts: updatedIncident.maxFixAttempts - fixAttempts
          }
        });

        // Check if we've reached the limit and should escalate
        if (fixAttempts >= updatedIncident.maxFixAttempts) {
          this.logger.warn(`Incident ${id} has reached maximum fix attempts (${fixAttempts}/${updatedIncident.maxFixAttempts})`);
          
          await this.createEvent({
            incidentId: id,
            eventType: 'MAX_ATTEMPTS_REACHED',
            phase: updatedIncident.state,
            step: 'Maximum fix attempts reached - escalation required',
            data: {
              fixAttempts,
              maxFixAttempts: updatedIncident.maxFixAttempts,
              escalationRequired: true
            }
          });
        }
      }

      // Log resolution
      if (resolvedAt !== undefined && !existingIncident.resolvedAt) {
        await this.createEvent({
          incidentId: id,
          eventType: 'INCIDENT_RESOLVED',
          phase: updatedIncident.state,
          step: 'Incident resolved successfully',
          data: {
            resolvedAt: updatedIncident.resolvedAt,
            totalFixAttempts: updatedIncident.fixAttempts,
            resolutionTime: new Date(resolvedAt).getTime() - existingIncident.createdAt.getTime()
          }
        });

        // Emit resolution event for SSE broadcasting
        this.eventEmitter.emit('incident.resolved', {
          incidentId: id,
          siteId: updatedIncident.siteId,
          domain: updatedIncident.site.domain,
          state: updatedIncident.state,
          priority: updatedIncident.priority,
          fixAttempts: updatedIncident.fixAttempts,
          maxFixAttempts: updatedIncident.maxFixAttempts,
          eventType: 'INCIDENT_RESOLVED',
          phase: updatedIncident.state,
          step: 'Incident resolved successfully',
          details: {
            resolvedAt: updatedIncident.resolvedAt,
            totalFixAttempts: updatedIncident.fixAttempts,
            resolutionTime: new Date(resolvedAt).getTime() - existingIncident.createdAt.getTime()
          }
        });
      }

      // Log escalation
      if (escalatedAt !== undefined && !existingIncident.escalatedAt) {
        await this.createEvent({
          incidentId: id,
          eventType: 'INCIDENT_ESCALATED',
          phase: updatedIncident.state,
          step: 'Incident escalated for manual intervention',
          data: {
            escalatedAt: updatedIncident.escalatedAt,
            escalationReason: updatedIncident.escalationReason,
            fixAttempts: updatedIncident.fixAttempts,
            maxFixAttempts: updatedIncident.maxFixAttempts
          }
        });

        // Emit escalation event for SSE broadcasting
        this.eventEmitter.emit('incident.escalated', {
          incidentId: id,
          siteId: updatedIncident.siteId,
          domain: updatedIncident.site.domain,
          state: updatedIncident.state,
          priority: updatedIncident.priority,
          fixAttempts: updatedIncident.fixAttempts,
          maxFixAttempts: updatedIncident.maxFixAttempts,
          eventType: 'INCIDENT_ESCALATED',
          phase: updatedIncident.state,
          step: 'Incident escalated for manual intervention',
          details: {
            escalatedAt: updatedIncident.escalatedAt,
            escalationReason: updatedIncident.escalationReason
          }
        });
      }

      this.logger.log(`Updated incident ${id}`, {
        incidentId: id,
        changes: updateData,
        siteId: existingIncident.siteId,
        domain: existingIncident.site.domain
      });

      return updatedIncident;
    } catch (error) {
      this.logger.error(`Failed to update incident ${id}:`, error);
      throw error;
    }
  }

  /**
   * Delete incident (soft delete by marking as inactive)
   */
  async remove(id: string): Promise<void> {
    const incident = await this.prisma.incident.findUnique({
      where: { id },
      include: { site: true }
    });

    if (!incident) {
      throw new NotFoundException(`Incident with ID ${id} not found`);
    }

    // Create deletion event before removing
    await this.createEvent({
      incidentId: id,
      eventType: 'INCIDENT_DELETED',
      phase: incident.state,
      step: 'Incident marked for deletion',
      data: {
        deletedAt: new Date().toISOString(),
        finalState: incident.state,
        fixAttempts: incident.fixAttempts
      }
    });

    // Note: In a production system, you might want to implement soft delete
    // For now, we'll actually delete the incident and rely on cascade deletes
    await this.prisma.incident.delete({
      where: { id }
    });

    this.logger.log(`Deleted incident ${id}`, {
      incidentId: id,
      siteId: incident.siteId,
      domain: incident.site.domain
    });
  }

  /**
   * Create incident event (append-only logging)
   * Validates: Requirements 2.1, 2.4, 2.5
   */
  async createEvent(createEventDto: CreateIncidentEventDto): Promise<IncidentEvent> {
    const { incidentId, eventType, phase, step, data, duration } = createEventDto;

    try {
      // Verify incident exists
      const incident = await this.prisma.incident.findUnique({
        where: { id: incidentId }
      });

      if (!incident) {
        throw new NotFoundException(`Incident with ID ${incidentId} not found`);
      }

      // Create the event with automatic timestamp
      const event = await this.prisma.incidentEvent.create({
        data: {
          incidentId,
          eventType,
          phase,
          step,
          data: data || {},
          duration: duration || null
        }
      });

      this.logger.debug(`Created incident event ${event.id}`, {
        incidentId,
        eventType,
        phase,
        step,
        eventId: event.id
      });

      return event;
    } catch (error) {
      this.logger.error(`Failed to create incident event for incident ${incidentId}:`, error);
      throw error;
    }
  }

  /**
   * Get incident timeline with filtering
   * Validates: Requirements 2.1, 2.2
   */
  async getTimeline(query: IncidentTimelineQueryDto): Promise<IncidentTimelineResponseDto[]> {
    const { incidentId, phase, eventType, startDate, endDate } = query;

    const where: any = {};
    if (incidentId) where.incidentId = incidentId;
    if (phase) where.phase = phase;
    if (eventType) where.eventType = eventType;
    if (startDate || endDate) {
      where.timestamp = {};
      if (startDate) where.timestamp.gte = new Date(startDate);
      if (endDate) where.timestamp.lte = new Date(endDate);
    }

    const events = await this.prisma.incidentEvent.findMany({
      where,
      orderBy: { timestamp: 'asc' },
      include: {
        incident: {
          include: {
            site: true
          }
        }
      }
    });

    return events.map(event => ({
      id: event.id,
      incidentId: event.incidentId,
      eventType: event.eventType,
      phase: event.phase,
      step: event.step,
      data: event.data as Record<string, any>,
      timestamp: event.timestamp,
      duration: event.duration || undefined
    }));
  }

  /**
   * Escalate incident and generate ticket payload
   * Validates: Requirements 5.3
   */
  async escalateIncident(id: string, reason: string): Promise<EscalationTicketDto> {
    try {
      const incident = await this.prisma.incident.findUnique({
        where: { id },
        include: {
          site: {
            include: {
              server: true
            }
          }
        }
      });
      
      if (!incident) {
        throw new NotFoundException(`Incident with ID ${id} not found`);
      }

      // Update incident to escalated state
      await this.update(id, {
        state: IncidentState.ESCALATED,
        escalatedAt: new Date().toISOString(),
        escalationReason: reason
      });

      // Generate escalation ticket
      const escalationTicket: EscalationTicketDto = {
        incidentId: id,
        title: `WordPress Site Issue - ${incident.site.domain}`,
        description: this.generateEscalationDescription(incident, reason),
        priority: incident.priority,
        reason,
        tags: [
          'wordpress',
          'autohealer',
          incident.triggerType.toLowerCase(),
          incident.priority.toLowerCase(),
          incident.site.server.controlPanel?.toLowerCase() || 'raw-vps'
        ],
        metadata: {
          siteId: incident.siteId,
          serverId: incident.site.serverId,
          domain: incident.site.domain,
          hostname: incident.site.server.hostname,
          fixAttempts: incident.fixAttempts,
          maxFixAttempts: incident.maxFixAttempts,
          incidentDuration: new Date().getTime() - incident.createdAt.getTime(),
          escalationTime: new Date().toISOString()
        }
      };

      this.logger.warn(`Escalated incident ${id}`, {
        incidentId: id,
        reason,
        domain: incident.site.domain,
        fixAttempts: incident.fixAttempts,
        maxFixAttempts: incident.maxFixAttempts
      });

      return escalationTicket;
    } catch (error) {
      this.logger.error(`Failed to escalate incident ${id}:`, error);
      throw error;
    }
  }

  /**
   * Generate comprehensive ticket payload for external systems
   * Validates: Requirements 2.1, 2.2
   */
  async generateTicketPayload(id: string): Promise<TicketPayloadDto> {
    const incident = await this.findOne(id) as any;
    
    if (!incident) {
      throw new NotFoundException(`Incident with ID ${id} not found`);
    }

    const ticketPayload: TicketPayloadDto = {
      incident: {
        id: incident.id,
        siteId: incident.siteId,
        domain: incident.site?.domain || 'unknown',
        state: incident.state,
        priority: incident.priority,
        fixAttempts: incident.fixAttempts,
        createdAt: incident.createdAt,
        escalatedAt: incident.escalatedAt || new Date(),
        escalationReason: incident.escalationReason || 'Manual escalation'
      },
      timeline: (incident.events || []).map((event: any) => ({
        eventType: event.eventType,
        phase: event.phase,
        step: event.step,
        timestamp: event.timestamp,
        duration: event.duration,
        data: event.data as Record<string, any>
      })),
      evidence: (incident.evidence || []).map((evidence: any) => ({
        type: evidence.evidenceType,
        signature: evidence.signature,
        timestamp: evidence.timestamp,
        metadata: evidence.metadata as Record<string, any>
      })),
      commands: (incident.commandExecutions || []).map((cmd: any) => ({
        command: cmd.command,
        exitCode: cmd.exitCode || 0,
        executionTime: cmd.executionTime || 0,
        timestamp: cmd.timestamp
      })),
      backups: (incident.backupArtifacts || []).map((backup: any) => ({
        artifactType: backup.artifactType,
        filePath: backup.filePath,
        checksum: backup.checksum,
        size: Number(backup.size),
        createdAt: backup.createdAt
      })),
      changes: (incident.fileChanges || []).map((change: any) => ({
        filePath: change.filePath,
        changeType: change.changeType,
        checksum: change.checksum,
        timestamp: change.timestamp
      }))
    };

    return ticketPayload;
  }

  /**
   * Get incident statistics
   */
  async getStatistics(siteId?: string): Promise<{
    total: number;
    byState: Record<string, number>;
    byPriority: Record<string, number>;
    averageFixAttempts: number;
    averageResolutionTime: number;
  }> {
    const where = siteId ? { siteId } : {};

    const [incidents, stateStats, priorityStats] = await Promise.all([
      this.prisma.incident.findMany({
        where,
        select: {
          fixAttempts: true,
          createdAt: true,
          resolvedAt: true,
          state: true,
          priority: true
        }
      }),
      this.prisma.incident.groupBy({
        by: ['state'],
        where,
        _count: { state: true }
      }),
      this.prisma.incident.groupBy({
        by: ['priority'],
        where,
        _count: { priority: true }
      })
    ]);

    const resolvedIncidents = incidents.filter(i => i.resolvedAt);
    const averageFixAttempts = incidents.length > 0 
      ? incidents.reduce((sum, i) => sum + i.fixAttempts, 0) / incidents.length 
      : 0;
    
    const averageResolutionTime = resolvedIncidents.length > 0
      ? resolvedIncidents.reduce((sum, i) => {
          return sum + (i.resolvedAt!.getTime() - i.createdAt.getTime());
        }, 0) / resolvedIncidents.length
      : 0;

    return {
      total: incidents.length,
      byState: Object.fromEntries(stateStats.map(s => [s.state, s._count.state])),
      byPriority: Object.fromEntries(priorityStats.map(p => [p.priority, p._count.priority])),
      averageFixAttempts: Math.round(averageFixAttempts * 100) / 100,
      averageResolutionTime: Math.round(averageResolutionTime)
    };
  }

  /**
   * Generate escalation description for tickets
   */
  private generateEscalationDescription(incident: any, reason: string): string {
    const site = incident.site;
    const server = site.server;
    
    return `
WordPress site ${site.domain} requires manual intervention.

**Incident Details:**
- Incident ID: ${incident.id}
- Site: ${site.domain}
- Server: ${server.name} (${server.hostname})
- Control Panel: ${server.controlPanel || 'Raw VPS'}
- Priority: ${incident.priority}
- State: ${incident.state}
- Fix Attempts: ${incident.fixAttempts}/${incident.maxFixAttempts}
- Created: ${incident.createdAt.toISOString()}
- Escalation Reason: ${reason}

**Site Configuration:**
- Document Root: ${site.documentRoot}
- WordPress Path: ${site.wordpressPath}
- Site URL: ${site.siteUrl}
- Admin URL: ${site.adminUrl}
- Multisite: ${site.isMultisite ? 'Yes' : 'No'}

**Server Details:**
- Hostname: ${server.hostname}
- Port: ${server.port}
- Username: ${server.username}
- Auth Type: ${server.authType}

Please review the incident timeline and evidence for detailed information about attempted fixes.
    `.trim();
  }
}