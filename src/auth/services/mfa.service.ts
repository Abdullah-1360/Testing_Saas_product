import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { EncryptionService } from '@/common/services/encryption.service';
import { AuditService } from '@/audit/audit.service';
import * as speakeasy from 'speakeasy';
import * as QRCode from 'qrcode';

@Injectable()
export class MfaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryptionService: EncryptionService,
    private readonly auditService: AuditService,
  ) {}

  generateSecret(): string {
    const secret = speakeasy.generateSecret({
      name: 'WP-AutoHealer',
      issuer: 'WP-AutoHealer',
      length: 32,
    });

    return secret.base32!;
  }

  async generateQRCode(email: string, secret: string): Promise<string> {
    try {
      const otpauthUrl = speakeasy.otpauthURL({
        secret,
        label: `WP-AutoHealer (${email})`,
        issuer: 'WP-AutoHealer',
        encoding: 'base32',
      });

      return await QRCode.toDataURL(otpauthUrl);
    } catch (error) {
      throw new Error('Failed to generate QR code');
    }
  }

  verifyToken(secret: string, token: string, window = 1): boolean {
    try {
      // Decrypt the secret if it's encrypted
      let decryptedSecret = secret;
      try {
        decryptedSecret = this.encryptionService.decrypt(secret);
      } catch {
        // If decryption fails, assume it's already decrypted
      }

      return speakeasy.totp.verify({
        secret: decryptedSecret,
        encoding: 'base32',
        token,
        window, // Allow 1 step before/after for clock drift
      });
    } catch (error) {
      return false;
    }
  }

  generateBackupCodes(count = 10): string[] {
    const codes: string[] = [];
    for (let i = 0; i < count; i++) {
      // Generate 8-character alphanumeric codes
      const code = Math.random().toString(36).substring(2, 10).toUpperCase();
      codes.push(code);
    }
    return codes;
  }

  async validateBackupCode(userId: string, providedCode: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { 
        id: true, 
        email: true, 
        username: true,
        mfaBackupCodes: true 
      },
    });

    if (!user || !user.mfaBackupCodes || user.mfaBackupCodes.length === 0) {
      return false;
    }

    // Decrypt backup codes and check if provided code matches any
    const decryptedCodes = user.mfaBackupCodes.map(encryptedCode => {
      try {
        return this.encryptionService.decrypt(encryptedCode);
      } catch {
        return null;
      }
    }).filter(code => code !== null);

    const normalizedProvidedCode = providedCode.toUpperCase().trim();
    const isValid = decryptedCodes.includes(normalizedProvidedCode);

    if (isValid) {
      // Remove the used backup code
      const remainingCodes = user.mfaBackupCodes.filter(encryptedCode => {
        try {
          const decryptedCode = this.encryptionService.decrypt(encryptedCode);
          return decryptedCode !== normalizedProvidedCode;
        } catch {
          return true; // Keep codes that can't be decrypted (shouldn't happen)
        }
      });

      // Update user with remaining backup codes
      await this.prisma.user.update({
        where: { id: userId },
        data: { mfaBackupCodes: remainingCodes },
      });

      // Create audit log
      await this.auditService.createAuditEvent({
        userId,
        action: 'backup_code_used',
        resource: 'user',
        resourceId: userId,
        details: {
          email: user.email,
          username: user.username,
          remainingCodes: remainingCodes.length,
        },
      });
    }

    return isValid;
  }

  validateBackupCodeArray(storedCodes: string[], providedCode: string): boolean {
    const normalizedProvidedCode = providedCode.toUpperCase().trim();
    
    // Decrypt stored codes and check
    for (const encryptedCode of storedCodes) {
      try {
        const decryptedCode = this.encryptionService.decrypt(encryptedCode);
        if (decryptedCode === normalizedProvidedCode) {
          return true;
        }
      } catch {
        // Skip codes that can't be decrypted
        continue;
      }
    }
    
    return false;
  }

  removeUsedBackupCode(storedCodes: string[], usedCode: string): string[] {
    const normalizedUsedCode = usedCode.toUpperCase().trim();
    
    return storedCodes.filter(encryptedCode => {
      try {
        const decryptedCode = this.encryptionService.decrypt(encryptedCode);
        return decryptedCode !== normalizedUsedCode;
      } catch {
        return true; // Keep codes that can't be decrypted
      }
    });
  }
}