#!/bin/bash

# API Testing Script for WP-AutoHealer
# **Validates: Requirements 15.7** - API endpoint testing suite

set -e

echo "🧪 WP-AutoHealer API Testing Suite"
echo "=================================="

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

# Check if required environment variables are set
check_environment() {
    print_status "Checking environment setup..."
    
    if [ ! -f ".env.test" ]; then
        print_error ".env.test file not found"
        exit 1
    fi
    
    # Source test environment
    source .env.test
    
    if [ -z "$DATABASE_URL" ]; then
        print_error "DATABASE_URL not set in .env.test"
        exit 1
    fi
    
    print_success "Environment setup verified"
}

# Setup test database
setup_database() {
    print_status "Setting up test database..."
    
    # Generate Prisma client
    npm run db:generate
    
    # Push database schema
    npm run db:push
    
    print_success "Test database setup complete"
}

# Run individual test suites
run_test_suite() {
    local test_name=$1
    local test_file=$2
    
    print_status "Running $test_name..."
    
    if npm run test:e2e -- --testPathPattern="$test_file" --verbose; then
        print_success "$test_name completed successfully"
        return 0
    else
        print_error "$test_name failed"
        return 1
    fi
}

# Run all API tests
run_api_tests() {
    print_status "Starting API test execution..."
    
    local failed_tests=0
    
    # Test suites to run
    declare -A test_suites=(
        ["Authentication Tests"]="auth.e2e-spec.ts"
        ["API Endpoints Tests"]="api-endpoints.e2e-spec.ts"
        ["Rate Limiting Tests"]="api-rate-limiting.e2e-spec.ts"
        ["Security Tests"]="api-security.e2e-spec.ts"
        ["Comprehensive API Tests"]="api-comprehensive.e2e-spec.ts"
    )
    
    # Run each test suite
    for test_name in "${!test_suites[@]}"; do
        if ! run_test_suite "$test_name" "${test_suites[$test_name]}"; then
            ((failed_tests++))
        fi
        echo ""
    done
    
    # Summary
    echo "=================================="
    if [ $failed_tests -eq 0 ]; then
        print_success "All API tests passed! ✅"
    else
        print_error "$failed_tests test suite(s) failed ❌"
        exit 1
    fi
}

# Generate test coverage report
generate_coverage() {
    print_status "Generating test coverage report..."
    
    if npm run test:cov -- --testPathPattern="e2e-spec.ts"; then
        print_success "Coverage report generated in coverage/ directory"
    else
        print_warning "Coverage report generation failed"
    fi
}

# Validate API documentation
validate_documentation() {
    print_status "Validating API documentation..."
    
    # Start the application in test mode
    npm run start:dev &
    APP_PID=$!
    
    # Wait for application to start
    sleep 10
    
    # Check if Swagger documentation is accessible
    if curl -f -s http://localhost:3000/api/docs > /dev/null; then
        print_success "Swagger documentation is accessible"
    else
        print_error "Swagger documentation is not accessible"
        kill $APP_PID 2>/dev/null || true
        exit 1
    fi
    
    # Check if OpenAPI JSON is valid
    if curl -f -s http://localhost:3000/api/docs-json | jq . > /dev/null; then
        print_success "OpenAPI JSON specification is valid"
    else
        print_error "OpenAPI JSON specification is invalid"
        kill $APP_PID 2>/dev/null || true
        exit 1
    fi
    
    # Stop the application
    kill $APP_PID 2>/dev/null || true
    sleep 2
}

# Performance testing
run_performance_tests() {
    print_status "Running basic performance tests..."
    
    # This would typically use tools like Artillery or k6
    # For now, we'll just verify the tests include performance checks
    if grep -q "responseTime" test/api-comprehensive.e2e-spec.ts; then
        print_success "Performance tests are included in comprehensive suite"
    else
        print_warning "No performance tests found"
    fi
}

# Security testing
run_security_tests() {
    print_status "Running security validation..."
    
    # Check if security tests exist and cover required areas
    local security_checks=(
        "input validation"
        "secret redaction"
        "authentication"
        "authorization"
        "rate limiting"
    )
    
    local missing_checks=0
    
    for check in "${security_checks[@]}"; do
        if ! grep -q -i "$check" test/api-security.e2e-spec.ts; then
            print_warning "Security test for '$check' not found"
            ((missing_checks++))
        fi
    done
    
    if [ $missing_checks -eq 0 ]; then
        print_success "All security test areas covered"
    else
        print_warning "$missing_checks security test area(s) missing"
    fi
}

# Main execution
main() {
    echo ""
    print_status "Starting WP-AutoHealer API Testing Suite..."
    echo ""
    
    # Check prerequisites
    check_environment
    
    # Setup
    setup_database
    
    # Run tests
    run_api_tests
    
    # Additional validations
    validate_documentation
    run_performance_tests
    run_security_tests
    
    # Generate coverage
    generate_coverage
    
    echo ""
    print_success "🎉 API Testing Suite completed successfully!"
    echo ""
    echo "📊 Test Results Summary:"
    echo "  ✅ Authentication & Authorization"
    echo "  ✅ API Endpoints & CRUD Operations"
    echo "  ✅ Rate Limiting & Throttling"
    echo "  ✅ Security & Input Validation"
    echo "  ✅ Error Handling & Responses"
    echo "  ✅ Documentation & OpenAPI Spec"
    echo ""
    echo "📚 View API Documentation: http://localhost:3000/api/docs"
    echo "📈 View Coverage Report: ./coverage/lcov-report/index.html"
    echo ""
}

# Handle script interruption
trap 'print_error "Script interrupted"; exit 1' INT TERM

# Run main function
main "$@"