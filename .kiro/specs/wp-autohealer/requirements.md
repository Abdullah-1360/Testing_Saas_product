# Requirements Document

## Introduction

WP-AutoHealer is a production-grade WordPress self-healing system that functions as an autonomous Level-1.5 SRE/Support Engineer. The system automatically diagnoses and remediates WordPress website errors on Linux servers via SSH, using conservative minimal reversible changes while preserving all existing business, SEO, content, and behavioral characteristics.

## Glossary

- **System**: The WP-AutoHealer application
- **Incident**: A detected WordPress website error requiring remediation
- **Site**: A WordPress website managed by the system
- **Server**: A Linux server hosting WordPress sites
- **Control_Panel**: The web-based administrative interface
- **Job_Engine**: The background processing system for incident remediation
- **Evidence**: Log captures, command outputs, and diagnostic data collected during incidents
- **Rollback_Artifact**: Backup data and metadata required to reverse changes
- **Fix_Attempt**: A single hypothesis-driven remediation action
- **Verification**: Process to confirm site functionality after changes
- **Retention_Policy**: Rules governing how long incident data is stored
- **RBAC**: Role-Based Access Control system
- **MFA**: Multi-Factor Authentication using TOTP

## Requirements

### Requirement 1: Technology Stack Implementation

**User Story:** As a system architect, I want a modern, scalable technology stack, so that the system can handle production workloads reliably.

#### Acceptance Criteria

1. THE System SHALL be implemented using Node.js with TypeScript
2. THE Backend SHALL use NestJS framework for API and business logic
3. THE Database SHALL use PostgreSQL with Prisma ORM for data persistence
4. THE Queue_System SHALL use BullMQ for background job processing
5. THE Frontend SHALL use Next.js with App Router for the Control_Panel
6. THE System SHALL provide real-time updates via Server-Sent Events or WebSocket
7. THE SSH_Client SHALL use ssh2 library with strict host key verification enabled
8. THE Authentication SHALL use secure sessions with MFA support via TOTP
9. THE Secrets SHALL be encrypted at rest using libsodium

### Requirement 2: Mandatory Operation Logging

**User Story:** As a compliance officer, I want complete audit trails of all system operations, so that I can verify system behavior and meet regulatory requirements.

#### Acceptance Criteria

1. WHEN an incident occurs, THE System SHALL store every operation in the database including phases, steps, commands, stdout/stderr, log signatures, verification results, file diffs, backup metadata, and rollback plans
2. THE Control_Panel SHALL display all incident data with full visibility
3. THE System SHALL provide a versioned REST API with RBAC, redaction, and pagination for accessing incident data
4. THE System SHALL assign unique trace and correlation IDs to all operations
5. THE System SHALL record timestamps and actor identity for all operations

### Requirement 3: Data Retention Management

**User Story:** As a system administrator, I want configurable data retention policies, so that I can manage storage costs while maintaining necessary audit trails.

#### Acceptance Criteria

1. THE System SHALL set default retention period to 3 days for all incident data
2. THE System SHALL allow retention configuration between 1-7 days maximum with hard cap enforcement
3. THE System SHALL automatically purge expired data according to retention policies
4. THE System SHALL maintain an audit trail of all purge operations
5. THE Control_Panel SHALL provide an interface for configuring retention policies
6. THE Control_Panel SHALL display purge audit logs with timestamps and affected records

### Requirement 4: System Discovery and Detection

**User Story:** As an SRE engineer, I want automatic environment detection, so that the system can adapt to different server configurations without manual setup.

#### Acceptance Criteria

1. WHEN connecting to a server, THE System SHALL auto-detect the operating system
2. THE System SHALL auto-detect the web server type (Apache, Nginx, LiteSpeed, etc.)
3. THE System SHALL auto-detect control panel software (cPanel, Plesk, DirectAdmin, CyberPanel, or raw VPS)
4. THE System SHALL auto-detect PHP handler configuration
5. THE System SHALL auto-detect document root paths for domains
6. THE System SHALL auto-detect WordPress installation paths
7. THE System SHALL auto-detect database engine and configuration
8. THE System SHALL auto-detect caching systems in use
9. THE System SHALL auto-detect WordPress multisite configuration

### Requirement 5: Safe Change Management

**User Story:** As a site owner, I want guarantee that no changes are made to my production site until proper backups exist, so that my site can always be restored if something goes wrong.

#### Acceptance Criteria

1. THE System SHALL never modify production files until rollback artifacts exist and are recorded in the database
2. THE System SHALL limit maximum applied-change attempts to 15 per incident
3. WHEN making a fix attempt, THE System SHALL follow one hypothesis per attempt: hypothesis → evidence → minimal change → verify → record
4. THE System SHALL only restore service while preserving existing behavior
5. IF a fix changes output, layout, URLs, metadata, or SEO behavior, THEN THE System SHALL treat it as a failure and rollback
6. THE System SHALL create rollback artifacts before any production modification

### Requirement 6: Security and Secrets Management

**User Story:** As a security officer, I want all sensitive data protected and never exposed in logs, so that credentials and secrets remain secure.

#### Acceptance Criteria

1. THE System SHALL never display secrets in logs or API responses
2. THE System SHALL encrypt all secrets at rest using libsodium
3. THE System SHALL prefer SSH keys over passwords for authentication
4. THE System SHALL enforce strict host key checking for SSH connections
5. THE System SHALL validate all inputs to prevent SSRF and injection attacks
6. THE System SHALL use safe command templating for SSH execution
7. THE System SHALL execute commands with least-privilege principles
8. THE System SHALL implement rate limiting on all API endpoints
9. THE System SHALL maintain audit logs for all security-relevant events
10. THE System SHALL consistently redact secrets from all logged output

### Requirement 7: Database Schema Requirements

**User Story:** As a database administrator, I want a comprehensive schema that supports all system operations, so that data integrity and relationships are maintained.

#### Acceptance Criteria

1. THE Database SHALL store user accounts, roles, and session data
2. THE Database SHALL store MFA configuration and tokens
3. THE Database SHALL store server connection details and credentials
4. THE Database SHALL store site and domain configurations
5. THE Database SHALL store incidents with timeline events in append-only format
6. THE Database SHALL store command executions with complete stdout/stderr
7. THE Database SHALL store evidence log captures with signatures
8. THE Database SHALL store file changes and diffs
9. THE Database SHALL store backup metadata and rollback plans
10. THE Database SHALL store verification results and test outcomes
11. THE Database SHALL store ticket and escalation data
12. THE Database SHALL store audit events with full traceability
13. THE Database SHALL store retention policy configuration and purge audit records

### Requirement 8: Job Engine State Management

**User Story:** As a system engineer, I want a robust job processing system, so that incident remediation can handle failures and resume operations reliably.

#### Acceptance Criteria

1. THE Job_Engine SHALL implement state machine: NEW → DISCOVERY → BASELINE → BACKUP → OBSERVABILITY → FIX_ATTEMPT(n) → VERIFY → FIXED/ROLLBACK/ESCALATED
2. THE Job_Engine SHALL be idempotent and resumable after system crashes
3. THE Job_Engine SHALL prevent flapping with configurable cooldown windows
4. THE Job_Engine SHALL implement circuit breakers for failing operations
5. THE Job_Engine SHALL implement bounded loops to prevent infinite processing
6. THE Job_Engine SHALL track state transitions with timestamps and reasons

### Requirement 9: Control Panel Authentication and Authorization

**User Story:** As a system administrator, I want secure access control with multiple user roles, so that different team members have appropriate permissions.

#### Acceptance Criteria

1. THE Control_Panel SHALL provide secure login with MFA support
2. THE System SHALL implement RBAC with roles: Super Admin, Admin, Engineer, Viewer
3. THE System SHALL enforce role-based permissions on all operations
4. THE System SHALL support TOTP-based multi-factor authentication
5. THE System SHALL maintain secure session management
6. THE System SHALL log all authentication and authorization events

### Requirement 10: Control Panel Core Features

**User Story:** As an operations team member, I want a comprehensive web interface, so that I can monitor and manage all system operations effectively.

#### Acceptance Criteria

1. THE Control_Panel SHALL provide a Dashboard page with system overview
2. THE Control_Panel SHALL provide an Incidents page with incident management
3. THE Control_Panel SHALL provide a Sites page for site configuration
4. THE Control_Panel SHALL provide a Servers page for server management
5. THE Control_Panel SHALL provide a Policies page for system configuration
6. THE Control_Panel SHALL provide an Integrations page for external system connections
7. THE Control_Panel SHALL provide a Users & Roles page for access management
8. THE Control_Panel SHALL provide an Audit Log page for compliance tracking
9. THE Control_Panel SHALL provide a Settings page for system configuration
10. THE Control_Panel SHALL provide retention configuration interface
11. THE Control_Panel SHALL display purge audit logs with full details

### Requirement 11: Incident Detail Management

**User Story:** As an SRE engineer, I want detailed incident information organized in tabs, so that I can quickly understand what happened and what actions were taken.

#### Acceptance Criteria

1. THE Control_Panel SHALL display incident details with Timeline tab showing chronological events
2. THE Control_Panel SHALL display Commands tab with all executed commands and outputs
3. THE Control_Panel SHALL display Evidence tab with collected diagnostic data
4. THE Control_Panel SHALL display Changes tab with file modifications and diffs
5. THE Control_Panel SHALL display Backups tab with rollback artifact information
6. THE Control_Panel SHALL display Verification tab with test results and outcomes
7. THE Control_Panel SHALL display Ticket/Handoff tab with escalation information

### Requirement 12: WordPress Fix Logic Implementation

**User Story:** As a WordPress site owner, I want the system to follow a conservative approach to fixing issues, so that my site functionality is preserved while problems are resolved.

#### Acceptance Criteria

1. THE System SHALL prioritize Tier 1 fixes: Infrastructure and runtime issues
2. THE System SHALL implement Tier 2 fixes: WordPress core integrity restoration
3. THE System SHALL implement Tier 3 fixes: Plugin and theme conflict isolation
4. THE System SHALL implement Tier 4 fixes: Cache flush with evidence-based justification
5. THE System SHALL implement Tier 5 fixes: Dependency repair
6. THE System SHALL implement Tier 6 fixes: Last resort component rollback
7. THE System SHALL execute fix tiers in priority order
8. THE System SHALL document the rationale for each fix attempt

### Requirement 13: Comprehensive Verification Logic

**User Story:** As a site owner, I want thorough verification that my site is working correctly after fixes, so that I can be confident the remediation was successful.

#### Acceptance Criteria

1. THE System SHALL verify more than HTTP 200 status codes
2. THE System SHALL detect fatal errors, maintenance mode, and white-screen conditions
3. THE System SHALL verify presence of title tags in responses
4. THE System SHALL verify presence of canonical tags in responses
5. THE System SHALL verify presence of footer and header markers
6. THE System SHALL test wp-login functionality
7. THE System SHALL test internal URL accessibility
8. THE System SHALL record all verification results in the database
9. THE System SHALL fail verification if expected markers are missing

### Requirement 14: Control Panel Detection Support

**User Story:** As a hosting provider, I want the system to work with different control panels, so that it can manage WordPress sites across various hosting environments.

#### Acceptance Criteria

1. THE System SHALL auto-detect cPanel installations and configurations
2. THE System SHALL auto-detect Plesk installations and configurations
3. THE System SHALL auto-detect DirectAdmin installations and configurations
4. THE System SHALL auto-detect CyberPanel installations and configurations
5. THE System SHALL handle raw VPS environments without control panels
6. THE System SHALL provide robust domain to document root mapping
7. THE System SHALL identify stack-aware log file locations

### Requirement 15: REST API Design

**User Story:** As an integration developer, I want a comprehensive REST API, so that I can integrate WP-AutoHealer with other systems and tools.

#### Acceptance Criteria

1. THE System SHALL provide versioned REST API endpoints
2. THE API SHALL implement RBAC for all endpoints
3. THE API SHALL provide pagination for list endpoints
4. THE API SHALL implement proper redaction of sensitive data
5. THE API SHALL return consistent error responses with appropriate HTTP status codes
6. THE API SHALL support filtering and sorting for list endpoints
7. THE API SHALL provide OpenAPI/Swagger documentation
8. THE API SHALL implement rate limiting per user/role
9. THE API SHALL log all API access for audit purposes

### Requirement 16: MVP Scope Definition

**User Story:** As a product manager, I want a clearly defined MVP scope, so that we can deliver core functionality quickly while planning future enhancements.

#### Acceptance Criteria

1. THE MVP SHALL include login with RBAC functionality
2. THE MVP SHALL include server management capabilities
3. THE MVP SHALL include site management capabilities
4. THE MVP SHALL include manual incident triggering
5. THE MVP SHALL include incident timeline display
6. THE MVP SHALL include SSH command execution with database logging
7. THE MVP SHALL include backup metadata storage
8. THE MVP SHALL include at least 3 WordPress fix playbooks
9. THE MVP SHALL include verification functionality
10. THE MVP SHALL include ticket payload generation for escalation
11. THE MVP SHALL include retention policy with 3-day default and 7-day maximum
12. THE MVP SHALL include purge audit functionality