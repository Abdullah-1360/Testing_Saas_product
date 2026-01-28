import { IsString, IsEnum, IsOptional, IsUUID, IsInt, Min, IsObject } from 'class-validator';
import { IncidentState } from '@prisma/client';

export class CreateIncidentEventDto {
  @IsUUID()
  incidentId: string;

  @IsString()
  eventType: string;

  @IsEnum(IncidentState)
  phase: IncidentState;

  @IsString()
  step: string;

  @IsOptional()
  @IsObject()
  data?: Record<string, any>;

  @IsOptional()
  @IsInt()
  @Min(0)
  duration?: number; // milliseconds
}