import { ConnectConfig } from 'ssh2';

export interface SSHConnectionConfig {
  hostname: string;
  port: number;
  username: string;
  authType: 'key' | 'password';
  privateKey?: string;
  password?: string;
  hostKeyFingerprint?: string;
  strictHostKeyChecking: boolean;
  connectionTimeout?: number;
  keepaliveInterval?: number;
}

export interface SSHConnection {
  id: string;
  config: SSHConnectionConfig;
  connection: any; // ssh2.Client
  isConnected: boolean;
  lastUsed: Date;
  createdAt: Date;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  executionTime: number;
  timestamp: Date;
  command: string;
}

export interface FileTransferResult {
  success: boolean;
  bytesTransferred: number;
  executionTime: number;
  timestamp: Date;
}

export interface SSHConnectionPool {
  getConnection(serverId: string): Promise<SSHConnection>;
  releaseConnection(connectionId: string): Promise<void>;
  closeConnection(connectionId: string): Promise<void>;
  closeAllConnections(): Promise<void>;
  getActiveConnections(): SSHConnection[];
  cleanupIdleConnections(): Promise<void>;
}

export interface CommandTemplate {
  template: string;
  parameters: Record<string, any>;
  sanitized: boolean;
}

export interface SSHServiceInterface {
  connect(serverId: string): Promise<SSHConnection>;
  disconnect(connectionId: string): Promise<void>;
  executeCommand(connectionId: string, command: string, options?: CommandExecutionOptions): Promise<CommandResult>;
  executeTemplatedCommand(connectionId: string, template: CommandTemplate): Promise<CommandResult>;
  uploadFile(connectionId: string, localPath: string, remotePath: string): Promise<FileTransferResult>;
  downloadFile(connectionId: string, remotePath: string, localPath: string): Promise<FileTransferResult>;
  validateConnection(connectionId: string): Promise<boolean>;
  testConnection(config: SSHConnectionConfig): Promise<boolean>;
}

export interface CommandExecutionOptions {
  timeout?: number;
  cwd?: string;
  env?: Record<string, string>;
  pty?: boolean;
  sanitizeOutput?: boolean;
}

export interface SSHError extends Error {
  code: string;
  hostname?: string;
  port?: number;
  details?: any;
}

export interface HostKeyVerificationResult {
  verified: boolean;
  fingerprint: string;
  algorithm: string;
  reason?: string;
}