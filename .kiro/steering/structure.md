# WP-AutoHealer Project Structure

## Root Directory Organization

```
wp-autohealer/
├── src/                    # Backend source code (NestJS)
├── frontend/               # Frontend application (Next.js)
├── prisma/                 # Database schema and migrations
├── test/                   # Backend tests (unit, integration, e2e)
├── docker/                 # Docker configuration files
├── docs/                   # Project documentation
├── scripts/                # Deployment and utility scripts
├── logs/                   # Application logs (development)
└── .kiro/                  # Kiro-specific files (specs, steering)
```

## Backend Structure (src/)

### Core Modules
```
src/
├── auth/                   # Authentication & authorization
│   ├── decorators/         # Custom decorators (roles, permissions)
│   ├── dto/               # Data transfer objects
│   ├── guards/            # Auth guards (JWT, roles, permissions)
│   ├── interfaces/        # TypeScript interfaces
│   ├── services/          # Auth services (MFA, sessions, passwords)
│   └── strategies/        # Passport strategies
├── users/                 # User management
├── servers/               # SSH server management
├── sites/                 # WordPress site management
├── incidents/             # Incident lifecycle management
├── jobs/                  # Background job processing (BullMQ)
├── ssh/                   # SSH connection service
├── evidence/              # Diagnostic data collection
├── backup/                # Backup artifact management
├── verification/          # Site health verification
├── audit/                 # Audit logging
├── retention/             # Data retention policies
├── integrations/          # External integrations (webhooks, APIs)
├── monitoring/            # System monitoring and health checks
├── security/              # Security services
├── common/                # Shared utilities and services
├── config/                # Configuration validation
└── database/              # Database connection and Prisma service
```

### Common Module Patterns
Each domain module typically contains:
- `*.controller.ts` - REST API endpoints
- `*.service.ts` - Business logic
- `*.module.ts` - NestJS module definition
- `dto/` - Data transfer objects with validation
- `interfaces/` - TypeScript type definitions
- `*.spec.ts` - Unit tests
- `*.pbt.spec.ts` - Property-based tests (where applicable)

## Frontend Structure (frontend/src/)

```
frontend/src/
├── app/                    # Next.js App Router pages
│   ├── api/               # API routes (if any)
│   ├── auth/              # Authentication pages
│   ├── dashboard/         # Main dashboard
│   ├── incidents/         # Incident management
│   ├── servers/           # Server management
│   ├── sites/             # Site management
│   ├── users/             # User management
│   └── settings/          # Application settings
├── components/            # Reusable React components
│   ├── layout/            # Layout components (sidebar, header)
│   ├── incidents/         # Incident-specific components
│   ├── servers/           # Server-specific components
│   ├── sites/             # Site-specific components
│   └── users/             # User-specific components
├── contexts/              # React contexts (Auth, SSE)
├── hooks/                 # Custom React hooks
├── lib/                   # Utility functions and API client
└── middleware.ts          # Next.js middleware
```

## Database Structure (prisma/)

```
prisma/
├── schema.prisma          # Database schema definition
├── migrations/            # Database migration files
└── seed.ts               # Database seeding script
```

### Key Database Tables
- **users** - User accounts and authentication
- **servers** - SSH server configurations  
- **sites** - WordPress site definitions
- **incidents** - Incident records and metadata
- **incident_events** - Append-only timeline events
- **command_executions** - SSH command logs
- **evidence** - Diagnostic data collection
- **backup_artifacts** - Rollback file metadata
- **audit_events** - System audit trail

## Testing Structure

```
test/
├── integration/           # Integration tests
├── jobs/                  # Job-specific tests
├── retention/             # Retention policy tests
├── *.e2e-spec.ts         # End-to-end tests
├── *.pbt.spec.ts         # Property-based tests
└── setup*.ts             # Test setup files
```

## Configuration Files

### Root Level
- `package.json` - Backend dependencies and scripts
- `tsconfig.json` - TypeScript configuration with path mapping
- `nest-cli.json` - NestJS CLI configuration
- `jest.config.js` - Jest testing configuration
- `docker-compose.yml` - Development environment
- `docker-compose.prod.yml` - Production environment

### Frontend Level
- `frontend/package.json` - Frontend dependencies
- `frontend/next.config.ts` - Next.js configuration
- `frontend/tsconfig.json` - Frontend TypeScript config
- `frontend/tailwind.config.js` - Tailwind CSS configuration

## Path Mapping

Both backend and frontend use TypeScript path mapping for clean imports:

### Backend Paths
```typescript
"@/*": ["src/*"]
"@/auth/*": ["src/auth/*"]
"@/users/*": ["src/users/*"]
// ... etc for each module
```

### Frontend Paths
```typescript
"@/*": ["./src/*"]
```

## File Naming Conventions

- **Controllers**: `*.controller.ts`
- **Services**: `*.service.ts`
- **Modules**: `*.module.ts`
- **DTOs**: `*.dto.ts`
- **Interfaces**: `*.interface.ts`
- **Guards**: `*.guard.ts`
- **Decorators**: `*.decorator.ts`
- **Unit Tests**: `*.spec.ts`
- **Property-Based Tests**: `*.pbt.spec.ts`
- **E2E Tests**: `*.e2e-spec.ts`

## Import Organization

1. Node.js built-in modules
2. Third-party packages
3. NestJS modules
4. Internal modules (using path mapping)
5. Relative imports (same directory)

Example:
```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
```