import { Controller, Get, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/auth/guards/roles.guard';
import { Roles } from '@/auth/decorators/roles.decorator';
import { SecurityMonitoringService } from './security-monitoring.service';
import { register } from 'prom-client';

@ApiTags('Security')
@Controller({ path: 'security', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class SecurityController {
  constructor(
    private readonly securityMonitoringService: SecurityMonitoringService,
  ) {}

  @Get('metrics')
  @HttpCode(HttpStatus.OK)
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Get security metrics for monitoring dashboard' })
  @ApiResponse({
    status: 200,
    description: 'Security metrics retrieved successfully',
  })
  async getSecurityMetrics() {
    return this.securityMonitoringService.getSecurityMetrics();
  }

  @Get('prometheus-metrics')
  @HttpCode(HttpStatus.OK)
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Get Prometheus metrics for external monitoring' })
  @ApiResponse({
    status: 200,
    description: 'Prometheus metrics in text format',
    content: {
      'text/plain': {
        schema: {
          type: 'string',
        },
      },
    },
  })
  async getPrometheusMetrics() {
    return register.metrics();
  }
}