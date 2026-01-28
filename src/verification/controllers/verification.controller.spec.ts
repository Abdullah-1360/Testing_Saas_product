import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { VerificationController } from './verification.controller';
import { VerificationService } from '../services/verification.service';
import { VerifyIncidentDto, VerifySiteDto } from '../dto/verification.dto';
import { ComprehensiveVerificationResult } from '../interfaces/verification.interface';

describe('VerificationController', () => {
  let controller: VerificationController;
  let verificationService: jest.Mocked<VerificationService>;

  const mockComprehensiveResult: ComprehensiveVerificationResult = {
    overall: {
      success: true,
      healthy: true,
      totalChecks: 10,
      passedChecks: 10,
      failedChecks: 0,
      responseTime: 1500,
    },
    httpStatus: {
      success: true,
      verificationType: 'http_status',
      details: { statusCode: 200, responseTime: 200 },
      issues: [],
      timestamp: new Date(),
      responseTime: 200,
    },
    fatalErrorCheck: {
      success: true,
      verificationType: 'fatal_error_check',
      details: { fatalErrorsDetected: false },
      issues: [],
      timestamp: new Date(),
      responseTime: 150,
    },
    maintenanceCheck: {
      success: true,
      verificationType: 'maintenance_check',
      details: { maintenanceModeDetected: false },
      issues: [],
      timestamp: new Date(),
      responseTime: 150,
    },
    whiteScreenCheck: {
      success: true,
      verificationType: 'white_screen_check',
      details: { whiteScreenDetected: false, contentLength: 1024 },
      issues: [],
      timestamp: new Date(),
      responseTime: 150,
    },
    titleTagCheck: {
      success: true,
      verificationType: 'title_tag_check',
      details: { titleTagPresent: true },
      issues: [],
      timestamp: new Date(),
      responseTime: 150,
    },
    canonicalTagCheck: {
      success: true,
      verificationType: 'canonical_tag_check',
      details: { canonicalTagPresent: true },
      issues: [],
      timestamp: new Date(),
      responseTime: 150,
    },
    footerMarkerCheck: {
      success: true,
      verificationType: 'footer_marker_check',
      details: { footerMarkersPresent: true },
      issues: [],
      timestamp: new Date(),
      responseTime: 150,
    },
    headerMarkerCheck: {
      success: true,
      verificationType: 'header_marker_check',
      details: { headerMarkersPresent: true },
      issues: [],
      timestamp: new Date(),
      responseTime: 150,
    },
    wpLoginCheck: {
      success: true,
      verificationType: 'wp_login_check',
      details: { accessible: true, loginFormPresent: true },
      issues: [],
      timestamp: new Date(),
      responseTime: 300,
    },
    internalUrlCheck: {
      success: true,
      verificationType: 'internal_url_check',
      details: { totalUrls: 4, accessibleUrls: 4, inaccessibleUrls: 0 },
      issues: [],
      timestamp: new Date(),
      responseTime: 400,
    },
    timestamp: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [VerificationController],
      providers: [
        {
          provide: VerificationService,
          useValue: {
            verifyIncident: jest.fn(),
            verifySite: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<VerificationController>(VerificationController);
    verificationService = module.get(VerificationService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('verifyIncident', () => {
    const mockVerifyIncidentDto: VerifyIncidentDto = {
      incidentId: 'incident-123',
      siteUrl: 'https://example.com',
      adminUrl: 'https://example.com/wp-admin',
      internalUrls: ['https://example.com/wp-admin/', 'https://example.com/wp-content/'],
      skipChecks: [],
    };

    it('should verify incident successfully', async () => {
      verificationService.verifyIncident.mockResolvedValue(mockComprehensiveResult);

      const result = await controller.verifyIncident(mockVerifyIncidentDto);

      expect(result).toEqual(mockComprehensiveResult);
      expect(verificationService.verifyIncident).toHaveBeenCalledWith(mockVerifyIncidentDto);
      expect(verificationService.verifyIncident).toHaveBeenCalledTimes(1);
    });

    it('should handle verification service errors', async () => {
      const error = new Error('Verification failed');
      verificationService.verifyIncident.mockRejectedValue(error);

      await expect(controller.verifyIncident(mockVerifyIncidentDto)).rejects.toThrow(error);
      expect(verificationService.verifyIncident).toHaveBeenCalledWith(mockVerifyIncidentDto);
    });

    it('should pass through all DTO properties', async () => {
      const dtoWithSkips: VerifyIncidentDto = {
        ...mockVerifyIncidentDto,
        skipChecks: ['fatal_error_check', 'maintenance_check'],
        internalUrls: ['https://example.com/custom-page/'],
      };

      verificationService.verifyIncident.mockResolvedValue(mockComprehensiveResult);

      await controller.verifyIncident(dtoWithSkips);

      expect(verificationService.verifyIncident).toHaveBeenCalledWith(dtoWithSkips);
    });
  });

  describe('verifySite', () => {
    const mockVerifySiteDto: VerifySiteDto = {
      siteId: 'site-123',
      force: false,
      internalUrls: [],
      skipChecks: [],
    };

    const mockVerificationResultDto = {
      success: true,
      healthy: true,
      totalChecks: 10,
      passedChecks: 10,
      failedChecks: 0,
      responseTime: 1500,
      checks: {
        httpStatus: {
          success: true,
          verificationType: 'http_status',
          details: { statusCode: 200 },
          issues: [],
          timestamp: new Date(),
          responseTime: 200,
        },
        fatalErrorCheck: {
          success: true,
          verificationType: 'fatal_error_check',
          details: { fatalErrorsDetected: false },
          issues: [],
          timestamp: new Date(),
          responseTime: 150,
        },
        maintenanceCheck: {
          success: true,
          verificationType: 'maintenance_check',
          details: { maintenanceModeDetected: false },
          issues: [],
          timestamp: new Date(),
          responseTime: 150,
        },
        whiteScreenCheck: {
          success: true,
          verificationType: 'white_screen_check',
          details: { whiteScreenDetected: false },
          issues: [],
          timestamp: new Date(),
          responseTime: 150,
        },
        titleTagCheck: {
          success: true,
          verificationType: 'title_tag_check',
          details: { titleTagPresent: true },
          issues: [],
          timestamp: new Date(),
          responseTime: 150,
        },
        canonicalTagCheck: {
          success: true,
          verificationType: 'canonical_tag_check',
          details: { canonicalTagPresent: true },
          issues: [],
          timestamp: new Date(),
          responseTime: 150,
        },
        footerMarkerCheck: {
          success: true,
          verificationType: 'footer_marker_check',
          details: { footerMarkersPresent: true },
          issues: [],
          timestamp: new Date(),
          responseTime: 150,
        },
        headerMarkerCheck: {
          success: true,
          verificationType: 'header_marker_check',
          details: { headerMarkersPresent: true },
          issues: [],
          timestamp: new Date(),
          responseTime: 150,
        },
        wpLoginCheck: {
          success: true,
          verificationType: 'wp_login_check',
          details: { accessible: true, loginFormPresent: true },
          issues: [],
          timestamp: new Date(),
          responseTime: 300,
        },
        internalUrlCheck: {
          success: true,
          verificationType: 'internal_url_check',
          details: { totalUrls: 4, accessibleUrls: 4 },
          issues: [],
          timestamp: new Date(),
          responseTime: 400,
        },
      },
      timestamp: new Date(),
    };

    it('should verify site successfully', async () => {
      verificationService.verifySite.mockResolvedValue(mockVerificationResultDto);

      const result = await controller.verifySite(mockVerifySiteDto);

      expect(result).toEqual(mockVerificationResultDto);
      expect(verificationService.verifySite).toHaveBeenCalledWith(mockVerifySiteDto);
      expect(verificationService.verifySite).toHaveBeenCalledTimes(1);
    });

    it('should handle site not found error', async () => {
      const error = new NotFoundException('Site with ID site-123 not found');
      verificationService.verifySite.mockRejectedValue(error);

      await expect(controller.verifySite(mockVerifySiteDto)).rejects.toThrow(error);
      expect(verificationService.verifySite).toHaveBeenCalledWith(mockVerifySiteDto);
    });

    it('should pass through force and custom URLs', async () => {
      const dtoWithOptions: VerifySiteDto = {
        ...mockVerifySiteDto,
        force: true,
        internalUrls: ['https://example.com/custom-endpoint/'],
        skipChecks: ['canonical_tag_check'],
      };

      verificationService.verifySite.mockResolvedValue(mockVerificationResultDto);

      await controller.verifySite(dtoWithOptions);

      expect(verificationService.verifySite).toHaveBeenCalledWith(dtoWithOptions);
    });
  });

  describe('getIncidentVerificationResults', () => {
    it('should return placeholder response for verification results', async () => {
      const incidentId = 'incident-123';

      const result = await controller.getIncidentVerificationResults(incidentId);

      expect(result).toEqual({
        incidentId,
        message: 'Verification results retrieval not yet implemented',
      });
    });

    it('should handle different incident IDs', async () => {
      const incidentId = 'different-incident-456';

      const result = await controller.getIncidentVerificationResults(incidentId);

      expect(result.incidentId).toBe(incidentId);
      expect(result.message).toBe('Verification results retrieval not yet implemented');
    });
  });

  describe('error handling', () => {
    it('should propagate service errors for incident verification', async () => {
      const mockDto: VerifyIncidentDto = {
        incidentId: 'incident-123',
        siteUrl: 'https://example.com',
        adminUrl: 'https://example.com/wp-admin',
      };

      const serviceError = new Error('Database connection failed');
      verificationService.verifyIncident.mockRejectedValue(serviceError);

      await expect(controller.verifyIncident(mockDto)).rejects.toThrow(serviceError);
    });

    it('should propagate service errors for site verification', async () => {
      const mockDto: VerifySiteDto = {
        siteId: 'site-123',
      };

      const serviceError = new NotFoundException('Site not found');
      verificationService.verifySite.mockRejectedValue(serviceError);

      await expect(controller.verifySite(mockDto)).rejects.toThrow(serviceError);
    });
  });

  describe('input validation', () => {
    it('should accept minimal incident verification DTO', async () => {
      const minimalDto: VerifyIncidentDto = {
        incidentId: 'incident-123',
        siteUrl: 'https://example.com',
        adminUrl: 'https://example.com/wp-admin',
      };

      verificationService.verifyIncident.mockResolvedValue(mockComprehensiveResult);

      const result = await controller.verifyIncident(minimalDto);

      expect(result).toEqual(mockComprehensiveResult);
      expect(verificationService.verifyIncident).toHaveBeenCalledWith(minimalDto);
    });

    it('should accept minimal site verification DTO', async () => {
      const minimalDto: VerifySiteDto = {
        siteId: 'site-123',
      };

      const mockResult = {
        success: true,
        healthy: true,
        totalChecks: 10,
        passedChecks: 10,
        failedChecks: 0,
        responseTime: 1500,
        checks: {} as any,
        timestamp: new Date(),
      };

      verificationService.verifySite.mockResolvedValue(mockResult);

      const result = await controller.verifySite(minimalDto);

      expect(result).toEqual(mockResult);
      expect(verificationService.verifySite).toHaveBeenCalledWith(minimalDto);
    });
  });
});