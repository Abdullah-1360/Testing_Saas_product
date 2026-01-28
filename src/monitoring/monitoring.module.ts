import { Module } from '@nestjs/common';
import { MonitoringController } from './monitoring.controller';
import { MonitoringService } from './monitoring.service';
import { PerformanceMonitoringService } from './performance-monitoring.service';
import { SystemMetricsService } from './system-metrics.service';
import { ErrorTrackingService } from './error-tracking.service';
import { HealthCheckService } from './health-check.service';
import { DatabaseModule } from '@/database/database.module';
import { CommonModule } from '@/common/common.module';
import { JobsModule } from '@/jobs/jobs.module';

@Module({
  imports: [DatabaseModule, CommonModule, JobsModule],
  controllers: [MonitoringController],
  providers: [
    MonitoringService,
    PerformanceMonitoringService,
    SystemMetricsService,
    ErrorTrackingService,
    HealthCheckService,
  ],
  exports: [
    MonitoringService,
    PerformanceMonitoringService,
    SystemMetricsService,
    ErrorTrackingService,
    HealthCheckService,
  ],
})
export class MonitoringModule {}