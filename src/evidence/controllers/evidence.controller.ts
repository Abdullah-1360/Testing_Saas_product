import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpStatus,
  Logger,
  BadRequestException,
  NotFoundException
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
  ApiBearerAuth,
  ApiBody
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { EvidenceService } from '../services/evidence.service';
import { AuditService } from '../../audit/audit.service';
import { CreateEvidenceDto } from '../dto/create-evidence.dto';
import { CollectLogsDto } from '../dto/collect-logs.dto';
import { CaptureCommandDto } from '../dto/capture-command.dto';
import { SearchEvidenceDto } from '../dto/search-evidence.dto';
import { DiagnosticCollectionDto } from '../dto/diagnostic-collection.dto';
import {
  EvidenceResponseDto,
  LogCollectionResponseDto,
  CommandCaptureResponseDto,
  DiagnosticCollectionResponseDto,
  EvidenceSearchResponseDto
} from '../dto/evidence-response.dto';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { User } from '@prisma/client';

@ApiTags('Evidence')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('evidence')
export class EvidenceController {
  private readonly logger = new Logger(EvidenceController.name);

  constructor(
    private readonly evidenceService: EvidenceService,
    private readonly auditService: AuditService
  ) {}

  @Post()
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER')
  @ApiOperation({ 
    summary: 'Create evidence manually',
    description: 'Manually create an evidence record for an incident'
  })
  @ApiBody({ type: CreateEvidenceDto })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Evidence created successfully',
    type: EvidenceResponseDto
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid input data'
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Incident not found'
  })
  async createEvidence(
    @Body() createEvidenceDto: CreateEvidenceDto,
    @CurrentUser() user: User
  ): Promise<EvidenceResponseDto> {
    this.logger.log(`Creating evidence for incident ${createEvidenceDto.incidentId}`);

    try {
      const evidence = await this.evidenceService.storeEvidence(
        createEvidenceDto.incidentId,
        createEvidenceDto.evidenceType,
        createEvidenceDto.content,
        createEvidenceDto.metadata
      );

      // Audit log
      await this.auditService.createAuditEvent({
        userId: user.id,
        action: 'CREATE_EVIDENCE',
        resource: 'evidence',
        resourceId: evidence.id,
        details: {
          incidentId: createEvidenceDto.incidentId,
          evidenceType: createEvidenceDto.evidenceType,
          contentLength: createEvidenceDto.content.length
        }
      });

      return new EvidenceResponseDto(evidence);
    } catch (error) {
      this.logger.error('Failed to create evidence:', error);
      throw error;
    }
  }

  @Post('collect-logs')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER')
  @ApiOperation({ 
    summary: 'Collect log files',
    description: 'Collect log files from a server for incident analysis'
  })
  @ApiBody({ type: CollectLogsDto })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Log files collected successfully',
    type: [LogCollectionResponseDto]
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid input data'
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Incident or server not found'
  })
  async collectLogs(
    @Body() collectLogsDto: CollectLogsDto,
    @CurrentUser() user: User
  ): Promise<LogCollectionResponseDto[]> {
    this.logger.log(`Collecting logs for incident ${collectLogsDto.incidentId} from server ${collectLogsDto.serverId}`);

    try {
      const results = await this.evidenceService.collectLogFiles(
        collectLogsDto.incidentId,
        collectLogsDto.serverId,
        collectLogsDto.logPaths
      );

      // Audit log
      await this.auditService.createAuditEvent({
        userId: user.id,
        action: 'COLLECT_LOGS',
        resource: 'evidence',
        resourceId: collectLogsDto.incidentId,
        details: {
          serverId: collectLogsDto.serverId,
          logPaths: collectLogsDto.logPaths,
          successfulCollections: results.filter(r => r.success).length,
          totalCollections: results.length
        }
      });

      return results.map(result => ({
        success: result.success,
        filePath: result.filePath,
        linesCollected: result.linesCollected,
        bytesCollected: result.bytesCollected,
        signature: result.signature,
        evidenceId: '', // This would need to be added to the result
        metadata: result.metadata,
        error: result.error
      }));
    } catch (error) {
      this.logger.error('Failed to collect logs:', error);
      throw error;
    }
  }

  @Post('capture-command')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER')
  @ApiOperation({ 
    summary: 'Capture command output',
    description: 'Execute a command on a server and capture its output as evidence'
  })
  @ApiBody({ type: CaptureCommandDto })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Command output captured successfully',
    type: CommandCaptureResponseDto
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid input data or dangerous command'
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Incident or server not found'
  })
  async captureCommand(
    @Body() captureCommandDto: CaptureCommandDto,
    @CurrentUser() user: User
  ): Promise<CommandCaptureResponseDto> {
    this.logger.log(`Capturing command output for incident ${captureCommandDto.incidentId}`);

    try {
      const result = await this.evidenceService.captureCommandOutput(
        captureCommandDto.incidentId,
        captureCommandDto.serverId,
        captureCommandDto.command
      );

      // Audit log
      await this.auditService.createAuditEvent({
        userId: user.id,
        action: 'CAPTURE_COMMAND',
        resource: 'evidence',
        resourceId: captureCommandDto.incidentId,
        details: {
          serverId: captureCommandDto.serverId,
          command: captureCommandDto.command,
          exitCode: result.exitCode,
          executionTime: result.executionTime
        }
      });

      return {
        success: true,
        command: result.command,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        executionTime: result.executionTime,
        signature: result.signature,
        evidenceId: '', // This would need to be added to the result
        metadata: result.metadata
      };
    } catch (error) {
      this.logger.error('Failed to capture command output:', error);
      throw error;
    }
  }

  @Post('collect-diagnostics')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER')
  @ApiOperation({ 
    summary: 'Collect comprehensive diagnostics',
    description: 'Perform comprehensive diagnostic data collection for an incident'
  })
  @ApiBody({ type: DiagnosticCollectionDto })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Diagnostic data collected successfully',
    type: DiagnosticCollectionResponseDto
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid input data'
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Incident or site not found'
  })
  async collectDiagnostics(
    @Body() diagnosticDto: DiagnosticCollectionDto,
    @CurrentUser() user: User
  ): Promise<DiagnosticCollectionResponseDto> {
    this.logger.log(`Collecting diagnostics for incident ${diagnosticDto.incidentId}`);

    try {
      const result = await this.evidenceService.performFullDiagnosticCollection(
        diagnosticDto.incidentId,
        diagnosticDto.siteId
      );

      // Audit log
      await this.auditService.createAuditEvent({
        userId: user.id,
        action: 'COLLECT_DIAGNOSTICS',
        resource: 'evidence',
        resourceId: diagnosticDto.incidentId,
        details: {
          siteId: diagnosticDto.siteId,
          totalEvidenceItems: result.totalEvidenceItems,
          totalDataSize: result.totalDataSize,
          collectionDuration: result.collectionEndTime!.getTime() - result.collectionStartTime.getTime()
        }
      });

      return {
        incidentId: result.incidentId,
        siteId: result.siteId,
        collectionStartTime: result.collectionStartTime,
        collectionEndTime: result.collectionEndTime!,
        totalEvidenceItems: result.totalEvidenceItems,
        totalDataSize: result.totalDataSize,
        logFiles: result.logFiles.map(log => ({
          success: log.success,
          filePath: log.filePath,
          linesCollected: log.linesCollected,
          bytesCollected: log.bytesCollected,
          signature: log.signature,
          evidenceId: '',
          metadata: log.metadata,
          error: log.error
        })),
        commandOutputs: result.commandOutputs.map(cmd => ({
          success: true,
          command: cmd.command,
          stdout: cmd.stdout,
          stderr: cmd.stderr,
          exitCode: cmd.exitCode,
          executionTime: cmd.executionTime,
          signature: cmd.signature,
          evidenceId: '',
          metadata: cmd.metadata
        })),
        systemDiagnosticIds: [], // These would need to be tracked
        wordpressDiagnosticIds: [], // These would need to be tracked
        summary: {
          successfulCollections: result.logFiles.filter(l => l.success).length + result.commandOutputs.length,
          failedCollections: result.logFiles.filter(l => !l.success).length,
          totalExecutionTime: result.collectionEndTime!.getTime() - result.collectionStartTime.getTime(),
          compressionEnabled: true
        }
      };
    } catch (error) {
      this.logger.error('Failed to collect diagnostics:', error);
      throw error;
    }
  }

  @Get('search')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER', 'VIEWER')
  @ApiOperation({ 
    summary: 'Search evidence',
    description: 'Search evidence records with filtering and pagination'
  })
  @ApiQuery({ type: SearchEvidenceDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Evidence search results',
    type: EvidenceSearchResponseDto
  })
  async searchEvidence(
    @Query() searchDto: SearchEvidenceDto,
    @CurrentUser() user: User
  ): Promise<EvidenceSearchResponseDto> {
    this.logger.log(`Searching evidence with filters: ${JSON.stringify(searchDto)}`);

    try {
      const filter = {
        incidentId: searchDto.incidentId,
        evidenceType: searchDto.evidenceType,
        signature: searchDto.signature,
        contentPattern: searchDto.contentPattern,
        startDate: searchDto.startDate ? new Date(searchDto.startDate) : undefined,
        endDate: searchDto.endDate ? new Date(searchDto.endDate) : undefined,
        limit: searchDto.limit,
        offset: searchDto.offset
      };

      const result = await this.evidenceService.searchEvidence(filter);

      // Audit log
      await this.auditService.createAuditEvent({
        userId: user.id,
        action: 'SEARCH_EVIDENCE',
        resource: 'evidence',
        details: {
          searchFilters: filter,
          resultCount: result.evidence.length,
          totalMatches: result.total
        }
      });

      return {
        evidence: result.evidence.map(e => new EvidenceResponseDto(e)),
        total: result.total,
        hasMore: result.hasMore,
        searchMetadata: result.searchMetadata
      };
    } catch (error) {
      this.logger.error('Failed to search evidence:', error);
      throw error;
    }
  }

  @Get(':id')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER', 'VIEWER')
  @ApiOperation({ 
    summary: 'Get evidence by ID',
    description: 'Retrieve a specific evidence record by its ID'
  })
  @ApiParam({ name: 'id', description: 'Evidence ID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Evidence details',
    type: EvidenceResponseDto
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Evidence not found'
  })
  async getEvidence(
    @Param('id') id: string,
    @CurrentUser() user: User
  ): Promise<EvidenceResponseDto> {
    this.logger.log(`Getting evidence ${id}`);

    try {
      const evidence = await this.evidenceService.getEvidenceById(id);

      if (!evidence) {
        throw new NotFoundException(`Evidence with ID ${id} not found`);
      }

      // Audit log
      await this.auditService.createAuditEvent({
        userId: user.id,
        action: 'VIEW_EVIDENCE',
        resource: 'evidence',
        resourceId: id,
        details: {
          evidenceType: evidence.evidenceType,
          incidentId: evidence.incidentId
        }
      });

      return new EvidenceResponseDto(evidence);
    } catch (error) {
      this.logger.error(`Failed to get evidence ${id}:`, error);
      throw error;
    }
  }

  @Delete(':id')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ 
    summary: 'Delete evidence',
    description: 'Delete an evidence record (admin only)'
  })
  @ApiParam({ name: 'id', description: 'Evidence ID' })
  @ApiResponse({
    status: HttpStatus.NO_CONTENT,
    description: 'Evidence deleted successfully'
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Evidence not found'
  })
  async deleteEvidence(
    @Param('id') id: string,
    @CurrentUser() user: User
  ): Promise<void> {
    this.logger.log(`Deleting evidence ${id}`);

    try {
      // Get evidence details for audit log before deletion
      const evidence = await this.evidenceService.getEvidenceById(id);

      if (!evidence) {
        throw new NotFoundException(`Evidence with ID ${id} not found`);
      }

      await this.evidenceService.deleteEvidence(id);

      // Audit log
      await this.auditService.createAuditEvent({
        userId: user.id,
        action: 'DELETE_EVIDENCE',
        resource: 'evidence',
        resourceId: id,
        details: {
          evidenceType: evidence.evidenceType,
          incidentId: evidence.incidentId,
          deletedAt: new Date().toISOString()
        }
      });

      this.logger.log(`Successfully deleted evidence ${id}`);
    } catch (error) {
      this.logger.error(`Failed to delete evidence ${id}:`, error);
      throw error;
    }
  }

  @Get('incident/:incidentId/analyze-logs')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER', 'VIEWER')
  @ApiOperation({ 
    summary: 'Analyze log patterns',
    description: 'Analyze log evidence for specific patterns in an incident'
  })
  @ApiParam({ name: 'incidentId', description: 'Incident ID' })
  @ApiQuery({ name: 'pattern', description: 'Pattern to search for', required: true })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Log analysis results',
    type: [EvidenceResponseDto]
  })
  async analyzeLogPatterns(
    @Param('incidentId') incidentId: string,
    @Query('pattern') pattern: string,
    @CurrentUser() user: User
  ): Promise<EvidenceResponseDto[]> {
    this.logger.log(`Analyzing log patterns for incident ${incidentId} with pattern: ${pattern}`);

    if (!pattern) {
      throw new BadRequestException('Pattern parameter is required');
    }

    try {
      const evidence = await this.evidenceService.analyzeLogPatterns(incidentId, pattern);

      // Audit log
      await this.auditService.createAuditEvent({
        userId: user.id,
        action: 'ANALYZE_LOG_PATTERNS',
        resource: 'evidence',
        resourceId: incidentId,
        details: {
          pattern,
          matchCount: evidence.length
        }
      });

      return evidence.map(e => new EvidenceResponseDto(e));
    } catch (error) {
      this.logger.error(`Failed to analyze log patterns for incident ${incidentId}:`, error);
      throw error;
    }
  }
}