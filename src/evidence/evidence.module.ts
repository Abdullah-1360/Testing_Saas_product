import { Module } from '@nestjs/common';
import { EvidenceService } from './services/evidence.service';
import { EvidenceController } from './controllers/evidence.controller';
import { DatabaseModule } from '../database/database.module';
import { SshModule } from '../ssh/ssh.module';
import { CommonModule } from '../common/common.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    DatabaseModule,
    SshModule,
    CommonModule,
    AuditModule
  ],
  controllers: [
    EvidenceController
  ],
  providers: [
    EvidenceService
  ],
  exports: [
    EvidenceService
  ],
})
export class EvidenceModule {}