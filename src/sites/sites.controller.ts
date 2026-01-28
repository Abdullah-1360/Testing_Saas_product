import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  HttpStatus,
  HttpCode,
  ParseUUIDPipe,
  ParseBoolPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { SitesService, WordPressDetectionResult } from './sites.service';
import { CreateSiteDto } from './dto/create-site.dto';
import { UpdateSiteDto } from './dto/update-site.dto';
import { HealthCheckResultDto } from './dto/site-health-check.dto';

import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/auth/guards/roles.guard';
import { Roles } from '@/auth/decorators/roles.decorator';
import { VersionedApiController, ApiResponseFormat, PaginationQuery } from '@/common/controllers/versioned-api.controller';
import { SkipTransform } from '@/common/decorators/skip-transform.decorator';

@ApiTags('sites')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller({ path: 'sites', version: '1' })
@SkipTransform()
export class SitesController extends VersionedApiController {
  constructor(private readonly sitesService: SitesService) {
    super();
  }

  /**
   * Create a new site
   * **Validates: Requirements 4.6, 4.9** - Site management and WordPress detection
   */
  @Post()
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new site' })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Site created successfully',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 201 },
        message: { type: 'string', example: 'Site created successfully' },
        data: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'uuid' },
            serverId: { type: 'string', example: 'uuid' },
            domain: { type: 'string', example: 'example.com' },
            documentRoot: { type: 'string', example: '/var/www/html' },
            wordpressPath: { type: 'string', example: '/var/www/html/wp' },
            isMultisite: { type: 'boolean', example: false },
            siteUrl: { type: 'string', example: 'https://example.com' },
            adminUrl: { type: 'string', example: 'https://example.com/wp-admin' },
            isActive: { type: 'boolean', example: true },
            createdAt: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
            updatedAt: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
          },
        },
        timestamp: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid site data provided',
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'Site with domain already exists',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Server not found',
  })
  async create(@Body() createSiteDto: CreateSiteDto): Promise<ApiResponseFormat> {
    const site = await this.sitesService.create(createSiteDto);
    return this.createResponse(
      site,
      this.getStandardMessages().created,
      HttpStatus.CREATED
    );
  }

  /**
   * Get all sites with pagination and filtering
   */
  @Get()
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER', 'VIEWER')
  @ApiOperation({ summary: 'Get all sites with pagination and filtering' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (default: 10, max: 100)' })
  @ApiQuery({ name: 'search', required: false, type: String, description: 'Search by domain' })
  @ApiQuery({ name: 'serverId', required: false, type: String, description: 'Filter by server ID' })
  @ApiQuery({ name: 'isActive', required: false, type: Boolean, description: 'Filter by active status' })
  @ApiQuery({ name: 'isMultisite', required: false, type: Boolean, description: 'Filter by multisite status' })
  @ApiQuery({
    name: 'includeServer',
    required: false,
    type: Boolean,
    description: 'Include server information in response',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Sites retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 200 },
        message: { type: 'string', example: 'Sites retrieved successfully' },
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', example: 'uuid' },
              serverId: { type: 'string', example: 'uuid' },
              domain: { type: 'string', example: 'example.com' },
              documentRoot: { type: 'string', example: '/var/www/html' },
              wordpressPath: { type: 'string', example: '/var/www/html/wp' },
              isMultisite: { type: 'boolean', example: false },
              siteUrl: { type: 'string', example: 'https://example.com' },
              adminUrl: { type: 'string', example: 'https://example.com/wp-admin' },
              isActive: { type: 'boolean', example: true },
              lastHealthCheck: { type: 'string', nullable: true, example: '2024-01-15T10:30:00.000Z' },
              createdAt: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
              updatedAt: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
            },
          },
        },
        pagination: {
          type: 'object',
          properties: {
            page: { type: 'number', example: 1 },
            limit: { type: 'number', example: 10 },
            total: { type: 'number', example: 25 },
            totalPages: { type: 'number', example: 3 },
          },
        },
        timestamp: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
      },
    },
  })
  async findAll(
    @Query() query: PaginationQuery & { 
      serverId?: string; 
      isActive?: boolean; 
      isMultisite?: boolean; 
      includeServer?: boolean;
    }
  ): Promise<ApiResponseFormat> {
    const { page, limit, skip } = this.parsePaginationQuery(query);
    const filters = this.parseFilterQuery(query);
    const includeServer = query.includeServer || false;
    
    const { sites, total } = await this.sitesService.findAllPaginated(skip, limit, filters, includeServer);
    
    return this.createPaginatedResponse(sites, total, page, limit);
  }

  /**
   * Get sites by server ID
   */
  @Get('by-server/:serverId')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER', 'VIEWER')
  @ApiOperation({ summary: 'Get sites by server ID' })
  @ApiParam({ name: 'serverId', description: 'Server UUID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Sites retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 200 },
        message: { type: 'string', example: 'Sites retrieved successfully' },
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', example: 'uuid' },
              serverId: { type: 'string', example: 'uuid' },
              domain: { type: 'string', example: 'example.com' },
              documentRoot: { type: 'string', example: '/var/www/html' },
              wordpressPath: { type: 'string', example: '/var/www/html/wp' },
              isMultisite: { type: 'boolean', example: false },
              siteUrl: { type: 'string', example: 'https://example.com' },
              adminUrl: { type: 'string', example: 'https://example.com/wp-admin' },
              isActive: { type: 'boolean', example: true },
              lastHealthCheck: { type: 'string', nullable: true, example: '2024-01-15T10:30:00.000Z' },
              createdAt: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
              updatedAt: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
            },
          },
        },
        timestamp: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
      },
    },
  })
  async findByServerId(
    @Param('serverId', ParseUUIDPipe) serverId: string,
  ): Promise<ApiResponseFormat> {
    const sites = await this.sitesService.findByServerId(serverId);
    return this.createResponse(sites, this.getStandardMessages().listRetrieved);
  }

  /**
   * Get site statistics
   */
  @Get('stats')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER', 'VIEWER')
  @ApiOperation({ summary: 'Get site statistics' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Site statistics retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 200 },
        message: { type: 'string', example: 'Site statistics retrieved successfully' },
        data: {
          type: 'object',
          properties: {
            total: { type: 'number', example: 25 },
            active: { type: 'number', example: 22 },
            inactive: { type: 'number', example: 3 },
            multisite: { type: 'number', example: 5 },
            healthyCount: { type: 'number', example: 20 },
            unhealthyCount: { type: 'number', example: 5 },
            byServer: {
              type: 'object',
              additionalProperties: { type: 'number' },
              example: { 'server1-uuid': 15, 'server2-uuid': 10 },
            },
          },
        },
        timestamp: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
      },
    },
  })
  async getStats(): Promise<ApiResponseFormat> {
    const stats = await this.sitesService.getStats();
    return this.createResponse(stats, 'Site statistics retrieved successfully');
  }

  /**
   * Get site by ID
   */
  @Get(':id')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER', 'VIEWER')
  @ApiOperation({ summary: 'Get site by ID' })
  @ApiParam({ name: 'id', description: 'Site UUID' })
  @ApiQuery({
    name: 'includeServer',
    required: false,
    type: Boolean,
    description: 'Include server information in response',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Site retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 200 },
        message: { type: 'string', example: 'Site retrieved successfully' },
        data: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'uuid' },
            serverId: { type: 'string', example: 'uuid' },
            domain: { type: 'string', example: 'example.com' },
            documentRoot: { type: 'string', example: '/var/www/html' },
            wordpressPath: { type: 'string', example: '/var/www/html/wp' },
            isMultisite: { type: 'boolean', example: false },
            siteUrl: { type: 'string', example: 'https://example.com' },
            adminUrl: { type: 'string', example: 'https://example.com/wp-admin' },
            isActive: { type: 'boolean', example: true },
            lastHealthCheck: { type: 'string', nullable: true, example: '2024-01-15T10:30:00.000Z' },
            createdAt: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
            updatedAt: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
          },
        },
        timestamp: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Site not found',
  })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('includeServer', new DefaultValuePipe(false), ParseBoolPipe)
    includeServer: boolean,
  ): Promise<ApiResponseFormat> {
    const site = includeServer 
      ? await this.sitesService.findOneWithServer(id)
      : await this.sitesService.findOne(id);
    
    return this.createResponse(site, this.getStandardMessages().retrieved);
  }

  /**
   * Update site
   */
  @Patch(':id')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER')
  @ApiOperation({ summary: 'Update site' })
  @ApiParam({ name: 'id', description: 'Site UUID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Site updated successfully',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 200 },
        message: { type: 'string', example: 'Site updated successfully' },
        data: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'uuid' },
            serverId: { type: 'string', example: 'uuid' },
            domain: { type: 'string', example: 'example.com' },
            documentRoot: { type: 'string', example: '/var/www/html' },
            wordpressPath: { type: 'string', example: '/var/www/html/wp' },
            isMultisite: { type: 'boolean', example: false },
            siteUrl: { type: 'string', example: 'https://example.com' },
            adminUrl: { type: 'string', example: 'https://example.com/wp-admin' },
            isActive: { type: 'boolean', example: true },
            lastHealthCheck: { type: 'string', nullable: true, example: '2024-01-15T10:30:00.000Z' },
            createdAt: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
            updatedAt: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
          },
        },
        timestamp: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid update data provided',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Site not found',
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'Site with domain already exists',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateSiteDto: UpdateSiteDto,
  ): Promise<ApiResponseFormat> {
    const site = await this.sitesService.update(id, updateSiteDto);
    return this.createResponse(site, this.getStandardMessages().updated);
  }

  /**
   * Delete site
   */
  @Delete(':id')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete site' })
  @ApiParam({ name: 'id', description: 'Site UUID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Site deleted successfully',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 200 },
        message: { type: 'string', example: 'Site deleted successfully' },
        timestamp: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Site not found',
  })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<ApiResponseFormat> {
    await this.sitesService.remove(id);
    return this.createResponse(null, this.getStandardMessages().deleted);
  }

  /**
   * Perform health check on a site
   * **Validates: Requirements 13.1-13.9** - Comprehensive verification logic
   */
  @Post(':id/health-check')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER')
  @ApiOperation({ summary: 'Perform health check on site' })
  @ApiParam({ name: 'id', description: 'Site UUID' })
  @ApiQuery({
    name: 'force',
    required: false,
    type: Boolean,
    description: 'Force fresh health check (ignore cache)',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Health check completed successfully',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 200 },
        message: { type: 'string', example: 'Health check completed successfully' },
        data: {
          type: 'object',
          properties: {
            siteId: { type: 'string', example: 'uuid' },
            domain: { type: 'string', example: 'example.com' },
            status: { type: 'string', example: 'healthy' },
            httpStatus: { type: 'number', example: 200 },
            responseTime: { type: 'number', example: 150 },
            checks: {
              type: 'object',
              properties: {
                httpResponse: { type: 'boolean', example: true },
                titleTag: { type: 'boolean', example: true },
                canonicalTag: { type: 'boolean', example: true },
                footerMarkers: { type: 'boolean', example: true },
                headerMarkers: { type: 'boolean', example: true },
                wpLogin: { type: 'boolean', example: true },
                internalUrls: { type: 'boolean', example: true },
                fatalErrors: { type: 'boolean', example: false },
                maintenanceMode: { type: 'boolean', example: false },
                whiteScreen: { type: 'boolean', example: false },
              },
            },
            timestamp: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
          },
        },
        timestamp: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Site not found',
  })
  async performHealthCheck(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('force', new DefaultValuePipe(false), ParseBoolPipe) force: boolean,
  ): Promise<ApiResponseFormat> {
    const result = await this.sitesService.performHealthCheck(id, force);
    return this.createResponse(result, 'Health check completed successfully');
  }

  /**
   * Detect WordPress installation on a site
   * **Validates: Requirements 4.6** - Auto-detect WordPress installation paths
   */
  @Post(':id/detect-wordpress')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER')
  @ApiOperation({ summary: 'Detect WordPress installation on site' })
  @ApiParam({ name: 'id', description: 'Site UUID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'WordPress detection completed successfully',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 200 },
        message: { type: 'string', example: 'WordPress detection completed successfully' },
        data: {
          type: 'object',
          properties: {
            detected: { type: 'boolean', example: true },
            version: { type: 'string', example: '6.4.2' },
            path: { type: 'string', example: '/var/www/html/wp' },
            configPath: { type: 'string', example: '/var/www/html/wp-config.php' },
            isMultisite: { type: 'boolean', example: false },
            siteUrl: { type: 'string', example: 'https://example.com' },
            adminUrl: { type: 'string', example: 'https://example.com/wp-admin' },
          },
        },
        timestamp: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Site not found',
  })
  async detectWordPressInstallation(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ApiResponseFormat> {
    const result = await this.sitesService.detectWordPressInstallation(id);
    return this.createResponse(result, 'WordPress detection completed successfully');
  }

  /**
   * Detect multisite configuration
   * **Validates: Requirements 4.9** - Auto-detect WordPress multisite configuration
   */
  @Post(':id/detect-multisite')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER')
  @ApiOperation({ summary: 'Detect WordPress multisite configuration' })
  @ApiParam({ name: 'id', description: 'Site UUID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Multisite detection completed successfully',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 200 },
        message: { type: 'string', example: 'Multisite detection completed successfully' },
        data: {
          type: 'object',
          properties: {
            isMultisite: { type: 'boolean', example: true },
            networkSites: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  blogId: { type: 'number', example: 1 },
                  domain: { type: 'string', example: 'example.com' },
                  path: { type: 'string', example: '/' },
                  siteUrl: { type: 'string', example: 'https://example.com' },
                },
              },
            },
            networkAdmin: { type: 'string', example: 'https://example.com/wp-admin/network' },
          },
        },
        timestamp: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Site not found',
  })
  async detectMultisiteConfiguration(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ApiResponseFormat> {
    const result = await this.sitesService.detectMultisiteConfiguration(id);
    return this.createResponse(result, 'Multisite detection completed successfully');
  }

  /**
   * Find site by domain
   */
  @Get('domain/:domain')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER', 'VIEWER')
  @ApiOperation({ summary: 'Find site by domain' })
  @ApiParam({ name: 'domain', description: 'Domain name' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Site retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 200 },
        message: { type: 'string', example: 'Site retrieved successfully' },
        data: {
          type: 'object',
          nullable: true,
          properties: {
            id: { type: 'string', example: 'uuid' },
            serverId: { type: 'string', example: 'uuid' },
            domain: { type: 'string', example: 'example.com' },
            documentRoot: { type: 'string', example: '/var/www/html' },
            wordpressPath: { type: 'string', example: '/var/www/html/wp' },
            isMultisite: { type: 'boolean', example: false },
            siteUrl: { type: 'string', example: 'https://example.com' },
            adminUrl: { type: 'string', example: 'https://example.com/wp-admin' },
            isActive: { type: 'boolean', example: true },
            lastHealthCheck: { type: 'string', nullable: true, example: '2024-01-15T10:30:00.000Z' },
            createdAt: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
            updatedAt: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
          },
        },
        timestamp: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Site not found',
  })
  async findByDomain(@Param('domain') domain: string): Promise<ApiResponseFormat> {
    const site = await this.sitesService.findByDomain(domain);
    return this.createResponse(
      site, 
      site ? this.getStandardMessages().retrieved : 'Site not found'
    );
  }
}