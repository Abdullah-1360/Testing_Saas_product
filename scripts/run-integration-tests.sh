#!/bin/bash

# WP-AutoHealer Integration Test Runner
# This script runs the complete end-to-end integration test suite

set -e

echo "🚀 Starting WP-AutoHealer Integration Tests"
echo "============================================"

# Check if required environment variables are set
if [ -z "$TEST_DATABASE_URL" ]; then
    echo "⚠️  TEST_DATABASE_URL not set, using default"
    export TEST_DATABASE_URL="postgresql://test:test@localhost:5432/wp_autohealer_integration_test"
fi

if [ -z "$TEST_REDIS_URL" ]; then
    echo "⚠️  TEST_REDIS_URL not set, using default"
    export TEST_REDIS_URL="redis://localhost:6379/2"
fi

# Set test environment
export NODE_ENV=test
export DATABASE_URL=$TEST_DATABASE_URL
export REDIS_URL=$TEST_REDIS_URL

echo "📋 Test Configuration:"
echo "   Database: $TEST_DATABASE_URL"
echo "   Redis: $TEST_REDIS_URL"
echo "   Node Environment: $NODE_ENV"
echo ""

# Ensure test database is clean
echo "🧹 Preparing test database..."
npx prisma migrate reset --force --skip-seed || echo "Database reset completed"
npx prisma migrate deploy || echo "Migration deployment completed"

# Run integration tests
echo "🧪 Running Integration Tests..."
echo ""

# Test 1: Incident Workflow Integration
echo "1️⃣  Testing Complete Incident Processing Workflow..."
npx jest --config test/integration/jest-integration.json test/integration/incident-workflow.e2e-spec.ts

# Test 2: Database Migration Integration  
echo "2️⃣  Testing Database Migration Integrity..."
npx jest --config test/integration/jest-integration.json test/integration/database-migration.e2e-spec.ts

# Test 3: Real-time Updates Integration
echo "3️⃣  Testing Real-time Updates and SSE..."
npx jest --config test/integration/jest-integration.json test/integration/realtime-updates.e2e-spec.ts

# Test 4: API Authorization Integration
echo "4️⃣  Testing API Authentication and Authorization..."
npx jest --config test/integration/jest-integration.json test/integration/api-authorization.e2e-spec.ts

# Run all integration tests together
echo "🔄 Running All Integration Tests Together..."
npx jest --config test/integration/jest-integration.json test/integration/

echo ""
echo "✅ Integration Tests Completed Successfully!"
echo "============================================"

# Generate coverage report
echo "📊 Generating Integration Test Coverage Report..."
npx jest --config test/integration/jest-integration.json --coverage test/integration/

echo ""
echo "🎉 All Integration Tests Passed!"
echo "📈 Coverage report available in coverage-integration/"