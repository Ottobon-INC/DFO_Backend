import { Controller, Get, Logger, HttpException, HttpStatus, Headers } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClinicsSupabaseService } from '../services/clinics-supabase.service';
import * as jwt from 'jsonwebtoken';

@Controller('api/patient-portal')
export class PatientPortalController {
    private readonly logger = new Logger(PatientPortalController.name);
    private readonly jwtSecret: string;

    constructor(
        private readonly supabaseService: ClinicsSupabaseService,
        private readonly configService: ConfigService,
    ) {
        this.jwtSecret = this.configService.get<string>('JWT_SECRET') || 'fallback_secret_do_not_use_in_prod';
    }

    private verifyPatientToken(authHeader?: string) {
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            throw new HttpException({ success: false, error: 'Unauthorized' }, HttpStatus.UNAUTHORIZED);
        }
        const token = authHeader.split(' ')[1];
        try {
            const decoded = jwt.verify(token, this.jwtSecret) as any;
            if (decoded.role !== 'patient') {
                throw new HttpException({ success: false, error: 'Forbidden. Patient access only.' }, HttpStatus.FORBIDDEN);
            }
            return decoded;
        } catch (error) {
            throw new HttpException({ success: false, error: 'Invalid or expired token' }, HttpStatus.UNAUTHORIZED);
        }
    }

    @Get('dashboard')
    async getDashboardData(@Headers('authorization') authHeader: string) {
        const patient = this.verifyPatientToken(authHeader);
        const supabase = this.supabaseService.getClient();

        try {
            // Fetch next upcoming appointment
            const { data: upcomingAppointment } = await supabase
                .from('sakhi_clinic_appointments')
                .select('*')
                .eq('patient_id', patient.sub)
                .gte('appointment_date', new Date().toISOString().split('T')[0])
                .order('appointment_date', { ascending: true })
                .order('appointment_time', { ascending: true })
                .limit(1)
                .single();

            // Fetch Medical Alerts (Allergies, conditions) from clinical notes as a fallback since no dedicated table
            // In a real scenario, this would come from an allergies or conditions table
            const { data: clinicalNotes } = await supabase
                .from('sakhi_clinical_notes')
                .select('assessment')
                .eq('patient_id', patient.sub)
                .not('assessment', 'is', null)
                .order('created_at', { ascending: false })
                .limit(5);

            // We mock some structured alerts from the clinical notes for MVP
            const medicalAlerts: any[] = [];
            if (clinicalNotes && clinicalNotes.length > 0) {
                medicalAlerts.push({
                    type: 'Condition',
                    title: 'Active Condition Monitoring',
                    severity: 'Medium',
                    description: 'Based on recent clinical assessments.'
                });
            }

            return {
                success: true,
                data: {
                    patient: {
                        name: patient.name,
                        uhid: patient.uhid
                    },
                    upcomingAppointment: upcomingAppointment || null,
                    medicalAlerts: medicalAlerts,
                    carePlanTimeline: [
                        { step: 1, day: 'Day 1', label: 'Consultation', status: 'completed' },
                        { step: 2, day: 'Day 3', label: 'Follow-up', status: 'active' },
                        { step: 3, day: 'Day 7', label: 'Review', status: 'pending' },
                    ]
                }
            };
        } catch (error: any) {
            this.logger.error('Dashboard data fetch error:', error);
            throw new HttpException({ success: false, error: 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Get('appointments')
    async getAppointments(@Headers('authorization') authHeader: string) {
        const patient = this.verifyPatientToken(authHeader);
        const supabase = this.supabaseService.getClient();

        try {
            const { data: appointments } = await supabase
                .from('sakhi_clinic_appointments')
                .select('*')
                .eq('patient_id', patient.sub)
                .order('appointment_date', { ascending: false })
                .order('appointment_time', { ascending: false });

            return { success: true, data: appointments || [] };
        } catch (error: any) {
            this.logger.error('Appointments fetch error:', error);
            throw new HttpException({ success: false, error: 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Get('vault')
    async getClinicalVault(@Headers('authorization') authHeader: string) {
        const patient = this.verifyPatientToken(authHeader);
        const supabase = this.supabaseService.getClient();

        try {
            // Fetch Documents (Prescriptions, Lab Reports)
            const { data: documents } = await supabase
                .from('sakhi_clinic_documents')
                .select('*')
                .eq('patient_id', patient.sub)
                .order('uploaded_at', { ascending: false });

            return { success: true, data: { documents: documents || [] } };
        } catch (error: any) {
            this.logger.error('Vault data fetch error:', error);
            throw new HttpException({ success: false, error: 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
}
