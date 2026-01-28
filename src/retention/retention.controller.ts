import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/auth/guards/roles.guard';
import { Roles } from '@/auth/decorators/roles.decorator';
import { RetentionService } from './retention.service';
import { PurgeService } from './purge.service';
import { AnonymizationService } from './anonymization.service';
import { PurgeSchedulerService } from './purge-scheduler.service';
import { ScheduledPurgeManagerService } from './scheduled-purge-manager.service';
import { PurgeValidationService } from './purge-validation.service';
import { CreateRetentionPolicyDto, UpdateRetentionPolicyDto, ManualPurgeDto, AnonymizationDto, PurgeScope } from './dto';

@ApiTags('Retention Management')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller({ path: 'retention', version: '1' })
export class RetentionController {
  constructor(
    private readonly retentionService: RetentionService,
    private readonly purgeService: PurgeService,
    private readonly anonymizationService: AnonymizationService,
    private readonly purgeSchedulerService: PurgeSchedulerService,
    private readonly scheduledPurgeManager: ScheduledPurgeManagerService,
    private readonly purgeValidation: PurgeValidationService,
  ) {}

  @Post('policies')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Create a new retention policy' })
  @ApiResponse({ status: 201, description: 'Retention policy created successfully' })
  @ApiResponse({ status: 400, description: 'Invalid retention policy data or hard cap violation' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async createRetentionPolicy(
    @Body() createDto: CreateRetentionPolicyDto,
    @Request() req: any,
  ) {
    const policy = await this.retentionService.createRetentionPolicy(
      createDto,
      req.user?.id,
    );

    return {
      success: true,
      message: 'Retention policy created successfully',
      data: policy,
    };
  }

  @Get('policies')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER', 'VIEWER')
  @ApiOperation({ summary: 'Get all retention policies' })
  @ApiResponse({ status: 200, description: 'Retention policies retrieved successfully' })
  @ApiQuery({ name: 'active', required: false, type: Boolean, description: 'Filter by active policies only' })
  async getRetentionPolicies(@Query('active') activeOnly?: boolean) {
    const policies = activeOnly
      ? await this.retentionService.getActiveRetentionPolicies()
      : await this.retentionService.getAllRetentionPolicies();

    return {
      success: true,
      data: policies,
      count: policies.length,
    };
  }

  @Get('policies/:id')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER', 'VIEWER')
  @ApiOperation({ summary: 'Get retention policy by ID' })
  @ApiParam({ name: 'id', description: 'Retention policy ID' })
  @ApiResponse({ status: 200, description: 'Retention policy retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Retention policy not found' })
  async getRetentionPolicyById(@Param('id') id: string) {
    const policy = await this.retentionService.getRetentionPolicyById(id);

    return {
      success: true,
      data: policy,
    };
  }

  @Put('policies/:id')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Update retention policy' })
  @ApiParam({ name: 'id', description: 'Retention policy ID' })
  @ApiResponse({ status: 200, description: 'Retention policy updated successfully' })
  @ApiResponse({ status: 400, description: 'Invalid update data or hard cap violation' })
  @ApiResponse({ status: 404, description: 'Retention policy not found' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async updateRetentionPolicy(
    @Param('id') id: string,
    @Body() updateDto: UpdateRetentionPolicyDto,
    @Request() req: any,
  ) {
    const policy = await this.retentionService.updateRetentionPolicy(
      id,
      updateDto,
      req.user?.id,
    );

    return {
      success: true,
      message: 'Retention policy updated successfully',
      data: policy,
    };
  }

  @Delete('policies/:id')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Delete retention policy' })
  @ApiParam({ name: 'id', description: 'Retention policy ID' })
  @ApiResponse({ status: 204, description: 'Retention policy deleted successfully' })
  @ApiResponse({ status: 404, description: 'Retention policy not found' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteRetentionPolicy(
    @Param('id') id: string,
    @Request() req: any,
  ) {
    await this.retentionService.deleteRetentionPolicy(id, req.user?.id);
  }

  @Post('purge/manual')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Execute enhanced manual data purge with advanced options' })
  @ApiResponse({ status: 200, description: 'Enhanced manual purge executed successfully' })
  @ApiResponse({ status: 400, description: 'Invalid purge parameters or hard cap violation' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async executeManualPurge(
    @Body() purgeDto: ManualPurgeDto,
    @Request() req: any,
  ) {
    const result = await this.purgeService.executeManualPurge(
      purgeDto,
      req.user?.id,
    );

    return {
      success: true,
      message: 'Enhanced manual purge executed successfully',
      data: result,
    };
  }

  @Post('purge/validate')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER')
  @ApiOperation({ summary: 'Validate purge operation parameters before execution' })
  @ApiResponse({ status: 200, description: 'Purge validation completed' })
  @ApiResponse({ status: 400, description: 'Invalid purge parameters' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async validatePurgeOperation(
    @Body() purgeDto: ManualPurgeDto,
  ) {
    const validation = await this.purgeValidation.validatePurgeOperation(purgeDto);

    return {
      success: true,
      message: 'Purge validation completed',
      data: validation,
    };
  }

  @Get('purge/estimate')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER', 'VIEWER')
  @ApiOperation({ summary: 'Estimate purge impact without execution' })
  @ApiResponse({ status: 200, description: 'Purge estimation completed' })
  @ApiQuery({ name: 'retentionDays', required: true, type: Number, description: 'Retention days (1-7)' })
  @ApiQuery({ name: 'tableName', required: false, type: String, description: 'Specific table name' })
  @ApiQuery({ name: 'purgeScope', required: false, enum: ['all', 'incidents', 'commands', 'evidence', 'backups', 'audit'] })
  async estimatePurgeImpact(
    @Query('retentionDays') retentionDays: number,
    @Query('tableName') tableName?: string,
    @Query('purgeScope') purgeScope?: string,
  ) {
    const estimationDto: ManualPurgeDto = {
      retentionDays: parseInt(retentionDays.toString()),
      tableName,
      purgeScope: purgeScope as any,
      dryRun: true,
    };

    const estimation = await this.purgeService.executeManualPurge(estimationDto);

    return {
      success: true,
      message: 'Purge estimation completed',
      data: {
        retentionDays: estimationDto.retentionDays,
        cutoffDate: new Date(Date.now() - estimationDto.retentionDays * 24 * 60 * 60 * 1000).toISOString(),
        estimatedRecordsPurged: estimation.totalRecordsPurged,
        tablesAffected: estimation.tablesProcessed,
        tableBreakdown: estimation.results,
        recommendations: this.generatePurgeRecommendations(estimation),
      },
    };
  }

  @Post('purge/schedule')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Schedule automatic data purge job' })
  @ApiResponse({ status: 200, description: 'Purge job scheduled successfully' })
  @ApiResponse({ status: 400, description: 'Invalid purge parameters' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async scheduleDataPurge(
    @Body() purgeDto: ManualPurgeDto,
    @Request() req: any,
  ) {
    // For now, execute the purge directly
    // In a production system, this would schedule a background job
    const result = await this.purgeService.executeManualPurge(
      purgeDto,
      req.user?.id,
    );

    return {
      success: true,
      message: 'Data purge executed successfully (direct execution)',
      data: result,
    };
  }

  @Get('audit/purge')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER', 'VIEWER')
  @ApiOperation({ summary: 'Get purge audit records' })
  @ApiResponse({ status: 200, description: 'Purge audit records retrieved successfully' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Number of records to return (default: 50)' })
  @ApiQuery({ name: 'offset', required: false, type: Number, description: 'Number of records to skip (default: 0)' })
  @ApiQuery({ name: 'policyId', required: false, type: String, description: 'Filter by policy ID' })
  async getPurgeAuditRecords(
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
    @Query('policyId') policyId?: string,
  ) {
    const result = policyId
      ? await this.retentionService.getPurgeAuditRecordsByPolicy(
          policyId,
          limit || 50,
          offset || 0,
        )
      : await this.retentionService.getPurgeAuditRecords(
          limit || 50,
          offset || 0,
        );

    return {
      success: true,
      data: result.records,
      pagination: {
        total: result.total,
        limit: limit || 50,
        offset: offset || 0,
        hasMore: (offset || 0) + (limit || 50) < result.total,
      },
    };
  }

  @Get('statistics')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER', 'VIEWER')
  @ApiOperation({ summary: 'Get retention system statistics' })
  @ApiResponse({ status: 200, description: 'Retention statistics retrieved successfully' })
  async getRetentionStatistics() {
    const stats = await this.retentionService.getRetentionStatistics();

    return {
      success: true,
      data: stats,
    };
  }

  @Post('validate/retention-days')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER')
  @ApiOperation({ summary: 'Validate retention days against hard cap' })
  @ApiResponse({ status: 200, description: 'Validation result returned' })
  @HttpCode(HttpStatus.OK)
  async validateRetentionDays(@Body() body: { retentionDays: number }) {
    const isValid = this.retentionService.validateRetentionDays(body.retentionDays);

    return {
      success: true,
      data: {
        retentionDays: body.retentionDays,
        isValid,
        hardCapMin: 1,
        hardCapMax: 7,
        message: isValid
          ? 'Retention days are within acceptable range'
          : 'Retention days must be between 1 and 7 days (hard cap enforcement)',
      },
    };
  }

  @Get('policies/default')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER', 'VIEWER')
  @ApiOperation({ summary: 'Get or create default retention policy' })
  @ApiResponse({ status: 200, description: 'Default retention policy retrieved/created successfully' })
  async getDefaultRetentionPolicy() {
    const policy = await this.retentionService.getOrCreateDefaultRetentionPolicy();

    return {
      success: true,
      data: policy,
      message: 'Default retention policy retrieved successfully',
    };
  }

  @Post('anonymize')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Execute data anonymization for compliance' })
  @ApiResponse({ status: 200, description: 'Data anonymization executed successfully' })
  @ApiResponse({ status: 400, description: 'Invalid anonymization parameters' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async executeDataAnonymization(
    @Body() anonymizationDto: AnonymizationDto,
    @Request() req: any,
  ) {
    const result = await this.anonymizationService.executeAnonymization(
      anonymizationDto,
      req.user?.id,
    );

    return {
      success: true,
      message: 'Data anonymization executed successfully',
      data: result,
    };
  }

  @Get('anonymization/statistics')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER', 'VIEWER')
  @ApiOperation({ summary: 'Get data anonymization statistics' })
  @ApiResponse({ status: 200, description: 'Anonymization statistics retrieved successfully' })
  async getAnonymizationStatistics() {
    const stats = await this.anonymizationService.getAnonymizationStatistics();

    return {
      success: true,
      data: stats,
    };
  }

  /**
   * Generate warnings for purge operations
   */
  private generatePurgeWarnings(purgeDto: ManualPurgeDto, dryRunResult: any): string[] {
    const warnings: string[] = [];

    // Warn about large purge operations
    if (dryRunResult.totalRecordsPurged > 10000) {
      warnings.push(`Large purge operation: ${dryRunResult.totalRecordsPurged} records will be deleted`);
    }

    // Warn about aggressive retention
    if (purgeDto.retentionDays <= 1) {
      warnings.push('Very aggressive retention period (1 day) - ensure this is intentional');
    }

    // Warn about purging without backup
    if (purgeDto.createBackup === false) {
      warnings.push('Backup creation is disabled - data will be permanently lost');
    }

    // Warn about skipping integrity verification
    if (purgeDto.verifyIntegrity === false) {
      warnings.push('Integrity verification is disabled - potential data corruption may go undetected');
    }

    // Warn about audit data purging
    const auditResult = dryRunResult.results.find((r: any) => r.tableName === 'audit_events');
    if (auditResult && auditResult.recordsPurged > 0) {
      warnings.push(`${auditResult.recordsPurged} audit records will be deleted - ensure compliance requirements are met`);
    }

    return warnings;
  }

  /**
   * Generate recommendations for purge operations
   */
  private generatePurgeRecommendations(estimation: any): string[] {
    const recommendations: string[] = [];

    // Recommend backup if large operation
    if (estimation.totalRecordsPurged > 5000) {
      recommendations.push('Consider creating backups before executing this large purge operation');
    }

    // Recommend off-peak execution
    if (estimation.totalRecordsPurged > 1000) {
      recommendations.push('Execute during off-peak hours to minimize system impact');
    }

    // Recommend incremental purging
    if (estimation.totalRecordsPurged > 50000) {
      recommendations.push('Consider breaking this into smaller, incremental purge operations');
    }

    // Recommend testing in staging
    if (estimation.tablesProcessed > 5) {
      recommendations.push('Test this purge operation in a staging environment first');
    }

    return recommendations;
  }

  // Scheduled Purge Management Endpoints

  @Get('schedules')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER', 'VIEWER')
  @ApiOperation({ summary: 'Get all scheduled purge configurations' })
  @ApiResponse({ status: 200, description: 'Scheduled purges retrieved successfully' })
  @ApiQuery({ name: 'active', required: false, type: Boolean, description: 'Filter by active schedules only' })
  async getScheduledPurges(@Query('active') activeOnly?: boolean) {
    const schedules = activeOnly
      ? this.scheduledPurgeManager.getActiveSchedules()
      : this.scheduledPurgeManager.getAllSchedules();

    return {
      success: true,
      data: schedules,
      count: schedules.length,
    };
  }

  @Post('schedules')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Create a new scheduled purge configuration' })
  @ApiResponse({ status: 201, description: 'Scheduled purge created successfully' })
  @ApiResponse({ status: 400, description: 'Invalid schedule configuration' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async createScheduledPurge(
    @Body() scheduleConfig: {
      name: string;
      description: string;
      cronExpression: string;
      retentionDays: number;
      purgeScope: string;
      isActive?: boolean;
      createBackup?: boolean;
      verifyIntegrity?: boolean;
      maxRecords?: number;
    },
    @Request() req: any,
  ) {
    const schedule = await this.scheduledPurgeManager.createSchedule(
      {
        ...scheduleConfig,
        isActive: scheduleConfig.isActive ?? true,
        createBackup: scheduleConfig.createBackup ?? false,
        verifyIntegrity: scheduleConfig.verifyIntegrity ?? false,
        maxRecords: scheduleConfig.maxRecords,
        createdBy: req.user?.id || 'unknown',
      },
      req.user?.id,
    );

    return {
      success: true,
      message: 'Scheduled purge created successfully',
      data: schedule,
    };
  }

  @Post('schedules/:id/execute')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Execute scheduled purge manually' })
  @ApiParam({ name: 'id', description: 'Schedule ID' })
  @ApiResponse({ status: 200, description: 'Scheduled purge executed successfully' })
  @ApiResponse({ status: 404, description: 'Scheduled purge not found' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async executeScheduledPurge(
    @Param('id') id: string,
    @Request() req: any,
  ) {
    const result = await this.scheduledPurgeManager.executeScheduledPurge(id);

    return {
      success: true,
      message: 'Scheduled purge executed successfully',
      data: result,
    };
  }

  @Post('emergency/enable')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Enable emergency cleanup mode' })
  @ApiResponse({ status: 200, description: 'Emergency cleanup enabled successfully' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async enableEmergencyCleanup(
    @Body() body: { reason: string },
    @Request() req: any,
  ) {
    await this.scheduledPurgeManager.enableEmergencyCleanup(
      body.reason,
      req.user?.id,
    );

    return {
      success: true,
      message: 'Emergency cleanup mode enabled',
      data: {
        reason: body.reason,
        enabledAt: new Date().toISOString(),
        enabledBy: req.user?.id,
      },
    };
  }

  @Post('emergency/disable')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Disable emergency cleanup mode' })
  @ApiResponse({ status: 200, description: 'Emergency cleanup disabled successfully' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async disableEmergencyCleanup(@Request() req: any) {
    await this.scheduledPurgeManager.disableEmergencyCleanup(req.user?.id);

    return {
      success: true,
      message: 'Emergency cleanup mode disabled',
      data: {
        disabledAt: new Date().toISOString(),
        disabledBy: req.user?.id,
      },
    };
  }

  @Get('monitoring/alerts')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER', 'VIEWER')
  @ApiOperation({ summary: 'Get data growth monitoring alerts' })
  @ApiResponse({ status: 200, description: 'Monitoring alerts retrieved successfully' })
  async getMonitoringAlerts() {
    const alerts = await this.purgeSchedulerService.monitorDataGrowth();

    return {
      success: true,
      data: {
        alerts,
        summary: {
          totalAlerts: alerts.length,
          criticalAlerts: alerts.filter(a => a.severity === 'CRITICAL').length,
          highAlerts: alerts.filter(a => a.severity === 'HIGH').length,
          mediumAlerts: alerts.filter(a => a.severity === 'MEDIUM').length,
          lowAlerts: alerts.filter(a => a.severity === 'LOW').length,
        },
      },
    };
  }

  @Post('purge/emergency')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Execute emergency purge for specific table' })
  @ApiResponse({ status: 200, description: 'Emergency purge scheduled successfully' })
  @ApiResponse({ status: 400, description: 'Invalid emergency purge parameters' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async executeEmergencyPurge(
    @Body() body: { tableName: string; reason: string },
    @Request() req: any,
  ) {
    await this.purgeSchedulerService.executeEmergencyPurge(
      body.tableName,
      body.reason,
      req.user?.id,
    );

    return {
      success: true,
      message: 'Emergency purge scheduled successfully',
      data: {
        tableName: body.tableName,
        reason: body.reason,
        scheduledAt: new Date().toISOString(),
        executedBy: req.user?.id,
      },
    };
  }

  @Get('monitoring/performance')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER', 'VIEWER')
  @ApiOperation({ summary: 'Get purge performance metrics' })
  @ApiResponse({ status: 200, description: 'Performance metrics retrieved successfully' })
  async getPurgePerformanceMetrics() {
    const metrics = await this.purgeSchedulerService.getPurgePerformanceMetrics();

    return {
      success: true,
      data: metrics,
    };
  }

  @Get('monitoring/dashboard')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER', 'VIEWER')
  @ApiOperation({ summary: 'Get comprehensive retention monitoring dashboard data' })
  @ApiResponse({ status: 200, description: 'Dashboard data retrieved successfully' })
  async getRetentionDashboard() {
    const [
      alerts,
      performance,
      statistics,
      anonymizationStats,
    ] = await Promise.all([
      this.purgeSchedulerService.monitorDataGrowth(),
      this.purgeSchedulerService.getPurgePerformanceMetrics(),
      this.retentionService.getRetentionStatistics(),
      this.anonymizationService.getAnonymizationStatistics(),
    ]);

    return {
      success: true,
      data: {
        alerts: {
          total: alerts.length,
          critical: alerts.filter(a => a.severity === 'CRITICAL').length,
          high: alerts.filter(a => a.severity === 'HIGH').length,
          recent: alerts.slice(0, 5), // Most recent 5 alerts
        },
        performance,
        statistics,
        anonymization: anonymizationStats,
        systemHealth: {
          status: alerts.filter(a => a.severity === 'CRITICAL').length > 0 ? 'CRITICAL' :
                  alerts.filter(a => a.severity === 'HIGH').length > 0 ? 'WARNING' : 'HEALTHY',
          lastUpdated: new Date().toISOString(),
        },
      },
    };
  }
}