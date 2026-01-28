import { Injectable } from '@nestjs/common';

@Injectable()
export class RedactionService {
  private readonly sensitivePatterns = [
    // Password patterns
    /password[=:]\s*[^\s,}]+/gi,
    /pwd[=:]\s*[^\s,}]+/gi,
    /passwd[=:]\s*[^\s,}]+/gi,
    
    // Key patterns
    /key[=:]\s*[^\s,}]+/gi,
    /apikey[=:]\s*[^\s,}]+/gi,
    /api_key[=:]\s*[^\s,}]+/gi,
    /privatekey[=:]\s*[^\s,}]+/gi,
    /private_key[=:]\s*[^\s,}]+/gi,
    
    // Token patterns
    /token[=:]\s*[^\s,}]+/gi,
    /accesstoken[=:]\s*[^\s,}]+/gi,
    /access_token[=:]\s*[^\s,}]+/gi,
    /refreshtoken[=:]\s*[^\s,}]+/gi,
    /refresh_token[=:]\s*[^\s,}]+/gi,
    /bearertoken[=:]\s*[^\s,}]+/gi,
    /bearer_token[=:]\s*[^\s,}]+/gi,
    
    // Secret patterns
    /secret[=:]\s*[^\s,}]+/gi,
    /apisecret[=:]\s*[^\s,}]+/gi,
    /api_secret[=:]\s*[^\s,}]+/gi,
    /jwtsecret[=:]\s*[^\s,}]+/gi,
    /jwt_secret[=:]\s*[^\s,}]+/gi,
    /sessionsecret[=:]\s*[^\s,}]+/gi,
    /session_secret[=:]\s*[^\s,}]+/gi,
    
    // Credential patterns
    /credentials[=:]\s*[^\s,}]+/gi,
    /auth[=:]\s*[^\s,}]+/gi,
    /authorization[=:]\s*[^\s,}]+/gi,
    
    // Database connection strings
    /postgresql:\/\/[^@]+@[^/]+\/[^\s,}]+/gi,
    /mysql:\/\/[^@]+@[^/]+\/[^\s,}]+/gi,
    /mongodb:\/\/[^@]+@[^/]+\/[^\s,}]+/gi,
    /redis:\/\/[^@]*@[^/]+\/[^\s,}]*/gi,
    
    // SSH key patterns
    /-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/gi,
    
    // Common sensitive field names in JSON
    /"(password|pwd|passwd|key|apikey|api_key|privatekey|private_key|token|accesstoken|access_token|refreshtoken|refresh_token|secret|apisecret|api_secret|jwtsecret|jwt_secret|sessionsecret|session_secret|credentials|auth|authorization)"\s*:\s*"[^"]*"/gi,
  ];

  private readonly sensitiveFieldNames = [
    'password',
    'pwd',
    'passwd',
    'key',
    'apikey',
    'api_key',
    'privatekey',
    'private_key',
    'token',
    'accesstoken',
    'access_token',
    'refreshtoken',
    'refresh_token',
    'bearertoken',
    'bearer_token',
    'secret',
    'apisecret',
    'api_secret',
    'jwtsecret',
    'jwt_secret',
    'sessionsecret',
    'session_secret',
    'credentials',
    'auth',
    'authorization',
    'encryptedCredentials',
    'encrypted_credentials',
    'mfaSecret',
    'mfa_secret',
    'hostKeyFingerprint',
    'host_key_fingerprint',
  ];

  /**
   * Redact sensitive information from text
   */
  redactText(text: string): string {
    if (!text || typeof text !== 'string') {
      return text;
    }

    let redactedText = text;

    // Apply all sensitive patterns
    for (const pattern of this.sensitivePatterns) {
      redactedText = redactedText.replace(pattern, (match) => {
        const [key] = match.split(/[=:]/);
        return `${key}=***`;
      });
    }

    return redactedText;
  }

  /**
   * Redact sensitive information from objects
   */
  redactObject<T>(obj: T): T {
    if (!obj || typeof obj !== 'object') {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.redactObject(item)) as T;
    }

    const redactedObj = { ...obj } as any;

    for (const [key, value] of Object.entries(redactedObj)) {
      const lowerKey = key.toLowerCase();

      // Check if the field name is sensitive
      if (this.sensitiveFieldNames.some(sensitiveField => 
        lowerKey.includes(sensitiveField.toLowerCase())
      )) {
        redactedObj[key] = '***';
      } else if (typeof value === 'string') {
        // Redact sensitive patterns in string values
        redactedObj[key] = this.redactText(value);
      } else if (typeof value === 'object' && value !== null) {
        // Recursively redact nested objects
        redactedObj[key] = this.redactObject(value);
      }
    }

    return redactedObj;
  }

  /**
   * Check if a string contains sensitive information
   */
  containsSensitiveInfo(text: string): boolean {
    if (!text || typeof text !== 'string') {
      return false;
    }

    return this.sensitivePatterns.some(pattern => pattern.test(text));
  }

  /**
   * Redact sensitive information from arrays
   */
  redactArray<T>(arr: T[]): T[] {
    if (!Array.isArray(arr)) {
      return arr;
    }

    return arr.map(item => this.redactObject(item));
  }

  /**
   * Redact sensitive information from command strings
   */
  redactCommand(command: string): string {
    if (!command || typeof command !== 'string') {
      return command;
    }

    let redactedCommand = command;

    // Redact common command patterns with sensitive data
    const commandPatterns = [
      // MySQL/PostgreSQL connection strings in commands
      /(-p|--password)[=\s]+[^\s]+/gi,
      /(-u|--user)[=\s]+[^\s:]+:[^\s]+/gi,
      /(MYSQL_PWD|PGPASSWORD)[=\s]+[^\s]+/gi,
      
      // SSH key file paths (keep path structure but redact filename)
      /(-i|--identity)[=\s]+([^\s]+\/)?[^\s/]+\.(pem|key|rsa|ed25519)/gi,
      
      // Environment variables with sensitive data
      /[A-Z_]*(?:PASSWORD|SECRET|KEY|TOKEN)[=\s]+[^\s]+/gi,
    ];

    for (const pattern of commandPatterns) {
      redactedCommand = redactedCommand.replace(pattern, (match) => {
        const parts = match.split(/[=\s]+/);
        if (parts.length >= 2) {
          return `${parts[0]}=***`;
        }
        return '***';
      });
    }

    return redactedCommand;
  }

  /**
   * Redact sensitive information from URLs
   */
  redactUrl(url: string): string {
    if (!url || typeof url !== 'string') {
      return url;
    }

    try {
      // Handle database connection strings and other URLs with credentials
      let redactedUrl = url;

      // Redact passwords in connection strings (user:password@host format)
      redactedUrl = redactedUrl.replace(
        /([\w+]+:\/\/[^:/@]+):([^@]+)@/gi,
        '$1:***@'
      );

      // Redact tokens and sensitive query parameters
      redactedUrl = redactedUrl.replace(
        /([?&])(token|password|key|secret|auth|api_key|access_token|refresh_token)=([^&]*)/gi,
        '$1$2=***'
      );

      return redactedUrl;
    } catch (error) {
      // If URL parsing fails, return the original URL
      return url;
    }
  }
}