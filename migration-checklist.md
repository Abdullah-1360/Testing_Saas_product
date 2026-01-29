# WP-AutoHealer Migration Checklist

## Pre-Migration Steps

### 1. Create Migration Archive
```bash
# Stop all services first
docker-compose down

# Create a complete backup excluding node_modules and build artifacts
tar --exclude='node_modules' \
    --exclude='frontend/node_modules' \
    --exclude='frontend/.next' \
    --exclude='dist' \
    --exclude='logs/*.log' \
    --exclude='.git' \
    -czf wp-autohealer-migration-$(date +%Y%m%d-%H%M%S).tar.gz .
```

### 2. Database Backup
```bash
# Export PostgreSQL database
docker-compose up -d postgres
pg_dump -h localhost -p 5432 -U wp_autohealer -d wp_autohealer > wp-autohealer-db-backup.sql

# Export Redis data (if needed)
docker-compose exec redis redis-cli --rdb /data/dump.rdb
docker cp $(docker-compose ps -q redis):/data/dump.rdb ./redis-backup.rdb
```

### 3. Environment Configuration Backup
```bash
# Create secure environment backup
cp .env .env.backup
cp .env.production .env.production.backup
cp .env.staging .env.staging.backup
```

## Files to Transfer

### Core Application Files
- [ ] Source code (src/, frontend/src/)
- [ ] Configuration files (package.json, tsconfig.json, etc.)
- [ ] Docker configurations (docker-compose.*.yml, Dockerfile)
- [ ] Database schema (prisma/)
- [ ] Documentation (docs/)
- [ ] Scripts (scripts/)

### Kiro-Specific Files
- [ ] .kiro/hooks/ (All hook configurations)
- [ ] .kiro/specs/ (Project specifications)
- [ ] .kiro/steering/ (Steering rules and guidelines)
- [ ] .kiro/settings/ (If exists - MCP configurations)

### Environment & Secrets
- [ ] .env files (update for new server)
- [ ] SSL certificates (docker/nginx/ssl/)
- [ ] SSH keys (if stored locally)
- [ ] Database backup
- [ ] Redis backup (if needed)

### Optional Files
- [ ] logs/ (recent logs for debugging)
- [ ] Custom scripts or tools
- [ ] Any local development configurations

## Post-Migration Verification
- [ ] All services start successfully
- [ ] Database connections work
- [ ] Frontend connects to backend
- [ ] SSH connections to managed servers work
- [ ] Kiro hooks are active
- [ ] All environment variables are correct