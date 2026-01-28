import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Roles } from '@/auth/decorators/roles.decorator';
import { DashboardService, DashboardStats } from './dashboard.service';

@ApiTags('Dashboard')
@Controller({ path: 'dashboard', version: '1' })
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('stats')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER', 'VIEWER')
  @ApiOperation({ summary: 'Get dashboard statistics and metrics' })
  @ApiResponse({ 
    status: 200, 
    description: 'Dashboard statistics retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        activeSites: { type: 'number', description: 'Number of active WordPress sites' },
        activeIncidents: { type: 'number', description: 'Number of currently active incidents' },
        fixedThisWeek: { type: 'number', description: 'Number of incidents fixed in the last 7 days' },
        successRate: { type: 'number', description: 'Success rate percentage for last 30 days' },
        recentIncidents: {
          type: 'array',
          description: 'List of recent incidents',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              site: { 
                type: 'object',
                properties: {
                  domain: { type: 'string' }
                }
              },
              state: { type: 'string' },
              triggerType: { type: 'string' },
              createdAt: { type: 'string', format: 'date-time' },
              priority: { type: 'string' }
            }
          }
        },
        systemHealth: {
          type: 'object',
          properties: {
            apiServer: { type: 'string', enum: ['operational', 'degraded', 'down'] },
            jobEngine: { type: 'string', enum: ['processing', 'idle', 'error'] },
            database: { type: 'string', enum: ['connected', 'disconnected'] }
          }
        }
      }
    }
  })
  async getDashboardStats(): Promise<DashboardStats> {
    return this.dashboardService.getDashboardStats();
  }

  @Get('quick-actions')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER', 'VIEWER')
  @ApiOperation({ summary: 'Get quick action buttons for dashboard' })
  @ApiResponse({ 
    status: 200, 
    description: 'Quick actions retrieved successfully',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          icon: { type: 'string' },
          href: { type: 'string' },
          color: { type: 'string' }
        }
      }
    }
  })
  async getQuickActions() {
    return this.dashboardService.getQuickActions();
  }
}