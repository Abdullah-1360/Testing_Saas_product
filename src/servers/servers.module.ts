import { Module } from '@nestjs/common';
import { ServersService } from './servers.service';
import { ServersController } from './servers.controller';
import { DiscoveryService } from './discovery.service';
import { CommonModule } from '@/common/common.module';
import { SshModule } from '@/ssh/ssh.module';
import { DatabaseModule } from '@/database/database.module';

@Module({
  imports: [CommonModule, SshModule, DatabaseModule],
  controllers: [ServersController],
  providers: [ServersService, DiscoveryService],
  exports: [ServersService, DiscoveryService],
})
export class ServersModule {}