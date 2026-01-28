import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis, RedisOptions } from 'ioredis';

@Injectable()
export class RedisConfigService {
  constructor(private readonly configService: ConfigService) {}

  /**
   * Get Redis connection options from environment configuration
   */
  getRedisOptions(): RedisOptions {
    const redisUrl = this.configService.get<string>('REDIS_URL');
    const redisPassword = this.configService.get<string>('REDIS_PASSWORD');

    if (!redisUrl) {
      throw new Error('REDIS_URL is required but not configured');
    }

    // Parse Redis URL
    const url = new URL(redisUrl);
    
    const options: RedisOptions = {
      host: url.hostname,
      port: parseInt(url.port) || 6379,
      db: parseInt(url.pathname.slice(1)) || 0,
      enableReadyCheck: true,
      maxRetriesPerRequest: null, // Required by BullMQ
      lazyConnect: false,
      keepAlive: 30000,
      connectTimeout: 10000,
      // Connection pool settings
      family: 4, // IPv4
      // Retry strategy with exponential backoff
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      // Reconnect on error
      reconnectOnError: (err: Error) => {
        const targetError = 'READONLY';
        return err.message.includes(targetError);
      },
    };

    // Set password if provided in URL or environment
    if (url.password) {
      options.password = url.password;
    } else if (redisPassword) {
      options.password = redisPassword;
    }

    return options;
  }

  /**
   * Create a new Redis connection instance
   */
  createRedisConnection(): Redis {
    const options = this.getRedisOptions();
    const redis = new Redis(options);

    // Set up event handlers for monitoring
    redis.on('connect', () => {
      console.log('Redis connection established');
    });

    redis.on('ready', () => {
      console.log('Redis connection ready');
    });

    redis.on('error', (error) => {
      console.error('Redis connection error:', error);
    });

    redis.on('close', () => {
      console.log('Redis connection closed');
    });

    redis.on('reconnecting', () => {
      console.log('Redis reconnecting...');
    });

    return redis;
  }

  /**
   * Get BullMQ connection options
   */
  getBullMQConnectionOptions() {
    return {
      connection: this.getRedisOptions(),
    };
  }

  /**
   * Get default job options for BullMQ queues
   */
  getDefaultJobOptions() {
    return {
      removeOnComplete: 100, // Keep last 100 completed jobs
      removeOnFail: 50, // Keep last 50 failed jobs
      attempts: 3, // Default retry attempts
      backoff: {
        type: 'exponential',
        delay: 2000, // Start with 2 second delay
      },
      delay: 0, // No initial delay
    };
  }

  /**
   * Get incident processing job options with specific retry policies
   */
  getIncidentJobOptions() {
    const maxFixAttempts = this.configService.get<number>('MAX_FIX_ATTEMPTS', 15);
    const circuitBreakerThreshold = this.configService.get<number>('CIRCUIT_BREAKER_THRESHOLD', 5);
    
    return {
      ...this.getDefaultJobOptions(),
      attempts: Math.min(maxFixAttempts, circuitBreakerThreshold), // Limit retries based on circuit breaker
      backoff: {
        type: 'exponential',
        delay: 5000, // Start with 5 second delay for incidents
      },
      // Job timeout based on SSH timeouts
      timeout: this.configService.get<number>('SSH_COMMAND_TIMEOUT', 60000) * 2, // 2x SSH timeout
    };
  }

  /**
   * Get queue options for different queue types
   */
  getQueueOptions(queueName: string) {
    const baseOptions = {
      connection: this.getRedisOptions(),
      defaultJobOptions: this.getDefaultJobOptions(),
    };

    switch (queueName) {
      case 'incident-processing':
        return {
          ...baseOptions,
          defaultJobOptions: this.getIncidentJobOptions(),
        };
      case 'data-retention':
        return {
          ...baseOptions,
          defaultJobOptions: {
            ...this.getDefaultJobOptions(),
            attempts: 2, // Fewer retries for cleanup jobs
            backoff: {
              type: 'fixed',
              delay: 10000, // 10 second fixed delay
            },
          },
        };
      case 'health-checks':
        return {
          ...baseOptions,
          defaultJobOptions: {
            ...this.getDefaultJobOptions(),
            attempts: 2, // Fewer retries for health checks
            backoff: {
              type: 'fixed',
              delay: 30000, // 30 second fixed delay
            },
          },
        };
      default:
        return baseOptions;
    }
  }
}