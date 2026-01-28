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
        "details": {
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

# Usage
api = WPAutoHealerAPI('https://your-domain.com', 'your_jwt_token')

# List servers
servers = api.get_servers()
print(f"Found {len(servers['data']['items'])} servers")

# Create incident
incident = api.create_incident('site_uuid', 'high')
print(f"Created incident: {incident['data']['id']}")
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