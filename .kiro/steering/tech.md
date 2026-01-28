# WP-AutoHealer Technology Stack

## Backend Stack

- **Framework**: NestJS with TypeScript
- **Database**: PostgreSQL 14+ with Prisma ORM
- **Cache/Queue**: Redis 6+ with BullMQ for job processing
- **Security**: libsodium encryption, JWT authentication, MFA support
- **Communication**: SSH2 library for secure server connections
- **Testing**: Jest with fast-check for property-based testing

## Frontend Stack

- **Framework**: Next.js 14 with App Router
- **Language**: TypeScript
- **Styling**: Tailwind CSS with CSS Custom Properties
- **Icons**: Heroicons (outline and solid variants)
- **State Management**: React Context + useState/useEffect
- **Real-time Updates**: Server-Sent Events (SSE)

## Development Tools

- **Build System**: NestJS CLI for backend, Next.js for frontend
- **Code Quality**: ESLint, Prettier, TypeScript strict mode
- **Testing**: Jest with 80% coverage threshold, property-based tests
- **Database**: Prisma for ORM, migrations, and schema management
- **Containerization**: Docker with multi-stage builds

## Common Commands

### Backend Development
```bash
# Development
npm run start:dev          # Start in watch mode
npm run start:debug        # Start with debugging

# Building
npm run build              # Build for production
npm run start:prod         # Start production build

# Testing
npm test                   # Run unit tests
npm run test:cov           # Run with coverage
npm run test:pbt           # Run property-based tests
npm run test:e2e           # Run end-to-end tests
npm run test:integration   # Run integration tests

# Database
npm run db:generate        # Generate Prisma client
npm run db:migrate         # Run database migrations
npm run db:push            # Push schema changes
npm run db:seed            # Seed database with initial data
npm run db:studio          # Open Prisma Studio

# Code Quality
npm run lint               # Run ESLint
npm run format             # Run Prettier
npm run typecheck          # TypeScript type checking
```

### Frontend Development
```bash
# Development
npm run dev                # Start development server
npm run build              # Build for production
npm run start              # Start production server
npm run lint               # Run ESLint
```

### Docker Operations
```bash
# Development
docker-compose up -d       # Start all services
docker-compose logs -f     # Follow logs

# Production
docker-compose -f docker-compose.prod.yml up -d
```

## Architecture Patterns

- **Microservices Architecture**: Clear separation of concerns with modular design
- **Domain-Driven Design**: Organized by business domains (auth, incidents, sites, etc.)
- **CQRS Pattern**: Separate read/write operations for better performance
- **Event-Driven Architecture**: BullMQ jobs for asynchronous processing
- **Repository Pattern**: Prisma ORM with service layer abstraction

## Security Standards

- **Encryption**: All sensitive data encrypted at rest using libsodium
- **Authentication**: JWT tokens with MFA support
- **Authorization**: Role-based access control (RBAC)
- **SSH Security**: Strict host key verification and secure algorithms
- **Input Validation**: Class-validator for DTO validation
- **Secret Management**: Environment-based configuration with validation

## Performance Considerations

- **Database**: Connection pooling, read replicas, indexed queries
- **Caching**: Multi-level caching (memory + Redis)
- **Job Processing**: Concurrent workers with rate limiting
- **Frontend**: SSR, code splitting, optimized bundle sizes