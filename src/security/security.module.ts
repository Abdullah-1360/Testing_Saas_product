import { Module } from '@nestjs/common';
import { SecurityMonitoringService } from './security-monitoring.service';
import { SecurityController } from './security.controller';
import { DatabaseModule } from '@/database/database.module';
import { CommonModule } from '@/common/common.module';

@Module({
  imports: [DatabaseModule, CommonModule],
  providers: [SecurityMonitoringService],
  controllers: [SecurityController],
  exports: [SecurityMonitoringService],
})
export class SecurityModule {}