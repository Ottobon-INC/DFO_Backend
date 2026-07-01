import { Controller, Get, Logger, HttpException, HttpStatus, Headers } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClinicsSupabaseService } from '../services/clinics-supabase.service';
import { S3Service } from '../../../infrastructure/aws/s3.service';
import * as jwt from 'jsonwebtoken';

@Controller('api/patient-portal')
export class PatientPortalController {
    private readonly logger = new Logger(PatientPortalController.name);
    private readonly jwtSecret: string;

    constructor(
        private readonly supabaseService: ClinicsSupabaseService,
        private readonly configService: ConfigService,
        private readonly s3Service: S3Service,
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

    @Get('documents')
    async getDocuments(@Headers('authorization') authHeader: string) {
        const patient = this.verifyPatientToken(authHeader);
        const supabase = this.supabaseService.getClient();

        try {
            const { data } = await supabase
                .from('sakhi_documents')
                .select('*')
                .eq('patient_id', patient.sub)
                .order('created_at', { ascending: false });

            // Generate temporary URLs for viewing
            const docsWithUrls = await Promise.all((data || []).map(async (doc) => {
                if (doc.s3_key) {
                    try {
                        const url = await this.s3Service.generatePresignedDownloadUrl(doc.s3_key);
                        return { ...doc, file_url: url };
                    } catch (e) {
                        return doc;
                    }
                }
                return doc;
            }));

            return { success: true, data: docsWithUrls };
        } catch (error: any) {
            this.logger.error('Documents fetch error:', error);
            throw new HttpException({ success: false, error: 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Get('my-admission')
    async getMyAdmission(@Headers('authorization') authHeader: string) {
        const patient = this.verifyPatientToken(authHeader);
        const supabase = this.supabaseService.getClient();

        try {
            // Fetch active admission with deep joins for full visibility
            const { data: admission } = await supabase
                .from('sakhi_clinic_admissions')
                .select(`
                    id, 
                    status, 
                    admission_date,
                    attending_doctor_id,
                    sakhi_clinic_bed_assignments!inner(
                        is_current,
                        sakhi_clinic_beds!inner(
                            bed_identifier,
                            sakhi_clinic_rooms!inner(
                                room_number,
                                name,
                                sakhi_clinic_room_categories!inner(
                                    name,
                                    tier
                                )
                            )
                        )
                    )
                `)
                .eq('patient_id', patient.sub)
                .eq('status', 'admitted')
                .eq('sakhi_clinic_bed_assignments.is_current', true)
                .single();

            if (!admission) {
                return { success: true, data: null };
            }

            // Optional: Fetch doctor name manually since we only have doctor_id
            let attendingDoctorName = 'Unknown';
            if (admission.attending_doctor_id) {
                const { data: doctor } = await supabase.from('sakhi_staff').select('name').eq('id', admission.attending_doctor_id).single();
                if (doctor) attendingDoctorName = doctor.name;
            }

            const assignment = admission.sakhi_clinic_bed_assignments[0] as any;
            const bed = assignment?.sakhi_clinic_beds;
            const room = bed?.sakhi_clinic_rooms;
            const category = room?.sakhi_clinic_room_categories;

            return {
                success: true,
                data: {
                    id: admission.id,
                    admission_date: admission.admission_date,
                    attending_doctor: attendingDoctorName,
                    category_name: category?.name || 'General',
                    category_tier: category?.tier || 'basic',
                    ward_name: room?.name || room?.room_number,
                    bed_position: bed?.bed_identifier
                }
            };
        } catch (error: any) {
            this.logger.error('My Admission fetch error:', error);
            if (error.code === 'PGRST116') {
                 // No active admission found
                 return { success: true, data: null };
            }
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
                .order('created_at', { ascending: false });

            if (!documents) {
                return { success: true, data: { documents: [] } };
            }

            // Generate presigned URLs for each document that has an S3 file_path
            const enrichedDocuments = await Promise.all(
                documents.map(async (doc) => {
                    let url = doc.url || '#';
                    if (doc.file_path) {
                        try {
                            url = await this.s3Service.generatePresignedDownloadUrl(doc.file_path);
                        } catch (err) {
                            this.logger.warn(`Failed to generate download URL for document ${doc.id}`);
                        }
                    }
                    return {
                        ...doc,
                        url, // Append the presigned URL or fallback to existing 'url' if any
                        uploaded_at: doc.created_at // Alias created_at to uploaded_at for backward compatibility
                    };
                })
            );

            return { success: true, data: { documents: enrichedDocuments } };
        } catch (error: any) {
            this.logger.error('Vault data fetch error:', error);
            throw new HttpException({ success: false, error: 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
}
