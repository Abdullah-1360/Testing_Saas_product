#!/bin/bash

# WP-AutoHealer Environment Setup Script
# This script helps set up environment variables for different deployment environments

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to generate secure random string
generate_secret() {
    local length=${1:-64}
    openssl rand -base64 $length | tr -d "=+/" | cut -c1-$length
}

# Function to generate 32-byte encryption key
generate_encryption_key() {
    openssl rand -base64 32 | tr -d "=+/" | cut -c1-32
}

# Function to validate environment
validate_environment() {
    local env_file=$1
    
    print_status "Validating environment file: $env_file"
    
    # Check if file exists
    if [[ ! -f "$env_file" ]]; then
        print_error "Environment file $env_file not found!"
        return 1
    fi
    
    # Check for placeholder values that need to be changed
    local placeholders=(
        "CHANGE_THIS"
        "your-domain.com"
        "your-provider.com"
        "REPLACE_WITH"
    )
    
    local has_placeholders=false
    for placeholder in "${placeholders[@]}"; do
        if grep -q "$placeholder" "$env_file"; then
            print_warning "Found placeholder '$placeholder' in $env_file - please update with actual values"
            has_placeholders=true
        fi
    done
    
    if [[ "$has_placeholders" == "true" ]]; then
        print_error "Environment file contains placeholder values that must be updated"
        return 1
    fi
    
    print_success "Environment file validation passed"
    return 0
}

# Function to setup production environment
setup_production() {
    print_status "Setting up production environment..."
    
    local env_file=".env.production"
    
    if [[ -f "$env_file" ]]; then
        print_warning "Production environment file already exists"
        read -p "Do you want to regenerate secrets? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            print_status "Skipping production setup"
            return 0
        fi
    fi
    
    print_status "Generating secure secrets for production..."
    
    # Generate secrets
    local jwt_secret=$(generate_secret 64)
    local session_secret=$(generate_secret 64)
    local encryption_key=$(generate_encryption_key)
    local webhook_secret=$(generate_secret 32)
    local postgres_password=$(generate_secret 32)
    local redis_password=$(generate_secret 32)
    
    # Create production environment file
    cat > "$env_file" << EOF
# Production Environment Configuration for WP-AutoHealer
# Generated on $(date)
# WARNING: This file contains sensitive information. Never commit to version control.

# Application Configuration
NODE_ENV=production
API_VERSION=v1

# Server Ports
BACKEND_PORT=3000
FRONTEND_PORT=3001
HTTP_PORT=80
HTTPS_PORT=443
PROMETHEUS_PORT=9090

# Database Configuration
POSTGRES_DB=wp_autohealer
POSTGRES_USER=wp_autohealer
POSTGRES_PASSWORD=$postgres_password
POSTGRES_PORT=5432
DATABASE_POOL_SIZE=20

# Redis Configuration (Cluster)
REDIS_PASSWORD=$redis_password
REDIS_MASTER_PORT=6379
REDIS_REPLICA_PORT=6380

# Security Configuration
JWT_SECRET=$jwt_secret
SESSION_SECRET=$session_secret
ENCRYPTION_KEY=$encryption_key
WEBHOOK_SECRET=$webhook_secret

# SSL/TLS Configuration
SSL_CERT_PATH=/etc/nginx/ssl/cert.pem
SSL_KEY_PATH=/etc/nginx/ssl/private.key
SSL_DHPARAM_PATH=/etc/nginx/ssl/dhparam.pem

# Rate Limiting (Production values)
RATE_LIMIT_TTL=60
RATE_LIMIT_LIMIT=50

# Logging Configuration
LOG_LEVEL=warn
LOG_FILE_ENABLED=true
LOG_FILE_PATH=/app/logs/wp-autohealer.log
LOG_MAX_FILES=30
LOG_MAX_SIZE=50m

# Retention Policy Configuration
DEFAULT_RETENTION_DAYS=3
MAX_RETENTION_DAYS=7

# Job Processing Configuration
MAX_FIX_ATTEMPTS=15
INCIDENT_COOLDOWN_WINDOW=600
CIRCUIT_BREAKER_THRESHOLD=5
CIRCUIT_BREAKER_TIMEOUT=300000

# SSH Configuration
SSH_CONNECTION_TIMEOUT=30000
SSH_COMMAND_TIMEOUT=60000
SSH_MAX_CONNECTIONS=20

# Verification Configuration
VERIFICATION_TIMEOUT=30000
VERIFICATION_RETRY_ATTEMPTS=3

# Frontend Configuration
NEXT_PUBLIC_API_URL=https://REPLACE_WITH_YOUR_DOMAIN/api/v1
NEXT_PUBLIC_APP_NAME=WP-AutoHealer
NEXT_PUBLIC_APP_VERSION=1.0.0

# Monitoring and Observability
ENABLE_SWAGGER=false
ENABLE_BULL_BOARD=false
ENABLE_METRICS=true
METRICS_PORT=9464

# Health Check Configuration
HEALTH_CHECK_INTERVAL=30
HEALTH_CHECK_TIMEOUT=10
HEALTH_CHECK_RETRIES=3
EOF
    
    print_success "Production environment file created: $env_file"
    print_warning "Please update the following placeholders in $env_file:"
    print_warning "  - REPLACE_WITH_YOUR_DOMAIN"
    print_warning "  - Configure external service credentials if needed"
}

# Function to setup staging environment
setup_staging() {
    print_status "Setting up staging environment..."
    
    local env_file=".env.staging"
    
    # Copy from existing staging template or create new
    if [[ ! -f "$env_file" ]]; then
        cp ".env.staging" "$env_file" 2>/dev/null || {
            print_status "Creating staging environment from template..."
            # Create staging environment (less secure, more permissive)
            cat > "$env_file" << EOF
# Staging Environment Configuration for WP-AutoHealer
# Generated on $(date)

NODE_ENV=staging
API_VERSION=v1
BACKEND_PORT=3000
FRONTEND_PORT=3001
POSTGRES_DB=wp_autohealer_staging
POSTGRES_USER=wp_autohealer_staging
POSTGRES_PASSWORD=staging_password_$(generate_secret 16)
REDIS_PASSWORD=staging_redis_$(generate_secret 16)
JWT_SECRET=$(generate_secret 64)
SESSION_SECRET=$(generate_secret 64)
ENCRYPTION_KEY=$(generate_encryption_key)
WEBHOOK_SECRET=$(generate_secret 32)
LOG_LEVEL=debug
ENABLE_SWAGGER=true
ENABLE_BULL_BOARD=true
NEXT_PUBLIC_API_URL=https://staging.REPLACE_WITH_YOUR_DOMAIN/api/v1
NEXT_PUBLIC_APP_NAME=WP-AutoHealer (Staging)
NEXT_PUBLIC_APP_VERSION=1.0.0-staging
EOF
        }
    fi
    
    print_success "Staging environment file ready: $env_file"
}

# Function to check prerequisites
check_prerequisites() {
    print_status "Checking prerequisites..."
    
    # Check for required tools
    local required_tools=("openssl" "docker" "docker-compose")
    local missing_tools=()
    
    for tool in "${required_tools[@]}"; do
        if ! command -v "$tool" &> /dev/null; then
            missing_tools+=("$tool")
        fi
    done
    
    if [[ ${#missing_tools[@]} -gt 0 ]]; then
        print_error "Missing required tools: ${missing_tools[*]}"
        print_error "Please install the missing tools and try again"
        return 1
    fi
    
    print_success "All prerequisites satisfied"
    return 0
}

# Function to generate SSL certificates for development
generate_ssl_certs() {
    print_status "Generating self-signed SSL certificates for development..."
    
    local ssl_dir="docker/nginx/ssl"
    mkdir -p "$ssl_dir"
    
    # Generate private key
    openssl genrsa -out "$ssl_dir/private.key" 2048
    
    # Generate certificate
    openssl req -new -x509 -key "$ssl_dir/private.key" -out "$ssl_dir/cert.pem" -days 365 -subj "/C=US/ST=State/L=City/O=Organization/CN=localhost"
    
    # Generate DH parameters
    openssl dhparam -out "$ssl_dir/dhparam.pem" 2048
    
    print_success "SSL certificates generated in $ssl_dir"
    print_warning "These are self-signed certificates for development only"
    print_warning "Use proper certificates from a CA for production"
}

# Main function
main() {
    print_status "WP-AutoHealer Environment Setup"
    print_status "================================"
    
    # Check prerequisites
    if ! check_prerequisites; then
        exit 1
    fi
    
    # Parse command line arguments
    case "${1:-help}" in
        "production"|"prod")
            setup_production
            ;;
        "staging"|"stage")
            setup_staging
            ;;
        "validate")
            if [[ -n "$2" ]]; then
                validate_environment "$2"
            else
                print_error "Please specify environment file to validate"
                exit 1
            fi
            ;;
        "ssl")
            generate_ssl_certs
            ;;
        "all")
            setup_production
            setup_staging
            generate_ssl_certs
            ;;
        "help"|*)
            echo "Usage: $0 [command]"
            echo ""
            echo "Commands:"
            echo "  production, prod    Setup production environment"
            echo "  staging, stage      Setup staging environment"
            echo "  validate <file>     Validate environment file"
            echo "  ssl                 Generate SSL certificates for development"
            echo "  all                 Setup all environments and SSL"
            echo "  help                Show this help message"
            echo ""
            echo "Examples:"
            echo "  $0 production       # Setup production environment"
            echo "  $0 validate .env.production  # Validate production env file"
            echo "  $0 all              # Setup everything"
            ;;
    esac
}

# Run main function with all arguments
main "$@"