import 'reflect-metadata';
import fc from 'fast-check';

// Property-based testing setup
beforeAll(async () => {
  // Configure fast-check for consistent property-based testing
  const seedValue = process.env['FC_SEED'] ? parseInt(process.env['FC_SEED'], 10) : undefined;
  fc.configureGlobal({
    numRuns: 50, // Reduced from 100 for faster execution as requested
    ...(seedValue !== undefined && { seed: seedValue }),
    verbose: process.env['VERBOSE_TESTS'] === 'true',
  });
});

// Custom generators for WP-AutoHealer domain objects
export const generators = {
  // UUID generator
  uuid: () => fc.uuid(),
  
  // Incident generator
  incident: () => fc.record({
    id: fc.uuid(),
    siteId: fc.uuid(),
    state: fc.constantFrom('NEW', 'DISCOVERY', 'BASELINE', 'BACKUP', 'OBSERVABILITY', 'FIX_ATTEMPT', 'VERIFY', 'FIXED', 'ROLLBACK', 'ESCALATED'),
    triggerType: fc.constantFrom('manual', 'automatic', 'webhook', 'scheduled'),
    priority: fc.constantFrom('low', 'medium', 'high', 'critical'),
    fixAttempts: fc.integer({ min: 0, max: 15 }),
    maxFixAttempts: fc.constant(15),
    createdAt: fc.date(),
    updatedAt: fc.date(),
  }),
  
  // SSH configuration generator
  sshConfig: () => fc.record({
    hostname: fc.domain(),
    port: fc.integer({ min: 1, max: 65535 }),
    username: fc.string({ minLength: 1, maxLength: 32 }),
    authType: fc.constantFrom('key', 'password'),
    strictHostKeyChecking: fc.constant(true),
  }),
  
  // Server generator
  server: () => fc.record({
    id: fc.uuid(),
    name: fc.string({ minLength: 1, maxLength: 255 }),
    hostname: fc.domain(),
    port: fc.integer({ min: 1, max: 65535 }),
    username: fc.string({ minLength: 1, maxLength: 32 }),
    authType: fc.constantFrom('key', 'password'),
    controlPanel: fc.option(fc.constantFrom('cpanel', 'plesk', 'directadmin', 'cyberpanel')),
  }),
  
  // Site generator
  site: () => fc.record({
    id: fc.uuid(),
    serverId: fc.uuid(),
    domain: fc.domain(),
    documentRoot: fc.string({ minLength: 1, maxLength: 500 }),
    wordpressPath: fc.string({ minLength: 1, maxLength: 500 }),
    isMultisite: fc.boolean(),
    siteUrl: fc.webUrl(),
    adminUrl: fc.webUrl(),
    isActive: fc.boolean(),
  }),
  
  // Command execution generator
  commandExecution: () => fc.record({
    id: fc.uuid(),
    incidentId: fc.uuid(),
    command: fc.string({ minLength: 1, maxLength: 1000 }),
    stdout: fc.string(),
    stderr: fc.string(),
    exitCode: fc.integer({ min: 0, max: 255 }),
    executionTime: fc.integer({ min: 0, max: 300000 }), // 5 minutes max
    timestamp: fc.date(),
    serverId: fc.uuid(),
  }),
  
  // Evidence generator
  evidence: () => fc.record({
    id: fc.uuid(),
    incidentId: fc.uuid(),
    evidenceType: fc.constantFrom('log', 'command_output', 'file_content', 'system_info'),
    signature: fc.string({ minLength: 1, maxLength: 255 }),
    content: fc.string(),
    metadata: fc.dictionary(fc.string(), fc.anything()),
    timestamp: fc.date(),
  }),
  
  // Backup artifact generator
  backupArtifact: () => fc.record({
    id: fc.uuid(),
    incidentId: fc.uuid(),
    artifactType: fc.constantFrom('file', 'directory', 'database', 'configuration'),
    filePath: fc.string({ minLength: 1, maxLength: 500 }),
    originalPath: fc.string({ minLength: 1, maxLength: 500 }),
    checksum: fc.string({ minLength: 32, maxLength: 64 }),
    size: fc.integer({ min: 0, max: 1000000000 }), // 1GB max
    metadata: fc.dictionary(fc.string(), fc.anything()),
  }),
  
  // User generator
  user: () => fc.record({
    id: fc.uuid(),
    email: fc.emailAddress(),
    role: fc.constantFrom('super_admin', 'admin', 'engineer', 'viewer'),
    mfaEnabled: fc.boolean(),
    createdAt: fc.date(),
    updatedAt: fc.date(),
  }),
  
  // Retention policy generator
  retentionPolicy: () => fc.record({
    id: fc.uuid(),
    policyName: fc.string({ minLength: 1, maxLength: 100 }),
    retentionDays: fc.integer({ min: 1, max: 7 }), // Hard cap enforcement
    appliesTo: fc.constantFrom('incidents', 'commands', 'evidence', 'backups', 'all'),
    isActive: fc.boolean(),
  }),
  
  // Secret data generator (for testing redaction)
  secretData: () => fc.record({
    password: fc.string({ minLength: 8, maxLength: 128 }),
    apiKey: fc.string({ minLength: 16, maxLength: 64 }),
    token: fc.string({ minLength: 16, maxLength: 256 }),
    privateKey: fc.string({ minLength: 100, maxLength: 4096 }),
    secret: fc.string({ minLength: 8, maxLength: 64 }),
  }),
  
  // WordPress site info generator
  wordPressSite: () => fc.record({
    version: fc.string({ minLength: 3, maxLength: 10 }),
    isMultisite: fc.boolean(),
    activeTheme: fc.string({ minLength: 1, maxLength: 100 }),
    activePlugins: fc.array(fc.string({ minLength: 1, maxLength: 100 }), { minLength: 0, maxLength: 50 }),
    dbHost: fc.string({ minLength: 1, maxLength: 255 }),
    dbName: fc.string({ minLength: 1, maxLength: 64 }),
    dbUser: fc.string({ minLength: 1, maxLength: 32 }),
    tablePrefix: fc.string({ minLength: 1, maxLength: 10 }),
  }),
};

// Property test helpers
export const propertyHelpers = {
  // Validate that all required incident data is stored
  validateIncidentDataStorage: (incident: any) => {
    const requiredFields = [
      'phases', 'steps', 'commands', 'stdout', 'stderr',
      'logSignatures', 'verificationResults', 'fileDiffs',
      'backupMetadata', 'rollbackPlans'
    ];
    
    return requiredFields.every(field => Object.prototype.hasOwnProperty.call(incident, field));
  },
  
  // Validate secret redaction
  validateSecretRedaction: (text: string, secrets: any) => {
    const secretValues = Object.values(secrets) as string[];
    return secretValues.every(secret => !text.includes(secret));
  },
  
  // Validate retention policy hard cap
  validateRetentionHardCap: (retentionDays: number) => {
    return retentionDays >= 1 && retentionDays <= 7;
  },
  
  // Validate state machine transitions
  validateStateTransition: (fromState: string, toState: string) => {
    const validTransitions: Record<string, string[]> = {
      'NEW': ['DISCOVERY'],
      'DISCOVERY': ['BASELINE'],
      'BASELINE': ['BACKUP'],
      'BACKUP': ['OBSERVABILITY'],
      'OBSERVABILITY': ['FIX_ATTEMPT'],
      'FIX_ATTEMPT': ['VERIFY', 'ESCALATED'],
      'VERIFY': ['FIXED', 'FIX_ATTEMPT', 'ROLLBACK'],
      'FIXED': [],
      'ROLLBACK': ['ESCALATED'],
      'ESCALATED': [],
    };
    
    return validTransitions[fromState]?.includes(toState) ?? false;
  },
};