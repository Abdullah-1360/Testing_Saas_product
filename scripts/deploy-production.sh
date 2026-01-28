#!/bin/bash

# WP-AutoHealer Production Deployment Script
# This script deploys the WP-AutoHealer system to production environment

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
COMPOSE_FILE="docker-compose.prod.yml"
ENV_FILE=".env.production"
BACKUP_DIR="backups/$(date +%Y%m%d_%H%M%S)"

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

# Function to check prerequisites
check_prerequisites() {
    print_status "Checking prerequisites..."
    
    # Check for required tools
    local required_tools=("docker" "docker-compose" "openssl")
    local missing_tools=()
    
    for tool in "${required_tools[@]}"; do
        if ! command -v "$tool" &> /dev/null; then
            missing_tools+=("$tool")
        fi
    done
    
    if [[ ${#missing_tools[@]} -gt 0 ]]; then
        print_error "Missing required tools: ${missing_tools[*]}"
        return 1
    fi
    
    # Check if environment file exists
    if [[ ! -f "$ENV_FILE" ]]; then
        print_error "Environment file $ENV_FILE not found!"
        print_error "Run './scripts/setup-environment.sh production' first"
        return 1
    fi
    
    # Check if Docker is running
    if ! docker info &> /dev/null; then
        print_error "Docker is not running!"
        return 1
    fi
    
    print_success "All prerequisites satisfied"
    return 0
}

# Function to validate environment
validate_environment() {
    print_status "Validating production environment..."
    
    # Source environment file
    set -a
    source "$ENV_FILE"
    set +a
    
    # Check for placeholder values
    local placeholders=(
        "CHANGE_THIS"
        "REPLACE_WITH"
        "your-domain.com"
    )
    
    local has_placeholders=false
    for placeholder in "${placeholders[@]}"; do
        if grep -q "$placeholder" "$ENV_FILE"; then
            print_warning "Found placeholder '$placeholder' in $ENV_FILE"
            has_placeholders=true
        fi
    done
    
    if [[ "$has_placeholders" == "true" ]]; then
        print_error "Environment file contains placeholder values that must be updated"
        return 1
    fi
    
    # Check critical environment variables
    local required_vars=(
        "POSTGRES_PASSWORD"
        "REDIS_PASSWORD"
        "JWT_SECRET"
        "SESSION_SECRET"
        "ENCRYPTION_KEY"
    )
    
    for var in "${required_vars[@]}"; do
        if [[ -z "${!var}" ]]; then
            print_error "Required environment variable $var is not set"
            return 1
        fi
    done
    
    print_success "Environment validation passed"
    return 0
}

# Function to create backup
create_backup() {
    print_status "Creating backup before deployment..."
    
    mkdir -p "$BACKUP_DIR"
    
    # Backup database if running
    if docker-compose -f "$COMPOSE_FILE" ps postgres | grep -q "Up"; then
        print_status "Backing up database..."
        docker-compose -f "$COMPOSE_FILE" exec -T postgres pg_dump -U wp_autohealer wp_autohealer > "$BACKUP_DIR/database.sql"
        print_success "Database backup created: $BACKUP_DIR/database.sql"
    fi
    
    # Backup volumes
    print_status "Backing up volumes..."
    docker run --rm -v wp-autohealer_app_logs_prod:/data -v "$(pwd)/$BACKUP_DIR":/backup alpine tar czf /backup/app_logs.tar.gz -C /data .
    docker run --rm -v wp-autohealer_postgres_data_prod:/data -v "$(pwd)/$BACKUP_DIR":/backup alpine tar czf /backup/postgres_data.tar.gz -C /data .
    
    print_success "Backup created in $BACKUP_DIR"
}

# Function to build images
build_images() {
    print_status "Building Docker images..."
    
    # Build backend image
    print_status "Building backend image..."
    docker-compose -f "$COMPOSE_FILE" build --no-cache backend
    
    # Build frontend image
    print_status "Building frontend image..."
    docker-compose -f "$COMPOSE_FILE" build --no-cache frontend
    
    print_success "Images built successfully"
}

# Function to deploy services
deploy_services() {
    print_status "Deploying services..."
    
    # Pull latest images for third-party services
    docker-compose -f "$COMPOSE_FILE" pull postgres redis-master redis-replica nginx fluentd prometheus
    
    # Start services in order
    print_status "Starting database services..."
    docker-compose -f "$COMPOSE_FILE" up -d postgres redis-master redis-replica
    
    # Wait for database to be ready
    print_status "Waiting for database to be ready..."
    timeout=60
    while ! docker-compose -f "$COMPOSE_FILE" exec -T postgres pg_isready -U wp_autohealer -d wp_autohealer; do
        sleep 2
        timeout=$((timeout - 2))
        if [[ $timeout -le 0 ]]; then
            print_error "Database failed to start within 60 seconds"
            return 1
        fi
    done
    
    # Run database migrations
    print_status "Running database migrations..."
    docker-compose -f "$COMPOSE_FILE" run --rm backend npm run db:migrate:prod
    
    # Start application services
    print_status "Starting application services..."
    docker-compose -f "$COMPOSE_FILE" up -d backend frontend
    
    # Wait for backend to be ready
    print_status "Waiting for backend to be ready..."
    timeout=120
    while ! curl -f http://localhost:3000/health &> /dev/null; do
        sleep 5
        timeout=$((timeout - 5))
        if [[ $timeout -le 0 ]]; then
            print_error "Backend failed to start within 120 seconds"
            return 1
        fi
    done
    
    # Start proxy and monitoring services
    print_status "Starting proxy and monitoring services..."
    docker-compose -f "$COMPOSE_FILE" up -d nginx fluentd prometheus
    
    print_success "All services deployed successfully"
}

# Function to run health checks
run_health_checks() {
    print_status "Running health checks..."
    
    local services=("postgres" "redis-master" "redis-replica" "backend" "frontend" "nginx")
    local failed_services=()
    
    for service in "${services[@]}"; do
        if ! docker-compose -f "$COMPOSE_FILE" ps "$service" | grep -q "Up"; then
            failed_services+=("$service")
        fi
    done
    
    if [[ ${#failed_services[@]} -gt 0 ]]; then
        print_error "Health check failed for services: ${failed_services[*]}"
        return 1
    fi
    
    # Test API endpoints
    print_status "Testing API endpoints..."
    
    if ! curl -f http://localhost/health &> /dev/null; then
        print_error "Health endpoint check failed"
        return 1
    fi
    
    if ! curl -f http://localhost/api/v1/health &> /dev/null; then
        print_error "API health endpoint check failed"
        return 1
    fi
    
    print_success "All health checks passed"
    return 0
}

# Function to show deployment status
show_status() {
    print_status "Deployment Status:"
    echo "===================="
    
    docker-compose -f "$COMPOSE_FILE" ps
    
    echo ""
    print_status "Service URLs:"
    echo "Frontend: https://localhost"
    echo "API: https://localhost/api/v1"
    echo "Health Check: https://localhost/health"
    echo "Prometheus: http://localhost:9090"
    
    echo ""
    print_status "Logs:"
    echo "View logs with: docker-compose -f $COMPOSE_FILE logs -f [service]"
    echo "Available services: postgres, redis-master, redis-replica, backend, frontend, nginx, fluentd, prometheus"
}

# Function to rollback deployment
rollback() {
    print_warning "Rolling back deployment..."
    
    # Stop all services
    docker-compose -f "$COMPOSE_FILE" down
    
    # Restore from latest backup if available
    local latest_backup=$(ls -1t backups/ | head -n1)
    if [[ -n "$latest_backup" && -d "backups/$latest_backup" ]]; then
        print_status "Restoring from backup: $latest_backup"
        
        # Restore database
        if [[ -f "backups/$latest_backup/database.sql" ]]; then
            docker-compose -f "$COMPOSE_FILE" up -d postgres
            sleep 10
            docker-compose -f "$COMPOSE_FILE" exec -T postgres psql -U wp_autohealer -d wp_autohealer < "backups/$latest_backup/database.sql"
        fi
        
        # Restore volumes
        if [[ -f "backups/$latest_backup/app_logs.tar.gz" ]]; then
            docker run --rm -v wp-autohealer_app_logs_prod:/data -v "$(pwd)/backups/$latest_backup":/backup alpine tar xzf /backup/app_logs.tar.gz -C /data
        fi
        
        print_success "Rollback completed"
    else
        print_warning "No backup found for rollback"
    fi
}

# Main deployment function
main() {
    print_status "WP-AutoHealer Production Deployment"
    print_status "===================================="
    
    case "${1:-deploy}" in
        "deploy")
            if ! check_prerequisites; then
                exit 1
            fi
            
            if ! validate_environment; then
                exit 1
            fi
            
            create_backup
            build_images
            deploy_services
            
            if run_health_checks; then
                show_status
                print_success "Deployment completed successfully!"
            else
                print_error "Deployment failed health checks"
                read -p "Do you want to rollback? (y/N): " -n 1 -r
                echo
                if [[ $REPLY =~ ^[Yy]$ ]]; then
                    rollback
                fi
                exit 1
            fi
            ;;
        "rollback")
            rollback
            ;;
        "status")
            show_status
            ;;
        "health")
            run_health_checks
            ;;
        "logs")
            if [[ -n "$2" ]]; then
                docker-compose -f "$COMPOSE_FILE" logs -f "$2"
            else
                docker-compose -f "$COMPOSE_FILE" logs -f
            fi
            ;;
        "stop")
            print_status "Stopping all services..."
            docker-compose -f "$COMPOSE_FILE" down
            print_success "All services stopped"
            ;;
        "restart")
            print_status "Restarting services..."
            docker-compose -f "$COMPOSE_FILE" restart
            print_success "Services restarted"
            ;;
        "help"|*)
            echo "Usage: $0 [command]"
            echo ""
            echo "Commands:"
            echo "  deploy      Deploy to production (default)"
            echo "  rollback    Rollback to previous version"
            echo "  status      Show deployment status"
            echo "  health      Run health checks"
            echo "  logs [svc]  Show logs for all services or specific service"
            echo "  stop        Stop all services"
            echo "  restart     Restart all services"
            echo "  help        Show this help message"
            echo ""
            echo "Examples:"
            echo "  $0 deploy           # Deploy to production"
            echo "  $0 logs backend     # Show backend logs"
            echo "  $0 health           # Run health checks"
            ;;
    esac
}

# Run main function with all arguments
main "$@"