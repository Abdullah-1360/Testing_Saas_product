import { IsOptional, IsString, IsDateString, IsUUID, IsObject, IsIP } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateAuditEventDto {
  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsString()
  action: string;

  @IsString()
  resource: string;

  @IsOptional()
  @IsString()
  resourceId?: string;

  @IsOptional()
  @IsObject()
  details?: Record<string, any>;

  @IsOptional()
  @IsIP()
  ipAddress?: string;

  @IsOptional()
  @IsString()
  userAgent?: string;

  @IsOptional()
  @IsString()
  traceId?: string;

  @IsOptional()
  @IsString()
  correlationId?: string;
}

export class AuditEventFilterDto {
  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsString()
  action?: string;

  @IsOptional()
  @IsString()
  resourceType?: string;

  @IsOptional()
  @IsString()
  resourceId?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsIP()
  ipAddress?: string;

  @IsOptional()
  @IsString()
  traceId?: string;

  @IsOptional()
  @IsString()
  correlationId?: string;
}

export class AuditEventResponseDto {
  id: string;
  userId?: string;
  action: string;
  resource: string;
  resourceId?: string;
  details?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  timestamp: Date;
  user?: {
    id: string;
    email: string;
    role: string;
  };
}

export class PaginatedAuditEventsDto {
  events: AuditEventResponseDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export class AuditStatisticsDto {
  totalEvents: number;
  eventsByAction: Record<string, number>;
  eventsByResourceType: Record<string, number>;
  eventsByUser: Record<string, number>;
  recentEvents: AuditEventResponseDto[];
}