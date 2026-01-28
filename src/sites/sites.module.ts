import { Module } from '@nestjs/common';
import { SitesController } from './sites.controller';
import { SitesService } from './sites.service';
import { DatabaseModule } from '@/database/database.module';
import { CommonModule } from '@/common/common.module';
import { SshModule } from '@/ssh/ssh.module';
import { ServersModule } from '@/servers/servers.module';

@Module({
  imports: [
    DatabaseModule,
    CommonModule,
    SshModule,
    ServersModule,
  ],
  controllers: [SitesController],
  providers: [SitesService],
  exports: [SitesService],
})
export class SitesModule {}