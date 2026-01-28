import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/auth/guards/roles.guard';
import { Roles } from '@/auth/decorators/roles.decorator';
import { MonitoringService } from './monitoring.service';
import { PerformanceMonitoringService } from './performance-monitoring.service';
import { SystemMetricsService } from './system-metrics.service';
import { ErrorTrackingService } from './error-tracking.service';
import { HealthCheckService } from './health-check.service';
import { register } from 'prom-client';

@ApiTags('monitoring')
@Controller({ path: 'monitoring', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class MonitoringController {
  constructor(
    private readonly monitoringService: MonitoringService,
    private readonly performanceService: PerformanceMonitoringService,
    private readonly systemMetricsService: SystemMetricsService,
    private readonly errorTrackingService: ErrorTrackingService,
    private readonly healthCheckService: HealthCheckService,
  ) {}

  @Get('dashboard')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER', 'VIEWER')
  @ApiOperation({ summary: 'Get comprehensive monitoring dashboard data' })
  @ApiResponse({
    status: 200,
    description: 'Monitoring dashboard data retrieved successfully',
  })
  async getMonitoringDashboard() {
    const dashboard = await this.monitoringService.getMonitoringDashboard();
    
    return {
      success: true,
      data: dashboard,
      timestamp: new Date().toISOString(),
    };
  }

  @Get('health')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get detailed health check status' })
  @ApiResponse({
    status: 200,
    description: 'Health check completed successfully',
  })
  async getHealthCheck() {
    const health = await this.healthCheckService.performHealthCheck();
    
    return {
      success: true,
      data: health,
    };
  }

  @Get('health/simple')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get simple health status for load balancers' })
  @ApiResponse({
    status: 200,
    description: 'Simple health check completed successfully',
  })
  async getSimpleHealthCheck() {
    const health = await this.healthCheckService.getSimpleHealthStatus();
    
    return health;
  }

  @Get('performance')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER', 'VIEWER')
  @ApiOperation({ summary: 'Get application performance metrics' })
  @ApiResponse({
    status: 200,
    description: 'Performance metrics retrieved successfully',
  })
  async getPerformanceMetrics() {
    const metrics = await this.performanceService.getPerformanceMetrics();
    
    return {
      success: true,
      data: metrics,
      timestamp: new Date().toISOString(),
    };
  }

  @Get('performance/detailed')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER')
  @ApiOperation({ summary: 'Get detailed performance statistics' })
  @ApiResponse({
    status: 200,
    description: 'Detailed performance statistics retrieved successfully',
  })
  async getDetailedPerformanceStats() {
    const stats = await this.performanceService.getDetailedPerformanceStats();
    
    return {
      success: true,
      data: stats,
      timestamp: new Date().toISOString(),
    };
  }

  @Get('infrastructure')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER', 'VIEWER')
  @ApiOperation({ summary: 'Get infrastructure metrics' })
  @ApiResponse({
    status: 200,
    description: 'Infrastructure metrics retrieved successfully',
  })
  async getInfrastructureMetrics() {
    const metrics = await this.systemMetricsService.getInfrastructureMetrics();
    
    return {
      success: true,
      data: metrics,
      timestamp: new Date().toISOString(),
    };
  }

  @Get('system/resources')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER')
  @ApiOperation({ summary: 'Get system resource usage' })
  @ApiResponse({
    status: 200,
    description: 'System resource usage retrieved successfully',
  })
  async getSystemResources() {
    const resources = await this.systemMetricsService.getSystemResourceSummary();
    
    return {
      success: true,
      data: resources,
      timestamp: new Date().toISOString(),
    };
  }

  @Get('system/info')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER')
  @ApiOperation({ summary: 'Get system information' })
  @ApiResponse({
    status: 200,
    description: 'System information retrieved successfully',
  })
  async getSystemInfo() {
    const info = await this.systemMetricsService.getSystemInfo();
    
    return {
      success: true,
      data: info,
      timestamp: new Date().toISOString(),
    };
  }

  @Get('errors/statistics')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER', 'VIEWER')
  @ApiOperation({ summary: 'Get error statistics' })
  @ApiResponse({
    status: 200,
    description: 'Error statistics retrieved successfully',
  })
  async getErrorStatistics() {
    const stats = await this.errorTrackingService.getErrorStatistics();
    
    return {
      success: true,
      data: stats,
      timestamp: new Date().toISOString(),
    };
  }

  @Get('errors/:errorId')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER')
  @ApiOperation({ summary: 'Get detailed error information' })
  @ApiResponse({
    status: 200,
    description: 'Error details retrieved successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Error not found',
  })
  async getErrorDetails(@Param('errorId') errorId: string) {
    const error = await this.errorTrackingService.getErrorDetails(errorId);
    
    if (!error) {
      return {
        success: false,
        message: 'Error not found',
      };
    }
    
    return {
      success: true,
      data: error,
    };
  }

  @Post('errors/:errorId/resolve')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER')
  @ApiOperation({ summary: 'Mark an error as resolved' })
  @ApiResponse({
    status: 200,
    description: 'Error marked as resolved successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Error not found',
  })
  async resolveError(
    @Param('errorId') errorId: string,
    @Body() body: { resolutionNotes?: string },
  ) {
    try {
      await this.errorTrackingService.resolveError(errorId, body.resolutionNotes);
      
      return {
        success: true,
        message: 'Error marked as resolved',
      };
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  @Get('prometheus')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get Prometheus metrics in text format' })
  @ApiResponse({
    status: 200,
    description: 'Prometheus metrics retrieved successfully',
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

  @Get('alerts')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER', 'VIEWER')
  @ApiOperation({ summary: 'Get current system alerts' })
  @ApiResponse({
    status: 200,
    description: 'System alerts retrieved successfully',
  })
  async getSystemAlerts() {
    // Get alerts from the dashboard data
    const dashboard = await this.monitoringService.getMonitoringDashboard();
    
    return {
      success: true,
      data: {
        alerts: dashboard.alerts,
        summary: {
          total: dashboard.alerts.length,
          critical: dashboard.alerts.filter(a => a.severity === 'critical').length,
          high: dashboard.alerts.filter(a => a.severity === 'high').length,
          medium: dashboard.alerts.filter(a => a.severity === 'medium').length,
          low: dashboard.alerts.filter(a => a.severity === 'low').length,
        },
      },
      timestamp: new Date().toISOString(),
    };
  }

  @Get('status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get overall system status' })
  @ApiResponse({
    status: 200,
    description: 'System status retrieved successfully',
  })
  async getSystemStatus() {
    const [health, dashboard] = await Promise.all([
      this.monitoringService.getHealthCheck(),
      this.monitoringService.getMonitoringDashboard(),
    ]);

    return {
      success: true,
      data: {
        status: health.status,
        systemHealth: dashboard.system.status,
        uptime: dashboard.system.uptime,
        version: dashboard.system.version,
        environment: dashboard.system.environment,
        components: health.checks,
        activeIncidents: dashboard.incidents.active,
        criticalAlerts: dashboard.alerts.filter(a => a.severity === 'critical').length,
      },
      timestamp: new Date().toISOString(),
    };
  }
}