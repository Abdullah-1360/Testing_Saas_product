# WP-AutoHealer Deployment Guide

This guide provides comprehensive instructions for deploying WP-AutoHealer in production environments.

## 📋 Prerequisites

### System Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| CPU | 2 cores | 4+ cores |
| RAM | 4GB | 8GB+ |
| Storage | 50GB SSD | 100GB+ SSD |
| Network | 100Mbps | 1Gbps+ |

### Software Dependencies

- **Operating System**: Ubuntu 20.04 LTS or higher
- **Node.js**: 18.x or higher
- **PostgreSQL**: 14.x or higher
- **Redis**: 6.x or higher
- **Docker**: 20.10+ (for containerized deployment)
- **Nginx**: 1.18+ (for reverse proxy)

## 🚀 Deployment Methods

### Docker Compose Configuration Optimizations

WP-AutoHealer's Docker Compose setup includes several performance optimizations for production use:

#### Database Optimizations (PostgreSQL)
- **Data Checksums**: Enabled for data integrity verification
- **Memory Limits**: 512MB limit with 256MB reservation to prevent resource contention
- **Health Checks**: Faster 5-second intervals with 3 retries for quicker startup detection
- **Connection Pooling**: Optimized for concurrent connections

#### Cache Optimizations (Redis)  
- **Memory Management**: 256MB limit with LRU eviction policy
- **Persistence**: Optimized save intervals (60s for 1000+ changes)
- **TCP Keepalive**: 60-second keepalive for connection stability
- **Health Checks**: 5-second intervals for faster readiness detection

#### Container Resource Management
- **Memory Limits**: Prevents any single service from consuming excessive memory
- **CPU Allocation**: Balanced resource distribution across services
- **Node.js Optimization**: Optimized heap size (512MB) without size optimization flags for better performance
- **Startup Dependencies**: Optimized service startup order and health check timing
- **Modern Docker Compose**: Uses Docker Compose v2+ format (version field removed for compatibility)

These optimizations provide:
- **Faster Startup**: Reduced health check intervals and optimized dependencies
- **Better Stability**: Resource limits prevent memory exhaustion
- **Improved Performance**: Tuned database and cache configurations
- **Production Ready**: Suitable for production workloads with proper resource management

### Method 1: Docker Compose (Recommended)

The easiest way to deploy WP-AutoHealer is using Docker Compose.

#### 1. Clone the Repository

```bash
git clone https://github.com/wp-autohealer/wp-autohealer.git
cd wp-autohealer
```

#### 2. Configure Environment Variables

```bash
cp .env.example .env
```

Edit the `.env` file with your configuration:

```bash
# Database Configuration
DATABASE_URL="postgresql://wp_autohealer:your_password@localhost:5432/wp_autohealer"
POSTGRES_USER=wp_autohealer
POSTGRES_PASSWORD=your_secure_password
POSTGRES_DB=wp_autohealer

# Redis Configuration
REDIS_URL="redis://localhost:6379"

# Application Configuration
NODE_ENV=production
PORT=3000
API_PORT=3001

# Security Configuration
JWT_SECRET=your_jwt_secret_key_here
ENCRYPTION_KEY=your_32_character_encryption_key
SESSION_SECRET=your_session_secret_here

# MFA Configuration
MFA_ISSUER="WP-AutoHealer"
MFA_SERVICE_NAME="WP-AutoHealer"

# SSH Configuration
SSH_TIMEOUT=30000
SSH_KEEPALIVE_INTERVAL=5000

# Retention Configuration
DEFAULT_RETENTION_DAYS=3
MAX_RETENTION_DAYS=7

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
```

#### 3. Deploy with Docker Compose

```bash
# Build and start all services (optimized for faster startup)
docker-compose up -d

# Check service status and health
docker-compose ps

# View logs
docker-compose logs -f

# Verify services are healthy
docker-compose exec api npm run health-check
```

**Performance Optimizations**: The Docker Compose configuration includes several optimizations:
- **Faster Health Checks**: 5-second intervals with 3 retries for quicker startup detection
- **Resource Limits**: Memory limits prevent resource contention (PostgreSQL: 512M, Redis: 256M)  
- **Database Tuning**: PostgreSQL with data checksums and optimized parameters
- **Redis Optimization**: LRU eviction policy, memory limits, and TCP keepalive settings
- **Node.js Memory Management**: Optimized heap size allocation (512MB) for balanced performance

#### 4. Initialize the Database

```bash
# Run database migrations
docker-compose exec api npm run prisma:migrate:deploy

# Seed initial data (optional)
docker-compose exec api npm run seed
```

#### 5. Create Initial Admin User

```bash
docker-compose exec api npm run create-admin
```

### Method 2: Manual Installation

For more control over the deployment process, you can install WP-AutoHealer manually.

#### 1. Install System Dependencies

```bash
# Update system packages
sudo apt update && sudo apt upgrade -y

# Install Node.js 18.x
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PostgreSQL
sudo apt install postgresql postgresql-contrib -y

# Install Redis
sudo apt install redis-server -y

# Install Nginx
sudo apt install nginx -y
```

#### 2. Configure PostgreSQL

```bash
# Switch to postgres user
sudo -u postgres psql

# Create database and user
CREATE DATABASE wp_autohealer;
CREATE USER wp_autohealer WITH ENCRYPTED PASSWORD 'your_secure_password';
GRANT ALL PRIVILEGES ON DATABASE wp_autohealer TO wp_autohealer;
\q
```

#### 3. Configure Redis

```bash
# Edit Redis configuration
sudo nano /etc/redis/redis.conf

# Set password (uncomment and modify)
requirepass your_redis_password

# Restart Redis
sudo systemctl restart redis-server
sudo systemctl enable redis-server
```

#### 4. Install Application

```bash
# Clone repository
git clone https://github.com/wp-autohealer/wp-autohealer.git
cd wp-autohealer

# Install dependencies
npm install

# Build the application
npm run build

# Configure environment
cp .env.example .env
# Edit .env with your settings

# Run database migrations
npm run prisma:migrate:deploy

# Create initial admin user
npm run create-admin
```

#### 5. Configure Process Manager

Using PM2 for process management:

```bash
# Install PM2 globally
npm install -g pm2

# Create PM2 ecosystem file
cat > ecosystem.config.js << EOF
module.exports = {
  apps: [
    {
      name: 'wp-autohealer-api',
      script: 'dist/main.js',
      cwd: '/path/to/wp-autohealer',
      instances: 'max',
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 3001
      }
    },
    {
      name: 'wp-autohealer-frontend',
      script: 'npm',
      args: 'start',
      cwd: '/path/to/wp-autohealer/frontend',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      }
    }
  ]
};
EOF

# Start applications
pm2 start ecosystem.config.js

# Save PM2 configuration
pm2 save

# Setup PM2 startup script
pm2 startup
```

#### 6. Configure Nginx Reverse Proxy

```bash
# Create Nginx configuration
sudo nano /etc/nginx/sites-available/wp-autohealer

# Add configuration
server {
    listen 80;
    server_name your-domain.com;

    # Redirect HTTP to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    # SSL Configuration
    ssl_certificate /path/to/your/certificate.crt;
    ssl_certificate_key /path/to/your/private.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512:ECDHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;

    # Security Headers
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload";

    # Frontend (Control Panel)
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # API Endpoints
    location /api/ {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # API Rate Limiting
        limit_req zone=api burst=20 nodelay;
    }

    # Server-Sent Events
    location /events {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_set_header Cache-Control 'no-cache';
        proxy_set_header X-Accel-Buffering 'no';
        proxy_buffering off;
        chunked_transfer_encoding off;
    }
}

# Rate limiting configuration
http {
    limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
}

# Enable the site
sudo ln -s /etc/nginx/sites-available/wp-autohealer /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

## 🔒 SSL Certificate Setup

### Using Let's Encrypt (Recommended)

```bash
# Install Certbot
sudo apt install certbot python3-certbot-nginx -y

# Obtain SSL certificate
sudo certbot --nginx -d your-domain.com

# Test automatic renewal
sudo certbot renew --dry-run
```

### Using Custom Certificate

```bash
# Copy your certificate files
sudo cp your-certificate.crt /etc/ssl/certs/wp-autohealer.crt
sudo cp your-private.key /etc/ssl/private/wp-autohealer.key

# Set proper permissions
sudo chmod 644 /etc/ssl/certs/wp-autohealer.crt
sudo chmod 600 /etc/ssl/private/wp-autohealer.key
```

## 🔧 Post-Deployment Configuration

### 1. Firewall Setup

```bash
# Configure UFW firewall
sudo ufw allow ssh
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
```

### 2. System Monitoring

```bash
# Install monitoring tools
sudo apt install htop iotop nethogs -y

# Setup log rotation
sudo nano /etc/logrotate.d/wp-autohealer

/var/log/wp-autohealer/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 644 www-data www-data
    postrotate
        systemctl reload nginx
    endscript
}
```

### 3. Backup Configuration

```bash
# Create backup script
sudo nano /usr/local/bin/wp-autohealer-backup.sh

#!/bin/bash
BACKUP_DIR="/backup/wp-autohealer"
DATE=$(date +%Y%m%d_%H%M%S)

# Create backup directory
mkdir -p $BACKUP_DIR

# Backup database
pg_dump -h localhost -U wp_autohealer wp_autohealer | gzip > $BACKUP_DIR/database_$DATE.sql.gz

# Backup application files
tar -czf $BACKUP_DIR/application_$DATE.tar.gz /path/to/wp-autohealer

# Cleanup old backups (keep 7 days)
find $BACKUP_DIR -name "*.gz" -mtime +7 -delete

# Make executable
sudo chmod +x /usr/local/bin/wp-autohealer-backup.sh

# Add to crontab
echo "0 2 * * * /usr/local/bin/wp-autohealer-backup.sh" | sudo crontab -
```

## ✅ Deployment Verification

### 1. Health Checks

```bash
# Check service status
sudo systemctl status nginx
sudo systemctl status postgresql
sudo systemctl status redis-server
pm2 status

# Check application health
curl -f http://localhost:3001/health
curl -f https://your-domain.com/api/health
```

### 2. Database Connectivity

```bash
# Test database connection
docker-compose exec api npm run prisma:db:pull
# or for manual installation
npm run prisma:db:pull
```

### 3. API Functionality

```bash
# Test API endpoints
curl -X GET https://your-domain.com/api/v1/health
curl -X POST https://your-domain.com/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"your_password"}'
```

### 4. Control Panel Access

1. Open your browser and navigate to `https://your-domain.com`
2. Log in with your admin credentials
3. Verify all dashboard elements load correctly
4. Test creating a server connection
5. Test creating a site configuration

## 🚨 Troubleshooting

### Common Issues

#### Database Connection Failed
```bash
# Check PostgreSQL status
sudo systemctl status postgresql

# Check connection
sudo -u postgres psql -c "SELECT version();"

# Verify credentials in .env file
```

#### Redis Connection Failed
```bash
# Check Redis status
sudo systemctl status redis-server

# Test Redis connection
redis-cli ping

# Check Redis logs
sudo journalctl -u redis-server
```

#### Application Won't Start
```bash
# Check application logs
docker-compose logs api
# or
pm2 logs wp-autohealer-api

# Check for missing environment variables
npm run config:validate
```

#### SSL Certificate Issues
```bash
# Check certificate validity
openssl x509 -in /etc/ssl/certs/wp-autohealer.crt -text -noout

# Test SSL configuration
sudo nginx -t
```

## 📊 Performance Tuning

### Database Optimization

The Docker Compose configuration includes optimized PostgreSQL settings:

```sql
-- Current optimized PostgreSQL configuration (already applied in docker-compose.yml):
-- - Data checksums enabled for integrity
-- - Memory limits (512MB) with reservations (256MB)
-- - Faster health checks for quicker startup

-- For manual installations, edit /etc/postgresql/14/main/postgresql.conf:
shared_buffers = 256MB
effective_cache_size = 1GB
maintenance_work_mem = 64MB
checkpoint_completion_target = 0.9
wal_buffers = 16MB
default_statistics_target = 100
random_page_cost = 1.1
effective_io_concurrency = 200
```

**Docker Compose Benefits**: The containerized PostgreSQL includes automatic resource management and data integrity features.

### Redis Optimization

The Docker Compose configuration includes optimized Redis settings:

```bash
# Current optimized Redis configuration (already applied in docker-compose.yml):
# - maxmemory 256mb (with LRU eviction)
# - save 60 1000 (optimized persistence)
# - tcp-keepalive 60 (connection stability)

# For manual installations, edit /etc/redis/redis.conf:
maxmemory 512mb
maxmemory-policy allkeys-lru
save 900 1
save 300 10
save 60 10000
tcp-keepalive 60
```

**Docker Compose Benefits**: The containerized Redis includes automatic memory management and optimized persistence settings.

### Node.js Optimization

```bash
# PM2 configuration for production
module.exports = {
  apps: [{
    name: 'wp-autohealer-api',
    script: 'dist/main.js',
    instances: 'max',
    exec_mode: 'cluster',
    max_memory_restart: '1G',
    node_args: '--max-old-space-size=1024',
    env: {
      NODE_ENV: 'production',
      UV_THREADPOOL_SIZE: 128
    }
  }]
};
```

## 🔄 Updates and Maintenance

### Updating WP-AutoHealer

```bash
# Backup current installation
/usr/local/bin/wp-autohealer-backup.sh

# Pull latest changes
git pull origin main

# Install dependencies
npm install

# Run database migrations
npm run prisma:migrate:deploy

# Rebuild application
npm run build

# Restart services
pm2 restart all
# or for Docker
docker-compose restart
```

### Regular Maintenance Tasks

```bash
# Weekly maintenance script
#!/bin/bash

# Update system packages
sudo apt update && sudo apt upgrade -y

# Clean up old logs
sudo journalctl --vacuum-time=7d

# Optimize database
docker-compose exec postgres psql -U wp_autohealer -d wp_autohealer -c "VACUUM ANALYZE;"

# Restart services
docker-compose restart
```

---

## 📞 Support

If you encounter issues during deployment:

1. Check the [Troubleshooting Guide](../troubleshooting/README.md)
2. Review application logs for error messages
3. Verify all prerequisites are met
4. Contact support at support@wp-autohealer.com

---

*Last updated: January 2024*