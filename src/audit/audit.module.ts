import { Module, Global } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';
import { AuditInterceptor } from './audit.interceptor';

@Global()
@Module({
  imports: [],
  controllers: [AuditController],
  providers: [
    AuditService,
    AuditInterceptor,
  ],
  exports: [
    AuditService,
    AuditInterceptor,
  ],
})
export class AuditModule {}