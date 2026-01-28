import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(configService: ConfigService) {
    const databaseUrl = configService.get<string>('DATABASE_URL');
    if (!databaseUrl) {
      throw new Error('DATABASE_URL is required');
    }

    super({
      datasources: {
        db: {
          url: databaseUrl,
        },
      },
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
      this.logger.log('Successfully connected to database');
    } catch (error) {
      this.logger.error('Failed to connect to database', error);
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.$disconnect();
      this.logger.log('Disconnected from database');
    } catch (error) {
      this.logger.error('Error disconnecting from database', error);
    }
  }

  /**
   * Health check for database connection
   */
  async healthCheck(): Promise<{ status: string; timestamp: string }> {
    try {
      await this.$queryRaw`SELECT 1`;
      return {
        status: 'healthy',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error('Database health check failed', error);
      return {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
      };
    }
  }
}