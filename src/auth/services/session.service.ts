import { Injectable, Logger, UnauthorizedException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { AuditService } from '@/audit/audit.service';
import { JwtService } from '@nestjs/jwt';
import { JwtPayload, RefreshTokenPayload } from '../interfaces/jwt-payload.interface';
import { SessionResponseDto } from '../dto/session.dto';
import * as crypto from 'crypto';

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * Create a new session
   */
  async createSession(
    userId: string,
    ipAddress: string,
    userAgent: string,
    deviceFingerprint?: string,
  ): Promise<{ sessionId: string; accessToken: string; refreshToken: string }> {
    // Get user with role information
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { role: true },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // Create session record
    const session = await this.prisma.userSession.create({
      data: {
        userId,
        accessTokenHash: 'temp', // Will be updated after token generation
        refreshTokenHash: 'temp', // Will be updated after token generation
        ipAddress,
        userAgent,
        deviceFingerprint,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      },
    });

    // Generate JWT tokens
    const accessTokenPayload: JwtPayload = {
      sub: userId,
      email: user.email,
      username: user.username,
      roleId: user.roleId,
      roleName: user.role.name,
      sessionId: session.id,
    };

    const refreshTokenPayload: RefreshTokenPayload = {
      sub: userId,
      sessionId: session.id,
      tokenType: 'refresh',
    };

    const accessToken = this.jwtService.sign(accessTokenPayload, { expiresIn: '24h' });
    const refreshToken = this.jwtService.sign(refreshTokenPayload, { expiresIn: '7d' });

    // Hash tokens for storage
    const accessTokenHash = crypto.createHash('sha256').update(accessToken).digest('hex');
    const refreshTokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

    // Update session with token hashes
    await this.prisma.userSession.update({
      where: { id: session.id },
      data: {
        accessTokenHash,
        refreshTokenHash,
      },
    });

    // Create audit log
    await this.auditService.createAuditEvent({
      userId,
      action: 'session_created',
      resource: 'session',
      resourceId: session.id,
      details: {
        sessionId: session.id,
        ipAddress,
        userAgent,
        deviceFingerprint,
      },
      ipAddress,
      userAgent,
    });

    return {
      sessionId: session.id,
      accessToken,
      refreshToken,
    };
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    try {
      // Verify refresh token
      const payload = this.jwtService.verify(refreshToken) as RefreshTokenPayload;
      
      if (payload.tokenType !== 'refresh') {
        throw new UnauthorizedException('Invalid token type');
      }

      // Hash the refresh token to find the session
      const refreshTokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

      // Find session
      const session = await this.prisma.userSession.findFirst({
        where: {
          id: payload.sessionId,
          refreshTokenHash,
          expiresAt: { gt: new Date() },
          revokedAt: null,
        },
        include: {
          user: {
            include: { role: true },
          },
        },
      });

      if (!session) {
        throw new UnauthorizedException('Invalid or expired refresh token');
      }

      // Check if user is still active
      if (!session.user.isActive || session.user.isLocked) {
        throw new UnauthorizedException('User account is not active');
      }

      // Generate new tokens
      const accessTokenPayload: JwtPayload = {
        sub: session.userId,
        email: session.user.email,
        username: session.user.username,
        roleId: session.user.roleId,
        roleName: session.user.role.name,
        sessionId: session.id,
      };

      const newRefreshTokenPayload: RefreshTokenPayload = {
        sub: session.userId,
        sessionId: session.id,
        tokenType: 'refresh',
      };

      const newAccessToken = this.jwtService.sign(accessTokenPayload, { expiresIn: '24h' });
      const newRefreshToken = this.jwtService.sign(newRefreshTokenPayload, { expiresIn: '7d' });

      // Hash new tokens
      const newAccessTokenHash = crypto.createHash('sha256').update(newAccessToken).digest('hex');
      const newRefreshTokenHash = crypto.createHash('sha256').update(newRefreshToken).digest('hex');

      // Update session with new token hashes
      await this.prisma.userSession.update({
        where: { id: session.id },
        data: {
          accessTokenHash: newAccessTokenHash,
          refreshTokenHash: newRefreshTokenHash,
          lastActivityAt: new Date(),
        },
      });

      // Create audit log
      await this.auditService.createAuditEvent({
        userId: session.userId,
        action: 'token_refreshed',
        resource: 'session',
        resourceId: session.id,
        details: {
          sessionId: session.id,
        },
        ipAddress: session.ipAddress,
        userAgent: session.userAgent,
      });

      return {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
      };
    } catch (error) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }

  /**
   * Validate session by access token
   */
  async validateSession(accessToken: string): Promise<any> {
    try {
      const payload = this.jwtService.verify(accessToken) as JwtPayload;
      
      // Hash the access token to find the session
      const accessTokenHash = crypto.createHash('sha256').update(accessToken).digest('hex');

      // Find session
      const session = await this.prisma.userSession.findFirst({
        where: {
          id: payload.sessionId,
          accessTokenHash,
          expiresAt: { gt: new Date() },
          revokedAt: null,
        },
        include: {
          user: {
            include: { role: { include: { permissions: true } } },
          },
        },
      });

      if (!session) {
        throw new UnauthorizedException('Invalid session');
      }

      // Check if user is still active
      if (!session.user.isActive || session.user.isLocked) {
        throw new UnauthorizedException('User account is not active');
      }

      // Update last activity
      await this.prisma.userSession.update({
        where: { id: session.id },
        data: { lastActivityAt: new Date() },
      });

      return session.user;
    } catch (error) {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  /**
   * Get user's active sessions
   */
  async getUserSessions(userId: string, currentSessionId?: string): Promise<SessionResponseDto[]> {
    const sessions = await this.prisma.userSession.findMany({
      where: {
        userId,
        expiresAt: { gt: new Date() },
        revokedAt: null,
      },
      orderBy: { lastActivityAt: 'desc' },
    });

    return sessions.map(session => ({
      id: session.id,
      ipAddress: session.ipAddress,
      userAgent: session.userAgent,
      deviceFingerprint: session.deviceFingerprint || undefined,
      createdAt: session.createdAt,
      lastActivityAt: session.lastActivityAt,
      expiresAt: session.expiresAt,
      isCurrent: session.id === currentSessionId,
    }));
  }

  /**
   * Revoke a specific session
   */
  async revokeSession(
    sessionId: string,
    revokedBy: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<void> {
    const session = await this.prisma.userSession.findUnique({
      where: { id: sessionId },
      include: { user: true },
    });

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    // Check if user can revoke this session
    if (session.userId !== revokedBy) {
      // Only allow if revokedBy is admin or the session owner
      const revoker = await this.prisma.user.findUnique({
        where: { id: revokedBy },
        include: { role: true },
      });

      if (!revoker || (revoker.role.name !== 'SUPER_ADMIN' && revoker.role.name !== 'ADMIN')) {
        throw new UnauthorizedException('Cannot revoke this session');
      }
    }

    // Revoke session
    await this.prisma.userSession.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });

    // Create audit log
    await this.auditService.createAuditEvent({
      userId: revokedBy,
      action: 'session_revoked',
      resource: 'session',
      resourceId: sessionId,
      details: {
        sessionId,
        sessionOwner: session.user.email,
        revokedBy: revokedBy === session.userId ? 'self' : 'admin',
      },
      ipAddress,
      userAgent,
    });
  }

  /**
   * Revoke all sessions for a user
   */
  async revokeAllUserSessions(
    userId: string,
    revokedBy: string,
    excludeSessionId?: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<number> {
    const whereClause: any = {
      userId,
      revokedAt: null,
    };

    if (excludeSessionId) {
      whereClause.id = { not: excludeSessionId };
    }

    const sessions = await this.prisma.userSession.findMany({
      where: whereClause,
      select: { id: true },
    });

    if (sessions.length === 0) {
      return 0;
    }

    // Revoke all sessions
    await this.prisma.userSession.updateMany({
      where: whereClause,
      data: { revokedAt: new Date() },
    });

    // Create audit log
    await this.auditService.createAuditEvent({
      userId: revokedBy,
      action: 'all_sessions_revoked',
      resource: 'session',
      resourceId: userId,
      details: {
        targetUserId: userId,
        revokedSessionCount: sessions.length,
        excludedSessionId: excludeSessionId,
        revokedBy: revokedBy === userId ? 'self' : 'admin',
      },
      ipAddress,
      userAgent,
    });

    return sessions.length;
  }

  /**
   * Clean up expired sessions
   */
  async cleanupExpiredSessions(): Promise<number> {
    const result = await this.prisma.userSession.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: new Date() } },
          { revokedAt: { not: null } },
        ],
      },
    });

    if (result.count > 0) {
      this.logger.log(`Cleaned up ${result.count} expired/revoked sessions`);
    }

    return result.count;
  }

  /**
   * Get session statistics
   */
  async getSessionStats(): Promise<{
    totalActiveSessions: number;
    sessionsToday: number;
    topUserAgents: Array<{ userAgent: string; count: number }>;
    topIpAddresses: Array<{ ipAddress: string; count: number }>;
  }> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [totalActive, sessionsToday, userAgents, ipAddresses] = await Promise.all([
      this.prisma.userSession.count({
        where: {
          expiresAt: { gt: new Date() },
          revokedAt: null,
        },
      }),
      this.prisma.userSession.count({
        where: {
          createdAt: { gte: today },
        },
      }),
      this.prisma.userSession.groupBy({
        by: ['userAgent'],
        _count: { userAgent: true },
        where: {
          expiresAt: { gt: new Date() },
          revokedAt: null,
        },
        orderBy: { _count: { userAgent: 'desc' } },
        take: 10,
      }),
      this.prisma.userSession.groupBy({
        by: ['ipAddress'],
        _count: { ipAddress: true },
        where: {
          expiresAt: { gt: new Date() },
          revokedAt: null,
        },
        orderBy: { _count: { ipAddress: 'desc' } },
        take: 10,
      }),
    ]);

    return {
      totalActiveSessions: totalActive,
      sessionsToday,
      topUserAgents: userAgents.map(ua => ({
        userAgent: ua.userAgent,
        count: ua._count.userAgent,
      })),
      topIpAddresses: ipAddresses.map(ip => ({
        ipAddress: ip.ipAddress,
        count: ip._count.ipAddress,
      })),
    };
  }
}