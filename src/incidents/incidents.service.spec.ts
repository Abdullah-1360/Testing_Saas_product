import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { IncidentsService } from './incidents.service';
import { PrismaService } from '../database/prisma.service';
import { IncidentState, TriggerType, Priority } from '@prisma/client';
import { CreateIncidentDto } from './dto/create-incident.dto';
import { UpdateIncidentDto } from './dto/update-incident.dto';

describe('IncidentsService', () => {
  let service: IncidentsService;
  let prismaService: jest.Mocked<PrismaService>;
  let eventEmitter: jest.Mocked<EventEmitter2>;

  const mockSite = {
    id: 'site-1',
    domain: 'example.com',
    serverId: 'server-1',
    documentRoot: '/var/www/html',
    wordpressPath: '/var/www/html/wp',
    isMultisite: false,
    siteUrl: 'https://example.com',
    adminUrl: 'https://example.com/wp-admin',
    isActive: true,
    server: {
      id: 'server-1',
      name: 'Web Server 1',
      hostname: 'web1.example.com',
      port: 22,
      username: 'root',
      authType: 'key',
      controlPanel: 'cPanel'
    }
  };

  const mockIncident = {
    id: 'incident-1',
    siteId: 'site-1',
    state: IncidentState.NEW,
    triggerType: TriggerType.AUTOMATIC,
    priority: Priority.MEDIUM,
    fixAttempts: 0,
    maxFixAttempts: 15,
    createdAt: new Date('2024-01-15T10:00:00Z'),
    updatedAt: new Date('2024-01-15T10:00:00Z'),
    resolvedAt: null,
    escalatedAt: null,
    escalationReason: null,
    site: mockSite
  };

  beforeEach(async () => {
    const mockPrismaService = {
      site: {
        findUnique: jest.fn(),
      },
      incident: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        count: jest.fn(),
        groupBy: jest.fn(),
      },
      incidentEvent: {
        create: jest.fn(),
        findMany: jest.fn(),
      },
    };

    const mockEventEmitter = {
      emit: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IncidentsService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: EventEmitter2,
          useValue: mockEventEmitter,
        },
      ],
    }).compile();

    service = module.get<IncidentsService>(IncidentsService);
    prismaService = module.get(PrismaService);
    eventEmitter = module.get(EventEmitter2);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create a new incident successfully', async () => {
      // Arrange
      const createIncidentDto: CreateIncidentDto = {
        siteId: 'site-1',
        triggerType: TriggerType.AUTOMATIC,
        priority: Priority.MEDIUM,
        maxFixAttempts: 15,
        metadata: { error: '500 Internal Server Error' }
      };

      prismaService.site.findUnique.mockResolvedValue(mockSite as any);
      prismaService.incident.create.mockResolvedValue(mockIncident as any);
      prismaService.incidentEvent.create.mockResolvedValue({
        id: 'event-1',
        incidentId: 'incident-1',
        eventType: 'INCIDENT_CREATED',
        phase: IncidentState.NEW,
        step: 'Initial incident creation',
        data: {},
        timestamp: new Date(),
        duration: null
      } as any);

      // Act
      const result = await service.create(createIncidentDto);

      // Assert
      expect(result).toEqual(mockIncident);
      expect(prismaService.site.findUnique).toHaveBeenCalledWith({
        where: { id: 'site-1' },
        include: { server: true }
      });
      expect(prismaService.incident.create).toHaveBeenCalledWith({
        data: {
          siteId: 'site-1',
          state: IncidentState.NEW,
          triggerType: TriggerType.AUTOMATIC,
          priority: Priority.MEDIUM,
          fixAttempts: 0,
          maxFixAttempts: 15,
        },
        include: {
          site: {
            include: {
              server: true
            }
          }
        }
      });
      expect(prismaService.incidentEvent.create).toHaveBeenCalled();
      expect(eventEmitter.emit).toHaveBeenCalledWith('incident.created', expect.any(Object));
    });

    it('should throw NotFoundException when site does not exist', async () => {
      // Arrange
      const createIncidentDto: CreateIncidentDto = {
        siteId: 'nonexistent-site',
        triggerType: TriggerType.AUTOMATIC,
        priority: Priority.MEDIUM
      };

      prismaService.site.findUnique.mockResolvedValue(null);

      // Act & Assert
      await expect(service.create(createIncidentDto)).rejects.toThrow(
        new NotFoundException('Site with ID nonexistent-site not found')
      );
      expect(prismaService.incident.create).not.toHaveBeenCalled();
    });

    it('should use default maxFixAttempts when not provided', async () => {
      // Arrange
      const createIncidentDto: CreateIncidentDto = {
        siteId: 'site-1',
        triggerType: TriggerType.AUTOMATIC,
        priority: Priority.MEDIUM
      };

      prismaService.site.findUnique.mockResolvedValue(mockSite as any);
      prismaService.incident.create.mockResolvedValue(mockIncident as any);
      prismaService.incidentEvent.create.mockResolvedValue({} as any);

      // Act
      await service.create(createIncidentDto);

      // Assert
      expect(prismaService.incident.create).toHaveBeenCalledWith({
        data: {
          siteId: 'site-1',
          state: IncidentState.NEW,
          triggerType: TriggerType.AUTOMATIC,
          priority: Priority.MEDIUM,
          fixAttempts: 0,
          maxFixAttempts: 15, // Default value
        },
        include: {
          site: {
            include: {
              server: true
            }
          }
        }
      });
    });
  });

  describe('findAll', () => {
    it('should return paginated incidents with filters', async () => {
      // Arrange
      const mockIncidents = [mockIncident];
      const query = {
        siteId: 'site-1',
        state: IncidentState.NEW,
        limit: 10,
        offset: 0
      };

      prismaService.incident.findMany.mockResolvedValue(mockIncidents as any);
      prismaService.incident.count.mockResolvedValue(1);

      // Act
      const result = await service.findAll(query);

      // Assert
      expect(result).toEqual({
        incidents: mockIncidents,
        total: 1
      });
      expect(prismaService.incident.findMany).toHaveBeenCalledWith({
        where: {
          siteId: 'site-1',
          state: IncidentState.NEW
        },
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
        take: 10,
        skip: 0
      });
    });

    it('should return all incidents when no filters provided', async () => {
      // Arrange
      const mockIncidents = [mockIncident];
      prismaService.incident.findMany.mockResolvedValue(mockIncidents as any);
      prismaService.incident.count.mockResolvedValue(1);

      // Act
      const result = await service.findAll();

      // Assert
      expect(result).toEqual({
        incidents: mockIncidents,
        total: 1
      });
      expect(prismaService.incident.findMany).toHaveBeenCalledWith({
        where: {},
        include: expect.any(Object),
        orderBy: { createdAt: 'desc' },
        take: 50, // Default limit
        skip: 0
      });
    });
  });

  describe('findOne', () => {
    it('should return incident with full details', async () => {
      // Arrange
      const mockIncidentWithDetails = {
        ...mockIncident,
        events: [],
        commandExecutions: [],
        evidence: [],
        backupArtifacts: [],
        fileChanges: [],
        verificationResults: []
      };

      prismaService.incident.findUnique.mockResolvedValue(mockIncidentWithDetails as any);

      // Act
      const result = await service.findOne('incident-1');

      // Assert
      expect(result).toEqual(mockIncidentWithDetails);
      expect(prismaService.incident.findUnique).toHaveBeenCalledWith({
        where: { id: 'incident-1' },
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
    });

    it('should throw NotFoundException when incident does not exist', async () => {
      // Arrange
      prismaService.incident.findUnique.mockResolvedValue(null);

      // Act & Assert
      await expect(service.findOne('nonexistent-incident')).rejects.toThrow(
        new NotFoundException('Incident with ID nonexistent-incident not found')
      );
    });
  });

  describe('update', () => {
    it('should update incident successfully', async () => {
      // Arrange
      const updateDto: UpdateIncidentDto = {
        state: IncidentState.DISCOVERY,
        priority: Priority.HIGH
      };

      const updatedIncident = {
        ...mockIncident,
        state: IncidentState.DISCOVERY,
        priority: Priority.HIGH
      };

      prismaService.incident.findUnique.mockResolvedValue(mockIncident as any);
      prismaService.incident.update.mockResolvedValue(updatedIncident as any);
      prismaService.incidentEvent.create.mockResolvedValue({} as any);

      // Act
      const result = await service.update('incident-1', updateDto);

      // Assert
      expect(result).toEqual(updatedIncident);
      expect(prismaService.incident.update).toHaveBeenCalledWith({
        where: { id: 'incident-1' },
        data: {
          state: IncidentState.DISCOVERY,
          priority: Priority.HIGH
        },
        include: {
          site: {
            include: {
              server: true
            }
          }
        }
      });
      expect(eventEmitter.emit).toHaveBeenCalledWith('incident.updated', expect.any(Object));
    });

    it('should enforce fix attempt limits', async () => {
      // Arrange
      const updateDto: UpdateIncidentDto = {
        fixAttempts: 20, // Exceeds max of 15
        maxFixAttempts: 15
      };

      prismaService.incident.findUnique.mockResolvedValue(mockIncident as any);

      // Act & Assert
      await expect(service.update('incident-1', updateDto)).rejects.toThrow(
        new BadRequestException('Fix attempts (20) cannot exceed maximum (15)')
      );
      expect(prismaService.incident.update).not.toHaveBeenCalled();
    });

    it('should create state transition event when state changes', async () => {
      // Arrange
      const updateDto: UpdateIncidentDto = {
        state: IncidentState.FIXED
      };

      const updatedIncident = {
        ...mockIncident,
        state: IncidentState.FIXED
      };

      prismaService.incident.findUnique.mockResolvedValue(mockIncident as any);
      prismaService.incident.update.mockResolvedValue(updatedIncident as any);
      prismaService.incidentEvent.create.mockResolvedValue({} as any);

      // Act
      await service.update('incident-1', updateDto);

      // Assert
      expect(prismaService.incidentEvent.create).toHaveBeenCalledWith({
        data: {
          incidentId: 'incident-1',
          eventType: 'STATE_TRANSITION',
          phase: IncidentState.FIXED,
          step: `Transitioned from ${IncidentState.NEW} to ${IncidentState.FIXED}`,
          data: {
            previousState: IncidentState.NEW,
            newState: IncidentState.FIXED,
            reason: 'State transition',
            fixAttempts: 0,
            maxFixAttempts: 15
          }
        }
      });
    });

    it('should log fix attempt increment', async () => {
      // Arrange
      const updateDto: UpdateIncidentDto = {
        fixAttempts: 5
      };

      const updatedIncident = {
        ...mockIncident,
        fixAttempts: 5
      };

      prismaService.incident.findUnique.mockResolvedValue(mockIncident as any);
      prismaService.incident.update.mockResolvedValue(updatedIncident as any);
      prismaService.incidentEvent.create.mockResolvedValue({} as any);

      // Act
      await service.update('incident-1', updateDto);

      // Assert
      expect(prismaService.incidentEvent.create).toHaveBeenCalledWith({
        data: {
          incidentId: 'incident-1',
          eventType: 'FIX_ATTEMPT_INCREMENT',
          phase: IncidentState.NEW,
          step: 'Fix attempt 5 of 15',
          data: {
            previousAttempts: 0,
            newAttempts: 5,
            maxAttempts: 15,
            remainingAttempts: 10
          }
        }
      });
    });

    it('should log max attempts reached when limit is hit', async () => {
      // Arrange
      const updateDto: UpdateIncidentDto = {
        fixAttempts: 15
      };

      const updatedIncident = {
        ...mockIncident,
        fixAttempts: 15
      };

      prismaService.incident.findUnique.mockResolvedValue(mockIncident as any);
      prismaService.incident.update.mockResolvedValue(updatedIncident as any);
      prismaService.incidentEvent.create.mockResolvedValue({} as any);

      // Act
      await service.update('incident-1', updateDto);

      // Assert
      expect(prismaService.incidentEvent.create).toHaveBeenCalledWith({
        data: {
          incidentId: 'incident-1',
          eventType: 'MAX_ATTEMPTS_REACHED',
          phase: IncidentState.NEW,
          step: 'Maximum fix attempts reached - escalation required',
          data: {
            fixAttempts: 15,
            maxFixAttempts: 15,
            escalationRequired: true
          }
        }
      });
    });

    it('should throw NotFoundException when incident does not exist', async () => {
      // Arrange
      const updateDto: UpdateIncidentDto = {
        state: IncidentState.DISCOVERY
      };

      prismaService.incident.findUnique.mockResolvedValue(null);

      // Act & Assert
      await expect(service.update('nonexistent-incident', updateDto)).rejects.toThrow(
        new NotFoundException('Incident with ID nonexistent-incident not found')
      );
    });
  });

  describe('escalateIncident', () => {
    it('should escalate incident and generate ticket payload', async () => {
      // Arrange
      const reason = 'Maximum fix attempts reached';
      
      prismaService.incident.findUnique.mockResolvedValue(mockIncident as any);
      prismaService.incident.update.mockResolvedValue({
        ...mockIncident,
        state: IncidentState.ESCALATED,
        escalatedAt: new Date(),
        escalationReason: reason
      } as any);
      prismaService.incidentEvent.create.mockResolvedValue({} as any);

      // Act
      const result = await service.escalateIncident('incident-1', reason);

      // Assert
      expect(result).toEqual({
        incidentId: 'incident-1',
        title: 'WordPress Site Issue - example.com',
        description: expect.stringContaining('WordPress site example.com requires manual intervention'),
        priority: Priority.MEDIUM,
        reason,
        tags: ['wordpress', 'autohealer', 'automatic', 'medium', 'cpanel'],
        metadata: {
          siteId: 'site-1',
          serverId: 'server-1',
          domain: 'example.com',
          hostname: 'web1.example.com',
          fixAttempts: 0,
          maxFixAttempts: 15,
          incidentDuration: expect.any(Number),
          escalationTime: expect.any(String)
        }
      });
    });

    it('should throw NotFoundException when incident does not exist', async () => {
      // Arrange
      prismaService.incident.findUnique.mockResolvedValue(null);

      // Act & Assert
      await expect(service.escalateIncident('nonexistent-incident', 'reason')).rejects.toThrow(
        new NotFoundException('Incident with ID nonexistent-incident not found')
      );
    });
  });

  describe('createEvent', () => {
    it('should create incident event successfully', async () => {
      // Arrange
      const createEventDto = {
        incidentId: 'incident-1',
        eventType: 'TEST_EVENT',
        phase: IncidentState.NEW,
        step: 'Test step',
        data: { test: 'data' },
        duration: 1000
      };

      const mockEvent = {
        id: 'event-1',
        ...createEventDto,
        timestamp: new Date()
      };

      prismaService.incident.findUnique.mockResolvedValue(mockIncident as any);
      prismaService.incidentEvent.create.mockResolvedValue(mockEvent as any);

      // Act
      const result = await service.createEvent(createEventDto);

      // Assert
      expect(result).toEqual(mockEvent);
      expect(prismaService.incidentEvent.create).toHaveBeenCalledWith({
        data: {
          incidentId: 'incident-1',
          eventType: 'TEST_EVENT',
          phase: IncidentState.NEW,
          step: 'Test step',
          data: { test: 'data' },
          duration: 1000
        }
      });
    });

    it('should throw NotFoundException when incident does not exist', async () => {
      // Arrange
      const createEventDto = {
        incidentId: 'nonexistent-incident',
        eventType: 'TEST_EVENT',
        phase: IncidentState.NEW,
        step: 'Test step'
      };

      prismaService.incident.findUnique.mockResolvedValue(null);

      // Act & Assert
      await expect(service.createEvent(createEventDto)).rejects.toThrow(
        new NotFoundException('Incident with ID nonexistent-incident not found')
      );
    });
  });

  describe('getStatistics', () => {
    it('should return incident statistics', async () => {
      // Arrange
      const mockIncidents = [
        {
          fixAttempts: 3,
          createdAt: new Date('2024-01-15T10:00:00Z'),
          resolvedAt: new Date('2024-01-15T10:30:00Z'),
          state: IncidentState.FIXED,
          priority: Priority.MEDIUM
        },
        {
          fixAttempts: 1,
          createdAt: new Date('2024-01-15T11:00:00Z'),
          resolvedAt: new Date('2024-01-15T11:15:00Z'),
          state: IncidentState.FIXED,
          priority: Priority.LOW
        }
      ];

      const mockStateStats = [
        { state: IncidentState.FIXED, _count: { state: 2 } }
      ];

      const mockPriorityStats = [
        { priority: Priority.MEDIUM, _count: { priority: 1 } },
        { priority: Priority.LOW, _count: { priority: 1 } }
      ];

      prismaService.incident.findMany.mockResolvedValue(mockIncidents as any);
      prismaService.incident.groupBy
        .mockResolvedValueOnce(mockStateStats as any)
        .mockResolvedValueOnce(mockPriorityStats as any);

      // Act
      const result = await service.getStatistics();

      // Assert
      expect(result).toEqual({
        total: 2,
        byState: { [IncidentState.FIXED]: 2 },
        byPriority: { [Priority.MEDIUM]: 1, [Priority.LOW]: 1 },
        averageFixAttempts: 2, // (3 + 1) / 2
        averageResolutionTime: 1800000 // Average of 30 min and 15 min in milliseconds
      });
    });

    it('should handle empty statistics gracefully', async () => {
      // Arrange
      prismaService.incident.findMany.mockResolvedValue([]);
      prismaService.incident.groupBy
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      // Act
      const result = await service.getStatistics();

      // Assert
      expect(result).toEqual({
        total: 0,
        byState: {},
        byPriority: {},
        averageFixAttempts: 0,
        averageResolutionTime: 0
      });
    });
  });

  describe('remove', () => {
    it('should delete incident successfully', async () => {
      // Arrange
      prismaService.incident.findUnique.mockResolvedValue(mockIncident as any);
      prismaService.incidentEvent.create.mockResolvedValue({} as any);
      prismaService.incident.delete.mockResolvedValue(mockIncident as any);

      // Act
      await service.remove('incident-1');

      // Assert
      expect(prismaService.incidentEvent.create).toHaveBeenCalledWith({
        data: {
          incidentId: 'incident-1',
          eventType: 'INCIDENT_DELETED',
          phase: IncidentState.NEW,
          step: 'Incident marked for deletion',
          data: {
            deletedAt: expect.any(String),
            finalState: IncidentState.NEW,
            fixAttempts: 0
          }
        }
      });
      expect(prismaService.incident.delete).toHaveBeenCalledWith({
        where: { id: 'incident-1' }
      });
    });

    it('should throw NotFoundException when incident does not exist', async () => {
      // Arrange
      prismaService.incident.findUnique.mockResolvedValue(null);

      // Act & Assert
      await expect(service.remove('nonexistent-incident')).rejects.toThrow(
        new NotFoundException('Incident with ID nonexistent-incident not found')
      );
    });
  });
});