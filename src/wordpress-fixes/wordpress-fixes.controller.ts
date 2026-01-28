import { 
  Controller, 
  Post, 
  Get, 
  Body, 
  Param, 
  HttpStatus, 
  HttpException,
  UseGuards,
  Logger
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/auth/guards/roles.guard';
import { Roles } from '@/auth/decorators/roles.decorator';
import { WordPressFixesService } from './wordpress-fixes.service';
import { 
  FixTier, 
  FixContext, 
  FixEvidence
} from './interfaces/fix-playbook.interface';

class ExecuteFixesDto {
  incidentId!: string;
  siteId!: string;
  serverId!: string;
  sitePath!: string;
  wordpressPath!: string;
  domain!: string;
  correlationId!: string;
  traceId!: string;
  evidence!: FixEvidence[];
  maxTier?: FixTier;
  metadata?: Record<string, any>;
}

class ExecutePlaybookDto {
  playbookName!: string;
  incidentId!: string;
  siteId!: string;
  serverId!: string;
  sitePath!: string;
  wordpressPath!: string;
  domain!: string;
  correlationId!: string;
  traceId!: string;
  metadata?: Record<string, any>;
}

class GetApplicablePlaybooksDto {
  sitePath!: string;
  wordpressPath!: string;
  domain!: string;
  evidence!: FixEvidence[];
  tier?: FixTier;
}

@ApiTags('wordpress-fixes')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('wordpress-fixes')
export class WordPressFixesController {
  private readonly logger = new Logger(WordPressFixesController.name);

  constructor(private readonly wordpressFixesService: WordPressFixesService) {}

  @Post('execute')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER')
  @ApiOperation({ summary: 'Execute WordPress fixes following tier priority order' })
  @ApiResponse({ status: 200, description: 'Fixes executed successfully' })
  @ApiResponse({ status: 400, description: 'Invalid request data' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async executeFixes(@Body() dto: ExecuteFixesDto) {
    try {
      this.logger.log(`Executing WordPress fixes for incident ${dto.incidentId}`);

      // Create fix context
      const contextData = {
        incidentId: dto.incidentId,
        siteId: dto.siteId,
        serverId: dto.serverId,
        sitePath: dto.sitePath,
        wordpressPath: dto.wordpressPath,
        domain: dto.domain,
        correlationId: dto.correlationId,
        traceId: dto.traceId,
        ...(dto.metadata && { metadata: dto.metadata }),
      };
      const context = this.wordpressFixesService.createFixContext(contextData);

      // Validate context
      const validation = this.wordpressFixesService.validateFixContext(context);
      if (!validation.valid) {
        throw new HttpException(
          {
            message: 'Invalid fix context',
            errors: validation.errors,
          },
          HttpStatus.BAD_REQUEST
        );
      }

      // Execute fixes
      const result = await this.wordpressFixesService.executeWordPressFixes(
        context,
        dto.evidence,
        dto.maxTier
      );

      return {
        success: result.success,
        incidentId: dto.incidentId,
        tierExecuted: result.tierExecuted,
        totalFixesApplied: result.totalFixesApplied,
        results: result.results,
        timestamp: new Date().toISOString(),
      };

    } catch (error) {
      this.logger.error(`Error executing WordPress fixes for incident ${dto.incidentId}:`, error);
      
      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        {
          message: 'Failed to execute WordPress fixes',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Post('execute-playbook')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER')
  @ApiOperation({ summary: 'Execute a specific WordPress fix playbook' })
  @ApiResponse({ status: 200, description: 'Playbook executed successfully' })
  @ApiResponse({ status: 400, description: 'Invalid request data' })
  @ApiResponse({ status: 404, description: 'Playbook not found' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async executePlaybook(@Body() dto: ExecutePlaybookDto) {
    try {
      this.logger.log(`Executing playbook ${dto.playbookName} for incident ${dto.incidentId}`);

      // Create fix context
      const contextData = {
        incidentId: dto.incidentId,
        siteId: dto.siteId,
        serverId: dto.serverId,
        sitePath: dto.sitePath,
        wordpressPath: dto.wordpressPath,
        domain: dto.domain,
        correlationId: dto.correlationId,
        traceId: dto.traceId,
        ...(dto.metadata && { metadata: dto.metadata }),
      };
      const context = this.wordpressFixesService.createFixContext(contextData);

      // Validate context
      const validation = this.wordpressFixesService.validateFixContext(context);
      if (!validation.valid) {
        throw new HttpException(
          {
            message: 'Invalid fix context',
            errors: validation.errors,
          },
          HttpStatus.BAD_REQUEST
        );
      }

      // Execute specific playbook
      const result = await this.wordpressFixesService.executeSpecificPlaybook(
        dto.playbookName,
        context
      );

      if (!result) {
        throw new HttpException(
          {
            message: 'Playbook not found',
            playbookName: dto.playbookName,
          },
          HttpStatus.NOT_FOUND
        );
      }

      return {
        success: result.success,
        applied: result.applied,
        incidentId: dto.incidentId,
        playbookName: dto.playbookName,
        result,
        timestamp: new Date().toISOString(),
      };

    } catch (error) {
      this.logger.error(`Error executing playbook ${dto.playbookName} for incident ${dto.incidentId}:`, error);
      
      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        {
          message: 'Failed to execute playbook',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Post('applicable-playbooks')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER', 'VIEWER')
  @ApiOperation({ summary: 'Get applicable WordPress fix playbooks for given evidence' })
  @ApiResponse({ status: 200, description: 'Applicable playbooks retrieved successfully' })
  @ApiResponse({ status: 400, description: 'Invalid request data' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async getApplicablePlaybooks(@Body() dto: GetApplicablePlaybooksDto) {
    try {
      this.logger.log(`Getting applicable playbooks for domain ${dto.domain}`);

      // Create minimal context for playbook checking
      const context: FixContext = {
        incidentId: 'preview',
        siteId: 'preview',
        serverId: 'preview',
        sitePath: dto.sitePath,
        wordpressPath: dto.wordpressPath,
        domain: dto.domain,
        correlationId: 'preview',
        traceId: 'preview',
      };

      const applicablePlaybooks = await this.wordpressFixesService.getApplicablePlaybooks(
        context,
        dto.evidence,
        dto.tier
      );

      return {
        success: true,
        domain: dto.domain,
        tier: dto.tier,
        applicablePlaybooks,
        totalPlaybooks: applicablePlaybooks.length,
        timestamp: new Date().toISOString(),
      };

    } catch (error) {
      this.logger.error(`Error getting applicable playbooks for domain ${dto.domain}:`, error);
      
      throw new HttpException(
        {
          message: 'Failed to get applicable playbooks',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get('stats')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER', 'VIEWER')
  @ApiOperation({ summary: 'Get WordPress fix playbook statistics' })
  @ApiResponse({ status: 200, description: 'Statistics retrieved successfully' })
  async getStats() {
    try {
      const stats = this.wordpressFixesService.getPlaybookStats();

      return {
        success: true,
        stats,
        timestamp: new Date().toISOString(),
      };

    } catch (error) {
      this.logger.error('Error getting playbook statistics:', error);
      
      throw new HttpException(
        {
          message: 'Failed to get playbook statistics',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get('tiers')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER', 'VIEWER')
  @ApiOperation({ summary: 'Get available fix tiers and their descriptions' })
  @ApiResponse({ status: 200, description: 'Fix tiers retrieved successfully' })
  getTiers() {
    return {
      success: true,
      tiers: [
        {
          tier: FixTier.TIER_1_INFRASTRUCTURE,
          name: 'Tier 1: Infrastructure',
          description: 'Infrastructure and runtime issues (disk space, memory, PHP errors, web server config, database connection)',
          priority: 1,
        },
        {
          tier: FixTier.TIER_2_CORE_INTEGRITY,
          name: 'Tier 2: Core Integrity',
          description: 'WordPress core integrity restoration',
          priority: 2,
        },
        {
          tier: FixTier.TIER_3_PLUGIN_THEME_CONFLICTS,
          name: 'Tier 3: Plugin/Theme Conflicts',
          description: 'Plugin and theme conflict isolation',
          priority: 3,
        },
        {
          tier: FixTier.TIER_4_CACHE_FLUSH,
          name: 'Tier 4: Cache Flush',
          description: 'Cache flush with evidence-based justification',
          priority: 4,
        },
        {
          tier: FixTier.TIER_5_DEPENDENCY_REPAIR,
          name: 'Tier 5: Dependency Repair',
          description: 'Dependency repair and restoration',
          priority: 5,
        },
        {
          tier: FixTier.TIER_6_COMPONENT_ROLLBACK,
          name: 'Tier 6: Component Rollback',
          description: 'Last resort component rollback',
          priority: 6,
        },
      ],
      timestamp: new Date().toISOString(),
    };
  }
}