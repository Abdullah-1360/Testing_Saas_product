import { IsString, IsEnum, IsOptional, IsUUID, IsObject, IsArray } from 'class-validator';
import { Priority } from '@prisma/client';

export class EscalationTicketDto {
  @IsUUID()
  incidentId: string;

  @IsString()
  title: string;

  @IsString()
  description: string;

  @IsEnum(Priority)
  priority: Priority;

  @IsString()
  reason: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;

  @IsOptional()
  @IsString()
  assignee?: string;

  @IsOptional()
  @IsString()
  externalTicketId?: string;
}

export class TicketPayloadDto {
  incident: {
    id: string;
    siteId: string;
    domain: string;
    state: string;
    priority: Priority;
    fixAttempts: number;
    createdAt: Date;
    escalatedAt: Date;
    escalationReason: string;
  };
  
  timeline: Array<{
    eventType: string;
    phase: string;
    step: string;
    timestamp: Date;
    duration?: number;
    data?: Record<string, any>;
  }>;

  evidence: Array<{
    type: string;
    signature: string;
    timestamp: Date;
    metadata?: Record<string, any>;
  }>;

  commands: Array<{
    command: string;
    exitCode: number;
    executionTime: number;
    timestamp: Date;
  }>;

  backups: Array<{
    artifactType: string;
    filePath: string;
    checksum: string;
    size: number;
    createdAt: Date;
  }>;

  changes: Array<{
    filePath: string;
    changeType: string;
    checksum: string;
    timestamp: Date;
  }>;
}