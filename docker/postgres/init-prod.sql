-- Production Database Initialization Script for WP-AutoHealer
-- This script sets up the production database with optimized settings

-- Create extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

-- Create application user with limited privileges
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'wp_autohealer_app') THEN
        CREATE ROLE wp_autohealer_app WITH LOGIN PASSWORD 'CHANGE_THIS_APP_PASSWORD';
    END IF;
END
$$;

-- Grant necessary permissions to application user
GRANT CONNECT ON DATABASE wp_autohealer TO wp_autohealer_app;
GRANT USAGE ON SCHEMA public TO wp_autohealer_app;
GRANT CREATE ON SCHEMA public TO wp_autohealer_app;

-- Create read-only user for monitoring/reporting
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'wp_autohealer_readonly') THEN
        CREATE ROLE wp_autohealer_readonly WITH LOGIN PASSWORD 'CHANGE_THIS_READONLY_PASSWORD';
    END IF;
END
$$;

-- Grant read-only permissions
GRANT CONNECT ON DATABASE wp_autohealer TO wp_autohealer_readonly;
GRANT USAGE ON SCHEMA public TO wp_autohealer_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO wp_autohealer_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO wp_autohealer_readonly;

-- Create backup user
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'wp_autohealer_backup') THEN
        CREATE ROLE wp_autohealer_backup WITH LOGIN PASSWORD 'CHANGE_THIS_BACKUP_PASSWORD';
    END IF;
END
$$;

-- Grant backup permissions
GRANT CONNECT ON DATABASE wp_autohealer TO wp_autohealer_backup;
GRANT USAGE ON SCHEMA public TO wp_autohealer_backup;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO wp_autohealer_backup;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO wp_autohealer_backup;

-- Configure pg_stat_statements
ALTER SYSTEM SET shared_preload_libraries = 'pg_stat_statements';
ALTER SYSTEM SET pg_stat_statements.max = 10000;
ALTER SYSTEM SET pg_stat_statements.track = 'all';

-- Set production-optimized parameters
ALTER SYSTEM SET log_statement = 'ddl';
ALTER SYSTEM SET log_min_duration_statement = 1000;
ALTER SYSTEM SET log_checkpoints = on;
ALTER SYSTEM SET log_connections = on;
ALTER SYSTEM SET log_disconnections = on;
ALTER SYSTEM SET log_lock_waits = on;

-- Security settings
ALTER SYSTEM SET ssl = on;
ALTER SYSTEM SET password_encryption = 'scram-sha-256';
ALTER SYSTEM SET row_security = on;

-- Performance settings
ALTER SYSTEM SET effective_cache_size = '768MB';
ALTER SYSTEM SET shared_buffers = '256MB';
ALTER SYSTEM SET work_mem = '4MB';
ALTER SYSTEM SET maintenance_work_mem = '64MB';
ALTER SYSTEM SET checkpoint_completion_target = 0.7;
ALTER SYSTEM SET wal_buffers = '16MB';
ALTER SYSTEM SET default_statistics_target = 100;

-- Reload configuration
SELECT pg_reload_conf();

-- Create indexes for performance (will be created by Prisma migrations)
-- This is just a placeholder for any additional production-specific indexes

-- Log the initialization
INSERT INTO pg_stat_statements_info (dealloc) VALUES (0) ON CONFLICT DO NOTHING;

-- Create a function to monitor database health
CREATE OR REPLACE FUNCTION check_database_health()
RETURNS TABLE (
    metric_name TEXT,
    metric_value TEXT,
    status TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        'Database Size'::TEXT,
        pg_size_pretty(pg_database_size(current_database()))::TEXT,
        CASE 
            WHEN pg_database_size(current_database()) > 10737418240 THEN 'WARNING'  -- 10GB
            ELSE 'OK'
        END::TEXT
    UNION ALL
    SELECT 
        'Active Connections'::TEXT,
        count(*)::TEXT,
        CASE 
            WHEN count(*) > 80 THEN 'WARNING'  -- 80% of max_connections
            ELSE 'OK'
        END::TEXT
    FROM pg_stat_activity 
    WHERE state = 'active'
    UNION ALL
    SELECT 
        'Longest Running Query'::TEXT,
        COALESCE(max(EXTRACT(EPOCH FROM (now() - query_start)))::TEXT, '0'),
        CASE 
            WHEN max(EXTRACT(EPOCH FROM (now() - query_start))) > 300 THEN 'WARNING'  -- 5 minutes
            ELSE 'OK'
        END::TEXT
    FROM pg_stat_activity 
    WHERE state = 'active' AND query NOT LIKE '%pg_stat_activity%';
END;
$$ LANGUAGE plpgsql;

-- Create a function to get slow queries
CREATE OR REPLACE FUNCTION get_slow_queries(limit_count INTEGER DEFAULT 10)
RETURNS TABLE (
    query TEXT,
    calls BIGINT,
    total_time DOUBLE PRECISION,
    mean_time DOUBLE PRECISION,
    rows BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        pss.query,
        pss.calls,
        pss.total_exec_time,
        pss.mean_exec_time,
        pss.rows
    FROM pg_stat_statements pss
    ORDER BY pss.mean_exec_time DESC
    LIMIT limit_count;
END;
$$ LANGUAGE plpgsql;

-- Log successful initialization
DO $$
BEGIN
    RAISE NOTICE 'WP-AutoHealer production database initialized successfully at %', now();
END
$$;