import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/database/prisma.service';
import { AuditService } from '@/audit/audit.service';
import { CreateRetentionPolicyDto, UpdateRetentionPolicyDto } from './dto';
import { RetentionPolicy, PurgeAudit } from '@prisma/client';

@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Create a new retention policy with hard cap enforcement
   */
  async createRetentionPolicy(
    createDto: CreateRetentionPolicyDto,
    userId?: string,
  ): Promise<RetentionPolicy> {
    // Enforce hard cap of 1-7 days
    if (createDto.retentionDays < 1 || createDto.retentionDays > 7) {
      throw new BadRequestException(
        'Retention period must be between 1 and 7 days (hard cap enforcement)',
      );
    }

    // Check if policy name already exists
    const existingPolicy = await this.prisma.retentionPolicy.findUnique({
      where: { policyName: createDto.policyName },
    });

    if (existingPolicy) {
      throw new BadRequestException(
        `Retention policy with name '${createDto.policyName}' already exists`,
      );
    }

    try {
      const policy = await this.prisma.retentionPolicy.create({
        data: {
          policyName: createDto.policyName,
          retentionDays: createDto.retentionDays,
          appliesTo: createDto.appliesTo,
          isActive: createDto.isActive ?? true,
        },
      });

      // Audit the policy creation
      await this.auditService.createAuditEvent({
        userId,
        action: 'CREATE_RETENTION_POLICY',
        resource: 'retention_policy',
        resourceId: policy.id,
        details: {
          policyName: policy.policyName,
          retentionDays: policy.retentionDays,
          appliesTo: policy.appliesTo,
          isActive: policy.isActive,
        },
      });

      this.logger.log(`Created retention policy: ${policy.policyName}`, {
        policyId: policy.id,
        retentionDays: policy.retentionDays,
        appliesTo: policy.appliesTo,
        userId,
      });

      return policy;
    } catch (error) {
      this.logger.error('Failed to create retention policy:', error);
      throw error;
    }
  }

  /**
   * Get all retention policies
   */
  async getAllRetentionPolicies(): Promise<RetentionPolicy[]> {
    return await this.prisma.retentionPolicy.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get active retention policies
   */
  async getActiveRetentionPolicies(): Promise<RetentionPolicy[]> {
    return await this.prisma.retentionPolicy.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get retention policy by ID
   */
  async getRetentionPolicyById(id: string): Promise<RetentionPolicy> {
    const policy = await this.prisma.retentionPolicy.findUnique({
      where: { id },
    });

    if (!policy) {
      throw new NotFoundException(`Retention policy with ID ${id} not found`);
    }

    return policy;
  }

  /**
   * Get retention policy by name
   */
  async getRetentionPolicyByName(policyName: string): Promise<RetentionPolicy> {
    const policy = await this.prisma.retentionPolicy.findUnique({
      where: { policyName },
    });

    if (!policy) {
      throw new NotFoundException(`Retention policy '${policyName}' not found`);
    }

    return policy;
  }

  /**
   * Update retention policy with hard cap enforcement
   */
  async updateRetentionPolicy(
    id: string,
    updateDto: UpdateRetentionPolicyDto,
    userId?: string,
  ): Promise<RetentionPolicy> {
    const existingPolicy = await this.getRetentionPolicyById(id);

    // Enforce hard cap if retentionDays is being updated
    if (updateDto.retentionDays !== undefined) {
      if (updateDto.retentionDays < 1 || updateDto.retentionDays > 7) {
        throw new BadRequestException(
          'Retention period must be between 1 and 7 days (hard cap enforcement)',
        );
      }
    }

    // Check if new policy name conflicts (if being updated)
    if (updateDto.policyName && updateDto.policyName !== existingPolicy.policyName) {
      const conflictingPolicy = await this.prisma.retentionPolicy.findUnique({
        where: { policyName: updateDto.policyName },
      });

      if (conflictingPolicy) {
        throw new BadRequestException(
          `Retention policy with name '${updateDto.policyName}' already exists`,
        );
      }
    }

    try {
      const updatedPolicy = await this.prisma.retentionPolicy.update({
        where: { id },
        data: {
          ...(updateDto.policyName && { policyName: updateDto.policyName }),
          ...(updateDto.retentionDays !== undefined && { retentionDays: updateDto.retentionDays }),
          ...(updateDto.appliesTo && { appliesTo: updateDto.appliesTo }),
          ...(updateDto.isActive !== undefined && { isActive: updateDto.isActive }),
        },
      });

      // Audit the policy update
      await this.auditService.createAuditEvent({
        userId,
        action: 'UPDATE_RETENTION_POLICY',
        resource: 'retention_policy',
        resourceId: updatedPolicy.id,
        details: {
          previousValues: {
            policyName: existingPolicy.policyName,
            retentionDays: existingPolicy.retentionDays,
            appliesTo: existingPolicy.appliesTo,
            isActive: existingPolicy.isActive,
          },
          newValues: {
            policyName: updatedPolicy.policyName,
            retentionDays: updatedPolicy.retentionDays,
            appliesTo: updatedPolicy.appliesTo,
            isActive: updatedPolicy.isActive,
          },
          changes: updateDto,
        },
      });

      this.logger.log(`Updated retention policy: ${updatedPolicy.policyName}`, {
        policyId: updatedPolicy.id,
        changes: updateDto,
        userId,
      });

      return updatedPolicy;
    } catch (error) {
      this.logger.error('Failed to update retention policy:', error);
      throw error;
    }
  }

  /**
   * Delete retention policy
   */
  async deleteRetentionPolicy(id: string, userId?: string): Promise<void> {
    const existingPolicy = await this.getRetentionPolicyById(id);

    try {
      await this.prisma.retentionPolicy.delete({
        where: { id },
      });

      // Audit the policy deletion
      await this.auditService.createAuditEvent({
        userId,
        action: 'DELETE_RETENTION_POLICY',
        resource: 'retention_policy',
        resourceId: id,
        details: {
          deletedPolicy: {
            policyName: existingPolicy.policyName,
            retentionDays: existingPolicy.retentionDays,
            appliesTo: existingPolicy.appliesTo,
            isActive: existingPolicy.isActive,
          },
        },
      });

      this.logger.log(`Deleted retention policy: ${existingPolicy.policyName}`, {
        policyId: id,
        userId,
      });
    } catch (error) {
      this.logger.error('Failed to delete retention policy:', error);
      throw error;
    }
  }

  /**
   * Get default retention policy or create one if it doesn't exist
   */
  async getOrCreateDefaultRetentionPolicy(): Promise<RetentionPolicy> {
    const defaultPolicyName = 'default-retention';
    
    try {
      return await this.getRetentionPolicyByName(defaultPolicyName);
    } catch (error) {
      if (error instanceof NotFoundException) {
        // Create default policy
        const defaultRetentionDays = this.configService.get<number>('DEFAULT_RETENTION_DAYS', 3);
        
        this.logger.log(`Creating default retention policy with ${defaultRetentionDays} days retention`);
        
        return await this.createRetentionPolicy({
          policyName: defaultPolicyName,
          retentionDays: defaultRetentionDays,
          appliesTo: 'all',
          isActive: true,
        });
      }
      throw error;
    }
  }

  /**
   * Get all purge audit records
   */
  async getPurgeAuditRecords(
    limit: number = 50,
    offset: number = 0,
  ): Promise<{ records: PurgeAudit[]; total: number }> {
    const [records, total] = await Promise.all([
      this.prisma.purgeAudit.findMany({
        take: limit,
        skip: offset,
        orderBy: { executedAt: 'desc' },
        include: {
          policy: {
            select: {
              policyName: true,
              retentionDays: true,
              appliesTo: true,
            },
          },
          user: {
            select: {
              email: true,
              role: true,
            },
          },
        },
      }),
      this.prisma.purgeAudit.count(),
    ]);

    return { records, total };
  }

  /**
   * Get purge audit records for a specific policy
   */
  async getPurgeAuditRecordsByPolicy(
    policyId: string,
    limit: number = 50,
    offset: number = 0,
  ): Promise<{ records: PurgeAudit[]; total: number }> {
    const [records, total] = await Promise.all([
      this.prisma.purgeAudit.findMany({
        where: { policyId },
        take: limit,
        skip: offset,
        orderBy: { executedAt: 'desc' },
        include: {
          policy: {
            select: {
              policyName: true,
              retentionDays: true,
              appliesTo: true,
            },
          },
          user: {
            select: {
              email: true,
              role: true,
            },
          },
        },
      }),
      this.prisma.purgeAudit.count({
        where: { policyId },
      }),
    ]);

    return { records, total };
  }

  /**
   * Validate retention days against hard cap
   */
  validateRetentionDays(retentionDays: number): boolean {
    return retentionDays >= 1 && retentionDays <= 7;
  }

  /**
   * Get retention statistics
   */
  async getRetentionStatistics(): Promise<{
    totalPolicies: number;
    activePolicies: number;
    totalPurgeOperations: number;
    lastPurgeDate: Date | null;
    averageRetentionDays: number;
  }> {
    const [
      totalPolicies,
      activePolicies,
      totalPurgeOperations,
      lastPurgeAudit,
      avgRetention,
    ] = await Promise.all([
      this.prisma.retentionPolicy.count(),
      this.prisma.retentionPolicy.count({ where: { isActive: true } }),
      this.prisma.purgeAudit.count(),
      this.prisma.purgeAudit.findFirst({
        orderBy: { executedAt: 'desc' },
        select: { executedAt: true },
      }),
      this.prisma.retentionPolicy.aggregate({
        where: { isActive: true },
        _avg: { retentionDays: true },
      }),
    ]);

    return {
      totalPolicies,
      activePolicies,
      totalPurgeOperations,
      lastPurgeDate: lastPurgeAudit?.executedAt || null,
      averageRetentionDays: Math.round(avgRetention._avg.retentionDays || 3),
    };
  }
}