import { IsString, IsEnum, IsBoolean, IsOptional, IsObject, IsArray, IsUrl, IsDateString, ValidateNested, IsNumber, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { IntegrationType, WebhookEvent } from '../interfaces/integration.interface';

// Define RetryPolicyDto first to avoid circular dependency
export class RetryPolicyDto {
  @IsNumber()
  @Min(1)
  @Max(10)
  maxAttempts: number = 3;

  @IsNumber()
  @Min(1)
  @Max(10)
  backoffMultiplier: number = 2;

  @IsNumber()
  @Min(100)
  @Max(60000)
  initialDelayMs: number = 1000;

  @IsNumber()
  @Min(1000)
  @Max(300000)
  maxDelayMs: number = 30000;
}

export class CreateWebhookEndpointDto {
  @IsUrl()
  url: string;

  @IsOptional()
  @IsEnum(['POST', 'PUT', 'PATCH'])
  method?: 'POST' | 'PUT' | 'PATCH' = 'POST';

  @IsOptional()
  @IsObject()
  headers?: Record<string, string> = {};

  @IsArray()
  @IsEnum(WebhookEvent, { each: true })
  events: WebhookEvent[];

  @IsOptional()
  @ValidateNested()
  @Type(() => RetryPolicyDto)
  retryPolicy?: RetryPolicyDto;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean = true;
}

export class CreateIntegrationDto {
  @IsString()
  name: string;

  @IsEnum(IntegrationType)
  type: IntegrationType;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean = true;

  @IsOptional()
  @IsObject()
  configuration?: Record<string, any> = {};

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateWebhookEndpointDto)
  webhookEndpoints?: CreateWebhookEndpointDto[] = [];

  @IsOptional()
  @IsObject()
  notificationSettings?: any = {};
}

export class UpdateIntegrationDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsObject()
  configuration?: Record<string, any>;

  @IsOptional()
  @IsObject()
  notificationSettings?: any;
}

export class CreateApiKeyDto {
  @IsString()
  name: string;

  @IsArray()
  @IsString({ each: true })
  permissions: string[];

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

export class UpdateApiKeyDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  permissions?: string[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ExternalTriggerDto {
  @IsString()
  source: string;

  @IsString()
  eventType: string;

  @IsOptional()
  @IsString()
  siteId?: string;

  @IsOptional()
  @IsString()
  serverId?: string;

  @IsOptional()
  @IsEnum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

  @IsObject()
  metadata: Record<string, any>;

  @IsOptional()
  @IsDateString()
  timestamp?: string;
}

export class TestIntegrationDto {
  @IsString()
  integrationId: string;

  @IsOptional()
  @IsObject()
  testData?: Record<string, any>;
}

export class WebhookDeliveryDto {
  @IsString()
  endpointId: string;

  @IsEnum(WebhookEvent)
  event: WebhookEvent;

  @IsObject()
  data: any;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

export class NotificationDto {
  @IsString()
  channelType: string;

  @IsString()
  message: string;

  @IsOptional()
  @IsString()
  subject?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

// Response DTOs
export class IntegrationResponseDto {
  id: string;
  name: string;
  type: IntegrationType;
  enabled: boolean;
  configuration: Record<string, any>;
  webhookEndpoints: WebhookEndpointResponseDto[];
  notificationSettings: any;
  createdAt: Date;
  updatedAt: Date;
  stats: {
    totalWebhooks: number;
    successfulWebhooks: number;
    failedWebhooks: number;
    lastTriggered?: Date;
  };
}

export class WebhookEndpointResponseDto {
  id: string;
  url: string;
  method: string;
  events: WebhookEvent[];
  isActive: boolean;
  successCount: number;
  failureCount: number;
  lastTriggeredAt?: Date;
  retryPolicy: RetryPolicyDto;
}

export class ApiKeyResponseDto {
  id: string;
  name: string;
  permissions: string[];
  expiresAt?: Date;
  lastUsedAt?: Date;
  isActive: boolean;
  createdAt: Date;
  // Note: Never return the actual key or hash in responses
}

export class WebhookDeliveryResponseDto {
  id: string;
  endpointId: string;
  event: WebhookEvent;
  status: 'pending' | 'delivered' | 'failed' | 'retrying';
  attempts: number;
  lastAttemptAt: Date;
  nextRetryAt?: Date;
  response?: {
    statusCode: number;
    body: string;
    headers: Record<string, string>;
  };
  error?: string;
}