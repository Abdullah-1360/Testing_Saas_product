import { Module, forwardRef } from '@nestjs/common';
import { RetentionService } from './retention.service';
import { RetentionController } from './retention.controller';
import { PurgeService } from './purge.service';
import { AnonymizationService } from './anonymization.service';
import { PurgeSchedulerService } from './purge-scheduler.service';
import { ScheduledPurgeManagerService } from './scheduled-purge-manager.service';
import { PurgeValidationService } from './purge-validation.service';
import { DatabaseModule } from '@/database/database.module';
import { AuditModule } from '@/audit/audit.module';
import { JobsModule } from '@/jobs/jobs.module';

@Module({
  imports: [DatabaseModule, AuditModule, forwardRef(() => JobsModule)],
  controllers: [RetentionController],
  providers: [
    RetentionService, 
    PurgeService, 
    AnonymizationService, 
    PurgeSchedulerService,
    ScheduledPurgeManagerService,
    PurgeValidationService,
  ],
  exports: [
    RetentionService, 
    PurgeService, 
    AnonymizationService, 
    PurgeSchedulerService,
    ScheduledPurgeManagerService,
    PurgeValidationService,
  ],
})
export class RetentionModule {}