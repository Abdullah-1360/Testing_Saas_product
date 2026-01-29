#!/bin/bash

# WP-AutoHealer Server Migration Script
# Usage: ./migrate-to-server.sh <target-server-ip> <username>

set -e

TARGET_SERVER="$1"
USERNAME="$2"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
MIGRATION_DIR="wp-autohealer-migration-$TIMESTAMP"

if [ -z "$TARGET_SERVER" ] || [ -z "$USERNAME" ]; then
    echo "Usage: $0 <target-server-ip> <username>"
    echo "Example: $0 192.168.1.100 ubuntu"
    exit 1
fi

echo "🚀 Starting WP-AutoHealer migration to $TARGET_SERVER"

# 1. Stop all services
echo "📦 Stopping services..."
docker-compose down

# 2. Create migration package
echo "📦 Creating migration package..."
tar --exclude='node_modules' \
    --exclude='frontend/node_modules' \
    --exclude='frontend/.next' \
    --exclude='dist' \
    --exclude='logs/*.log' \
    --exclude='.git' \
    -czf "$MIGRATION_DIR.tar.gz" .

# 3. Backup database
echo "💾 Backing up database..."
docker-compose up -d postgres redis
sleep 10

# Wait for PostgreSQL to be ready
until docker-compose exec postgres pg_isready -U wp_autohealer; do
    echo "Waiting for PostgreSQL..."
    sleep 2
done

# Export database
docker-compose exec -T postgres pg_dump -U wp_autohealer wp_autohealer > wp-autohealer-db-backup.sql

# Export Redis data
docker-compose exec redis redis-cli BGSAVE
sleep 5
docker cp $(docker-compose ps -q redis):/data/dump.rdb ./redis-backup.rdb

# Stop services again
docker-compose down

# 4. Transfer files to target server
echo "🚀 Transferring files to target server..."
scp "$MIGRATION_DIR.tar.gz" "$USERNAME@$TARGET_SERVER:~/"
scp "wp-autohealer-db-backup.sql" "$USERNAME@$TARGET_SERVER:~/"
scp "redis-backup.rdb" "$USERNAME@$TARGET_SERVER:~/"

# 5. Transfer setup script
cat > setup-on-target.sh << 'EOF'
#!/bin/bash
set -e

MIGRATION_FILE="$1"
DB_BACKUP="$2"
REDIS_BACKUP="$3"

echo "🔧 Setting up WP-AutoHealer on target server..."

# Install Docker and Docker Compose if not present
if ! command -v docker &> /dev/null; then
    echo "Installing Docker..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sudo sh get-docker.sh
    sudo usermod -aG docker $USER
fi

if ! command -v docker-compose &> /dev/null; then
    echo "Installing Docker Compose..."
    sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    sudo chmod +x /usr/local/bin/docker-compose
fi

# Install Node.js and npm if not present
if ! command -v node &> /dev/null; then
    echo "Installing Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

# Extract migration files
echo "📦 Extracting migration files..."
tar -xzf "$MIGRATION_FILE"
cd wp-autohealer

# Update environment for new server
echo "🔧 Updating environment configuration..."
cp .env .env.original
sed -i 's/localhost/127.0.0.1/g' .env
sed -i 's/development/production/g' .env

# Generate new secrets for production
NEW_JWT_SECRET=$(openssl rand -base64 32)
NEW_SESSION_SECRET=$(openssl rand -base64 32)
NEW_ENCRYPTION_KEY=$(openssl rand -base64 32 | cut -c1-32)
NEW_WEBHOOK_SECRET=$(openssl rand -base64 32)

sed -i "s/development-jwt-secret-key-for-testing-only-change-in-production/$NEW_JWT_SECRET/g" .env
sed -i "s/development-session-secret-key-for-testing-only-change-in-production/$NEW_SESSION_SECRET/g" .env
sed -i "s/development-encryption-key-32chr/$NEW_ENCRYPTION_KEY/g" .env
sed -i "s/development-webhook-secret-for-testing/$NEW_WEBHOOK_SECRET/g" .env

# Start database services
echo "🗄️ Starting database services..."
docker-compose up -d postgres redis

# Wait for services to be ready
sleep 15
until docker-compose exec postgres pg_isready -U wp_autohealer; do
    echo "Waiting for PostgreSQL..."
    sleep 2
done

# Restore database
echo "📥 Restoring database..."
docker-compose exec -T postgres psql -U wp_autohealer -d wp_autohealer < "../$DB_BACKUP"

# Restore Redis data
echo "📥 Restoring Redis data..."
docker cp "../$REDIS_BACKUP" $(docker-compose ps -q redis):/data/dump.rdb
docker-compose restart redis

# Install dependencies
echo "📦 Installing dependencies..."
npm ci
cd frontend && npm ci && cd ..

# Build applications
echo "🔨 Building applications..."
npm run build
cd frontend && npm run build && cd ..

# Run database migrations
echo "🗄️ Running database migrations..."
npm run db:generate
npm run db:migrate

# Start all services
echo "🚀 Starting all services..."
docker-compose up -d

echo "✅ Migration completed successfully!"
echo "🌐 Frontend: http://$(hostname -I | awk '{print $1}'):3000"
echo "🔧 Backend: http://$(hostname -I | awk '{print $1}'):3001"
echo "📊 Monitoring: http://$(hostname -I | awk '{print $1}'):9090"

EOF

scp setup-on-target.sh "$USERNAME@$TARGET_SERVER:~/"

echo "📋 Files transferred successfully!"
echo "🔧 Now run on the target server:"
echo "   ssh $USERNAME@$TARGET_SERVER"
echo "   chmod +x setup-on-target.sh"
echo "   ./setup-on-target.sh $MIGRATION_DIR.tar.gz wp-autohealer-db-backup.sql redis-backup.rdb"

# Cleanup local files
rm -f "$MIGRATION_DIR.tar.gz" wp-autohealer-db-backup.sql redis-backup.rdb setup-on-target.sh

echo "✅ Migration preparation completed!"