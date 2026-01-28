import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '@/audit/audit.service';

export interface SystemConfiguration {
  maxFixAttempts: number;
  cooldownWindow: number;
  sshTimeout: number;
  circuitBreakerThreshold: number;
  circuitBreakerTimeout: number;
  verificationTimeout: number;
  verificationRetryAttempts: number;
  defaultRetentionDays: number;
  maxRetentionDays: number;
}

export interface UpdateSystemConfigDto {
  maxFixAttempts?: number;
  cooldownWindow?: number;
  sshTimeout?: number;
  circuitBreakerThreshold?: number;
  circuitBreakerTimeout?: number;
  verificationTimeout?: number;
  verificationRetryAttempts?: number;
  defaultRetentionDays?: number;
}

@Injectable()
export class SystemConfigService {
  private readonly logger = new Logger(SystemConfigService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Get current system configuration
   */
  getSystemConfiguration(): SystemConfiguration {
    return {
      maxFixAttempts: this.configService.get<number>('MAX_FIX_ATTEMPTS', 15),
      cooldownWindow: this.configService.get<number>('INCIDENT_COOLDOWN_WINDOW', 600),
      sshTimeout: this.configService.get<number>('SSH_CONNECTION_TIMEOUT', 30000) / 1000, // Convert to seconds
      circuitBreakerThreshold: this.configService.get<number>('CIRCUIT_BREAKER_THRESHOLD', 5),
      circuitBreakerTimeout: this.configService.get<number>('CIRCUIT_BREAKER_TIMEOUT', 300000) / 1000, // Convert to seconds
      verificationTimeout: this.configService.get<number>('VERIFICATION_TIMEOUT', 30000) / 1000, // Convert to seconds
      verificationRetryAttempts: this.configService.get<number>('VERIFICATION_RETRY_ATTEMPTS', 3),
      defaultRetentionDays: this.configService.get<number>('DEFAULT_RETENTION_DAYS', 3),
      maxRetentionDays: this.configService.get<number>('MAX_RETENTION_DAYS', 7),
    };
  }

  /**
   * Validate system configuration values
   */
  validateConfiguration(config: UpdateSystemConfigDto): string[] {
    const errors: string[] = [];

    if (config.maxFixAttempts !== undefined) {
      if (config.maxFixAttempts < 1 || config.maxFixAttempts > 20) {
        errors.push('Max fix attempts must be between 1 and 20');
      }
    }

    if (config.cooldownWindow !== undefined) {
      if (config.cooldownWindow < 60 || config.cooldownWindow > 3600) {
        errors.push('Cooldown window must be between 60 and 3600 seconds (1 minute to 1 hour)');
      }
    }

    if (config.sshTimeout !== undefined) {
      if (config.sshTimeout < 10 || config.sshTimeout > 120) {
        errors.push('SSH timeout must be between 10 and 120 seconds');
      }
    }

    if (config.circuitBreakerThreshold !== undefined) {
      if (config.circuitBreakerThreshold < 1 || config.circuitBreakerThreshold > 20) {
        errors.push('Circuit breaker threshold must be between 1 and 20');
      }
    }

    if (config.circuitBreakerTimeout !== undefined) {
      if (config.circuitBreakerTimeout < 30 || config.circuitBreakerTimeout > 3600) {
        errors.push('Circuit breaker timeout must be between 30 and 3600 seconds');
      }
    }

    if (config.verificationTimeout !== undefined) {
      if (config.verificationTimeout < 5 || config.verificationTimeout > 120) {
        errors.push('Verification timeout must be between 5 and 120 seconds');
      }
    }

    if (config.verificationRetryAttempts !== undefined) {
      if (config.verificationRetryAttempts < 1 || config.verificationRetryAttempts > 10) {
        errors.push('Verification retry attempts must be between 1 and 10');
      }
    }

    if (config.defaultRetentionDays !== undefined) {
      if (config.defaultRetentionDays < 1 || config.defaultRetentionDays > 7) {
        errors.push('Default retention days must be between 1 and 7');
      }
    }

    return errors;
  }

  /**
   * Update system configuration
   * Note: This is a mock implementation. In a real system, you would need
   * a mechanism to persist and reload configuration changes.
   */
  async updateSystemConfiguration(
    updates: UpdateSystemConfigDto,
    userId?: string,
  ): Promise<SystemConfiguration> {
    // Validate the configuration
    const validationErrors = this.validateConfiguration(updates);
    if (validationErrors.length > 0) {
      throw new BadRequestException(`Configuration validation failed: ${validationErrors.join(', ')}`);
    }

    // Get current configuration
    const currentConfig = this.getSystemConfiguration();

    // Create audit record for the configuration change
    await this.auditService.createAuditEvent({
      userId,
      action: 'UPDATE_SYSTEM_CONFIGURATION',
      resource: 'system_config',
      resourceId: 'system',
      details: {
        previousValues: currentConfig,
        newValues: updates,
        changes: Object.keys(updates),
      },
    });

    this.logger.log('System configuration update requested', {
      updates,
      userId,
      validationErrors: validationErrors.length,
    });

    // In a real implementation, you would:
    // 1. Store the configuration in a database table
    // 2. Update environment variables or configuration files
    // 3. Notify other services of the configuration change
    // 4. Potentially restart services that need the new configuration

    // For now, we'll return the updated configuration as if it was applied
    return {
      ...currentConfig,
      ...updates,
    };
  }

  /**
   * Get system health status based on configuration
   */
  getSystemHealthStatus(): {
    status: 'HEALTHY' | 'WARNING' | 'CRITICAL';
    checks: Array<{
      name: string;
      status: 'PASS' | 'WARN' | 'FAIL';
      message: string;
    }>;
  } {
    const config = this.getSystemConfiguration();
    const checks = [];

    // Check if retention days are reasonable
    if (config.defaultRetentionDays <= 1) {
      checks.push({
        name: 'Retention Policy',
        status: 'WARN' as const,
        message: 'Very aggressive retention period (1 day) may cause data loss',
      });
    } else {
      checks.push({
        name: 'Retention Policy',
        status: 'PASS' as const,
        message: `Retention period: ${config.defaultRetentionDays} days`,
      });
    }

    // Check if fix attempts are reasonable
    if (config.maxFixAttempts > 15) {
      checks.push({
        name: 'Fix Attempts',
        status: 'WARN' as const,
        message: 'High max fix attempts may cause prolonged incident resolution',
      });
    } else {
      checks.push({
        name: 'Fix Attempts',
        status: 'PASS' as const,
        message: `Max fix attempts: ${config.maxFixAttempts}`,
      });
    }

    // Check SSH timeout
    if (config.sshTimeout < 20) {
      checks.push({
        name: 'SSH Timeout',
        status: 'WARN' as const,
        message: 'Low SSH timeout may cause connection failures',
      });
    } else {
      checks.push({
        name: 'SSH Timeout',
        status: 'PASS' as const,
        message: `SSH timeout: ${config.sshTimeout}s`,
      });
    }

    // Check cooldown window
    if (config.cooldownWindow < 300) {
      checks.push({
        name: 'Cooldown Window',
        status: 'WARN' as const,
        message: 'Short cooldown window may not prevent flapping effectively',
      });
    } else {
      checks.push({
        name: 'Cooldown Window',
        status: 'PASS' as const,
        message: `Cooldown window: ${config.cooldownWindow}s`,
      });
    }

    // Determine overall status
    const warnCount = checks.filter(c => c.status === 'WARN').length;

    let status: 'HEALTHY' | 'WARNING' | 'CRITICAL' = 'HEALTHY';
    if (warnCount > 0) {
      status = 'WARNING';
    }

    return { status, checks };
  }

  /**
   * Get configuration recommendations
   */
  getConfigurationRecommendations(): Array<{
    category: string;
    recommendation: string;
    priority: 'LOW' | 'MEDIUM' | 'HIGH';
    currentValue?: any;
    recommendedValue?: any;
  }> {
    const config = this.getSystemConfiguration();
    const recommendations = [];

    // Retention recommendations
    if (config.defaultRetentionDays <= 1) {
      recommendations.push({
        category: 'Data Retention',
        recommendation: 'Consider increasing retention period to at least 3 days for better incident analysis',
        priority: 'MEDIUM' as const,
        currentValue: config.defaultRetentionDays,
        recommendedValue: 3,
      });
    }

    // SSH timeout recommendations
    if (config.sshTimeout < 30) {
      recommendations.push({
        category: 'SSH Configuration',
        recommendation: 'Increase SSH timeout to prevent connection failures on slow networks',
        priority: 'LOW' as const,
        currentValue: config.sshTimeout,
        recommendedValue: 30,
      });
    }

    // Circuit breaker recommendations
    if (config.circuitBreakerThreshold > 10) {
      recommendations.push({
        category: 'Circuit Breaker',
        recommendation: 'Lower circuit breaker threshold to fail fast and prevent cascading failures',
        priority: 'MEDIUM' as const,
        currentValue: config.circuitBreakerThreshold,
        recommendedValue: 5,
      });
    }

    // Cooldown recommendations
    if (config.cooldownWindow < 600) {
      recommendations.push({
        category: 'Incident Management',
        recommendation: 'Increase cooldown window to 10 minutes to prevent incident flapping',
        priority: 'MEDIUM' as const,
        currentValue: config.cooldownWindow,
        recommendedValue: 600,
      });
    }

    return recommendations;
  }
}