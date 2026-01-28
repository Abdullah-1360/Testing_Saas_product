import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ServersService } from './servers.service';
import { PrismaService } from '@/database/prisma.service';
import { EncryptionService } from '@/common/services/encryption.service';
import { LoggerService } from '@/common/services/logger.service';
import { SSHService } from '@/ssh/services/ssh.service';
import { AuthType, ControlPanelType } from '@prisma/client';
import { CreateServerDto } from './dto/create-server.dto';
import { UpdateServerDto } from './dto/update-server.dto';

// Mock the entire modules to avoid import issues
jest.mock('@/database/prisma.service');
jest.mock('@/common/services/encryption.service');
jest.mock('@/common/services/logger.service');
jest.mock('@/ssh/services/ssh.service');

describe('ServersService', () => {
  let service: ServersService;
  let prismaService: jest.Mocked<PrismaService>;
  let encryptionService: jest.Mocked<EncryptionService>;
  let loggerService: jest.Mocked<LoggerService>;
  let sshService: jest.Mocked<SSHService>;

  const mockServer = {
    id: 'server-1',
    name: 'Test Server',
    hostname: 'test.example.com',
    port: 22,
    username: 'testuser',
    authType: AuthType.KEY,
    encryptedCredentials: 'encrypted-credentials',
    hostKeyFingerprint: 'test-fingerprint',
    controlPanel: ControlPanelType.CPANEL,
    osInfo: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const mockPrismaService = {
      server: {
        create: jest.fn().mockImplementation(() => Promise.resolve()),
        findMany: jest.fn().mockImplementation(() => Promise.resolve()),
        findUnique: jest.fn().mockImplementation(() => Promise.resolve()),
        update: jest.fn().mockImplementation(() => Promise.resolve()),
        delete: jest.fn().mockImplementation(() => Promise.resolve()),
      },
    } as any;

    const mockEncryptionService = {
      encrypt: jest.fn(),
      decrypt: jest.fn(),
    } as any;

    const mockLoggerService = {
      logAuditEvent: jest.fn(),
      logSecurityEvent: jest.fn(),
      error: jest.fn(),
    } as any;

    const mockSSHService = {
      testConnection: jest.fn(),
    } as any;

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
    prismaService = module.get(PrismaService) as any;
    encryptionService = module.get(EncryptionService) as any;
    loggerService = module.get(LoggerService) as any;
    sshService = module.get(SSHService) as any;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create a server with encrypted credentials', async () => {
      const createServerDto: CreateServerDto = {
        name: 'Test Server',
        hostname: 'test.example.com',
        username: 'testuser',
        authType: AuthType.KEY,
        credentials: 'private-key-content',
        hostKeyFingerprint: 'test-fingerprint',
      };

      encryptionService.encrypt.mockReturnValue('encrypted-credentials');
      (prismaService.server.create as jest.Mock).mockResolvedValue(mockServer);

      const result = await service.create(createServerDto);

      expect(encryptionService.encrypt).toHaveBeenCalledWith(
        JSON.stringify({ privateKey: 'private-key-content' })
      );
      expect(prismaService.server.create).toHaveBeenCalledWith({
        data: {
          name: 'Test Server',
          hostname: 'test.example.com',
          port: 22,
          username: 'testuser',
          authType: AuthType.KEY,
          encryptedCredentials: 'encrypted-credentials',
          hostKeyFingerprint: 'test-fingerprint',
          controlPanel: null,
        },
      });
      expect(loggerService.logAuditEvent).toHaveBeenCalledWith(
        'server_created',
        'server',
        {
          serverId: mockServer.id,
          hostname: mockServer.hostname,
          authType: mockServer.authType,
        },
        'ServersService'
      );
      expect(result).toEqual(mockServer);
    });

    it('should create a server with password authentication', async () => {
      const createServerDto: CreateServerDto = {
        name: 'Test Server',
        hostname: 'test.example.com',
        username: 'testuser',
        authType: AuthType.PASSWORD,
        credentials: 'password123',
      };

      encryptionService.encrypt.mockReturnValue('encrypted-credentials');
      (prismaService.server.create as jest.Mock).mockResolvedValue({
        ...mockServer,
        authType: AuthType.PASSWORD,
      });

      await service.create(createServerDto);

      expect(encryptionService.encrypt).toHaveBeenCalledWith(
        JSON.stringify({ password: 'password123' })
      );
    });

    it('should throw BadRequestException on creation failure', async () => {
      const createServerDto: CreateServerDto = {
        name: 'Test Server',
        hostname: 'test.example.com',
        username: 'testuser',
        authType: AuthType.KEY,
        credentials: 'private-key-content',
      };

      encryptionService.encrypt.mockReturnValue('encrypted-credentials');
      (prismaService.server.create as jest.Mock).mockRejectedValue(new Error('Database error'));

      await expect(service.create(createServerDto)).rejects.toThrow(BadRequestException);
      expect(loggerService.error).toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('should return all servers', async () => {
      const servers = [mockServer];
      (prismaService.server.findMany as jest.Mock).mockResolvedValue(servers);

      const result = await service.findAll();

      expect(prismaService.server.findMany).toHaveBeenCalledWith({
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toEqual(servers);
    });
  });

  describe('findOne', () => {
    it('should return a server by ID', async () => {
      (prismaService.server.findUnique as jest.Mock).mockResolvedValue(mockServer);

      const result = await service.findOne('server-1');

      expect(prismaService.server.findUnique).toHaveBeenCalledWith({
        where: { id: 'server-1' },
      });
      expect(result).toEqual(mockServer);
    });

    it('should throw NotFoundException if server not found', async () => {
      (prismaService.server.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.findOne('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findOneWithCredentials', () => {
    it('should return server with decrypted credentials', async () => {
      const credentialsData = { privateKey: 'decrypted-private-key' };
      
      (prismaService.server.findUnique as jest.Mock).mockResolvedValue(mockServer);
      encryptionService.decrypt.mockReturnValue(JSON.stringify(credentialsData));

      const result = await service.findOneWithCredentials('server-1');

      expect(encryptionService.decrypt).toHaveBeenCalledWith('encrypted-credentials');
      expect(loggerService.logSecurityEvent).toHaveBeenCalledWith(
        'credentials_decrypted',
        {
          serverId: mockServer.id,
          hostname: mockServer.hostname,
          purpose: 'ssh_operation',
        },
        'ServersService'
      );
      expect(result).toEqual({
        ...mockServer,
        credentials: JSON.stringify(credentialsData),
      });
    });

    it('should throw BadRequestException on decryption failure', async () => {
      (prismaService.server.findUnique as jest.Mock).mockResolvedValue(mockServer);
      encryptionService.decrypt.mockImplementation(() => {
        throw new Error('Decryption failed');
      });

      await expect(service.findOneWithCredentials('server-1')).rejects.toThrow(BadRequestException);
      expect(loggerService.error).toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('should update server without credentials', async () => {
      const updateServerDto: UpdateServerDto = {
        name: 'Updated Server',
        hostname: 'updated.example.com',
      };

      (prismaService.server.findUnique as jest.Mock).mockResolvedValue(mockServer);
      (prismaService.server.update as jest.Mock).mockResolvedValue({
        ...mockServer,
        ...updateServerDto,
      });

      const result = await service.update('server-1', updateServerDto);

      expect(prismaService.server.update).toHaveBeenCalledWith({
        where: { id: 'server-1' },
        data: updateServerDto,
      });
      expect(result.name).toBe('Updated Server');
    });

    it('should update server with new credentials', async () => {
      const updateServerDto: UpdateServerDto = {
        name: 'Updated Server',
        credentials: 'new-private-key',
        authType: AuthType.KEY,
      };

      (prismaService.server.findUnique as jest.Mock).mockResolvedValue(mockServer);
      encryptionService.encrypt.mockReturnValue('new-encrypted-credentials');
      (prismaService.server.update as jest.Mock).mockResolvedValue({
        ...mockServer,
        name: 'Updated Server',
      });

      await service.update('server-1', updateServerDto);

      expect(encryptionService.encrypt).toHaveBeenCalledWith(
        JSON.stringify({ privateKey: 'new-private-key' })
      );
      expect(prismaService.server.update).toHaveBeenCalledWith({
        where: { id: 'server-1' },
        data: {
          name: 'Updated Server',
          authType: AuthType.KEY,
          encryptedCredentials: 'new-encrypted-credentials',
        },
      });
    });
  });

  describe('remove', () => {
    it('should delete a server', async () => {
      (prismaService.server.findUnique as jest.Mock).mockResolvedValue(mockServer);
      (prismaService.server.delete as jest.Mock).mockResolvedValue(mockServer);

      await service.remove('server-1');

      expect(prismaService.server.delete).toHaveBeenCalledWith({
        where: { id: 'server-1' },
      });
      expect(loggerService.logAuditEvent).toHaveBeenCalledWith(
        'server_deleted',
        'server',
        {
          serverId: mockServer.id,
          hostname: mockServer.hostname,
        },
        'ServersService'
      );
    });
  });

  describe('testConnection', () => {
    it('should test connection successfully', async () => {
      (prismaService.server.findUnique as jest.Mock).mockResolvedValue(mockServer);
      encryptionService.decrypt.mockReturnValue(JSON.stringify({ privateKey: 'test-key' }));
      sshService.testConnection.mockResolvedValue(true);

      const result = await service.testConnection('server-1');

      expect(sshService.testConnection).toHaveBeenCalledWith({
        hostname: 'test.example.com',
        port: 22,
        username: 'testuser',
        authType: 'key',
        strictHostKeyChecking: true,
        hostKeyFingerprint: 'test-fingerprint',
        connectionTimeout: 30000,
        privateKey: 'test-key',
      });
      expect(result).toEqual({
        success: true,
        message: 'Connection test successful',
      });
    });

    it('should handle connection test failure', async () => {
      (prismaService.server.findUnique as jest.Mock).mockResolvedValue(mockServer);
      encryptionService.decrypt.mockReturnValue(JSON.stringify({ privateKey: 'test-key' }));
      sshService.testConnection.mockResolvedValue(false);

      const result = await service.testConnection('server-1');

      expect(result).toEqual({
        success: false,
        message: 'Connection test failed',
      });
    });
  });

  describe('rotateCredentials', () => {
    it('should rotate server credentials', async () => {
      (prismaService.server.findUnique as jest.Mock).mockResolvedValue(mockServer);
      encryptionService.encrypt.mockReturnValue('new-encrypted-credentials');
      (prismaService.server.update as jest.Mock).mockResolvedValue(mockServer);

      await service.rotateCredentials('server-1', 'new-private-key');

      expect(encryptionService.encrypt).toHaveBeenCalledWith(
        JSON.stringify({ privateKey: 'new-private-key' })
      );
      expect(prismaService.server.update).toHaveBeenCalledWith({
        where: { id: 'server-1' },
        data: {
          encryptedCredentials: 'new-encrypted-credentials',
          updatedAt: expect.any(Date),
        },
      });
      expect(loggerService.logSecurityEvent).toHaveBeenCalledWith(
        'credentials_rotated',
        {
          serverId: mockServer.id,
          hostname: mockServer.hostname,
          authType: mockServer.authType,
        },
        'ServersService'
      );
    });
  });

  describe('getStats', () => {
    it('should return server statistics', async () => {
      const servers = [
        { ...mockServer, authType: AuthType.KEY, controlPanel: ControlPanelType.CPANEL },
        { ...mockServer, id: 'server-2', authType: AuthType.PASSWORD, controlPanel: null },
      ];

      (prismaService.server.findMany as jest.Mock).mockResolvedValue(servers);

      const result = await service.getStats();

      expect(result).toEqual({
        total: 2,
        byAuthType: {
          [AuthType.KEY]: 1,
          [AuthType.PASSWORD]: 1,
        },
        byControlPanel: {
          [ControlPanelType.CPANEL]: 1,
          none: 1,
        },
      });
    });
  });

  describe('validateHostKey', () => {
    it('should validate host key successfully', async () => {
      (prismaService.server.findUnique as jest.Mock).mockResolvedValue(mockServer);
      encryptionService.decrypt.mockReturnValue(JSON.stringify({ privateKey: 'test-key' }));
      sshService.testConnection.mockResolvedValue(true);

      const result = await service.validateHostKey('server-1');

      expect(result).toEqual({
        valid: true,
        fingerprint: 'test-fingerprint',
        message: 'Host key validation successful',
      });
    });

    it('should handle missing host key fingerprint', async () => {
      const serverWithoutFingerprint = { ...mockServer, hostKeyFingerprint: null };
      (prismaService.server.findUnique as jest.Mock).mockResolvedValue(serverWithoutFingerprint);

      const result = await service.validateHostKey('server-1');

      expect(result).toEqual({
        valid: false,
        message: 'No host key fingerprint configured for this server',
      });
    });

    it('should handle host key validation failure', async () => {
      (prismaService.server.findUnique as jest.Mock).mockResolvedValue(mockServer);
      encryptionService.decrypt.mockReturnValue(JSON.stringify({ privateKey: 'test-key' }));
      sshService.testConnection.mockResolvedValue(false);

      const result = await service.validateHostKey('server-1');

      expect(result).toEqual({
        valid: false,
        fingerprint: 'test-fingerprint',
        message: 'Host key validation failed - connection rejected',
      });
    });
  });
});