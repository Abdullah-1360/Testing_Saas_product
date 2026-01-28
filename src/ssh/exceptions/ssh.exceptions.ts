export class SSHConnectionError extends Error {
  public readonly hostname?: string | undefined;
  public readonly port?: number | undefined;
  public override readonly cause?: Error | undefined;

  constructor(
    message: string,
    hostname?: string,
    port?: number,
    cause?: Error
  ) {
    super(message);
    this.name = 'SSHConnectionError';
    this.hostname = hostname;
    this.port = port;
    this.cause = cause;
  }
}

export class SSHAuthenticationError extends Error {
  public readonly hostname?: string | undefined;
  public readonly username?: string | undefined;

  constructor(
    message: string,
    hostname?: string,
    username?: string
  ) {
    super(message);
    this.name = 'SSHAuthenticationError';
    this.hostname = hostname;
    this.username = username;
  }
}

export class SSHCommandExecutionError extends Error {
  public readonly command?: string | undefined;
  public readonly exitCode?: number | undefined;
  public readonly stderr?: string | undefined;

  constructor(
    message: string,
    command?: string,
    exitCode?: number,
    stderr?: string
  ) {
    super(message);
    this.name = 'SSHCommandExecutionError';
    this.command = command;
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

export class SSHHostKeyVerificationError extends Error {
  public readonly hostname?: string | undefined;
  public readonly expectedFingerprint?: string | undefined;
  public readonly actualFingerprint?: string | undefined;

  constructor(
    message: string,
    hostname?: string,
    expectedFingerprint?: string,
    actualFingerprint?: string
  ) {
    super(message);
    this.name = 'SSHHostKeyVerificationError';
    this.hostname = hostname;
    this.expectedFingerprint = expectedFingerprint;
    this.actualFingerprint = actualFingerprint;
  }
}

export class SSHFileTransferError extends Error {
  public readonly localPath?: string | undefined;
  public readonly remotePath?: string | undefined;

  constructor(
    message: string,
    localPath?: string,
    remotePath?: string
  ) {
    super(message);
    this.name = 'SSHFileTransferError';
    this.localPath = localPath;
    this.remotePath = remotePath;
  }
}

export class SSHValidationError extends Error {
  public readonly field?: string | undefined;
  public readonly value?: any;

  constructor(
    message: string,
    field?: string,
    value?: any
  ) {
    super(message);
    this.name = 'SSHValidationError';
    this.field = field;
    this.value = value;
  }
}

export class SSHConnectionPoolError extends Error {
  public readonly poolSize?: number | undefined;
  public readonly activeConnections?: number | undefined;

  constructor(
    message: string,
    poolSize?: number,
    activeConnections?: number
  ) {
    super(message);
    this.name = 'SSHConnectionPoolError';
    this.poolSize = poolSize;
    this.activeConnections = activeConnections;
  }
}