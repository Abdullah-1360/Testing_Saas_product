---
inclusion: always
---

# WordPress Remediation Logic & Safety Protocols

## Core Safety Principles

### CRITICAL: Never Execute Without Safety Checks
- **FORBIDDEN COMMANDS**: Never execute `DROP TABLE`, `rm -rf`, `DELETE FROM` without WHERE clause, or any irreversible operations
- **BACKUP FIRST**: Create timestamped backups before ANY file modification - this is non-negotiable
- **VALIDATE CONTEXT**: Always verify WordPress installation with `wp core is-installed` before operations
- **ROLLBACK READY**: Every operation must have a documented and tested undo procedure

### Incident Severity Classification
Use this exact classification system for all incidents:

| Priority | Description | Response Time | Action |
|----------|-------------|---------------|---------|
| **P0 Critical** | Site completely down, 5xx errors | Immediate | Automated response |
| **P1 High** | Core functionality broken, login issues | 5 minutes | Automated response |
| **P2 Medium** | Plugin conflicts, performance issues | Batch process | Queue for processing |
| **P3 Low** | Warnings, deprecations, minor issues | Log only | No automated action |

### Mandatory Backup Pattern
```bash
# REQUIRED: Use this exact pattern before ANY file modification
TIMESTAMP=$(date +%s)
BACKUP_PATH="${TARGET_FILE}.backup.${TIMESTAMP}"
cp "$TARGET_FILE" "$BACKUP_PATH"
echo "$(date -Iseconds) BACKUP: $TARGET_FILE -> $BACKUP_PATH" >> /var/log/wp-autohealer-backups.log
```

## Remediation Decision Framework

### Step 1: Incident Analysis (MANDATORY)
Always create this analysis structure before proceeding:

```typescript
interface IncidentAnalysis {
  errorType: 'php_fatal' | 'db_connection' | 'plugin_conflict' | 'permission' | 'memory' | 'disk_space' | 'ssl_cert';
  severity: 'critical' | 'high' | 'medium' | 'low';
  affectedComponents: string[];
  safeToAutomate: boolean;
  backupRequired: boolean;
  estimatedDowntime: number; // minutes
  rollbackComplexity: 'simple' | 'moderate' | 'complex';
}
```

### Step 2: Risk Assessment Matrix
Use this decision matrix for every remediation:

| Operation Type | Risk Level | Approval Required | Backup Required |
|----------------|------------|-------------------|-----------------|
| Plugin deactivation | Low | Auto-approve | Directory only |
| Cache clearing | Low | Auto-approve | No |
| Permission fixes | Low | Auto-approve | Permission state |
| .htaccess changes | Medium | Require confirmation | Full file |
| wp-config.php edits | High | Require confirmation | Full file + DB |
| Database repairs | High | Require confirmation | Full DB dump |
| Core file changes | Critical | Human escalation | Full site |
| Schema changes | Critical | Human escalation | Full DB dump |

### Step 3: Execution Flow (REQUIRED PATTERN)
```typescript
async executeRemediation(incident: Incident): Promise<RemediationResult> {
  // 1. Pre-flight validation
  const validation = await this.validateWordPressInstallation(incident.siteId);
  if (!validation.isValid) {
    throw new ValidationException(`WordPress validation failed: ${validation.error}`);
  }
  
  // 2. Create backup with verification
  const backupResult = await this.createVerifiedBackup(incident.affectedFiles);
  if (!backupResult.success) {
    throw new BackupException('Backup creation failed - aborting remediation');
  }
  
  // 3. Execute with timeout and monitoring
  const result = await this.executeWithTimeout(
    incident.remediationCommand, 
    30000, // 30 second timeout
    { monitorHealth: true }
  );
  
  // 4. Immediate verification
  const verification = await this.verifyRemediation(incident.siteId);
  
  // 5. Auto-rollback on failure
  if (!verification.success) {
    await this.performRollback(backupResult.backupId);
    throw new RemediationFailedException(`Verification failed: ${verification.error}`);
  }
  
  // 6. Log success with audit trail
  await this.auditService.logSuccessfulRemediation(incident.id, result);
  
  return result;
}
```

## WordPress-Specific Implementation Patterns

### WP-CLI Command Execution (REQUIRED)
Always use this exact pattern for WP-CLI commands:

```bash
execute_wp_command() {
  local command="$1"
  local site_path="$2"
  local timeout="${3:-30}" # Default 30 seconds
  
  # Change to site directory with error handling
  cd "$site_path" || {
    echo "ERROR: Cannot access site path: $site_path"
    return 1
  }
  
  # Verify WordPress installation exists
  if ! wp core is-installed --allow-root 2>/dev/null; then
    echo "ERROR: WordPress not installed at $site_path"
    return 1
  fi
  
  # Execute with timeout and capture both stdout and stderr
  timeout "${timeout}s" wp $command --allow-root 2>&1
  local exit_code=$?
  
  # Log result with timestamp
  echo "$(date -Iseconds) WP-CLI: wp $command (exit: $exit_code)" >> /var/log/wp-autohealer-commands.log
  
  return $exit_code
}
```

### WordPress Configuration Detection
```typescript
// REQUIRED: Always detect custom configurations
async getWordPressConfig(siteId: string): Promise<WordPressConfig> {
  const wpConfigPath = await this.getWpConfigPath(siteId);
  const wpConfig = await this.readFile(wpConfigPath);
  
  return {
    tablePrefix: this.extractTablePrefix(wpConfig),
    dbName: this.extractDbName(wpConfig),
    wpContentDir: this.extractContentDir(wpConfig) || 'wp-content',
    wpPluginDir: this.extractPluginDir(wpConfig) || 'wp-content/plugins',
    debugMode: wpConfig.includes("define('WP_DEBUG', true)"),
    multisite: wpConfig.includes('MULTISITE') && wpConfig.includes('true')
  };
}

private extractTablePrefix(wpConfig: string): string {
  const match = wpConfig.match(/\$table_prefix\s*=\s*['"]([^'"]+)['"]/);
  return match ? match[1] : 'wp_';
}
```

### Safe File Modification (MANDATORY PATTERN)
```typescript
async modifyWordPressFile(
  filePath: string, 
  modifications: FileModification[],
  options: { validateSyntax?: boolean; testMode?: boolean } = {}
): Promise<ModificationResult> {
  
  // 1. Pre-modification validation
  if (!await this.fileExists(filePath)) {
    throw new FileNotFoundException(`File not found: ${filePath}`);
  }
  
  // 2. Create timestamped backup
  const backupPath = `${filePath}.backup.${Date.now()}`;
  await this.copyFile(filePath, backupPath);
  
  // 3. Read and validate current content
  const originalContent = await this.readFile(filePath);
  
  // 4. Apply modifications with validation
  let modifiedContent = originalContent;
  for (const mod of modifications) {
    if (!modifiedContent.includes(mod.search)) {
      throw new ModificationException(`Search pattern not found: ${mod.search}`);
    }
    modifiedContent = modifiedContent.replace(mod.search, mod.replace);
  }
  
  // 5. Syntax validation for PHP files
  if (options.validateSyntax && filePath.endsWith('.php')) {
    const syntaxCheck = await this.validatePhpSyntax(modifiedContent);
    if (!syntaxCheck.valid) {
      throw new SyntaxException(`PHP syntax error: ${syntaxCheck.error}`);
    }
  }
  
  // 6. Test mode: return without writing
  if (options.testMode) {
    return { success: true, backupPath, testOnly: true };
  }
  
  // 7. Write changes atomically
  const tempPath = `${filePath}.tmp.${Date.now()}`;
  await this.writeFile(tempPath, modifiedContent);
  await this.moveFile(tempPath, filePath);
  
  // 8. Immediate health check
  const healthCheck = await this.performHealthCheck();
  if (!healthCheck.success) {
    await this.restoreFromBackup(filePath, backupPath);
    throw new HealthCheckException(`Health check failed: ${healthCheck.error}`);
  }
  
  return { success: true, backupPath, modified: true };
}
```

## Common Remediation Playbooks

### Plugin Conflict Resolution
```typescript
async resolvePluginConflict(incident: PluginConflictIncident): Promise<RemediationResult> {
  const { pluginName, siteId } = incident.metadata;
  
  // 1. Validate plugin exists and is active
  const pluginStatus = await this.executeWpCommand(`plugin status ${pluginName}`, siteId);
  if (pluginStatus.exitCode !== 0) {
    return { success: false, reason: 'Plugin not found or already inactive' };
  }
  
  // 2. Create plugin directory backup
  const pluginPath = `wp-content/plugins/${pluginName}`;
  const backupId = await this.backupService.backupDirectory(pluginPath, siteId);
  
  // 3. Deactivate plugin with error handling
  const deactivateResult = await this.executeWpCommand(
    `plugin deactivate ${pluginName} --uninstall`,
    siteId
  );
  
  if (deactivateResult.exitCode !== 0) {
    throw new RemediationException(`Failed to deactivate plugin: ${deactivateResult.stderr}`);
  }
  
  // 4. Immediate health check
  const healthCheck = await this.performHealthCheck(siteId);
  
  if (healthCheck.success) {
    // Success: Log and return
    await this.auditService.logRemediation({
      incidentId: incident.id,
      action: 'plugin_deactivated',
      plugin: pluginName,
      backupId,
      success: true,
      healthCheckPassed: true
    });
    
    return { 
      success: true, 
      action: 'plugin_deactivated',
      backupId,
      message: `Plugin ${pluginName} successfully deactivated`
    };
  } else {
    // Failure: Reactivate and escalate
    await this.executeWpCommand(`plugin activate ${pluginName}`, siteId);
    throw new RemediationFailedException(
      `Plugin deactivation did not resolve issue. Health check still failing: ${healthCheck.error}`
    );
  }
}
```

### Database Connection Recovery
```typescript
async repairDatabaseConnection(incident: DatabaseIncident): Promise<RemediationResult> {
  const { siteId } = incident;
  
  // 1. Test current connection status
  const connectionTest = await this.executeWpCommand('db check', siteId);
  
  if (connectionTest.exitCode === 0) {
    return { 
      success: true, 
      action: 'connection_already_working',
      message: 'Database connection is already functional'
    };
  }
  
  // 2. Create full database backup before repair
  const backupId = await this.backupService.createDatabaseBackup(siteId);
  
  // 3. Attempt database repair
  const repairResult = await this.executeWpCommand('db repair', siteId);
  
  if (repairResult.exitCode !== 0) {
    throw new RemediationFailedException(
      `Database repair failed: ${repairResult.stderr}`
    );
  }
  
  // 4. Verify connection is restored
  const verifyResult = await this.executeWpCommand('db check', siteId);
  
  if (verifyResult.exitCode === 0) {
    // 5. Additional integrity checks
    const integrityCheck = await this.executeWpCommand('db optimize', siteId);
    
    await this.auditService.logRemediation({
      incidentId: incident.id,
      action: 'database_repaired',
      backupId,
      success: true,
      integrityCheckPassed: integrityCheck.exitCode === 0
    });
    
    return { 
      success: true, 
      action: 'database_repaired',
      backupId,
      message: 'Database connection restored and optimized'
    };
  } else {
    throw new RemediationFailedException(
      `Database connection still failing after repair: ${verifyResult.stderr}`
    );
  }
}
```

### WordPress Permission Fix
```bash
# REQUIRED: Standard WordPress permission fix with backup
fix_wordpress_permissions() {
  local wp_path="$1"
  local wp_user="${2:-www-data}"
  local wp_group="${3:-www-data}"
  
  # Validate parameters
  if [[ ! -d "$wp_path" ]]; then
    echo "ERROR: WordPress path does not exist: $wp_path"
    return 1
  fi
  
  # Create permission state backup
  local backup_file="$wp_path/permissions.backup.$(date +%s)"
  find "$wp_path" -type f -exec stat -c "%n %a %U:%G" {} \; > "$backup_file"
  find "$wp_path" -type d -exec stat -c "%n %a %U:%G" {} \; >> "$backup_file"
  
  echo "Permission backup created: $backup_file"
  
  # Apply WordPress standard permissions
  find "$wp_path" -type d -exec chmod 755 {} \;
  find "$wp_path" -type f -exec chmod 644 {} \;
  
  # Special file permissions
  if [[ -f "$wp_path/wp-config.php" ]]; then
    chmod 600 "$wp_path/wp-config.php"
  fi
  
  if [[ -f "$wp_path/.htaccess" ]]; then
    chmod 644 "$wp_path/.htaccess"
  fi
  
  # Set ownership
  chown -R "$wp_user:$wp_group" "$wp_path"
  
  # Verify critical files are accessible
  if [[ ! -r "$wp_path/wp-config.php" ]]; then
    echo "WARNING: wp-config.php is not readable after permission fix"
    return 1
  fi
  
  echo "WordPress permissions fixed for $wp_path (owner: $wp_user:$wp_group)"
  return 0
}
```

## Error Recovery & Rollback System

### Automatic Rollback Implementation
```typescript
@Injectable()
export class RemediationRollbackService {
  
  async performRollback(remediationId: string): Promise<RollbackResult> {
    const remediation = await this.getRemediationRecord(remediationId);
    
    try {
      switch (remediation.type) {
        case 'file_modification':
          return await this.rollbackFileModification(remediation);
          
        case 'plugin_deactivation':
          return await this.rollbackPluginDeactivation(remediation);
          
        case 'database_repair':
          return await this.rollbackDatabaseRepair(remediation);
          
        case 'permission_change':
          return await this.rollbackPermissionChange(remediation);
          
        default:
          throw new UnsupportedRollbackException(`Unknown remediation type: ${remediation.type}`);
      }
    } catch (error) {
      await this.escalateToHuman(remediationId, `Rollback failed: ${error.message}`);
      throw error;
    }
  }
  
  private async rollbackFileModification(remediation: RemediationRecord): Promise<RollbackResult> {
    const { backupPath, originalPath } = remediation;
    
    if (!await this.fileExists(backupPath)) {
      throw new RollbackException(`Backup file not found: ${backupPath}`);
    }
    
    // Restore from backup
    await this.copyFile(backupPath, originalPath);
    
    // Verify restoration
    const healthCheck = await this.performHealthCheck(remediation.siteId);
    
    return {
      success: healthCheck.success,
      action: 'file_restored',
      healthCheckPassed: healthCheck.success,
      error: healthCheck.success ? null : healthCheck.error
    };
  }
  
  private async rollbackPluginDeactivation(remediation: RemediationRecord): Promise<RollbackResult> {
    const { pluginName, siteId } = remediation;
    
    const activateResult = await this.executeWpCommand(
      `plugin activate ${pluginName}`,
      siteId
    );
    
    if (activateResult.exitCode !== 0) {
      throw new RollbackException(`Failed to reactivate plugin: ${activateResult.stderr}`);
    }
    
    const healthCheck = await this.performHealthCheck(siteId);
    
    return {
      success: true,
      action: 'plugin_reactivated',
      healthCheckPassed: healthCheck.success,
      message: `Plugin ${pluginName} reactivated`
    };
  }
}
```

### Human Escalation Triggers
Automatically escalate to human operators when:

1. **Rollback Failures**: Any rollback procedure fails to restore functionality
2. **Multiple Failures**: Same incident fails remediation 3+ times
3. **Critical File Changes**: Core WordPress files require modification
4. **Database Corruption**: Structural database issues detected
5. **Security Indicators**: Potential security breach or malware detected
6. **Custom Code Issues**: Theme or custom plugin conflicts
7. **Server-Level Issues**: Disk space, memory, or system-level problems

### Comprehensive Audit Trail
```typescript
interface RemediationAuditLog {
  // Core identification
  timestamp: Date;
  incidentId: string;
  siteId: string;
  serverId: string;
  
  // Action details
  action: RemediationAction;
  command: string;
  exitCode: number;
  duration: number; // milliseconds
  
  // Backup and rollback info
  backupId?: string;
  backupPath?: string;
  rollbackAvailable: boolean;
  
  // Results
  success: boolean;
  errorMessage?: string;
  healthCheckPassed?: boolean;
  
  // Context
  userId: string;
  userAgent: string;
  ipAddress: string;
  
  // Metadata
  affectedFiles?: string[];
  beforeState?: any;
  afterState?: any;
}

// REQUIRED: Log every operation with this level of detail
await this.auditService.logRemediation({
  timestamp: new Date(),
  incidentId: incident.id,
  siteId: incident.siteId,
  serverId: incident.serverId,
  action: 'plugin_deactivate',
  command: `wp plugin deactivate ${pluginName} --allow-root`,
  exitCode: result.exitCode,
  duration: Date.now() - startTime,
  backupId: backupResult.id,
  backupPath: backupResult.path,
  rollbackAvailable: true,
  success: result.exitCode === 0,
  healthCheckPassed: healthCheck.success,
  userId: 'system',
  userAgent: 'wp-autohealer/1.0',
  ipAddress: serverInfo.ipAddress,
  affectedFiles: [`wp-content/plugins/${pluginName}`],
  beforeState: { pluginActive: true },
  afterState: { pluginActive: false }
});
```

## NestJS Service Implementation Patterns

### WordPress Remediation Service
```typescript
@Injectable()
export class WordPressRemediationService {
  constructor(
    private readonly sshService: SshService,
    private readonly auditService: AuditService,
    private readonly backupService: BackupService,
    private readonly healthCheckService: HealthCheckService,
    private readonly configService: ConfigService
  ) {}

  async executeRemediation(incident: Incident): Promise<RemediationResult> {
    const server = await this.getServerConfig(incident.serverId);
    const startTime = Date.now();
    
    try {
      // 1. Pre-flight validation
      await this.validatePrerequisites(server, incident);
      
      // 2. Create verified backup
      const backupResult = await this.backupService.createVerifiedBackup(
        server,
        incident.sitePath,
        incident.affectedFiles
      );
      
      // 3. Execute remediation with monitoring
      const result = await this.executeRemediationWithMonitoring(
        server,
        incident.remediationCommand,
        { timeout: this.configService.get('SSH_TIMEOUT') }
      );
      
      // 4. Comprehensive verification
      const verification = await this.performComprehensiveVerification(
        server, 
        incident.sitePath
      );
      
      if (!verification.success) {
        // Auto-rollback on verification failure
        await this.backupService.restoreBackup(backupResult.id);
        throw new RemediationFailedException(
          `Verification failed: ${verification.error}. Rollback completed.`
        );
      }
      
      // 5. Success logging
      await this.auditService.logSuccessfulRemediation({
        incident,
        result,
        backupId: backupResult.id,
        duration: Date.now() - startTime,
        verification
      });
      
      return {
        success: true,
        backupId: backupResult.id,
        duration: Date.now() - startTime,
        verification
      };
      
    } catch (error) {
      await this.auditService.logFailedRemediation({
        incident,
        error: error.message,
        duration: Date.now() - startTime
      });
      throw error;
    }
  }
  
  private async validatePrerequisites(server: ServerConfig, incident: Incident): Promise<void> {
    // WordPress installation check
    const wpCheck = await this.sshService.executeCommand(
      server,
      `cd ${incident.sitePath} && wp core is-installed --allow-root`
    );
    
    if (wpCheck.exitCode !== 0) {
      throw new ValidationException('WordPress installation not found or corrupted');
    }
    
    // Disk space check
    const diskCheck = await this.sshService.executeCommand(
      server,
      `df -h ${incident.sitePath} | tail -1 | awk '{print $5}' | sed 's/%//'`
    );
    
    const diskUsage = parseInt(diskCheck.stdout.trim());
    if (diskUsage > 90) {
      throw new ValidationException(`Insufficient disk space: ${diskUsage}% used`);
    }
  }
}
```

### BullMQ Job Processing with State Management
```typescript
@Processor('remediation')
export class RemediationProcessor {
  
  @Process('execute-remediation')
  async handleRemediation(job: Job<RemediationJobData>): Promise<RemediationResult> {
    const { incidentId } = job.data;
    
    try {
      // Update incident status
      await this.incidentsService.updateStatus(incidentId, 'processing');
      await job.progress(10);
      
      const incident = await this.incidentsService.findOne(incidentId);
      
      // State machine progression
      await this.progressIncidentState(incident, 'discovery');
      await job.progress(20);
      
      await this.progressIncidentState(incident, 'backup');
      await job.progress(40);
      
      await this.progressIncidentState(incident, 'remediation');
      await job.progress(70);
      
      const result = await this.remediationService.executeRemediation(incident);
      
      await this.progressIncidentState(incident, 'verification');
      await job.progress(90);
      
      // Final state update
      await this.incidentsService.updateStatus(incidentId, 'resolved');
      await job.progress(100);
      
      return result;
      
    } catch (error) {
      await this.incidentsService.updateStatus(incidentId, 'failed');
      
      // Attempt automatic rollback if backup exists
      if (error.backupId) {
        try {
          await this.backupService.restoreBackup(error.backupId);
          await this.incidentsService.addEvent(incidentId, {
            type: 'rollback_completed',
            message: 'Automatic rollback completed after remediation failure'
          });
        } catch (rollbackError) {
          await this.escalationService.escalateToHuman(incidentId, {
            reason: 'rollback_failed',
            originalError: error.message,
            rollbackError: rollbackError.message
          });
        }
      }
      
      throw error;
    }
  }
  
  private async progressIncidentState(incident: Incident, state: IncidentState): Promise<void> {
    await this.incidentsService.updateState(incident.id, state);
    await this.incidentsService.addEvent(incident.id, {
      type: 'state_change',
      state,
      timestamp: new Date()
    });
  }
}
```

### Comprehensive Health Check Service
```typescript
@Injectable()
export class HealthCheckService {
  
  async performComprehensiveHealthCheck(
    server: ServerConfig, 
    sitePath: string
  ): Promise<HealthCheckResult> {
    
    const checks = [
      { name: 'http_response', check: () => this.checkHttpResponse(server.siteUrl) },
      { name: 'wordpress_core', check: () => this.checkWordPressCore(server, sitePath) },
      { name: 'database_connection', check: () => this.checkDatabaseConnection(server, sitePath) },
      { name: 'file_permissions', check: () => this.checkFilePermissions(server, sitePath) },
      { name: 'plugin_integrity', check: () => this.checkPluginIntegrity(server, sitePath) },
      { name: 'theme_integrity', check: () => this.checkThemeIntegrity(server, sitePath) }
    ];
    
    const results = await Promise.allSettled(
      checks.map(async ({ name, check }) => ({
        name,
        result: await check()
      }))
    );
    
    const checkResults = results.map((result, index) => ({
      name: checks[index].name,
      passed: result.status === 'fulfilled' && result.value.result.success,
      error: result.status === 'rejected' ? result.reason : 
             (result.value.result.success ? null : result.value.result.error),
      duration: result.status === 'fulfilled' ? result.value.result.duration : null
    }));
    
    const allPassed = checkResults.every(check => check.passed);
    const criticalFailed = checkResults
      .filter(check => ['http_response', 'wordpress_core', 'database_connection'].includes(check.name))
      .some(check => !check.passed);
    
    return {
      success: allPassed,
      critical: !criticalFailed,
      checks: checkResults,
      summary: this.generateHealthSummary(checkResults)
    };
  }
  
  private async checkHttpResponse(siteUrl: string): Promise<CheckResult> {
    const startTime = Date.now();
    try {
      const response = await this.httpService.axiosRef.get(siteUrl, {
        timeout: 10000,
        validateStatus: (status) => status < 500 // Accept 4xx but not 5xx
      });
      
      return {
        success: response.status < 400,
        duration: Date.now() - startTime,
        metadata: { statusCode: response.status, responseTime: Date.now() - startTime }
      };
    } catch (error) {
      return {
        success: false,
        duration: Date.now() - startTime,
        error: error.message
      };
    }
  }
  
  private async checkWordPressCore(server: ServerConfig, sitePath: string): Promise<CheckResult> {
    const startTime = Date.now();
    
    const result = await this.sshService.executeCommand(
      server,
      `cd ${sitePath} && wp core verify-checksums --allow-root`
    );
    
    return {
      success: result.exitCode === 0,
      duration: Date.now() - startTime,
      error: result.exitCode !== 0 ? result.stderr : null,
      metadata: { exitCode: result.exitCode }
    };
  }
}
```
