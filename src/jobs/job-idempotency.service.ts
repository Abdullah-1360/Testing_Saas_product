import { Injectable, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { RedisConfigService } from '@/config/redis.config';

export interface IdempotencyKey {
  incidentId: string;
  state: string;
  attempt: number;
  checksum?: string;
}

export interface IdempotencyResult {
  isIdempotent: boolean;
  existingResult?: any;
  key: string;
}

export interface JobCheckpoint {
  incidentId: string;
  state: string;
  attempt: number;
  progress: number;
  data: any;
  timestamp: Date;
  checksum: string;
}

@Injectable()
export class JobIdempotencyService {
  private readonly logger = new Logger(JobIdempotencyService.name);
  private redis: Redis;
  private readonly keyPrefix = 'wp-autohealer:idempotency';
  private readonly checkpointPrefix = 'wp-autohealer:checkpoint';
  private readonly defaultTtl = 24 * 60 * 60; // 24 hours in seconds

  constructor(private readonly redisConfig: RedisConfigService) {
    this.redis = this.redisConfig.createRedisConnection();
  }

  /**
   * Generate idempotency key for a job
   */
  generateIdempotencyKey(
    incidentId: string,
    state: string,
    attempt: number,
    data?: any
  ): string {
    const checksum = data ? this.generateChecksum(data) : '';
    return `${this.keyPrefix}:${incidentId}:${state}:${attempt}:${checksum}`;
  }

  /**
   * Check if a job execution is idempotent (already completed)
   */
  async checkIdempotency(
    incidentId: string,
    state: string,
    attempt: number,
    data?: any
  ): Promise<IdempotencyResult> {
    const key = this.generateIdempotencyKey(incidentId, state, attempt, data);
    
    try {
      const existingResult = await this.redis.get(key);
      
      if (existingResult) {
        this.logger.log(`Found idempotent result for ${incidentId}:${state}:${attempt}`, {
          key,
        });
        
        return {
          isIdempotent: true,
          existingResult: JSON.parse(existingResult),
          key,
        };
      }

      return {
        isIdempotent: false,
        key,
      };
    } catch (error) {
      this.logger.error(`Error checking idempotency for ${key}:`, error);
      // On error, assume not idempotent to allow execution
      return {
        isIdempotent: false,
        key,
      };
    }
  }

  /**
   * Store job result for idempotency
   */
  async storeResult(
    key: string,
    result: any,
    ttlSeconds: number = this.defaultTtl
  ): Promise<void> {
    try {
      await this.redis.setex(key, ttlSeconds, JSON.stringify(result));
      
      this.logger.log(`Stored idempotent result with key ${key}`, {
        ttl: ttlSeconds,
      });
    } catch (error) {
      this.logger.error(`Error storing idempotent result for ${key}:`, error);
      // Don't throw - idempotency storage failure shouldn't break the job
    }
  }

  /**
   * Create a checkpoint for job resumability
   */
  async createCheckpoint(
    incidentId: string,
    state: string,
    attempt: number,
    progress: number,
    data: any
  ): Promise<void> {
    const checkpoint: JobCheckpoint = {
      incidentId,
      state,
      attempt,
      progress,
      data,
      timestamp: new Date(),
      checksum: this.generateChecksum(data),
    };

    const key = `${this.checkpointPrefix}:${incidentId}:${state}:${attempt}`;

    try {
      await this.redis.setex(key, this.defaultTtl, JSON.stringify(checkpoint));
      
      this.logger.log(`Created checkpoint for ${incidentId}:${state}:${attempt}`, {
        progress,
        key,
      });
    } catch (error) {
      this.logger.error(`Error creating checkpoint for ${key}:`, error);
    }
  }

  /**
   * Get the latest checkpoint for resuming a job
   */
  async getLatestCheckpoint(
    incidentId: string,
    state: string,
    attempt: number
  ): Promise<JobCheckpoint | null> {
    const key = `${this.checkpointPrefix}:${incidentId}:${state}:${attempt}`;

    try {
      const checkpointData = await this.redis.get(key);
      
      if (checkpointData) {
        const checkpoint = JSON.parse(checkpointData);
        checkpoint.timestamp = new Date(checkpoint.timestamp);
        
        this.logger.log(`Retrieved checkpoint for ${incidentId}:${state}:${attempt}`, {
          progress: checkpoint.progress,
          timestamp: checkpoint.timestamp,
        });
        
        return checkpoint;
      }

      return null;
    } catch (error) {
      this.logger.error(`Error retrieving checkpoint for ${key}:`, error);
      return null;
    }
  }

  /**
   * Get all checkpoints for an incident (for debugging/monitoring)
   */
  async getIncidentCheckpoints(incidentId: string): Promise<JobCheckpoint[]> {
    const pattern = `${this.checkpointPrefix}:${incidentId}:*`;
    
    try {
      const keys = await this.redis.keys(pattern);
      const checkpoints: JobCheckpoint[] = [];

      for (const key of keys) {
        const checkpointData = await this.redis.get(key);
        if (checkpointData) {
          const checkpoint = JSON.parse(checkpointData);
          checkpoint.timestamp = new Date(checkpoint.timestamp);
          checkpoints.push(checkpoint);
        }
      }

      // Sort by timestamp
      checkpoints.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      
      return checkpoints;
    } catch (error) {
      this.logger.error(`Error retrieving checkpoints for incident ${incidentId}:`, error);
      return [];
    }
  }

  /**
   * Clean up old idempotency keys and checkpoints
   */
  async cleanup(olderThanHours: number = 48): Promise<void> {
    const cutoffTime = Date.now() - (olderThanHours * 60 * 60 * 1000);
    
    try {
      // Clean up idempotency keys
      const idempotencyPattern = `${this.keyPrefix}:*`;
      const idempotencyKeys = await this.redis.keys(idempotencyPattern);
      
      let cleanedIdempotency = 0;
      for (const key of idempotencyKeys) {
        const ttl = await this.redis.ttl(key);
        // If TTL is very low or key is expired, clean it up
        if (ttl < 3600) { // Less than 1 hour TTL remaining
          await this.redis.del(key);
          cleanedIdempotency++;
        }
      }

      // Clean up checkpoints
      const checkpointPattern = `${this.checkpointPrefix}:*`;
      const checkpointKeys = await this.redis.keys(checkpointPattern);
      
      let cleanedCheckpoints = 0;
      for (const key of checkpointKeys) {
        const checkpointData = await this.redis.get(key);
        if (checkpointData) {
          const checkpoint = JSON.parse(checkpointData);
          const checkpointTime = new Date(checkpoint.timestamp).getTime();
          
          if (checkpointTime < cutoffTime) {
            await this.redis.del(key);
            cleanedCheckpoints++;
          }
        }
      }

      this.logger.log(`Cleanup completed`, {
        cleanedIdempotency,
        cleanedCheckpoints,
        olderThanHours,
      });
    } catch (error) {
      this.logger.error('Error during cleanup:', error);
    }
  }

  /**
   * Clear all data for a specific incident (e.g., after successful completion)
   */
  async clearIncidentData(incidentId: string): Promise<void> {
    try {
      // Clear idempotency keys
      const idempotencyPattern = `${this.keyPrefix}:${incidentId}:*`;
      const idempotencyKeys = await this.redis.keys(idempotencyPattern);
      
      if (idempotencyKeys.length > 0) {
        await this.redis.del(...idempotencyKeys);
      }

      // Clear checkpoints
      const checkpointPattern = `${this.checkpointPrefix}:${incidentId}:*`;
      const checkpointKeys = await this.redis.keys(checkpointPattern);
      
      if (checkpointKeys.length > 0) {
        await this.redis.del(...checkpointKeys);
      }

      this.logger.log(`Cleared all idempotency data for incident ${incidentId}`, {
        idempotencyKeys: idempotencyKeys.length,
        checkpointKeys: checkpointKeys.length,
      });
    } catch (error) {
      this.logger.error(`Error clearing data for incident ${incidentId}:`, error);
    }
  }

  /**
   * Get statistics about idempotency usage
   */
  async getStats(): Promise<{
    idempotencyKeys: number;
    checkpoints: number;
    totalMemoryUsage: number;
  }> {
    try {
      const [idempotencyKeys, checkpointKeys] = await Promise.all([
        this.redis.keys(`${this.keyPrefix}:*`),
        this.redis.keys(`${this.checkpointPrefix}:*`),
      ]);

      // Estimate memory usage (rough calculation)
      let totalMemoryUsage = 0;
      const sampleKeys = [...idempotencyKeys.slice(0, 10), ...checkpointKeys.slice(0, 10)];
      
      for (const key of sampleKeys) {
        const value = await this.redis.get(key);
        if (value) {
          totalMemoryUsage += key.length + value.length;
        }
      }

      // Extrapolate total memory usage
      const totalKeys = idempotencyKeys.length + checkpointKeys.length;
      if (sampleKeys.length > 0) {
        totalMemoryUsage = (totalMemoryUsage / sampleKeys.length) * totalKeys;
      }

      return {
        idempotencyKeys: idempotencyKeys.length,
        checkpoints: checkpointKeys.length,
        totalMemoryUsage: Math.round(totalMemoryUsage),
      };
    } catch (error) {
      this.logger.error('Error getting idempotency stats:', error);
      return {
        idempotencyKeys: 0,
        checkpoints: 0,
        totalMemoryUsage: 0,
      };
    }
  }

  /**
   * Generate checksum for data consistency
   */
  private generateChecksum(data: any): string {
    const crypto = require('crypto');
    const serialized = JSON.stringify(data, Object.keys(data).sort());
    return crypto.createHash('sha256').update(serialized).digest('hex').substring(0, 16);
  }

  /**
   * Close Redis connection
   */
  async close(): Promise<void> {
    if (this.redis) {
      await this.redis.quit();
    }
  }
}