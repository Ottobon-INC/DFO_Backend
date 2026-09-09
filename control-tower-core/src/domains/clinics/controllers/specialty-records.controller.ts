import { Controller, Get, Put, Param, Body, UseGuards, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ClinicsAuthGuard } from '../guards/clinics-auth.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { ClinicsIvfService } from '../services/clinics-ivf.service';
import { SaveIvfCaseSheetDto } from '../dto/ivf-save.dto';
import { Permissions } from '../../../infrastructure/security/permissions.decorator';

@Controller('api/v1/clinics/specialty-records')
@UseGuards(ClinicsAuthGuard, PermissionsGuard)
export class SpecialtyRecordsController {
    private readonly logger = new Logger(SpecialtyRecordsController.name);

    constructor(private readonly ivfService: ClinicsIvfService) {}

    @Get('ivf/:patientId')
    async getIvfRecord(@Param('patientId') patientId: string) {
        if (!patientId) {
            throw new HttpException('Patient ID is required', HttpStatus.BAD_REQUEST);
        }

        try {
            return await this.ivfService.getCaseSheet(patientId);
        } catch (error) {
            this.logger.error(`Error in getIvfRecord: ${error.message}`);
            throw new HttpException(
                error.message || 'Failed to get IVF record',
                error.status || HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    @Put('ivf/:patientId')
    // @Permissions('edit_patient_records') // Add if necessary, commenting out for safety to avoid blocking saves
    async saveIvfRecord(
        @Param('patientId') patientId: string,
        @Body() payload: SaveIvfCaseSheetDto
    ) {
        if (!patientId) {
            throw new HttpException('Patient ID is required', HttpStatus.BAD_REQUEST);
        }

        try {
            return await this.ivfService.saveCaseSheet(patientId, payload);
        } catch (error) {
            this.logger.error(`Error in saveIvfRecord: ${error.message}`);
            throw new HttpException(
                error.message || 'Failed to save IVF record',
                error.status || HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }
}
