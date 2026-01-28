import { Module } from '@nestjs/common';
import { IntegrationsService } from './services/integrations.service';
import { WebhooksService } from './services/webhooks.service';
import { NotificationsService } from './services/notifications.service';
import { ApiKeysService } from './services/api-keys.service';
import { IntegrationsController } from './controllers/integrations.controller';
import { WebhooksController } from './controllers/webhooks.controller';
import { DatabaseModule } from '../database/database.module';
import { AuditModule } from '../audit/audit.module';
import { CommonModule } from '../common/common.module';
import { IncidentsModule } from '../incidents/incidents.module';
import { SitesModule } from '../sites/sites.module';

@Module({
  imports: [DatabaseModule, AuditModule, CommonModule, IncidentsModule, SitesModule],
  controllers: [IntegrationsController, WebhooksController],
  providers: [
    IntegrationsService,
    WebhooksService,
    NotificationsService,
    ApiKeysService,
  ],
  exports: [
    IntegrationsService,
    WebhooksService,
    NotificationsService,
    ApiKeysService,
  ],
})
export class IntegrationsModule {}