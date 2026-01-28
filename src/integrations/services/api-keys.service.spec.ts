import { Test, TestingModule } from '@nestjs/testing';
import { ApiKeysService } from './api-keys.service';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { EncryptionService } from '../../common/services/encryption.service';

describe('ApiKeysService', () => {
  let service: ApiKeysService;

  beforeEach(async () => {
    const mockPrismaService = {
      apiKey: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        count: jest.fn(),
      },
    };

    const mockAuditService = {
      createAuditEvent: jest.fn().mockResolvedValue(undefined),
    };

    const mockEncryptionService = {
      hash: jest.fn().mockResolvedValue('hashed-value'),
      verifyHash: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApiKeysService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: AuditService, useValue: mockAuditService },
        { provide: EncryptionService, useValue: mockEncryptionService },
      ],
    }).compile();

    service = module.get<ApiKeysService>(ApiKeysService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should have all required methods', () => {
    expect(service.generateApiKey).toBeDefined();
    expect(service.validateApiKey).toBeDefined();
    expect(service.listApiKeys).toBeDefined();
    expect(service.updateApiKey).toBeDefined();
    expect(service.revokeApiKey).toBeDefined();
    expect(service.hasPermission).toBeDefined();
    expect(service.getAvailablePermissions).toBeDefined();
    expect(service.getApiKeyStats).toBeDefined();
  });
});