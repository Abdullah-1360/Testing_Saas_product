import { Module } from '@nestjs/common';
import { BackupService } from './services/backup.service';
import { BackupController } from './controllers/backup.controller';
import { DatabaseModule } from '../database/database.module';
import { SshModule } from '../ssh/ssh.module';
import { AuditModule } from '../audit/audit.module';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [
    DatabaseModule,
    SshModule,
    AuditModule,
    CommonModule,
  ],
  controllers: [BackupController],
  providers: [BackupService],
  exports: [BackupService],
})
export class BackupModule {}