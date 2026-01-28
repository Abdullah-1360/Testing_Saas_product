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
  ForbiddenException,
  HttpStatus,
  HttpCode,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery, ApiParam } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/auth/guards/roles.guard';
import { Roles } from '@/auth/decorators/roles.decorator';
import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import { User } from './entities/user.entity';
import { VersionedApiController, ApiResponseFormat, PaginationQuery } from '@/common/controllers/versioned-api.controller';
import { SkipTransform } from '@/common/decorators/skip-transform.decorator';

@ApiTags('users')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'users', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@SkipTransform()
export class UsersController extends VersionedApiController {
  constructor(private readonly usersService: UsersService) {
    super();
  }

  @Post()
  @Roles('SUPER_ADMIN', 'ADMIN')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new user' })
  @ApiResponse({ 
    status: HttpStatus.CREATED, 
    description: 'User created successfully',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 201 },
        message: { type: 'string', example: 'User created successfully' },
        data: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'uuid' },
            email: { type: 'string', example: 'user@example.com' },
            role: { type: 'string', example: 'ENGINEER' },
            mfaEnabled: { type: 'boolean', example: false },
            createdAt: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
            updatedAt: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
          },
        },
        timestamp: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
      },
    },
  })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid user data' })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'User already exists' })
  async create(@Body() createUserDto: CreateUserDto): Promise<ApiResponseFormat> {
    const result = await this.usersService.create(createUserDto);
    return this.createResponse(
      {
        user: result.user.toSafeObject(),
        temporaryPassword: result.temporaryPassword,
      },
      this.getStandardMessages().created,
      HttpStatus.CREATED
    );
  }

  @Get()
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Get all users with pagination and filtering' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (default: 10, max: 100)' })
  @ApiQuery({ name: 'role', required: false, type: String, description: 'Filter by user role' })
  @ApiQuery({ name: 'search', required: false, type: String, description: 'Search by email' })
  @ApiQuery({ name: 'mfaEnabled', required: false, type: Boolean, description: 'Filter by MFA status' })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'Users retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 200 },
        message: { type: 'string', example: 'Users retrieved successfully' },
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', example: 'uuid' },
              email: { type: 'string', example: 'user@example.com' },
              role: { type: 'string', example: 'ENGINEER' },
              mfaEnabled: { type: 'boolean', example: false },
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
  async findAll(@Query() query: PaginationQuery & { role?: string; mfaEnabled?: boolean }): Promise<ApiResponseFormat> {
    const { page, limit, skip } = this.parsePaginationQuery(query);
    const filters = this.parseFilterQuery(query);
    
    const { users, total } = await this.usersService.findAllPaginated(skip, limit, filters);
    const safeUsers = users.map(user => user.toSafeObject());
    
    return this.createPaginatedResponse(safeUsers, total, page, limit);
  }

  @Get('profile')
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'Profile retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 200 },
        message: { type: 'string', example: 'Profile retrieved successfully' },
        data: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'uuid' },
            email: { type: 'string', example: 'user@example.com' },
            role: { type: 'string', example: 'ENGINEER' },
            mfaEnabled: { type: 'boolean', example: false },
            createdAt: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
            updatedAt: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
          },
        },
        timestamp: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
      },
    },
  })
  getProfile(@CurrentUser() user: User): ApiResponseFormat {
    return this.createResponse(
      user.toSafeObject(),
      'Profile retrieved successfully'
    );
  }

  @Get('stats')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Get user statistics' })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'User statistics retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 200 },
        message: { type: 'string', example: 'User statistics retrieved successfully' },
        data: {
          type: 'object',
          properties: {
            total: { type: 'number', example: 25 },
            byRole: {
              type: 'object',
              properties: {
                SUPER_ADMIN: { type: 'number', example: 1 },
                ADMIN: { type: 'number', example: 3 },
                ENGINEER: { type: 'number', example: 15 },
                VIEWER: { type: 'number', example: 6 },
              },
            },
            mfaEnabled: { type: 'number', example: 18 },
            mfaDisabled: { type: 'number', example: 7 },
            recentLogins: { type: 'number', example: 12 },
          },
        },
        timestamp: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
      },
    },
  })
  async getStats(): Promise<ApiResponseFormat> {
    const stats = await this.usersService.getStats();
    return this.createResponse(stats, 'User statistics retrieved successfully');
  }

  @Get(':id')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Get user by ID' })
  @ApiParam({ name: 'id', description: 'User UUID' })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'User retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 200 },
        message: { type: 'string', example: 'User retrieved successfully' },
        data: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'uuid' },
            email: { type: 'string', example: 'user@example.com' },
            role: { type: 'string', example: 'ENGINEER' },
            mfaEnabled: { type: 'boolean', example: false },
            createdAt: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
            updatedAt: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
          },
        },
        timestamp: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
      },
    },
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'User not found' })
  async findOne(@Param('id', ParseUUIDPipe) id: string): Promise<ApiResponseFormat> {
    const user = await this.usersService.findOne(id);
    return this.createResponse(
      user.toSafeObject(),
      this.getStandardMessages().retrieved
    );
  }

  @Patch('profile')
  @ApiOperation({ summary: 'Update current user profile' })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'Profile updated successfully',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 200 },
        message: { type: 'string', example: 'Profile updated successfully' },
        data: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'uuid' },
            email: { type: 'string', example: 'user@example.com' },
            role: { type: 'string', example: 'ENGINEER' },
            mfaEnabled: { type: 'boolean', example: false },
            createdAt: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
            updatedAt: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
          },
        },
        timestamp: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
      },
    },
  })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid update data' })
  async updateProfile(
    @CurrentUser() user: User, 
    @Body() updateUserDto: UpdateUserDto
  ): Promise<ApiResponseFormat> {
    // Users can only update their own profile
    // Remove role changes for non-admin users
    if (!user.hasRole('ADMIN')) {
      delete updateUserDto.roleId;
    }
    
    const updatedUser = await this.usersService.update(user.id, updateUserDto);
    return this.createResponse(
      updatedUser.toSafeObject(),
      'Profile updated successfully'
    );
  }

  @Patch(':id')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Update user by ID' })
  @ApiParam({ name: 'id', description: 'User UUID' })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'User updated successfully',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 200 },
        message: { type: 'string', example: 'User updated successfully' },
        data: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'uuid' },
            email: { type: 'string', example: 'user@example.com' },
            role: { type: 'string', example: 'ENGINEER' },
            mfaEnabled: { type: 'boolean', example: false },
            createdAt: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
            updatedAt: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
          },
        },
        timestamp: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
      },
    },
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'User not found' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Cannot modify super admin users' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateUserDto: UpdateUserDto,
    @CurrentUser() currentUser: User,
  ): Promise<ApiResponseFormat> {
    // Prevent non-super-admin from modifying super-admin users
    const targetUser = await this.usersService.findOne(id);
    if (
      targetUser.role?.name === 'SUPER_ADMIN' &&
      currentUser.role?.name !== 'SUPER_ADMIN'
    ) {
      throw new ForbiddenException('Cannot modify super admin users');
    }

    const updatedUser = await this.usersService.update(id, updateUserDto);
    return this.createResponse(
      updatedUser.toSafeObject(),
      this.getStandardMessages().updated
    );
  }

  @Delete(':id')
  @Roles('SUPER_ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete user by ID' })
  @ApiParam({ name: 'id', description: 'User UUID' })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'User deleted successfully',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 200 },
        message: { type: 'string', example: 'User deleted successfully' },
        timestamp: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
      },
    },
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'User not found' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Cannot delete your own account' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string, 
    @CurrentUser() user: User
  ): Promise<ApiResponseFormat> {
    // Prevent users from deleting themselves
    if (id === user.id) {
      throw new ForbiddenException('Cannot delete your own account');
    }

    await this.usersService.remove(id);
    return this.createResponse(
      null,
      this.getStandardMessages().deleted
    );
  }

  @Post(':id/enable-mfa')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Enable MFA for user' })
  @ApiParam({ name: 'id', description: 'User UUID' })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'MFA enabled successfully',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 200 },
        message: { type: 'string', example: 'MFA enabled successfully' },
        data: {
          type: 'object',
          properties: {
            qrCode: { type: 'string', description: 'Base64 encoded QR code image' },
            secret: { type: 'string', description: 'MFA secret for manual entry' },
            backupCodes: { type: 'array', items: { type: 'string' } },
          },
        },
        timestamp: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
      },
    },
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'User not found' })
  async enableMfa(@Param('id', ParseUUIDPipe) id: string): Promise<ApiResponseFormat> {
    const mfaSetup = await this.usersService.enableMfa(id);
    return this.createResponse(mfaSetup, 'MFA enabled successfully');
  }

  @Post(':id/disable-mfa')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Disable MFA for user' })
  @ApiParam({ name: 'id', description: 'User UUID' })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'MFA disabled successfully',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 200 },
        message: { type: 'string', example: 'MFA disabled successfully' },
        timestamp: { type: 'string', example: '2024-01-15T10:30:00.000Z' },
      },
    },
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'User not found' })
  async disableMfa(@Param('id', ParseUUIDPipe) id: string): Promise<ApiResponseFormat> {
    await this.usersService.disableMfa(id);
    return this.createResponse(null, 'MFA disabled successfully');
  }
}