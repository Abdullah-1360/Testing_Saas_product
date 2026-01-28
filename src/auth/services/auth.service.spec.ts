import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException, BadRequestException, ConflictException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { UsersService } from '@/users/users.service';
import { MfaService } from './mfa.service';
import { PrismaService } from '@/database/prisma.service';
import { User } from '@/users/entities/user.entity';

describe('AuthService', () => {
  let service: AuthService;
  let usersService: jest.Mocked<UsersService>;
  let jwtService: jest.Mocked<JwtService>;
  let mfaService: jest.Mocked<MfaService>;
  let prismaService: jest.Mocked<PrismaService>;

  const mockUser = new User({
    id: 'user-1',
    email: 'test@example.com',
    passwordHash: 'hashed-password',
    role: 'ENGINEER',
    mfaEnabled: false,
    mfaSecret: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastLoginAt: null,
  });

  const mockUserWithMfa = new User({
    id: 'user-2',
    email: 'mfa@example.com',
    passwordHash: 'hashed-password',
    role: 'ENGINEER',
    mfaEnabled: true,
    mfaSecret: 'mfa-secret',
    createdAt: new Date(),
    updatedAt: new Date(),
    lastLoginAt: null,
  });

  beforeEach(async () => {
    const mockUsersService = {
      findByEmail: jest.fn(),
      findOne: jest.fn(),
      validatePassword: jest.fn(),
      updateLastLogin: jest.fn(),
      enableMfa: jest.fn(),
      disableMfa: jest.fn(),
    };

    const mockJwtService = {
      sign: jest.fn(),
    };

    const mockMfaService = {
      verifyToken: jest.fn(),
      generateSecret: jest.fn(),
      generateQRCode: jest.fn(),
      generateBackupCodes: jest.fn(),
    };

    const mockPrismaService = {
      user: {
        update: jest.fn(),
      },
      userSession: {
        create: jest.fn(),
        deleteMany: jest.fn(),
        delete: jest.fn(),
        findUnique: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: UsersService,
          useValue: mockUsersService,
        },
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
        {
          provide: MfaService,
          useValue: mockMfaService,
        },
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    usersService = module.get(UsersService);
    jwtService = module.get(JwtService);
    mfaService = module.get(MfaService);
    prismaService = module.get(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('validateUser', () => {
    it('should return user when credentials are valid', async () => {
      // Arrange
      usersService.findByEmail.mockResolvedValue(mockUser);
      usersService.validatePassword.mockResolvedValue(true);

      // Act
      const result = await service.validateUser('test@example.com', 'password');

      // Assert
      expect(result).toEqual(mockUser);
      expect(usersService.findByEmail).toHaveBeenCalledWith('test@example.com');
      expect(usersService.validatePassword).toHaveBeenCalledWith(mockUser, 'password');
    });

    it('should return null when user does not exist', async () => {
      // Arrange
      usersService.findByEmail.mockResolvedValue(null);

      // Act
      const result = await service.validateUser('nonexistent@example.com', 'password');

      // Assert
      expect(result).toBeNull();
      expect(usersService.validatePassword).not.toHaveBeenCalled();
    });

    it('should return null when password is invalid', async () => {
      // Arrange
      usersService.findByEmail.mockResolvedValue(mockUser);
      usersService.validatePassword.mockResolvedValue(false);

      // Act
      const result = await service.validateUser('test@example.com', 'wrong-password');

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('login', () => {
    it('should login successfully without MFA', async () => {
      // Arrange
      const loginDto = {
        email: 'test@example.com',
        password: 'password',
      };

      usersService.findByEmail.mockResolvedValue(mockUser);
      usersService.validatePassword.mockResolvedValue(true);
      usersService.updateLastLogin.mockResolvedValue(undefined);
      jwtService.sign.mockReturnValue('jwt-token');
      prismaService.userSession.create.mockResolvedValue({} as any);

      // Act
      const result = await service.login(loginDto);

      // Assert
      expect(result).toEqual({
        access_token: 'jwt-token',
        user: mockUser.toSafeObject(),
      });
      expect(usersService.updateLastLogin).toHaveBeenCalledWith(mockUser.id);
      expect(jwtService.sign).toHaveBeenCalledWith({
        sub: mockUser.id,
        email: mockUser.email,
        role: mockUser.role,
      });
      expect(prismaService.userSession.create).toHaveBeenCalled();
    });

    it('should require MFA when enabled and no token provided', async () => {
      // Arrange
      const loginDto = {
        email: 'mfa@example.com',
        password: 'password',
      };

      usersService.findByEmail.mockResolvedValue(mockUserWithMfa);
      usersService.validatePassword.mockResolvedValue(true);

      // Act
      const result = await service.login(loginDto);

      // Assert
      expect(result).toEqual({
        access_token: '',
        user: mockUserWithMfa.toSafeObject(),
        mfaRequired: true,
      });
      expect(usersService.updateLastLogin).not.toHaveBeenCalled();
      expect(jwtService.sign).not.toHaveBeenCalled();
    });

    it('should login successfully with valid MFA token', async () => {
      // Arrange
      const loginDto = {
        email: 'mfa@example.com',
        password: 'password',
        mfaToken: '123456',
      };

      usersService.findByEmail.mockResolvedValue(mockUserWithMfa);
      usersService.validatePassword.mockResolvedValue(true);
      mfaService.verifyToken.mockReturnValue(true);
      usersService.updateLastLogin.mockResolvedValue(undefined);
      jwtService.sign.mockReturnValue('jwt-token');
      prismaService.userSession.create.mockResolvedValue({} as any);

      // Act
      const result = await service.login(loginDto);

      // Assert
      expect(result).toEqual({
        access_token: 'jwt-token',
        user: mockUserWithMfa.toSafeObject(),
      });
      expect(mfaService.verifyToken).toHaveBeenCalledWith('mfa-secret', '123456');
    });

    it('should throw UnauthorizedException for invalid credentials', async () => {
      // Arrange
      const loginDto = {
        email: 'test@example.com',
        password: 'wrong-password',
      };

      usersService.findByEmail.mockResolvedValue(null);

      // Act & Assert
      await expect(service.login(loginDto)).rejects.toThrow(
        new UnauthorizedException('Invalid credentials')
      );
    });

    it('should throw UnauthorizedException for invalid MFA token', async () => {
      // Arrange
      const loginDto = {
        email: 'mfa@example.com',
        password: 'password',
        mfaToken: 'invalid-token',
      };

      usersService.findByEmail.mockResolvedValue(mockUserWithMfa);
      usersService.validatePassword.mockResolvedValue(true);
      mfaService.verifyToken.mockReturnValue(false);

      // Act & Assert
      await expect(service.login(loginDto)).rejects.toThrow(
        new UnauthorizedException('Invalid MFA token')
      );
    });
  });

  describe('logout', () => {
    it('should delete user session', async () => {
      // Arrange
      const userId = 'user-1';
      const sessionToken = 'session-token';
      prismaService.userSession.deleteMany.mockResolvedValue({ count: 1 } as any);

      // Act
      await service.logout(userId, sessionToken);

      // Assert
      expect(prismaService.userSession.deleteMany).toHaveBeenCalledWith({
        where: {
          userId,
          sessionToken,
        },
      });
    });
  });

  describe('logoutAll', () => {
    it('should delete all user sessions', async () => {
      // Arrange
      const userId = 'user-1';
      prismaService.userSession.deleteMany.mockResolvedValue({ count: 3 } as any);

      // Act
      await service.logoutAll(userId);

      // Assert
      expect(prismaService.userSession.deleteMany).toHaveBeenCalledWith({
        where: { userId },
      });
    });
  });

  describe('setupMfa', () => {
    it('should setup MFA for user without existing MFA', async () => {
      // Arrange
      const userId = 'user-1';
      const mockSecret = 'new-mfa-secret';
      const mockQrCode = 'qr-code-url';
      const mockQrCodeDataUrl = 'data:image/png;base64,qrcode';
      const mockBackupCodes = ['code1', 'code2', 'code3'];

      usersService.findOne.mockResolvedValue(mockUser);
      mfaService.generateSecret.mockReturnValue({
        secret: mockSecret,
        qrCode: mockQrCode,
      });
      mfaService.generateQRCode.mockResolvedValue(mockQrCodeDataUrl);
      mfaService.generateBackupCodes.mockReturnValue(mockBackupCodes);
      prismaService.user.update.mockResolvedValue({} as any);

      // Act
      const result = await service.setupMfa(userId);

      // Assert
      expect(result).toEqual({
        secret: mockSecret,
        qrCode: mockQrCodeDataUrl,
        backupCodes: mockBackupCodes,
      });
      expect(mfaService.generateSecret).toHaveBeenCalledWith(mockUser.email);
      expect(prismaService.user.update).toHaveBeenCalledWith({
        where: { id: userId },
        data: { mfaSecret: mockSecret },
      });
    });

    it('should throw ConflictException when MFA is already enabled', async () => {
      // Arrange
      const userId = 'user-2';
      usersService.findOne.mockResolvedValue(mockUserWithMfa);

      // Act & Assert
      await expect(service.setupMfa(userId)).rejects.toThrow(
        new ConflictException('MFA is already enabled for this user')
      );
    });
  });

  describe('enableMfa', () => {
    it('should enable MFA with valid token', async () => {
      // Arrange
      const userId = 'user-1';
      const setupMfaDto = { token: '123456' };
      const userWithSecret = new User({
        ...mockUser,
        mfaSecret: 'temp-secret',
      });

      usersService.findOne.mockResolvedValue(userWithSecret);
      mfaService.verifyToken.mockReturnValue(true);
      usersService.enableMfa.mockResolvedValue(undefined);

      // Act
      await service.enableMfa(userId, setupMfaDto);

      // Assert
      expect(mfaService.verifyToken).toHaveBeenCalledWith('temp-secret', '123456');
      expect(usersService.enableMfa).toHaveBeenCalledWith(userId, 'temp-secret');
    });

    it('should throw BadRequestException when MFA setup not initiated', async () => {
      // Arrange
      const userId = 'user-1';
      const setupMfaDto = { token: '123456' };

      usersService.findOne.mockResolvedValue(mockUser);

      // Act & Assert
      await expect(service.enableMfa(userId, setupMfaDto)).rejects.toThrow(
        new BadRequestException('MFA setup not initiated')
      );
    });

    it('should throw UnauthorizedException for invalid token', async () => {
      // Arrange
      const userId = 'user-1';
      const setupMfaDto = { token: 'invalid-token' };
      const userWithSecret = new User({
        ...mockUser,
        mfaSecret: 'temp-secret',
      });

      usersService.findOne.mockResolvedValue(userWithSecret);
      mfaService.verifyToken.mockReturnValue(false);

      // Act & Assert
      await expect(service.enableMfa(userId, setupMfaDto)).rejects.toThrow(
        new UnauthorizedException('Invalid MFA token')
      );
    });
  });

  describe('disableMfa', () => {
    it('should disable MFA with valid token', async () => {
      // Arrange
      const userId = 'user-2';
      const token = '123456';

      usersService.findOne.mockResolvedValue(mockUserWithMfa);
      mfaService.verifyToken.mockReturnValue(true);
      usersService.disableMfa.mockResolvedValue(undefined);

      // Act
      await service.disableMfa(userId, token);

      // Assert
      expect(mfaService.verifyToken).toHaveBeenCalledWith('mfa-secret', '123456');
      expect(usersService.disableMfa).toHaveBeenCalledWith(userId);
    });

    it('should throw BadRequestException when MFA is not enabled', async () => {
      // Arrange
      const userId = 'user-1';
      const token = '123456';

      usersService.findOne.mockResolvedValue(mockUser);

      // Act & Assert
      await expect(service.disableMfa(userId, token)).rejects.toThrow(
        new BadRequestException('MFA is not enabled')
      );
    });

    it('should throw UnauthorizedException for invalid token', async () => {
      // Arrange
      const userId = 'user-2';
      const token = 'invalid-token';

      usersService.findOne.mockResolvedValue(mockUserWithMfa);
      mfaService.verifyToken.mockReturnValue(false);

      // Act & Assert
      await expect(service.disableMfa(userId, token)).rejects.toThrow(
        new UnauthorizedException('Invalid MFA token')
      );
    });
  });

  describe('validateJwtPayload', () => {
    it('should return user for valid JWT payload', async () => {
      // Arrange
      const payload = {
        sub: 'user-1',
        email: 'test@example.com',
        role: 'ENGINEER',
      };

      usersService.findOne.mockResolvedValue(mockUser);

      // Act
      const result = await service.validateJwtPayload(payload);

      // Assert
      expect(result).toEqual(mockUser);
      expect(usersService.findOne).toHaveBeenCalledWith('user-1');
    });

    it('should throw UnauthorizedException when user not found', async () => {
      // Arrange
      const payload = {
        sub: 'nonexistent-user',
        email: 'test@example.com',
        role: 'ENGINEER',
      };

      usersService.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(service.validateJwtPayload(payload)).rejects.toThrow(
        new UnauthorizedException('User not found')
      );
    });
  });

  describe('validateSession', () => {
    it('should return true for valid session', async () => {
      // Arrange
      const sessionToken = 'valid-session-token';
      const futureDate = new Date();
      futureDate.setHours(futureDate.getHours() + 1);

      prismaService.userSession.findUnique.mockResolvedValue({
        id: 'session-1',
        userId: 'user-1',
        sessionToken,
        expiresAt: futureDate,
        createdAt: new Date(),
      } as any);

      // Act
      const result = await service.validateSession(sessionToken);

      // Assert
      expect(result).toBe(true);
    });

    it('should return false for non-existent session', async () => {
      // Arrange
      const sessionToken = 'nonexistent-session-token';
      prismaService.userSession.findUnique.mockResolvedValue(null);

      // Act
      const result = await service.validateSession(sessionToken);

      // Assert
      expect(result).toBe(false);
    });

    it('should return false and cleanup expired session', async () => {
      // Arrange
      const sessionToken = 'expired-session-token';
      const pastDate = new Date();
      pastDate.setHours(pastDate.getHours() - 1);

      const expiredSession = {
        id: 'session-1',
        userId: 'user-1',
        sessionToken,
        expiresAt: pastDate,
        createdAt: new Date(),
      };

      prismaService.userSession.findUnique.mockResolvedValue(expiredSession as any);
      prismaService.userSession.delete.mockResolvedValue(expiredSession as any);

      // Act
      const result = await service.validateSession(sessionToken);

      // Assert
      expect(result).toBe(false);
      expect(prismaService.userSession.delete).toHaveBeenCalledWith({
        where: { id: 'session-1' },
      });
    });
  });

  describe('cleanupExpiredSessions', () => {
    it('should delete all expired sessions', async () => {
      // Arrange
      prismaService.userSession.deleteMany.mockResolvedValue({ count: 5 } as any);

      // Act
      await service.cleanupExpiredSessions();

      // Assert
      expect(prismaService.userSession.deleteMany).toHaveBeenCalledWith({
        where: {
          expiresAt: {
            lt: expect.any(Date),
          },
        },
      });
    });
  });
});