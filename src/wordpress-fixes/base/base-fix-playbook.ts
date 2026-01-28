import { Logger } from '@nestjs/common';
import { 
  IFixPlaybook, 
  FixTier, 
  FixPriority, 
  FixContext, 
  FixResult, 
  FixEvidence, 
  RollbackPlan,
  FixChange,
  RollbackStep
} from '../interfaces/fix-playbook.interface';
import { SSHService } from '../../ssh/services/ssh.service';
import { BackupService } from '../../backup/services/backup.service';
import { EvidenceService } from '../../evidence/services/evidence.service';

export abstract class BaseFixPlaybook implements IFixPlaybook {
  protected readonly logger = new Logger(this.constructor.name);

  abstract readonly name: string;
  abstract readonly tier: FixTier;
  abstract readonly priority: FixPriority;
  abstract readonly description: string;
  abstract readonly applicableConditions: string[];

  constructor(
    protected readonly sshService: SSHService,
    protected readonly backupService: BackupService,
    protected readonly evidenceService: EvidenceService,
  ) {}

  abstract canApply(context: FixContext, evidence: FixEvidence[]): Promise<boolean>;
  abstract apply(context: FixContext): Promise<FixResult>;
  abstract rollback(context: FixContext, rollbackPlan: RollbackPlan): Promise<boolean>;
  abstract getHypothesis(context: FixContext, evidence: FixEvidence[]): string;

  /**
   * Execute a command safely with logging and error handling
   */
  protected async executeCommand(
    context: FixContext,
    command: string,
    description: string
  ): Promise<{ success: boolean; stdout: string; stderr: string; exitCode: number }> {
    try {
      this.logger.log(`Executing command for ${context.incidentId}: ${description}`);
      
      const connection = await this.sshService.getConnection(context.serverId);
      const result = await this.sshService.executeCommand(connection, command);
      
      // Log command execution as evidence
      await this.evidenceService.collectEvidence(context.incidentId, {
        type: 'command_output',
        description: `Command: ${description}`,
        content: JSON.stringify({
          command,
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
        }),
        signature: this.generateSignature(command + result.stdout + result.stderr),
        timestamp: new Date(),
        metadata: {
          command,
          description,
          correlationId: context.correlationId,
        },
      });

      return {
        success: result.exitCode === 0,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      };
    } catch (error) {
      this.logger.error(`Command execution failed for ${context.incidentId}:`, error);
      return {
        success: false,
        stdout: '',
        stderr: error instanceof Error ? error.message : 'Unknown error',
        exitCode: -1,
      };
    }
  }

  /**
   * Create a backup before making changes
   */
  protected async createBackup(
    context: FixContext,
    filePath: string,
    description: string
  ): Promise<string | null> {
    try {
      this.logger.log(`Creating backup for ${context.incidentId}: ${description}`);
      
      const backupPath = await this.backupService.createFileBackup(
        context.incidentId,
        context.serverId,
        filePath,
        {
          description,
          correlationId: context.correlationId,
          metadata: {
            originalPath: filePath,
            playbookName: this.name,
          },
        }
      );

      return backupPath;
    } catch (error) {
      this.logger.error(`Backup creation failed for ${context.incidentId}:`, error);
      return null;
    }
  }

  /**
   * Generate a signature for content
   */
  protected generateSignature(content: string): string {
    // Simple hash for now - in production, use crypto.createHash
    return Buffer.from(content).toString('base64').substring(0, 32);
  }

  /**
   * Check if a file exists
   */
  protected async fileExists(context: FixContext, filePath: string): Promise<boolean> {
    const result = await this.executeCommand(
      context,
      `test -f "${filePath}" && echo "exists" || echo "not_found"`,
      `Check if file exists: ${filePath}`
    );
    
    return result.success && result.stdout.trim() === 'exists';
  }

  /**
   * Get file content
   */
  protected async getFileContent(context: FixContext, filePath: string): Promise<string | null> {
    const result = await this.executeCommand(
      context,
      `cat "${filePath}"`,
      `Read file content: ${filePath}`
    );
    
    return result.success ? result.stdout : null;
  }

  /**
   * Write content to file with backup
   */
  protected async writeFileWithBackup(
    context: FixContext,
    filePath: string,
    content: string,
    description: string
  ): Promise<FixChange | null> {
    // Create backup first
    const backupPath = await this.createBackup(context, filePath, `Backup before: ${description}`);
    if (!backupPath) {
      this.logger.error(`Failed to create backup for ${filePath}`);
      return null;
    }

    // Get original content for change tracking
    const originalContent = await this.getFileContent(context, filePath);

    // Write new content
    const writeResult = await this.executeCommand(
      context,
      `cat > "${filePath}" << 'EOF'\n${content}\nEOF`,
      description
    );

    if (!writeResult.success) {
      this.logger.error(`Failed to write file ${filePath}: ${writeResult.stderr}`);
      return null;
    }

    return {
      type: 'file',
      description,
      path: filePath,
      originalValue: originalContent || '',
      newValue: content,
      checksum: this.generateSignature(content),
      timestamp: new Date(),
    };
  }

  /**
   * Create a rollback step for file restoration
   */
  protected createFileRollbackStep(
    filePath: string,
    backupPath: string,
    order: number
  ): RollbackStep {
    return {
      type: 'restore_file',
      description: `Restore ${filePath} from backup`,
      action: `cp "${backupPath}" "${filePath}"`,
      parameters: {
        originalPath: filePath,
        backupPath,
      },
      order,
    };
  }

  /**
   * Create a rollback step for command execution
   */
  protected createCommandRollbackStep(
    command: string,
    description: string,
    order: number
  ): RollbackStep {
    return {
      type: 'execute_command',
      description,
      action: command,
      parameters: {
        command,
      },
      order,
    };
  }
}