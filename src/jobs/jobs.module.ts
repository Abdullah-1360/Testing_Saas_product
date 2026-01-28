import { Module, OnModuleInit, forwardRef } from '@nestjs/common';
import { RedisConfigService } from '@/config/redis.config';
import { QueueConfigService } from './queue.config';
import { IncidentProcessorService } from './incident-processor.service';
import { JobsService } from './jobs.service';
import { ScheduledJobsService } from './scheduled-jobs.service';
import { JobsController } from './jobs.controller';
import { IncidentWorker } from './workers/incident.worker';
import { DataRetentionWorker } from './workers/data-retention.worker';
import { HealthCheckWorker } from './workers/health-check.worker';
import { CircuitBreakerService } from './circuit-breaker.service';
import { FlappingPreventionService } from './flapping-prevention.service';
import { JobIdempotencyService } from './job-idempotency.service';
import { BoundedLoopsService } from './bounded-loops.service';
import { RetentionModule } from '@/retention/retention.module';

@Module({
  imports: [forwardRef(() => RetentionModule)],
  controllers: [JobsController],
  providers: [
    RedisConfigService,
    QueueConfigService,
    CircuitBreakerService,
    FlappingPreventionService,
    JobIdempotencyService,
    BoundedLoopsService,
    IncidentProcessorService,
    JobsService,
    ScheduledJobsService,
    IncidentWorker,
    DataRetentionWorker,
    HealthCheckWorker,
  ],
  exports: [
    RedisConfigService,
    QueueConfigService,
    CircuitBreakerService,
    FlappingPreventionService,
    JobIdempotencyService,
    BoundedLoopsService,
    IncidentProcessorService,
    JobsService,
  ],
})
export class JobsModule implements OnModuleInit {
  constructor(private readonly queueConfig: QueueConfigService) {}

  async onModuleInit() {
    // Initialize all queues when the module starts
    await this.queueConfig.initializeQueues();
  }
}