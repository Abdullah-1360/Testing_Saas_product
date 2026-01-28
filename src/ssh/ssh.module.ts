import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '../database/database.module';
import { CommonModule } from '../common/common.module';
import { SSHService } from './services/ssh.service';
import { SSHValidationService } from './services/ssh-validation.service';
import { SSHConnectionPoolService } from './services/ssh-connection-pool.service';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    CommonModule,
  ],
  controllers: [],
  providers: [
    SSHService,
    SSHValidationService,
    SSHConnectionPoolService,
  ],
  exports: [
    SSHService,
    SSHValidationService,
    SSHConnectionPoolService,
  ],
})
export class SshModule {}