# WP-AutoHealer API Documentation

This document provides comprehensive information about the WP-AutoHealer REST API, including authentication, endpoints, request/response formats, and usage examples.

## 📋 API Overview

### Base URL
```
https://your-domain.com/api/v1
```

### API Versioning
- Current version: `v1`
- Version specified in URL path
- Backward compatibility maintained within major versions

### Content Type
- Request: `application/json`
- Response: `application/json`
- Character encoding: `UTF-8`

### Rate Limiting
- **Default**: 100 requests per 15 minutes per user
- **Burst**: Up to 20 requests in quick succession
- **Headers**: Rate limit info in response headers

```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1642694400
```

## 🔐 Authentication

### Login Endpoint

```http
POST /api/v1/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "your_password",
  "mfaCode": "123456"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "role": "admin",
      "mfaEnabled": true
    },
    "token": "jwt_token_here",
    "expiresAt": "2024-01-15T14:30:00Z"
  }
}
```

### Authentication Headers

Include JWT token in all subsequent requests:

```http
Authorization: Bearer jwt_token_here
```

### Token Storage and Management

The frontend client implements a robust token storage strategy for persistence and reliability:

- **Primary Storage**: localStorage for main token persistence
- **Backup Storage**: sessionStorage for session-based fallback
- **SSR Support**: Secure HTTP-only cookies for server-side rendering and middleware access
- **Expiry Tracking**: Automatic token expiration validation using JWT payload
- **Multi-location Persistence**: Ensures token availability across browser sessions and page reloads

**Token Storage Details:**
- Tokens are stored with 7-day expiration in cookies
- Cookie settings: `secure`, `samesite=strict`, `path=/`
- Automatic expiry extraction from JWT payload for validation
- Graceful fallback handling for token parsing errors

### Logout Endpoint

```http
POST /api/v1/auth/logout
Authorization: Bearer jwt_token_here
```

## 🏗️ API Structure

### Standard Response Format

#### Success Response
```json
{
  "success": true,
  "data": {
    // Response data here
  },
  "meta": {
    "timestamp": "2024-01-15T14:30:00Z",
    "requestId": "req_uuid"
  }
}
```

#### Error Response
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input data",
    "details": {
      "field": "email",
      "constraint": "valid_email"
    }
  },
  "meta": {
    "timestamp": "2024-01-15T14:30:00Z",
    "requestId": "req_uuid"
  }
}
```

### Pagination

List endpoints support pagination:

```http
GET /api/v1/incidents?page=1&limit=20&sort=createdAt&order=desc
```

**Response:**
```json
{
  "success": true,
  "data": {
    "items": [...],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 150,
      "pages": 8,
      "hasNext": true,
      "hasPrev": false
    }
  }
}
```

## 🖥️ Server Management API

### List Servers

```http
GET /api/v1/servers
Authorization: Bearer jwt_token_here
```

**Query Parameters:**
- `page` (integer): Page number (default: 1)
- `limit` (integer): Items per page (default: 20, max: 100)
- `search` (string): Search by name or hostname
- `status` (string): Filter by status (online, offline, error)

**Response:**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "server_uuid",
        "name": "Web Server 01",
        "hostname": "192.168.1.100",
        "port": 22,
        "username": "root",
        "authType": "key",
        "status": "online",
        "controlPanel": "cpanel",
        "osInfo": {
          "name": "Ubuntu",
          "version": "22.04",
          "arch": "x86_64"
        },
        "createdAt": "2024-01-01T00:00:00Z",
        "updatedAt": "2024-01-15T14:30:00Z",
        "lastConnected": "2024-01-15T14:25:00Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 5,
      "pages": 1,
      "hasNext": false,
      "hasPrev": false
    }
  }
}
```

### Create Server

```http
POST /api/v1/servers
Authorization: Bearer jwt_token_here
Content-Type: application/json

{
  "name": "New Server",
  "hostname": "192.168.1.101",
  "port": 22,
  "username": "root",
  "authType": "key",
  "privateKey": "-----BEGIN PRIVATE KEY-----\n...",
  "hostKeyFingerprint": "SHA256:abc123..."
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "new_server_uuid",
    "name": "New Server",
    "hostname": "192.168.1.101",
    "port": 22,
    "username": "root",
    "authType": "key",
    "status": "pending",
    "createdAt": "2024-01-15T14:30:00Z"
  }
}
```

### Get Server Details

```http
GET /api/v1/servers/{serverId}
Authorization: Bearer jwt_token_here
```

### Update Server

```http
PUT /api/v1/servers/{serverId}
Authorization: Bearer jwt_token_here
Content-Type: application/json

{
  "name": "Updated Server Name",
  "port": 2222
}
```

### Delete Server

```http
DELETE /api/v1/servers/{serverId}
Authorization: Bearer jwt_token_here
```

### Test Server Connection

```http
POST /api/v1/servers/{serverId}/test
Authorization: Bearer jwt_token_here
```

**Response:**
```json
{
  "success": true,
  "data": {
    "connected": true,
    "responseTime": 150,
    "osDetected": true,
    "webServerDetected": true,
    "details": {
      "os": "Ubuntu 22.04",
      "webServer": "Apache 2.4.52",
      "php": "8.1.2"
    }
  }
}
```

## 🌐 Site Management API

### List Sites

```http
GET /api/v1/sites
Authorization: Bearer jwt_token_here
```

**Query Parameters:**
- `serverId` (string): Filter by server
- `status` (string): Filter by health status
- `domain` (string): Search by domain name

### Create Site

```http
POST /api/v1/sites
Authorization: Bearer jwt_token_here
Content-Type: application/json

{
  "serverId": "server_uuid",
  "domain": "example.com",
  "documentRoot": "/var/www/html",
  "wordpressPath": "/var/www/html/wp",
  "siteUrl": "https://example.com",
  "adminUrl": "https://example.com/wp-admin",
  "isMultisite": false
}
```

### Get Site Health Status

```http
GET /api/v1/sites/{siteId}/health
Authorization: Bearer jwt_token_here
```

**Response:**
```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "responseTime": 250,
    "httpStatus": 200,
    "checks": {
      "httpResponse": true,
      "titleTag": true,
      "canonicalTag": true,
      "footerMarkers": true,
      "wpLogin": true,
      "fatalErrors": false,
      "maintenanceMode": false
    },
    "lastChecked": "2024-01-15T14:30:00Z"
  }
}
```

### Trigger Manual Health Check

```http
POST /api/v1/sites/{siteId}/health-check
Authorization: Bearer jwt_token_here
```

## 🚨 Incident Management API

### List Incidents

```http
GET /api/v1/incidents
Authorization: Bearer jwt_token_here
```

**Query Parameters:**
- `siteId` (string): Filter by site
- `state` (string): Filter by incident state
- `priority` (string): Filter by priority
- `dateFrom` (string): Start date (ISO 8601)
- `dateTo` (string): End date (ISO 8601)

**Response:**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "incident_uuid",
        "siteId": "site_uuid",
        "site": {
          "domain": "example.com",
          "server": {
            "name": "Web Server 01"
          }
        },
        "state": "FIXED",
        "triggerType": "automatic",
        "priority": "high",
        "fixAttempts": 2,
        "maxFixAttempts": 15,
        "createdAt": "2024-01-15T14:00:00Z",
        "resolvedAt": "2024-01-15T14:05:30Z",
        "duration": 330000
      }
    ]
  }
}
```

### Get Incident Details

```http
GET /api/v1/incidents/{incidentId}
Authorization: Bearer jwt_token_here
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "incident_uuid",
    "siteId": "site_uuid",
    "state": "FIXED",
    "triggerType": "automatic",
    "priority": "high",
    "fixAttempts": 2,
    "timeline": [
      {
        "id": "event_uuid",
        "eventType": "state_change",
        "phase": "DISCOVERY",
        "step": "Environment Detection",
        "timestamp": "2024-01-15T14:00:15Z",
        "duration": 15000,
        "data": {
          "previousState": "NEW",
          "newState": "DISCOVERY"
        }
      }
    ],
    "commands": [
      {
        "id": "cmd_uuid",
        "command": "wp --version",
        "stdout": "WP-CLI 2.8.1",
        "stderr": "",
        "exitCode": 0,
        "executionTime": 1200,
        "timestamp": "2024-01-15T14:01:00Z"
      }
    ],
    "evidence": [
      {
        "id": "evidence_uuid",
        "evidenceType": "error_log",
        "signature": "php_fatal_error",
        "content": "[15-Jan-2024 14:00:00] PHP Fatal error...",
        "timestamp": "2024-01-15T14:00:30Z"
      }
    ]
  }
}
```

### Create Manual Incident

```http
POST /api/v1/incidents
Authorization: Bearer jwt_token_here
Content-Type: application/json

{
  "siteId": "site_uuid",
  "triggerType": "manual",
  "priority": "medium",
  "description": "Manual incident for testing"
}
```

### Pause/Resume Incident

```http
POST /api/v1/incidents/{incidentId}/pause
Authorization: Bearer jwt_token_here
```

```http
POST /api/v1/incidents/{incidentId}/resume
Authorization: Bearer jwt_token_here
```

### Escalate Incident

```http
POST /api/v1/incidents/{incidentId}/escalate
Authorization: Bearer jwt_token_here
Content-Type: application/json

{
  "reason": "Unable to resolve automatically",
  "assignee": "support@example.com",
  "priority": "critical"
}
```

## 👥 User Management API

### List Users

```http
GET /api/v1/users
Authorization: Bearer jwt_token_here
```

**Required Role:** Admin or Super Admin

### Create User

```http
POST /api/v1/users
Authorization: Bearer jwt_token_here
Content-Type: application/json

{
  "email": "newuser@example.com",
  "name": "New User",
  "role": "engineer",
  "mfaRequired": true
}
```

### Update User Role

```http
PUT /api/v1/users/{userId}/role
Authorization: Bearer jwt_token_here
Content-Type: application/json

{
  "role": "admin"
}
```

## 📝 Audit Log API

### List Audit Events

```http
GET /api/v1/audit
Authorization: Bearer jwt_token_here
```

**Query Parameters:**
- `userId` (string): Filter by user
- `action` (string): Filter by action type
- `resourceType` (string): Filter by resource type
- `dateFrom` (string): Start date
- `dateTo` (string): End date

**Response:**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "audit_uuid",
        "userId": "user_uuid",
        "user": {
          "email": "admin@example.com"
        },
        "action": "server.create",
        "resourceType": "server",
        "resourceId": "server_uuid",
        "metadata": {
          "serverName": "New Server",
          "hostname": "192.168.1.101"
        },
        "ipAddress": "192.168.1.50",
        "userAgent": "Mozilla/5.0...",
        "timestamp": "2024-01-15T14:30:00Z"
      }
    ]
  }
}
```

## ⚙️ System Configuration API

### Get System Settings

```http
GET /api/v1/settings
Authorization: Bearer jwt_token_here
```

**Required Role:** Admin or Super Admin

### Update Retention Policy

```http
PUT /api/v1/settings/retention
Authorization: Bearer jwt_token_here
Content-Type: application/json

{
  "retentionDays": 5,
  "purgeSchedule": "daily"
}
```

### Manual Data Purge

```http
POST /api/v1/settings/purge
Authorization: Bearer jwt_token_here
Content-Type: application/json

{
  "cutoffDate": "2024-01-10T00:00:00Z",
  "dryRun": false
}
```

## 📧 Email Configuration API

### Get SMTP Configuration

```http
GET /api/v1/auth/settings/smtp
Authorization: Bearer jwt_token_here
```

**Required Role:** Admin or Super Admin

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "smtp_config_uuid",
    "host": "smtp.gmail.com",
    "port": 587,
    "username": "notifications@example.com",
    "fromAddress": "noreply@wp-autohealer.com",
    "fromName": "WP-AutoHealer",
    "useTls": true,
    "isActive": true,
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-15T14:30:00Z"
  }
}
```

**Note:** Password field is never returned in responses for security.

### Update SMTP Configuration

```http
PUT /api/v1/auth/settings/smtp
Authorization: Bearer jwt_token_here
Content-Type: application/json

{
  "host": "smtp.gmail.com",
  "port": 587,
  "username": "notifications@example.com",
  "password": "your_smtp_password",
  "fromAddress": "noreply@wp-autohealer.com",
  "fromName": "WP-AutoHealer",
  "useTls": true,
  "isActive": true
}
```

**Required Role:** Admin or Super Admin

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "smtp_config_uuid",
    "host": "smtp.gmail.com",
    "port": 587,
    "username": "notifications@example.com",
    "fromAddress": "noreply@wp-autohealer.com",
    "fromName": "WP-AutoHealer",
    "useTls": true,
    "isActive": true,
    "updatedAt": "2024-01-15T14:30:00Z"
  }
}
```

**Security Features:**
- Passwords are encrypted at rest using libsodium
- Only users with Admin or Super Admin roles can modify settings
- All configuration changes are logged in the audit trail

### Send Test Email

```http
POST /api/v1/auth/settings/smtp/test
Authorization: Bearer jwt_token_here
Content-Type: application/json

{
  "testEmail": "admin@example.com"
}
```

**Required Role:** Admin or Super Admin

**Response:**
```json
{
  "success": true,
  "data": {
    "sent": true,
    "recipient": "admin@example.com",
    "messageId": "msg_uuid",
    "timestamp": "2024-01-15T14:30:00Z"
  }
}
```

**Test Email Contents:**
- Confirmation that SMTP configuration is working
- Current system information and timestamp
- Links to documentation and support resources

### Email Configuration Validation

The API validates SMTP configuration with the following rules:

- **Host**: Required, must be a valid hostname or IP address
- **Port**: Required, must be between 1-65535
- **Username**: Required for authentication
- **Password**: Required for authentication, encrypted at rest
- **From Address**: Required, must be valid email format
- **From Name**: Optional, defaults to "WP-AutoHealer"
- **Use TLS**: Boolean, defaults to true (recommended)

### Error Responses

#### Invalid Configuration
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid SMTP configuration",
    "details": {
      "field": "port",
      "constraint": "must_be_valid_port",
      "value": 99999
    }
  }
}
```

#### SMTP Connection Failed
```json
{
  "success": false,
  "error": {
    "code": "SMTP_CONNECTION_FAILED",
    "message": "Could not connect to SMTP server",
    "details": {
      "host": "smtp.example.com",
      "port": 587,
      "error": "Connection timeout"
    }
  }
}
```

#### Test Email Failed
```json
{
  "success": false,
  "error": {
    "code": "EMAIL_SEND_FAILED",
    "message": "Failed to send test email",
    "details": {
      "recipient": "admin@example.com",
      "smtpError": "Authentication failed"
    }
  }
}
```

## 📊 Health & Monitoring API

### System Health Check

```http
GET /api/v1/health
```

**Response:**
```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "version": "1.0.0",
    "uptime": 86400,
    "services": {
      "database": "healthy",
      "redis": "healthy",
      "jobQueue": "healthy"
    },
    "metrics": {
      "activeIncidents": 3,
      "queuedJobs": 12,
      "memoryUsage": "45%",
      "cpuUsage": "23%"
    }
  }
}
```

### System Metrics

```http
GET /api/v1/metrics
Authorization: Bearer jwt_token_here
```

**Required Role:** Admin or Super Admin

## 🔧 Error Handling

### HTTP Status Codes

- `200` - Success
- `201` - Created
- `400` - Bad Request
- `401` - Unauthorized
- `403` - Forbidden
- `404` - Not Found
- `409` - Conflict
- `422` - Validation Error
- `429` - Rate Limited
- `500` - Internal Server Error

### Frontend API Client Error Handling

The WP-AutoHealer frontend API client implements robust error handling with the following features:

#### Automatic Retry Logic
- **Network Errors**: Automatically retried with exponential backoff
- **Rate Limiting (429)**: Retried with longer delays (2 seconds base)
- **Server Errors (5xx)**: Retried with standard exponential backoff
- **Maximum Retries**: 3 attempts per request
- **Non-Retryable Errors**: Authentication (401) and client errors (4xx) are not retried

#### Error Response Transformation
All Axios errors are transformed into a consistent `ApiClientError` format:

```typescript
interface ApiClientError {
  statusCode: number;
  code: string;
  message: string;
  details?: any;
  retryable: boolean;
}
```

#### Null Safety Improvements
The client now includes enhanced null safety checks to prevent errors when:
- Network requests fail completely (no response object)
- Axios interceptors receive malformed error objects
- Original request configuration is missing during retry attempts

#### Authentication Error Handling
- **Token Expiry**: Automatic detection and proactive refresh
- **401 Responses**: Immediate token cleanup and redirect to login
- **Multi-location Token Cleanup**: Removes tokens from localStorage, sessionStorage, and cookies

### Error Response Format

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": {
      "field": "email",
      "constraint": "valid_email",
      "value": "invalid-email"
    }
  },
  "meta": {
    "timestamp": "2024-01-15T14:30:00Z",
    "requestId": "req_uuid"
  }
}
```

### Common Error Codes

- `AUTHENTICATION_FAILED` - Invalid credentials
- `AUTHORIZATION_FAILED` - Insufficient permissions
- `VALIDATION_ERROR` - Input validation failed
- `RESOURCE_NOT_FOUND` - Requested resource doesn't exist
- `RATE_LIMIT_EXCEEDED` - Too many requests
- `SERVER_CONNECTION_FAILED` - Cannot connect to server
- `INCIDENT_PROCESSING_ERROR` - Error during incident processing

## 📚 SDK and Examples

### JavaScript/Node.js Example

```javascript
const axios = require('axios');

class WPAutoHealerAPI {
  constructor(baseURL, token) {
    this.client = axios.create({
      baseURL: `${baseURL}/api/v1`,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    // Enhanced error handling with retry logic
    this.setupInterceptors();
    
    // Store token with enhanced persistence (browser only)
    if (typeof window !== 'undefined') {
      this.setToken(token);
    }
  }

  setupInterceptors() {
    // Response interceptor for error handling and retry logic
    this.client.interceptors.response.use(
      (response) => response,
      async (error) => {
        const originalRequest = error.config;
        
        // Ensure originalRequest exists to prevent null reference errors
        if (!originalRequest) {
          return Promise.reject(this.createApiError(error));
        }
        
        // Handle 401 Unauthorized
        if (error.response?.status === 401) {
          this.handleUnauthorized();
          return Promise.reject(this.createApiError(error));
        }
        
        // Handle rate limiting (429) and server errors (5xx) with retry
        if (this.shouldRetryRequest(error) && !originalRequest._retry) {
          originalRequest._retry = true;
          originalRequest._retryCount = (originalRequest._retryCount || 0) + 1;
          
          if (originalRequest._retryCount <= 3) {
            const delay = this.calculateRetryDelay(originalRequest._retryCount, error.response?.status);
            await this.delay(delay);
            return this.client(originalRequest);
          }
        }
        
        return Promise.reject(this.createApiError(error));
      }
    );
  }

  createApiError(error) {
    const isRetryable = !error.response || 
                       error.response.status === 429 || 
                       (error.response.status >= 500 && error.response.status < 600);

    return {
      statusCode: error.response?.status || 500,
      code: error.response?.data?.code || 'NETWORK_ERROR',
      message: error.response?.data?.message || error.message,
      retryable: isRetryable
    };
  }

  shouldRetryRequest(error) {
    if (!error.response) return true; // Network errors
    const status = error.response.status;
    return status === 429 || (status >= 500 && status < 600);
  }

  calculateRetryDelay(retryCount, statusCode) {
    const baseDelay = statusCode === 429 ? 2000 : 1000;
    return baseDelay * Math.pow(2, retryCount - 1);
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  handleUnauthorized() {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('auth_token');
      sessionStorage.removeItem('auth_token');
      document.cookie = 'auth_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
      if (!window.location.pathname.includes('/login')) {
        window.location.href = '/login';
      }
    }
  }

  setToken(token) {
    // Multi-location storage for reliability
    localStorage.setItem('auth_token', token);
    sessionStorage.setItem('auth_token', token);
    
    // Secure cookie for SSR/middleware
    const expires = new Date();
    expires.setTime(expires.getTime() + (7 * 24 * 60 * 60 * 1000)); // 7 days
    document.cookie = `auth_token=${token}; expires=${expires.toUTCString()}; path=/; secure; samesite=strict`;
    
    // Store expiry for validation
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      if (payload.exp) {
        localStorage.setItem('auth_token_expires', payload.exp.toString());
      }
    } catch (e) {
      console.warn('Could not parse token expiry');
    }
  }

  async getServers() {
    const response = await this.client.get('/servers');
    return response.data;
  }

  async createIncident(siteId, priority = 'medium') {
    const response = await this.client.post('/incidents', {
      siteId,
      triggerType: 'manual',
      priority
    });
    return response.data;
  }

  async getIncidentStatus(incidentId) {
    const response = await this.client.get(`/incidents/${incidentId}`);
    return response.data;
  }

  // Email Configuration Methods
  async getSmtpConfig() {
    const response = await this.client.get('/auth/settings/smtp');
    return response.data;
  }

  async updateSmtpConfig(config) {
    const response = await this.client.put('/auth/settings/smtp', config);
    return response.data;
  }

  async sendTestEmail(testEmail) {
    const response = await this.client.post('/auth/settings/smtp/test', { testEmail });
    return response.data;
  }
}

// Usage
const api = new WPAutoHealerAPI('https://your-domain.com', 'your_jwt_token');

// List servers
api.getServers().then(servers => {
  console.log('Servers:', servers.data.items);
});

// Create incident
api.createIncident('site_uuid', 'high').then(incident => {
  console.log('Created incident:', incident.data.id);
});

// Configure email settings
api.updateSmtpConfig({
  host: 'smtp.gmail.com',
  port: 587,
  username: 'notifications@example.com',
  password: 'your_app_password',
  fromAddress: 'noreply@wp-autohealer.com',
  fromName: 'WP-AutoHealer',
  useTls: true,
  isActive: true
}).then(config => {
  console.log('SMTP configured:', config.data.host);
});

// Send test email
api.sendTestEmail('admin@example.com').then(result => {
  console.log('Test email sent:', result.data.sent);
});
```

### Python Example

```python
import requests
import json

class WPAutoHealerAPI:
    def __init__(self, base_url, token):
        self.base_url = f"{base_url}/api/v1"
        self.headers = {
            'Authorization': f'Bearer {token}',
            'Content-Type': 'application/json'
        }
    
    def get_servers(self):
        response = requests.get(f"{self.base_url}/servers", headers=self.headers)
        return response.json()
    
    def create_incident(self, site_id, priority='medium'):
        data = {
            'siteId': site_id,
            'triggerType': 'manual',
            'priority': priority
        }
        response = requests.post(f"{self.base_url}/incidents", 
                               headers=self.headers, 
                               json=data)
        return response.json()
    
    def get_smtp_config(self):
        response = requests.get(f"{self.base_url}/auth/settings/smtp", headers=self.headers)
        return response.json()
    
    def update_smtp_config(self, config):
        response = requests.put(f"{self.base_url}/auth/settings/smtp", 
                              headers=self.headers, 
                              json=config)
        return response.json()
    
    def send_test_email(self, test_email):
        data = {'testEmail': test_email}
        response = requests.post(f"{self.base_url}/auth/settings/smtp/test", 
                               headers=self.headers, 
                               json=data)
        return response.json()

# Usage
api = WPAutoHealerAPI('https://your-domain.com', 'your_jwt_token')

# List servers
servers = api.get_servers()
print(f"Found {len(servers['data']['items'])} servers")

# Create incident
incident = api.create_incident('site_uuid', 'high')
print(f"Created incident: {incident['data']['id']}")

# Configure email settings
smtp_config = {
    'host': 'smtp.gmail.com',
    'port': 587,
    'username': 'notifications@example.com',
    'password': 'your_app_password',
    'fromAddress': 'noreply@wp-autohealer.com',
    'fromName': 'WP-AutoHealer',
    'useTls': True,
    'isActive': True
}
config_result = api.update_smtp_config(smtp_config)
print(f"SMTP configured: {config_result['data']['host']}")

# Send test email
test_result = api.send_test_email('admin@example.com')
print(f"Test email sent: {test_result['data']['sent']}")
```

### cURL Examples

```bash
# Login
curl -X POST https://your-domain.com/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"password","mfaCode":"123456"}'

# List servers
curl -X GET https://your-domain.com/api/v1/servers \
  -H "Authorization: Bearer jwt_token_here"

# Create incident
curl -X POST https://your-domain.com/api/v1/incidents \
  -H "Authorization: Bearer jwt_token_here" \
  -H "Content-Type: application/json" \
  -d '{"siteId":"site_uuid","triggerType":"manual","priority":"high"}'

# Get incident details
curl -X GET https://your-domain.com/api/v1/incidents/incident_uuid \
  -H "Authorization: Bearer jwt_token_here"

# Get SMTP configuration
curl -X GET https://your-domain.com/api/v1/auth/settings/smtp \
  -H "Authorization: Bearer jwt_token_here"

# Update SMTP configuration
curl -X PUT https://your-domain.com/api/v1/auth/settings/smtp \
  -H "Authorization: Bearer jwt_token_here" \
  -H "Content-Type: application/json" \
  -d '{
    "host": "smtp.gmail.com",
    "port": 587,
    "username": "notifications@example.com",
    "password": "your_app_password",
    "fromAddress": "noreply@wp-autohealer.com",
    "fromName": "WP-AutoHealer",
    "useTls": true,
    "isActive": true
  }'

# Send test email
curl -X POST https://your-domain.com/api/v1/auth/settings/smtp/test \
  -H "Authorization: Bearer jwt_token_here" \
  -H "Content-Type: application/json" \
  -d '{"testEmail": "admin@example.com"}'
```

---

## 📞 API Support

For API-related questions or issues:

1. Check this documentation for examples
2. Review error messages and status codes
3. Test with the provided cURL examples
4. Contact API support: api-support@wp-autohealer.com

---

*Last updated: January 2024*