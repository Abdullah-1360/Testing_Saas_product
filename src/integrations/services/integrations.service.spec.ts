import { Test, TestingModule } from '@nestjs/testing';
import { IntegrationsService } from './integrations.service';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { EncryptionService } from '../../common/services/encryption.service';

describe('IntegrationsService', () => {
  let service: IntegrationsService;

  beforeEach(async () => {
    const mockPrismaService = {
      integration: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      webhookEndpoint: {
        create: jest.fn(),
      },
    };

    const mockAuditService = {
      createAuditEvent: jest.fn().mockResolvedValue(undefined),
    };

    const mockEncryptionService = {
      encrypt: jest.fn().mockResolvedValue('encrypted-value'),
      decrypt: jest.fn().mockResolvedValue('decrypted-value'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IntegrationsService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: AuditService, useValue: mockAuditService },
        { provide: EncryptionService, useValue: mockEncryptionService },
      ],
    }).compile();

    service = module.get<IntegrationsService>(IntegrationsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should have all required methods', () => {
    expect(service.createIntegration).toBeDefined();
    expect(service.updateIntegration).toBeDefined();
    expect(service.deleteIntegration).toBeDefined();
    expect(service.getIntegration).toBeDefined();
    expect(service.listIntegrations).toBeDefined();
    expect(service.testIntegration).toBeDefined();
    expect(service.getIntegrationStats).toBeDefined();
  });
});