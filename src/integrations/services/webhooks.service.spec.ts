import { Test, TestingModule } from '@nestjs/testing';
import { WebhooksService } from './webhooks.service';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../../audit/audit.service';

describe('WebhooksService', () => {
  let service: WebhooksService;

  beforeEach(async () => {
    const mockPrismaService = {
      webhookEndpoint: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      webhookDelivery: {
        create: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
    };

    const mockAuditService = {
      createAuditEvent: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhooksService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();

    service = module.get<WebhooksService>(WebhooksService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should have all required methods', () => {
    expect(service.sendWebhook).toBeDefined();
    expect(service.validateWebhookSignature).toBeDefined();
    expect(service.retryFailedWebhooks).toBeDefined();
    expect(service.broadcastEvent).toBeDefined();
  });
});