import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from '@/database/database.module';
import { AuthModule } from '@/auth/auth.module';
import { UsersModule } from '@/users/users.module';
import { ServersModule } from '@/servers/servers.module';
import { SitesModule } from '@/sites/sites.module';
import { IncidentsModule } from '@/incidents/incidents.module';
import { JobsModule } from '@/jobs/jobs.module';
import { SshModule } from '@/ssh/ssh.module';
import { EvidenceModule } from '@/evidence/evidence.module';
import { BackupModule } from '@/backup/backup.module';
import { VerificationModule } from '@/verification/verification.module';
import { AuditModule } from '@/audit/audit.module';
import { IntegrationsModule } from '@/integrations/integrations.module';
// import { WordPressFixesModule } from '@/wordpress-fixes/wordpress-fixes.module'; // Temporarily disabled
import { RetentionModule } from '@/retention/retention.module';
import { DashboardModule } from '@/dashboard/dashboard.module';
import { SseModule } from '@/sse/sse.module';
import { SecurityModule } from '@/security/security.module';
import { MonitoringModule } from '@/monitoring/monitoring.module';
import { CommonModule } from '@/common/common.module';
import { ConfigModule as CustomConfigModule } from '@/config/config.module';
import { configValidationSchema } from '@/config/config.validation';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/auth/guards/roles.guard';
import { ApiRateLimitGuard } from '@/common/guards/api-rate-limit.guard';
import { AuditInterceptor } from '@/audit/audit.interceptor';
import { ApiVersionMiddleware } from '@/common/middleware/api-version.middleware';

@Module({
  imports: [
    // Configuration module with validation
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        `.env.${process.env['NODE_ENV']}`,
        '.env.local',
        '.env',
      ],
      validationSchema: configValidationSchema,
      validationOptions: {
        allowUnknown: true,
        abortEarly: true,
      },
    }),

    // Throttling module for rate limiting
    ThrottlerModule.forRootAsync({
      useFactory: () => ({
        throttlers: [{
          ttl: parseInt(process.env['RATE_LIMIT_TTL'] || '60', 10) * 1000,
          limit: parseInt(process.env['RATE_LIMIT_LIMIT'] || '100', 10),
        }],
      }),
    }),

    // Schedule module for cron jobs
    ScheduleModule.forRoot(),

    // Event emitter for real-time updates
    EventEmitterModule.forRoot(),

    // Core modules
    DatabaseModule,
    CommonModule,
    CustomConfigModule,

    // Feature modules
    AuthModule,
    UsersModule,
    ServersModule,
    SitesModule,
    IncidentsModule,
    JobsModule,
    SshModule,
    EvidenceModule,
    BackupModule,
    VerificationModule,
    AuditModule,
    IntegrationsModule,
    // WordPressFixesModule, // Temporarily disabled due to compilation errors
    RetentionModule,
    DashboardModule,
    SseModule,
    MonitoringModule,
    SecurityModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Global authentication guard
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    // Global roles guard
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    // Global API rate limiting guard
    {
      provide: APP_GUARD,
      useClass: ApiRateLimitGuard,
    },
    // Global audit interceptor
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(ApiVersionMiddleware)
      .forRoutes('*');
  }
}