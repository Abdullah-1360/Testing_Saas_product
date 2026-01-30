---
inclusion: always
---

# WP-AutoHealer System Architecture

This document defines the architectural patterns, conventions, and rules that must be followed when working with the WP-AutoHealer codebase.

## Core Architectural Principles

### Layered Architecture (MANDATORY)
Follow strict separation of concerns across these layers:

1. **Controllers** - HTTP endpoints, validation, response formatting
2. **Services** - Business logic, orchestration, error handling  
3. **Repositories** - Data access via Prisma ORM only
4. **External Services** - SSH, monitoring, notifications

### Module Structure (REQUIRED)
Every NestJS module MUST follow this exact structure:
```
src/module-name/
├── module-name.controller.ts     # REST endpoints with OpenAPI decorators
├── module-name.service.ts        # Business logic with dependency injection
├── module-name.module.ts         # NestJS module definition
├── dto/                          # Data transfer objects with validation
├── interfaces/                   # TypeScript interfaces and types
├── exceptions/                   # Custom exception classes
├── *.spec.ts                     # Unit tests with Jest
└── *.pbt.spec.ts                # Property-based tests with fast-check
```

### Dependency Injection (STRICT)
- Use constructor injection for all dependencies
- Never use circular dependencies
- Export services from modules for reuse
- Use interfaces for service contracts

### Error Handling (MANDATORY)
```typescript
// REQUIRED: Custom exception hierarchy
export class WordPressException extends HttpException {
  constructor(message: string, status: HttpStatus = HttpStatus.INTERNAL_SERVER_ERROR) {
    super(message, status);
  }
}

// REQUIRED: Service error handling pattern
@Injectable()
export class ExampleService {
  async operation(): Promise<Result> {
    try {
      // Business logic
      return result;
    } catch (error) {
      this.logger.error(`Operation failed: ${error.message}`, error.stack);
      throw new WordPressException(`Operation failed: ${error.message}`);
    }
  }
}
```

## Data Access Patterns (STRICT ENFORCEMENT)

### Prisma ORM Requirements
- **NEVER use raw SQL queries** - always use Prisma client
- **Use transactions** for multi-table operations
- **Implement proper error handling** for database operations
- **Use connection pooling** with appropriate pool sizes

```typescript
// REQUIRED: Database service pattern
@Injectable()
export class DatabaseService {
  constructor(private prisma: PrismaService) {}
  
  async createWithTransaction<T>(operations: (tx: PrismaTransaction) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      try {
        return await operations(tx);
      } catch (error) {
        this.logger.error(`Transaction failed: ${error.message}`);
        throw new DatabaseException(`Transaction failed: ${error.message}`);
      }
    });
  }
}
```

### Redis Usage Patterns
```typescript
// Session storage pattern
const sessionKey = `session:${userId}:${sessionId}`;
await redis.setex(sessionKey, 86400, JSON.stringify(sessionData));

// Caching pattern with TTL
const cacheKey = `site:health:${siteId}`;
await redis.setex(cacheKey, 300, JSON.stringify(healthResult));

// Job queuing pattern
await incidentQueue.add('process-incident', { incidentId, siteId }, {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2000 }
});
```

## Job Processing Architecture (BullMQ)

### State Machine Implementation (REQUIRED)
All incident processing MUST follow this exact state progression:

```typescript
enum IncidentState {
  NEW = 'NEW',
  DISCOVERY = 'DISCOVERY', 
  BASELINE = 'BASELINE',
  BACKUP = 'BACKUP',
  OBSERVABILITY = 'OBSERVABILITY',
  FIX_ATTEMPT = 'FIX_ATTEMPT',
  VERIFY = 'VERIFY',
  FIXED = 'FIXED',
  ROLLBACK = 'ROLLBACK',
  ESCALATED = 'ESCALATED'
}

// REQUIRED: State machine processor pattern
@Processor('incident-processing')
export class IncidentProcessor {
  @Process('process-incident')
  async processIncident(job: Job<IncidentData>): Promise<RemediationResult> {
    const { incidentId } = job.data;
    
    try {
      await this.updateIncidentState(incidentId, IncidentState.DISCOVERY);
      await job.progress(10);
      
      const discoveryResult = await this.performDiscovery(job.data);
      await this.updateIncidentState(incidentId, IncidentState.BACKUP);
      await job.progress(30);
      
      const backupResult = await this.createBackup(job.data);
      await this.updateIncidentState(incidentId, IncidentState.FIX_ATTEMPT);
      await job.progress(60);
      
      const fixResult = await this.applyRemediation(job.data);
      await this.updateIncidentState(incidentId, IncidentState.VERIFY);
      await job.progress(80);
      
      const verificationResult = await this.verifyFix(job.data);
      
      if (verificationResult.success) {
        await this.updateIncidentState(incidentId, IncidentState.FIXED);
      } else {
        await this.performRollback(backupResult.id);
        await this.updateIncidentState(incidentId, IncidentState.ROLLBACK);
      }
      
      await job.progress(100);
      return { success: verificationResult.success };
      
    } catch (error) {
      await this.updateIncidentState(incidentId, IncidentState.ESCALATED);
      throw error;
    }
  }
}
```

### Job Configuration (MANDATORY)
```typescript
// REQUIRED: Job queue configuration
const queueConfig = {
  connection: redis,
  defaultJobOptions: {
    removeOnComplete: 100,
    removeOnFail: 50,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000
    }
  }
};
```

## Security Architecture (CRITICAL REQUIREMENTS)

### Authentication & Authorization (STRICT)
```typescript
// REQUIRED: JWT token implementation
@Injectable()
export class AuthService {
  async generateTokens(user: User): Promise<AuthTokens> {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      roles: user.roles,
      permissions: user.permissions
    };
    
    const accessToken = this.jwtService.sign(payload, { expiresIn: '15m' });
    const refreshToken = this.jwtService.sign(payload, { expiresIn: '7d' });
    
    // Store session in Redis
    await this.redis.setex(`session:${user.id}`, 604800, JSON.stringify({
      userId: user.id,
      refreshToken,
      createdAt: new Date()
    }));
    
    return { accessToken, refreshToken };
  }
}

// REQUIRED: Role-based access control
@Injectable()
export class RolesGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.get<Role[]>('roles', context.getHandler());
    if (!requiredRoles) return true;
    
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    
    return requiredRoles.some(role => user.roles?.includes(role));
  }
}
```

### Data Encryption (MANDATORY)
```typescript
// REQUIRED: Encryption service using libsodium
@Injectable()
export class EncryptionService {
  private readonly key: Buffer;
  
  constructor(private configService: ConfigService) {
    this.key = Buffer.from(this.configService.get('ENCRYPTION_KEY'), 'hex');
  }
  
  encrypt(plaintext: string): string {
    const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
    const ciphertext = sodium.crypto_secretbox_easy(plaintext, nonce, this.key);
    return sodium.to_base64(Buffer.concat([nonce, ciphertext]));
  }
  
  decrypt(encrypted: string): string {
    const data = sodium.from_base64(encrypted);
    const nonce = data.slice(0, sodium.crypto_secretbox_NONCEBYTES);
    const ciphertext = data.slice(sodium.crypto_secretbox_NONCEBYTES);
    return sodium.crypto_secretbox_open_easy(ciphertext, nonce, this.key, 'text');
  }
}
```

### SSH Security (CRITICAL)
```typescript
// REQUIRED: Secure SSH connection pattern
@Injectable()
export class SSHService {
  async connect(config: SSHConfig): Promise<SSHConnection> {
    return new Promise((resolve, reject) => {
      const conn = new Client();
      
      conn.connect({
        host: config.hostname,
        port: config.port,
        username: config.username,
        privateKey: config.privateKey,
        hostHash: 'sha256',
        hostVerifier: this.verifyHostKey.bind(this),
        algorithms: {
          kex: ['diffie-hellman-group14-sha256'],
          cipher: ['aes256-gcm'],
          hmac: ['hmac-sha2-256']
        },
        readyTimeout: 30000
      });
      
      conn.on('ready', () => resolve(conn));
      conn.on('error', reject);
    });
  }
  
  private verifyHostKey(hashedKey: string, callback: Function): void {
    const knownKey = this.getKnownHostKey(config.hostname);
    callback(hashedKey === knownKey);
  }
}
```

## Frontend Architecture (Next.js)

### Component Architecture (REQUIRED)
```typescript
// REQUIRED: Component structure pattern
interface ComponentProps {
  // Always define explicit prop interfaces
}

export default function Component({ prop1, prop2 }: ComponentProps) {
  // Use functional components with hooks
  const [state, setState] = useState<StateType>(initialState);
  
  // Custom hooks for reusable logic
  const { data, loading, error } = useApi('/api/endpoint');
  
  // Error boundaries for graceful error handling
  if (error) {
    return <ErrorBoundary error={error} />;
  }
  
  return (
    <div className="component-container">
      {/* JSX content */}
    </div>
  );
}
```

### API Client Pattern (MANDATORY)
```typescript
// REQUIRED: API client with error handling
class ApiClient {
  private baseURL: string;
  private token: string | null = null;
  
  async request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
    const url = `${this.baseURL}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      ...(this.token && { Authorization: `Bearer ${this.token}` }),
      ...options.headers
    };
    
    try {
      const response = await fetch(url, { ...options, headers });
      
      if (!response.ok) {
        throw new ApiError(response.status, await response.text());
      }
      
      return await response.json();
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new NetworkError(error.message);
    }
  }
}
```

### Real-time Updates (SSE Pattern)
```typescript
// REQUIRED: Server-Sent Events implementation
export function useSSE<T>(endpoint: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  
  useEffect(() => {
    const eventSource = new EventSource(endpoint);
    
    eventSource.onmessage = (event) => {
      try {
        const parsedData = JSON.parse(event.data);
        setData(parsedData);
      } catch (err) {
        setError(new Error('Failed to parse SSE data'));
      }
    };
    
    eventSource.onerror = () => {
      setError(new Error('SSE connection failed'));
    };
    
    return () => eventSource.close();
  }, [endpoint]);
  
  return { data, error };
}
```

## Configuration Management (STRICT)

### Environment Configuration (REQUIRED)
```typescript
// REQUIRED: Configuration validation with Joi
import Joi from 'joi';

const configSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').required(),
  PORT: Joi.number().default(3001),
  DATABASE_URL: Joi.string().uri().required(),
  REDIS_URL: Joi.string().uri().required(),
  JWT_SECRET: Joi.string().min(32).required(),
  ENCRYPTION_KEY: Joi.string().length(64).required(),
  SSH_TIMEOUT: Joi.number().default(30000),
  MAX_FIX_ATTEMPTS: Joi.number().min(1).max(20).default(15),
  RETENTION_DAYS: Joi.number().min(1).max(7).default(3)
});

@Injectable()
export class ConfigService {
  private readonly config: ConfigType;
  
  constructor() {
    const { error, value } = configSchema.validate(process.env);
    if (error) {
      throw new Error(`Configuration validation error: ${error.message}`);
    }
    this.config = value;
  }
  
  get<T extends keyof ConfigType>(key: T): ConfigType[T] {
    return this.config[key];
  }
}
```

## Monitoring & Health Checks (MANDATORY)

### Health Check Implementation (REQUIRED)
```typescript
@Controller('health')
export class HealthController {
  @Get()
  async getHealth(): Promise<HealthStatus> {
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: process.env.APP_VERSION,
      uptime: process.uptime()
    };
  }
  
  @Get('ready')
  async getReadiness(): Promise<ReadinessStatus> {
    const [dbHealth, redisHealth, queueHealth] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
      this.checkJobQueue()
    ]);
    
    const ready = dbHealth && redisHealth && queueHealth;
    
    return {
      ready,
      checks: {
        database: dbHealth,
        redis: redisHealth,
        queue: queueHealth
      }
    };
  }
}
```

### Metrics Collection (REQUIRED)
```typescript
// REQUIRED: Prometheus metrics
import { Counter, Histogram, Gauge } from 'prom-client';

const incidentCounter = new Counter({
  name: 'wp_autohealer_incidents_total',
  help: 'Total number of incidents processed',
  labelNames: ['status', 'site_id']
});

const incidentDuration = new Histogram({
  name: 'wp_autohealer_incident_duration_seconds',
  help: 'Incident processing duration',
  buckets: [1, 5, 15, 30, 60, 300, 600]
});

@Injectable()
export class MetricsService {
  recordIncidentStart(incidentId: string, siteId: string): void {
    incidentCounter.inc({ status: 'started', site_id: siteId });
  }
  
  recordIncidentComplete(incidentId: string, siteId: string, duration: number, status: string): void {
    incidentCounter.inc({ status, site_id: siteId });
    incidentDuration.observe(duration / 1000);
  }
}
```

## Key Architectural Rules

### MANDATORY Patterns
1. **Layered Architecture** - Controllers → Services → Repositories
2. **Dependency Injection** - Use NestJS DI container exclusively
3. **Error Handling** - Custom exceptions with proper HTTP status codes
4. **State Management** - BullMQ jobs with progress tracking
5. **Security** - JWT + RBAC + encryption for sensitive data
6. **Database Access** - Prisma ORM only, no raw SQL
7. **Caching** - Multi-level caching with Redis
8. **Monitoring** - Health checks + Prometheus metrics

### FORBIDDEN Practices
1. **No raw SQL queries** - Use Prisma exclusively
2. **No circular dependencies** - Design proper module boundaries
3. **No `any` types** - Define explicit interfaces
4. **No hardcoded secrets** - Use environment variables
5. **No direct database access** - Go through service layer
6. **No synchronous operations** - Use async/await patterns
7. **No missing error handling** - Wrap all operations in try-catch