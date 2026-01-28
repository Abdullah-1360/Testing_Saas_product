import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { SSHService } from '../../ssh/services/ssh.service';
import { RedactionService } from '../../common/services/redaction.service';
import { Evidence } from '@prisma/client';
import { 
  EvidenceServiceInterface,
  LogCollectionResult,
  CommandOutputCapture,
  EvidenceSignature,
  SystemDiagnosticInfo,
  WordPressDiagnosticInfo,
  DiagnosticDataCollection,
  EvidenceFilter,
  EvidenceSearchResult,
  LogFileInfo,
  LogFileMetadata,
  CommandMetadata,
  EvidenceCollectionConfig
} from '../interfaces/evidence.interface';
import { EvidenceType } from '../dto/create-evidence.dto';
import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';
import * as zlib from 'zlib';
import { promisify } from 'util';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

@Injectable()
export class EvidenceService implements EvidenceServiceInterface {
  private readonly logger = new Logger(EvidenceService.name);
  
  private readonly defaultConfig: EvidenceCollectionConfig = {
    maxLogFileSize: 10 * 1024 * 1024, // 10MB
    maxLogLines: 1000,
    logFilePatterns: [
      '/var/log/apache2/error.log',
      '/var/log/nginx/error.log',
      '/var/log/php*/error.log',
      '/var/log/mysql/error.log',
      '/var/log/syslog',
      '/var/log/auth.log'
    ],
    commandTimeout: 30000,
    signatureAlgorithm: 'sha256',
    compressionEnabled: true,
    retentionDays: 3
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly sshService: SSHService,
    private readonly redactionService: RedactionService
  ) {}

  /**
   * Collect log files from a server
   * Validates: Requirements 2.1, 2.2
   */
  async collectLogFiles(
    incidentId: string, 
    serverId: string, 
    logPaths: string[]
  ): Promise<LogCollectionResult[]> {
    this.logger.log(`Starting log collection for incident ${incidentId} from server ${serverId}`);
    
    try {
      // Verify incident exists
      await this.verifyIncidentExists(incidentId);
      
      // Connect to server
      const connection = await this.sshService.connect(serverId);
      
      const results: LogCollectionResult[] = [];
      
      for (const logPath of logPaths) {
        try {
          const result = await this.collectSingleLogFile(
            incidentId, 
            connection.id, 
            logPath
          );
          results.push(result);
        } catch (error) {
          this.logger.error(`Failed to collect log file ${logPath}:`, error);
          results.push({
            success: false,
            filePath: logPath,
            linesCollected: 0,
            bytesCollected: 0,
            signature: '',
            metadata: {} as LogFileMetadata,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }
      
      // Disconnect from server
      await this.sshService.disconnect(connection.id);
      
      this.logger.log(`Completed log collection for incident ${incidentId}. Collected ${results.filter(r => r.success).length}/${results.length} files`);
      
      return results;
    } catch (error) {
      this.logger.error(`Log collection failed for incident ${incidentId}:`, error);
      throw error;
    }
  }

  /**
   * Capture command output from a server
   * Validates: Requirements 2.1, 2.2
   */
  async captureCommandOutput(
    incidentId: string, 
    serverId: string, 
    command: string
  ): Promise<CommandOutputCapture> {
    this.logger.log(`Capturing command output for incident ${incidentId}: ${this.redactionService.redactCommand(command)}`);
    
    try {
      // Verify incident exists
      await this.verifyIncidentExists(incidentId);
      
      // Connect to server
      const connection = await this.sshService.connect(serverId);
      
      // Execute command and capture output
      const result = await this.sshService.executeCommand(connection.id, command, {
        timeout: this.defaultConfig.commandTimeout,
        sanitizeOutput: true
      });
      
      // Create command metadata
      const metadata: CommandMetadata = {
        sanitizedCommand: this.redactionService.redactCommand(command),
        timeout: this.defaultConfig.commandTimeout,
        user: 'root', // This should be determined from the SSH connection
        shell: '/bin/bash'
      };
      
      // Generate signature for the output
      const outputContent = JSON.stringify({
        command: this.redactionService.redactCommand(command),
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        executionTime: result.executionTime
      });
      
      const signature = await this.generateSignature(outputContent);
      
      // Store as evidence
      await this.storeEvidence(
        incidentId,
        EvidenceType.COMMAND_OUTPUT,
        outputContent,
        {
          ...metadata,
          originalCommand: this.redactionService.redactCommand(command),
          captureTime: new Date().toISOString()
        }
      );
      
      // Disconnect from server
      await this.sshService.disconnect(connection.id);
      
      const capture: CommandOutputCapture = {
        command: this.redactionService.redactCommand(command),
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        executionTime: result.executionTime,
        timestamp: new Date(),
        signature: signature.hash,
        metadata
      };
      
      this.logger.log(`Successfully captured command output for incident ${incidentId}`);
      
      return capture;
    } catch (error) {
      this.logger.error(`Command capture failed for incident ${incidentId}:`, error);
      throw error;
    }
  }

  /**
   * Generate cryptographic signature for evidence content
   * Validates: Requirements 2.1, 2.2
   */
  async generateSignature(
    content: string, 
    algorithm: string = this.defaultConfig.signatureAlgorithm
  ): Promise<EvidenceSignature> {
    try {
      const hash = createHash(algorithm);
      hash.update(content, 'utf8');
      const hashValue = hash.digest('hex');
      
      return {
        algorithm,
        hash: `${algorithm}:${hashValue}`,
        timestamp: new Date(),
        contentLength: Buffer.byteLength(content, 'utf8'),
        metadata: {
          encoding: 'utf8',
          generatedBy: 'wp-autohealer-evidence-service'
        }
      };
    } catch (error) {
      this.logger.error('Failed to generate evidence signature:', error);
      throw new BadRequestException('Failed to generate evidence signature');
    }
  }

  /**
   * Store evidence in the database
   * Validates: Requirements 2.1, 2.2, 2.4, 2.5
   */
  async storeEvidence(
    incidentId: string,
    evidenceType: string,
    content: string,
    metadata?: Record<string, any>
  ): Promise<Evidence> {
    try {
      // Generate signature if not provided
      const signature = await this.generateSignature(content);
      
      // Compress content if enabled and content is large
      let finalContent = content;
      const finalMetadata: Record<string, any> = { ...metadata };
      
      if (this.defaultConfig.compressionEnabled && content.length > 1024) {
        try {
          const compressed = await gzip(Buffer.from(content, 'utf8'));
          finalContent = compressed.toString('base64');
          finalMetadata['compressed'] = true;
          finalMetadata['originalSize'] = content.length;
          finalMetadata['compressedSize'] = compressed.length;
          finalMetadata['compressionRatio'] = compressed.length / content.length;
        } catch (compressionError) {
          this.logger.warn('Failed to compress evidence content, storing uncompressed:', compressionError);
          finalMetadata['compressed'] = false;
        }
      } else {
        finalMetadata['compressed'] = false;
      }
      
      // Add collection metadata
      finalMetadata['collectionTime'] = new Date().toISOString();
      finalMetadata['collectionId'] = uuidv4();
      finalMetadata['signatureAlgorithm'] = signature.algorithm;
      
      // Store in database
      const evidence = await this.prisma.evidence.create({
        data: {
          incidentId,
          evidenceType,
          signature: signature.hash,
          content: finalContent,
          metadata: finalMetadata
        }
      });
      
      this.logger.debug(`Stored evidence ${evidence.id} for incident ${incidentId}`);
      
      return evidence;
    } catch (error) {
      this.logger.error(`Failed to store evidence for incident ${incidentId}:`, error);
      throw error;
    }
  }

  /**
   * Collect system diagnostic information
   * Validates: Requirements 2.1, 2.2
   */
  async collectSystemDiagnostics(
    incidentId: string, 
    serverId: string
  ): Promise<SystemDiagnosticInfo> {
    this.logger.log(`Collecting system diagnostics for incident ${incidentId}`);
    
    try {
      const connection = await this.sshService.connect(serverId);
      
      // Collect various system information
      const commands = {
        hostname: 'hostname',
        uptime: 'uptime',
        loadAverage: 'cat /proc/loadavg',
        memoryUsage: 'free -m',
        diskUsage: 'df -h',
        processCount: 'ps aux | wc -l',
        networkConnections: 'netstat -tulpn | head -20'
      };
      
      const systemInfo: Partial<SystemDiagnosticInfo> = {
        timestamp: new Date()
      };
      
      for (const [key, command] of Object.entries(commands)) {
        try {
          const result = await this.sshService.executeCommand(connection.id, command);
          (systemInfo as any)[key] = result.stdout.trim();
        } catch (error) {
          this.logger.warn(`Failed to collect ${key}:`, error);
          (systemInfo as any)[key] = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
      }
      
      // Collect system log paths
      try {
        const logPathsResult = await this.sshService.executeCommand(
          connection.id, 
          'find /var/log -name "*.log" -type f | head -10'
        );
        systemInfo.systemLogs = logPathsResult.stdout.trim().split('\n').filter(path => path.length > 0);
      } catch (error) {
        this.logger.warn('Failed to collect system log paths:', error);
        systemInfo.systemLogs = [];
      }
      
      await this.sshService.disconnect(connection.id);
      
      // Store as evidence
      await this.storeEvidence(
        incidentId,
        EvidenceType.SYSTEM_INFO,
        JSON.stringify(systemInfo, null, 2),
        {
          collectionType: 'system_diagnostics',
          serverId,
          commandsExecuted: Object.keys(commands).length
        }
      );
      
      this.logger.log(`Successfully collected system diagnostics for incident ${incidentId}`);
      
      return systemInfo as SystemDiagnosticInfo;
    } catch (error) {
      this.logger.error(`System diagnostics collection failed for incident ${incidentId}:`, error);
      throw error;
    }
  }

  /**
   * Collect WordPress diagnostic information
   * Validates: Requirements 2.1, 2.2
   */
  async collectWordPressDiagnostics(
    incidentId: string, 
    siteId: string
  ): Promise<WordPressDiagnosticInfo> {
    this.logger.log(`Collecting WordPress diagnostics for incident ${incidentId}`);
    
    try {
      // Get site information
      const site = await this.prisma.site.findUnique({
        where: { id: siteId },
        include: { server: true }
      });
      
      if (!site) {
        throw new NotFoundException(`Site with ID ${siteId} not found`);
      }
      
      const connection = await this.sshService.connect(site.serverId);
      
      const wpPath = site.wordpressPath;
      const wpInfo: Partial<WordPressDiagnosticInfo> = {
        timestamp: new Date(),
        errorLogs: [],
        activePlugins: [],
        inactivePlugins: [],
        debugInfo: {}
      };
      
      // Get WordPress version
      try {
        const versionResult = await this.sshService.executeCommand(
          connection.id,
          `grep "wp_version =" ${wpPath}/wp-includes/version.php | cut -d"'" -f2`
        );
        wpInfo.version = versionResult.stdout.trim();
      } catch (error) {
        wpInfo.version = 'Unknown';
      }
      
      // Get database version from wp-config.php
      try {
        const dbResult = await this.sshService.executeCommand(
          connection.id,
          `grep -E "DB_(HOST|NAME|USER)" ${wpPath}/wp-config.php`
        );
        const dbConfig = dbResult.stdout.trim();
        if (wpInfo.debugInfo) {
          wpInfo.debugInfo['dbConfig'] = dbConfig;
        }
      } catch (error) {
        if (wpInfo.debugInfo) {
          wpInfo.debugInfo['dbConfig'] = 'Unable to read wp-config.php';
        }
      }
      
      // Get active theme
      try {
        const themeResult = await this.sshService.executeCommand(
          connection.id,
          `ls -la ${wpPath}/wp-content/themes/ | grep "^l" | head -1`
        );
        wpInfo.activeTheme = themeResult.stdout.trim() || 'Unknown';
      } catch (error) {
        wpInfo.activeTheme = 'Unknown';
      }
      
      // Get plugins
      try {
        const pluginsResult = await this.sshService.executeCommand(
          connection.id,
          `ls ${wpPath}/wp-content/plugins/`
        );
        wpInfo.activePlugins = pluginsResult.stdout.trim().split('\n').filter(p => p.length > 0);
      } catch (error) {
        wpInfo.activePlugins = [];
      }
      
      // Check for WordPress error logs
      const errorLogPaths = [
        `${wpPath}/wp-content/debug.log`,
        `${wpPath}/error_log`,
        '/var/log/php_errors.log'
      ];
      
      for (const logPath of errorLogPaths) {
        try {
          const logResult = await this.sshService.executeCommand(
            connection.id,
            `tail -50 ${logPath} 2>/dev/null || echo "Log not found"`
          );
          if (!logResult.stdout.includes('Log not found')) {
            wpInfo.errorLogs!.push(logPath);
          }
        } catch (error) {
          // Log doesn't exist or can't be read
        }
      }
      
      // Get wp-config.php debug settings
      try {
        const debugResult = await this.sshService.executeCommand(
          connection.id,
          `grep -E "WP_DEBUG|WP_DEBUG_LOG|WP_DEBUG_DISPLAY" ${wpPath}/wp-config.php`
        );
        if (wpInfo.debugInfo) {
          wpInfo.debugInfo['debugSettings'] = debugResult.stdout.trim();
        }
      } catch (error) {
        if (wpInfo.debugInfo) {
          wpInfo.debugInfo['debugSettings'] = 'Unable to read debug settings';
        }
      }
      
      await this.sshService.disconnect(connection.id);
      
      // Store as evidence
      await this.storeEvidence(
        incidentId,
        EvidenceType.WORDPRESS_INFO,
        JSON.stringify(wpInfo, null, 2),
        {
          collectionType: 'wordpress_diagnostics',
          siteId,
          wordpressPath: wpPath,
          domain: site.domain
        }
      );
      
      this.logger.log(`Successfully collected WordPress diagnostics for incident ${incidentId}`);
      
      return wpInfo as WordPressDiagnosticInfo;
    } catch (error) {
      this.logger.error(`WordPress diagnostics collection failed for incident ${incidentId}:`, error);
      throw error;
    }
  }

  /**
   * Perform comprehensive diagnostic data collection
   * Validates: Requirements 2.1, 2.2
   */
  async performFullDiagnosticCollection(
    incidentId: string, 
    siteId: string
  ): Promise<DiagnosticDataCollection> {
    this.logger.log(`Starting full diagnostic collection for incident ${incidentId}`);
    
    const collectionStartTime = new Date();
    
    try {
      // Get site information
      const site = await this.prisma.site.findUnique({
        where: { id: siteId },
        include: { server: true }
      });
      
      if (!site) {
        throw new NotFoundException(`Site with ID ${siteId} not found`);
      }
      
      const collection: Partial<DiagnosticDataCollection> = {
        incidentId,
        siteId,
        serverId: site.serverId,
        collectionStartTime,
        logFiles: [],
        commandOutputs: [],
        signatures: [],
        totalEvidenceItems: 0,
        totalDataSize: 0
      };
      
      // Collect system diagnostics
      try {
        collection.systemInfo = await this.collectSystemDiagnostics(incidentId, site.serverId);
      } catch (error) {
        this.logger.error('Failed to collect system diagnostics:', error);
      }
      
      // Collect WordPress diagnostics
      try {
        collection.wordpressInfo = await this.collectWordPressDiagnostics(incidentId, siteId);
      } catch (error) {
        this.logger.error('Failed to collect WordPress diagnostics:', error);
      }
      
      // Collect log files
      try {
        const logPaths = this.getStandardLogPaths(site.server.controlPanel || undefined);
        collection.logFiles = await this.collectLogFiles(incidentId, site.serverId, logPaths);
      } catch (error) {
        this.logger.error('Failed to collect log files:', error);
        collection.logFiles = [];
      }
      
      // Execute diagnostic commands
      const diagnosticCommands = [
        'ps aux | head -20',
        'netstat -tulpn | head -10',
        'df -h',
        'free -m',
        'top -bn1 | head -20'
      ];
      
      collection.commandOutputs = [];
      for (const command of diagnosticCommands) {
        try {
          const output = await this.captureCommandOutput(incidentId, site.serverId, command);
          collection.commandOutputs!.push(output);
        } catch (error) {
          this.logger.error(`Failed to execute diagnostic command ${command}:`, error);
        }
      }
      
      collection.collectionEndTime = new Date();
      
      // Calculate totals
      collection.totalEvidenceItems = (collection.logFiles?.length || 0) + 
                                     (collection.commandOutputs?.length || 0) + 
                                     (collection.systemInfo ? 1 : 0) + 
                                     (collection.wordpressInfo ? 1 : 0);
      
      collection.totalDataSize = collection.logFiles?.reduce((sum, log) => sum + log.bytesCollected, 0) || 0;
      
      this.logger.log(`Completed full diagnostic collection for incident ${incidentId}. Collected ${collection.totalEvidenceItems} items`);
      
      return collection as DiagnosticDataCollection;
    } catch (error) {
      this.logger.error(`Full diagnostic collection failed for incident ${incidentId}:`, error);
      throw error;
    }
  }

  /**
   * Search evidence with filtering
   * Validates: Requirements 2.1, 2.2
   */
  async searchEvidence(filter: EvidenceFilter): Promise<EvidenceSearchResult> {
    try {
      const startTime = Date.now();
      
      const where: any = {};
      if (filter.incidentId) where.incidentId = filter.incidentId;
      if (filter.evidenceType) where.evidenceType = filter.evidenceType;
      if (filter.signature) where.signature = { contains: filter.signature };
      if (filter.startDate || filter.endDate) {
        where.timestamp = {};
        if (filter.startDate) where.timestamp.gte = filter.startDate;
        if (filter.endDate) where.timestamp.lte = filter.endDate;
      }
      if (filter.contentPattern) {
        where.content = { contains: filter.contentPattern };
      }
      
      const [evidence, total] = await Promise.all([
        this.prisma.evidence.findMany({
          where,
          orderBy: { timestamp: 'desc' },
          take: filter.limit || 50,
          skip: filter.offset || 0
        }),
        this.prisma.evidence.count({ where })
      ]);
      
      const executionTime = Date.now() - startTime;
      
      return {
        evidence,
        total,
        hasMore: (filter.offset || 0) + evidence.length < total,
        searchMetadata: {
          query: filter,
          executionTime,
          resultCount: evidence.length
        }
      };
    } catch (error) {
      this.logger.error('Evidence search failed:', error);
      throw error;
    }
  }

  /**
   * Get evidence by ID
   */
  async getEvidenceById(id: string): Promise<Evidence | null> {
    try {
      const evidence = await this.prisma.evidence.findUnique({
        where: { id }
      });
      
      if (!evidence) {
        return null;
      }
      
      // Decompress content if it was compressed
      if (evidence.metadata && (evidence.metadata as any)['compressed']) {
        try {
          const decompressed = await gunzip(Buffer.from(evidence.content, 'base64'));
          evidence.content = decompressed.toString('utf8');
        } catch (error) {
          this.logger.warn(`Failed to decompress evidence ${id}:`, error);
        }
      }
      
      return evidence;
    } catch (error) {
      this.logger.error(`Failed to get evidence ${id}:`, error);
      throw error;
    }
  }

  /**
   * Delete evidence
   */
  async deleteEvidence(id: string): Promise<void> {
    try {
      await this.prisma.evidence.delete({
        where: { id }
      });
      
      this.logger.log(`Deleted evidence ${id}`);
    } catch (error) {
      this.logger.error(`Failed to delete evidence ${id}:`, error);
      throw error;
    }
  }

  /**
   * Analyze log patterns in evidence
   */
  async analyzeLogPatterns(incidentId: string, pattern: string): Promise<Evidence[]> {
    try {
      const evidence = await this.prisma.evidence.findMany({
        where: {
          incidentId,
          evidenceType: { in: ['LOG_FILE', 'ERROR_LOG', 'ACCESS_LOG'] },
          content: { contains: pattern }
        },
        orderBy: { timestamp: 'desc' }
      });
      
      return evidence;
    } catch (error) {
      this.logger.error(`Log pattern analysis failed for incident ${incidentId}:`, error);
      throw error;
    }
  }

  // Private helper methods

  private async verifyIncidentExists(incidentId: string): Promise<void> {
    const incident = await this.prisma.incident.findUnique({
      where: { id: incidentId }
    });
    
    if (!incident) {
      throw new NotFoundException(`Incident with ID ${incidentId} not found`);
    }
  }

  private async collectSingleLogFile(
    incidentId: string,
    connectionId: string,
    logPath: string
  ): Promise<LogCollectionResult> {
    // Get file info first
    const fileInfo = await this.getLogFileInfo(connectionId, logPath);
    
    if (!fileInfo.exists) {
      throw new Error(`Log file does not exist: ${logPath}`);
    }
    
    // Determine collection method based on file size
    let collectionCommand: string;
    let collectionMethod: string;
    
    if (fileInfo.size > this.defaultConfig.maxLogFileSize) {
      collectionCommand = `tail -n ${this.defaultConfig.maxLogLines} "${logPath}"`;
      collectionMethod = 'tail';
    } else {
      collectionCommand = `cat "${logPath}"`;
      collectionMethod = 'full';
    }
    
    // Execute collection command
    const result = await this.sshService.executeCommand(connectionId, collectionCommand);
    
    if (result.exitCode !== 0) {
      throw new Error(`Failed to collect log file: ${result.stderr}`);
    }
    
    const content = result.stdout;
    const lines = content.split('\n').filter(line => line.trim().length > 0);
    
    // Generate signature
    const signature = await this.generateSignature(content);
    
    // Create metadata
    const metadata: LogFileMetadata = {
      originalPath: logPath,
      fileSize: fileInfo.size,
      lastModified: fileInfo.lastModified,
      permissions: fileInfo.permissions,
      owner: fileInfo.owner,
      group: fileInfo.group,
      encoding: 'utf8',
      lineCount: lines.length,
      truncated: collectionMethod === 'tail',
      collectionMethod: collectionMethod as any,
      filters: []
    };
    
    // Store as evidence
    await this.storeEvidence(
      incidentId,
      EvidenceType.LOG_FILE,
      content,
      metadata
    );
    
    return {
      success: true,
      filePath: logPath,
      linesCollected: lines.length,
      bytesCollected: Buffer.byteLength(content, 'utf8'),
      signature: signature.hash,
      metadata
    };
  }

  private async getLogFileInfo(connectionId: string, filePath: string): Promise<LogFileInfo> {
    try {
      const statResult = await this.sshService.executeCommand(
        connectionId,
        `stat -c "%s %Y %A %U %G" "${filePath}" 2>/dev/null || echo "NOT_FOUND"`
      );
      
      if (statResult.stdout.trim() === 'NOT_FOUND') {
        return {
          path: filePath,
          size: 0,
          lastModified: new Date(0),
          permissions: '',
          owner: '',
          group: '',
          exists: false
        };
      }
      
      const parts = statResult.stdout.trim().split(' ');
      const [size, mtime, permissions, owner, group] = parts;
      
      return {
        path: filePath,
        size: parseInt(size || '0', 10),
        lastModified: new Date(parseInt(mtime || '0', 10) * 1000),
        permissions: permissions || '',
        owner: owner || '',
        group: group || '',
        exists: true
      };
    } catch (error) {
      return {
        path: filePath,
        size: 0,
        lastModified: new Date(0),
        permissions: '',
        owner: '',
        group: '',
        exists: false
      };
    }
  }

  private getStandardLogPaths(controlPanel?: string): string[] {
    const basePaths = [
      '/var/log/syslog',
      '/var/log/auth.log',
      '/var/log/kern.log'
    ];
    
    // Add web server logs
    basePaths.push(
      '/var/log/apache2/error.log',
      '/var/log/apache2/access.log',
      '/var/log/nginx/error.log',
      '/var/log/nginx/access.log'
    );
    
    // Add PHP logs
    basePaths.push(
      '/var/log/php_errors.log',
      '/var/log/php/error.log',
      '/var/log/php7.4/error.log',
      '/var/log/php8.0/error.log',
      '/var/log/php8.1/error.log',
      '/var/log/php8.2/error.log'
    );
    
    // Add database logs
    basePaths.push(
      '/var/log/mysql/error.log',
      '/var/log/mysql/mysql.log',
      '/var/log/mariadb/mariadb.log'
    );
    
    // Add control panel specific logs
    if (controlPanel) {
      switch (controlPanel.toLowerCase()) {
        case 'cpanel':
          basePaths.push(
            '/usr/local/cpanel/logs/error_log',
            '/usr/local/cpanel/logs/access_log'
          );
          break;
        case 'plesk':
          basePaths.push(
            '/var/log/plesk/panel.log',
            '/var/log/plesk/httpsd_error.log'
          );
          break;
        case 'directadmin':
          basePaths.push(
            '/var/log/directadmin/error.log',
            '/var/log/directadmin/system.log'
          );
          break;
        case 'cyberpanel':
          basePaths.push(
            '/usr/local/lsws/logs/error.log',
            '/usr/local/lsws/logs/access.log'
          );
          break;
      }
    }
    
    return basePaths;
  }
}