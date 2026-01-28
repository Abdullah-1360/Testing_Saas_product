import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { UsersService } from './users.service';
import { PrismaService } from '@/database/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { User } from './entities/user.entity';

// Mock bcrypt
jest.mock('bcrypt');
const mockedBcrypt = bcrypt as jest.Mocked<typeof bcrypt>;

describe('UsersService', () => {
  let service: UsersService;
  let prismaService: jest.Mocked<PrismaService>;

  const mockPrismaUser = {
    id: '1',
    email: 'test@example.com',
    passwordHash: 'hashedPassword',
    role: 'ENGINEER',
    mfaEnabled: false,
    mfaSecret: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastLoginAt: null,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: PrismaService,
          useValue: {
            user: {
              findUnique: jest.fn(),
              findMany: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    prismaService = module.get(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create a new user', async () => {
      const createUserDto: CreateUserDto = {
        email: 'test@example.com',
        password: 'password123',
        role: 'ENGINEER',
      };

      prismaService.user.findUnique.mockResolvedValue(null);
      mockedBcrypt.hash.mockResolvedValue('hashedPassword' as never);
      prismaService.user.create.mockResolvedValue(mockPrismaUser as any);

      const result = await service.create(createUserDto);

      expect(result).toBeInstanceOf(User);
      expect(result.email).toBe(createUserDto.email);
      expect(prismaService.user.findUnique).toHaveBeenCalledWith({
        where: { email: createUserDto.email },
      });
      expect(mockedBcrypt.hash).toHaveBeenCalledWith(createUserDto.password, 12);
      expect(prismaService.user.create).toHaveBeenCalledWith({
        data: {
          email: createUserDto.email,
          passwordHash: 'hashedPassword',
          role: createUserDto.role,
          mfaSecret: null,
          mfaEnabled: false,
        },
      });
    });

    it('should throw ConflictException when user already exists', async () => {
      const createUserDto: CreateUserDto = {
        email: 'test@example.com',
        password: 'password123',
        role: 'ENGINEER',
      };

      prismaService.user.findUnique.mockResolvedValue(mockPrismaUser as any);

      await expect(service.create(createUserDto)).rejects.toThrow(ConflictException);
    });

    it('should create user with MFA secret when provided', async () => {
      const createUserDto: CreateUserDto = {
        email: 'test@example.com',
        password: 'password123',
        role: 'ENGINEER',
        mfaSecret: 'secret123',
      };

      prismaService.user.findUnique.mockResolvedValue(null);
      mockedBcrypt.hash.mockResolvedValue('hashedPassword' as never);
      prismaService.user.create.mockResolvedValue({
        ...mockPrismaUser,
        mfaSecret: 'secret123',
        mfaEnabled: true,
      } as any);

      const result = await service.create(createUserDto);

      expect(prismaService.user.create).toHaveBeenCalledWith({
        data: {
          email: createUserDto.email,
          passwordHash: 'hashedPassword',
          role: createUserDto.role,
          mfaSecret: 'secret123',
          mfaEnabled: true,
        },
      });
    });
  });

  describe('findAll', () => {
    it('should return all users', async () => {
      const mockUsers = [mockPrismaUser, { ...mockPrismaUser, id: '2', email: 'test2@example.com' }];
      prismaService.user.findMany.mockResolvedValue(mockUsers as any);

      const result = await service.findAll();

      expect(result).toHaveLength(2);
      expect(result[0]).toBeInstanceOf(User);
      expect(result[1]).toBeInstanceOf(User);
      expect(prismaService.user.findMany).toHaveBeenCalledWith({
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('findOne', () => {
    it('should return a user by id', async () => {
      prismaService.user.findUnique.mockResolvedValue(mockPrismaUser as any);

      const result = await service.findOne('1');

      expect(result).toBeInstanceOf(User);
      expect(result.id).toBe('1');
      expect(prismaService.user.findUnique).toHaveBeenCalledWith({
        where: { id: '1' },
      });
    });

    it('should throw NotFoundException when user not found', async () => {
      prismaService.user.findUnique.mockResolvedValue(null);

      await expect(service.findOne('1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findByEmail', () => {
    it('should return a user by email', async () => {
      prismaService.user.findUnique.mockResolvedValue(mockPrismaUser as any);

      const result = await service.findByEmail('test@example.com');

      expect(result).toBeInstanceOf(User);
      expect(result?.email).toBe('test@example.com');
      expect(prismaService.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'test@example.com' },
      });
    });

    it('should return null when user not found', async () => {
      prismaService.user.findUnique.mockResolvedValue(null);

      const result = await service.findByEmail('test@example.com');

      expect(result).toBeNull();
    });
  });

  describe('update', () => {
    it('should update a user', async () => {
      const updateUserDto: UpdateUserDto = {
        email: 'updated@example.com',
      };

      prismaService.user.findUnique.mockResolvedValue(mockPrismaUser as any);
      prismaService.user.update.mockResolvedValue({
        ...mockPrismaUser,
        email: 'updated@example.com',
      } as any);

      const result = await service.update('1', updateUserDto);

      expect(result).toBeInstanceOf(User);
      expect(result.email).toBe('updated@example.com');
      expect(prismaService.user.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: updateUserDto,
      });
    });

    it('should hash password when updating password', async () => {
      const updateUserDto: UpdateUserDto = {
        password: 'newpassword123',
      };

      prismaService.user.findUnique.mockResolvedValue(mockPrismaUser as any);
      mockedBcrypt.hash.mockResolvedValue('newHashedPassword' as never);
      prismaService.user.update.mockResolvedValue({
        ...mockPrismaUser,
        passwordHash: 'newHashedPassword',
      } as any);

      const result = await service.update('1', updateUserDto);

      expect(mockedBcrypt.hash).toHaveBeenCalledWith('newpassword123', 12);
      expect(prismaService.user.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: { passwordHash: 'newHashedPassword' },
      });
    });

    it('should throw NotFoundException when user not found', async () => {
      prismaService.user.findUnique.mockResolvedValue(null);

      await expect(service.update('1', {})).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('should delete a user', async () => {
      prismaService.user.findUnique.mockResolvedValue(mockPrismaUser as any);
      prismaService.user.delete.mockResolvedValue(mockPrismaUser as any);

      await service.remove('1');

      expect(prismaService.user.delete).toHaveBeenCalledWith({
        where: { id: '1' },
      });
    });

    it('should throw NotFoundException when user not found', async () => {
      prismaService.user.findUnique.mockResolvedValue(null);

      await expect(service.remove('1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('validatePassword', () => {
    it('should return true for valid password', async () => {
      const user = new User(mockPrismaUser);
      mockedBcrypt.compare.mockResolvedValue(true as never);

      const result = await service.validatePassword(user, 'password123');

      expect(result).toBe(true);
      expect(mockedBcrypt.compare).toHaveBeenCalledWith('password123', 'hashedPassword');
    });

    it('should return false for invalid password', async () => {
      const user = new User(mockPrismaUser);
      mockedBcrypt.compare.mockResolvedValue(false as never);

      const result = await service.validatePassword(user, 'wrongpassword');

      expect(result).toBe(false);
    });
  });

  describe('updateLastLogin', () => {
    it('should update last login timestamp', async () => {
      prismaService.user.update.mockResolvedValue(mockPrismaUser as any);

      await service.updateLastLogin('1');

      expect(prismaService.user.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: { lastLoginAt: expect.any(Date) },
      });
    });
  });

  describe('enableMfa', () => {
    it('should enable MFA for user', async () => {
      const updatedUser = {
        ...mockPrismaUser,
        mfaSecret: 'secret123',
        mfaEnabled: true,
      };
      prismaService.user.update.mockResolvedValue(updatedUser as any);

      const result = await service.enableMfa('1', 'secret123');

      expect(result).toBeInstanceOf(User);
      expect(result.mfaEnabled).toBe(true);
      expect(prismaService.user.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: {
          mfaSecret: 'secret123',
          mfaEnabled: true,
        },
      });
    });
  });

  describe('disableMfa', () => {
    it('should disable MFA for user', async () => {
      const updatedUser = {
        ...mockPrismaUser,
        mfaSecret: null,
        mfaEnabled: false,
      };
      prismaService.user.update.mockResolvedValue(updatedUser as any);

      const result = await service.disableMfa('1');

      expect(result).toBeInstanceOf(User);
      expect(result.mfaEnabled).toBe(false);
      expect(prismaService.user.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: {
          mfaSecret: null,
          mfaEnabled: false,
        },
      });
    });
  });

  describe('getUsersByRole', () => {
    it('should return users by role', async () => {
      const mockEngineers = [
        mockPrismaUser,
        { ...mockPrismaUser, id: '2', email: 'engineer2@example.com' },
      ];
      prismaService.user.findMany.mockResolvedValue(mockEngineers as any);

      const result = await service.getUsersByRole('ENGINEER');

      expect(result).toHaveLength(2);
      expect(result[0]).toBeInstanceOf(User);
      expect(prismaService.user.findMany).toHaveBeenCalledWith({
        where: { role: 'ENGINEER' },
        orderBy: { createdAt: 'desc' },
      });
    });
  });
});