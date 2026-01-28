import { Controller, Get, Req, Res, Logger, Query, UseGuards, UnauthorizedException } from '@nestjs/common';
import { Request, Response } from 'express';
import { SseService } from './sse.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { JwtService } from '@nestjs/jwt';
import { v4 as uuidv4 } from 'uuid';

@Controller({ path: 'sse', version: '1' })
export class SseController {
  private readonly logger = new Logger(SseController.name);

  constructor(
    private readonly sseService: SseService,
    private readonly jwtService: JwtService
  ) {}

  /**
   * SSE endpoint for real-time updates
   * Validates: Requirements 1.6
   */
  @Public()
  @Get('events')
  async getEvents(@Req() req: Request, @Res() res: Response, @Query('connectionId') connectionId?: string, @Query('token') token?: string): Promise<void> {
    // Generate connection ID if not provided
    const connId = connectionId || uuidv4();
    
    // Authenticate using token from query parameter (since EventSource doesn't support custom headers)
    let user: any;
    try {
      if (!token) {
        throw new UnauthorizedException('No authentication token provided');
      }

      this.logger.debug(`Attempting to verify token: ${token.substring(0, 20)}...`);
      const decoded = this.jwtService.verify(token);
      this.logger.debug(`Token verified successfully for user: ${decoded.sub}`);
      user = decoded;
    } catch (error: any) {
      this.logger.warn(`SSE authentication failed: ${error?.message || 'Unknown error'}`);
      this.logger.warn(`Token received: ${token?.substring(0, 50)}...`);
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    const userId = user?.sub; // JWT payload uses 'sub' for user ID
    if (!userId) {
      res.status(401).json({ message: 'Invalid user token' });
      return;
    }

    this.logger.log(`SSE connection request from user ${userId}`, {
      userId,
      connectionId: connId,
      userAgent: req.get('User-Agent'),
      ip: req.ip
    });

    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control',
      'Access-Control-Allow-Credentials': 'true',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    });

    // Send initial connection event
    const initialEvent = {
      id: `connection_${connId}`,
      type: 'connection_established',
      data: {
        connectionId: connId,
        timestamp: new Date().toISOString(),
        message: 'Real-time updates connected'
      }
    };

    res.write(`id: ${initialEvent.id}\n`);
    res.write(`event: ${initialEvent.type}\n`);
    res.write(`data: ${JSON.stringify(initialEvent.data)}\n\n`);

    // Subscribe to event stream
    const subscription = this.sseService.getEventStream(userId, connId).subscribe({
      next: (eventData) => {
        try {
          res.write(eventData);
          this.sseService.updateConnectionPing(connId);
        } catch (error) {
          this.logger.error(`Error writing SSE data for connection ${connId}:`, error);
          subscription.unsubscribe();
          this.sseService.removeConnection(connId);
        }
      },
      error: (error) => {
        this.logger.error(`SSE stream error for connection ${connId}:`, error);
        this.sseService.removeConnection(connId);
        res.end();
      }
    });

    // Handle client disconnect
    req.on('close', () => {
      this.logger.log(`SSE connection closed by client`, {
        userId,
        connectionId: connId
      });
      subscription.unsubscribe();
      this.sseService.removeConnection(connId);
    });

    req.on('error', (error) => {
      this.logger.error(`SSE connection error for ${connId}:`, error);
      subscription.unsubscribe();
      this.sseService.removeConnection(connId);
    });

    // Send periodic heartbeat to keep connection alive
    const heartbeatInterval = setInterval(() => {
      try {
        const heartbeat = {
          id: `heartbeat_${Date.now()}`,
          type: 'heartbeat',
          data: {
            timestamp: new Date().toISOString(),
            connectionId: connId
          }
        };

        res.write(`id: ${heartbeat.id}\n`);
        res.write(`event: ${heartbeat.type}\n`);
        res.write(`data: ${JSON.stringify(heartbeat.data)}\n\n`);
        
        this.sseService.updateConnectionPing(connId);
      } catch (error) {
        this.logger.error(`Error sending heartbeat for connection ${connId}:`, error);
        clearInterval(heartbeatInterval);
        subscription.unsubscribe();
        this.sseService.removeConnection(connId);
      }
    }, 30000); // Send heartbeat every 30 seconds

    // Clean up heartbeat on disconnect
    req.on('close', () => {
      clearInterval(heartbeatInterval);
    });
  }

  /**
   * Get SSE connection status
   */
  @Get('status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER')
  getConnectionStatus(@Req() req: Request) {
    const user = (req as any).user;
    const userId = user?.id;

    return {
      totalConnections: this.sseService.getActiveConnectionsCount(),
      userConnections: userId ? this.sseService.getUserConnections(userId).length : 0,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Test endpoint to send a test event (for development/testing)
   */
  @Get('test')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN')
  sendTestEvent(@Query('type') _type: string = 'test') {
    const testEvent = {
      incidentId: 'test-incident-123',
      siteId: 'test-site-456',
      domain: 'test.example.com',
      state: 'FIX_ATTEMPT',
      priority: 'MEDIUM',
      fixAttempts: 2,
      maxFixAttempts: 15,
      eventType: 'FIX_ATTEMPT_INCREMENT',
      phase: 'FIX_ATTEMPT',
      step: 'Testing SSE functionality',
      details: {
        testMessage: 'This is a test event for SSE functionality',
        timestamp: new Date().toISOString()
      }
    };

    this.sseService.sendIncidentUpdate(testEvent);

    return {
      message: 'Test event sent',
      event: testEvent,
      timestamp: new Date().toISOString()
    };
  }
}