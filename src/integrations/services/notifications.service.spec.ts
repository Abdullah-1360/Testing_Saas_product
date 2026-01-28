import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../../database/prisma.service';
import { LoggerService } from '../../common/services/logger.service';
import { RedactionService } from '../../common/services/redaction.service';
import { NotificationChannel, NotificationPriority, NotificationStatus } from '../interfaces/notification.interface';

// Mock fetch globally
global.fetch = jest.fn();

describe('NotificationsService', () => {
  let service: NotificationsService;
  let configService: jest.Mocked<ConfigService>;
  let prismaService: jest.Mocked<PrismaService>;
  let loggerService: jest.Mocked<LoggerService>;
  let redactionService: jest.Mocked<RedactionService>;

  const mockNotification = {
    id: 'notification-123',
    channel: NotificationChannel.EMAIL,
    recipient: 'admin@example.com',
    subject: 'Test Notification',
    message: 'This is a test notification',
    priority: NotificationPriority.MEDIUM,
    status: NotificationStatus.PENDING,
    createdAt: new Date(),
    sentAt: null,
    metadata: {},
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            notification: {
              create: jest.fn(),
              findMany: jest.fn(),
              findUnique: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
            },
          },
        },
        {
          provide: LoggerService,
          useValue: {
            logAuditEvent: jest.fn(),
            error: jest.fn(),
            warn: jest.fn(),
            info: jest.fn(),
          },
        },
        {
          provide: RedactionService,
          useValue: {
            redactSecrets: jest.fn(),
            redactObject: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
    configService = module.get(ConfigService);
    prismaService = module.get(PrismaService);
    loggerService = module.get(LoggerService);
    redactionService = module.get(RedactionService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('sendNotification', () => {
    it('should send email notification successfully', async () => {
      const notificationData = {
        channel: NotificationChannel.EMAIL,
        recipient: 'admin@example.com',
        subject: 'Test Subject',
        message: 'Test message',
        priority: NotificationPriority.HIGH,
      };

      configService.get.mockImplementation((key: string) => {
        const config = {
          'SMTP_HOST': 'smtp.example.com',
          'SMTP_PORT': '587',
          'SMTP_USER': 'user@example.com',
          'SMTP_PASS': 'password',
          'SMTP_FROM': 'noreply@example.com',
        };
        return config[key];
      });

      prismaService.notification.create.mockResolvedValue(mockNotification as any);
      prismaService.notification.update.mockResolvedValue({
        ...mockNotification,
        status: NotificationStatus.SENT,
        sentAt: new Date(),
      } as any);

      // Mock successful email sending
      jest.spyOn(service as any, 'sendEmailNotification').mockResolvedValue(true);

      const result = await service.sendNotification(notificationData);

      expect(result.success).toBe(true);
      expect(result.notificationId).toBe(mockNotification.id);
      expect(prismaService.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          channel: NotificationChannel.EMAIL,
          recipient: 'admin@example.com',
          subject: 'Test Subject',
          message: 'Test message',
          priority: NotificationPriority.HIGH,
          status: NotificationStatus.PENDING,
        }),
      });
    });

    it('should send Slack notification successfully', async () => {
      const notificationData = {
        channel: NotificationChannel.SLACK,
        recipient: '#alerts',
        subject: 'Alert',
        message: 'System alert message',
        priority: NotificationPriority.CRITICAL,
      };

      configService.get.mockReturnValue('https://hooks.slack.com/webhook-url');
      prismaService.notification.create.mockResolvedValue({
        ...mockNotification,
        channel: NotificationChannel.SLACK,
      } as any);

      // Mock successful Slack sending
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
      });

      const result = await service.sendNotification(notificationData);

      expect(result.success).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://hooks.slack.com/webhook-url',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: expect.stringContaining('System alert message'),
        })
      );
    });

    it('should send webhook notification successfully', async () => {
      const notificationData = {
        channel: NotificationChannel.WEBHOOK,
        recipient: 'https://api.example.com/webhook',
        subject: 'Webhook Alert',
        message: 'Webhook message',
        priority: NotificationPriority.LOW,
        metadata: { incidentId: 'incident-123' },
      };

      prismaService.notification.create.mockResolvedValue({
        ...mockNotification,
        channel: NotificationChannel.WEBHOOK,
      } as any);

      // Mock successful webhook call
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
      });

      const result = await service.sendNotification(notificationData);

      expect(result.success).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.example.com/webhook',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: expect.stringContaining('Webhook message'),
        })
      );
    });

    it('should handle notification sending failures', async () => {
      const notificationData = {
        channel: NotificationChannel.EMAIL,
        recipient: 'admin@example.com',
        subject: 'Test Subject',
        message: 'Test message',
        priority: NotificationPriority.MEDIUM,
      };

      prismaService.notification.create.mockResolvedValue(mockNotification as any);
      prismaService.notification.update.mockResolvedValue({
        ...mockNotification,
        status: NotificationStatus.FAILED,
      } as any);

      // Mock email sending failure
      jest.spyOn(service as any, 'sendEmailNotification').mockRejectedValue(
        new Error('SMTP connection failed')
      );

      const result = await service.sendNotification(notificationData);

      expect(result.success).toBe(false);
      expect(result.error).toContain('SMTP connection failed');
      expect(prismaService.notification.update).toHaveBeenCalledWith({
        where: { id: mockNotification.id },
        data: {
          status: NotificationStatus.FAILED,
          error: 'SMTP connection failed',
        },
      });
    });

    it('should validate notification data', async () => {
      const invalidNotificationData = {
        channel: NotificationChannel.EMAIL,
        recipient: '', // Empty recipient
        subject: 'Test Subject',
        message: 'Test message',
        priority: NotificationPriority.MEDIUM,
      };

      const result = await service.sendNotification(invalidNotificationData);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Recipient is required');
      expect(prismaService.notification.create).not.toHaveBeenCalled();
    });

    it('should redact sensitive information from logs', async () => {
      const notificationData = {
        channel: NotificationChannel.EMAIL,
        recipient: 'admin@example.com',
        subject: 'Password Reset',
        message: 'Your password is: secret123',
        priority: NotificationPriority.HIGH,
      };

      redactionService.redactSecrets.mockReturnValue('Your password is: ***');
      prismaService.notification.create.mockResolvedValue(mockNotification as any);
      jest.spyOn(service as any, 'sendEmailNotification').mockResolvedValue(true);

      await service.sendNotification(notificationData);

      expect(redactionService.redactSecrets).toHaveBeenCalledWith(
        'Your password is: secret123'
      );
    });
  });

  describe('getNotifications', () => {
    it('should return paginated notifications', async () => {
      const mockNotifications = [
        mockNotification,
        { ...mockNotification, id: 'notification-456' },
      ];

      prismaService.notification.findMany.mockResolvedValue(mockNotifications as any);

      const result = await service.getNotifications({
        page: 1,
        limit: 10,
      });

      expect(result.notifications).toEqual(mockNotifications);
      expect(prismaService.notification.findMany).toHaveBeenCalledWith({
        skip: 0,
        take: 10,
        orderBy: { createdAt: 'desc' },
        where: {},
      });
    });

    it('should filter notifications by channel', async () => {
      const mockNotifications = [mockNotification];

      prismaService.notification.findMany.mockResolvedValue(mockNotifications as any);

      await service.getNotifications({
        page: 1,
        limit: 10,
        channel: NotificationChannel.EMAIL,
      });

      expect(prismaService.notification.findMany).toHaveBeenCalledWith({
        skip: 0,
        take: 10,
        orderBy: { createdAt: 'desc' },
        where: { channel: NotificationChannel.EMAIL },
      });
    });

    it('should filter notifications by status', async () => {
      const mockNotifications = [mockNotification];

      prismaService.notification.findMany.mockResolvedValue(mockNotifications as any);

      await service.getNotifications({
        page: 1,
        limit: 10,
        status: NotificationStatus.SENT,
      });

      expect(prismaService.notification.findMany).toHaveBeenCalledWith({
        skip: 0,
        take: 10,
        orderBy: { createdAt: 'desc' },
        where: { status: NotificationStatus.SENT },
      });
    });

    it('should filter notifications by priority', async () => {
      const mockNotifications = [mockNotification];

      prismaService.notification.findMany.mockResolvedValue(mockNotifications as any);

      await service.getNotifications({
        page: 1,
        limit: 10,
        priority: NotificationPriority.HIGH,
      });

      expect(prismaService.notification.findMany).toHaveBeenCalledWith({
        skip: 0,
        take: 10,
        orderBy: { createdAt: 'desc' },
        where: { priority: NotificationPriority.HIGH },
      });
    });

    it('should handle pagination correctly', async () => {
      const mockNotifications = [mockNotification];

      prismaService.notification.findMany.mockResolvedValue(mockNotifications as any);

      await service.getNotifications({
        page: 3,
        limit: 5,
      });

      expect(prismaService.notification.findMany).toHaveBeenCalledWith({
        skip: 10, // (page - 1) * limit = (3 - 1) * 5 = 10
        take: 5,
        orderBy: { createdAt: 'desc' },
        where: {},
      });
    });
  });

  describe('getNotificationById', () => {
    it('should return notification by ID', async () => {
      prismaService.notification.findUnique.mockResolvedValue(mockNotification as any);

      const result = await service.getNotificationById(mockNotification.id);

      expect(result).toEqual(mockNotification);
      expect(prismaService.notification.findUnique).toHaveBeenCalledWith({
        where: { id: mockNotification.id },
      });
    });

    it('should return null for non-existent notification', async () => {
      prismaService.notification.findUnique.mockResolvedValue(null);

      const result = await service.getNotificationById('non-existent-id');

      expect(result).toBeNull();
    });
  });

  describe('retryFailedNotification', () => {
    it('should retry failed notification successfully', async () => {
      const failedNotification = {
        ...mockNotification,
        status: NotificationStatus.FAILED,
      };

      prismaService.notification.findUnique.mockResolvedValue(failedNotification as any);
      prismaService.notification.update.mockResolvedValue({
        ...failedNotification,
        status: NotificationStatus.SENT,
        sentAt: new Date(),
      } as any);

      jest.spyOn(service as any, 'sendEmailNotification').mockResolvedValue(true);

      const result = await service.retryFailedNotification(mockNotification.id);

      expect(result.success).toBe(true);
      expect(prismaService.notification.update).toHaveBeenCalledWith({
        where: { id: mockNotification.id },
        data: {
          status: NotificationStatus.SENT,
          sentAt: expect.any(Date),
          error: null,
        },
      });
    });

    it('should not retry non-failed notifications', async () => {
      const sentNotification = {
        ...mockNotification,
        status: NotificationStatus.SENT,
      };

      prismaService.notification.findUnique.mockResolvedValue(sentNotification as any);

      const result = await service.retryFailedNotification(mockNotification.id);

      expect(result.success).toBe(false);
      expect(result.error).toContain('not in failed state');
    });

    it('should handle retry failures', async () => {
      const failedNotification = {
        ...mockNotification,
        status: NotificationStatus.FAILED,
      };

      prismaService.notification.findUnique.mockResolvedValue(failedNotification as any);
      jest.spyOn(service as any, 'sendEmailNotification').mockRejectedValue(
        new Error('Still failing')
      );

      const result = await service.retryFailedNotification(mockNotification.id);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Still failing');
    });
  });

  describe('deleteNotification', () => {
    it('should delete notification successfully', async () => {
      prismaService.notification.findUnique.mockResolvedValue(mockNotification as any);
      prismaService.notification.delete.mockResolvedValue(mockNotification as any);

      const result = await service.deleteNotification(mockNotification.id);

      expect(result.success).toBe(true);
      expect(prismaService.notification.delete).toHaveBeenCalledWith({
        where: { id: mockNotification.id },
      });
    });

    it('should handle deletion of non-existent notification', async () => {
      prismaService.notification.findUnique.mockResolvedValue(null);

      const result = await service.deleteNotification('non-existent-id');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('getNotificationStats', () => {
    it('should return notification statistics', async () => {
      const mockStats = [
        { status: NotificationStatus.SENT, _count: { status: 10 } },
        { status: NotificationStatus.FAILED, _count: { status: 2 } },
        { status: NotificationStatus.PENDING, _count: { status: 1 } },
      ];

      prismaService.notification.groupBy = jest.fn().mockResolvedValue(mockStats);

      const result = await service.getNotificationStats();

      expect(result).toEqual({
        total: 13,
        sent: 10,
        failed: 2,
        pending: 1,
        successRate: 76.92, // 10/13 * 100
      });
    });

    it('should handle empty statistics', async () => {
      prismaService.notification.groupBy = jest.fn().mockResolvedValue([]);

      const result = await service.getNotificationStats();

      expect(result).toEqual({
        total: 0,
        sent: 0,
        failed: 0,
        pending: 0,
        successRate: 0,
      });
    });
  });

  describe('validateNotificationConfig', () => {
    it('should validate email configuration', () => {
      configService.get.mockImplementation((key: string) => {
        const config = {
          'SMTP_HOST': 'smtp.example.com',
          'SMTP_PORT': '587',
          'SMTP_USER': 'user@example.com',
          'SMTP_PASS': 'password',
        };
        return config[key];
      });

      const result = service.validateNotificationConfig(NotificationChannel.EMAIL);

      expect(result.valid).toBe(true);
      expect(result.missingConfig).toHaveLength(0);
    });

    it('should detect missing email configuration', () => {
      configService.get.mockImplementation((key: string) => {
        const config = {
          'SMTP_HOST': 'smtp.example.com',
          // Missing SMTP_PORT, SMTP_USER, SMTP_PASS
        };
        return config[key];
      });

      const result = service.validateNotificationConfig(NotificationChannel.EMAIL);

      expect(result.valid).toBe(false);
      expect(result.missingConfig).toContain('SMTP_PORT');
      expect(result.missingConfig).toContain('SMTP_USER');
      expect(result.missingConfig).toContain('SMTP_PASS');
    });

    it('should validate Slack configuration', () => {
      configService.get.mockReturnValue('https://hooks.slack.com/webhook-url');

      const result = service.validateNotificationConfig(NotificationChannel.SLACK);

      expect(result.valid).toBe(true);
      expect(result.missingConfig).toHaveLength(0);
    });

    it('should detect missing Slack configuration', () => {
      configService.get.mockReturnValue(undefined);

      const result = service.validateNotificationConfig(NotificationChannel.SLACK);

      expect(result.valid).toBe(false);
      expect(result.missingConfig).toContain('SLACK_WEBHOOK_URL');
    });
  });

  describe('testNotificationChannel', () => {
    it('should test email channel successfully', async () => {
      configService.get.mockImplementation((key: string) => {
        const config = {
          'SMTP_HOST': 'smtp.example.com',
          'SMTP_PORT': '587',
          'SMTP_USER': 'user@example.com',
          'SMTP_PASS': 'password',
        };
        return config[key];
      });

      jest.spyOn(service as any, 'sendEmailNotification').mockResolvedValue(true);

      const result = await service.testNotificationChannel(
        NotificationChannel.EMAIL,
        'test@example.com'
      );

      expect(result.success).toBe(true);
      expect(result.message).toContain('successfully');
    });

    it('should handle test failures', async () => {
      configService.get.mockReturnValue(undefined);

      const result = await service.testNotificationChannel(
        NotificationChannel.EMAIL,
        'test@example.com'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('configuration');
    });
  });
});