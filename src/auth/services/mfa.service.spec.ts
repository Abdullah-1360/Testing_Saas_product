import { Test, TestingModule } from '@nestjs/testing';
import { MfaService } from './mfa.service';
import * as speakeasy from 'speakeasy';
import * as QRCode from 'qrcode';

// Mock the external libraries
jest.mock('speakeasy');
jest.mock('qrcode');

const mockedSpeakeasy = speakeasy as jest.Mocked<typeof speakeasy>;
const mockedQRCode = QRCode as jest.Mocked<typeof QRCode>;

describe('MfaService', () => {
  let service: MfaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MfaService],
    }).compile();

    service = module.get<MfaService>(MfaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('generateSecret', () => {
    it('should generate MFA secret with correct parameters', () => {
      // Arrange
      const email = 'test@example.com';
      const mockSecret = {
        base32: 'JBSWY3DPEHPK3PXP',
        otpauth_url: 'otpauth://totp/WP-AutoHealer%20(test@example.com)?secret=JBSWY3DPEHPK3PXP&issuer=WP-AutoHealer',
      };

      mockedSpeakeasy.generateSecret.mockReturnValue(mockSecret as any);

      // Act
      const result = service.generateSecret(email);

      // Assert
      expect(result).toEqual({
        secret: 'JBSWY3DPEHPK3PXP',
        qrCode: 'otpauth://totp/WP-AutoHealer%20(test@example.com)?secret=JBSWY3DPEHPK3PXP&issuer=WP-AutoHealer',
      });

      expect(mockedSpeakeasy.generateSecret).toHaveBeenCalledWith({
        name: `WP-AutoHealer (${email})`,
        issuer: 'WP-AutoHealer',
        length: 32,
      });
    });

    it('should handle different email formats', () => {
      // Arrange
      const emails = [
        'user@domain.com',
        'admin+test@example.org',
        'user.name@sub.domain.co.uk',
      ];

      const mockSecret = {
        base32: 'JBSWY3DPEHPK3PXP',
        otpauth_url: 'otpauth://totp/test',
      };

      mockedSpeakeasy.generateSecret.mockReturnValue(mockSecret as any);

      // Act & Assert
      emails.forEach(email => {
        service.generateSecret(email);
        expect(mockedSpeakeasy.generateSecret).toHaveBeenCalledWith({
          name: `WP-AutoHealer (${email})`,
          issuer: 'WP-AutoHealer',
          length: 32,
        });
      });
    });
  });

  describe('generateQRCode', () => {
    it('should generate QR code data URL successfully', async () => {
      // Arrange
      const otpauthUrl = 'otpauth://totp/WP-AutoHealer%20(test@example.com)?secret=JBSWY3DPEHPK3PXP&issuer=WP-AutoHealer';
      const expectedDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...';

      mockedQRCode.toDataURL.mockResolvedValue(expectedDataUrl);

      // Act
      const result = await service.generateQRCode(otpauthUrl);

      // Assert
      expect(result).toBe(expectedDataUrl);
      expect(mockedQRCode.toDataURL).toHaveBeenCalledWith(otpauthUrl);
    });

    it('should throw error when QR code generation fails', async () => {
      // Arrange
      const otpauthUrl = 'invalid-url';
      const error = new Error('QR code generation failed');

      mockedQRCode.toDataURL.mockRejectedValue(error);

      // Act & Assert
      await expect(service.generateQRCode(otpauthUrl)).rejects.toThrow(
        'Failed to generate QR code'
      );
    });
  });

  describe('verifyToken', () => {
    it('should verify valid TOTP token', () => {
      // Arrange
      const secret = 'JBSWY3DPEHPK3PXP';
      const token = '123456';

      mockedSpeakeasy.totp.verify.mockReturnValue(true);

      // Act
      const result = service.verifyToken(secret, token);

      // Assert
      expect(result).toBe(true);
      expect(mockedSpeakeasy.totp.verify).toHaveBeenCalledWith({
        secret,
        encoding: 'base32',
        token,
        window: 1,
      });
    });

    it('should reject invalid TOTP token', () => {
      // Arrange
      const secret = 'JBSWY3DPEHPK3PXP';
      const token = '000000';

      mockedSpeakeasy.totp.verify.mockReturnValue(false);

      // Act
      const result = service.verifyToken(secret, token);

      // Assert
      expect(result).toBe(false);
    });

    it('should use custom window parameter', () => {
      // Arrange
      const secret = 'JBSWY3DPEHPK3PXP';
      const token = '123456';
      const customWindow = 2;

      mockedSpeakeasy.totp.verify.mockReturnValue(true);

      // Act
      service.verifyToken(secret, token, customWindow);

      // Assert
      expect(mockedSpeakeasy.totp.verify).toHaveBeenCalledWith({
        secret,
        encoding: 'base32',
        token,
        window: customWindow,
      });
    });

    it('should handle edge cases for token verification', () => {
      // Arrange
      const secret = 'JBSWY3DPEHPK3PXP';
      const testCases = [
        { token: '000000', expected: false },
        { token: '999999', expected: false },
        { token: '123456', expected: true },
        { token: '654321', expected: true },
      ];

      // Act & Assert
      testCases.forEach(({ token, expected }) => {
        mockedSpeakeasy.totp.verify.mockReturnValue(expected);
        const result = service.verifyToken(secret, token);
        expect(result).toBe(expected);
      });
    });
  });

  describe('generateBackupCodes', () => {
    it('should generate default number of backup codes', () => {
      // Act
      const result = service.generateBackupCodes();

      // Assert
      expect(result).toHaveLength(10); // Default count
      expect(result.every(code => typeof code === 'string')).toBe(true);
      expect(result.every(code => code.length === 8)).toBe(true);
      expect(result.every(code => /^[A-Z0-9]+$/.test(code))).toBe(true);
    });

    it('should generate custom number of backup codes', () => {
      // Arrange
      const customCount = 5;

      // Act
      const result = service.generateBackupCodes(customCount);

      // Assert
      expect(result).toHaveLength(customCount);
    });

    it('should generate unique backup codes', () => {
      // Act
      const result = service.generateBackupCodes(20);

      // Assert
      const uniqueCodes = new Set(result);
      expect(uniqueCodes.size).toBe(result.length); // All codes should be unique
    });

    it('should generate codes with correct format', () => {
      // Act
      const result = service.generateBackupCodes(5);

      // Assert
      result.forEach(code => {
        expect(code).toMatch(/^[A-Z0-9]{8}$/);
        expect(code).toBe(code.toUpperCase());
      });
    });

    it('should handle edge cases for count parameter', () => {
      // Test cases
      const testCases = [0, 1, 50, 100];

      testCases.forEach(count => {
        const result = service.generateBackupCodes(count);
        expect(result).toHaveLength(count);
      });
    });
  });

  describe('validateBackupCode', () => {
    it('should validate existing backup code', () => {
      // Arrange
      const storedCodes = ['ABCD1234', 'EFGH5678', 'IJKL9012'];
      const providedCode = 'EFGH5678';

      // Act
      const result = service.validateBackupCode(storedCodes, providedCode);

      // Assert
      expect(result).toBe(true);
    });

    it('should reject non-existing backup code', () => {
      // Arrange
      const storedCodes = ['ABCD1234', 'EFGH5678', 'IJKL9012'];
      const providedCode = 'INVALID1';

      // Act
      const result = service.validateBackupCode(storedCodes, providedCode);

      // Assert
      expect(result).toBe(false);
    });

    it('should handle case-insensitive validation', () => {
      // Arrange
      const storedCodes = ['ABCD1234', 'EFGH5678', 'IJKL9012'];
      const providedCode = 'efgh5678'; // lowercase

      // Act
      const result = service.validateBackupCode(storedCodes, providedCode);

      // Assert
      expect(result).toBe(true);
    });

    it('should handle empty stored codes array', () => {
      // Arrange
      const storedCodes: string[] = [];
      const providedCode = 'ABCD1234';

      // Act
      const result = service.validateBackupCode(storedCodes, providedCode);

      // Assert
      expect(result).toBe(false);
    });

    it('should handle empty provided code', () => {
      // Arrange
      const storedCodes = ['ABCD1234', 'EFGH5678'];
      const providedCode = '';

      // Act
      const result = service.validateBackupCode(storedCodes, providedCode);

      // Assert
      expect(result).toBe(false);
    });
  });

  describe('removeUsedBackupCode', () => {
    it('should remove used backup code from array', () => {
      // Arrange
      const storedCodes = ['ABCD1234', 'EFGH5678', 'IJKL9012'];
      const usedCode = 'EFGH5678';

      // Act
      const result = service.removeUsedBackupCode(storedCodes, usedCode);

      // Assert
      expect(result).toEqual(['ABCD1234', 'IJKL9012']);
      expect(result).not.toContain('EFGH5678');
    });

    it('should handle case-insensitive removal', () => {
      // Arrange
      const storedCodes = ['ABCD1234', 'EFGH5678', 'IJKL9012'];
      const usedCode = 'efgh5678'; // lowercase

      // Act
      const result = service.removeUsedBackupCode(storedCodes, usedCode);

      // Assert
      expect(result).toEqual(['ABCD1234', 'IJKL9012']);
    });

    it('should return original array when code not found', () => {
      // Arrange
      const storedCodes = ['ABCD1234', 'EFGH5678', 'IJKL9012'];
      const usedCode = 'NOTFOUND';

      // Act
      const result = service.removeUsedBackupCode(storedCodes, usedCode);

      // Assert
      expect(result).toEqual(storedCodes);
    });

    it('should handle empty array', () => {
      // Arrange
      const storedCodes: string[] = [];
      const usedCode = 'ABCD1234';

      // Act
      const result = service.removeUsedBackupCode(storedCodes, usedCode);

      // Assert
      expect(result).toEqual([]);
    });

    it('should remove all instances of duplicate codes', () => {
      // Arrange
      const storedCodes = ['ABCD1234', 'EFGH5678', 'ABCD1234', 'IJKL9012'];
      const usedCode = 'ABCD1234';

      // Act
      const result = service.removeUsedBackupCode(storedCodes, usedCode);

      // Assert
      expect(result).toEqual(['EFGH5678', 'IJKL9012']);
      expect(result.filter(code => code === 'ABCD1234')).toHaveLength(0);
    });

    it('should not modify original array', () => {
      // Arrange
      const storedCodes = ['ABCD1234', 'EFGH5678', 'IJKL9012'];
      const originalCodes = [...storedCodes];
      const usedCode = 'EFGH5678';

      // Act
      const result = service.removeUsedBackupCode(storedCodes, usedCode);

      // Assert
      expect(storedCodes).toEqual(originalCodes); // Original array unchanged
      expect(result).not.toEqual(storedCodes); // New array returned
    });
  });
});