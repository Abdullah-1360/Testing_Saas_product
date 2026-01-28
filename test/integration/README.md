# WP-AutoHealer Integration Tests

This directory contains comprehensive end-to-end integration tests that validate the complete system functionality of WP-AutoHealer.

## Overview

The integration tests cover four main areas as specified in the task requirements:

1. **Complete Incident Processing Workflow** (`incident-workflow.e2e-spec.ts`)
2. **Database Migration Testing** (`database-migration.e2e-spec.ts`) 
3. **Real-time Update Functionality** (`realtime-updates.e2e-spec.ts`)
4. **API Authentication and Authorization** (`api-authorization.e2e-spec.ts`)

## Test Coverage

### 1. Incident Workflow Integration Tests

**File**: `incident-workflow.e2e-spec.ts`

**Validates**:
- Complete incident lifecycle from creation to resolution
- State machine transitions (NEW → DISCOVERY → BASELINE → BACKUP → OBSERVABILITY → FIX_ATTEMPT → VERIFY → FIXED/ROLLBACK/ESCALATED)
- Fix attempt limits and escalation
- Rollback scenarios and recovery
- Real-time SSE updates during processing
- Complete audit trail creation
- Error handling and recovery
- Performance under concurrent processing

**Key Test Scenarios**:
- End-to-end incident processing workflow
- Fix attempt limit enforcement (15 attempts max)
- Rollback on verification failure
- Real-time SSE event broadcasting
- Audit trail completeness
- Trace and correlation ID tracking
- Job processing failure handling
- Incident resumption after system restart
- Concurrent incident processing
- Performance benchmarks

### 2. Database Migration Integration Tests

**File**: `database-migration.e2e-spec.ts`

**Validates**:
- Database schema creation and validation
- Data integrity during migrations
- Migration rollback and recovery
- Performance optimization through indexes
- Data validation and constraints

**Key Test Scenarios**:
- Complete schema creation with correct types
- Index creation for performance optimization
- Foreign key relationship validation
- Data preservation during schema updates
- Cascade delete behavior
- Migration idempotency
- Performance with large datasets
- Constraint enforcement (unique, check, not null)

### 3. Real-time Updates Integration Tests

**File**: `realtime-updates.e2e-spec.ts`

**Validates**:
- Server-Sent Events (SSE) connection management
- Real-time incident updates
- Site health status broadcasting
- System status notifications
- Event filtering and permissions
- Connection resilience

**Key Test Scenarios**:
- SSE connection establishment and authentication
- Multiple concurrent connections
- Role-based event filtering
- Incident lifecycle event broadcasting
- Site health update notifications
- System status and alert broadcasting
- Connection drop handling
- Performance under high-frequency events
- Connection statistics and monitoring

### 4. API Authorization Integration Tests

**File**: `api-authorization.e2e-spec.ts`

**Validates**:
- Multi-factor authentication flows
- Role-based access control (RBAC)
- Session management
- Security boundary enforcement
- Rate limiting per role
- Audit logging for security events

**Key Test Scenarios**:
- Complete login/logout cycles
- MFA authentication flow
- RBAC enforcement across all endpoints
- Privilege escalation prevention
- Cross-user data access protection
- Resource ownership enforcement
- Rate limiting by role
- Security event audit logging
- Session management and validation
- API security headers

## Running the Tests

### Prerequisites

1. **Database Setup**:
   ```bash
   # Ensure PostgreSQL is running
   sudo systemctl start postgresql
   
   # Create test database
   createdb wp_autohealer_integration_test
   ```

2. **Redis Setup**:
   ```bash
   # Ensure Redis is running
   sudo systemctl start redis
   ```

3. **Environment Variables**:
   ```bash
   export TEST_DATABASE_URL="postgresql://test:test@localhost:5432/wp_autohealer_integration_test"
   export TEST_REDIS_URL="redis://localhost:6379/2"
   export NODE_ENV=test
   ```

### Running Individual Test Suites

```bash
# Run incident workflow tests
npm run test:integration:workflow

# Run database migration tests  
npm run test:integration:migration

# Run real-time updates tests
npm run test:integration:realtime

# Run API authorization tests
npm run test:integration:auth
```

### Running All Integration Tests

```bash
# Run complete integration test suite
npm run test:integration

# Or use the script directly
./scripts/run-integration-tests.sh
```

### Running with Coverage

```bash
# Generate coverage report
npm run test:integration:coverage
```

## Test Configuration

### Jest Configuration

The integration tests use a specialized Jest configuration (`jest-integration.json`) with:

- **Extended Timeout**: 120 seconds for complex workflows
- **Single Worker**: Prevents database conflicts
- **Force Exit**: Ensures clean test completion
- **Verbose Output**: Detailed test reporting
- **Coverage Collection**: Comprehensive code coverage

### Database Isolation

Each test suite:
- Uses a dedicated test database
- Resets schema before each test
- Cleans up all test data after completion
- Runs migrations to ensure schema consistency

### Environment Isolation

Tests run in complete isolation with:
- Separate Redis database (db 2)
- Test-specific environment variables
- Mocked external dependencies where appropriate
- Clean state initialization

## Test Data Management

### Test Users

Each test suite creates role-specific test users:
- `super_admin@*.test` - Super Administrator
- `admin@*.test` - Administrator  
- `engineer@*.test` - Engineer
- `viewer@*.test` - Viewer

### Test Resources

Tests create and clean up:
- Servers with encrypted credentials
- Sites with WordPress configurations
- Incidents with complete timelines
- Retention policies with audit trails
- Evidence and backup artifacts

### Data Cleanup

Comprehensive cleanup ensures:
- No test data leakage between tests
- Clean database state for each test
- Proper resource disposal
- Memory leak prevention

## Performance Benchmarks

The integration tests include performance validation:

### Response Time Benchmarks
- API endpoints: < 1 second
- Incident processing: < 5 seconds
- SSE event delivery: < 500ms
- Database queries: < 100ms

### Concurrency Benchmarks
- 10+ concurrent SSE connections
- 5+ concurrent incident processing
- 100+ rapid API requests
- 1000+ database records

### Memory Usage
- Connection tracking accuracy
- Event delivery reliability
- Resource cleanup verification

## Troubleshooting

### Common Issues

1. **Database Connection Errors**:
   ```bash
   # Check PostgreSQL status
   sudo systemctl status postgresql
   
   # Verify test database exists
   psql -l | grep wp_autohealer_integration_test
   ```

2. **Redis Connection Errors**:
   ```bash
   # Check Redis status
   sudo systemctl status redis
   
   # Test Redis connection
   redis-cli ping
   ```

3. **Port Conflicts**:
   ```bash
   # Check if ports are in use
   netstat -tulpn | grep :3000
   netstat -tulpn | grep :5432
   netstat -tulpn | grep :6379
   ```

4. **Permission Errors**:
   ```bash
   # Ensure test script is executable
   chmod +x scripts/run-integration-tests.sh
   ```

### Debug Mode

Run tests with debug output:
```bash
DEBUG=* npm run test:integration
```

### Verbose Logging

Enable detailed logging:
```bash
LOG_LEVEL=debug npm run test:integration
```

## Continuous Integration

The integration tests are designed for CI/CD environments:

### GitHub Actions Integration
```yaml
- name: Run Integration Tests
  run: |
    npm run test:integration
  env:
    TEST_DATABASE_URL: ${{ secrets.TEST_DATABASE_URL }}
    TEST_REDIS_URL: ${{ secrets.TEST_REDIS_URL }}
```

### Docker Support
```bash
# Run tests in Docker environment
docker-compose -f docker-compose.test.yml up --abort-on-container-exit
```

## Contributing

When adding new integration tests:

1. **Follow Naming Convention**: `*.e2e-spec.ts`
2. **Include Comprehensive Cleanup**: Prevent data leakage
3. **Add Performance Benchmarks**: Validate response times
4. **Document Test Scenarios**: Clear test descriptions
5. **Update This README**: Keep documentation current

## Validation Against Requirements

These integration tests validate the following requirements:

- **Requirements 2.1-2.5**: Complete operation logging and audit trails
- **Requirements 3.1-3.6**: Data retention and purging functionality  
- **Requirements 4.1-4.9**: System discovery and detection
- **Requirements 5.1-5.6**: Safe change management
- **Requirements 6.1-6.10**: Security and secrets management
- **Requirements 8.1-8.6**: Job engine state management
- **Requirements 9.1-9.6**: Authentication and authorization
- **Requirements 13.1-13.9**: Verification logic
- **Requirements 15.1-15.9**: REST API design

The tests provide comprehensive validation of the complete WP-AutoHealer system integration.