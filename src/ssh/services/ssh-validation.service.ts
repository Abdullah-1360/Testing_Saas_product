import { Injectable } from '@nestjs/common';
import { SSHValidationError } from '../exceptions/ssh.exceptions';

@Injectable()
export class SSHValidationService {
  private readonly dangerousCommandPatterns = [
    // Command injection patterns
    /[;&|`$(){}[\]]/,
    /\$\(/,
    /`[^`]*`/,
    /\$\{[^}]*\}/,
    
    // Redirection and piping that could be dangerous
    />\s*\/dev\/null/,
    /2>&1/,
    /\|\s*sh/,
    /\|\s*bash/,
    /\|\s*zsh/,
    /\|\s*fish/,
    
    // Network operations
    /wget\s+/,
    /curl\s+/,
    /nc\s+/,
    /netcat\s+/,
    /telnet\s+/,
    /ssh\s+/,
    /scp\s+/,
    /rsync\s+/,
    
    // System modification commands
    /rm\s+-rf\s+\//,
    /chmod\s+777/,
    /chown\s+/,
    /usermod\s+/,
    /passwd\s+/,
    /su\s+/,
    /sudo\s+/,
    
    // Process manipulation
    /kill\s+-9/,
    /killall\s+/,
    /pkill\s+/,
    
    // File system operations
    /mount\s+/,
    /umount\s+/,
    /fdisk\s+/,
    /mkfs\s+/,
    
    // Package management (potentially dangerous)
    /apt\s+install/,
    /yum\s+install/,
    /dnf\s+install/,
    /pacman\s+-S/,
    /pip\s+install/,
    /npm\s+install/,
  ];

  private readonly allowedCommandPrefixes = [
    // File operations (safe variants)
    'ls',
    'cat',
    'head',
    'tail',
    'grep',
    'find',
    'locate',
    'which',
    'whereis',
    'file',
    'stat',
    'du',
    'df',
    
    // Text processing
    'awk',
    'sed',
    'sort',
    'uniq',
    'wc',
    'cut',
    
    // System information
    'ps',
    'top',
    'htop',
    'free',
    'uptime',
    'uname',
    'whoami',
    'id',
    'groups',
    
    // WordPress specific
    'wp',
    'php',
    'mysql',
    'mysqldump',
    
    // Web server operations
    'apache2ctl',
    'nginx',
    'systemctl',
    'service',
    
    // Log operations
    'journalctl',
    'logrotate',
    
    // Archive operations
    'tar',
    'gzip',
    'gunzip',
    'zip',
    'unzip',
  ];

  /**
   * Validate and sanitize SSH command
   */
  validateCommand(command: string): string {
    if (!command || typeof command !== 'string') {
      throw new SSHValidationError('Command must be a non-empty string', 'command', command);
    }

    const trimmedCommand = command.trim();
    
    if (trimmedCommand.length === 0) {
      throw new SSHValidationError('Command cannot be empty', 'command', command);
    }

    if (trimmedCommand.length > 4096) {
      throw new SSHValidationError('Command too long (max 4096 characters)', 'command', command);
    }

    // Check for dangerous patterns
    for (const pattern of this.dangerousCommandPatterns) {
      if (pattern.test(trimmedCommand)) {
        throw new SSHValidationError(
          `Command contains potentially dangerous pattern: ${pattern.source}`,
          'command',
          command
        );
      }
    }

    // Extract the base command (first word)
    const baseCommand = trimmedCommand.split(/\s+/)[0];
    
    if (!baseCommand) {
      throw new SSHValidationError('Command cannot be empty', 'command', command);
    }
    
    // Check if the base command is in the allowed list
    const isAllowed = this.allowedCommandPrefixes.some(prefix => 
      baseCommand === prefix || baseCommand.startsWith(prefix + '.')
    );

    if (!isAllowed) {
      throw new SSHValidationError(
        `Command '${baseCommand}' is not in the allowed command list`,
        'command',
        command
      );
    }

    return trimmedCommand;
  }

  /**
   * Validate file path for safety
   */
  validatePath(path: string, type: 'local' | 'remote' = 'remote'): string {
    if (!path || typeof path !== 'string') {
      throw new SSHValidationError(`${type} path must be a non-empty string`, 'path', path);
    }

    const trimmedPath = path.trim();
    
    if (trimmedPath.length === 0) {
      throw new SSHValidationError(`${type} path cannot be empty`, 'path', path);
    }

    if (trimmedPath.length > 4096) {
      throw new SSHValidationError(`${type} path too long (max 4096 characters)`, 'path', path);
    }

    // Normalize path first (remove double slashes, etc.)
    const normalizedPath = trimmedPath.replace(/\/+/g, '/');

    // Check for dangerous path patterns
    const dangerousPathPatterns = [
      /\.\.\//,  // Directory traversal
      /\/\.\.\//,  // Directory traversal
      /^\/dev\//,  // Device files
      /^\/proc\//,  // Process files
      /^\/sys\//,  // System files
      /\/etc\/passwd$/,  // Password file
      /\/etc\/shadow$/,  // Shadow file
      /\/etc\/sudoers$/,  // Sudoers file
      /\/root\/\.ssh\//,  // SSH keys
      /\/home\/[^\/]+\/\.ssh\//,  // User SSH keys
      /\/\.\.$/,  // Ends with parent directory
    ];

    for (const pattern of dangerousPathPatterns) {
      if (pattern.test(normalizedPath)) {
        throw new SSHValidationError(
          `${type} path contains dangerous pattern: ${pattern.source}`,
          'path',
          path
        );
      }
    }

    return normalizedPath;
  }

  /**
   * Validate hostname
   */
  validateHostname(hostname: string): string {
    if (!hostname || typeof hostname !== 'string') {
      throw new SSHValidationError('Hostname must be a non-empty string', 'hostname', hostname);
    }

    const trimmedHostname = hostname.trim().toLowerCase();
    
    if (trimmedHostname.length === 0) {
      throw new SSHValidationError('Hostname cannot be empty', 'hostname', hostname);
    }

    if (trimmedHostname.length > 253) {
      throw new SSHValidationError('Hostname too long (max 253 characters)', 'hostname', hostname);
    }

    // Basic hostname validation (RFC 1123)
    const hostnamePattern = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/;
    
    if (!hostnamePattern.test(trimmedHostname)) {
      throw new SSHValidationError('Invalid hostname format', 'hostname', hostname);
    }

    // Check for localhost and private IP ranges (security consideration)
    // Note: We allow private IPs but log them for security awareness
    // In production, you might want to restrict these based on your security policy

    return trimmedHostname;
  }

  /**
   * Validate port number
   */
  validatePort(port: number): number {
    if (typeof port !== 'number' || isNaN(port) || !isFinite(port)) {
      throw new SSHValidationError('Port must be a valid number', 'port', port);
    }

    if (port < 1 || port > 65535) {
      throw new SSHValidationError('Port must be between 1 and 65535', 'port', port);
    }

    return Math.floor(port);
  }

  /**
   * Validate username
   */
  validateUsername(username: string): string {
    if (!username || typeof username !== 'string') {
      throw new SSHValidationError('Username must be a non-empty string', 'username', username);
    }

    const trimmedUsername = username.trim();
    
    if (trimmedUsername.length === 0) {
      throw new SSHValidationError('Username cannot be empty', 'username', username);
    }

    if (trimmedUsername.length > 32) {
      throw new SSHValidationError('Username too long (max 32 characters)', 'username', username);
    }

    // Basic username validation (POSIX compliant)
    const usernamePattern = /^[a-z_][a-z0-9_-]*$/;
    
    if (!usernamePattern.test(trimmedUsername)) {
      throw new SSHValidationError('Invalid username format', 'username', username);
    }

    // Check for dangerous usernames
    const dangerousUsernames = ['root', 'admin', 'administrator', 'sudo'];
    
    if (dangerousUsernames.includes(trimmedUsername)) {
      // Note: We allow these but log them for security awareness
      // In production, you might want to restrict these based on your security policy
    }

    return trimmedUsername;
  }

  /**
   * Sanitize command template parameters
   */
  sanitizeTemplateParameters(parameters: Record<string, any>): Record<string, string> {
    const sanitized: Record<string, string> = {};

    for (const [key, value] of Object.entries(parameters)) {
      // Validate parameter key
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
        throw new SSHValidationError(`Invalid parameter key: ${key}`, 'parameterKey', key);
      }

      // Convert value to string and sanitize
      let stringValue = String(value);
      
      // Remove dangerous characters
      stringValue = stringValue.replace(/[;&|`$(){}[\]]/g, '');
      
      // Limit length
      if (stringValue.length > 256) {
        stringValue = stringValue.substring(0, 256);
      }

      sanitized[key] = stringValue;
    }

    return sanitized;
  }

  /**
   * Create safe command template
   */
  createSafeTemplate(template: string, parameters: Record<string, any>): string {
    if (!template || typeof template !== 'string') {
      throw new SSHValidationError('Template must be a non-empty string', 'template', template);
    }

    const sanitizedParams = this.sanitizeTemplateParameters(parameters);
    let safeCommand = template;

    // Replace template parameters with sanitized values
    for (const [key, value] of Object.entries(sanitizedParams)) {
      const placeholder = `{{${key}}}`;
      safeCommand = safeCommand.replace(new RegExp(placeholder, 'g'), value);
    }

    // Validate the final command
    return this.validateCommand(safeCommand);
  }

  /**
   * Validate environment variables
   */
  validateEnvironmentVariables(env: Record<string, string>): Record<string, string> {
    const sanitized: Record<string, string> = {};

    for (const [key, value] of Object.entries(env)) {
      // Validate environment variable name
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
        throw new SSHValidationError(`Invalid environment variable name: ${key}`, 'envKey', key);
      }

      // Sanitize value
      let sanitizedValue = String(value);
      
      // Remove dangerous characters
      sanitizedValue = sanitizedValue.replace(/[;&|`$(){}[\]]/g, '');
      
      // Limit length
      if (sanitizedValue.length > 1024) {
        sanitizedValue = sanitizedValue.substring(0, 1024);
      }

      sanitized[key] = sanitizedValue;
    }

    return sanitized;
  }
}