export interface IntegrationConfig {
  id: string;
  name: string;
  type: IntegrationType;
  enabled: boolean;
  configuration: Record<string, any>;
  apiKeys: ApiKeyConfig[];
  webhookEndpoints: WebhookEndpoint[];
  notificationSettings: NotificationSettings;
  createdAt: Date;
  updatedAt: Date;
}

export enum IntegrationType {
  WEBHOOK = 'WEBHOOK',
  SLACK = 'SLACK',
  DISCORD = 'DISCORD',
  EMAIL = 'EMAIL',
  TEAMS = 'TEAMS',
  PAGERDUTY = 'PAGERDUTY',
  CUSTOM = 'CUSTOM'
}

export interface ApiKeyConfig {
  id: string;
  name: string;
  keyHash: string;
  permissions: string[];
  expiresAt?: Date | null;
  lastUsedAt?: Date | null;
  isActive: boolean;
  createdAt: Date;
}

export interface WebhookEndpoint {
  id: string;
  url: string;
  method: 'POST' | 'PUT' | 'PATCH';
  headers: Record<string, string>;
  events: WebhookEvent[];
  retryPolicy: RetryPolicy;
  isActive: boolean;
  lastTriggeredAt?: Date | null;
  successCount: number;
  failureCount: number;
}

export enum WebhookEvent {
  INCIDENT_CREATED = 'incident.created',
  INCIDENT_UPDATED = 'incident.updated',
  INCIDENT_RESOLVED = 'incident.resolved',
  INCIDENT_ESCALATED = 'incident.escalated',
  SITE_HEALTH_CHANGED = 'site.health.changed',
  SYSTEM_STATUS_CHANGED = 'system.status.changed',
  BACKUP_CREATED = 'backup.created',
  ROLLBACK_EXECUTED = 'rollback.executed'
}

export interface RetryPolicy {
  maxAttempts: number;
  backoffMultiplier: number;
  initialDelayMs: number;
  maxDelayMs: number;
}

export interface NotificationSettings {
  channels: NotificationChannel[];
  filters: NotificationFilter[];
  templates: NotificationTemplate[];
}

export interface NotificationChannel {
  type: 'email' | 'slack' | 'discord' | 'teams' | 'sms';
  configuration: Record<string, any>;
  isActive: boolean;
}

export interface NotificationFilter {
  eventType: WebhookEvent;
  conditions: FilterCondition[];
}

export interface FilterCondition {
  field: string;
  operator: 'equals' | 'contains' | 'greater_than' | 'less_than' | 'in';
  value: any;
}

export interface NotificationTemplate {
  eventType: WebhookEvent;
  subject: string;
  body: string;
  format: 'text' | 'html' | 'markdown';
}

export interface WebhookPayload {
  id: string;
  event: WebhookEvent;
  timestamp: string;
  data: any;
  metadata: {
    source: 'wp-autohealer';
    version: string;
    environment: string;
  };
}

export interface ExternalTriggerPayload {
  source: string;
  eventType: string;
  siteId?: string;
  serverId?: string;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  metadata: Record<string, any>;
  timestamp: string;
}

export interface IntegrationServiceInterface {
  createIntegration(config: Partial<IntegrationConfig>): Promise<IntegrationConfig>;
  updateIntegration(id: string, updates: Partial<IntegrationConfig>): Promise<IntegrationConfig>;
  deleteIntegration(id: string): Promise<void>;
  getIntegration(id: string): Promise<IntegrationConfig | null>;
  listIntegrations(filters?: Record<string, any>): Promise<IntegrationConfig[]>;
  testIntegration(id: string): Promise<{ success: boolean; message: string; details?: any }>;
}

export interface WebhookServiceInterface {
  sendWebhook(endpointId: string, payload: WebhookPayload): Promise<{ success: boolean; response?: any; error?: string }>;
  processWebhookEvent(event: WebhookEvent, data: any): Promise<void>;
  validateWebhookSignature(payload: string, signature: string, secret: string): boolean;
  retryFailedWebhooks(): Promise<void>;
}

export interface NotificationServiceInterface {
  sendNotification(channelType: string, message: string, metadata?: Record<string, any>): Promise<void>;
  processNotificationEvent(event: WebhookEvent, data: any): Promise<void>;
  testNotificationChannel(channelId: string): Promise<{ success: boolean; message: string }>;
}

export interface ApiKeyServiceInterface {
  generateApiKey(name: string, permissions: string[], expiresAt?: Date): Promise<{ key: string; config: ApiKeyConfig }>;
  validateApiKey(key: string): Promise<{ valid: boolean; config?: ApiKeyConfig }>;
  revokeApiKey(keyId: string): Promise<void>;
  listApiKeys(filters?: Record<string, any>): Promise<ApiKeyConfig[]>;
  updateApiKeyPermissions(keyId: string, permissions: string[]): Promise<ApiKeyConfig>;
}