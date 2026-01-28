# WP-AutoHealer Production Deployment Guide

This guide provides comprehensive instructions for deploying WP-AutoHealer to production environments using Docker containers with proper security, monitoring, and logging configurations.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Prerequisites](#prerequisites)
3. [Environment Setup](#environment-setup)
4. [SSL/TLS Configuration](#ssltls-configuration)
5. [Deployment Process](#deployment-process)
6. [Monitoring and Logging](#monitoring-and-logging)
7. [Backup and Recovery](#backup-and-recovery)
8. [Security Considerations](#security-considerations)
9. [Troubleshooting](#troubleshooting)
10. [Maintenance](#maintenance)

## Architecture Overview

The production deployment consists of the following services:

### Core Services
- **Backend**: NestJS API server with business logic
- **Frontend**: Next.js web application
- **PostgreSQL**: Primary database with production optimizations
- **Redis Master**: Primary cache and job queue
- **Redis Replica**: Read-only replica for high availability

### Infrastructure Services
- **Nginx**: Reverse proxy, load balancer, and SSL termination
- **Fluentd**: Log aggregation and processing
- **Prometheus**: Metrics collection and monitoring

### Network Architecture
```
Internet → Nginx (SSL/TLS) → Frontend/Backend → Database/Redis
                          ↓
                      Fluentd → Log Storage
                          ↓
                    Prometheus → Metrics Storage
```

## Prerequisites

### System Requirements
- **OS**: Linux (Ubuntu 20.04+ recommended)
- **RAM**: Minimum 4GB, Recommended 8GB+
- **CPU**: Minimum 2 cores, Recommended 4+ cores
- **Storage**: Minimum 50GB SSD
- **Network**: Static IP address and domain name

### Required Software
- Docker 20.10+
- Docker Compose 2.0+
- OpenSSL
- Git

### Installation Commands
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Logout and login to apply group changes
```

## Environment Setup

### 1. Clone Repository
```bash
git clone https://github.com/your-org/wp-autohealer.git
cd wp-autohealer
```

### 2. Generate Production Environment
```bash
# Generate secure production environment
./scripts/setup-environment.sh production

# Edit the generated .env.production file
nano .env.production
```

### 3. Required Environment Variables

Update the following placeholders in `.env.production`:

```bash
# Database Configuration
POSTGRES_PASSWORD=your_secure_database_password_here

# Redis Configuration
REDIS_PASSWORD=your_secure_redis_password_here

# Security Keys (generated automatically)
JWT_SECRET=auto_generated_64_char_string
SESSION_SECRET=auto_generated_64_char_string
ENCRYPTION_KEY=auto_generated_32_byte_key
WEBHOOK_SECRET=auto_generated_webhook_secret

# Domain Configuration
NEXT_PUBLIC_API_URL=https://your-domain.com/api/v1

# External Services (optional)
SMTP_HOST=smtp.your-provider.com
SMTP_USER=notifications@your-domain.com
SMTP_PASSWORD=your_smtp_password
```

### 4. Validate Environment
```bash
./scripts/setup-environment.sh validate .env.production
```

## SSL/TLS Configuration

### Option 1: Let's Encrypt (Recommended)
```bash
# Install Certbot
sudo apt install certbot

# Generate certificates
sudo certbot certonly --standalone -d your-domain.com

# Copy certificates to Docker volume
sudo cp /etc/letsencrypt/live/your-domain.com/fullchain.pem docker/nginx/ssl/cert.pem
sudo cp /etc/letsencrypt/live/your-domain.com/privkey.pem docker/nginx/ssl/private.key
sudo chown $USER:$USER docker/nginx/ssl/*
```

### Option 2: Self-Signed (Development/Testing)
```bash
# Generate self-signed certificates
./scripts/setup-environment.sh ssl
```

### Option 3: Custom Certificates
```bash
# Copy your certificates
cp your-certificate.pem docker/nginx/ssl/cert.pem
cp your-private-key.key docker/nginx/ssl/private.key

# Generate DH parameters
openssl dhparam -out docker/nginx/ssl/dhparam.pem 2048
```

## Deployment Process

### 1. Pre-deployment Checks
```bash
# Check prerequisites
./scripts/deploy-production.sh health

# Validate configuration
docker-compose -f docker-compose.prod.yml config
```

### 2. Deploy to Production
```bash
# Full deployment with backup
./scripts/deploy-production.sh deploy
```

### 3. Verify Deployment
```bash
# Check service status
./scripts/deploy-production.sh status

# Run health checks
./scripts/deploy-production.sh health

# View logs
./scripts/deploy-production.sh logs
```

### 4. Post-deployment Tasks
```bash
# Create initial admin user (if needed)
docker-compose -f docker-compose.prod.yml exec backend npm run create-admin

# Run database seeding (if needed)
docker-compose -f docker-compose.prod.yml exec backend npm run db:seed
```

## Monitoring and Logging

### Prometheus Metrics
- **URL**: `http://your-domain:9090`
- **Metrics**: Application performance, database stats, Redis metrics
- **Retention**: 15 days (configurable)

### Log Aggregation
- **Fluentd**: Collects logs from all services
- **Location**: `/var/log/fluentd/` in containers
- **Format**: JSON with structured fields
- **Retention**: Configurable via log rotation

### Key Metrics to Monitor
- **Response Time**: API endpoint performance
- **Error Rate**: Application and HTTP errors
- **Database Performance**: Query time, connections
- **Redis Performance**: Memory usage, hit rate
- **System Resources**: CPU, memory, disk usage

### Alerting Setup
```bash
# Configure alerting rules in Prometheus
# Edit docker/prometheus/alert_rules.yml

# Set up notification channels (Slack, email, etc.)
# Configure in Prometheus or external monitoring service
```

## Backup and Recovery

### Automated Backups
```bash
# Database backup (daily)
docker-compose -f docker-compose.prod.yml exec postgres pg_dump -U wp_autohealer wp_autohealer > backup_$(date +%Y%m%d).sql

# Volume backup
docker run --rm -v wp-autohealer_postgres_data_prod:/data -v $(pwd)/backups:/backup alpine tar czf /backup/postgres_$(date +%Y%m%d).tar.gz -C /data .
```

### Backup Script Setup
```bash
# Create backup cron job
echo "0 2 * * * /path/to/wp-autohealer/scripts/backup.sh" | crontab -
```

### Recovery Process
```bash
# Stop services
./scripts/deploy-production.sh stop

# Restore database
docker-compose -f docker-compose.prod.yml up -d postgres
docker-compose -f docker-compose.prod.yml exec -T postgres psql -U wp_autohealer -d wp_autohealer < backup_20240101.sql

# Restore volumes
docker run --rm -v wp-autohealer_postgres_data_prod:/data -v $(pwd)/backups:/backup alpine tar xzf /backup/postgres_20240101.tar.gz -C /data

# Restart services
./scripts/deploy-production.sh deploy
```

## Security Considerations

### Network Security
- All services run in isolated Docker network
- Only necessary ports exposed to host
- Nginx handles SSL termination
- Rate limiting configured for API endpoints

### Application Security
- Secrets encrypted at rest using libsodium
- JWT tokens with secure expiration
- RBAC (Role-Based Access Control)
- Input validation and sanitization
- SQL injection prevention via Prisma ORM

### Container Security
- Non-root users in containers
- Read-only filesystems where possible
- Resource limits configured
- Security headers in Nginx

### Database Security
- Encrypted connections (SSL)
- Strong password policies
- Limited user privileges
- Connection limits and timeouts

### Monitoring Security
- Log sanitization (secrets redacted)
- Audit trails for all operations
- Failed login attempt monitoring
- Suspicious activity detection

## Troubleshooting

### Common Issues

#### Service Won't Start
```bash
# Check logs
./scripts/deploy-production.sh logs [service-name]

# Check resource usage
docker stats

# Verify configuration
docker-compose -f docker-compose.prod.yml config
```

#### Database Connection Issues
```bash
# Check database status
docker-compose -f docker-compose.prod.yml exec postgres pg_isready -U wp_autohealer

# Check connection string
echo $DATABASE_URL

# Test connection
docker-compose -f docker-compose.prod.yml exec backend npm run db:test-connection
```

#### SSL Certificate Issues
```bash
# Check certificate validity
openssl x509 -in docker/nginx/ssl/cert.pem -text -noout

# Test SSL configuration
openssl s_client -connect your-domain.com:443 -servername your-domain.com
```

#### Performance Issues
```bash
# Check resource usage
docker stats

# Monitor database performance
docker-compose -f docker-compose.prod.yml exec postgres psql -U wp_autohealer -d wp_autohealer -c "SELECT * FROM pg_stat_activity;"

# Check Redis performance
docker-compose -f docker-compose.prod.yml exec redis-master redis-cli info stats
```

### Log Analysis
```bash
# Application errors
./scripts/deploy-production.sh logs backend | grep ERROR

# Database slow queries
./scripts/deploy-production.sh logs postgres | grep "duration:"

# Nginx access patterns
./scripts/deploy-production.sh logs nginx | grep "POST\|PUT\|DELETE"
```

## Maintenance

### Regular Tasks

#### Daily
- Monitor service health
- Check log files for errors
- Verify backup completion
- Review security alerts

#### Weekly
- Update system packages
- Review performance metrics
- Clean up old log files
- Test backup restoration

#### Monthly
- Update Docker images
- Review and rotate secrets
- Security audit
- Capacity planning review

### Update Process
```bash
# 1. Backup current deployment
./scripts/deploy-production.sh backup

# 2. Pull latest code
git pull origin main

# 3. Build new images
docker-compose -f docker-compose.prod.yml build --no-cache

# 4. Deploy with zero downtime
./scripts/deploy-production.sh deploy

# 5. Verify deployment
./scripts/deploy-production.sh health
```

### Scaling Considerations

#### Horizontal Scaling
- Add multiple backend instances behind load balancer
- Use Redis cluster for high availability
- Implement database read replicas
- Use CDN for static assets

#### Vertical Scaling
- Increase container resource limits
- Optimize database configuration
- Tune Redis memory settings
- Adjust worker processes

### Disaster Recovery

#### Backup Strategy
- **RTO** (Recovery Time Objective): 4 hours
- **RPO** (Recovery Point Objective): 1 hour
- **Backup Frequency**: Daily full, hourly incremental
- **Backup Retention**: 30 days local, 90 days offsite

#### Recovery Procedures
1. Assess damage and determine recovery scope
2. Provision new infrastructure if needed
3. Restore from most recent backup
4. Verify data integrity
5. Update DNS if necessary
6. Perform full system testing
7. Document incident and lessons learned

## Support and Documentation

### Additional Resources
- [API Documentation](docs/API_DOCUMENTATION.md)
- [Database Schema](docs/DATABASE_SCHEMA.md)
- [Security Guidelines](docs/SECURITY.md)
- [Performance Tuning](docs/PERFORMANCE.md)

### Getting Help
- **Issues**: Create GitHub issue with logs and configuration
- **Security**: Email security@your-domain.com
- **Emergency**: Follow incident response procedures

---

**Note**: This deployment guide assumes a production environment. For development or staging deployments, use the appropriate environment files and configurations.