# WP-AutoHealer Troubleshooting Guide

This comprehensive troubleshooting guide helps you diagnose and resolve common issues with WP-AutoHealer.

## 🚨 Quick Diagnostics

### System Health Check

Run these commands to quickly assess system health:

```bash
# Check service status
sudo systemctl status nginx postgresql redis-server

# Check application processes
pm2 status
# or for Docker
docker-compose ps

# Check disk space
df -h

# Check memory usage
free -h

# Check system load
uptime
```

### Application Health Endpoints

```bash
# API health check
curl -f http://localhost:3001/health

# Database connectivity
curl -f http://localhost:3001/health/database

# Redis connectivity  
curl -f http://localhost:3001/health/redis

# Job queue status
curl -f http://localhost:3001/health/queue
```

## 🔧 Common Issues & Solutions

### 1. Login Issues

#### Problem: Cannot login to control panel

**Symptoms:**
- Login form shows "Invalid credentials"
- MFA code rejected
- Redirected back to login page

**Diagnosis:**
```bash
# Check API logs
docker-compose logs api | grep -i auth
# or
pm2 logs wp-autohealer-api | grep -i auth

# Check database connectivity
docker-compose exec postgres psql -U wp_autohealer -d wp_autohealer -c "SELECT COUNT(*) FROM users;"
```

**Solutions:**

1. **Reset admin password:**
```bash
# Docker deployment
docker-compose exec api npm run reset-password admin@example.com

# Manual deployment
npm run reset-password admin@example.com
```

2. **Disable MFA temporarily:**
```bash
# Using the MFA fix script (recommended)
node fix-mfa.js

# Or connect to database directly
docker-compose exec postgres psql -U wp_autohealer -d wp_autohealer

# Disable MFA for user
UPDATE users SET mfa_enabled = false WHERE email = 'admin@example.com';
```

3. **Check session configuration:**
```bash
# Verify SESSION_SECRET is set
grep SESSION_SECRET .env

# Clear all sessions
docker-compose exec redis redis-cli FLUSHDB
```

#### Problem: MFA setup issues

**Solutions:**

1. **Regenerate MFA secret:**
```bash
# Reset MFA for user
docker-compose exec api npm run reset-mfa admin@example.com
```

2. **Check time synchronization:**
```bash
# Verify server time
timedatectl status

# Sync time if needed
sudo ntpdate -s time.nist.gov
```

### 2. Server Connection Issues

#### Problem: Cannot connect to managed servers

**Symptoms:**
- "SSH connection failed" errors
- Server status shows "offline"
- Timeout errors in logs

**Diagnosis:**
```bash
# Test SSH connection manually
ssh -i /path/to/key user@server-hostname -p 22

# Check network connectivity
ping server-hostname
telnet server-hostname 22

# Check SSH service on target server
sudo systemctl status ssh
```

**Solutions:**

1. **SSH key issues:**
```bash
# Verify key permissions
chmod 600 /path/to/private/key
chmod 644 /path/to/public/key

# Test key authentication
ssh -i /path/to/key -o PasswordAuthentication=no user@hostname

# Add public key to server
ssh-copy-id -i /path/to/key user@hostname
```

2. **Firewall issues:**
```bash
# Check if SSH port is open
nmap -p 22 server-hostname

# On target server, check firewall
sudo ufw status
sudo iptables -L

# Allow SSH through firewall
sudo ufw allow ssh
```

3. **Host key verification:**
```bash
# Remove old host key
ssh-keygen -R server-hostname

# Accept new host key
ssh-keyscan -H server-hostname >> ~/.ssh/known_hosts
```

### 3. Site Monitoring Issues

#### Problem: Sites showing as unhealthy when they're working

**Symptoms:**
- False positive health check failures
- Sites marked as "critical" but accessible in browser
- Verification failures in incident logs

**Diagnosis:**
```bash
# Test site manually
curl -I https://example.com
curl -s https://example.com | grep -i title

# Check DNS resolution
nslookup example.com
dig example.com

# Test from server
ssh user@server "curl -I https://example.com"
```

**Solutions:**

1. **Adjust health check settings:**
```bash
# Increase timeout values
# In control panel: Sites → Edit Site → Health Check Settings
# Set timeout to 30-60 seconds
```

2. **Check SSL certificate issues:**
```bash
# Test SSL certificate
openssl s_client -connect example.com:443 -servername example.com

# Check certificate expiry
echo | openssl s_client -connect example.com:443 2>/dev/null | openssl x509 -noout -dates
```

3. **Whitelist monitoring IP:**
```bash
# Add WP-AutoHealer server IP to site's firewall whitelist
# Check with hosting provider if IP blocking is occurring
```

### 4. Incident Processing Issues

#### Problem: Incidents stuck in processing

**Symptoms:**
- Incidents remain in "DISCOVERY" or "FIX_ATTEMPT" state
- No progress for extended periods
- Job queue backing up

**Diagnosis:**
```bash
# Check job queue status
docker-compose exec redis redis-cli
> LLEN bullmq:incident-processing:waiting
> LLEN bullmq:incident-processing:active
> LLEN bullmq:incident-processing:failed

# Check job processor logs
docker-compose logs job-processor
```

**Solutions:**

1. **Restart job processors:**
```bash
# Docker deployment
docker-compose restart job-processor

# Manual deployment
pm2 restart wp-autohealer-jobs
```

2. **Clear stuck jobs:**
```bash
# Connect to Redis
docker-compose exec redis redis-cli

# Clear failed jobs
> DEL bullmq:incident-processing:failed

# Clear waiting jobs (use with caution)
> DEL bullmq:incident-processing:waiting
```

3. **Increase job timeout:**
```bash
# Edit environment variables
JOB_TIMEOUT=300000  # 5 minutes
SSH_TIMEOUT=60000   # 1 minute

# Restart services
docker-compose restart
```

### 5. Database Issues

#### Problem: Database connection errors

**Symptoms:**
- "Database connection failed" errors
- API returning 500 errors
- Prisma connection timeouts

**Diagnosis:**
```bash
# Check PostgreSQL status
sudo systemctl status postgresql

# Test database connection
docker-compose exec postgres psql -U wp_autohealer -d wp_autohealer -c "SELECT version();"

# Check connection pool
docker-compose logs api | grep -i "database\|prisma"
```

**Solutions:**

1. **Restart PostgreSQL:**
```bash
# System service
sudo systemctl restart postgresql

# Docker container
docker-compose restart postgres
```

2. **Check database configuration:**
```bash
# Verify DATABASE_URL in .env
grep DATABASE_URL .env

# Test connection string
psql "postgresql://wp_autohealer:password@localhost:5432/wp_autohealer" -c "SELECT 1;"
```

3. **Database maintenance:**
```bash
# Connect to database
docker-compose exec postgres psql -U wp_autohealer -d wp_autohealer

# Analyze and vacuum
ANALYZE;
VACUUM;

# Check for locks
SELECT * FROM pg_locks WHERE NOT granted;
```

### 6. Performance Issues

#### Problem: Slow response times

**Symptoms:**
- Control panel loads slowly
- API requests timing out
- High CPU or memory usage

**Diagnosis:**
```bash
# Check system resources
htop
iotop
nethogs

# Check application metrics
docker stats
pm2 monit

# Check database performance
docker-compose exec postgres psql -U wp_autohealer -d wp_autohealer -c "
SELECT query, calls, total_time, mean_time 
FROM pg_stat_statements 
ORDER BY total_time DESC 
LIMIT 10;"
```

**Solutions:**

1. **Scale application:**
```bash
# Increase PM2 instances
pm2 scale wp-autohealer-api +2

# Or adjust Docker resources
# Edit docker-compose.yml:
services:
  api:
    deploy:
      resources:
        limits:
          memory: 2G
        reservations:
          memory: 1G
```

2. **Optimize database:**
```bash
# Tune PostgreSQL settings
# Edit postgresql.conf:
shared_buffers = 256MB
effective_cache_size = 1GB
maintenance_work_mem = 64MB
```

3. **Clear Redis cache:**
```bash
docker-compose exec redis redis-cli FLUSHALL
```

### 7. Storage Issues

#### Problem: Disk space running low

**Symptoms:**
- "No space left on device" errors
- Application crashes
- Database write failures

**Diagnosis:**
```bash
# Check disk usage
df -h
du -sh /var/lib/docker/
du -sh /var/log/

# Check large files
find / -type f -size +100M 2>/dev/null | head -20
```

**Solutions:**

1. **Clean up logs:**
```bash
# Rotate logs
sudo logrotate -f /etc/logrotate.conf

# Clean Docker logs
docker system prune -f
docker volume prune -f

# Clean application logs
find /var/log -name "*.log" -mtime +7 -delete
```

2. **Purge old data:**
```bash
# Manual data purge via API
curl -X POST https://your-domain.com/api/v1/settings/purge \
  -H "Authorization: Bearer token" \
  -H "Content-Type: application/json" \
  -d '{"cutoffDate":"2024-01-01T00:00:00Z"}'

# Or via database
docker-compose exec postgres psql -U wp_autohealer -d wp_autohealer -c "
DELETE FROM incident_events WHERE timestamp < NOW() - INTERVAL '3 days';
DELETE FROM command_executions WHERE timestamp < NOW() - INTERVAL '3 days';
"
```

## 🔍 Advanced Diagnostics

### Log Analysis

#### Application Logs
```bash
# API logs
docker-compose logs -f api | grep ERROR

# Job processor logs  
docker-compose logs -f job-processor | grep -E "(ERROR|FAILED)"

# Frontend logs
docker-compose logs -f frontend
```

#### System Logs
```bash
# System messages
sudo journalctl -u wp-autohealer -f

# Nginx logs
sudo tail -f /var/log/nginx/error.log
sudo tail -f /var/log/nginx/access.log

# PostgreSQL logs
sudo tail -f /var/log/postgresql/postgresql-14-main.log
```

### Database Diagnostics

```sql
-- Check database size
SELECT 
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
FROM pg_tables 
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- Check active connections
SELECT 
    pid,
    usename,
    application_name,
    client_addr,
    state,
    query_start,
    query
FROM pg_stat_activity 
WHERE state = 'active';

-- Check slow queries
SELECT 
    query,
    calls,
    total_time,
    mean_time,
    stddev_time
FROM pg_stat_statements 
WHERE mean_time > 1000
ORDER BY mean_time DESC;
```

### Redis Diagnostics

```bash
# Connect to Redis
docker-compose exec redis redis-cli

# Check memory usage
> INFO memory

# Check connected clients
> CLIENT LIST

# Monitor commands
> MONITOR

# Check key patterns
> KEYS bullmq:*
> KEYS session:*
```

## 🛠️ Recovery Procedures

### Complete System Recovery

If the system is completely unresponsive:

1. **Stop all services:**
```bash
docker-compose down
# or
pm2 stop all
sudo systemctl stop nginx
```

2. **Check system resources:**
```bash
df -h
free -h
ps aux | grep -E "(node|postgres|redis)"
```

3. **Start services individually:**
```bash
# Start database first
docker-compose up -d postgres redis

# Wait for databases to be ready
sleep 30

# Start application
docker-compose up -d api job-processor

# Finally start frontend
docker-compose up -d frontend nginx
```

### Database Recovery

If database is corrupted:

1. **Stop application:**
```bash
docker-compose stop api job-processor
```

2. **Backup current state:**
```bash
docker-compose exec postgres pg_dump -U wp_autohealer wp_autohealer > backup_$(date +%Y%m%d).sql
```

3. **Restore from backup:**
```bash
# Drop and recreate database
docker-compose exec postgres psql -U postgres -c "DROP DATABASE wp_autohealer;"
docker-compose exec postgres psql -U postgres -c "CREATE DATABASE wp_autohealer OWNER wp_autohealer;"

# Restore from backup
docker-compose exec -T postgres psql -U wp_autohealer wp_autohealer < backup_20240115.sql

# Run migrations
docker-compose exec api npm run prisma:migrate:deploy
```

### Configuration Recovery

If configuration is lost:

1. **Restore from backup:**
```bash
cp /backup/wp-autohealer/.env .env
cp /backup/wp-autohealer/docker-compose.yml docker-compose.yml
```

2. **Regenerate secrets:**
```bash
# Generate new JWT secret
openssl rand -base64 32

# Generate new encryption key
openssl rand -hex 32

# Update .env file with new secrets
```

## 📞 Getting Help

### Self-Service Resources

1. **Check system status page:** https://status.wp-autohealer.com
2. **Review documentation:** https://docs.wp-autohealer.com
3. **Search community forum:** https://community.wp-autohealer.com

### Collecting Diagnostic Information

Before contacting support, collect this information:

```bash
# System information
uname -a
cat /etc/os-release
docker --version
docker-compose --version

# Application version
docker-compose exec api npm run version

# Service status
docker-compose ps
systemctl status nginx postgresql redis-server

# Recent logs
docker-compose logs --tail=100 api > api-logs.txt
docker-compose logs --tail=100 job-processor > job-logs.txt

# Configuration (redacted)
grep -v -E "(PASSWORD|SECRET|KEY)" .env > config-redacted.txt
```

### Support Channels

- **Emergency Support:** emergency@wp-autohealer.com
- **Technical Support:** support@wp-autohealer.com  
- **Community Forum:** https://community.wp-autohealer.com
- **Documentation Issues:** docs@wp-autohealer.com

### Support Ticket Information

Include this information in support tickets:

1. **Problem Description:** Clear description of the issue
2. **Steps to Reproduce:** How to recreate the problem
3. **Expected Behavior:** What should happen
4. **Actual Behavior:** What actually happens
5. **Environment Details:** OS, versions, configuration
6. **Log Files:** Relevant log excerpts
7. **Screenshots:** If UI-related issue

---

*This troubleshooting guide covers the most common issues. For additional help, consult the community forum or contact support.*

*Last updated: January 2024*