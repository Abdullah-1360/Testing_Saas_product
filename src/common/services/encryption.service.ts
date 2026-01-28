import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class EncryptionService implements OnModuleInit {
  private encryptionKey!: Buffer;
  private isReady = false;
  private readonly algorithm = 'aes-256-cbc';

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const keyString = this.configService.get<string>('ENCRYPTION_KEY');
    if (!keyString) {
      throw new Error('ENCRYPTION_KEY must be provided');
    }

    // Create a 32-byte key from the provided string
    this.encryptionKey = crypto.scryptSync(keyString, 'salt', 32);
    this.isReady = true;
  }

  /**
   * Encrypt sensitive data using Node.js crypto
   */
  encrypt(plaintext: string): string {
    if (!this.isReady) {
      throw new Error('EncryptionService not initialized');
    }

    if (!plaintext) {
      return plaintext;
    }

    try {
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipher(this.algorithm, this.encryptionKey);
      
      let encrypted = cipher.update(plaintext, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      // Combine IV and encrypted data
      const combined = iv.toString('hex') + ':' + encrypted;
      return Buffer.from(combined).toString('base64');
    } catch (error: any) {
      throw new Error(`Encryption failed: ${error.message}`);
    }
  }

  /**
   * Decrypt sensitive data using Node.js crypto
   */
  decrypt(encryptedData: string): string {
    if (!this.isReady) {
      throw new Error('EncryptionService not initialized');
    }

    if (!encryptedData) {
      return encryptedData;
    }

    try {
      const combined = Buffer.from(encryptedData, 'base64').toString('utf8');
      const parts = combined.split(':');
      
      if (parts.length !== 2) {
        throw new Error('Invalid encrypted data format');
      }
      
      const iv = Buffer.from(parts[0], 'hex');
      const encrypted = parts[1];
      
      const decipher = crypto.createDecipher(this.algorithm, this.encryptionKey);
      
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (error: any) {
      throw new Error(`Decryption failed: ${error.message}`);
    }
  }

  /**
   * Generate a secure random string
   */
  generateRandomString(length: number = 32): string {
    if (!this.isReady) {
      throw new Error('EncryptionService not initialized');
    }

    return crypto.randomBytes(Math.ceil(length * 3 / 4)).toString('base64').slice(0, length);
  }

  /**
   * Generate a secure hash of data
   */
  hash(data: string): string {
    if (!this.isReady) {
      throw new Error('EncryptionService not initialized');
    }

    return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
  }

  /**
   * Verify a hash against data
   */
  verifyHash(data: string, hash: string): boolean {
    try {
      const computedHash = this.hash(data);
      return computedHash === hash;
    } catch {
      return false;
    }
  }

  /**
   * Generate a key derivation from password and salt
   */
  deriveKey(password: string, salt: string, keyLength: number = 32): string {
    if (!this.isReady) {
      throw new Error('EncryptionService not initialized');
    }

    const derivedKey = crypto.scryptSync(password, salt, keyLength);
    return derivedKey.toString('base64');
  }

  /**
   * Generate a random salt for key derivation
   */
  generateSalt(): string {
    if (!this.isReady) {
      throw new Error('EncryptionService not initialized');
    }

    return crypto.randomBytes(32).toString('base64');
  }

  /**
   * Securely compare two strings in constant time
   */
  constantTimeCompare(a: string, b: string): boolean {
    if (!this.isReady) {
      throw new Error('EncryptionService not initialized');
    }

    if (a.length !== b.length) {
      return false;
    }

    const aBuffer = Buffer.from(a, 'utf8');
    const bBuffer = Buffer.from(b, 'utf8');

    return crypto.timingSafeEqual(aBuffer, bBuffer);
  }

  /**
   * Generate a cryptographically secure random UUID
   */
  generateSecureUUID(): string {
    if (!this.isReady) {
      throw new Error('EncryptionService not initialized');
    }

    return crypto.randomUUID();
  }
}