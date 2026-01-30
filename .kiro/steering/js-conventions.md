---
inclusion: fileMatch
fileMatchPattern: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx']
---

# TypeScript/JavaScript Conventions for WP-AutoHealer

## Naming Conventions

### Variables and Functions
- Use **camelCase** for variables, functions, and methods: `getUserById`, `incidentData`, `processRemediationJob`
- Use **PascalCase** for classes, interfaces, types, and React components: `IncidentService`, `WordPressConfig`, `ServerStatusCard`
- Use **UPPER_SNAKE_CASE** for constants and environment variables: `MAX_RETRY_ATTEMPTS`, `DEFAULT_SSH_TIMEOUT`
- Use **kebab-case** for file names: `incident-processor.service.ts`, `ssh-connection.interface.ts`

### NestJS Specific Naming
- Controllers: `*.controller.ts` - `IncidentsController`, `ServersController`
- Services: `*.service.ts` - `WordPressFixesService`, `SSHConnectionService`
- Modules: `*.module.ts` - `AuthModule`, `IncidentsModule`
- DTOs: `*.dto.ts` - `CreateIncidentDto`, `ServerConfigDto`
- Interfaces: `*.interface.ts` - `RemediationResult`, `SSHConfig`
- Guards: `*.guard.ts` - `JwtAuthGuard`, `RolesGuard`
- Decorators: `*.decorator.ts` - `CurrentUser`, `Roles`

## File Structure and Organization

### Backend Module Structure (MANDATORY)
Each NestJS module must follow this exact structure:
```
src/module-name/
├── module-name.controller.ts     # REST endpoints
├── module-name.service.ts        # Business logic
├── module-name.module.ts         # Module definition
├── dto/                          # Data transfer objects
├── interfaces/                   # TypeScript interfaces
├── exceptions/                   # Custom exceptions
├── *.spec.ts                     # Unit tests
└── *.pbt.spec.ts                # Property-based tests
```

### Frontend Component Structure
```
components/
├── common/                       # Shared components
├── layout/                       # Layout components
├── domain-specific/              # Feature-specific components
└── ui/                          # Basic UI components
```

### Import Organization (STRICT ORDER)
1. Node.js built-in modules
2. Third-party packages (npm modules)
3. NestJS modules (`@nestjs/*`)
4. Internal modules using path mapping (`@/*`)
5. Relative imports from same directory (`./`, `../`)

```typescript
// Example import order
import { readFile } from 'fs/promises';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { CreateIncidentDto } from './dto/create-incident.dto';
```

## TypeScript Best Practices

### Type Safety (CRITICAL)
- **NEVER use `any` type** - Define explicit interfaces for all data structures
- Use **strict TypeScript configuration** with `noImplicitAny`, `strictNullChecks`
- Define **explicit return types** for all exported functions and public methods
- Use **union types** instead of `any` for flexible types: `string | number | null`
- Implement **type guards** for runtime type checking

```typescript
// GOOD: Explicit interface and return type
interface IncidentData {
  id: string;
  siteId: string;
  status: IncidentStatus;
  createdAt: Date;
}

async function getIncident(id: string): Promise<IncidentData | null> {
  // Implementation
}

// BAD: Using any type
function processData(data: any): any {
  // Implementation
}
```

### Interface Design
- **Prefer interfaces over types** for object shapes and public APIs
- Use **types for unions, primitives, and computed types**
- Define **generic interfaces** for reusable patterns
- Use **readonly properties** for immutable data

```typescript
// GOOD: Interface for object shape
interface ServerConfig {
  readonly id: string;
  hostname: string;
  port: number;
  credentials: SSHCredentials;
}

// GOOD: Type for union
type IncidentStatus = 'NEW' | 'IN_PROGRESS' | 'RESOLVED' | 'ESCALATED';

// GOOD: Generic interface
interface ApiResponse<T> {
  data: T;
  success: boolean;
  message?: string;
}
```

### Error Handling Patterns
- Use **custom exception classes** extending NestJS base exceptions
- Implement **proper error boundaries** in React components
- **Always handle async operations** with try-catch blocks
- Use **Result pattern** for operations that can fail

```typescript
// Custom exception class
export class WordPressException extends HttpException {
  constructor(message: string, status: HttpStatus = HttpStatus.INTERNAL_SERVER_ERROR) {
    super(message, status);
  }
}

// Service with proper error handling
@Injectable()
export class IncidentService {
  private readonly logger = new Logger(IncidentService.name);

  async processIncident(id: string): Promise<RemediationResult> {
    try {
      const incident = await this.getIncident(id);
      return await this.executeRemediation(incident);
    } catch (error) {
      this.logger.error(`Failed to process incident ${id}: ${error.message}`, error.stack);
      throw new WordPressException(`Incident processing failed: ${error.message}`);
    }
  }
}
```

## Code Quality Standards

### Function and Method Design
- Keep functions **small and focused** (single responsibility)
- Use **descriptive names** that explain what the function does
- **Limit parameters** to 3-4 maximum, use objects for more
- **Return early** to reduce nesting and improve readability
- Use **async/await** instead of Promise chains

```typescript
// GOOD: Descriptive name, focused responsibility
async function validateWordPressInstallation(siteConfig: SiteConfig): Promise<ValidationResult> {
  if (!siteConfig.url) {
    return { valid: false, error: 'Site URL is required' };
  }
  
  const response = await this.httpService.get(`${siteConfig.url}/wp-admin/`);
  return { valid: response.status === 200 };
}

// BAD: Vague name, too many responsibilities
async function checkSite(url: string, user: string, pass: string, timeout: number): Promise<any> {
  // Multiple responsibilities mixed together
}
```

### Documentation and Comments
- Use **JSDoc comments** for all public APIs and complex functions
- Write **self-documenting code** with clear variable and function names
- Add **inline comments** only for complex business logic
- Document **assumptions and constraints** in comments

```typescript
/**
 * Executes WordPress remediation steps for a given incident.
 * 
 * @param incident - The incident to remediate
 * @param options - Remediation options including retry count and timeout
 * @returns Promise resolving to remediation result with success status
 * @throws WordPressException when remediation fails after all retries
 */
async function executeRemediation(
  incident: Incident, 
  options: RemediationOptions = {}
): Promise<RemediationResult> {
  // Implementation
}
```

### Performance Considerations
- Use **lazy loading** for large modules and components
- Implement **proper caching** strategies with Redis
- **Avoid N+1 queries** in database operations
- Use **connection pooling** for database and external services
- **Debounce user inputs** in frontend components

## React/Frontend Specific Conventions

### Component Design
- Use **functional components** with hooks exclusively
- Implement **proper prop validation** with TypeScript interfaces
- Use **custom hooks** for reusable stateful logic
- Implement **error boundaries** for graceful error handling

```typescript
interface ServerCardProps {
  server: Server;
  onStatusChange: (serverId: string, status: ServerStatus) => void;
  className?: string;
}

export function ServerCard({ server, onStatusChange, className }: ServerCardProps) {
  const { status, loading, error } = useServerStatus(server.id);
  
  if (error) {
    return <ErrorBoundary error={error} />;
  }
  
  return (
    <div className={cn('server-card', className)}>
      {/* Component content */}
    </div>
  );
}
```

### State Management
- Use **React Context** for global state (auth, theme)
- Use **useState/useReducer** for local component state
- Implement **custom hooks** for complex state logic
- Use **Server-Sent Events** for real-time updates

## Testing Conventions

### Test File Naming
- Unit tests: `*.spec.ts`
- Property-based tests: `*.pbt.spec.ts`
- End-to-end tests: `*.e2e-spec.ts`
- Integration tests: `*.integration.spec.ts`

### Test Structure
- Use **descriptive test names** that explain the scenario
- Follow **Arrange-Act-Assert** pattern
- Use **property-based testing** for critical business logic
- **Mock external dependencies** appropriately

```typescript
describe('IncidentService', () => {
  describe('processIncident', () => {
    it('should successfully process a valid incident', async () => {
      // Arrange
      const incident = createMockIncident();
      const expectedResult = { success: true, steps: [] };
      
      // Act
      const result = await service.processIncident(incident.id);
      
      // Assert
      expect(result).toEqual(expectedResult);
    });
  });
});
```

## Path Mapping and Imports

### Backend Path Mapping (tsconfig.json)
```json
{
  "compilerOptions": {
    "paths": {
      "@/*": ["src/*"],
      "@/auth/*": ["src/auth/*"],
      "@/incidents/*": ["src/incidents/*"],
      "@/common/*": ["src/common/*"]
    }
  }
}
```

### Usage Examples
```typescript
// Use path mapping for internal modules
import { PrismaService } from '@/database/prisma.service';
import { AuthGuard } from '@/auth/guards/auth.guard';
import { LoggerService } from '@/common/services/logger.service';

// Use relative imports for same-directory files
import { CreateIncidentDto } from './dto/create-incident.dto';
import { IncidentStatus } from './interfaces/incident.interface';
```
