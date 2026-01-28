import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { INestApplication } from '@nestjs/common';

@Injectable()
export class ApiDocumentationService {
  constructor(private readonly configService: ConfigService) {}

  setupSwagger(app: INestApplication): void {
    if (!this.configService.get<boolean>('ENABLE_SWAGGER', false)) {
      return;
    }

    // Main API documentation
    const config = new DocumentBuilder()
      .setTitle('WP-AutoHealer API')
      .setDescription(this.getApiDescription())
      .setVersion('1.0.0')
      .setContact(
        'WP-AutoHealer Team',
        'https://github.com/wp-autohealer/wp-autohealer',
        'support@wp-autohealer.com'
      )
      .setLicense('MIT', 'https://opensource.org/licenses/MIT')
      .addServer('http://localhost:3000', 'Development server')
      .addServer('https://api.wp-autohealer.com', 'Production server')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          name: 'JWT',
          description: 'Enter JWT token',
          in: 'header',
        },
        'JWT-auth'
      )
      .addTag('auth', 'Authentication and authorization')
      .addTag('users', 'User management')
      .addTag('servers', 'Server management and discovery')
      .addTag('sites', 'WordPress site management')
      .addTag('incidents', 'Incident management and processing')
      .addTag('evidence', 'Evidence collection and storage')
      .addTag('backup', 'Backup and rollback management')
      .addTag('verification', 'Site verification and health checks')
      .addTag('audit', 'Audit logging and compliance')
      .addTag('retention', 'Data retention and purging')
      .addTag('health', 'System health and monitoring')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    
    // Add custom OpenAPI extensions
    this.addCustomExtensions(document);
    
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: {
        persistAuthorization: true,
        displayRequestDuration: true,
        docExpansion: 'none',
        filter: true,
        showExtensions: true,
        showCommonExtensions: true,
        tryItOutEnabled: true,
      },
      customSiteTitle: 'WP-AutoHealer API Documentation',
      customfavIcon: '/favicon.ico',
      customJs: [
        'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/4.15.5/swagger-ui-bundle.min.js',
        'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/4.15.5/swagger-ui-standalone-preset.min.js',
      ],
      customCssUrl: [
        'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/4.15.5/swagger-ui.min.css',
      ],
    });

    // Setup versioned documentation
    this.setupVersionedDocs(app);
  }

  private setupVersionedDocs(app: INestApplication): void {
    // V1 API Documentation
    const v1Config = new DocumentBuilder()
      .setTitle('WP-AutoHealer API v1')
      .setDescription('Version 1 of the WP-AutoHealer API')
      .setVersion('1.0.0')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
        'JWT-auth'
      )
      .build();

    const v1Document = SwaggerModule.createDocument(app, v1Config, {
      include: [], // Include all modules for v1
      deepScanRoutes: true,
    });

    SwaggerModule.setup('api/v1/docs', app, v1Document, {
      swaggerOptions: {
        persistAuthorization: true,
        displayRequestDuration: true,
      },
      customSiteTitle: 'WP-AutoHealer API v1 Documentation',
    });
  }

  private getApiDescription(): string {
    return `
# WP-AutoHealer API

Production-grade WordPress self-healing system that functions as an autonomous Level-1.5 SRE/Support Engineer.

## Features

- **Automated WordPress Healing**: Automatically diagnoses and fixes WordPress issues
- **Server Management**: Manage multiple servers with SSH connections
- **Site Monitoring**: Monitor WordPress sites for health and performance
- **Incident Management**: Track and manage healing incidents with full audit trails
- **Evidence Collection**: Collect and store diagnostic evidence
- **Backup Management**: Create and manage rollback artifacts
- **RBAC**: Role-based access control with multiple user roles
- **Audit Logging**: Comprehensive audit trails for compliance
- **Data Retention**: Configurable data retention policies

## Authentication

This API uses JWT (JSON Web Tokens) for authentication. To access protected endpoints:

1. Login using the \`/api/v1/auth/login\` endpoint
2. Include the returned JWT token in the \`Authorization\` header: \`Bearer <token>\`
3. Optionally enable MFA for enhanced security

## Rate Limiting

API endpoints are rate-limited based on user roles:

- **Super Admin**: 1000 requests/minute
- **Admin**: 500 requests/minute  
- **Engineer**: 300 requests/minute
- **Viewer**: 100 requests/minute
- **Anonymous**: 20 requests/minute

Rate limit headers are included in responses:
- \`X-RateLimit-Limit\`: Maximum requests allowed
- \`X-RateLimit-Remaining\`: Remaining requests in current window
- \`X-RateLimit-Reset\`: Unix timestamp when limit resets

## Error Handling

All API responses follow a consistent format:

\`\`\`json
{
  "statusCode": 200,
  "message": "Operation completed successfully",
  "data": { ... },
  "timestamp": "2024-01-15T10:30:00.000Z",
  "correlationId": "1705315800000-abc123def"
}
\`\`\`

Error responses include additional details:

\`\`\`json
{
  "statusCode": 400,
  "message": "Validation failed",
  "code": "VALIDATION_ERROR",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "path": "/api/v1/users"
}
\`\`\`

## Pagination

List endpoints support pagination with query parameters:

- \`page\`: Page number (default: 1)
- \`limit\`: Items per page (default: 10, max: 100)
- \`sortBy\`: Field to sort by
- \`sortOrder\`: Sort direction (\`asc\` or \`desc\`)

## Filtering

Most list endpoints support filtering with query parameters matching field names.

## Versioning

The API uses URI versioning (e.g., \`/api/v1/\`). Version information is included in response headers:

- \`X-API-Version\`: Current API version
- \`X-API-Deprecated\`: Indicates if version is deprecated
- \`X-API-Deprecation-Date\`: When deprecated version will be removed
- \`X-API-Replacement\`: Replacement version or endpoint
    `;
  }

  private addCustomExtensions(document: any): void {
    // Add custom OpenAPI extensions
    document.info['x-api-id'] = 'wp-autohealer-api';
    document.info['x-audience'] = 'external';
    document.info['x-api-category'] = 'automation';
    
    // Add security schemes
    document.components = document.components || {};
    document.components.securitySchemes = document.components.securitySchemes || {};
    
    // Add rate limiting extension
    document['x-rate-limit'] = {
      description: 'Rate limiting is applied per user role',
      policies: [
        {
          name: 'super-admin-limit',
          rate: '1000/minute',
          scope: 'user',
          roles: ['SUPER_ADMIN'],
        },
        {
          name: 'admin-limit',
          rate: '500/minute',
          scope: 'user',
          roles: ['ADMIN'],
        },
        {
          name: 'engineer-limit',
          rate: '300/minute',
          scope: 'user',
          roles: ['ENGINEER'],
        },
        {
          name: 'viewer-limit',
          rate: '100/minute',
          scope: 'user',
          roles: ['VIEWER'],
        },
        {
          name: 'anonymous-limit',
          rate: '20/minute',
          scope: 'ip',
          roles: ['anonymous'],
        },
      ],
    };

    // Add versioning extension
    document['x-versioning'] = {
      strategy: 'uri',
      currentVersion: 'v1',
      supportedVersions: ['v1'],
      deprecationPolicy: 'Deprecated versions are supported for 6 months after replacement',
    };

    // Add compliance extension
    document['x-compliance'] = {
      dataRetention: {
        defaultPeriod: '3 days',
        maxPeriod: '7 days',
        configurable: true,
      },
      auditLogging: {
        enabled: true,
        scope: 'all-operations',
        retention: 'follows-data-retention-policy',
      },
      encryption: {
        atRest: 'libsodium',
        inTransit: 'TLS 1.2+',
        secrets: 'encrypted-and-redacted',
      },
    };
  }
}