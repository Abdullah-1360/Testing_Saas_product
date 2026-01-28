import { Injectable, Logger } from '@nestjs/common';

export interface FlappingConfig {
  cooldownWindow: number; // milliseconds
  maxIncidentsPerWindow: number;
  escalationThreshold: number;
}

export interface FlappingStats {
  siteId: string;
  incidentCount: number;
  firstIncidentTime: Date;
  lastIncidentTime: Date;
  cooldownUntil?: Date | undefined;
  isFlapping: boolean;
  shouldEscalate: boolean;
}

@Injectable()
export class FlappingPreventionService {
  private readonly logger = new Logger(FlappingPreventionService.name);
  private flappingData: Map<string, FlappingStats> = new Map();
  private config: FlappingConfig;

  constructor() {
    // Default configuration - can be overridden via environment variables
    this.config = {
      cooldownWindow: 10 * 60 * 1000, // 10 minutes
      maxIncidentsPerWindow: 3,
      escalationThreshold: 5,
    };
  }

  /**
   * Update flapping prevention configuration
   */
  updateConfig(config: Partial<FlappingConfig>): void {
    this.config = { ...this.config, ...config };
    this.logger.log('Flapping prevention config updated', this.config);
  }

  /**
   * Check if a new incident should be allowed for a site
   */
  canCreateIncident(siteId: string): {
    allowed: boolean;
    reason?: string;
    cooldownUntil?: Date;
    shouldEscalate?: boolean;
  } {
    const stats = this.getOrCreateStats(siteId);
    const now = new Date();

    // Clean up old data outside the window
    this.cleanupOldData(siteId);

    // Check if site is in cooldown
    if (stats.cooldownUntil && now < stats.cooldownUntil) {
      return {
        allowed: false,
        reason: 'Site is in cooldown period due to flapping',
        cooldownUntil: stats.cooldownUntil,
        shouldEscalate: stats.shouldEscalate,
      };
    }

    // Check if we're approaching the flapping threshold
    if (stats.incidentCount >= this.config.maxIncidentsPerWindow) {
      // Site is flapping - apply cooldown
      stats.isFlapping = true;
      stats.cooldownUntil = new Date(now.getTime() + this.config.cooldownWindow);
      
      // Check if we should escalate
      if (stats.incidentCount >= this.config.escalationThreshold) {
        stats.shouldEscalate = true;
        this.logger.warn(`Site ${siteId} exceeded escalation threshold (${stats.incidentCount} incidents)`, {
          escalationThreshold: this.config.escalationThreshold,
          cooldownUntil: stats.cooldownUntil,
        });
      }

      this.logger.warn(`Site ${siteId} is flapping - cooldown applied`, {
        incidentCount: stats.incidentCount,
        maxIncidentsPerWindow: this.config.maxIncidentsPerWindow,
        cooldownUntil: stats.cooldownUntil,
      });

      return {
        allowed: false,
        reason: 'Site is flapping - too many incidents in time window',
        cooldownUntil: stats.cooldownUntil,
        shouldEscalate: stats.shouldEscalate,
      };
    }

    return { allowed: true };
  }

  /**
   * Record a new incident for a site
   */
  recordIncident(siteId: string, incidentId: string): void {
    const stats = this.getOrCreateStats(siteId);
    const now = new Date();

    // Clean up old data first
    this.cleanupOldData(siteId);

    // If this is the first incident in the window, reset the window
    if (stats.incidentCount === 0) {
      stats.firstIncidentTime = now;
    }

    stats.incidentCount++;
    stats.lastIncidentTime = now;

    this.logger.log(`Recorded incident ${incidentId} for site ${siteId}`, {
      incidentCount: stats.incidentCount,
      maxIncidentsPerWindow: this.config.maxIncidentsPerWindow,
      windowStart: stats.firstIncidentTime,
    });

    // Update flapping status
    stats.isFlapping = stats.incidentCount >= this.config.maxIncidentsPerWindow;
  }

  /**
   * Record incident resolution (helps with flapping detection)
   */
  recordResolution(siteId: string, incidentId: string, successful: boolean): void {
    const stats = this.flappingData.get(siteId);
    if (!stats) {
      return;
    }

    this.logger.log(`Recorded resolution for incident ${incidentId} on site ${siteId}`, {
      successful,
      currentIncidentCount: stats.incidentCount,
    });

    // If resolution was successful and we're not in active flapping, reduce incident count
    if (successful && !stats.isFlapping) {
      stats.incidentCount = Math.max(0, stats.incidentCount - 1);
    }
  }

  /**
   * Get flapping statistics for a site
   */
  getStats(siteId: string): FlappingStats | null {
    const stats = this.flappingData.get(siteId);
    return stats ? { ...stats } : null;
  }

  /**
   * Get flapping statistics for all sites
   */
  getAllStats(): Record<string, FlappingStats> {
    const allStats: Record<string, FlappingStats> = {};
    for (const [siteId, stats] of this.flappingData.entries()) {
      allStats[siteId] = { ...stats };
    }
    return allStats;
  }

  /**
   * Get sites currently in cooldown
   */
  getSitesInCooldown(): string[] {
    const now = new Date();
    const sitesInCooldown: string[] = [];

    for (const [siteId, stats] of this.flappingData.entries()) {
      if (stats.cooldownUntil && now < stats.cooldownUntil) {
        sitesInCooldown.push(siteId);
      }
    }

    return sitesInCooldown;
  }

  /**
   * Get sites that should be escalated
   */
  getSitesForEscalation(): string[] {
    const sitesForEscalation: string[] = [];

    for (const [siteId, stats] of this.flappingData.entries()) {
      if (stats.shouldEscalate) {
        sitesForEscalation.push(siteId);
      }
    }

    return sitesForEscalation;
  }

  /**
   * Reset flapping data for a site (e.g., after manual intervention)
   */
  resetSite(siteId: string): void {
    this.flappingData.delete(siteId);
    this.logger.log(`Reset flapping data for site ${siteId}`);
  }

  /**
   * Clear cooldown for a site (e.g., after manual verification)
   */
  clearCooldown(siteId: string): void {
    const stats = this.flappingData.get(siteId);
    if (stats) {
      stats.cooldownUntil = undefined;
      stats.isFlapping = false;
      stats.shouldEscalate = false;
      this.logger.log(`Cleared cooldown for site ${siteId}`);
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): FlappingConfig {
    return { ...this.config };
  }

  /**
   * Clean up expired data and perform maintenance
   */
  performMaintenance(): void {
    const now = new Date();
    const expiredSites: string[] = [];

    for (const [siteId, stats] of this.flappingData.entries()) {
      // Clean up old data
      this.cleanupOldData(siteId);

      // Remove sites with no recent activity
      const timeSinceLastIncident = now.getTime() - stats.lastIncidentTime.getTime();
      const maxAge = this.config.cooldownWindow * 3; // Keep data for 3x cooldown window

      if (timeSinceLastIncident > maxAge && stats.incidentCount === 0) {
        expiredSites.push(siteId);
      }
    }

    // Remove expired sites
    for (const siteId of expiredSites) {
      this.flappingData.delete(siteId);
    }

    if (expiredSites.length > 0) {
      this.logger.log(`Cleaned up flapping data for ${expiredSites.length} expired sites`);
    }
  }

  /**
   * Get or create flapping stats for a site
   */
  private getOrCreateStats(siteId: string): FlappingStats {
    if (!this.flappingData.has(siteId)) {
      const now = new Date();
      this.flappingData.set(siteId, {
        siteId,
        incidentCount: 0,
        firstIncidentTime: now,
        lastIncidentTime: now,
        isFlapping: false,
        shouldEscalate: false,
      });
    }
    return this.flappingData.get(siteId)!;
  }

  /**
   * Clean up old incident data outside the current window
   */
  private cleanupOldData(siteId: string): void {
    const stats = this.flappingData.get(siteId);
    if (!stats) {
      return;
    }

    const now = new Date();
    const windowStart = now.getTime() - this.config.cooldownWindow;

    // If the first incident is outside the window, reset the window
    if (stats.firstIncidentTime.getTime() < windowStart) {
      // Check if last incident is also outside the window
      if (stats.lastIncidentTime.getTime() < windowStart) {
        // All incidents are outside the window - reset everything
        stats.incidentCount = 0;
        stats.firstIncidentTime = now;
        stats.lastIncidentTime = now;
        stats.isFlapping = false;
        
        // Don't reset shouldEscalate - it persists until manual intervention
      } else {
        // Some incidents are still in the window - adjust count
        // This is a simplified approach; in practice, you might want to track individual incident timestamps
        stats.incidentCount = Math.max(1, Math.floor(stats.incidentCount / 2));
        stats.firstIncidentTime = new Date(windowStart);
      }
    }

    // Clear cooldown if expired
    if (stats.cooldownUntil && now >= stats.cooldownUntil) {
      stats.cooldownUntil = undefined;
      stats.isFlapping = false;
      this.logger.log(`Cooldown expired for site ${siteId}`);
    }
  }
}