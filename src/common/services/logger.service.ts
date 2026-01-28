import { Injectable, LoggerService as NestLoggerService } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { RedactionService } from './redaction.service';

@Injectable()
export class LoggerService implements NestLoggerService {
  private readonly logger: winston.Logger;

  constructor(
    private readonly configService: ConfigService,
    private readonly redactionService: RedactionService
  ) {
    this.logger = this.createLogger();
  }

  private createLogger(): winston.Logger {
    const logLevel = this.configService.get<string>('LOG_LEVEL', 'info');
    const logFileEnabled = this.configService.get<boolean>('LOG_FILE_ENABLED', true);
    const logFilePath = this.configService.get<string>('LOG_FILE_PATH', 'logs/wp-autohealer.log');
    const logMaxFiles = this.configService.get<string>('LOG_MAX_FILES', '30');
    const logMaxSize = this.configService.get<string>('LOG_MAX_SIZE', '20m');

    const transports: winston.transport[] = [
      // Console transport
      new winston.transports.Console({
        level: logLevel,
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.colorize(),
          winston.format.printf(({ timestamp, level, message, context, ...meta }) => {
            const contextStr = context ? `[${context}] ` : '';
            const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
            return `${timestamp} ${level}: ${contextStr}${message}${metaStr}`;
          })
        ),
      }),
    ];

    // File transport (if enabled)
    if (logFileEnabled) {
      transports.push(
        new DailyRotateFile({
          level: logLevel,
          filename: logFilePath.replace('.log', '-%DATE%.log'),
          datePattern: 'YYYY-MM-DD',
          maxFiles: logMaxFiles,
          maxSize: logMaxSize,
          format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.json(),
            winston.format.printf((info) => {
              // Redact sensitive information before logging to file
              const redactedInfo = this.redactionService.redactObject(info);
              return JSON.stringify(redactedInfo);
            })
          ),
        })
      );

      // Error log file
      transports.push(
        new DailyRotateFile({
          level: 'error',
          filename: logFilePath.replace('.log', '-error-%DATE%.log'),
          datePattern: 'YYYY-MM-DD',
          maxFiles: logMaxFiles,
          maxSize: logMaxSize,
          format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.json(),
            winston.format.printf((info) => {
              const redactedInfo = this.redactionService.redactObject(info);
              return JSON.stringify(redactedInfo);
            })
          ),
        })
      );
    }

    return winston.createLogger({
      level: logLevel,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      transports,
      // Handle uncaught exceptions and unhandled rejections
      exceptionHandlers: logFileEnabled ? [
        new DailyRotateFile({
          filename: logFilePath.replace('.log', '-exceptions-%DATE%.log'),
          datePattern: 'YYYY-MM-DD',
          maxFiles: logMaxFiles,
          maxSize: logMaxSize,
        })
      ] : [],
      rejectionHandlers: logFileEnabled ? [
        new DailyRotateFile({
          filename: logFilePath.replace('.log', '-rejections-%DATE%.log'),
          datePattern: 'YYYY-MM-DD',
          maxFiles: logMaxFiles,
          maxSize: logMaxSize,
        })
      ] : [],
    });
  }

  log(message: any, context?: string): void {
    this.logger.info(message, { context });
  }

  error(message: any, trace?: string, context?: string): void {
    this.logger.error(message, { trace, context });
  }

  warn(message: any, context?: string): void {
    this.logger.warn(message, { context });
  }

  debug(message: any, context?: string): void {
    this.logger.debug(message, { context });
  }

  verbose(message: any, context?: string): void {
    this.logger.verbose(message, { context });
  }

  // Additional methods for structured logging
  logWithMetadata(level: string, message: string, metadata: Record<string, any>, context?: string): void {
    // Redact sensitive information from metadata
    const redactedMetadata = this.redactionService.redactObject(metadata);
    
    this.logger.log(level, message, {
      context,
      ...redactedMetadata,
    });
  }

  logCommand(command: string, result: any, context?: string): void {
    // Redact sensitive information from command and result
    const redactedCommand = this.redactionService.redactCommand(command);
    const redactedResult = this.redactionService.redactObject(result);

    this.logger.info('Command executed', {
      context: context || 'CommandExecution',
      command: redactedCommand,
      result: redactedResult,
    });
  }

  logSecurityEvent(event: string, details: Record<string, any>, context?: string): void {
    // Security events should be logged with high priority
    const redactedDetails = this.redactionService.redactObject(details);
    
    this.logger.warn(`SECURITY EVENT: ${event}`, {
      context: context || 'Security',
      event,
      details: redactedDetails,
      timestamp: new Date().toISOString(),
    });
  }

  logAuditEvent(action: string, resource: string, details: Record<string, any>, context?: string): void {
    // Audit events for compliance tracking
    const redactedDetails = this.redactionService.redactObject(details);
    
    this.logger.info('Audit event', {
      context: context || 'Audit',
      action,
      resource,
      details: redactedDetails,
      timestamp: new Date().toISOString(),
    });
  }

  logIncidentEvent(incidentId: string, phase: string, event: string, details: Record<string, any>): void {
    // Incident-specific logging
    const redactedDetails = this.redactionService.redactObject(details);
    
    this.logger.info('Incident event', {
      context: 'Incident',
      incidentId,
      phase,
      event,
      details: redactedDetails,
      timestamp: new Date().toISOString(),
    });
  }
}