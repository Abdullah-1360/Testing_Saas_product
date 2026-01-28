-- PostgreSQL initialization script for WP-AutoHealer
-- This script runs when the PostgreSQL container starts for the first time

-- Create additional databases if needed
-- The main database "wp_autohealer" is already created by the POSTGRES_DB environment variable

-- Create test database
CREATE DATABASE wp_autohealer_test;

-- Grant permissions to the wp_autohealer user for the test database
GRANT ALL PRIVILEGES ON DATABASE wp_autohealer_test TO wp_autohealer;

-- Enable required extensions
\c wp_autohealer;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

\c wp_autohealer_test;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Log completion
\echo "PostgreSQL initialization completed successfully"
