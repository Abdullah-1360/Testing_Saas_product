# WP-AutoHealer Control Panel Mockups

This directory contains HTML mockups for the WP-AutoHealer control panel interface.

## Files Included

### Core Pages
- **index.html** - Dashboard with system overview, stats, and recent incidents
- **incidents.html** - Incident management with filtering and status tracking
- **incident-detail.html** - Detailed incident view with timeline and tabs
- **sites.html** - WordPress site management with health status
- **servers.html** - Server infrastructure management and SSH status
- **settings.html** - System configuration including data retention policies

## Features Demonstrated

### Dashboard (index.html)
- System health overview with key metrics
- Recent incidents with real-time status
- Quick action buttons for common tasks
- Responsive card-based layout

### Incidents (incidents.html)
- Comprehensive incident filtering and search
- Tabular view with priority and status indicators
- Pagination for large datasets
- Real-time status updates

### Incident Detail (incident-detail.html)
- Complete incident timeline with state transitions
- Tabbed interface for different data types:
  - Timeline: Chronological events
  - Commands: SSH command executions
  - Evidence: Diagnostic data collection
  - Changes: File modifications and diffs
  - Backups: Rollback artifact information
  - Verification: Site health check results
  - Ticket/Handoff: Escalation information

### Sites (sites.html)
- Grid-based site overview with health indicators
- Site-specific metrics and WordPress version info
- Quick health check and detail view actions
- Support for multisite installations

### Servers (servers.html)
- Server infrastructure overview with connection status
- Environment detection (OS, web server, control panel)
- SSH connection pool monitoring
- Control panel detection statistics

### Settings (settings.html)
- **Data Retention Tab**: 
  - Configurable retention period (1-7 days with hard cap)
  - Purge status and scheduling information
  - Complete purge audit log with timestamps
- **Security Tab**: SSH and API security configuration
- **System Tab**: Job engine and health monitoring

## Design Features

### UI/UX Elements
- Modern, clean interface using Tailwind CSS
- Consistent color scheme and typography
- Responsive design for mobile and desktop
- Intuitive navigation with active state indicators
- Status badges with semantic colors
- Interactive elements with hover states

### Data Retention Focus
The settings page prominently features the data retention requirements:
- Visual slider for retention period selection
- Hard cap enforcement (maximum 7 days)
- Real-time purge status monitoring
- Comprehensive audit trail for compliance

### Security Indicators
- SSH connection status with encryption indicators
- Host key verification status
- Secret redaction confirmation
- Rate limiting configuration

## Technical Implementation

### Technologies Used
- **HTML5** with semantic markup
- **Tailwind CSS** for styling and responsive design
- **Font Awesome** for consistent iconography
- **Vanilla JavaScript** for tab switching and interactions

### Responsive Design
- Mobile-first approach with breakpoint-based layouts
- Collapsible sidebar navigation for smaller screens
- Adaptive table layouts with horizontal scrolling
- Touch-friendly interactive elements

## Usage Instructions

1. Open any HTML file in a web browser
2. Navigate between pages using the sidebar menu
3. Interact with tabs, filters, and buttons (some functionality is demo-only)
4. View responsive behavior by resizing browser window

## Key Requirements Addressed

### Mandatory Operation Logging
- Complete incident timeline with all operations
- Command execution logs with stdout/stderr
- Evidence collection and signature tracking
- File change tracking with diffs

### Data Retention Management
- Configurable retention with hard cap enforcement
- Automatic purge scheduling and status
- Comprehensive audit trail for compliance
- Visual indicators for retention policies

### Security and Access Control
- Role-based navigation structure
- SSH security status monitoring
- Secret redaction indicators
- Audit logging interfaces

### WordPress-Specific Features
- Site health monitoring with WordPress context
- Multisite installation support
- Plugin and theme conflict tracking
- WordPress version and environment detection

These mockups provide a comprehensive view of the WP-AutoHealer control panel interface, demonstrating all key features required for production WordPress site management and incident response.