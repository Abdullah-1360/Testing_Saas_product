import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';

export interface DashboardStats {
  activeSites: number;
  activeIncidents: number;
  fixedThisWeek: number;
  successRate: number;
  recentIncidents: Array<{
    id: string;
    site: { domain: string };
    state: string;
    triggerType: string;
    createdAt: string;
    priority: string;
  }>;
  systemHealth: {
    apiServer: 'operational' | 'degraded' | 'down';
    jobEngine: 'processing' | 'idle' | 'error';
    database: 'connected' | 'disconnected';
  };
}

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboardStats(): Promise<DashboardStats> {
    // Get active sites count
    const activeSites = await this.prisma.site.count({
      where: { isActive: true },
    });

    // Get active incidents count
    const activeIncidents = await this.prisma.incident.count({
      where: {
        state: {
          notIn: ['FIXED', 'ESCALATED'],
        },
      },
    });

    // Get incidents fixed this week
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    
    const fixedThisWeek = await this.prisma.incident.count({
      where: {
        state: 'FIXED',
        resolvedAt: {
          gte: oneWeekAgo,
        },
      },
    });

    // Calculate success rate for last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const totalIncidentsLast30Days = await this.prisma.incident.count({
      where: {
        createdAt: {
          gte: thirtyDaysAgo,
        },
      },
    });

    const fixedIncidentsLast30Days = await this.prisma.incident.count({
      where: {
        state: 'FIXED',
        createdAt: {
          gte: thirtyDaysAgo,
        },
      },
    });

    const successRate = totalIncidentsLast30Days > 0 
      ? Math.round((fixedIncidentsLast30Days / totalIncidentsLast30Days) * 100)
      : 0;

    // Get recent incidents (last 10)
    const recentIncidents = await this.prisma.incident.findMany({
      take: 10,
      orderBy: { createdAt: 'desc' },
      include: {
        site: {
          select: { domain: true },
        },
      },
    });

    // System health checks
    const systemHealth = await this.getSystemHealth();

    return {
      activeSites,
      activeIncidents,
      fixedThisWeek,
      successRate,
      recentIncidents: recentIncidents.map(incident => ({
        id: incident.id,
        site: incident.site,
        state: incident.state,
        triggerType: incident.triggerType,
        createdAt: incident.createdAt.toISOString(),
        priority: incident.priority,
      })),
      systemHealth,
    };
  }

  private async getSystemHealth() {
    try {
      // Test database connection
      await this.prisma.$queryRaw`SELECT 1`;
      
      // Check if there are any recent job processing activities
      const recentJobActivity = await this.prisma.incident.count({
        where: {
          updatedAt: {
            gte: new Date(Date.now() - 5 * 60 * 1000), // Last 5 minutes
          },
        },
      });

      return {
        apiServer: 'operational' as const,
        jobEngine: recentJobActivity > 0 ? 'processing' as const : 'idle' as const,
        database: 'connected' as const,
      };
    } catch (error) {
      return {
        apiServer: 'operational' as const,
        jobEngine: 'error' as const,
        database: 'disconnected' as const,
      };
    }
  }

  async getQuickActions() {
    return [
      {
        id: 'create-incident',
        title: 'Create Incident',
        description: 'Manually trigger incident processing for a site',
        icon: 'ExclamationTriangleIcon',
        href: '/incidents/create',
        color: 'yellow',
      },
      {
        id: 'add-site',
        title: 'Add Site',
        description: 'Register a new WordPress site for monitoring',
        icon: 'GlobeAltIcon',
        href: '/sites/create',
        color: 'blue',
      },
      {
        id: 'add-server',
        title: 'Add Server',
        description: 'Connect a new server to the system',
        icon: 'ServerIcon',
        href: '/servers/create',
        color: 'green',
      },
      {
        id: 'view-audit',
        title: 'View Audit Log',
        description: 'Review system activity and compliance logs',
        icon: 'DocumentTextIcon',
        href: '/audit',
        color: 'purple',
      },
    ];
  }
}