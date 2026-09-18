import { Controller, Post, Body, InternalServerErrorException, Get, Param, NotFoundException } from '@nestjs/common';
import { ConsentEnforcementService } from './consent-enforcement.service';
import { ConsentCheckRequest, ConsentCheckResponse, ConsentSaveRequest } from './consent.schema';

@Controller('consent')
export class ConsentController {
  constructor(private readonly consentService: ConsentEnforcementService) {}

  @Get('ping')
  ping() {
    return { status: 'Consent Controller is ALIVE' };
  }

  @Post()
  async checkConsent(@Body() request: ConsentCheckRequest): Promise<ConsentCheckResponse> {
    try {
      return await this.consentService.checkConsent(request);
    } catch (error) {
      throw new InternalServerErrorException(
        'Failed to perform consent validation check.',
        error instanceof Error ? error.message : undefined
      );
    }
  }

  @Get('/:patientId')
  async getConsent(@Param('patientId') patientId: string) {
    try {
      const preferences = await this.consentService['repository'].getConsentByPatientId(patientId);
      if (!preferences) {
        throw new NotFoundException(`No consent record found for patient ${patientId}`);
      }
      return preferences;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new InternalServerErrorException(
        'Failed to fetch consent preferences.',
        error instanceof Error ? error.message : undefined
      );
    }
  }

  @Post('/consent')
  async updateConsent(@Body() request: ConsentSaveRequest): Promise<{ success: boolean }> {
    try {
      const success = await this.consentService.saveConsent(request.patient_id, request.clinic_id, request.preferences);
      return { success };
    } catch (error) {
      throw new InternalServerErrorException(
        'Failed to update consent preferences.',
        error instanceof Error ? error.message : undefined
      );
    }
  }
}
