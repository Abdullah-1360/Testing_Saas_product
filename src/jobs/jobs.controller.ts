import { 
  Controller, 
  Post, 
  Get, 
  Put, 
  Body, 
  Param, 
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { JobsService } from './jobs.service';

@ApiTags('Jobs')
@Controller('jobs')
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Post('incidents')
  @ApiOperation({ summary: 'Create a new incident processing job' })
  @ApiResponse({ status: 201, description: 'Incident job created successfully' })
  @ApiResponse({ status: 400, description: 'Invalid request data' })
  async createIncident(@Body() createIncidentDto: {
    siteId: string;
    serverId: string;
    triggerType: string;
    priority?: string;
    maxFixAttempts?: number;
    metadata?: Record<string, any>;
  }) {
    return await this.jobsService.createIncident(createIncidentDto);
  }

  @Post('data-retention/purge')
  @ApiOperation({ summary: 'Schedule data purge job' })
  @ApiResponse({ status: 201, description: 'Data purge job scheduled successfully' })
  @ApiResponse({ status: 400, description: 'Invalid retention configuration' })
  async scheduleDataPurge(@Body() purgeDto: {
    retentionDays: number;
    tableName?: string;
    dryRun?: boolean;
  }) {
    // Validate retention days (1-7 as per requirements)
    if (purgeDto.retentionDays < 1 || purgeDto.retentionDays > 7) {
      throw new Error('Retention days must be between 1 and 7');
    }

    return await this.jobsService.scheduleDataPurge(purgeDto);
  }

  @Post('data-retention/cleanup-artifacts')
  @ApiOperation({ summary: 'Schedule artifact cleanup job' })
  @ApiResponse({ status: 201, description: 'Artifact cleanup job scheduled successfully' })
  async scheduleArtifactCleanup(@Body() cleanupDto: {
    retentionDays: number;
  }) {
    return await this.jobsService.scheduleArtifactCleanup(cleanupDto);
  }

  @Post('health-checks/sites/:siteId')
  @ApiOperation({ summary: 'Schedule site health check' })
  @ApiResponse({ status: 201, description: 'Site health check scheduled successfully' })
  @ApiResponse({ status: 404, description: 'Site not found' })
  async scheduleSiteHealthCheck(
    @Param('siteId') siteId: string,
    @Body() healthCheckDto: {
      url?: string;
      timeout?: number;
    } = {}
  ) {
    return await this.jobsService.scheduleSiteHealthCheck({
      siteId,
      ...healthCheckDto,
    });
  }

  @Post('health-checks/servers/:serverId')
  @ApiOperation({ summary: 'Schedule server health check' })
  @ApiResponse({ status: 201, description: 'Server health check scheduled successfully' })
  @ApiResponse({ status: 404, description: 'Server not found' })
  async scheduleServerHealthCheck(
    @Param('serverId') serverId: string,
    @Body() healthCheckDto: {
      timeout?: number;
    } = {}
  ) {
    return await this.jobsService.scheduleServerHealthCheck({
      serverId,
      ...healthCheckDto,
    });
  }

  @Post('health-checks/system')
  @ApiOperation({ summary: 'Schedule system health check' })
  @ApiResponse({ status: 201, description: 'System health check scheduled successfully' })
  async scheduleSystemHealthCheck() {
    return await this.jobsService.scheduleSystemHealthCheck();
  }

  @Get('queues/stats')
  @ApiOperation({ summary: 'Get queue statistics' })
  @ApiResponse({ status: 200, description: 'Queue statistics retrieved successfully' })
  async getQueueStats() {
    return await this.jobsService.getQueueStats();
  }

  @Put('queues/:queueName/pause')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Pause a queue' })
  @ApiResponse({ status: 204, description: 'Queue paused successfully' })
  @ApiResponse({ status: 404, description: 'Queue not found' })
  async pauseQueue(@Param('queueName') queueName: string) {
    await this.jobsService.pauseQueue(queueName);
  }

  @Put('queues/:queueName/resume')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Resume a queue' })
  @ApiResponse({ status: 204, description: 'Queue resumed successfully' })
  @ApiResponse({ status: 404, description: 'Queue not found' })
  async resumeQueue(@Param('queueName') queueName: string) {
    await this.jobsService.resumeQueue(queueName);
  }

  @Put('queues/:queueName/clean')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Clean completed and failed jobs from a queue' })
  @ApiResponse({ status: 204, description: 'Queue cleaned successfully' })
  @ApiResponse({ status: 404, description: 'Queue not found' })
  async cleanQueue(
    @Param('queueName') queueName: string,
    @Query('gracePeriodHours') gracePeriodHours: number = 24
  ) {
    await this.jobsService.cleanQueue(queueName, gracePeriodHours);
  }
}