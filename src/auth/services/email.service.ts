import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { EncryptionService } from '@/common/services/encryption.service';
import * as nodemailer from 'nodemailer';
import { SmtpConfigDto } from '../dto/smtp-config.dto';

export interface EmailTemplate {
  subject: string;
  html: string;
  text: string;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryptionService: EncryptionService,
  ) {
    this.initializeTransporter();
  }

  /**
   * Initialize email transporter with current SMTP config
   */
  private async initializeTransporter(): Promise<void> {
    try {
      const config = await this.getActiveSmtpConfig();
      if (config) {
        this.transporter = nodemailer.createTransport({
          host: config.host,
          port: config.port,
          secure: config.port === 465, // true for 465, false for other ports
          auth: {
            user: config.username,
            pass: config.password,
          },
          tls: {
            rejectUnauthorized: config.useTls,
          },
        });
        this.logger.log('Email transporter initialized successfully');
      }
    } catch (error) {
      this.logger.warn('Failed to initialize email transporter:', error);
    }
  }

  /**
   * Get active SMTP configuration
   */
  private async getActiveSmtpConfig(): Promise<any | null> {
    const config = await this.prisma.smtpConfig.findFirst({
      where: { isActive: true },
    });

    if (!config) return null;

    // Decrypt password
    const decryptedPassword = this.encryptionService.decrypt(config.password);

    return {
      ...config,
      password: decryptedPassword,
    };
  }

  /**
   * Save SMTP configuration
   */
  async saveSmtpConfig(configDto: SmtpConfigDto): Promise<void> {
    // Encrypt password
    const encryptedPassword = this.encryptionService.encrypt(configDto.password);

    // Deactivate existing configs
    await this.prisma.smtpConfig.updateMany({
      where: { isActive: true },
      data: { isActive: false },
    });

    // Create new config
    await this.prisma.smtpConfig.create({
      data: {
        ...configDto,
        password: encryptedPassword,
        isActive: true,
      },
    });

    // Reinitialize transporter
    await this.initializeTransporter();
  }

  /**
   * Get current SMTP configuration (without password)
   */
  async getSmtpConfig(): Promise<Omit<SmtpConfigDto, 'password'> | null> {
    const config = await this.prisma.smtpConfig.findFirst({
      where: { isActive: true },
    });

    if (!config) return null;

    const { password, ...safeConfig } = config;
    return safeConfig;
  }

  /**
   * Test email configuration
   */
  async testEmailConfig(testEmail: string): Promise<void> {
    if (!this.transporter) {
      throw new BadRequestException('Email not configured');
    }

    const template = this.getTestEmailTemplate();
    
    await this.sendEmail(testEmail, template.subject, template.html, template.text);
  }

  /**
   * Send email
   */
  private async sendEmail(to: string, subject: string, html: string, text: string): Promise<void> {
    if (!this.transporter) {
      this.logger.warn(`Email not configured, skipping email to ${to}: ${subject}`);
      return;
    }

    const config = await this.getActiveSmtpConfig();
    if (!config) {
      this.logger.warn('No active SMTP configuration found');
      return;
    }

    try {
      await this.transporter.sendMail({
        from: `"${config.fromName}" <${config.fromAddress}>`,
        to,
        subject,
        text,
        html,
      });

      this.logger.log(`Email sent successfully to ${to}: ${subject}`);
    } catch (error) {
      this.logger.error(`Failed to send email to ${to}: ${subject}`, error);
      throw new BadRequestException('Failed to send email');
    }
  }

  /**
   * Send welcome email to new user
   */
  async sendWelcomeEmail(email: string, username: string, temporaryPassword: string): Promise<void> {
    const template = this.getWelcomeEmailTemplate(username, temporaryPassword);
    await this.sendEmail(email, template.subject, template.html, template.text);
  }

  /**
   * Send password reset email
   */
  async sendPasswordResetEmail(email: string, username: string, resetToken: string): Promise<void> {
    const template = this.getPasswordResetEmailTemplate(username, resetToken);
    await this.sendEmail(email, template.subject, template.html, template.text);
  }

  /**
   * Send password changed notification
   */
  async sendPasswordChangedEmail(email: string, username: string): Promise<void> {
    const template = this.getPasswordChangedEmailTemplate(username);
    await this.sendEmail(email, template.subject, template.html, template.text);
  }

  /**
   * Send account locked notification
   */
  async sendAccountLockedEmail(email: string, username: string, lockoutUntil: Date): Promise<void> {
    const template = this.getAccountLockedEmailTemplate(username, lockoutUntil);
    await this.sendEmail(email, template.subject, template.html, template.text);
  }

  /**
   * Send MFA enabled notification
   */
  async sendMfaEnabledEmail(email: string, username: string): Promise<void> {
    const template = this.getMfaEnabledEmailTemplate(username);
    await this.sendEmail(email, template.subject, template.html, template.text);
  }

  /**
   * Send MFA disabled notification
   */
  async sendMfaDisabledEmail(email: string, username: string): Promise<void> {
    const template = this.getMfaDisabledEmailTemplate(username);
    await this.sendEmail(email, template.subject, template.html, template.text);
  }

  /**
   * Send backup code warning
   */
  async sendBackupCodeWarningEmail(email: string, username: string, remainingCodes: number): Promise<void> {
    const template = this.getBackupCodeWarningEmailTemplate(username, remainingCodes);
    await this.sendEmail(email, template.subject, template.html, template.text);
  }

  /**
   * Send email verification
   */
  async sendEmailVerification(email: string, username: string, verificationToken: string): Promise<void> {
    const template = this.getEmailVerificationTemplate(username, verificationToken);
    await this.sendEmail(email, template.subject, template.html, template.text);
  }

  /**
   * Send backup codes regenerated notification
   */
  async sendBackupCodesRegeneratedEmail(email: string, username: string): Promise<void> {
    const template = this.getBackupCodesRegeneratedEmailTemplate(username);
    await this.sendEmail(email, template.subject, template.html, template.text);
  }

  /**
   * Send role changed notification
   */
  async sendRoleChangedEmail(email: string, username: string, newRole: string): Promise<void> {
    const template = this.getRoleChangedEmailTemplate(username, newRole);
    await this.sendEmail(email, template.subject, template.html, template.text);
  }

  // Email Templates

  private getTestEmailTemplate(): EmailTemplate {
    return {
      subject: 'WP-AutoHealer - Email Configuration Test',
      html: `
        <h2>Email Configuration Test</h2>
        <p>This is a test email to verify your SMTP configuration is working correctly.</p>
        <p>If you received this email, your email settings are configured properly.</p>
        <hr>
        <p><small>WP-AutoHealer System</small></p>
      `,
      text: 'Email Configuration Test\n\nThis is a test email to verify your SMTP configuration is working correctly.\n\nIf you received this email, your email settings are configured properly.\n\nWP-AutoHealer System',
    };
  }

  private getWelcomeEmailTemplate(username: string, temporaryPassword: string): EmailTemplate {
    return {
      subject: 'Welcome to WP-AutoHealer - Account Created',
      html: `
        <h2>Welcome to WP-AutoHealer!</h2>
        <p>Hello ${username},</p>
        <p>Your account has been created successfully. Here are your login credentials:</p>
        <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <strong>Username:</strong> ${username}<br>
          <strong>Temporary Password:</strong> <code>${temporaryPassword}</code>
        </div>
        <p><strong>Important:</strong> You must change this password on your first login for security reasons.</p>
        <p>You can log in at: <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/login">WP-AutoHealer Login</a></p>
        <hr>
        <p><small>WP-AutoHealer System</small></p>
      `,
      text: `Welcome to WP-AutoHealer!\n\nHello ${username},\n\nYour account has been created successfully. Here are your login credentials:\n\nUsername: ${username}\nTemporary Password: ${temporaryPassword}\n\nImportant: You must change this password on your first login for security reasons.\n\nYou can log in at: ${process.env.FRONTEND_URL || 'http://localhost:3000'}/login\n\nWP-AutoHealer System`,
    };
  }

  private getPasswordResetEmailTemplate(username: string, resetToken: string): EmailTemplate {
    const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/auth/reset-password?token=${resetToken}`;
    
    return {
      subject: 'WP-AutoHealer - Password Reset Request',
      html: `
        <h2>Password Reset Request</h2>
        <p>Hello ${username},</p>
        <p>You have requested to reset your password. Click the link below to set a new password:</p>
        <p><a href="${resetUrl}" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Reset Password</a></p>
        <p>This link will expire in 1 hour for security reasons.</p>
        <p>If you did not request this password reset, please ignore this email.</p>
        <hr>
        <p><small>WP-AutoHealer System</small></p>
      `,
      text: `Password Reset Request\n\nHello ${username},\n\nYou have requested to reset your password. Visit the following link to set a new password:\n\n${resetUrl}\n\nThis link will expire in 1 hour for security reasons.\n\nIf you did not request this password reset, please ignore this email.\n\nWP-AutoHealer System`,
    };
  }

  private getPasswordChangedEmailTemplate(username: string): EmailTemplate {
    return {
      subject: 'WP-AutoHealer - Password Changed',
      html: `
        <h2>Password Changed Successfully</h2>
        <p>Hello ${username},</p>
        <p>Your password has been changed successfully.</p>
        <p>If you did not make this change, please contact your administrator immediately.</p>
        <hr>
        <p><small>WP-AutoHealer System</small></p>
      `,
      text: `Password Changed Successfully\n\nHello ${username},\n\nYour password has been changed successfully.\n\nIf you did not make this change, please contact your administrator immediately.\n\nWP-AutoHealer System`,
    };
  }

  private getAccountLockedEmailTemplate(username: string, lockoutUntil: Date): EmailTemplate {
    return {
      subject: 'WP-AutoHealer - Account Locked',
      html: `
        <h2>Account Locked</h2>
        <p>Hello ${username},</p>
        <p>Your account has been locked due to multiple failed login attempts.</p>
        <p>Your account will be automatically unlocked at: <strong>${lockoutUntil.toLocaleString()}</strong></p>
        <p>If you believe this is an error, please contact your administrator.</p>
        <hr>
        <p><small>WP-AutoHealer System</small></p>
      `,
      text: `Account Locked\n\nHello ${username},\n\nYour account has been locked due to multiple failed login attempts.\n\nYour account will be automatically unlocked at: ${lockoutUntil.toLocaleString()}\n\nIf you believe this is an error, please contact your administrator.\n\nWP-AutoHealer System`,
    };
  }

  private getMfaEnabledEmailTemplate(username: string): EmailTemplate {
    return {
      subject: 'WP-AutoHealer - Multi-Factor Authentication Enabled',
      html: `
        <h2>Multi-Factor Authentication Enabled</h2>
        <p>Hello ${username},</p>
        <p>Multi-factor authentication has been enabled on your account for enhanced security.</p>
        <p>You will now need to provide a verification code from your authenticator app when logging in.</p>
        <hr>
        <p><small>WP-AutoHealer System</small></p>
      `,
      text: `Multi-Factor Authentication Enabled\n\nHello ${username},\n\nMulti-factor authentication has been enabled on your account for enhanced security.\n\nYou will now need to provide a verification code from your authenticator app when logging in.\n\nWP-AutoHealer System`,
    };
  }

  private getMfaDisabledEmailTemplate(username: string): EmailTemplate {
    return {
      subject: 'WP-AutoHealer - Multi-Factor Authentication Disabled',
      html: `
        <h2>Multi-Factor Authentication Disabled</h2>
        <p>Hello ${username},</p>
        <p>Multi-factor authentication has been disabled on your account.</p>
        <p>If you did not make this change, please contact your administrator immediately.</p>
        <hr>
        <p><small>WP-AutoHealer System</small></p>
      `,
      text: `Multi-Factor Authentication Disabled\n\nHello ${username},\n\nMulti-factor authentication has been disabled on your account.\n\nIf you did not make this change, please contact your administrator immediately.\n\nWP-AutoHealer System`,
    };
  }

  private getBackupCodeWarningEmailTemplate(username: string, remainingCodes: number): EmailTemplate {
    return {
      subject: 'WP-AutoHealer - Low Backup Codes Warning',
      html: `
        <h2>Low Backup Codes Warning</h2>
        <p>Hello ${username},</p>
        <p>You have only <strong>${remainingCodes}</strong> backup codes remaining for your multi-factor authentication.</p>
        <p>We recommend generating new backup codes to ensure you don't lose access to your account.</p>
        <p>You can generate new backup codes in your account settings.</p>
        <hr>
        <p><small>WP-AutoHealer System</small></p>
      `,
      text: `Low Backup Codes Warning\n\nHello ${username},\n\nYou have only ${remainingCodes} backup codes remaining for your multi-factor authentication.\n\nWe recommend generating new backup codes to ensure you don't lose access to your account.\n\nYou can generate new backup codes in your account settings.\n\nWP-AutoHealer System`,
    };
  }

  private getEmailVerificationTemplate(username: string, verificationToken: string): EmailTemplate {
    const verificationUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/auth/verify-email?token=${verificationToken}`;
    
    return {
      subject: 'WP-AutoHealer - Verify Your Email Address',
      html: `
        <h2>Verify Your Email Address</h2>
        <p>Hello ${username},</p>
        <p>Please verify your email address by clicking the link below:</p>
        <p><a href="${verificationUrl}" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Verify Email</a></p>
        <p>This link will expire in 24 hours for security reasons.</p>
        <p>If you did not create this account, please ignore this email.</p>
        <hr>
        <p><small>WP-AutoHealer System</small></p>
      `,
      text: `Verify Your Email Address\n\nHello ${username},\n\nPlease verify your email address by visiting the following link:\n\n${verificationUrl}\n\nThis link will expire in 24 hours for security reasons.\n\nIf you did not create this account, please ignore this email.\n\nWP-AutoHealer System`,
    };
  }

  private getBackupCodesRegeneratedEmailTemplate(username: string): EmailTemplate {
    return {
      subject: 'WP-AutoHealer - Backup Codes Regenerated',
      html: `
        <h2>Backup Codes Regenerated</h2>
        <p>Hello ${username},</p>
        <p>Your multi-factor authentication backup codes have been regenerated.</p>
        <p>Your previous backup codes are no longer valid. Please save your new backup codes in a secure location.</p>
        <p>If you did not request this change, please contact your administrator immediately.</p>
        <hr>
        <p><small>WP-AutoHealer System</small></p>
      `,
      text: `Backup Codes Regenerated\n\nHello ${username},\n\nYour multi-factor authentication backup codes have been regenerated.\n\nYour previous backup codes are no longer valid. Please save your new backup codes in a secure location.\n\nIf you did not request this change, please contact your administrator immediately.\n\nWP-AutoHealer System`,
    };
  }

  private getRoleChangedEmailTemplate(username: string, newRole: string): EmailTemplate {
    return {
      subject: 'WP-AutoHealer - Role Changed',
      html: `
        <h2>Role Changed</h2>
        <p>Hello ${username},</p>
        <p>Your role has been changed to: <strong>${newRole}</strong></p>
        <p>This change affects your permissions within the system.</p>
        <p>If you have questions about this change, please contact your administrator.</p>
        <hr>
        <p><small>WP-AutoHealer System</small></p>
      `,
      text: `Role Changed\n\nHello ${username},\n\nYour role has been changed to: ${newRole}\n\nThis change affects your permissions within the system.\n\nIf you have questions about this change, please contact your administrator.\n\nWP-AutoHealer System`,
    };
  }
}