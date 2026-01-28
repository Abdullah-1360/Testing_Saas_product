import { Controller, Post, Body, Get, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/auth/guards/roles.guard';
import { Roles } from '@/auth/decorators/roles.decorator';
import { VerificationService } from '../services/verification.service';
import { 
  VerifyIncidentDto, 
  VerifySiteDto, 
  VerificationResultDto 
} from '../dto/verification.dto';
import { ComprehensiveVerificationResult } from '../interfaces/verification.interface';

@ApiTags('verification')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('verification')
export class VerificationController {
  constructor(private readonly verificationService: VerificationService) {}

  @Post('incident')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER')
  @ApiOperation({ 
    summary: 'Verify site for incident',
    description: 'Perform comprehensive site verification for an incident and store results in database'
  })
  @ApiResponse({ 
    status: 201, 
    description: 'Verification completed successfully',
    type: Object // ComprehensiveVerificationResult is complex, using Object for now
  })
  @ApiResponse({ status: 400, description: 'Invalid verification request' })
  @ApiResponse({ status: 404, description: 'Incident not found' })
  async verifyIncident(
    @Body() verifyIncidentDto: VerifyIncidentDto
  ): Promise<ComprehensiveVerificationResult> {
    return this.verificationService.verifyIncident(verifyIncidentDto);
  }

  @Post('site')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER')
  @ApiOperation({ 
    summary: 'Verify site health',
    description: 'Perform comprehensive site verification and return results'
  })
  @ApiResponse({ 
    status: 201, 
    description: 'Site verification completed successfully',
    type: VerificationResultDto
  })
  @ApiResponse({ status: 400, description: 'Invalid verification request' })
  @ApiResponse({ status: 404, description: 'Site not found' })
  async verifySite(
    @Body() verifySiteDto: VerifySiteDto
  ): Promise<VerificationResultDto> {
    return this.verificationService.verifySite(verifySiteDto);
  }

  @Get('incident/:incidentId/results')
  @Roles('SUPER_ADMIN', 'ADMIN', 'ENGINEER', 'VIEWER')
  @ApiOperation({ 
    summary: 'Get verification results for incident',
    description: 'Retrieve stored verification results for a specific incident'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Verification results retrieved successfully'
  })
  @ApiResponse({ status: 404, description: 'Incident or verification results not found' })
  async getIncidentVerificationResults(@Param('incidentId') incidentId: string) {
    // This would be implemented to retrieve stored verification results
    // For now, returning a placeholder response
    return {
      incidentId,
      message: 'Verification results retrieval not yet implemented',
      // TODO: Implement actual retrieval from database
    };
  }
}