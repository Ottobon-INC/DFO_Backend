import { Controller, Post, Get, Body, Param, InternalServerErrorException, BadRequestException, HttpCode, HttpStatus } from '@nestjs/common';
import { VitalsService } from './vitals.service';
import { AddVitalRequestSchema, AddVitalRequest, VitalAnalysisResult, VitalRecord, BulkAddVitalRequestSchema } from './vitals.schema';

@Controller('vitals')
export class VitalsController {
  constructor(private readonly vitalsService: VitalsService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async addVital(@Body() body: any): Promise<VitalAnalysisResult> {
    try {
      const validatedBody: AddVitalRequest = AddVitalRequestSchema.parse(body);
      return await this.vitalsService.processAndSaveVital(validatedBody);
    } catch (error: any) {
      if (error.issues) {
        // Zod validation error
        throw new BadRequestException(error.issues.map((i: any) => i.message).join(', '));
      }
      throw new InternalServerErrorException(
        'Failed to process vital record',
        error instanceof Error ? error.message : undefined
      );
    }
  }

  @Post('bulk')
  @HttpCode(HttpStatus.OK)
  async addVitalsBulk(@Body() body: any): Promise<{ data: VitalAnalysisResult[] }> {
    try {
      const validatedBody = BulkAddVitalRequestSchema.parse(body);
      const results = await this.vitalsService.processAndSaveVitalsBulk(validatedBody);
      return { data: results };
    } catch (error: any) {
      if (error.issues) {
        throw new BadRequestException(error.issues.map((i: any) => i.message).join(', '));
      }
      throw new InternalServerErrorException(
        'Failed to process bulk vital records',
        error instanceof Error ? error.message : undefined
      );
    }
  }

  @Get(':patientId')
  async getVitals(@Param('patientId') patientId: string): Promise<{ data: VitalRecord[] }> {
    try {
      const records = await this.vitalsService.getPatientVitals(patientId);
      return { data: records };
    } catch (error) {
      throw new InternalServerErrorException(
        'Failed to fetch vitals history',
        error instanceof Error ? error.message : undefined
      );
    }
  }
}
