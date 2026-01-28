import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { INestApplication } from '@nestjs/common';

/**
 * Enhanced Swagger/OpenAPI Configuration
 * **Validates: Requirements 15.7** - OpenAPI/Swagger documentation
 * 
 * This configuration provides:
 * - Comprehensive API documentation with examples
 * - Security scheme definitions
 * - Rate limiting information
 * - Error response schemas
 * - Custom extensions for WP-AutoHealer specific features
 */

export class SwaggerConfig {
  static setup(app: INestApplication): void {
    const config = new DocumentBuilder()
      .setTitle('WP-AutoHealer API')
      .setDescription(`
# WP-AutoHealer REST API v1

Production-grade WordPress self-healing system that functions as an autonomous Level-1.5 SRE/Support Engineer.

## Overview

WP-AutoHealer automatically diagnoses and remediates WordPress website errors on Linux servers via SSH, using conservative minimal reversible changes while preserving all existing business, SEO, content, and behavioral characteristics.

## Key Features

### 🛡️ Automated WordPress Healing
- **Incident Detection**: Automatic monitoring and error detection
- **Smart Diagnosis**: Multi-tier diagnostic approach
- **Conservative Fixes**: Minimal, reversible changes with full rollback capability
- **Verification**: Comprehensive site health validation after fixes

### 🖥️ Server Management
- **Multi-Server Support**: Manage multiple Linux servers
- **Auto-Discovery**: Automatic environment detection (OS, web server, control panels)
- **Secure Connections**: SSH with strict host key verification
- **Credential Management**: Encrypted credential storage with libsodium

### 🌐 Site Monitoring
- **WordPress Detection**: Automatic WordPress installation discovery
- **Health Checks**: Comprehensive site health monitoring
- **Multisite Support**: WordPress multisite network detection
- **Real-time Status**: Live site status and performance metrics

### 📊 Incident Management
- **Full Audit Trail**: Complete incident lifecycle tracking
- **Timeline Events**: Detailed chronological event logging
- **Evidence Collection**: Comprehensive diagnostic data capture
- **Escalation Support**: Automated ticket generation for complex issues

### 👥 Role-Based Access Control
- **Super Admin**: Full system access (1000 req/min)
- **Admin**: Administrative operations (500 req/min)
- **Engineer**: Operational tasks (300 req/min)
- **Viewer**: Read-only access (100 req/min)

### 🔒 Security Features
- **Multi-Factor Authentication**: TOTP-based MFA support
- **Secret Redaction**: Automatic secret redaction in logs and responses
- **Input Validation**: Comprehensive injection attack prevention
- **Audit Logging**: Complete security event tracking

### 📈 Data Management
- **Retention Policies**: Configurable data retention (1-7 days hard cap)
- **Automatic Purging**: Scheduled data cleanup with audit trails
- **Backup Management**: Rollback artifact creation and management
- **Compliance**: Data anonymization for regulatory compliance

## Authentication

This API uses JWT (JSON Web Tokens) for authentication. Include the token in the Authorization header:

\`\`\`
Authorization: Bearer <your-jwt-token>
\`\`\`

### Getting a Token

1. **Login**: POST to \`/api/v1/auth/login\` with email and password
2. **MFA** (if enabled): Provide TOTP token for multi-factor authentication
3. **Use Token**: Include the returned \`accessToken\` in subsequent requests

### Token Management

- **Validation**: Use \`/api/v1/auth/session/validate\` to check token validity
- **Logout**: POST to \`/api/v1/auth/logout\` to invalidate current session
- **Logout All**: POST to \`/api/v1/auth/logout-all\` to invalidate all sessions

## Rate Limiting

API endpoints are rate-limited based on user roles:

| Role | Requests per Minute | Use Case |
|------|-------------------|----------|
| **Super Admin** | 1,000 | System administration |
| **Admin** | 500 | Administrative operations |
| **Engineer** | 300 | Operational tasks |
| **Viewer** | 100 | Monitoring and reporting |
| **Anonymous** | 20 | Public endpoints only |

### Rate Limit Headers

All responses include rate limiting information:

- \`X-RateLimit-Limit\`: Maximum requests per window
- \`X-RateLimit-Remaining\`: Remaining requests in current window
- \`X-RateLimit-Reset\`: Unix timestamp when window resets

### Rate Limit Exceeded

When rate limits are exceeded, the API returns:

\`\`\`json
{
  "statusCode": 429,
  "message": "Too many requests from this IP, please try again later.",
  "code": "RATE_LIMIT_EXCEEDED",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
\`\`\`

## API Versioning

The API uses URI versioning with the format \`/api/v{version}/\`:

- **Current Version**: v1 (\`/api/v1/\`)
- **Version Headers**: All responses include \`X-API-Version\` header
- **Backward Compatibility**: Previous versions supported for 12 months

## Response Format

All API responses follow a consistent format:

### Success Response
\`\`\`json
{
  "statusCode": 200,
  "message": "Operation completed successfully",
  "data": { /* response data */ },
  "timestamp": "2024-01-15T10:30:00.000Z"
}
\`\`\`

### Paginated Response
\`\`\`json
{
  "statusCode": 200,
  "message": "Data retrieved successfully",
  "data": [ /* array of items */ ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 100,
    "totalPages": 10
  },
  "timestamp": "2024-01-15T10:30:00.000Z"
}
\`\`\`

### Error Response
\`\`\`json
{
  "statusCode": 400,
  "message": "Validation failed",
  "code": "VALIDATION_ERROR",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "path": "/api/v1/users"
}
\`\`\`

## Error Codes

| HTTP Status | Code | Description |
|-------------|------|-------------|
| 400 | VALIDATION_ERROR | Request validation failed |
| 401 | UNAUTHORIZED | Authentication required |
| 403 | FORBIDDEN | Insufficient permissions |
| 404 | NOT_FOUND | Resource not found |
| 409 | CONFLICT | Resource already exists |
| 429 | RATE_LIMIT_EXCEEDED | Rate limit exceeded |
| 500 | INTERNAL_ERROR | Internal server error |

## Pagination

List endpoints support pagination with query parameters:

- \`page\`: Page number (default: 1)
- \`limit\`: Items per page (default: 10, max: 100)

Example: \`/api/v1/users?page=2&limit=25\`

## Filtering and Sorting

Many endpoints support filtering and sorting:

### Common Filters
- \`search\`: Text search across relevant fields
- \`createdAt\`: Filter by creation date
- \`updatedAt\`: Filter by last update date

### Role-Specific Filters
- **Users**: \`role\`, \`mfaEnabled\`
- **Servers**: \`controlPanel\`, \`authType\`
- **Sites**: \`serverId\`, \`isActive\`, \`isMultisite\`
- **Incidents**: \`state\`, \`priority\`, \`triggerType\`

## Security Considerations

### Input Validation
- All inputs are validated against injection attacks
- File paths are sanitized to prevent directory traversal
- Command inputs use safe templating to prevent injection

### Secret Management
- Passwords and keys are never returned in responses
- All secrets are encrypted at rest using libsodium
- Error messages are sanitized to prevent information disclosure

### Audit Logging
- All API access is logged for compliance
- Security events are tracked with full context
- Audit logs include user identity, IP address, and timestamps

## WordPress Fix Tiers

The system uses a tiered approach to WordPress fixes:

1. **Tier 1 - Infrastructure**: Disk space, memory, PHP errors
2. **Tier 2 - Core Integrity**: WordPress core file validation
3. **Tier 3 - Plugin/Theme**: Conflict detection and isolation
4. **Tier 4 - Cache**: Evidence-based cache clearing
5. **Tier 5 - Dependencies**: Dependency repair and updates
6. **Tier 6 - Rollback**: Last resort component rollback

## Incident States

Incidents progress through defined states:

\`\`\`
NEW → DISCOVERY → BASELINE → BACKUP → OBSERVABILITY → 
FIX_ATTEMPT(n) → VERIFY → FIXED/ROLLBACK/ESCALATED
\`\`\`

## Data Retention

- **Default Retention**: 3 days for all incident data
- **Maximum Retention**: 7 days (hard cap for compliance)
- **Automatic Purging**: Scheduled cleanup with audit trails
- **Manual Purging**: Admin-initiated cleanup with validation

## Support and Resources

- **Documentation**: [https://docs.wp-autohealer.com](https://docs.wp-autohealer.com)
- **GitHub**: [https://github.com/wp-autohealer/wp-autohealer](https://github.com/wp-autohealer/wp-autohealer)
- **Support**: [support@wp-autohealer.com](mailto:support@wp-autohealer.com)
- **Status Page**: [https://status.wp-autohealer.com](https://status.wp-autohealer.com)
      `)
      .setVersion('1.0.0')
      .setContact(
        'WP-AutoHealer Team',
        'https://github.com/wp-autohealer/wp-autohealer',
        'support@wp-autohealer.com'
      )
      .setLicense(
        'MIT License',
        'https://github.com/wp-autohealer/wp-autohealer/blob/main/LICENSE'
      )
      .addServer('http://localhost:3000', 'Development server')
      .addServer('https://api-staging.wp-autohealer.com', 'Staging server')
      .addServer('https://api.wp-autohealer.com', 'Production server')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          name: 'JWT',
          description: 'Enter JWT token obtained from /auth/login',
          in: 'header',
        },
        'JWT-auth'
      )
      .addTag('auth', 'Authentication and session management')
      .addTag('users', 'User management and RBAC')
      .addTag('servers', 'Server management and discovery')
      .addTag('sites', 'WordPress site management and monitoring')
      .addTag('incidents', 'Incident management and processing')
      .addTag('evidence', 'Evidence collection and diagnostic data')
      .addTag('backup', 'Backup and rollback management')
      .addTag('verification', 'Site verification and health checks')
      .addTag('audit', 'Audit logging and compliance tracking')
      .addTag('retention', 'Data retention and purging policies')
      .addTag('health', 'System health and monitoring endpoints')
      .addTag('wordpress-fixes', 'WordPress fix playbooks and execution')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    
    // Add custom extensions
    this.addCustomExtensions(document);
    
    // Setup Swagger UI
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: {
        persistAuthorization: true,
        displayRequestDuration: true,
        docExpansion: 'none',
        filter: true,
        tryItOutEnabled: true,
        tagsSorter: 'alpha',
        operationsSorter: 'alpha',
        defaultModelsExpandDepth: 2,
        defaultModelExpandDepth: 2,
        showExtensions: true,
        showCommonExtensions: true,
      },
      customSiteTitle: 'WP-AutoHealer API Documentation',
      customfavIcon: '/favicon.ico',
      customJs: [
        'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/4.15.5/swagger-ui-bundle.min.js',
      ],
      customCssUrl: [
        'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/4.15.5/swagger-ui.min.css',
      ],
    });
  }

  private static addCustomExtensions(document: any): void {
    // Add rate limiting information
    document.info['x-rate-limits'] = {
      'super-admin': {
        limit: 1000,
        window: '1 minute',
        description: 'System administration operations'
      },
      'admin': {
        limit: 500,
        window: '1 minute',
        description: 'Administrative operations'
      },
      'engineer': {
        limit: 300,
        window: '1 minute',
        description: 'Operational tasks and incident management'
      },
      'viewer': {
        limit: 100,
        window: '1 minute',
        description: 'Read-only monitoring and reporting'
      },
      'anonymous': {
        limit: 20,
        window: '1 minute',
        description: 'Public endpoints only'
      }
    };

    // Add security information
    document.info['x-security-features'] = {
      'authentication': 'JWT with optional MFA',
      'authorization': 'Role-based access control (RBAC)',
      'encryption': 'Secrets encrypted at rest with libsodium',
      'input-validation': 'Comprehensive injection attack prevention',
      'audit-logging': 'Complete security event tracking',
      'secret-redaction': 'Automatic secret redaction in responses'
    };

    // Add WordPress-specific information
    document.info['x-wordpress-features'] = {
      'supported-versions': 'WordPress 5.0+',
      'multisite-support': true,
      'control-panels': ['cPanel', 'Plesk', 'DirectAdmin', 'CyberPanel', 'Raw VPS'],
      'web-servers': ['Apache', 'Nginx', 'LiteSpeed'],
      'php-handlers': ['mod_php', 'php-fpm', 'LSAPI'],
      'fix-tiers': 6,
      'max-fix-attempts': 15
    };

    // Add data retention information
    document.info['x-data-retention'] = {
      'default-retention': '3 days',
      'maximum-retention': '7 days (hard cap)',
      'automatic-purging': true,
      'audit-trail': 'Complete purge audit logs',
      'compliance': 'GDPR-ready with data anonymization'
    };

    // Add common response schemas
    document.components = document.components || {};
    document.components.schemas = document.components.schemas || {};

    // Standard success response schema
    document.components.schemas.SuccessResponse = {
      type: 'object',
      properties: {
        statusCode: {
          type: 'integer',
          example: 200,
          description: 'HTTP status code'
        },
        message: {
          type: 'string',
          example: 'Operation completed successfully',
          description: 'Human-readable success message'
        },
        data: {
          type: 'object',
          description: 'Response data (varies by endpoint)'
        },
        timestamp: {
          type: 'string',
          format: 'date-time',
          example: '2024-01-15T10:30:00.000Z',
          description: 'Response timestamp in ISO 8601 format'
        }
      },
      required: ['statusCode', 'message', 'timestamp']
    };

    // Paginated response schema
    document.components.schemas.PaginatedResponse = {
      type: 'object',
      properties: {
        statusCode: {
          type: 'integer',
          example: 200
        },
        message: {
          type: 'string',
          example: 'Data retrieved successfully'
        },
        data: {
          type: 'array',
          items: {
            type: 'object'
          },
          description: 'Array of items for current page'
        },
        pagination: {
          type: 'object',
          properties: {
            page: {
              type: 'integer',
              example: 1,
              description: 'Current page number'
            },
            limit: {
              type: 'integer',
              example: 10,
              description: 'Items per page'
            },
            total: {
              type: 'integer',
              example: 100,
              description: 'Total number of items'
            },
            totalPages: {
              type: 'integer',
              example: 10,
              description: 'Total number of pages'
            }
          },
          required: ['page', 'limit', 'total', 'totalPages']
        },
        timestamp: {
          type: 'string',
          format: 'date-time',
          example: '2024-01-15T10:30:00.000Z'
        }
      },
      required: ['statusCode', 'message', 'data', 'pagination', 'timestamp']
    };

    // Error response schema
    document.components.schemas.ErrorResponse = {
      type: 'object',
      properties: {
        statusCode: {
          type: 'integer',
          example: 400,
          description: 'HTTP status code'
        },
        message: {
          type: 'string',
          example: 'Validation failed',
          description: 'Human-readable error message'
        },
        code: {
          type: 'string',
          example: 'VALIDATION_ERROR',
          description: 'Machine-readable error code'
        },
        timestamp: {
          type: 'string',
          format: 'date-time',
          example: '2024-01-15T10:30:00.000Z',
          description: 'Error timestamp in ISO 8601 format'
        },
        path: {
          type: 'string',
          example: '/api/v1/users',
          description: 'Request path that caused the error'
        }
      },
      required: ['statusCode', 'message', 'timestamp']
    };

    // Rate limit error schema
    document.components.schemas.RateLimitError = {
      type: 'object',
      properties: {
        statusCode: {
          type: 'integer',
          example: 429
        },
        message: {
          type: 'string',
          example: 'Too many requests from this IP, please try again later.'
        },
        code: {
          type: 'string',
          example: 'RATE_LIMIT_EXCEEDED'
        },
        timestamp: {
          type: 'string',
          format: 'date-time',
          example: '2024-01-15T10:30:00.000Z'
        }
      },
      required: ['statusCode', 'message', 'code', 'timestamp']
    };

    // Add common parameters
    document.components.parameters = document.components.parameters || {};

    document.components.parameters.PageParam = {
      name: 'page',
      in: 'query',
      required: false,
      schema: {
        type: 'integer',
        minimum: 1,
        default: 1
      },
      description: 'Page number for pagination'
    };

    document.components.parameters.LimitParam = {
      name: 'limit',
      in: 'query',
      required: false,
      schema: {
        type: 'integer',
        minimum: 1,
        maximum: 100,
        default: 10
      },
      description: 'Number of items per page (max 100)'
    };

    document.components.parameters.SearchParam = {
      name: 'search',
      in: 'query',
      required: false,
      schema: {
        type: 'string',
        minLength: 1,
        maxLength: 255
      },
      description: 'Search term for filtering results'
    };

    // Add security schemes
    document.components.securitySchemes = document.components.securitySchemes || {};
    
    document.components.securitySchemes['JWT-auth'] = {
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
      description: 'JWT token obtained from /auth/login endpoint'
    };
  }
}

/**
 * Custom Swagger decorators for enhanced documentation
 */
export const ApiStandardResponses = () => {
  return (target: any, propertyName: string, descriptor: PropertyDescriptor) => {
    // This would be implemented as a custom decorator
    // to automatically add standard response schemas
  };
};

export const ApiPaginatedResponse = (dataType: any) => {
  return (target: any, propertyName: string, descriptor: PropertyDescriptor) => {
    // This would be implemented as a custom decorator
    // for paginated endpoints
  };
};

export const ApiRoleBasedAccess = (roles: string[]) => {
  return (target: any, propertyName: string, descriptor: PropertyDescriptor) => {
    // This would be implemented as a custom decorator
    // to document role requirements
  };
};