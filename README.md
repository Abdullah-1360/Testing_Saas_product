# WP-AutoHealer

[![Node.js CI](https://github.com/wp-autohealer/wp-autohealer/actions/workflows/ci.yml/badge.svg)](https://github.com/wp-autohealer/wp-autohealer/actions/workflows/ci.yml)
[![Coverage Status](https://coveralls.io/repos/github/wp-autohealer/wp-autohealer/badge.svg?branch=main)](https://coveralls.io/github/wp-autohealer/wp-autohealer?branch=main)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Production-grade WordPress self-healing system that functions as an autonomous Level-1.5 SRE/Support Engineer. The system automatically diagnoses and remediates WordPress website errors on Linux servers via SSH, using conservative minimal reversible changes while preserving all existing business, SEO, content, and behavioral characteristics.

## 🚀 Features

- **Autonomous Incident Response**: Automatically detects and resolves WordPress issues
- **Conservative Approach**: Minimal, reversible changes with comprehensive backup strategies
- **Complete Audit Trail**: Every operation logged for compliance and debugging
- **Multi-Server Support**: Manage WordPress sites across multiple servers
- **Real-time Monitoring**: Live incident tracking with WebSocket updates
- **Role-Based Access Control**: Secure multi-user access with MFA support
- **Property-Based Testing**: Comprehensive correctness verification
- **Data Retention Management**: Configurable retention policies with automatic purging

## 🏗️ Architecture

### Technology Stack

- **Backend**: NestJS with TypeScript
- **Database**: PostgreSQL with Prisma ORM
- **Queue System**: BullMQ with Redis
- **Frontend**: Next.js with App Router (separate repository)
- **Security**: libsodium encryption, strict SSH verification
- **Testing**: Jest with fast-check for property-based testing

### Core Components

- **SSH Service**: Secure server connections and command execution
- **Job Engine**: BullMQ-powered incident processing state machine
- **Discovery Service**: Automatic environment detection
- **Verification Service**: Comprehensive site health checking
- **Backup Service**: Rollback artifact management
- **Audit Service**: Complete operation logging

## 📋 Prerequisites

- Node.js 18.0.0 or higher
- PostgreSQL 13 or higher
- Redis 6.0 or higher
- npm 9.0.0 or higher

## 🛠️ Installation

### 1. Clone the Repository

```bash
git clone https://github.com/wp-autohealer/wp-autohealer.git
cd wp-autohealer
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Environment Configuration

```bash
cp .env.example .env
```

Edit `.env` with your configuration:

```env
# Database
DATABASE_URL=postgresql://username:password@localhost:5432/wp_autohealer

# Redis
REDIS_URL=redis://localhost:6379/0

# Security
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
SESSION_SECRET=your-super-secret-session-key-change-this-in-production
ENCRYPTION_KEY=your-32-byte-encryption-key-change-this-in-production
```

### 4. Database Setup

```bash
# Generate Prisma client
npm run db:generate

# Run database migrations
npm run db:migrate

# Seed initial data (optional)
npm run db:seed
```

### 5. Start the Application

```bash
# Development mode
npm run start:dev

# Production mode
npm run build
npm run start:prod
```

## 🧪 Testing

### Unit Tests

```bash
# Run all tests
npm test

# Run tests with coverage
npm run test:cov

# Run tests in watch mode
npm run test:watch
```

### Property-Based Tests

```bash
# Run property-based tests specifically
npm run test:pbt

# Run with verbose output
VERBOSE_TESTS=true npm run test:pbt
```

### End-to-End Tests

```bash
npm run test:e2e
```

## 📊 API Documentation

When running in development mode with `ENABLE_SWAGGER=true`, API documentation is available at:

```
http://localhost:3000/api/docs
```

### Authentication

The API uses JWT-based authentication with optional MFA support:

```bash
# Login
POST /api/v1/auth/login
{
  "email": "admin@example.com",
  "password": "your-password"
}

# MFA verification (if enabled)
POST /api/v1/auth/mfa/verify
{
  "token": "123456"
}
```

### Core Endpoints

- `GET /api/v1/incidents` - List incidents
- `POST /api/v1/incidents` - Create incident
- `GET /api/v1/incidents/:id` - Get incident details
- `GET /api/v1/servers` - List servers
- `POST /api/v1/servers` - Add server
- `GET /api/v1/sites` - List sites
- `POST /api/v1/sites` - Add site

## 🔧 Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_ENV` | Environment mode | `development` |
| `PORT` | Server port | `3000` |
| `DATABASE_URL` | PostgreSQL connection string | Required |
| `REDIS_URL` | Redis connection string | Required |
| `JWT_SECRET` | JWT signing secret | Required |
| `ENCRYPTION_KEY` | libsodium encryption key (32 bytes) | Required |
| `MAX_FIX_ATTEMPTS` | Maximum fix attempts per incident | `15` |
| `DEFAULT_RETENTION_DAYS` | Default data retention period | `3` |
| `MAX_RETENTION_DAYS` | Maximum retention period (hard cap) | `7` |

### Retention Policies

Data retention is configurable with hard caps for compliance:

```bash
# Configure retention via API
PUT /api/v1/settings/retention
{
  "retentionDays": 5,  // 1-7 days maximum
  "appliesTo": "all"
}
```

## 🔒 Security

### Encryption

All sensitive data is encrypted at rest using libsodium:

- Server credentials
- SSH keys
- MFA secrets
- Session tokens

### Secret Redaction

All logs and API responses automatically redact sensitive information:

- Passwords
- API keys
- Tokens
- SSH keys
- Database connection strings

### SSH Security

- Strict host key verification enabled
- Connection timeouts enforced
- Command injection prevention
- Least-privilege execution

## 📈 Monitoring

### Health Checks

```bash
# Application health
GET /health

# Database health
GET /api/v1/health/database

# Redis health
GET /api/v1/health/redis
```

### Metrics

The application exposes metrics for monitoring:

- Incident processing times
- Success/failure rates
- Queue depths
- Database connection pool status

## 🚀 Deployment

### Docker

```bash
# Build image
docker build -t wp-autohealer .

# Run with docker-compose
docker-compose up -d
```

### Production Considerations

1. **Database**: Use managed PostgreSQL with connection pooling
2. **Redis**: Use Redis Cluster for high availability
3. **Secrets**: Use environment-specific secret management
4. **Monitoring**: Set up application performance monitoring
5. **Logging**: Configure log aggregation and alerting
6. **Backup**: Regular database backups with point-in-time recovery

## 🧩 Development

### Project Structure

```
src/
├── auth/           # Authentication and authorization
├── users/          # User management
├── servers/        # Server connection management
├── sites/          # WordPress site management
├── incidents/      # Incident lifecycle management
├── jobs/           # Background job processing
├── ssh/            # SSH connection service
├── evidence/       # Diagnostic data collection
├── backup/         # Backup artifact management
├── verification/   # Site health verification
├── audit/          # Audit logging
├── common/         # Shared utilities and services
├── config/         # Configuration validation
└── database/       # Database connection and migrations
```

### Code Quality

```bash
# Linting
npm run lint

# Formatting
npm run format

# Type checking
npm run typecheck
```

### Contributing

1. Fork the repository
2. Create a feature branch
3. Write tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🤝 Support

- **Documentation**: [docs.wp-autohealer.com](https://docs.wp-autohealer.com)
- **Issues**: [GitHub Issues](https://github.com/wp-autohealer/wp-autohealer/issues)
- **Discussions**: [GitHub Discussions](https://github.com/wp-autohealer/wp-autohealer/discussions)

## 🎯 Roadmap

- [ ] WordPress Multisite support
- [ ] Advanced caching system integration
- [ ] Machine learning-based incident prediction
- [ ] Kubernetes deployment support
- [ ] Advanced reporting and analytics
- [ ] Third-party monitoring integrations

---

**WP-AutoHealer** - Autonomous WordPress healing for the modern web.