import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException, ConflictException } from '@nestjs/common';
import { AuthService } from './services/auth.service';
import { UsersService } from '@/users/users.service';
import { MfaService } from './services/mfa.service';
import { PrismaService } from '@/database/prisma.service';
import { User } from '@/users/entities/user.entity';

describe('AuthService', () => {
  let service: AuthService;
  let usersService: jest.Mocked<UsersService>;
  let jwtService: jest.Mocked<JwtService>;
  let mfaService: jest.Mocked<MfaService>;
  let prismaService: jest.Mocked<PrismaService>;

  const mockUser = new User({
    id: '1',
    email: 'test@example.com',
    passwordHash: 'hashedPassword',
    role: 'ENGINEER',
    mfaEnabled: false,
    mfaSecret: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastLoginAt: null,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: UsersService,
          useValue: {
            findByEmail: jest.fn(),
            validatePassword: jest.fn(),
            updateLastLogin: jest.fn(),
            findOne: jest.fn(),
            enableMfa: jest.fn(),
            disableMfa: jest.fn(),
          },
        },
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn(),
          },
        },
        {
          provide: MfaService,
          useValue: {
            generateSecret: jest.fn(),
            generateQRCode: jest.fn(),
            generateBackupCodes: jest.fn(),
            verifyToken: jest.fn(),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            userSession: {
              create: jest.fn(),
              deleteMany: jest.fn(),
              findUnique: jest.fn(),
              delete: jest.fn(),
            },
            user: {
              update: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    usersService = module.get(UsersService);
    jwtService = module.get(JwtService);
    mfaService = module.get(MfaService);
    prismaService = module.get(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('validateUser', () => {
    it('should return user when credentials are valid', async () => {
      usersService.findByEmail.mockResolvedValue(mockUser);
      usersService.validatePassword.mockResolvedValue(true);

      const result = await service.validateUser('test@example.com', 'password');

      expect(result).toEqual(mockUser);
      expect(usersService.findByEmail).toHaveBeenCalledWith('test@example.com');
      expect(usersService.validatePassword).toHaveBeenCalledWith(mockUser, 'password');
    });

    it('should return null when user does not exist', async () => {
      usersService.findByEmail.mockResolvedValue(null);

      const result = await service.validateUser('test@example.com', 'password');

      expect(result).toBeNull();
    });

    it('should return null when password is invalid', async () => {
      usersService.findByEmail.mockResolvedValue(mockUser);
      usersService.validatePassword.mockResolvedValue(false);

      const result = await service.validateUser('test@example.com', 'wrongpassword');

      expect(result).toBeNull();
    });
  });

  describe('login', () => {
    it('should return access token when credentials are valid', async () => {
      const loginDto = { email: 'test@example.com', password: 'password' };
      const mockToken = 'jwt-token';

      usersService.findByEmail.mockResolvedValue(mockUser);
      usersService.validatePassword.mockResolvedValue(true);
      usersService.updateLastLogin.mockResolvedValue(undefined);
      jwtService.sign.mockReturnValue(mockToken);
      prismaService.userSession.create.mockResolvedValue({} as any);

      const result = await service.login(loginDto);

      expect(result).toEqual({
        access_token: mockToken,
        user: mockUser.toSafeObject(),
      });
      expect(usersService.updateLastLogin).toHaveBeenCalledWith(mockUser.id);
    });

    it('should throw UnauthorizedException when credentials are invalid', async () => {
      const loginDto = { email: 'test@example.com', password: 'wrongpassword' };

      usersService.findByEmail.mockResolvedValue(null);

      await expect(service.login(loginDto)).rejects.toThrow(UnauthorizedException);
    });

    it('should require MFA token when MFA is enabled', async () => {
      const userWithMfa = new User({
        ...mockUser,
        mfaEnabled: true,
        mfaSecret: 'secret',
      });
      const loginDto = { email: 'test@example.com', password: 'password' };

      usersService.findByEmail.mockResolvedValue(userWithMfa);
      usersService.validatePassword.mockResolvedValue(true);

      const result = await service.login(loginDto);

      expect(result).toEqual({
        access_token: '',
        user: userWithMfa.toSafeObject(),
        mfaRequired: true,
      });
    });

    it('should validate MFA token when provided', async () => {
      const userWithMfa = new User({
        ...mockUser,
        mfaEnabled: true,
        mfaSecret: 'secret',
      });
      const loginDto = { 
        email: 'test@example.com', 
        password: 'password',
        mfaToken: '123456'
      };
      const mockToken = 'jwt-token';

      usersService.findByEmail.mockResolvedValue(userWithMfa);
      usersService.validatePassword.mockResolvedValue(true);
      mfaService.verifyToken.mockReturnValue(true);
      usersService.updateLastLogin.mockResolvedValue(undefined);
      jwtService.sign.mockReturnValue(mockToken);
      prismaService.userSession.create.mockResolvedValue({} as any);

      const result = await service.login(loginDto);

      expect(result).toEqual({
        access_token: mockToken,
        user: userWithMfa.toSafeObject(),
      });
      expect(mfaService.verifyToken).toHaveBeenCalledWith('secret', '123456');
    });

    it('should throw UnauthorizedException when MFA token is invalid', async () => {
      const userWithMfa = new User({
        ...mockUser,
        mfaEnabled: true,
        mfaSecret: 'secret',
      });
      const loginDto = { 
        email: 'test@example.com', 
        password: 'password',
        mfaToken: '123456'
      };

      usersService.findByEmail.mockResolvedValue(userWithMfa);
      usersService.validatePassword.mockResolvedValue(true);
      mfaService.verifyToken.mockReturnValue(false);

      await expect(service.login(loginDto)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('setupMfa', () => {
    it('should generate MFA setup data', async () => {
      const mockSecret = 'JBSWY3DPEHPK3PXP';
      const mockQrCode = 'otpauth://totp/...';
      const mockQrCodeDataUrl = 'data:image/png;base64,...';
      const mockBackupCodes = ['CODE1', 'CODE2'];

      usersService.findOne.mockResolvedValue(mockUser);
      mfaService.generateSecret.mockReturnValue({
        secret: mockSecret,
        qrCode: mockQrCode,
      });
      mfaService.generateQRCode.mockResolvedValue(mockQrCodeDataUrl);
      mfaService.generateBackupCodes.mockReturnValue(mockBackupCodes);
      prismaService.user.update.mockResolvedValue({} as any);

      const result = await service.setupMfa(mockUser.id);

      expect(result).toEqual({
        secret: mockSecret,
        qrCode: mockQrCodeDataUrl,
        backupCodes: mockBackupCodes,
      });
      expect(prismaService.user.update).toHaveBeenCalledWith({
        where: { id: mockUser.id },
        data: { mfaSecret: mockSecret },
      });
    });

    it('should throw ConflictException when MFA is already enabled', async () => {
      const userWithMfa = new User({
        ...mockUser,
        mfaEnabled: true,
      });

      usersService.findOne.mockResolvedValue(userWithMfa);

      await expect(service.setupMfa(mockUser.id)).rejects.toThrow(ConflictException);
    });
  });

  describe('enableMfa', () => {
    it('should enable MFA when token is valid', async () => {
      const userWithSecret = new User({
        ...mockUser,
        mfaSecret: 'secret',
      });
      const setupMfaDto = { token: '123456' };

      usersService.findOne.mockResolvedValue(userWithSecret);
      mfaService.verifyToken.mockReturnValue(true);
      usersService.enableMfa.mockResolvedValue({} as any);

      await service.enableMfa(mockUser.id, setupMfaDto);

      expect(mfaService.verifyToken).toHaveBeenCalledWith('secret', '123456');
      expect(usersService.enableMfa).toHaveBeenCalledWith(mockUser.id, 'secret');
    });

    it('should throw UnauthorizedException when token is invalid', async () => {
      const userWithSecret = new User({
        ...mockUser,
        mfaSecret: 'secret',
      });
      const setupMfaDto = { token: '123456' };

      usersService.findOne.mockResolvedValue(userWithSecret);
      mfaService.verifyToken.mockReturnValue(false);

      await expect(service.enableMfa(mockUser.id, setupMfaDto))
        .rejects.toThrow(UnauthorizedException);
    });
  });

  describe('validateSession', () => {
    it('should return true for valid session', async () => {
      const mockSession = {
        id: '1',
        sessionToken: 'token',
        expiresAt: new Date(Date.now() + 3600000), // 1 hour from now
      };

      prismaService.userSession.findUnique.mockResolvedValue(mockSession as any);

      const result = await service.validateSession('token');

      expect(result).toBe(true);
    });

    it('should return false for non-existent session', async () => {
      prismaService.userSession.findUnique.mockResolvedValue(null);

      const result = await service.validateSession('token');

      expect(result).toBe(false);
    });

    it('should return false and cleanup expired session', async () => {
      const expiredSession = {
        id: '1',
        sessionToken: 'token',
        expiresAt: new Date(Date.now() - 3600000), // 1 hour ago
      };

      prismaService.userSession.findUnique.mockResolvedValue(expiredSession as any);
      prismaService.userSession.delete.mockResolvedValue({} as any);

      const result = await service.validateSession('token');

      expect(result).toBe(false);
      expect(prismaService.userSession.delete).toHaveBeenCalledWith({
        where: { id: expiredSession.id },
      });
    });
  });
});