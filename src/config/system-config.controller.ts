import {
  Controller,
  Get,
  Put,
  Body,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
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
import { SystemConfigService, UpdateSystemConfigDto } from './system-config.service';

@ApiTags('System Configuration')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller({ path: 'system/config', version: '1' })
export class SystemConfigController {
  constructor(private readonly systemConfigService: SystemConfigService) {}

  @Get()
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER', 'VIEWER')
  @ApiOperation({ summary: 'Get current system configuration' })
  @ApiResponse({ status: 200, description: 'System configuration retrieved successfully' })
  async getSystemConfiguration() {
    const config = this.systemConfigService.getSystemConfiguration();

    return {
      success: true,
      data: config,
      message: 'System configuration retrieved successfully',
    };
  }

  @Put()
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Update system configuration' })
  @ApiResponse({ status: 200, description: 'System configuration updated successfully' })
  @ApiResponse({ status: 400, description: 'Invalid configuration values' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @HttpCode(HttpStatus.OK)
  async updateSystemConfiguration(
    @Body() updateDto: UpdateSystemConfigDto,
    @Request() req: any,
  ) {
    const updatedConfig = await this.systemConfigService.updateSystemConfiguration(
      updateDto,
      req.user?.id,
    );

    return {
      success: true,
      data: updatedConfig,
      message: 'System configuration updated successfully',
    };
  }

  @Get('validate')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER')
  @ApiOperation({ summary: 'Validate system configuration values' })
  @ApiResponse({ status: 200, description: 'Configuration validation completed' })
  async validateConfiguration(@Body() config: UpdateSystemConfigDto) {
    const errors = this.systemConfigService.validateConfiguration(config);

    return {
      success: true,
      data: {
        isValid: errors.length === 0,
        errors,
        config,
      },
      message: errors.length === 0 ? 'Configuration is valid' : 'Configuration validation failed',
    };
  }

  @Get('health')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER', 'VIEWER')
  @ApiOperation({ summary: 'Get system health status based on configuration' })
  @ApiResponse({ status: 200, description: 'System health status retrieved successfully' })
  async getSystemHealthStatus() {
    const healthStatus = this.systemConfigService.getSystemHealthStatus();

    return {
      success: true,
      data: healthStatus,
      message: 'System health status retrieved successfully',
    };
  }

  @Get('recommendations')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER', 'VIEWER')
  @ApiOperation({ summary: 'Get configuration recommendations' })
  @ApiResponse({ status: 200, description: 'Configuration recommendations retrieved successfully' })
  async getConfigurationRecommendations() {
    const recommendations = this.systemConfigService.getConfigurationRecommendations();

    return {
      success: true,
      data: recommendations,
      message: 'Configuration recommendations retrieved successfully',
    };
  }

  @Get('defaults')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER', 'VIEWER')
  @ApiOperation({ summary: 'Get default system configuration values' })
  @ApiResponse({ status: 200, description: 'Default configuration values retrieved successfully' })
  async getDefaultConfiguration() {
    // Return the default values as defined in the validation schema
    const defaults = {
      maxFixAttempts: 15,
      cooldownWindow: 600, // 10 minutes
      sshTimeout: 30, // 30 seconds
      circuitBreakerThreshold: 5,
      circuitBreakerTimeout: 300, // 5 minutes
      verificationTimeout: 30, // 30 seconds
      verificationRetryAttempts: 3,
      defaultRetentionDays: 3,
      maxRetentionDays: 7,
    };

    return {
      success: true,
      data: defaults,
      message: 'Default configuration values retrieved successfully',
    };
  }

  @Put('reset')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Reset system configuration to defaults' })
  @ApiResponse({ status: 200, description: 'System configuration reset to defaults successfully' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @HttpCode(HttpStatus.OK)
  async resetToDefaults(@Request() req: any) {
    const defaults = {
      maxFixAttempts: 15,
      cooldownWindow: 600,
      sshTimeout: 30,
      circuitBreakerThreshold: 5,
      circuitBreakerTimeout: 300,
      verificationTimeout: 30,
      verificationRetryAttempts: 3,
      defaultRetentionDays: 3,
    };

    const resetConfig = await this.systemConfigService.updateSystemConfiguration(
      defaults,
      req.user?.id,
    );

    return {
      success: true,
      data: resetConfig,
      message: 'System configuration reset to defaults successfully',
    };
  }
}