import { Evidence } from '@prisma/client';

export interface EvidenceCollectionConfig {
  maxLogFileSize: number; // bytes
  maxLogLines: number;
  logFilePatterns: string[];
  commandTimeout: number; // milliseconds
  signatureAlgorithm: 'sha256' | 'sha512';
  compressionEnabled: boolean;
  retentionDays: number;
}

export interface LogFileInfo {
  path: string;
  size: number;
  lastModified: Date;
  permissions: string;
  owner: string;
  group: string;
  exists: boolean;
}

export interface LogCollectionResult {
  success: boolean;
  filePath: string;
  linesCollected: number;
  bytesCollected: number;
  signature: string;
  metadata: LogFileMetadata;
  error?: string;
}

export interface LogFileMetadata {
  originalPath: string;
  fileSize: number;
  lastModified: Date;
  permissions: string;
  owner: string;
  group: string;
  encoding: string;
  lineCount: number;
  truncated: boolean;
  collectionMethod: 'tail' | 'head' | 'full' | 'grep';
  filters?: string[];
}

export interface CommandOutputCapture {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  executionTime: number;
  timestamp: Date;
  signature: string;
  metadata: CommandMetadata;
}

export interface CommandMetadata {
  sanitizedCommand: string;
  workingDirectory?: string;
  environment?: Record<string, string>;
  timeout: number;
  user: string;
  shell: string;
  pid?: number;
}

export interface EvidenceSignature {
  algorithm: string;
  hash: string;
  timestamp: Date;
  contentLength: number;
  metadata: Record<string, any>;
}

export interface DiagnosticDataCollection {
  incidentId: string;
  siteId: string;
  serverId: string;
  collectionStartTime: Date;
  collectionEndTime?: Date;
  logFiles: LogCollectionResult[];
  commandOutputs: CommandOutputCapture[];
  systemInfo: SystemDiagnosticInfo;
  wordpressInfo: WordPressDiagnosticInfo;
  totalEvidenceItems: number;
  totalDataSize: number;
  signatures: EvidenceSignature[];
}

export interface SystemDiagnosticInfo {
  hostname: string;
  uptime: string;
  loadAverage: string;
  memoryUsage: string;
  diskUsage: string;
  processCount: number;
  networkConnections: string;
  systemLogs: string[];
  timestamp: Date;
}

export interface WordPressDiagnosticInfo {
  version: string;
  dbVersion: string;
  activeTheme: string;
  activePlugins: string[];
  inactivePlugins: string[];
  wpConfig: WordPressConfigInfo;
  errorLogs: string[];
  debugInfo: Record<string, any>;
  timestamp: Date;
}

export interface WordPressConfigInfo {
  dbHost: string;
  dbName: string;
  dbUser: string;
  tablePrefix: string;
  wpDebug: boolean;
  wpDebugLog: boolean;
  wpDebugDisplay: boolean;
  memoryLimit: string;
  maxExecutionTime: string;
  uploadMaxFilesize: string;
  postMaxSize: string;
}

export interface EvidenceFilter {
  incidentId?: string;
  evidenceType?: string;
  startDate?: Date;
  endDate?: Date;
  signature?: string;
  contentPattern?: string;
  limit?: number;
  offset?: number;
}

export interface EvidenceSearchResult {
  evidence: Evidence[];
  total: number;
  hasMore: boolean;
  searchMetadata: {
    query: EvidenceFilter;
    executionTime: number;
    resultCount: number;
  };
}

export interface EvidenceServiceInterface {
  collectLogFiles(incidentId: string, serverId: string, logPaths: string[]): Promise<LogCollectionResult[]>;
  captureCommandOutput(incidentId: string, serverId: string, command: string): Promise<CommandOutputCapture>;
  generateSignature(content: string, algorithm?: string): Promise<EvidenceSignature>;
  storeEvidence(incidentId: string, evidenceType: string, content: string, metadata?: Record<string, any>): Promise<Evidence>;
  collectSystemDiagnostics(incidentId: string, serverId: string): Promise<SystemDiagnosticInfo>;
  collectWordPressDiagnostics(incidentId: string, siteId: string): Promise<WordPressDiagnosticInfo>;
  performFullDiagnosticCollection(incidentId: string, siteId: string): Promise<DiagnosticDataCollection>;
  searchEvidence(filter: EvidenceFilter): Promise<EvidenceSearchResult>;
  getEvidenceById(id: string): Promise<Evidence | null>;
  deleteEvidence(id: string): Promise<void>;
  analyzeLogPatterns(incidentId: string, pattern: string): Promise<Evidence[]>;
}

export interface LogAnalysisPattern {
  name: string;
  pattern: RegExp;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  category: 'error' | 'warning' | 'info' | 'security' | 'performance';
}

export interface LogAnalysisResult {
  pattern: LogAnalysisPattern;
  matches: LogMatch[];
  totalMatches: number;
  severity: string;
  recommendations: string[];
}

export interface LogMatch {
  line: string;
  lineNumber: number;
  timestamp?: Date;
  context: string[];
  metadata: Record<string, any>;
}

export interface EvidenceCompressionResult {
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
  algorithm: string;
  compressedContent: Buffer;
}

export interface EvidenceValidationResult {
  isValid: boolean;
  signatureMatch: boolean;
  contentIntegrity: boolean;
  metadataValid: boolean;
  errors: string[];
  warnings: string[];
}