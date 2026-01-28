import { Global, Module } from '@nestjs/common';
import { LoggerService } from './services/logger.service';
import { EncryptionService } from './services/encryption.service';
import { RedactionService } from './services/redaction.service';
import { RateLimitService } from './services/rate-limit.service';
import { ApiResponseService } from './services/api-response.service';
import { ApiVersionMiddleware } from './middleware/api-version.middleware';

@Global()
@Module({
  providers: [
    LoggerService,
    EncryptionService,
    RedactionService,
    RateLimitService,
    ApiResponseService,
    ApiVersionMiddleware,
  ],
  exports: [
    LoggerService,
    EncryptionService,
    RedactionService,
    RateLimitService,
    ApiResponseService,
    ApiVersionMiddleware,
  ],
})
export class CommonModule {}