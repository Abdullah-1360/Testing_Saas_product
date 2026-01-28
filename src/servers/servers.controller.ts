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
  ValidationPipe,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery, ApiParam } from '@nestjs/swagger';
import { ServersService } from './servers.service';
import { CreateServerDto } from './dto/create-server.dto';
import { UpdateServerDto } from './dto/update-server.dto';
import { DiscoveryService } from './discovery.service';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/auth/guards/roles.guard';
import { Roles } from '@/auth/decorators/roles.decorator';
import { LoggerService } from '@/common/services/logger.service';
import { VersionedApiController, ApiResponseFormat, PaginationQuery } from '@/common/controllers/versioned-api.controller';
import { SkipTransform } from '@/common/decorators/skip-transform.decorator';

@ApiTags('servers')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller({ path: 'servers', version: '1' })
@SkipTransform()
export class ServersController extends VersionedApiController {
  constructor(
    private readonly serversService: ServersService,
    private readonly discoveryService: DiscoveryService,
    private readonly logger: LoggerService,
  ) {
    super();
  }

  @Post()
  @Roles('SUPER_ADMIN', 'ADMIN')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new server' })
  @ApiResponse({ 
    status: HttpStatus.CREATED, 
    description: 'Server created successfully',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 201 },
        message: { type: 'string', example: 'Server created successfully' },
        data: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'uuid' },
            name: { type: 'string', example: 'Production Server 1' },
            hostname: { type: 'string', example: 'server1.example.com' },
            port: { type: 'number', example: 22 },
            username: { type: 'string', example: 'root' },
            authType: { type: 'string', example: 'key' },
            hostKeyFingerprint: { type: 'string', example: 'SHA256:...' },
            controlPanel: { type: 'string', example: 'cPanel' },
            osInfo: { type: 'object' },
            createdAt: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
            updatedAt: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
          },
        },
        timestamp: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
      },
    },
  })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid server configuration' })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'Server with hostname already exists' })
  async create(@Body(ValidationPipe) createServerDto: CreateServerDto): Promise<ApiResponseFormat> {
    this.logger.logAuditEvent(
      'server_create_attempt',
      'server',
      {
        hostname: createServerDto.hostname,
        authType: createServerDto.authType,
      },
      'ServersController'
    );

    const server = await this.serversService.create(createServerDto);
    
    // Return server without encrypted credentials
    const { encryptedCredentials, ...serverResponse } = server;
    return this.createResponse(
      serverResponse,
      this.getStandardMessages().created,
      HttpStatus.CREATED
    );
  }

  @Get()
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER', 'VIEWER')
  @ApiOperation({ summary: 'Get all servers with pagination and filtering' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (default: 10, max: 100)' })
  @ApiQuery({ name: 'search', required: false, type: String, description: 'Search by name or hostname' })
  @ApiQuery({ name: 'controlPanel', required: false, type: String, description: 'Filter by control panel' })
  @ApiQuery({ name: 'authType', required: false, type: String, description: 'Filter by authentication type' })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'Servers retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 200 },
        message: { type: 'string', example: 'Servers retrieved successfully' },
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', example: 'uuid' },
              name: { type: 'string', example: 'Production Server 1' },
              hostname: { type: 'string', example: 'server1.example.com' },
              port: { type: 'number', example: 22 },
              username: { type: 'string', example: 'root' },
              authType: { type: 'string', example: 'key' },
              hostKeyFingerprint: { type: 'string', example: 'SHA256:...' },
              controlPanel: { type: 'string', example: 'cPanel' },
              osInfo: { type: 'object' },
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
  async findAll(@Query() query: PaginationQuery & { controlPanel?: string; authType?: string }): Promise<ApiResponseFormat> {
    const { page, limit, skip } = this.parsePaginationQuery(query);
    const filters = this.parseFilterQuery(query);
    
    const { servers, total } = await this.serversService.findAllPaginated(skip, limit, filters);
    
    // Remove encrypted credentials from response
    const sanitizedServers = servers.map(({ encryptedCredentials, ...server }) => server);
    
    return this.createPaginatedResponse(sanitizedServers, total, page, limit);
  }

  @Get('stats')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER', 'VIEWER')
  @ApiOperation({ summary: 'Get server statistics' })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'Server statistics retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 200 },
        message: { type: 'string', example: 'Server statistics retrieved successfully' },
        data: {
          type: 'object',
          properties: {
            total: { type: 'number', example: 15 },
            byControlPanel: {
              type: 'object',
              properties: {
                cPanel: { type: 'number', example: 8 },
                Plesk: { type: 'number', example: 4 },
                DirectAdmin: { type: 'number', example: 2 },
                None: { type: 'number', example: 1 },
              },
            },
            byAuthType: {
              type: 'object',
              properties: {
                key: { type: 'number', example: 12 },
                password: { type: 'number', example: 3 },
              },
            },
            connectionStatus: {
              type: 'object',
              properties: {
                connected: { type: 'number', example: 13 },
                disconnected: { type: 'number', example: 2 },
              },
            },
          },
        },
        timestamp: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
      },
    },
  })
  async getStats(): Promise<ApiResponseFormat> {
    const stats = await this.serversService.getStats();
    return this.createResponse(stats, 'Server statistics retrieved successfully');
  }

  @Get(':id')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER', 'VIEWER')
  @ApiOperation({ summary: 'Get server by ID' })
  @ApiParam({ name: 'id', description: 'Server UUID' })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'Server retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 200 },
        message: { type: 'string', example: 'Server retrieved successfully' },
        data: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'uuid' },
            name: { type: 'string', example: 'Production Server 1' },
            hostname: { type: 'string', example: 'server1.example.com' },
            port: { type: 'number', example: 22 },
            username: { type: 'string', example: 'root' },
            authType: { type: 'string', example: 'key' },
            hostKeyFingerprint: { type: 'string', example: 'SHA256:...' },
            controlPanel: { type: 'string', example: 'cPanel' },
            osInfo: { type: 'object' },
            createdAt: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
            updatedAt: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
          },
        },
        timestamp: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
      },
    },
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Server not found' })
  async findOne(@Param('id', ParseUUIDPipe) id: string): Promise<ApiResponseFormat> {
    const server = await this.serversService.findOne(id);
    
    // Remove encrypted credentials from response
    const { encryptedCredentials, ...serverResponse } = server;
    
    return this.createResponse(
      serverResponse,
      this.getStandardMessages().retrieved
    );
  }

  @Patch(':id')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Update server' })
  @ApiParam({ name: 'id', description: 'Server UUID' })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'Server updated successfully',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 200 },
        message: { type: 'string', example: 'Server updated successfully' },
        data: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'uuid' },
            name: { type: 'string', example: 'Production Server 1' },
            hostname: { type: 'string', example: 'server1.example.com' },
            port: { type: 'number', example: 22 },
            username: { type: 'string', example: 'root' },
            authType: { type: 'string', example: 'key' },
            hostKeyFingerprint: { type: 'string', example: 'SHA256:...' },
            controlPanel: { type: 'string', example: 'cPanel' },
            osInfo: { type: 'object' },
            createdAt: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
            updatedAt: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
          },
        },
        timestamp: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
      },
    },
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Server not found' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(ValidationPipe) updateServerDto: UpdateServerDto,
  ): Promise<ApiResponseFormat> {
    this.logger.logAuditEvent(
      'server_update_attempt',
      'server',
      {
        serverId: id,
        fieldsUpdated: Object.keys(updateServerDto),
        credentialsUpdated: !!updateServerDto.credentials,
      },
      'ServersController'
    );

    const server = await this.serversService.update(id, updateServerDto);
    
    // Remove encrypted credentials from response
    const { encryptedCredentials, ...serverResponse } = server;
    
    return this.createResponse(
      serverResponse,
      this.getStandardMessages().updated
    );
  }

  @Delete(':id')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Delete server' })
  @ApiParam({ name: 'id', description: 'Server UUID' })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'Server deleted successfully',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 200 },
        message: { type: 'string', example: 'Server deleted successfully' },
        timestamp: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
      },
    },
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Server not found' })
  @HttpCode(HttpStatus.OK)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<ApiResponseFormat> {
    this.logger.logAuditEvent(
      'server_delete_attempt',
      'server',
      { serverId: id },
      'ServersController'
    );

    await this.serversService.remove(id);
    
    return this.createResponse(
      null,
      this.getStandardMessages().deleted
    );
  }

  @Post(':id/test-connection')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER')
  @ApiOperation({ summary: 'Test server connection' })
  @ApiParam({ name: 'id', description: 'Server UUID' })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'Connection test completed',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 200 },
        message: { type: 'string', example: 'Connection test completed' },
        data: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            responseTime: { type: 'number', example: 150 },
            hostKeyVerified: { type: 'boolean', example: true },
            authenticationSuccessful: { type: 'boolean', example: true },
            error: { type: 'string', nullable: true },
            timestamp: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
          },
        },
        timestamp: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
      },
    },
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Server not found' })
  async testConnection(@Param('id', ParseUUIDPipe) id: string): Promise<ApiResponseFormat> {
    this.logger.logAuditEvent(
      'connection_test_attempt',
      'server',
      { serverId: id },
      'ServersController'
    );

    const result = await this.serversService.testConnection(id);
    
    return this.createResponse(result, 'Connection test completed');
  }

  @Post(':id/discover')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER')
  @ApiOperation({ summary: 'Discover server environment' })
  @ApiParam({ name: 'id', description: 'Server UUID' })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'Server discovery completed',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 200 },
        message: { type: 'string', example: 'Server discovery completed' },
        data: {
          type: 'object',
          properties: {
            operatingSystem: {
              type: 'object',
              properties: {
                name: { type: 'string', example: 'Ubuntu' },
                version: { type: 'string', example: '22.04 LTS' },
                architecture: { type: 'string', example: 'x86_64' },
              },
            },
            webServer: {
              type: 'object',
              properties: {
                type: { type: 'string', example: 'Apache' },
                version: { type: 'string', example: '2.4.52' },
                configPath: { type: 'string', example: '/etc/apache2' },
              },
            },
            controlPanel: {
              type: 'object',
              properties: {
                type: { type: 'string', example: 'cPanel' },
                version: { type: 'string', example: '110.0.18' },
                path: { type: 'string', example: '/usr/local/cpanel' },
              },
            },
            php: {
              type: 'object',
              properties: {
                version: { type: 'string', example: '8.1.2' },
                handler: { type: 'string', example: 'php-fpm' },
                configPath: { type: 'string', example: '/etc/php/8.1/fpm' },
              },
            },
            database: {
              type: 'object',
              properties: {
                type: { type: 'string', example: 'MySQL' },
                version: { type: 'string', example: '8.0.32' },
              },
            },
            caching: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  type: { type: 'string', example: 'Redis' },
                  version: { type: 'string', example: '6.2.6' },
                  status: { type: 'string', example: 'running' },
                },
              },
            },
          },
        },
        timestamp: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
      },
    },
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Server not found' })
  async discoverEnvironment(@Param('id', ParseUUIDPipe) id: string): Promise<ApiResponseFormat> {
    this.logger.logAuditEvent(
      'server_discovery_attempt',
      'server',
      { serverId: id },
      'ServersController'
    );

    const discoveryResult = await this.discoveryService.discoverServerEnvironment(id);
    
    return this.createResponse(discoveryResult, 'Server discovery completed');
  }

  @Post(':id/rotate-credentials')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Rotate server credentials' })
  @ApiParam({ name: 'id', description: 'Server UUID' })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'Credentials rotated successfully',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 200 },
        message: { type: 'string', example: 'Credentials rotated successfully' },
        timestamp: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
      },
    },
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Server not found' })
  async rotateCredentials(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('newCredentials') newCredentials: string,
  ): Promise<ApiResponseFormat> {
    this.logger.logSecurityEvent(
      'credential_rotation_attempt',
      { serverId: id },
      'ServersController'
    );

    await this.serversService.rotateCredentials(id, newCredentials);
    
    return this.createResponse(null, 'Credentials rotated successfully');
  }

  @Get(':id/connection-status')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER', 'VIEWER')
  @ApiOperation({ summary: 'Get server connection status' })
  @ApiParam({ name: 'id', description: 'Server UUID' })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'Connection status retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 200 },
        message: { type: 'string', example: 'Connection status retrieved successfully' },
        data: {
          type: 'object',
          properties: {
            status: { type: 'string', example: 'connected' },
            lastChecked: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
            responseTime: { type: 'number', example: 150 },
            uptime: { type: 'number', example: 86400 },
            load: {
              type: 'object',
              properties: {
                '1min': { type: 'number', example: 0.5 },
                '5min': { type: 'number', example: 0.3 },
                '15min': { type: 'number', example: 0.2 },
              },
            },
          },
        },
        timestamp: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
      },
    },
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Server not found' })
  async getConnectionStatus(@Param('id', ParseUUIDPipe) id: string): Promise<ApiResponseFormat> {
    const result = await this.serversService.getConnectionStatus(id);
    
    return this.createResponse(result, 'Connection status retrieved successfully');
  }

  @Get(':id/validate-host-key')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER')
  @ApiOperation({ summary: 'Validate server host key' })
  @ApiParam({ name: 'id', description: 'Server UUID' })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'Host key validation completed',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 200 },
        message: { type: 'string', example: 'Host key validation completed' },
        data: {
          type: 'object',
          properties: {
            valid: { type: 'boolean', example: true },
            fingerprint: { type: 'string', example: 'SHA256:...' },
            algorithm: { type: 'string', example: 'ssh-rsa' },
            keySize: { type: 'number', example: 2048 },
            lastValidated: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
          },
        },
        timestamp: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
      },
    },
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Server not found' })
  async validateHostKey(@Param('id', ParseUUIDPipe) id: string): Promise<ApiResponseFormat> {
    const result = await this.serversService.validateHostKey(id);
    
    return this.createResponse(result, 'Host key validation completed');
  }
}