export class Site {
  id!: string;
  serverId!: string;
  domain!: string;
  documentRoot!: string;
  wordpressPath!: string;
  isMultisite!: boolean;
  siteUrl!: string;
  adminUrl!: string;
  isActive!: boolean;
  lastHealthCheck?: Date | null;
  createdAt!: Date;
  updatedAt!: Date;

  constructor(partial: Partial<Site>) {
    Object.assign(this, partial);
  }

  // Helper method to check if site needs health check
  needsHealthCheck(intervalMinutes: number = 30): boolean {
    if (!this.lastHealthCheck) {
      return true;
    }
    
    const now = new Date();
    const timeDiff = now.getTime() - this.lastHealthCheck.getTime();
    const minutesDiff = timeDiff / (1000 * 60);
    
    return minutesDiff >= intervalMinutes;
  }

  // Helper method to get site without sensitive data
  toSafeObject() {
    return {
      id: this.id,
      serverId: this.serverId,
      domain: this.domain,
      documentRoot: this.documentRoot,
      wordpressPath: this.wordpressPath,
      isMultisite: this.isMultisite,
      siteUrl: this.siteUrl,
      adminUrl: this.adminUrl,
      isActive: this.isActive,
      lastHealthCheck: this.lastHealthCheck,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  // Helper method to check if site is WordPress
  isWordPressSite(): boolean {
    return Boolean(this.wordpressPath && this.wordpressPath.length > 0);
  }

  // Helper method to get WordPress admin login URL
  getWpLoginUrl(): string {
    return `${this.adminUrl}/wp-login.php`;
  }

  // Helper method to get site health status description
  getHealthStatusDescription(lastCheck?: Date): string {
    if (!this.isActive) {
      return 'Monitoring disabled';
    }
    
    if (!lastCheck || !this.lastHealthCheck) {
      return 'Never checked';
    }
    
    const now = new Date();
    const timeDiff = now.getTime() - this.lastHealthCheck.getTime();
    const minutesDiff = Math.floor(timeDiff / (1000 * 60));
    
    if (minutesDiff < 1) {
      return 'Just checked';
    } else if (minutesDiff < 60) {
      return `Checked ${minutesDiff} minutes ago`;
    } else {
      const hoursDiff = Math.floor(minutesDiff / 60);
      return `Checked ${hoursDiff} hours ago`;
    }
  }
}