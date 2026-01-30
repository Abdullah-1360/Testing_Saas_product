# WP-AutoHealer Control Panel User Manual

This comprehensive guide covers all aspects of using the WP-AutoHealer control panel interface.

## 📖 Table of Contents

1. [Getting Started](#getting-started)
2. [Dashboard Overview](#dashboard-overview)
3. [Authentication & Security](#authentication--security)
4. [Server Management](#server-management)
5. [Site Management](#site-management)
6. [Incident Management](#incident-management)
7. [System Settings](#system-settings)
8. [User & Role Management](#user--role-management)
9. [Audit Logs](#audit-logs)
10. [Troubleshooting](#troubleshooting)

## 🚀 Getting Started

### First Login

1. Navigate to your WP-AutoHealer installation URL
2. Enter your admin credentials provided during setup
3. Complete MFA setup if required
4. You'll be redirected to the main dashboard

### Interface Overview

The control panel consists of:
- **Header**: Logo, user menu, and quick actions
- **Sidebar**: Main navigation menu
- **Main Content**: Current page content
- **Status Bar**: Real-time system status (bottom)

### Navigation Menu

| Icon | Section | Description |
|------|---------|-------------|
| 📊 | Dashboard | System overview and key metrics |
| 🚨 | Incidents | Active and historical incidents |
| 🌐 | Sites | WordPress site management |
| 🖥️ | Servers | Server connection management |
| 📋 | Policies | System policies and configuration |
| 🔗 | Integrations | External system integrations |
| 👥 | Users & Roles | User account management |
| 📝 | Audit Log | System audit trail |
| ⚙️ | Settings | System configuration |

## 📊 Dashboard Overview

The dashboard provides a real-time overview of your WP-AutoHealer system.

### Key Metrics Cards

- **Active Sites**: Number of monitored WordPress sites
- **Active Incidents**: Currently processing incidents
- **Fixed This Week**: Successfully resolved incidents
- **Success Rate**: Overall fix success percentage

### Recent Incidents Table

Shows the most recent incidents with:
- Site name and issue description
- Current status (In Progress, Fixed, Escalated)
- Timestamp and duration
- Quick action buttons

### Quick Actions

- **Manual Trigger**: Start incident for specific site
- **System Health**: Check overall system status
- **Emergency Stop**: Pause all incident processing

## 🔐 Authentication & Security

### Multi-Factor Authentication (MFA)

#### Setting Up MFA

1. Go to **Settings** → **Security**
2. Click **Enable MFA**
3. Scan QR code with authenticator app
4. Enter verification code
5. Save backup codes securely

#### Using MFA

1. Enter email and password
2. Open authenticator app
3. Enter 6-digit code
4. Click **Verify & Login**

### Session Management

- Sessions expire after 24 hours of inactivity
- Multiple concurrent sessions are allowed
- Force logout from all devices available in settings

### Password Requirements

- Minimum 12 characters
- Must include uppercase, lowercase, numbers
- Special characters recommended
- Cannot reuse last 5 passwords
## 🖥️ Server Management

### Adding a New Server

1. Navigate to **Servers** page
2. Click **Add Server** button
3. Fill in server details:
   - **Name**: Descriptive server name
   - **Hostname**: Server IP or domain
   - **Port**: SSH port (default: 22)
   - **Username**: SSH username
   - **Authentication**: Choose Key or Password

#### SSH Key Authentication (Recommended)

1. Select **SSH Key** authentication type
2. Upload your private key file
3. Ensure public key is in server's `~/.ssh/authorized_keys`
4. Test connection

#### Password Authentication

1. Select **Password** authentication type
2. Enter SSH password
3. Password is encrypted before storage
4. Test connection

### Server Configuration

#### Auto-Detection Features

WP-AutoHealer automatically detects:
- Operating system and version
- Web server type (Apache, Nginx, LiteSpeed)
- Control panel (cPanel, Plesk, DirectAdmin, CyberPanel)
- PHP version and handler
- Database engine and version

#### Manual Configuration

If auto-detection fails:
1. Click **Manual Configuration**
2. Select detected values from dropdowns
3. Specify custom paths if needed
4. Save configuration

### Server Status Monitoring

- **Online**: Server is reachable and responsive
- **Offline**: Cannot establish SSH connection
- **Error**: Authentication or permission issues
- **Maintenance**: Manually disabled for maintenance

### Server Actions

- **Test Connection**: Verify SSH connectivity
- **Refresh Info**: Re-run environment detection
- **Edit Configuration**: Modify server settings
- **Disable/Enable**: Toggle server monitoring
- **Delete**: Remove server (requires confirmation)

## 🌐 Site Management

### Adding WordPress Sites

1. Go to **Sites** page
2. Click **Add Site** button
3. Select target server from dropdown
4. Enter site details:
   - **Domain**: Site domain name
   - **Document Root**: Web server document root
   - **WordPress Path**: WordPress installation directory
   - **Site URL**: Full site URL
   - **Admin URL**: WordPress admin URL

#### Auto-Discovery

For supported control panels:
1. Click **Auto-Discover Sites**
2. Select server from dropdown
3. System scans for WordPress installations
4. Review and confirm discovered sites

### Site Configuration

#### Health Check Settings

- **Check Interval**: How often to monitor (5-60 minutes)
- **Timeout**: Maximum response time (10-120 seconds)
- **Retry Count**: Failed attempts before incident (1-5)
- **Maintenance Windows**: Scheduled downtime periods

#### WordPress-Specific Settings

- **Multisite**: Enable if WordPress multisite
- **SSL Required**: Enforce HTTPS checks
- **Login Testing**: Test wp-admin accessibility
- **Plugin Monitoring**: Monitor for plugin conflicts

### Site Status Indicators

- **🟢 Healthy**: Site responding normally
- **🟡 Warning**: Minor issues detected
- **🔴 Critical**: Site down or major errors
- **⚪ Unknown**: Status check pending
- **🔵 Maintenance**: In maintenance mode

### Site Actions

- **Manual Health Check**: Immediate status check
- **Trigger Incident**: Force incident creation
- **View Logs**: Recent health check logs
- **Edit Configuration**: Modify site settings
- **Disable Monitoring**: Temporarily stop checks
- **Delete Site**: Remove from monitoring

## 🚨 Incident Management

### Incident Lifecycle

1. **Detection**: Issue identified via monitoring
2. **Creation**: Incident record created
3. **Discovery**: Environment analysis
4. **Baseline**: Current state capture
5. **Backup**: Create rollback artifacts
6. **Fix Attempts**: Apply remediation steps
7. **Verification**: Confirm resolution
8. **Resolution**: Mark as fixed or escalate

### Incident Dashboard

#### Incident List View

- **Status Filter**: Filter by incident state
- **Site Filter**: Show incidents for specific sites
- **Date Range**: Filter by time period
- **Priority Filter**: Filter by incident priority

#### Incident Details

Click any incident to view detailed information:

##### Timeline Tab
- Chronological event history
- State transitions with timestamps
- Duration tracking
- Phase completion status

##### Commands Tab
- All executed SSH commands
- Command output (stdout/stderr)
- Exit codes and execution times
- Command categorization

##### Evidence Tab
- Collected diagnostic data
- Log file excerpts
- Error message analysis
- System state snapshots

##### Changes Tab
- File modifications made
- Before/after diffs
- Rollback information
- Change impact assessment

##### Backups Tab
- Created backup artifacts
- File checksums and sizes
- Rollback procedures
- Backup verification status

##### Verification Tab
- Health check results
- Response analysis
- Performance metrics
- Functionality tests

##### Ticket/Handoff Tab
- Escalation information
- External ticket details
- Handoff procedures
- Contact information

### Manual Incident Actions

#### Triggering Manual Incidents

1. Go to **Sites** page
2. Click **Actions** → **Trigger Incident**
3. Select incident type:
   - **General Health Check**
   - **Plugin Conflict**
   - **Database Issues**
   - **Performance Problems**
4. Add description and priority
5. Click **Create Incident**

#### Incident Intervention

- **Pause Incident**: Temporarily halt processing
- **Resume Incident**: Continue paused incident
- **Force Escalation**: Escalate to human support
- **Manual Rollback**: Revert all changes
- **Add Notes**: Document manual interventions

### Incident Priorities

- **Critical**: Site completely down
- **High**: Major functionality broken
- **Medium**: Minor issues affecting users
- **Low**: Performance or cosmetic issues

## ⚙️ System Settings

### Data Retention Configuration

#### Retention Policies

1. Navigate to **Settings** → **Data Retention**
2. Configure retention period (1-7 days)
3. Set automatic purge schedule
4. Review purge audit log

#### Manual Data Purge

1. Click **Manual Purge** button
2. Select cutoff date
3. Review items to be purged
4. Confirm purge operation
5. Monitor purge audit log

### System Configuration

#### Incident Processing

- **Max Fix Attempts**: Limit per incident (1-20)
- **Cooldown Window**: Time between incidents (5-60 minutes)
- **Circuit Breaker**: Failure threshold settings
- **Timeout Settings**: SSH and operation timeouts

#### Security Settings

- **Session Timeout**: User session duration
- **Rate Limiting**: API request limits
- **IP Whitelist**: Allowed IP addresses
- **Audit Level**: Logging verbosity

#### Notification Settings

- **Email Configuration**: Complete SMTP setup via web interface
  - SMTP Host, Port, and Authentication
  - From Address and Display Name configuration
  - TLS/SSL encryption settings
  - Test email functionality to verify configuration
  - Encrypted password storage for security
- **Email Notifications**: Automated emails for user management, security events, and system notifications
- **Webhook URLs**: External notification endpoints
- **Alert Thresholds**: When to send notifications
- **Escalation Rules**: Automatic escalation triggers

### Integration Configuration

#### External Systems

- **Ticketing Systems**: Jira, ServiceNow, etc.
- **Monitoring Tools**: Nagios, Zabbix, etc.
- **Chat Platforms**: Slack, Teams, etc.
- **Email Systems**: SMTP configuration via web interface with test functionality

#### API Keys

- **Generate API Keys**: For external integrations
- **Key Permissions**: Scope and access levels
- **Key Rotation**: Regular key updates
- **Usage Monitoring**: API key usage tracking

## 👥 User & Role Management

### User Roles

#### Super Admin
- Full system access
- User management
- System configuration
- All incident operations

#### Admin
- User management (except Super Admins)
- Site and server management
- Incident management
- Limited system configuration

#### Engineer
- Site and server management
- Incident management
- Read-only system settings
- No user management

#### Viewer
- Read-only access to all data
- Cannot modify configurations
- Cannot trigger incidents
- Cannot manage users

### User Management

#### Adding Users

1. Go to **Users & Roles** page
2. Click **Add User** button
3. Fill in user details:
   - **Email**: User's email address
   - **Name**: Full name
   - **Role**: Select appropriate role
   - **MFA Required**: Force MFA setup
4. Send invitation email

#### Managing Existing Users

- **Edit Profile**: Update user information
- **Change Role**: Modify user permissions
- **Reset Password**: Force password reset
- **Disable Account**: Temporarily disable access
- **Delete User**: Permanently remove user

#### Bulk Operations

- **Import Users**: CSV import functionality
- **Export Users**: Download user list
- **Bulk Role Changes**: Update multiple users
- **Mass Notifications**: Send announcements

## 📝 Audit Logs

### Audit Trail Features

The audit log captures all system activities:
- User authentication events
- Configuration changes
- Incident operations
- API access
- System administration

### Viewing Audit Logs

#### Filtering Options

- **Date Range**: Specific time periods
- **User Filter**: Actions by specific users
- **Action Type**: Filter by operation type
- **Resource Type**: Filter by affected resources
- **IP Address**: Filter by source IP

#### Export Options

- **CSV Export**: Spreadsheet format
- **JSON Export**: Machine-readable format
- **PDF Report**: Formatted report
- **Email Report**: Scheduled reports

### Compliance Features

#### Retention Compliance

- Configurable retention periods
- Automatic archival
- Secure deletion
- Compliance reporting

#### Data Protection

- PII redaction
- Encryption at rest
- Access logging
- Data anonymization

## 🔧 Troubleshooting

### Common Issues

#### Cannot Login

1. Verify credentials are correct
2. Check MFA code timing
3. Clear browser cache/cookies
4. Try incognito/private mode
5. Contact administrator

#### Site Not Monitoring

1. Check server connectivity
2. Verify site configuration
3. Review SSH permissions
4. Check firewall settings
5. Test manual health check

#### Incidents Not Processing

1. Check job queue status
2. Verify Redis connectivity
3. Review system resources
4. Check error logs
5. Restart job processors

#### Performance Issues

1. Check system resources
2. Review database performance
3. Monitor network connectivity
4. Check Redis memory usage
5. Review application logs

### Getting Help

#### Built-in Help

- **Tooltips**: Hover over ? icons
- **Help Sections**: Context-sensitive help
- **Documentation Links**: Direct links to guides
- **Video Tutorials**: Embedded help videos

#### Support Channels

- **In-App Support**: Built-in support chat
- **Email Support**: support@wp-autohealer.com
- **Documentation**: Comprehensive guides
- **Community Forum**: User community

---

*This user manual covers all major features of the WP-AutoHealer control panel. For additional help, consult the troubleshooting guide or contact support.*

*Last updated: January 2024*