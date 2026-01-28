import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { DatabaseModule } from '@/database/database.module';
import { AuditModule } from '@/audit/audit.module';
import { RedisConfigService } from './redis.config';
import { SystemConfigService } from './system-config.service';
import { SystemConfigController } from './system-config.controller';
import { configValidationSchema } from './config.validation';

@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      validationSchema: configValidationSchema,
      validationOptions: {
        allowUnknown: true,
        abortEarly: false,
      },
    }),
    DatabaseModule,
    AuditModule,
  ],
  controllers: [SystemConfigController],
  providers: [RedisConfigService, SystemConfigService],
  exports: [RedisConfigService, SystemConfigService],
})
export class ConfigModule {}