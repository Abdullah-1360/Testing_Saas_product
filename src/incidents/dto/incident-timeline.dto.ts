import { IsOptional, IsDateString, IsEnum, IsString, IsUUID } from 'class-validator';
import { IncidentState } from '@prisma/client';

export class IncidentTimelineQueryDto {
  @IsOptional()
  @IsUUID()
  incidentId?: string;

  @IsOptional()
  @IsEnum(IncidentState)
  phase?: IncidentState;

  @IsOptional()
  @IsString()
  eventType?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}

export class IncidentTimelineResponseDto {
  id: string;
  incidentId: string;
  eventType: string;
  phase: IncidentState;
  step: string;
  data?: Record<string, any>;
  timestamp: Date;
  duration?: number;
}