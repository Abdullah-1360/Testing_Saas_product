# WP-AutoHealer API Testing Guide

**Validates: Requirements 15.7** - API Documentation and Testing

This guide provides comprehensive information about testing the WP-AutoHealer REST API, including endpoint testing, rate limiting validation, security testing, and documentation verification.

## Overview

The WP-AutoHealer API testing suite ensures:
- ✅ All API endpoints function correctly
- ✅ Authentication and authorization work as expected
- ✅ Rate limiting is properly enforced
- ✅ Security measures are effective
- ✅ Error handling is consistent
- ✅ Documentation is complete and accurate

## Test Suite Structure

### 1. Authentication Tests (`test/auth.e2e-spec.ts`)
Tests the complete authentication flow including:
- User login/logout
- JWT token validation
- MFA support
- Session management
- Role-based access control

### 2. API Endpoints Tests (`test/api-endpoints.e2e-spec.ts`)
Comprehensive testing of all API endpoints:
- CRUD operations for all resources
- Pagination and filtering
- Response format consistency
- Error handling
- API versioning

### 3. Rate Limiting Tests (`test/api-rate-limiting.e2e-spec.ts`)
Validates rate limiting functionality:
- Role-based rate limits
- Rate limit headers
- Rate limit enforcement
- Anonymous vs authenticated limits

### 4. Security Tests (`test/api-security.e2e-spec.ts`)
Security validation including:
- Input validation and injection prevention
- Secret redaction
- Security headers
- CORS configuration
- Session security

### 5. Comprehensive Tests (`test/api-comprehensive.e2e-spec.ts`)
End-to-end testing covering:
- Complete workflows
- Performance characteristics
- Reliability under load
- Documentation completeness

## Running the Tests

### Prerequisites

1. **Environment Setup**
   ```bash
   # Copy test environment file
   cp .env.example .env.test
   
   # Configure test database
   # Edit .env.test with test database URL
   ```

2. **Database Setup**
   ```bash
   # Generate Prisma client
   npm run db:generate
   
   # Setup test database
   npm run db:push
   ```

### Running Individual Test Suites

```bash
# Run authentication tests
npm run test:e2e -- --testPathPattern="auth.e2e-spec.ts"

# Run API endpoint tests
npm run test:e2e -- --testPathPattern="api-endpoints.e2e-spec.ts"

# Run rate limiting tests
npm run test:e2e -- --testPathPattern="api-rate-limiting.e2e-spec.ts"

# Run security tests
npm run test:e2e -- --testPathPattern="api-security.e2e-spec.ts"

# Run comprehensive tests
npm run test:e2e -- --testPathPattern="api-comprehensive.e2e-spec.ts"
```

### Running All API Tests

```bash
# Use the automated test script
./scripts/test-api.sh

# Or run all e2e tests
npm run test:e2e
```

### Generating Coverage Reports

```bash
# Generate coverage for API tests
npm run test:cov -- --testPathPattern="e2e-spec.ts"

# View coverage report
open coverage/lcov-report/index.html
```

## Test Configuration

### Rate Limiting Test Configuration

The rate limiting tests validate the following limits:

| Role | Requests/Minute | Test Coverage |
|------|----------------|---------------|
| Super Admin | 1,000 | High volume testing |
| Admin | 500 | Moderate volume testing |
| Engineer | 300 | Standard volume testing |
| Viewer | 100 | Limited volume testing |
| Anonymous | 20 | Minimal volume testing |

### Security Test Coverage

Security tests validate:

1. **Authentication Security**
   - Invalid token rejection
   - Expired token handling
   - Malformed header rejection

2. **Authorization Security (RBAC)**
   - Role-based endpoint access
   - Permission enforcement
   - Privilege escalation prevention

3. **Input Validation Security**
   - SQL injection prevention
   - XSS attack prevention
   - Command injection prevention
   - Path traversal prevention

4. **Secret Redaction**
   - Password hash redaction
   - Credential redaction
   - Error message sanitization

5. **Security Headers**
   - Content Security Policy
   - X-Content-Type-Options
   - X-Frame-Options
   - X-XSS-Protection
   - Strict-Transport-Security

## API Documentation Testing

### Swagger/OpenAPI Validation

The test suite validates:

1. **Documentation Accessibility**
   ```bash
   # Check Swagger UI is accessible
   curl -f http://localhost:3000/api/docs
   ```

2. **OpenAPI Specification Validity**
   ```bash
   # Validate OpenAPI JSON
   curl -s http://localhost:3000/api/docs-json | jq .
   ```

3. **Documentation Completeness**
   - All endpoints documented
   - Request/response schemas defined
   - Authentication requirements specified
   - Rate limiting information included

### Custom Extensions Validation

The OpenAPI specification includes custom extensions:

- `x-rate-limits`: Rate limiting information per role
- `x-security-features`: Security feature documentation
- `x-wordpress-features`: WordPress-specific functionality
- `x-data-retention`: Data retention policy information

## Performance Testing

### Response Time Validation

Tests ensure API responses are within acceptable limits:

```typescript
it('should respond within acceptable time limits', async () => {
  const startTime = Date.now();
  
  await request(app.getHttpServer())
    .get('/api/v1/users/profile')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);

  const responseTime = Date.now() - startTime;
  expect(responseTime).toBeLessThan(1000); // 1 second limit
});
```

### Concurrent Request Handling

Tests validate the API can handle concurrent requests:

```typescript
it('should handle concurrent requests', async () => {
  const concurrentRequests = Array(10).fill(null).map(() =>
    request(app.getHttpServer())
      .get('/api/v1/users/profile')
      .set('Authorization', `Bearer ${token}`)
  );

  const responses = await Promise.all(concurrentRequests);
  
  responses.forEach(response => {
    expect(response.status).toBe(200);
  });
});
```

## Error Handling Validation

### Consistent Error Format

All API errors follow a consistent format:

```json
{
  "statusCode": 400,
  "message": "Validation failed",
  "code": "VALIDATION_ERROR",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "path": "/api/v1/users"
}
```

### Error Code Coverage

Tests validate all standard error codes:

| HTTP Status | Code | Test Coverage |
|-------------|------|---------------|
| 400 | VALIDATION_ERROR | Input validation failures |
| 401 | UNAUTHORIZED | Authentication failures |
| 403 | FORBIDDEN | Authorization failures |
| 404 | NOT_FOUND | Resource not found |
| 409 | CONFLICT | Resource conflicts |
| 429 | RATE_LIMIT_EXCEEDED | Rate limit violations |
| 500 | INTERNAL_ERROR | Server errors |

## WordPress-Specific Testing

### WordPress Detection Testing

Tests validate WordPress-specific functionality:

```typescript
it('should handle WordPress detection', async () => {
  const response = await request(app.getHttpServer())
    .post(`/api/v1/sites/${siteId}/detect-wordpress`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);

  expect(response.body.data).toHaveProperty('detected');
  expect(response.body.data).toHaveProperty('version');
  expect(response.body.data).toHaveProperty('path');
});
```

### Health Check Testing

Validates comprehensive site health checking:

```typescript
it('should perform comprehensive health checks', async () => {
  const response = await request(app.getHttpServer())
    .post(`/api/v1/sites/${siteId}/health-check`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);

  expect(response.body.data.checks).toHaveProperty('httpResponse');
  expect(response.body.data.checks).toHaveProperty('titleTag');
  expect(response.body.data.checks).toHaveProperty('canonicalTag');
  expect(response.body.data.checks).toHaveProperty('wpLogin');
});
```

## Data Retention Testing

### Hard Cap Enforcement

Tests validate the 7-day retention hard cap:

```typescript
it('should enforce retention hard caps', async () => {
  await request(app.getHttpServer())
    .post('/api/v1/retention/policies')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      policyName: 'Invalid Policy',
      retentionDays: 10, // Exceeds 7-day hard cap
      appliesTo: 'incidents',
    })
    .expect(400);
});
```

### Purge Functionality

Tests validate data purging capabilities:

```typescript
it('should handle manual purge operations', async () => {
  const response = await request(app.getHttpServer())
    .post('/api/v1/retention/purge/manual')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      retentionDays: 3,
      dryRun: true,
    })
    .expect(200);

  expect(response.body.data).toHaveProperty('totalRecordsPurged');
  expect(response.body.data).toHaveProperty('tablesProcessed');
});
```

## Continuous Integration

### GitHub Actions Integration

The test suite integrates with CI/CD pipelines:

```yaml
name: API Tests
on: [push, pull_request]

jobs:
  api-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm ci
      - run: npm run db:generate
      - run: npm run db:push
      - run: ./scripts/test-api.sh
```

### Test Reporting

Tests generate comprehensive reports:

- **Coverage Reports**: HTML coverage reports in `coverage/`
- **Test Results**: JUnit XML format for CI integration
- **Performance Metrics**: Response time measurements
- **Security Scan Results**: Security test outcomes

## Troubleshooting

### Common Issues

1. **Database Connection Errors**
   ```bash
   # Ensure test database is running
   docker-compose up -d postgres-test
   
   # Verify connection string in .env.test
   echo $DATABASE_URL
   ```

2. **Rate Limiting Test Failures**
   ```bash
   # Ensure Redis is running for rate limiting
   docker-compose up -d redis
   
   # Check rate limit configuration
   grep RATE_LIMIT .env.test
   ```

3. **Authentication Test Failures**
   ```bash
   # Verify JWT secret is set
   echo $JWT_SECRET
   
   # Check user creation in test setup
   ```

### Debug Mode

Run tests with debug output:

```bash
# Enable debug logging
DEBUG=wp-autohealer:* npm run test:e2e

# Run specific test with verbose output
npm run test:e2e -- --testPathPattern="auth.e2e-spec.ts" --verbose
```

## Best Practices

### Test Data Management

1. **Isolation**: Each test creates its own data
2. **Cleanup**: Tests clean up after themselves
3. **Deterministic**: Tests produce consistent results
4. **Realistic**: Test data mirrors production scenarios

### Security Testing

1. **Comprehensive Coverage**: Test all attack vectors
2. **Realistic Payloads**: Use actual malicious inputs
3. **Boundary Testing**: Test edge cases and limits
4. **Regression Testing**: Prevent security regressions

### Performance Testing

1. **Baseline Metrics**: Establish performance baselines
2. **Load Testing**: Test under realistic load
3. **Resource Monitoring**: Monitor memory and CPU usage
4. **Scalability Testing**: Test horizontal scaling

## Contributing

### Adding New Tests

1. **Follow Patterns**: Use existing test patterns
2. **Document Tests**: Add clear descriptions
3. **Validate Requirements**: Link tests to requirements
4. **Update Documentation**: Update this guide

### Test Review Checklist

- [ ] Tests cover all endpoints
- [ ] Security tests are comprehensive
- [ ] Error cases are handled
- [ ] Performance is validated
- [ ] Documentation is updated

## Resources

- [Jest Testing Framework](https://jestjs.io/)
- [Supertest HTTP Testing](https://github.com/visionmedia/supertest)
- [OpenAPI Specification](https://swagger.io/specification/)
- [NestJS Testing Guide](https://docs.nestjs.com/fundamentals/testing)
- [Prisma Testing Guide](https://www.prisma.io/docs/guides/testing)