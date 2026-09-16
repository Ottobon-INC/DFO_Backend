import { Controller, Get, Put, Param, Body, Req, UseGuards, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ClinicsAuthGuard } from '../guards/clinics-auth.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { ClinicsIvfService } from '../services/clinics-ivf.service';
import { ClinicsSupabaseService } from '../services/clinics-supabase.service';
import { SaveIvfCaseSheetDto } from '../dto/ivf-save.dto';
import { Permissions } from '../../../infrastructure/security/permissions.decorator';

@Controller('api/v1/clinics/specialty-records')
@UseGuards(ClinicsAuthGuard, PermissionsGuard)
export class SpecialtyRecordsController {
    private readonly logger = new Logger(SpecialtyRecordsController.name);

    constructor(
        private readonly ivfService: ClinicsIvfService,
        private readonly supabaseService: ClinicsSupabaseService,
    ) {}

    /**
     * Verify that the requesting user's clinic has the required specialty.
     * Blocks access for hospitals that are not registered for this specialty.
     */
    private async verifyClinicSpecialty(clinicId: string, requiredSpecialty: string): Promise<void> {
        if (!clinicId) {
            throw new HttpException('Access Denied: No clinic associated with this account.', HttpStatus.FORBIDDEN);
        }

        const supabase = this.supabaseService.getClient();
        const { data: clinic, error } = await supabase
            .from('clinics')
            .select('name, specialty')
            .eq('id', clinicId)
            .single();

        if (error || !clinic) {
            this.logger.error(`Failed to verify clinic specialty for clinic_id=${clinicId}: ${error?.message}`);
            throw new HttpException('Failed to verify clinic specialty', HttpStatus.INTERNAL_SERVER_ERROR);
        }

        const clinicSpecialty = (clinic.specialty || 'General').toUpperCase();
        const clinicName = (clinic.name || '').toUpperCase();
        const isAllowed =
            clinicSpecialty === requiredSpecialty.toUpperCase() ||
            clinicSpecialty === 'GENERAL' ||
            clinicSpecialty === 'MULTI-SPECIALTY' ||
            clinicSpecialty.includes('IVF') ||
            clinicName.includes('IVF');

        if (!isAllowed) {
            this.logger.warn(`Specialty access denied: clinic ${clinicId} has '${clinic.specialty}', required '${requiredSpecialty}'`);
            throw new HttpException(
                `Access Denied: This feature is only available for ${requiredSpecialty}-specialized hospitals.`,
                HttpStatus.FORBIDDEN
            );
        }
    }

    @Get('ivf/:patientId')
    async getIvfRecord(@Req() req: any, @Param('patientId') patientId: string) {
        if (!patientId) {
            throw new HttpException('Patient ID is required', HttpStatus.BAD_REQUEST);
        }

        // Verify the user's clinic is an IVF-specialty hospital
        await this.verifyClinicSpecialty(req.user?.clinic_id, 'IVF');

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
    @Permissions('can_write_clinical_notes')
    async saveIvfRecord(
        @Req() req: any,
        @Param('patientId') patientId: string,
        @Body() payload: SaveIvfCaseSheetDto
    ) {
        if (!patientId) {
            throw new HttpException('Patient ID is required', HttpStatus.BAD_REQUEST);
        }

        // Verify the user's clinic is an IVF-specialty hospital
        await this.verifyClinicSpecialty(req.user?.clinic_id, 'IVF');

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
