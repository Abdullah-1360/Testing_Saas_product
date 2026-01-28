import * as Joi from 'joi';

export const configValidationSchema = Joi.object({
  // Application Configuration
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().port().default(3000),
  API_VERSION: Joi.string().default('v1'),

  // Database Configuration
  DATABASE_URL: Joi.string().required(),
  DATABASE_POOL_SIZE: Joi.number().integer().min(1).max(50).default(10),

  // Redis Configuration
  REDIS_URL: Joi.string().required(),
  REDIS_PASSWORD: Joi.string().allow('').optional(),

  // JWT Configuration
  JWT_SECRET: Joi.string().min(32).required(),
  JWT_EXPIRES_IN: Joi.string().default('24h'),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),

  // Session Configuration
  SESSION_SECRET: Joi.string().min(32).required(),
  SESSION_MAX_AGE: Joi.number().integer().min(60000).default(86400000), // 24 hours

  // Encryption Configuration
  ENCRYPTION_KEY: Joi.string().length(32).required(),

  // SSH Configuration
  SSH_CONNECTION_TIMEOUT: Joi.number().integer().min(5000).max(300000).default(30000),
  SSH_COMMAND_TIMEOUT: Joi.number().integer().min(5000).max(600000).default(60000),
  SSH_MAX_CONNECTIONS: Joi.number().integer().min(1).max(100).default(10),

  // Rate Limiting
  RATE_LIMIT_TTL: Joi.number().integer().min(1).max(3600).default(60),
  RATE_LIMIT_LIMIT: Joi.number().integer().min(1).max(10000).default(100),

  // Logging Configuration
  LOG_LEVEL: Joi.string()
    .valid('error', 'warn', 'info', 'debug', 'verbose')
    .default('info'),
  LOG_FILE_ENABLED: Joi.boolean().default(true),
  LOG_FILE_PATH: Joi.string().default('logs/wp-autohealer.log'),
  LOG_MAX_FILES: Joi.number().integer().min(1).max(365).default(30),
  LOG_MAX_SIZE: Joi.string().default('20m'),

  // Retention Policy Configuration
  DEFAULT_RETENTION_DAYS: Joi.number().integer().min(1).max(7).default(3),
  MAX_RETENTION_DAYS: Joi.number().integer().min(1).max(7).default(7),

  // Job Processing Configuration
  MAX_FIX_ATTEMPTS: Joi.number().integer().min(1).max(20).default(15),
  INCIDENT_COOLDOWN_WINDOW: Joi.number().integer().min(60).max(3600).default(600), // 10 minutes
  CIRCUIT_BREAKER_THRESHOLD: Joi.number().integer().min(1).max(20).default(5),
  CIRCUIT_BREAKER_TIMEOUT: Joi.number().integer().min(30000).max(3600000).default(300000), // 5 minutes

  // Verification Configuration
  VERIFICATION_TIMEOUT: Joi.number().integer().min(5000).max(120000).default(30000),
  VERIFICATION_RETRY_ATTEMPTS: Joi.number().integer().min(1).max(10).default(3),

  // External Integrations
  WEBHOOK_SECRET: Joi.string().min(16).optional(),

  // Development/Testing
  ENABLE_SWAGGER: Joi.boolean().default(false),
  ENABLE_BULL_BOARD: Joi.boolean().default(false),
  MOCK_SSH_CONNECTIONS: Joi.boolean().default(false),

  // Optional CORS configuration
  ALLOWED_ORIGINS: Joi.string().optional(),
});