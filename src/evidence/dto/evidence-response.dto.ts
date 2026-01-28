import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Evidence } from '@prisma/client';

export class EvidenceResponseDto {
  @ApiProperty({
    description: 'Unique identifier for the evidence',
    example: '123e4567-e89b-12d3-a456-426614174000'
  })
  id: string;

  @ApiProperty({
    description: 'The incident ID this evidence belongs to',
    example: '123e4567-e89b-12d3-a456-426614174001'
  })
  incidentId: string;

  @ApiProperty({
    description: 'Type of evidence',
    example: 'LOG_FILE'
  })
  evidenceType: string;

  @ApiProperty({
    description: 'Evidence signature for integrity verification',
    example: 'sha256:a1b2c3d4e5f6789...'
  })
  signature: string;

  @ApiProperty({
    description: 'Evidence content (may be truncated for large content)',
    example: 'Log file content or command output...'
  })
  content: string;

  @ApiPropertyOptional({
    description: 'Additional metadata about the evidence',
    example: {
      filePath: '/var/log/apache2/error.log',
      fileSize: 1024,
      lineCount: 50,
      collectionMethod: 'tail'
    }
  })
  metadata?: Record<string, any>;

  @ApiProperty({
    description: 'Timestamp when the evidence was collected',
    example: '2024-01-15T14:30:22Z'
  })
  timestamp: Date;

  @ApiPropertyOptional({
    description: 'Whether the content was truncated due to size limits',
    example: false
  })
  truncated?: boolean;

  @ApiPropertyOptional({
    description: 'Original content size in bytes (if truncated)',
    example: 2048
  })
  originalSize?: number;

  constructor(evidence: Evidence, truncated = false, originalSize?: number) {
    this.id = evidence.id;
    this.incidentId = evidence.incidentId;
    this.evidenceType = evidence.evidenceType;
    this.signature = evidence.signature;
    this.content = evidence.content;
    this.metadata = evidence.metadata as Record<string, any>;
    this.timestamp = evidence.timestamp;
    this.truncated = truncated;
    this.originalSize = originalSize;
  }
}

export class LogCollectionResponseDto {
  @ApiProperty({
    description: 'Whether the log collection was successful',
    example: true
  })
  success: boolean;

  @ApiProperty({
    description: 'Path of the collected log file',
    example: '/var/log/apache2/error.log'
  })
  filePath: string;

  @ApiProperty({
    description: 'Number of lines collected',
    example: 150
  })
  linesCollected: number;

  @ApiProperty({
    description: 'Number of bytes collected',
    example: 8192
  })
  bytesCollected: number;

  @ApiProperty({
    description: 'Evidence signature',
    example: 'sha256:a1b2c3d4e5f6789...'
  })
  signature: string;

  @ApiProperty({
    description: 'Evidence ID in the database',
    example: '123e4567-e89b-12d3-a456-426614174000'
  })
  evidenceId: string;

  @ApiPropertyOptional({
    description: 'File metadata',
    example: {
      originalPath: '/var/log/apache2/error.log',
      fileSize: 10240,
      lastModified: '2024-01-15T14:25:00Z',
      permissions: '-rw-r--r--',
      owner: 'root',
      group: 'root'
    }
  })
  metadata?: Record<string, any>;

  @ApiPropertyOptional({
    description: 'Error message if collection failed',
    example: 'File not found: /var/log/nonexistent.log'
  })
  error?: string;
}

export class CommandCaptureResponseDto {
  @ApiProperty({
    description: 'Whether the command capture was successful',
    example: true
  })
  success: boolean;

  @ApiProperty({
    description: 'The command that was executed',
    example: 'ps aux | grep apache'
  })
  command: string;

  @ApiProperty({
    description: 'Command standard output',
    example: 'root      1234  0.1  0.5  12345  6789 ?        S    14:30   0:00 /usr/sbin/apache2'
  })
  stdout: string;

  @ApiProperty({
    description: 'Command standard error',
    example: ''
  })
  stderr: string;

  @ApiProperty({
    description: 'Command exit code',
    example: 0
  })
  exitCode: number;

  @ApiProperty({
    description: 'Command execution time in milliseconds',
    example: 1250
  })
  executionTime: number;

  @ApiProperty({
    description: 'Evidence signature',
    example: 'sha256:a1b2c3d4e5f6789...'
  })
  signature: string;

  @ApiProperty({
    description: 'Evidence ID in the database',
    example: '123e4567-e89b-12d3-a456-426614174000'
  })
  evidenceId: string;

  @ApiPropertyOptional({
    description: 'Command metadata',
    example: {
      sanitizedCommand: 'ps aux | grep apache',
      workingDirectory: '/var/www/html',
      timeout: 30000,
      user: 'root',
      shell: '/bin/bash'
    }
  })
  metadata?: Record<string, any>;

  @ApiPropertyOptional({
    description: 'Error message if capture failed',
    example: 'Command execution timeout'
  })
  error?: string;
}

export class DiagnosticCollectionResponseDto {
  @ApiProperty({
    description: 'The incident ID the diagnostics were collected for',
    example: '123e4567-e89b-12d3-a456-426614174000'
  })
  incidentId: string;

  @ApiProperty({
    description: 'The site ID the diagnostics were collected for',
    example: '123e4567-e89b-12d3-a456-426614174001'
  })
  siteId: string;

  @ApiProperty({
    description: 'When the collection started',
    example: '2024-01-15T14:30:00Z'
  })
  collectionStartTime: Date;

  @ApiProperty({
    description: 'When the collection completed',
    example: '2024-01-15T14:32:15Z'
  })
  collectionEndTime: Date;

  @ApiProperty({
    description: 'Total number of evidence items collected',
    example: 15
  })
  totalEvidenceItems: number;

  @ApiProperty({
    description: 'Total size of collected data in bytes',
    example: 524288
  })
  totalDataSize: number;

  @ApiProperty({
    description: 'Log file collection results',
    type: [LogCollectionResponseDto]
  })
  logFiles: LogCollectionResponseDto[];

  @ApiProperty({
    description: 'Command output capture results',
    type: [CommandCaptureResponseDto]
  })
  commandOutputs: CommandCaptureResponseDto[];

  @ApiProperty({
    description: 'Evidence IDs for system diagnostics',
    example: ['123e4567-e89b-12d3-a456-426614174002', '123e4567-e89b-12d3-a456-426614174003']
  })
  systemDiagnosticIds: string[];

  @ApiProperty({
    description: 'Evidence IDs for WordPress diagnostics',
    example: ['123e4567-e89b-12d3-a456-426614174004', '123e4567-e89b-12d3-a456-426614174005']
  })
  wordpressDiagnosticIds: string[];

  @ApiProperty({
    description: 'Collection summary and statistics',
    example: {
      successfulCollections: 14,
      failedCollections: 1,
      totalExecutionTime: 135000,
      compressionRatio: 0.65
    }
  })
  summary: Record<string, any>;
}

export class EvidenceSearchResponseDto {
  @ApiProperty({
    description: 'Array of evidence items matching the search criteria',
    type: [EvidenceResponseDto]
  })
  evidence: EvidenceResponseDto[];

  @ApiProperty({
    description: 'Total number of evidence items matching the criteria',
    example: 150
  })
  total: number;

  @ApiProperty({
    description: 'Whether there are more results available',
    example: true
  })
  hasMore: boolean;

  @ApiProperty({
    description: 'Search execution metadata',
    example: {
      executionTime: 45,
      resultCount: 50,
      searchPattern: 'ERROR|FATAL'
    }
  })
  searchMetadata: Record<string, any>;
}