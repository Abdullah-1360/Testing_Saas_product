import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { EncryptionService } from '../../common/services/encryption.service';
import {
  ApiKeyServiceInterface,
  ApiKeyConfig
} from '../interfaces/integration.interface';
import { UpdateApiKeyDto } from '../dto/integration.dto';
import { createHash, randomBytes } from 'crypto';

@Injectable()
export class ApiKeysService implements ApiKeyServiceInterface {
  private readonly logger = new Logger(ApiKeysService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService
  ) {}

  /**
   * Generate a new API key
   * Validates: Requirements 10.6
   */
  async generateApiKey(
    name: string, 
    permissions: string[], 
    expiresAt?: Date
  ): Promise<{ key: string; config: ApiKeyConfig }> {
    this.logger.log(`Generating API key: ${name}`);

    try {
      // Generate random API key
      const keyBytes = randomBytes(32);
      const key = `wpah_${keyBytes.toString('hex')}`;
      
      // Create hash of the key for storage
      const keyHash = createHash('sha256').update(key).digest('hex');

      // Create API key record
      const apiKey = await this.prisma.apiKey.create({
        data: {
          name,
          keyHash,
          permissions,
          expiresAt,
          isActive: true,
          lastUsedAt: null
        }
      });

      // Audit log
      await this.auditService.createAuditEvent({
        action: 'GENERATE_API_KEY',
        resource: 'api_key',
        resourceId: apiKey.id,
        details: {
          name,
          permissions,
          expiresAt: expiresAt?.toISOString(),
          keyPrefix: key.substring(0, 12) + '...'
        }
      });

      this.logger.log(`Generated API key ${apiKey.id}: ${name}`);

      const config: ApiKeyConfig = {
        id: apiKey.id,
        name: apiKey.name,
        keyHash: apiKey.keyHash,
        permissions: apiKey.permissions,
        expiresAt: apiKey.expiresAt,
        lastUsedAt: apiKey.lastUsedAt,
        isActive: apiKey.isActive,
        createdAt: apiKey.createdAt
      };

      return { key, config };
    } catch (error) {
      this.logger.error(`Failed to generate API key: ${name}`, error);
      throw error;
    }
  }

  /**
   * Validate an API key
   * Validates: Requirements 10.6
   */
  async validateApiKey(key: string): Promise<{ valid: boolean; config?: ApiKeyConfig }> {
    try {
      if (!key || !key.startsWith('wpah_')) {
        return { valid: false };
      }

      // Create hash of the provided key
      const keyHash = createHash('sha256').update(key).digest('hex');

      // Find API key by hash
      const apiKey = await this.prisma.apiKey.findUnique({
        where: { keyHash }
      });

      if (!apiKey) {
        return { valid: false };
      }

      // Check if key is active
      if (!apiKey.isActive) {
        this.logger.warn(`Inactive API key used: ${apiKey.name}`);
        return { valid: false };
      }

      // Check if key is expired
      if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
        this.logger.warn(`Expired API key used: ${apiKey.name}`);
        return { valid: false };
      }

      // Update last used timestamp
      await this.prisma.apiKey.update({
        where: { id: apiKey.id },
        data: { lastUsedAt: new Date() }
      });

      const config: ApiKeyConfig = {
        id: apiKey.id,
        name: apiKey.name,
        keyHash: apiKey.keyHash,
        permissions: apiKey.permissions,
        expiresAt: apiKey.expiresAt,
        lastUsedAt: new Date(),
        isActive: apiKey.isActive,
        createdAt: apiKey.createdAt
      };

      return { valid: true, config };
    } catch (error) {
      this.logger.error('Failed to validate API key:', error);
      return { valid: false };
    }
  }

  /**
   * Revoke an API key
   * Validates: Requirements 10.6
   */
  async revokeApiKey(keyId: string): Promise<void> {
    this.logger.log(`Revoking API key: ${keyId}`);

    try {
      const apiKey = await this.prisma.apiKey.findUnique({
        where: { id: keyId }
      });

      if (!apiKey) {
        throw new NotFoundException(`API key with ID ${keyId} not found`);
      }

      // Mark as inactive instead of deleting for audit trail
      await this.prisma.apiKey.update({
        where: { id: keyId },
        data: { isActive: false }
      });

      // Audit log
      await this.auditService.createAuditEvent({
        action: 'REVOKE_API_KEY',
        resource: 'api_key',
        resourceId: keyId,
        details: {
          name: apiKey.name,
          revokedAt: new Date().toISOString()
        }
      });

      this.logger.log(`Revoked API key ${keyId}: ${apiKey.name}`);
    } catch (error) {
      this.logger.error(`Failed to revoke API key ${keyId}:`, error);
      throw error;
    }
  }

  /**
   * List API keys with optional filtering
   * Validates: Requirements 10.6
   */
  async listApiKeys(filters: Record<string, any> = {}): Promise<ApiKeyConfig[]> {
    try {
      const where: any = {};
      
      if (filters.isActive !== undefined) where.isActive = filters.isActive;
      if (filters.name) {
        where.name = { contains: filters.name, mode: 'insensitive' };
      }
      if (filters.expired !== undefined) {
        if (filters.expired) {
          where.expiresAt = { lt: new Date() };
        } else {
          where.OR = [
            { expiresAt: null },
            { expiresAt: { gte: new Date() } }
          ];
        }
      }

      const apiKeys = await this.prisma.apiKey.findMany({
        where,
        orderBy: { createdAt: 'desc' }
      });

      return apiKeys.map(apiKey => ({
        id: apiKey.id,
        name: apiKey.name,
        keyHash: apiKey.keyHash,
        permissions: apiKey.permissions,
        expiresAt: apiKey.expiresAt,
        lastUsedAt: apiKey.lastUsedAt,
        isActive: apiKey.isActive,
        createdAt: apiKey.createdAt
      }));
    } catch (error) {
      this.logger.error('Failed to list API keys:', error);
      throw error;
    }
  }

  /**
   * Update API key permissions
   * Validates: Requirements 10.6
   */
  async updateApiKeyPermissions(keyId: string, permissions: string[]): Promise<ApiKeyConfig> {
    this.logger.log(`Updating API key permissions: ${keyId}`);

    try {
      const existingApiKey = await this.prisma.apiKey.findUnique({
        where: { id: keyId }
      });

      if (!existingApiKey) {
        throw new NotFoundException(`API key with ID ${keyId} not found`);
      }

      const updatedApiKey = await this.prisma.apiKey.update({
        where: { id: keyId },
        data: { permissions }
      });

      // Audit log
      await this.auditService.createAuditEvent({
        action: 'UPDATE_API_KEY_PERMISSIONS',
        resource: 'api_key',
        resourceId: keyId,
        details: {
          name: updatedApiKey.name,
          previousPermissions: existingApiKey.permissions,
          newPermissions: permissions
        }
      });

      this.logger.log(`Updated API key permissions ${keyId}: ${updatedApiKey.name}`);

      return {
        id: updatedApiKey.id,
        name: updatedApiKey.name,
        keyHash: updatedApiKey.keyHash,
        permissions: updatedApiKey.permissions,
        expiresAt: updatedApiKey.expiresAt,
        lastUsedAt: updatedApiKey.lastUsedAt,
        isActive: updatedApiKey.isActive,
        createdAt: updatedApiKey.createdAt
      };
    } catch (error) {
      this.logger.error(`Failed to update API key permissions ${keyId}:`, error);
      throw error;
    }
  }

  /**
   * Update API key details
   */
  async updateApiKey(keyId: string, updateDto: UpdateApiKeyDto): Promise<ApiKeyConfig> {
    this.logger.log(`Updating API key: ${keyId}`);

    try {
      const existingApiKey = await this.prisma.apiKey.findUnique({
        where: { id: keyId }
      });

      if (!existingApiKey) {
        throw new NotFoundException(`API key with ID ${keyId} not found`);
      }

      const updateData: any = {};
      if (updateDto.name !== undefined) updateData.name = updateDto.name;
      if (updateDto.permissions !== undefined) updateData.permissions = updateDto.permissions;
      if (updateDto.isActive !== undefined) updateData.isActive = updateDto.isActive;

      const updatedApiKey = await this.prisma.apiKey.update({
        where: { id: keyId },
        data: updateData
      });

      // Audit log
      await this.auditService.createAuditEvent({
        action: 'UPDATE_API_KEY',
        resource: 'api_key',
        resourceId: keyId,
        details: {
          name: updatedApiKey.name,
          changes: updateData
        }
      });

      this.logger.log(`Updated API key ${keyId}: ${updatedApiKey.name}`);

      return {
        id: updatedApiKey.id,
        name: updatedApiKey.name,
        keyHash: updatedApiKey.keyHash,
        permissions: updatedApiKey.permissions,
        expiresAt: updatedApiKey.expiresAt,
        lastUsedAt: updatedApiKey.lastUsedAt,
        isActive: updatedApiKey.isActive,
        createdAt: updatedApiKey.createdAt
      };
    } catch (error) {
      this.logger.error(`Failed to update API key ${keyId}:`, error);
      throw error;
    }
  }

  /**
   * Get API key statistics
   */
  async getApiKeyStats(): Promise<{
    total: number;
    active: number;
    expired: number;
    neverUsed: number;
    recentlyUsed: number;
  }> {
    try {
      const [total, active, expired, neverUsed, recentlyUsed] = await Promise.all([
        this.prisma.apiKey.count(),
        this.prisma.apiKey.count({ where: { isActive: true } }),
        this.prisma.apiKey.count({ 
          where: { 
            expiresAt: { lt: new Date() },
            isActive: true 
          } 
        }),
        this.prisma.apiKey.count({ where: { lastUsedAt: null } }),
        this.prisma.apiKey.count({ 
          where: { 
            lastUsedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } // Last 7 days
          } 
        })
      ]);

      return {
        total,
        active,
        expired,
        neverUsed,
        recentlyUsed
      };
    } catch (error) {
      this.logger.error('Failed to get API key statistics:', error);
      throw error;
    }
  }

  /**
   * Check if API key has specific permission
   */
  hasPermission(apiKey: ApiKeyConfig, permission: string): boolean {
    return apiKey.permissions.includes(permission) || apiKey.permissions.includes('*');
  }

  /**
   * Get available permissions
   */
  getAvailablePermissions(): string[] {
    return [
      'incidents:read',
      'incidents:write',
      'sites:read',
      'sites:write',
      'servers:read',
      'servers:write',
      'evidence:read',
      'backups:read',
      'backups:write',
      'integrations:read',
      'integrations:write',
      'webhooks:trigger',
      'audit:read',
      '*' // Full access
    ];
  }
}