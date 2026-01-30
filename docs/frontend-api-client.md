# Frontend API Client

The WP-AutoHealer frontend uses a robust API client built on Axios that provides comprehensive error handling, automatic retry logic, and enhanced reliability features.

## Key Features

### Enhanced Error Handling

The API client implements sophisticated error handling with the following capabilities:

#### Null Safety Protection
- **Null Request Validation**: Prevents errors when Axios interceptors receive malformed error objects
- **Missing Configuration Handling**: Safely handles cases where the original request configuration is unavailable during retry attempts
- **Graceful Degradation**: Falls back to creating appropriate error responses when request data is incomplete

#### Automatic Retry Logic
- **Network Errors**: Automatically retried with exponential backoff
- **Rate Limiting (429)**: Retried with extended delays (2-second base delay)
- **Server Errors (5xx)**: Retried with standard exponential backoff progression
- **Maximum Attempts**: Limited to 3 retry attempts per request
- **Smart Retry Detection**: Only retries errors that are likely to succeed on subsequent attempts

#### Error Classification
All errors are classified and transformed into a consistent `ApiClientError` format:

```typescript
interface ApiClientError {
  statusCode: number;
  code: string;
  message: string;
  details?: any;
  retryable: boolean;
}
```

### Token Management

#### Multi-Location Persistence
The client stores authentication tokens in multiple locations for maximum reliability:

- **Primary Storage**: `localStorage` for persistent sessions
- **Backup Storage**: `sessionStorage` for session-based fallback
- **SSR Support**: Secure HTTP-only cookies for server-side rendering and middleware access

#### Automatic Token Recovery
- **Cross-Storage Recovery**: Automatically recovers tokens from alternative storage locations
- **Expiry Validation**: Extracts and validates token expiration from JWT payload
- **Proactive Refresh**: Attempts token refresh before expiration (5-minute window)

#### Secure Token Cleanup
- **Multi-Location Cleanup**: Removes tokens from all storage locations on logout/401 errors
- **Cookie Expiration**: Properly expires cookies by setting past expiration dates
- **Automatic Redirect**: Redirects to login page on authentication failures

### Request/Response Interceptors

#### Request Interceptor
- **Token Injection**: Automatically adds Bearer tokens to requests
- **Proactive Refresh**: Attempts token refresh before requests if expiry is imminent
- **Debug Logging**: Comprehensive logging in development mode

#### Response Interceptor
- **Error Transformation**: Converts Axios errors to consistent format
- **Retry Logic**: Implements intelligent retry with exponential backoff
- **Authentication Handling**: Automatic token cleanup and redirect on 401 responses

## Usage Examples

### Basic API Client Usage

```typescript
import { apiClient } from '@/lib/api';

// The client handles all error scenarios automatically
try {
  const servers = await apiClient.getServers();
  console.log('Servers loaded:', servers.servers);
} catch (error) {
  if (error.isAuthenticationError()) {
    // User will be automatically redirected to login
    console.log('Authentication required');
  } else if (error.retryable) {
    // Error was retried automatically but still failed
    console.log('Temporary service issue, please try again later');
  } else {
    // Permanent error that requires user action
    console.log('Error:', error.message);
  }
}
```

### Error Handling Patterns

```typescript
import { ApiClientError } from '@/lib/api';

async function handleApiCall() {
  try {
    const result = await apiClient.createIncident(siteId, 'high');
    return result;
  } catch (error) {
    if (error instanceof ApiClientError) {
      // Structured error handling
      switch (error.code) {
        case 'VALIDATION_ERROR':
          showValidationErrors(error.details);
          break;
        case 'RATE_LIMIT_EXCEEDED':
          showRateLimitMessage();
          break;
        case 'NETWORK_ERROR':
          if (error.retryable) {
            showRetryMessage();
          } else {
            showNetworkErrorMessage();
          }
          break;
        default:
          showGenericError(error.message);
      }
    } else {
      // Unexpected error
      console.error('Unexpected error:', error);
      showGenericError('An unexpected error occurred');
    }
  }
}
```

### Custom Configuration

```typescript
import { ApiClient } from '@/lib/api';

// Create client with custom configuration
const customClient = new ApiClient({
  baseURL: 'https://custom-api.example.com/api/v1',
  timeout: 15000,
  maxRetries: 5,
  retryDelay: 2000,
  enableLogging: true
});
```

## Error Recovery Strategies

### Network Connectivity Issues
- **Automatic Detection**: Identifies network-related errors
- **Progressive Backoff**: Increases delay between retry attempts
- **Circuit Breaking**: Stops retrying after maximum attempts reached

### Authentication Failures
- **Immediate Cleanup**: Clears all stored tokens
- **Automatic Redirect**: Navigates to login page
- **Session Recovery**: Attempts to recover from alternative storage locations

### Rate Limiting
- **Extended Delays**: Uses longer delays for rate limit errors
- **Respect Headers**: Honors rate limit headers when available
- **Graceful Degradation**: Provides user feedback during rate limiting

## Development and Debugging

### Logging Configuration
Enable detailed logging in development:

```typescript
// Set in environment or client configuration
const client = new ApiClient({
  enableLogging: process.env.NODE_ENV === 'development'
});
```

### Debug Information
The client logs comprehensive debug information including:
- Request URLs and methods
- Token availability and expiry status
- Retry attempts and delays
- Error details and classifications
- Storage operations and recovery attempts

## Security Considerations

### Token Storage Security
- **Secure Cookies**: Uses `secure` and `samesite=strict` flags
- **Limited Scope**: Cookies are path-restricted to application root
- **Expiration Management**: Proper cookie expiration handling

### Request Security
- **HTTPS Only**: Enforces secure connections in production
- **Token Validation**: Validates token format and expiry
- **Injection Prevention**: Sanitizes request parameters

### Error Information Disclosure
- **Sensitive Data Redaction**: Prevents sensitive information in error messages
- **Structured Responses**: Consistent error format without internal details
- **Debug Mode Separation**: Detailed logging only in development

## Migration and Compatibility

### Backward Compatibility
- **Existing API Contracts**: Maintains compatibility with existing backend APIs
- **Error Format Consistency**: Preserves expected error response structures
- **Method Signatures**: No breaking changes to public API methods

### Future Enhancements
- **WebSocket Support**: Planned integration with real-time updates
- **Offline Capabilities**: Future support for offline operation
- **Advanced Caching**: Enhanced response caching strategies

---

*This documentation reflects the current implementation as of the latest frontend API client updates.*