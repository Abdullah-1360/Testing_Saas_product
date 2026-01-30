# WP-AutoHealer Configuration Guide

This guide covers all configuration options for WP-AutoHealer, including environment variables, system settings, security configuration, and performance tuning.

## 📋 Configuration Overview

WP-AutoHealer uses a hierarchical configuration system:

1. **Environment Variables** - Core system configuration
2. **Database Settings** - Runtime configuration stored in database
3. **File-based Config** - Docker Compose and deployment settings
4. **Control Panel Settings** - User-configurable options via UI

## 🔧 Environment Variables

### Core Application Settings

```bash
# Application Environment
NODE_ENV=production                    # Environment: development, production, test
PORT=3000                             # Frontend port
API_PORT=3001                         # API server port
APP_VERSION=1.0.0                     # Application version

# Base URLs
FRONTEND_URL=https://your-domain.com   # Frontend base URL
API_URL=https://your-domain.com/api    # API base URL
```

### Database Configuration

```bash
# PostgreSQL Database
DATABASE_URL="postgresql://wp_autohealer:password@localhost:5432/wp_autohealer"
POSTGRES_USER=wp_autohealer           # Database username
POSTGRES_PASSWORD=secure_password     # Database password
POSTGRES_DB=wp_autohealer            # Database name
POSTGRES_HOST=localhost              # Database host
POSTGRES_PORT=5432                   # Database port

# Connection Pool Settings
DATABASE_POOL_SIZE=10                # Maximum connections
DATABASE_POOL_TIMEOUT=30000          # Connection timeout (ms)
DATABASE_POOL_IDLE_TIMEOUT=600000    # Idle connection timeout (ms)
```

### Redis Configuration

```bash
# Redis Cache and Queue
REDIS_URL="redis://localhost:6379"   # Redis connection URL
REDIS_HOST=localhost                 # Redis host
REDIS_PORT=6379                      # Redis port
REDIS_PASSWORD=redis_password        # Redis password (optional)
REDIS_DB=0                          # Redis database number

# Redis Pool Settings
REDIS_POOL_SIZE=10                  # Maximum connections
REDIS_POOL_MIN=2                    # Minimum connections

# Redis Memory Management
REDIS_MAXMEMORY=256mb               # Maximum memory usage
REDIS_MAXMEMORY_POLICY=allkeys-lru  # Eviction policy when memory limit reached
```

#### Redis Memory Policies

WP-AutoHealer uses the `allkeys-lru` eviction policy for optimal cache performance:

- **allkeys-lru** (Recommended): Evicts least recently used keys from all keys when memory limit is reached
- **noeviction**: Returns errors when memory limit is reached (not recommended for cache workloads)
- **volatile-lru**: Only evicts LRU keys that have an expiration set
- **allkeys-random**: Randomly evicts keys when memory limit is reached

The `allkeys-lru` policy is optimal for WP-AutoHealer because:
- **Cache Efficiency**: Automatically manages cache size by removing least-used data
- **Prevents Memory Errors**: Avoids Redis memory errors that could crash job processing
- **Performance**: Maintains optimal performance by keeping frequently accessed data in memory
- **BullMQ Compatibility**: Works well with job queue data that has varying access patterns

### Security Configuration

```bash
# JWT Authentication
JWT_SECRET=your_jwt_secret_key_here_minimum_32_chars  # JWT signing key
JWT_EXPIRES_IN=24h                   # Token expiration time
JWT_REFRESH_EXPIRES_IN=7d           # Refresh token expiration

# Session Management
SESSION_SECRET=your_session_secret_here              # Session signing key
SESSION_TIMEOUT=86400000            # Session timeout (ms) - 24 hours
SESSION_SECURE=true                 # Secure cookies (HTTPS only)
SESSION_SAME_SITE=strict           # SameSite cookie policy

# Encryption
ENCRYPTION_KEY=your_32_character_encryption_key_here # libsodium encryption key
ENCRYPTION_ALGORITHM=aes-256-gcm    # Encryption algorithm

# MFA Configuration
MFA_ISSUER="WP-AutoHealer"         # TOTP issuer name
MFA_SERVICE_NAME="WP-AutoHealer"   # TOTP service name
MFA_WINDOW=1                       # TOTP time window tolerance
```

### SSH Configuration

```bash
# SSH Connection Settings
SSH_TIMEOUT=30000                   # SSH connection timeout (ms)
SSH_KEEPALIVE_INTERVAL=5000        # SSH keepalive interval (ms)
SSH_MAX_CONNECTIONS=50             # Maximum concurrent SSH connections
SSH_CONNECTION_POOL_SIZE=10        # SSH connection pool size

# SSH Security
SSH_STRICT_HOST_KEY_CHECKING=true  # Enforce host key verification
SSH_PREFERRED_ALGORITHMS=aes256-gcm # Preferred encryption algorithms
SSH_KEY_EXCHANGE=diffie-hellman-group14-sha256  # Key exchange algorithm
```

### Incident Processing Configuration

```bash
# Incident Settings
MAX_FIX_ATTEMPTS=15                # Maximum fix attempts per incident
INCIDENT_TIMEOUT=1800000           # Incident processing timeout (ms) - 30 min
COOLDOWN_WINDOW=600000             # Incident cooldown period (ms) - 10 min
CIRCUIT_BREAKER_THRESHOLD=5        # Circuit breaker failure threshold
CIRCUIT_BREAKER_TIMEOUT=300000     # Circuit breaker timeout (ms) - 5 min

# Job Queue Settings
JOB_CONCURRENCY=5                  # Concurrent jobs per worker
JOB_ATTEMPTS=3                     # Job retry attempts
JOB_BACKOFF_DELAY=2000            # Job retry backoff delay (ms)
JOB_REMOVE_ON_COMPLETE=100        # Keep completed jobs count
JOB_REMOVE_ON_FAIL=50             # Keep failed jobs count
```

### Data Retention Configuration

```bash
# Retention Policy
DEFAULT_RETENTION_DAYS=3           # Default data retention (1-7 days)
MAX_RETENTION_DAYS=7              # Maximum allowed retention
PURGE_SCHEDULE="0 2 * * *"        # Cron schedule for automatic purge
PURGE_BATCH_SIZE=1000             # Records to purge per batch
```

### Rate Limiting Configuration

```bash
# API Rate Limiting
RATE_LIMIT_WINDOW_MS=900000       # Rate limit window (ms) - 15 minutes
RATE_LIMIT_MAX_REQUESTS=100       # Max requests per window
RATE_LIMIT_SKIP_SUCCESSFUL_REQUESTS=false  # Count successful requests
RATE_LIMIT_SKIP_FAILED_REQUESTS=false      # Count failed requests

# Per-Role Rate Limits
RATE_LIMIT_SUPER_ADMIN=1000       # Super admin requests per window
RATE_LIMIT_ADMIN=500              # Admin requests per window
RATE_LIMIT_ENGINEER=200           # Engineer requests per window
RATE_LIMIT_VIEWER=100             # Viewer requests per window
```

### Monitoring and Logging

```bash
# Logging Configuration
LOG_LEVEL=info                    # Log level: error, warn, info, debug
LOG_FORMAT=json                   # Log format: json, text
LOG_FILE_PATH=/var/log/wp-autohealer/app.log  # Log file path
LOG_MAX_SIZE=10m                  # Maximum log file size
LOG_MAX_FILES=5                   # Number of log files to keep

# Metrics and Monitoring
METRICS_ENABLED=true              # Enable Prometheus metrics
METRICS_PORT=9090                 # Metrics endpoint port
HEALTH_CHECK_INTERVAL=30000       # Health check interval (ms)
```

### Email and Notifications

```bash
# SMTP Configuration (can also be configured via UI)
SMTP_HOST=smtp.example.com        # SMTP server host
SMTP_PORT=587                     # SMTP server port
SMTP_SECURE=true                  # Use TLS/SSL
SMTP_USER=notifications@example.com  # SMTP username
SMTP_PASSWORD=smtp_password       # SMTP password
SMTP_FROM=noreply@wp-autohealer.com  # Default sender email
SMTP_FROM_NAME="WP-AutoHealer"    # Default sender name

# Notification Settings
NOTIFICATIONS_ENABLED=true        # Enable notifications
NOTIFICATION_CHANNELS=email,webhook  # Enabled channels
WEBHOOK_URL=https://hooks.slack.com/services/...  # Webhook URL
```

## 📧 Email Configuration

WP-AutoHealer supports email notifications for various system events including user account management, incident alerts, and system notifications. Email configuration can be managed both through environment variables and the web interface.

### SMTP Configuration via Web Interface

The system provides a user-friendly interface for configuring SMTP settings:

1. **Navigate to Settings**: Go to Settings → Email Configuration
2. **Configure SMTP Settings**:
   - **SMTP Host**: Your email provider's SMTP server (e.g., `smtp.gmail.com`)
   - **SMTP Port**: Usually 587 for TLS or 465 for SSL
   - **Username**: Your SMTP authentication username
   - **Password**: Your SMTP authentication password (encrypted at rest)
   - **From Email Address**: The sender email address for system notifications
   - **From Name**: The display name for system emails (default: "WP-AutoHealer")
   - **Use TLS**: Enable TLS encryption (recommended)

3. **Test Configuration**: Use the built-in test email feature to verify settings
4. **Save Configuration**: Settings are encrypted and stored securely in the database

### Email Templates and Notifications

The system sends automated emails for the following events:

#### Authentication Events
- **Welcome Email**: Sent when a new user account is created
- **Password Reset**: Sent when a user requests a password reset
- **Password Changed**: Confirmation when password is successfully changed
- **Account Locked**: Notification when account is locked due to failed login attempts
- **MFA Enabled/Disabled**: Confirmation of MFA status changes
- **Backup Code Used**: Security alert when MFA backup codes are used

#### System Events
- **Role Changed**: Notification when user role is modified
- **Session Revoked**: Alert when user sessions are terminated
- **System Maintenance**: Notifications about scheduled maintenance

#### Incident Notifications (Future Enhancement)
- **Critical Incidents**: Immediate alerts for P0/P1 incidents
- **Incident Resolution**: Confirmation when incidents are resolved
- **Escalation Alerts**: Notifications when incidents require human intervention

### SMTP Provider Examples

#### Gmail Configuration
```bash
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password  # Use App Password, not regular password
SMTP_FROM=noreply@yourdomain.com
SMTP_FROM_NAME="WP-AutoHealer"
```

#### SendGrid Configuration
```bash
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASSWORD=your-sendgrid-api-key
SMTP_FROM=noreply@yourdomain.com
SMTP_FROM_NAME="WP-AutoHealer"
```

#### Amazon SES Configuration
```bash
SMTP_HOST=email-smtp.us-east-1.amazonaws.com
SMTP_PORT=587
SMTP_USER=your-ses-smtp-username
SMTP_PASSWORD=your-ses-smtp-password
SMTP_FROM=noreply@yourdomain.com
SMTP_FROM_NAME="WP-AutoHealer"
```

### Security Considerations

- **Password Encryption**: SMTP passwords are encrypted at rest using libsodium
- **TLS Encryption**: Always use TLS for SMTP connections in production
- **From Address Validation**: Ensure the from address is authorized by your SMTP provider
- **Rate Limiting**: Email sending is subject to rate limiting to prevent abuse
- **Audit Trail**: All email configuration changes are logged in the audit trail

### Troubleshooting Email Issues

#### Common Issues and Solutions

1. **Authentication Failed**
   - Verify username and password are correct
   - For Gmail, use App Passwords instead of regular password
   - Check if 2FA is enabled on your email account

2. **Connection Timeout**
   - Verify SMTP host and port are correct
   - Check firewall settings allow outbound SMTP connections
   - Ensure TLS settings match your provider's requirements

3. **Emails Not Delivered**
   - Check spam/junk folders
   - Verify from address is authorized by SMTP provider
   - Review email provider's sending limits and quotas

4. **SSL/TLS Errors**
   - Ensure correct port for TLS (587) or SSL (465)
   - Verify your SMTP provider supports the encryption method
   - Check certificate validity

#### Test Email Feature

Use the built-in test email feature to validate your configuration:

1. Navigate to Settings → Email Configuration
2. Scroll to "Test Email Configuration" section
3. Enter a test email address
4. Click "Send Test Email"
5. Check the specified email address for the test message

The test email will contain:
- Confirmation that SMTP configuration is working
- Current timestamp and system information
- Links to documentation and support resources

### API Endpoints for Email Configuration

For programmatic access to email settings:

```bash
# Get current SMTP configuration (passwords redacted)
GET /api/v1/auth/settings/smtp

# Update SMTP configuration
PUT /api/v1/auth/settings/smtp
{
  "host": "smtp.gmail.com",
  "port": 587,
  "username": "your-email@gmail.com",
  "password": "your-password",
  "fromAddress": "noreply@yourdomain.com",
  "fromName": "WP-AutoHealer",
  "useTls": true,
  "isActive": true
}

# Send test email
POST /api/v1/auth/settings/smtp/test
{
  "testEmail": "admin@example.com"
}
```

**Note**: Only users with SUPER_ADMIN or ADMIN roles can modify email configuration settings.

## 🗄️ Database Configuration

### Runtime Settings Table

The system stores runtime configuration in the database:

```sql
-- System settings table
CREATE TABLE system_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category VARCHAR(100) NOT NULL,
    key VARCHAR(100) NOT NULL,
    value JSONB NOT NULL,
    description TEXT,
    is_encrypted BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(category, key)
);

-- Example settings
INSERT INTO system_settings (category, key, value, description) VALUES
('incident', 'max_fix_attempts', '15', 'Maximum fix attempts per incident'),
('retention', 'default_days', '3', 'Default data retention period'),
('ssh', 'connection_timeout', '30000', 'SSH connection timeout in milliseconds'),
('notifications', 'email_enabled', 'true', 'Enable email notifications');
```

### Configuration Service

```typescript
@Injectable()
export class ConfigurationService {
  async getSetting<T>(category: string, key: string, defaultValue?: T): Promise<T> {
    const setting = await this.prisma.systemSettings.findUnique({
      where: { category_key: { category, key } }
    });
    
    if (!setting) {
      return defaultValue;
    }
    
    let value = setting.value;
    if (setting.isEncrypted) {
      value = this.encryptionService.decrypt(value as string);
    }
    
    return JSON.parse(value as string);
  }
  
  async setSetting<T>(category: string, key: string, value: T, encrypted = false): Promise<void> {
    let processedValue: any = JSON.stringify(value);
    
    if (encrypted) {
      processedValue = this.encryptionService.encrypt(processedValue);
    }
    
    await this.prisma.systemSettings.upsert({
      where: { category_key: { category, key } },
      create: { category, key, value: processedValue, isEncrypted: encrypted },
      update: { value: processedValue, isEncrypted: encrypted, updatedAt: new Date() }
    });
  }
}
```

## 🐳 Docker Configuration

### Docker Compose Configuration

```yaml
version: '3.8'

services:
  # PostgreSQL Database
  postgres:
    image: postgres:14-alpine
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./init-scripts:/docker-entrypoint-initdb.d
    ports:
      - "5432:5432"
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"]
      interval: 30s
      timeout: 10s
      retries: 3

  # Redis Cache
  redis:
    image: redis:7-alpine
    command: redis-server --requirepass ${REDIS_PASSWORD}
    environment:
      REDIS_PASSWORD: ${REDIS_PASSWORD}
    volumes:
      - redis_data:/data
    ports:
      - "6379:6379"
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "redis-cli", "--raw", "incr", "ping"]
      interval: 30s
      timeout: 10s
      retries: 3

  # API Server
  api:
    build:
      context: .
      dockerfile: Dockerfile.api
    environment:
      NODE_ENV: ${NODE_ENV}
      DATABASE_URL: ${DATABASE_URL}
      REDIS_URL: ${REDIS_URL}
      JWT_SECRET: ${JWT_SECRET}
      ENCRYPTION_KEY: ${ENCRYPTION_KEY}
    ports:
      - "${API_PORT}:${API_PORT}"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    restart: unless-stopped
    volumes:
      - ./data:/app/data
      - ./logs:/app/logs
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:${API_PORT}/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  # Job Processor
  job-processor:
    build:
      context: .
      dockerfile: Dockerfile.jobs
    environment:
      NODE_ENV: ${NODE_ENV}
      DATABASE_URL: ${DATABASE_URL}
      REDIS_URL: ${REDIS_URL}
      JOB_CONCURRENCY: ${JOB_CONCURRENCY}
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    restart: unless-stopped
    volumes:
      - ./data:/app/data
      - ./logs:/app/logs
    deploy:
      replicas: 2

  # Frontend
  frontend:
    build:
      context: .
      dockerfile: Dockerfile.frontend
    environment:
      NODE_ENV: ${NODE_ENV}
      NEXT_PUBLIC_API_URL: ${API_URL}
    ports:
      - "${PORT}:${PORT}"
    depends_on:
      api:
        condition: service_healthy
    restart: unless-stopped

  # Nginx Reverse Proxy
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf
      - ./nginx/ssl:/etc/nginx/ssl
      - ./logs/nginx:/var/log/nginx
    depends_on:
      - frontend
      - api
    restart: unless-stopped

volumes:
  postgres_data:
  redis_data:

networks:
  default:
    driver: bridge
```

### Environment File Template

```bash
# .env.example
# Copy to .env and customize for your environment

# Application
NODE_ENV=production
PORT=3000
API_PORT=3001
FRONTEND_URL=https://your-domain.com
API_URL=https://your-domain.com/api

# Database
DATABASE_URL=postgresql://wp_autohealer:change_this_password@postgres:5432/wp_autohealer
POSTGRES_USER=wp_autohealer
POSTGRES_PASSWORD=change_this_password
POSTGRES_DB=wp_autohealer

# Redis
REDIS_URL=redis://:change_this_password@redis:6379
REDIS_PASSWORD=change_this_password

# Security (CHANGE THESE!)
JWT_SECRET=change_this_to_a_secure_random_string_minimum_32_characters
ENCRYPTION_KEY=change_this_to_a_32_character_hex_string_for_encryption
SESSION_SECRET=change_this_to_another_secure_random_string

# SSH
SSH_TIMEOUT=30000
SSH_KEEPALIVE_INTERVAL=5000

# Incident Processing
MAX_FIX_ATTEMPTS=15
INCIDENT_TIMEOUT=1800000
COOLDOWN_WINDOW=600000

# Data Retention
DEFAULT_RETENTION_DAYS=3
MAX_RETENTION_DAYS=7

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# Logging
LOG_LEVEL=info
LOG_FORMAT=json

# Notifications (Optional)
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=noreply@wp-autohealer.com
```

## 🔒 Security Configuration

### SSL/TLS Configuration

```nginx
# nginx/ssl.conf
ssl_protocols TLSv1.2 TLSv1.3;
ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512:ECDHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES256-GCM-SHA384;
ssl_prefer_server_ciphers off;
ssl_session_cache shared:SSL:10m;
ssl_session_timeout 10m;
ssl_stapling on;
ssl_stapling_verify on;

# Security Headers
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header X-XSS-Protection "1; mode=block" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self'; frame-ancestors 'none';" always;
```

### Firewall Configuration

```bash
# UFW Firewall Rules
sudo ufw --force reset
sudo ufw default deny incoming
sudo ufw default allow outgoing

# SSH access (restrict to your IP)
sudo ufw allow from YOUR_IP_ADDRESS to any port 22

# HTTP/HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Database (only from application servers)
sudo ufw allow from 10.0.0.0/8 to any port 5432

# Redis (only from application servers)
sudo ufw allow from 10.0.0.0/8 to any port 6379

sudo ufw --force enable
```

### Application Security Headers

```typescript
// Security middleware configuration
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP',
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/', limiter);
```

## ⚡ Performance Configuration

### Database Performance Tuning

```sql
-- PostgreSQL configuration (postgresql.conf)
-- Memory settings
shared_buffers = 256MB                    # 25% of RAM
effective_cache_size = 1GB               # 75% of RAM
maintenance_work_mem = 64MB              # For maintenance operations
work_mem = 4MB                           # Per-connection work memory

-- Checkpoint settings
checkpoint_completion_target = 0.9       # Spread checkpoints
wal_buffers = 16MB                       # WAL buffer size
checkpoint_timeout = 10min               # Checkpoint frequency

-- Connection settings
max_connections = 100                    # Maximum connections
shared_preload_libraries = 'pg_stat_statements'  # Query statistics

-- Query optimization
default_statistics_target = 100         # Statistics detail level
random_page_cost = 1.1                  # SSD optimization
effective_io_concurrency = 200          # Concurrent I/O operations
```

### Redis Performance Tuning

```bash
# redis.conf
# Memory management
maxmemory 256mb
maxmemory-policy allkeys-lru    # LRU eviction for optimal cache performance

# Persistence
save 900 1      # Save if at least 1 key changed in 900 seconds
save 300 10     # Save if at least 10 keys changed in 300 seconds
save 60 10000   # Save if at least 10000 keys changed in 60 seconds

# Network
tcp-keepalive 60    # Optimized keepalive for Docker environments
timeout 0

# Performance
hash-max-ziplist-entries 512
hash-max-ziplist-value 64
list-max-ziplist-size -2
set-max-intset-entries 512
```

### Node.js Performance Configuration

```typescript
// PM2 ecosystem configuration
module.exports = {
  apps: [{
    name: 'wp-autohealer-api',
    script: 'dist/main.js',
    instances: 'max',
    exec_mode: 'cluster',
    max_memory_restart: '1G',
    node_args: [
      '--max-old-space-size=1024'
    ],
    env: {
      NODE_ENV: 'production',
      UV_THREADPOOL_SIZE: 128,
      NODE_OPTIONS: '--max-old-space-size=1024'
    },
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true
  }]
};
```

## 📊 Monitoring Configuration

### Prometheus Metrics Configuration

```yaml
# prometheus.yml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

rule_files:
  - "wp-autohealer-rules.yml"

scrape_configs:
  - job_name: 'wp-autohealer-api'
    static_configs:
      - targets: ['localhost:9090']
    metrics_path: '/metrics'
    scrape_interval: 30s

  - job_name: 'wp-autohealer-postgres'
    static_configs:
      - targets: ['localhost:9187']

  - job_name: 'wp-autohealer-redis'
    static_configs:
      - targets: ['localhost:9121']

alerting:
  alertmanagers:
    - static_configs:
        - targets:
          - alertmanager:9093
```

### Grafana Dashboard Configuration

```json
{
  "dashboard": {
    "title": "WP-AutoHealer Monitoring",
    "panels": [
      {
        "title": "Active Incidents",
        "type": "stat",
        "targets": [
          {
            "expr": "wp_autohealer_active_incidents",
            "legendFormat": "Active Incidents"
          }
        ]
      },
      {
        "title": "Incident Processing Rate",
        "type": "graph",
        "targets": [
          {
            "expr": "rate(wp_autohealer_incidents_total[5m])",
            "legendFormat": "Incidents/sec"
          }
        ]
      },
      {
        "title": "API Response Time",
        "type": "graph",
        "targets": [
          {
            "expr": "histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))",
            "legendFormat": "95th percentile"
          }
        ]
      }
    ]
  }
}
```

## 🔧 Configuration Validation

### Environment Validation Script

```bash
#!/bin/bash
# validate-config.sh

echo "Validating WP-AutoHealer configuration..."

# Check required environment variables
required_vars=(
    "NODE_ENV"
    "DATABASE_URL"
    "REDIS_URL"
    "JWT_SECRET"
    "ENCRYPTION_KEY"
    "SESSION_SECRET"
)

for var in "${required_vars[@]}"; do
    if [ -z "${!var}" ]; then
        echo "ERROR: Required environment variable $var is not set"
        exit 1
    fi
done

# Validate JWT secret length
if [ ${#JWT_SECRET} -lt 32 ]; then
    echo "ERROR: JWT_SECRET must be at least 32 characters long"
    exit 1
fi

# Validate encryption key format
if [ ${#ENCRYPTION_KEY} -ne 64 ]; then
    echo "ERROR: ENCRYPTION_KEY must be exactly 64 characters (32 bytes hex)"
    exit 1
fi

# Test database connection
if ! psql "$DATABASE_URL" -c "SELECT 1;" > /dev/null 2>&1; then
    echo "ERROR: Cannot connect to database"
    exit 1
fi

# Test Redis connection
if ! redis-cli -u "$REDIS_URL" ping > /dev/null 2>&1; then
    echo "ERROR: Cannot connect to Redis"
    exit 1
fi

echo "Configuration validation passed!"
```

### Configuration Health Check

```typescript
@Injectable()
export class ConfigHealthService {
  async validateConfiguration(): Promise<ConfigValidationResult> {
    const results: ConfigValidationResult = {
      valid: true,
      errors: [],
      warnings: []
    };

    // Validate database connection
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (error) {
      results.valid = false;
      results.errors.push('Database connection failed');
    }

    // Validate Redis connection
    try {
      await this.redis.ping();
    } catch (error) {
      results.valid = false;
      results.errors.push('Redis connection failed');
    }

    // Validate encryption key
    if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length !== 64) {
      results.valid = false;
      results.errors.push('Invalid encryption key format');
    }

    // Validate JWT secret
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
      results.valid = false;
      results.errors.push('JWT secret too short');
    }

    // Check retention policy
    const retentionDays = parseInt(process.env.DEFAULT_RETENTION_DAYS || '3');
    if (retentionDays < 1 || retentionDays > 7) {
      results.warnings.push('Retention days outside recommended range (1-7)');
    }

    return results;
  }
}
```

This configuration guide provides comprehensive coverage of all WP-AutoHealer configuration options, from basic environment setup to advanced performance tuning and security hardening.

---

*Last updated: January 2024*