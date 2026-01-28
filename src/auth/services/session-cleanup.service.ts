import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AuthService } from './auth.service';

@Injectable()
export class SessionCleanupService {
  private readonly logger = new Logger(SessionCleanupService.name);

  constructor(private readonly authService: AuthService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async cleanupExpiredSessions() {
    this.logger.log('Starting cleanup of expired sessions');
    
    try {
      await this.authService.cleanupExpiredSessions();
      this.logger.log('Successfully cleaned up expired sessions');
    } catch (error) {
      this.logger.error('Failed to cleanup expired sessions', error);
    }
  }
}