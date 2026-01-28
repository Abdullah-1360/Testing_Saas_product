import { IsString, IsEnum, IsOptional, IsUUID, IsInt, Min, Max } from 'class-validator';
import { TriggerType, Priority } from '@prisma/client';

export class CreateIncidentDto {
  @IsUUID()
  siteId: string;

  @IsEnum(TriggerType)
  triggerType: TriggerType;

  @IsEnum(Priority)
  priority: Priority;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(15)
  maxFixAttempts?: number = 15;

  @IsOptional()
  @IsString()
  escalationReason?: string;

  @IsOptional()
  metadata?: Record<string, any>;
}