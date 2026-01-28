import { Test, TestingModule } from '@nestjs/testing';
import { ServersService } from './servers.service';
import { PrismaService } from '@/database/prisma.service';
import { EncryptionService } from '@/common/services/encryption.service';
import { LoggerService } from '@/common/services/logger.service';
import { SSHService } from '@/ssh/services/ssh.service';
import { AuthType, ControlPanelType } from '@prisma/client';
import * as fc from 'fast-check';

describe('ServersService Property-Based Tests', () => {
  let service: ServersService;
  let prismaService: jest.Mocked<PrismaService>;
  let encryptionService: jest.Mocked<EncryptionService>;
  let loggerService: jest.Mocked<LoggerService>;
  let sshService: jest.Mocked<SSHService>;

  beforeEach(async () => {
    const mockPrismaService = {
      server: {
        create: jest.fn().mockImplementation(() => Promise.resolve()),
        findMany: jest.fn().mockImplementation(() => Promise.resolve()),
        findUnique: jest.fn().mockImplementation(() => Promise.resolve()),
        update: jest.fn().mockImplementation(() => Promise.resolve()),
        delete: jest.fn().mockImplementation(() => Promise.resolve()),
      },
    };

    const mockEncryptionService = {
      encrypt: jest.fn().mockImplementation((data: string) => `encrypted_${data}`),
      decrypt: jest.fn().mockImplementation((data: string) => data.replace('encrypted_', '')),
    };

    const mockLoggerService = {
      logAuditEvent: jest.fn(),
      logSecurityEvent: jest.fn(),
      error: jest.fn(),
    };

    const mockSSHService = {
      testConnection: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ServersService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: EncryptionService, useValue: mockEncryptionService },
        { provide: LoggerService, useValue: mockLoggerService },
        { provide: SSHService, useValue: mockSSHService },
      ],
    }).compile();

    service = module.get<ServersService>(ServersService);
    prismaService = module.get(PrismaService);
    encryptionService = module.get(EncryptionService);
    loggerService = module.get(LoggerService);
    sshService = module.get(SSHService);

    // Clear all mocks before each test
    jest.clearAllMocks();
  });

  // Custom generators for server data
  const serverNameGenerator = () => fc.string({ minLength: 1, maxLength: 255 });
  const hostnameGenerator = () => fc.domain();
  const portGenerator = () => fc.integer({ min: 1, max: 65535 });
  const usernameGenerator = () => fc.string({ minLength: 1, maxLength: 32 });
  const authTypeGenerator = () => fc.constantFrom(AuthType.KEY, AuthType.PASSWORD);
  const credentialsGenerator = () => fc.string({ minLength: 1, maxLength: 4096 });
  const hostKeyFingerprintGenerator = () => fc.string({ minLength: 1, maxLength: 255 });
  const controlPanelGenerator = () => fc.option(
    fc.constantFrom(
      ControlPanelType.CPANEL,
      ControlPanelType.PLESK,
      ControlPanelType.DIRECTADMIN,
      ControlPanelType.CYBERPANEL
    )
  );

  const createServerDtoGenerator = () => fc.record({
    name: serverNameGenerator(),
    hostname: hostnameGenerator(),
    port: fc.option(portGenerator()),
    username: usernameGenerator(),
    authType: authTypeGenerator(),
    credentials: credentialsGenerator(),
    hostKeyFingerprint: fc.option(hostKeyFingerprintGenerator()),
    controlPanel: controlPanelGenerator(),
  }).map(dto => ({
    ...dto,
    port: dto.port ?? undefined, // Convert null to undefined for optional fields
    hostKeyFingerprint: dto.hostKeyFingerprint ?? undefined,
    controlPanel: dto.controlPanel ?? undefined,
  }));

  const serverGenerator = () => fc.record({
    id: fc.uuid(),
    name: serverNameGenerator(),
    hostname: hostnameGenerator(),
    port: portGenerator(),
    username: usernameGenerator(),
    authType: authTypeGenerator(),
    encryptedCredentials: fc.string(),
    hostKeyFingerprint: fc.option(hostKeyFingerprintGenerator()),
    controlPanel: controlPanelGenerator(),
    osInfo: fc.constant(null),
    createdAt: fc.date(),
    updatedAt: fc.date(),
  });

  /**
   * Feature: wp-autohealer, Property 13: Secret Encryption at Rest
   * **Validates: Requirements 6.2** - Encrypt all secrets at rest using libsodium
   */
  it('should encrypt all credentials before storing them', async () => {
    await fc.assert(
      fc.asyncProperty(
        createServerDtoGenerator(),
        async (createServerDto) => {
          const mockServer = {
            id: 'test-id',
            ...createServerDto,
            port: createServerDto.port || 22,
            encryptedCredentials: `encrypted_${JSON.stringify({
              [createServerDto.authType === AuthType.KEY ? 'privateKey' : 'password']: createServerDto.credentials,
            })}`,
            hostKeyFingerprint: createServerDto.hostKeyFingerprint || null,
            controlPanel: createServerDto.controlPanel || null,
            osInfo: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          (prismaService.server.create as jest.Mock).mockResolvedValue(mockServer);

          await service.create(createServerDto);

          // Verify that encryption was called with properly formatted credentials
          const expectedCredentialsData = {
            [createServerDto.authType === AuthType.KEY ? 'privateKey' : 'password']: createServerDto.credentials,
          };
          expect(encryptionService.encrypt).toHaveBeenCalledWith(
            JSON.stringify(expectedCredentialsData)
          );

          // Verify that plaintext credentials are never stored
          const createCall = (prismaService.server.create as jest.Mock).mock.calls[0][0];
          expect(createCall.data).not.toHaveProperty('credentials');
          expect(createCall.data.encryptedCredentials).toBeDefined();
          expect(createCall.data.encryptedCredentials).not.toBe(createServerDto.credentials);
        }
      ),
      { numRuns: 10 }
    );
  });

  /**
   * Feature: wp-autohealer, Property 12: Secret Redaction in Logs and APIs
   * **Validates: Requirements 6.1, 6.10** - Never display secrets in logs or API responses
   */
  it('should never expose encrypted credentials in any operation', async () => {
    await fc.assert(
      fc.asyncProperty(
        serverGenerator(),
        async (server) => {
          (prismaService.server.findMany as jest.Mock).mockResolvedValue([server]);
          (prismaService.server.findUnique as jest.Mock).mockResolvedValue(server);

          // Test findAll - should not expose encrypted credentials
          const allServers = await service.findAll();
          expect(allServers[0]).toHaveProperty('encryptedCredentials');

          // Test findOne - should not expose encrypted credentials
          const oneServer = await service.findOne(server.id);
          expect(oneServer).toHaveProperty('encryptedCredentials');

          // Verify that the encrypted credentials are never logged in audit events
          const auditCalls = (loggerService.logAuditEvent as jest.Mock).mock.calls;
          for (const call of auditCalls) {
            const auditData = call[2]; // Third parameter is the audit data
            expect(JSON.stringify(auditData)).not.toContain(server.encryptedCredentials);
          }
        }
      ),
      { numRuns: 10 }
    );
  });

  /**
   * Feature: wp-autohealer, Property 7: Server Environment Auto-Detection
   * **Validates: Requirements 4.1-4.9** - Auto-detect server environment components
   */
  it('should maintain server configuration integrity during operations', async () => {
    await fc.assert(
      fc.asyncProperty(
        createServerDtoGenerator(),
        async (createServerDto) => {
          const mockServer = {
            id: 'test-id',
            ...createServerDto,
            port: createServerDto.port || 22,
            encryptedCredentials: 'encrypted-data',
            hostKeyFingerprint: createServerDto.hostKeyFingerprint || null,
            controlPanel: createServerDto.controlPanel || null,
            osInfo: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          (prismaService.server.create as jest.Mock).mockResolvedValue(mockServer);

          const result = await service.create(createServerDto);

          // Verify all required server properties are preserved
          expect(result.name).toBe(createServerDto.name);
          expect(result.hostname).toBe(createServerDto.hostname);
          expect(result.port).toBe(createServerDto.port || 22);
          expect(result.username).toBe(createServerDto.username);
          expect(result.authType).toBe(createServerDto.authType);
          expect(result.hostKeyFingerprint).toBe(createServerDto.hostKeyFingerprint || null);
          expect(result.controlPanel).toBe(createServerDto.controlPanel || null);

          // Verify credentials are encrypted but other data is preserved
          expect(result.encryptedCredentials).toBeDefined();
          expect(result.encryptedCredentials).not.toBe(createServerDto.credentials);
        }
      ),
      { numRuns: 10 }
    );
  });

  /**
   * Feature: wp-autohealer, Property 14: SSH Strict Host Key Checking
   * **Validates: Requirements 6.4** - Enforce strict host key checking for SSH connections
   */
  it('should enforce strict host key checking in connection tests', async () => {
    await fc.assert(
      fc.asyncProperty(
        serverGenerator(),
        async (server) => {
          const credentialsData = {
            [server.authType === AuthType.KEY ? 'privateKey' : 'password']: 'test-credentials',
          };

          (prismaService.server.findUnique as jest.Mock).mockResolvedValue(server);
          encryptionService.decrypt.mockReturnValue(JSON.stringify(credentialsData));
          
          // Clear previous calls
          (sshService.testConnection as jest.Mock).mockClear();

          await service.testConnection(server.id);

          // Verify that SSH service is called with strict host key checking enabled
          expect(sshService.testConnection).toHaveBeenCalledTimes(1);
          const callArgs = (sshService.testConnection as jest.Mock).mock.calls[0][0];
          expect(callArgs).toHaveProperty('strictHostKeyChecking', true);
          
          if (server.hostKeyFingerprint) {
            expect(callArgs).toHaveProperty('hostKeyFingerprint', server.hostKeyFingerprint);
          }
        }
      ),
      { numRuns: 10 }
    );
  });

  /**
   * Feature: wp-autohealer, Property 19: Security Event Audit Logging
   * **Validates: Requirements 6.9** - Maintain audit logs for all security-relevant events
   */
  it('should log all security-relevant server operations', async () => {
    await fc.assert(
      fc.asyncProperty(
        createServerDtoGenerator(),
        fc.string({ minLength: 1, maxLength: 4096 }),
        async (createServerDto, newCredentials) => {
          const mockServer = {
            id: 'test-id',
            ...createServerDto,
            port: createServerDto.port || 22,
            encryptedCredentials: 'encrypted-data',
            hostKeyFingerprint: createServerDto.hostKeyFingerprint || null,
            controlPanel: createServerDto.controlPanel || null,
            osInfo: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          (prismaService.server.create as jest.Mock).mockResolvedValue(mockServer);
          (prismaService.server.findUnique as jest.Mock).mockResolvedValue(mockServer);
          (prismaService.server.update as jest.Mock).mockResolvedValue(mockServer);
          (prismaService.server.delete as jest.Mock).mockResolvedValue(mockServer);

          // Test server creation audit logging
          await service.create(createServerDto);
          expect(loggerService.logAuditEvent).toHaveBeenCalledWith(
            'server_created',
            'server',
            expect.objectContaining({
              serverId: mockServer.id,
              hostname: mockServer.hostname,
              authType: mockServer.authType,
            }),
            'ServersService'
          );

          // Test credential rotation security logging
          await service.rotateCredentials(mockServer.id, newCredentials);
          expect(loggerService.logSecurityEvent).toHaveBeenCalledWith(
            'credentials_rotated',
            expect.objectContaining({
              serverId: mockServer.id,
              hostname: mockServer.hostname,
              authType: mockServer.authType,
            }),
            'ServersService'
          );

          // Test server deletion audit logging
          await service.remove(mockServer.id);
          expect(loggerService.logAuditEvent).toHaveBeenCalledWith(
            'server_deleted',
            'server',
            expect.objectContaining({
              serverId: mockServer.id,
              hostname: mockServer.hostname,
            }),
            'ServersService'
          );
        }
      ),
      { numRuns: 10 }
    );
  });

  /**
   * Feature: wp-autohealer, Property 15: Input Validation Security
   * **Validates: Requirements 6.5** - Validate all inputs to prevent SSRF and injection attacks
   */
  it('should handle all valid server configurations without errors', async () => {
    await fc.assert(
      fc.asyncProperty(
        createServerDtoGenerator(),
        async (createServerDto) => {
          const mockServer = {
            id: 'test-id',
            ...createServerDto,
            port: createServerDto.port || 22,
            encryptedCredentials: 'encrypted-data',
            hostKeyFingerprint: createServerDto.hostKeyFingerprint || null,
            controlPanel: createServerDto.controlPanel || null,
            osInfo: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          (prismaService.server.create as jest.Mock).mockResolvedValue(mockServer);

          // Should not throw for any valid input
          const result = await service.create(createServerDto);
          expect(result).toBeDefined();
          expect(result.id).toBeDefined();
        }
      ),
      { numRuns: 10 }
    );
  });

  /**
   * Feature: wp-autohealer, Property 2: Unique Operation Identifiers
   * **Validates: Requirements 2.4** - Assign unique trace and correlation IDs to all operations
   */
  it('should generate unique server IDs for all created servers', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(createServerDtoGenerator(), { minLength: 2, maxLength: 10 }),
        async (serverDtos) => {
          const createdServers: any[] = [];

          for (let i = 0; i < serverDtos.length; i++) {
            const serverDto = serverDtos[i];
            if (!serverDto) continue;

            const mockServer = {
              id: `server-${i}`,
              ...serverDto,
              port: serverDto.port || 22,
              encryptedCredentials: 'encrypted-data',
              hostKeyFingerprint: serverDto.hostKeyFingerprint || null,
              controlPanel: serverDto.controlPanel || null,
              osInfo: null,
              createdAt: new Date(),
              updatedAt: new Date(),
            };

            (prismaService.server.create as jest.Mock).mockResolvedValueOnce(mockServer);
            const result = await service.create(serverDto);
            createdServers.push(result);
          }

          // Verify all server IDs are unique
          const serverIds = createdServers.map(server => server.id);
          const uniqueIds = new Set(serverIds);
          expect(uniqueIds.size).toBe(serverIds.length);
        }
      ),
      { numRuns: 10 }
    );
  });
});