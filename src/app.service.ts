import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AppService {
  constructor(private readonly configService: ConfigService) {}

  getAppInfo(): Record<string, string> {
    return {
      name: 'WP-AutoHealer',
      version: '1.0.0',
      description: 'Production-grade WordPress self-healing system',
      environment: this.configService.get<string>('NODE_ENV', 'development'),
      timestamp: new Date().toISOString(),
    };
  }

  getHealth(): Record<string, string | number> {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: this.configService.get<string>('NODE_ENV', 'development'),
    };
  }

  getVersion(): Record<string, string> {
    return {
      version: '1.0.0',
      apiVersion: this.configService.get<string>('API_VERSION', 'v1'),
    };
  }
}