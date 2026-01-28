import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import { AppModule } from './app.module';
import { GlobalExceptionFilter } from '@/common/filters/global-exception.filter';
import { LoggingInterceptor } from '@/common/interceptors/logging.interceptor';
import { TransformInterceptor } from '@/common/interceptors/transform.interceptor';
import { RedactionService } from '@/common/services/redaction.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  // Security middleware
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com'],
        scriptSrc: ["'self'", 'https://cdnjs.cloudflare.com'],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", 'https://cdnjs.cloudflare.com'],
      },
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
  }));

  // Rate limiting (fallback for non-authenticated requests)
  app.use(
    rateLimit({
      windowMs: configService.get<number>('RATE_LIMIT_TTL', 60) * 1000,
      max: configService.get<number>('RATE_LIMIT_LIMIT', 100),
      message: {
        statusCode: 429,
        message: 'Too many requests from this IP, please try again later.',
        code: 'RATE_LIMIT_EXCEEDED',
        timestamp: new Date().toISOString(),
      },
      standardHeaders: true,
      legacyHeaders: false,
      skip: (req) => {
        // Skip rate limiting for authenticated requests (handled by ApiRateLimitGuard)
        if (req.headers.authorization) {
          return true;
        }
        // Skip rate limiting for SSE connections
        if (req.url.includes('/sse/events')) {
          return true;
        }
        return false;
      },
    })
  );

  // Cookie parser
  app.use(cookieParser());

  // CORS configuration
  app.enableCors({
    origin: process.env['NODE_ENV'] === 'production' 
      ? configService.get<string[]>('ALLOWED_ORIGINS', [])
      : true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Correlation-ID'],
    exposedHeaders: [
      'X-API-Version',
      'X-API-Server',
      'X-API-Timestamp',
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset',
      'X-Correlation-ID',
    ],
  });

  // API versioning
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: configService.get<string>('API_VERSION', '1'),
    prefix: 'api/v',
  });

  // Global pipes
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
      disableErrorMessages: process.env['NODE_ENV'] === 'production',
      validationError: {
        target: false,
        value: false,
      },
    })
  );

  // Global filters
  const redactionService = app.get(RedactionService);
  app.useGlobalFilters(new GlobalExceptionFilter(redactionService));

  // Global interceptors
  const redactionServiceForInterceptors = app.get(RedactionService);
  const reflector = app.get(Reflector);
  app.useGlobalInterceptors(
    new LoggingInterceptor(redactionServiceForInterceptors),
    new TransformInterceptor(redactionServiceForInterceptors, reflector)
  );

  // Enhanced Swagger documentation
  if (configService.get<boolean>('ENABLE_SWAGGER', false)) {
    const { SwaggerConfig } = await import('./common/swagger/swagger-config');
    SwaggerConfig.setup(app);

    logger.log('📚 API Documentation available at /api/docs');
  }

  // Start the application
  const port = configService.get<number>('PORT', 3000);
  await app.listen(port);

  logger.log(`🛡️  WP-AutoHealer API is running on: http://localhost:${port}`);
  logger.log(`🔧 Environment: ${process.env['NODE_ENV']}`);
  logger.log(`📊 API Version: v${configService.get<string>('API_VERSION', '1')}`);
  logger.log(`🔒 Security: Helmet, CORS, Rate Limiting enabled`);
  logger.log(`🎯 Versioning: URI-based (/api/v1/)`);
  logger.log(`⚡ Rate Limiting: Role-based limits active`);
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  process.exit(0);
});

bootstrap();