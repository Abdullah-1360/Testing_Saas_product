import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AppService } from './app.service';
import { Public } from '@/auth/decorators/public.decorator';
import { ApiVersion } from '@/common/decorators/api-version.decorator';

@ApiTags('health')
@Controller({ version: '1' })
@ApiVersion({ version: '1', description: 'Health and system information endpoints' })
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Get application information' })
  @ApiResponse({ 
    status: 200, 
    description: 'Application information retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 200 },
        message: { type: 'string', example: 'Application information retrieved successfully' },
        data: {
          type: 'object',
          properties: {
            name: { type: 'string', example: 'WP-AutoHealer' },
            version: { type: 'string', example: '1.0.0' },
            description: { type: 'string', example: 'Production-grade WordPress self-healing system' },
            environment: { type: 'string', example: 'production' },
            timestamp: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
          },
        },
        timestamp: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
        correlationId: { type: 'string', example: '1705315800000-abc123def' },
      },
    },
  })
  getAppInfo(): Record<string, any> {
    const appInfo = this.appService.getAppInfo();
    return {
      statusCode: 200,
      message: 'Application information retrieved successfully',
      data: appInfo,
      timestamp: new Date().toISOString(),
    };
  }

  @Public()
  @Get('health')
  @ApiOperation({ summary: 'Health check endpoint' })
  @ApiResponse({ 
    status: 200, 
    description: 'Service is healthy',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 200 },
        message: { type: 'string', example: 'Health check successful' },
        data: {
          type: 'object',
          properties: {
            status: { type: 'string', example: 'healthy' },
            timestamp: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
            uptime: { type: 'number', example: 3600 },
            environment: { type: 'string', example: 'production' },
          },
        },
        timestamp: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
        correlationId: { type: 'string', example: '1705315800000-abc123def' },
      },
    },
  })
  getHealth(): Record<string, any> {
    const health = this.appService.getHealth();
    return {
      statusCode: 200,
      message: 'Health check successful',
      data: health,
      timestamp: new Date().toISOString(),
    };
  }

  @Public()
  @Get('version')
  @ApiOperation({ summary: 'Get API version' })
  @ApiResponse({ 
    status: 200, 
    description: 'API version retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 200 },
        message: { type: 'string', example: 'Version information retrieved successfully' },
        data: {
          type: 'object',
          properties: {
            version: { type: 'string', example: '1.0.0' },
            apiVersion: { type: 'string', example: 'v1' },
          },
        },
        timestamp: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
        correlationId: { type: 'string', example: '1705315800000-abc123def' },
      },
    },
  })
  getVersion(): Record<string, any> {
    const version = this.appService.getVersion();
    return {
      statusCode: 200,
      message: 'Version information retrieved successfully',
      data: version,
      timestamp: new Date().toISOString(),
    };
  }
}