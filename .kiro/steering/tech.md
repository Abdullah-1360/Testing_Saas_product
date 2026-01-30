---
inclusion: always
---

# Tech Stack & Quality Standards: WP-AutoHealer

## Core Development Principles

### Conservative Automation
- **"Do No Harm" Policy**: All repair operations must be reversible. Abort and flag for human review if irreversible changes are required (e.g., `DROP TABLE`, `rm -rf`)
- **Atomic Operations**: Execute SSH commands as discrete, verifiable steps with rollback capability
- **Backup First**: Always create backups before modifying critical files (`wp-config.php`, `.htaccess`, database)

### Type Safety & Code Quality
- **Strict TypeScript**: Never use `any` type. Define explicit interfaces for all data structures
- **SSH Command Outputs**: Use typed interfaces for command responses and WordPress metadata
- **Error Handling**: Implement comprehensive error boundaries with specific error types

### Validation Requirements
- **Pre-execution Validation**: Analyze command impact before execution
- **Post-execution Verification**: Follow every change with verification commands (`wp core verify-checksums`, health checks)
- **State Consistency**: Ensure system state remains consistent after operations

## Security Standards

### Credential Management
- **Environment Variables**: All secrets (passwords, SSH keys, API tokens) must use environment variables
- **Never Hardcode**: No credentials in source code or configuration files
- **Encryption at Rest**: Use libsodium for sensitive data encryption

### SSH Security
- **Strict Host Verification**: Always verify SSH host keys
- **Secure Algorithms**: Use modern SSH algorithms and key exchange methods
- **Connection Pooling**: Reuse secure connections when possible

## Backend Stack

### Core Technologies
- **Framework**: NestJS with TypeScript (strict mode enabled)
- **Database**: PostgreSQL 14+ with Prisma ORM
- **Cache/Queue**: Redis 6+ with BullMQ for job processing
- **Security**: libsodium encryption, JWT authentication, MFA support
- **Communication**: SSH2 library for secure server connections
- **Testing**: Jest with fast-check for property-based testing

### Module Organization
- Use domain-driven design with clear module boundaries
- Each module should have: controller, service, module, DTOs, interfaces
- Follow NestJS dependency injection patterns
- Implement proper error handling with custom exceptions

## Frontend Stack

### Core Technologies
- **Framework**: Next.js 14 with App Router
- **Language**: TypeScript (strict mode)
- **Styling**: Tailwind CSS with CSS Custom Properties
- **Icons**: Heroicons (outline and solid variants)
- **State Management**: React Context + useState/useEffect
- **Real-time Updates**: Server-Sent Events (SSE)

### Component Architecture
- Use functional components with hooks
- Implement proper error boundaries
- Follow atomic design principles
- Ensure accessibility compliance (WCAG 2.1 AA)

## Development Workflow

### Code Quality Standards
- **ESLint**: Enforce consistent code style
- **Prettier**: Automatic code formatting
- **TypeScript**: Strict mode with no implicit any
- **Testing**: 80% coverage threshold minimum
- **Property-Based Testing**: Use fast-check for critical business logic

### Testing Strategy
- **Unit Tests**: Test individual functions and components
- **Integration Tests**: Test module interactions
- **Property-Based Tests**: Test invariants and edge cases
- **E2E Tests**: Test complete user workflows

## Essential Commands

### Backend Development
```bash
# Development
npm run start:dev          # Start in watch mode
npm run start:debug        # Start with debugging

# Testing (run in order of importance)
npm run test:pbt           # Property-based tests (critical for correctness)
npm test                   # Unit tests
npm run test:integration   # Integration tests
npm run test:e2e           # End-to-end tests
npm run test:cov           # Coverage report

# Database Operations
npm run db:generate        # Generate Prisma client (after schema changes)
npm run db:migrate         # Run database migrations
npm run db:push            # Push schema changes (development only)
npm run db:seed            # Seed database with initial data

# Code Quality (run before commits)
npm run lint               # ESLint checks
npm run format             # Prettier formatting
npm run typecheck          # TypeScript validation
```

### Frontend Development
```bash
# Development
npm run dev                # Start development server
npm run build              # Build for production
npm run lint               # ESLint checks
```

### Docker Operations
```bash
# Development Environment
docker-compose up -d       # Start all services
docker-compose logs -f app # Follow application logs

# Production Environment
docker-compose -f docker-compose.prod.yml up -d
```

## Architecture Patterns

### Backend Patterns
- **Domain-Driven Design**: Organize by business domains (auth, incidents, sites, servers)
- **CQRS Pattern**: Separate read/write operations for performance
- **Event-Driven Architecture**: Use BullMQ jobs for asynchronous processing
- **Repository Pattern**: Abstract data access through Prisma service layer
- **Dependency Injection**: Use NestJS DI container for loose coupling

### Frontend Patterns
- **Component Composition**: Build complex UIs from simple components
- **Custom Hooks**: Extract reusable stateful logic
- **Context Providers**: Share state across component trees
- **Error Boundaries**: Graceful error handling and recovery

## WordPress-Specific Guidelines

### SSH Command Execution
- Always validate WordPress installation before executing commands
- Use WP-CLI when available for WordPress operations
- Implement command timeouts and retry logic
- Log all SSH commands for audit trail

### Site Health Monitoring
- Verify site accessibility after changes
- Check WordPress core integrity
- Validate plugin and theme functionality
- Monitor database connectivity

### Backup and Recovery
- Create backups before any file modifications
- Store backup metadata in database
- Implement rollback procedures for failed operations
- Test backup integrity regularly

## Security Implementation

### Authentication & Authorization
- **JWT Tokens**: Implement with proper expiration and refresh logic
- **Multi-Factor Authentication**: Support TOTP and backup codes
- **Role-Based Access Control**: Define granular permissions per user role
- **Session Management**: Secure session handling with Redis storage

### Data Protection
- **Encryption at Rest**: Use libsodium for sensitive data
- **Input Validation**: Validate all inputs using class-validator
- **SQL Injection Prevention**: Use Prisma parameterized queries
- **XSS Protection**: Sanitize all user inputs and outputs

### SSH Security
- **Host Key Verification**: Always verify SSH host keys
- **Key Management**: Secure storage and rotation of SSH keys
- **Connection Limits**: Implement connection pooling and rate limiting
- **Audit Logging**: Log all SSH operations for compliance

## Performance Optimization

### Database Performance
- **Connection Pooling**: Configure appropriate pool sizes
- **Query Optimization**: Use database indexes effectively
- **Read Replicas**: Separate read/write operations when needed
- **Query Monitoring**: Track slow queries and optimize

### Caching Strategy
- **Multi-Level Caching**: Memory cache + Redis for different data types
- **Cache Invalidation**: Implement proper cache invalidation strategies
- **Session Caching**: Store user sessions in Redis
- **API Response Caching**: Cache frequently accessed data

### Job Processing
- **Queue Management**: Use BullMQ for background job processing
- **Worker Scaling**: Configure appropriate worker concurrency
- **Rate Limiting**: Prevent system overload with rate limits
- **Job Monitoring**: Track job success/failure rates

## Error Handling Standards

### Backend Error Handling
- **Custom Exceptions**: Define specific exception types for different errors
- **Global Exception Filter**: Centralized error handling and logging
- **Validation Errors**: Provide clear validation error messages
- **Graceful Degradation**: Handle service failures gracefully

### Frontend Error Handling
- **Error Boundaries**: Catch and handle React component errors
- **API Error Handling**: Consistent error response handling
- **User Feedback**: Provide meaningful error messages to users
- **Retry Logic**: Implement automatic retry for transient failures