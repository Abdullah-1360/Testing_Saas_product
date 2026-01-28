import { IsEnum, IsOptional, IsString, IsInt, Min, Max, IsDateString } from 'class-validator';
import { IncidentState, Priority } from '@prisma/client';

export class UpdateIncidentDto {
  @IsOptional()
  @IsEnum(IncidentState)
  state?: IncidentState;

  @IsOptional()
  @IsEnum(Priority)
  priority?: Priority;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(15)
  fixAttempts?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(15)
  maxFixAttempts?: number;

  @IsOptional()
  @IsDateString()
  resolvedAt?: string;

  @IsOptional()
  @IsDateString()
  escalatedAt?: string;

  @IsOptional()
  @IsString()
  escalationReason?: string;
}