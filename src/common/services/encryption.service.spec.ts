import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EncryptionService } from './encryption.service';

// Mock libsodium
jest.mock('libsodium-wrappers', () => ({
  ready: Promise.resolve(),
  crypto_secretbox_easy: jest.fn(),
  crypto_secretbox_open_easy: jest.fn(),
  crypto_secretbox_NONCEBYTES: 24,
  crypto_secretbox_KEYBYTES: 32,
  randombytes_buf: jest.fn(),
  from_base64: jest.fn(),
  to_base64: jest.fn(),
}));

import * as sodium from 'libsodium-wrappers';

describe('EncryptionService', () => {
  let service: EncryptionService;
  let configService: jest.Mocked<ConfigService>;

  const mockEncryptionKey = 'test-encryption-key-32-bytes-long!';
  const mockPlaintext = 'sensitive-data';
  const mockEncryptedData = new Uint8Array([1, 2, 3, 4]);
  const mockNonce = new Uint8Array(24);
  const mockKey = new Uint8Array(32);

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EncryptionService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<EncryptionService>(EncryptionService);
    configService = module.get(ConfigService);

    // Reset mocks
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('onModuleInit', () => {
    it('should initialize encryption key from config', async () => {
      configService.get.mockReturnValue(mockEncryptionKey);
      (sodium.from_base64 as jest.Mock).mockReturnValue(mockKey);

      await service.onModuleInit();

      expect(configService.get).toHaveBeenCalledWith('ENCRYPTION_KEY');
      expect(sodium.from_base64).toHaveBeenCalledWith(mockEncryptionKey);
    });

    it('should throw error when encryption key is not configured', async () => {
      configService.get.mockReturnValue(undefined);

      await expect(service.onModuleInit()).rejects.toThrow(
        'ENCRYPTION_KEY environment variable is required'
      );
    });

    it('should throw error when encryption key is invalid', async () => {
      configService.get.mockReturnValue('invalid-key');
      (sodium.from_base64 as jest.Mock).mockImplementation(() => {
        throw new Error('Invalid base64');
      });

      await expect(service.onModuleInit()).rejects.toThrow(
        'Invalid encryption key format'
      );
    });
  });

  describe('encrypt', () => {
    beforeEach(async () => {
      configService.get.mockReturnValue(mockEncryptionKey);
      (sodium.from_base64 as jest.Mock).mockReturnValue(mockKey);
      await service.onModuleInit();
    });

    it('should encrypt data successfully', async () => {
      (sodium.randombytes_buf as jest.Mock).mockReturnValue(mockNonce);
      (sodium.crypto_secretbox_easy as jest.Mock).mockReturnValue(mockEncryptedData);
      (sodium.to_base64 as jest.Mock)
        .mockReturnValueOnce('base64-nonce')
        .mockReturnValueOnce('base64-encrypted');

      const result = await service.encrypt(mockPlaintext);

      expect(result).toBe('base64-nonce:base64-encrypted');
      expect(sodium.randombytes_buf).toHaveBeenCalledWith(24);
      expect(sodium.crypto_secretbox_easy).toHaveBeenCalledWith(
        mockPlaintext,
        mockNonce,
        mockKey
      );
      expect(sodium.to_base64).toHaveBeenCalledTimes(2);
    });

    it('should throw error when service not initialized', async () => {
      const uninitializedService = new EncryptionService(configService);

      await expect(uninitializedService.encrypt(mockPlaintext)).rejects.toThrow(
        'EncryptionService not initialized'
      );
    });

    it('should handle encryption errors', async () => {
      (sodium.randombytes_buf as jest.Mock).mockReturnValue(mockNonce);
      (sodium.crypto_secretbox_easy as jest.Mock).mockImplementation(() => {
        throw new Error('Encryption failed');
      });

      await expect(service.encrypt(mockPlaintext)).rejects.toThrow(
        'Encryption failed: Encryption failed'
      );
    });
  });

  describe('decrypt', () => {
    beforeEach(async () => {
      configService.get.mockReturnValue(mockEncryptionKey);
      (sodium.from_base64 as jest.Mock).mockReturnValue(mockKey);
      await service.onModuleInit();
    });

    it('should decrypt data successfully', async () => {
      const encryptedData = 'base64-nonce:base64-encrypted';
      (sodium.from_base64 as jest.Mock)
        .mockReturnValueOnce(mockNonce)
        .mockReturnValueOnce(mockEncryptedData);
      (sodium.crypto_secretbox_open_easy as jest.Mock).mockReturnValue(mockPlaintext);

      const result = await service.decrypt(encryptedData);

      expect(result).toBe(mockPlaintext);
      expect(sodium.from_base64).toHaveBeenCalledWith('base64-nonce');
      expect(sodium.from_base64).toHaveBeenCalledWith('base64-encrypted');
      expect(sodium.crypto_secretbox_open_easy).toHaveBeenCalledWith(
        mockEncryptedData,
        mockNonce,
        mockKey
      );
    });

    it('should throw error when service not initialized', async () => {
      const uninitializedService = new EncryptionService(configService);

      await expect(uninitializedService.decrypt('encrypted-data')).rejects.toThrow(
        'EncryptionService not initialized'
      );
    });

    it('should throw error for invalid encrypted data format', async () => {
      await expect(service.decrypt('invalid-format')).rejects.toThrow(
        'Invalid encrypted data format'
      );
    });

    it('should handle decryption errors', async () => {
      const encryptedData = 'base64-nonce:base64-encrypted';
      (sodium.from_base64 as jest.Mock)
        .mockReturnValueOnce(mockNonce)
        .mockReturnValueOnce(mockEncryptedData);
      (sodium.crypto_secretbox_open_easy as jest.Mock).mockImplementation(() => {
        throw new Error('Decryption failed');
      });

      await expect(service.decrypt(encryptedData)).rejects.toThrow(
        'Decryption failed: Decryption failed'
      );
    });
  });

  describe('isReady', () => {
    it('should return false when not initialized', () => {
      const uninitializedService = new EncryptionService(configService);
      expect(uninitializedService.isReady()).toBe(false);
    });

    it('should return true when initialized', async () => {
      configService.get.mockReturnValue(mockEncryptionKey);
      (sodium.from_base64 as jest.Mock).mockReturnValue(mockKey);
      await service.onModuleInit();

      expect(service.isReady()).toBe(true);
    });
  });

  describe('generateKey', () => {
    it('should generate a new encryption key', () => {
      const mockGeneratedKey = new Uint8Array(32);
      (sodium.randombytes_buf as jest.Mock).mockReturnValue(mockGeneratedKey);
      (sodium.to_base64 as jest.Mock).mockReturnValue('generated-key-base64');

      const result = service.generateKey();

      expect(result).toBe('generated-key-base64');
      expect(sodium.randombytes_buf).toHaveBeenCalledWith(32);
      expect(sodium.to_base64).toHaveBeenCalledWith(mockGeneratedKey);
    });
  });
});