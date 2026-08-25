import { Controller, Get, Logger, HttpException, HttpStatus, Headers, Query } from '@nestjs/common';
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
        this.jwtSecret = this.configService.get<string>('JWT_SECRET') as string;
        if (!this.jwtSecret) throw new Error('JWT_SECRET must be defined in environment configuration');
    }

    private verifyPatientToken(authHeader?: string) {
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            throw new HttpException({ success: false, error: 'Unauthorized' }, HttpStatus.UNAUTHORIZED);
        }
        const token = authHeader.split(' ')[1];
        try {
            const decoded = jwt.verify(token, this.jwtSecret) as any;
            if (decoded.user_role !== 'patient' && decoded.role !== 'patient') {
                throw new HttpException({ success: false, error: 'Forbidden. Patient access only.' }, HttpStatus.FORBIDDEN);
            }
            return decoded;
        } catch (error) {
            if (error instanceof HttpException) {
                throw error;
            }
            throw new HttpException({ success: false, error: 'Invalid or expired token' }, HttpStatus.UNAUTHORIZED);
        }
    }

    @Get('dashboard')
    async getDashboardData(@Headers('authorization') authHeader: string) {
        const patient = this.verifyPatientToken(authHeader);
        const supabase = this.supabaseService.getClient();

        try {
            // 1. Fetch Patient details (Name, UHID, Gender, Age, Mobile)
            const { data: patientProfile } = await supabase
                .from('sakhi_clinic_patients')
                .select('id, name, uhid, gender, age, mobile, blood_group')
                .eq('id', patient.sub)
                .maybeSingle();

            // 2. Fetch upcoming or active appointment today
            const todayStr = new Date().toISOString().split('T')[0];
            const { data: upcomingAppointmentRaw } = await supabase
                .from('sakhi_clinic_appointments')
                .select(`
                    id,
                    appointment_date,
                    start_time,
                    status,
                    queue_status,
                    token_number,
                    visit_reason,
                    doctor_name_snapshot,
                    doctor:sakhi_clinic_users!doctor_id(first_name, last_name, specialization)
                `)
                .eq('patient_id', patient.sub)
                .gte('appointment_date', todayStr)
                .order('appointment_date', { ascending: true })
                .order('start_time', { ascending: true })
                .limit(1)
                .maybeSingle();

            let upcomingAppointment: any = null;
            if (upcomingAppointmentRaw) {
                const doc = upcomingAppointmentRaw.doctor as any;
                const doctorName = upcomingAppointmentRaw.doctor_name_snapshot || 
                    (doc ? `Dr. ${doc.first_name || ''} ${doc.last_name || ''}`.trim() : 'Doctor Consultation');
                upcomingAppointment = {
                    id: upcomingAppointmentRaw.id,
                    appointment_date: upcomingAppointmentRaw.appointment_date,
                    appointment_time: upcomingAppointmentRaw.start_time,
                    status: upcomingAppointmentRaw.status || 'Confirmed',
                    queueToken: upcomingAppointmentRaw.token_number ? `#${upcomingAppointmentRaw.token_number}` : undefined,
                    queueStatus: upcomingAppointmentRaw.queue_status,
                    doctorName,
                    specialty: doc?.specialization || 'Outpatient Care',
                    reason_for_visit: upcomingAppointmentRaw.visit_reason
                };
            }

            // 3. Fetch latest active prescriptions (structured from sakhi_clinic_prescriptions)
            const { data: prescriptionsRaw } = await supabase
                .from('sakhi_clinic_prescriptions')
                .select('id, medication_name, dosage, frequency, duration, instructions, created_at, status')
                .eq('patient_id', patient.sub)
                .neq('status', 'CANCELLED')
                .order('created_at', { ascending: false })
                .limit(10);

            const prescriptions: any[] = (prescriptionsRaw || []).map((rx: any) => ({
                id: rx.id,
                medicationName: rx.medication_name || 'Prescribed Medicine',
                dosage: rx.dosage || 'As directed',
                frequency: rx.frequency || 'Per doctor advice',
                duration: rx.duration,
                instructions: rx.instructions,
                date: rx.created_at
            }));

            // 4. Fetch latest documents (lab reports, scans, and PDFs)
            const { data: documentsRaw } = await supabase
                .from('sakhi_clinic_documents')
                .select('id, name, document_type, file_path, created_at')
                .eq('patient_id', patient.sub)
                .neq('status', 'DELETED')
                .order('created_at', { ascending: false })
                .limit(10);

            const enrichedDocs = await Promise.all(
                (documentsRaw || []).map(async (doc: any) => {
                    let url: string | undefined = undefined;
                    if (doc.file_path) {
                        try {
                            url = await this.s3Service.generatePresignedDownloadUrl(doc.file_path);
                        } catch (err) {
                            this.logger.warn(`Failed to sign URL for ${doc.file_path}`);
                        }
                    }
                    return {
                        id: doc.id,
                        name: doc.name,
                        document_type: doc.document_type || 'document',
                        date: doc.created_at,
                        url
                    };
                })
            );

            // Separate lab reports from prescription documents
            const labReports = enrichedDocs
                .filter((d: any) => {
                    const type = (d.document_type || '').toLowerCase();
                    const name = (d.name || '').toLowerCase();
                    return !type.includes('prescription') && !name.includes('prescription');
                })
                .map((d: any) => ({
                    id: d.id,
                    testName: d.name || 'Diagnostic Investigation',
                    date: d.date,
                    status: 'Ready',
                    downloadUrl: d.url
                }));

            // If prescription PDFs exist in documents, add them to prescriptions
            enrichedDocs
                .filter((d: any) => {
                    const type = (d.document_type || '').toLowerCase();
                    const name = (d.name || '').toLowerCase();
                    return type.includes('prescription') || name.includes('prescription');
                })
                .forEach((d: any) => {
                    prescriptions.push({
                        id: d.id,
                        medicationName: d.name || 'Prescription Document (PDF)',
                        dosage: 'Uploaded Document',
                        frequency: 'Digital Record',
                        instructions: `Issued on ${new Date(d.date).toLocaleDateString()}`,
                        date: d.date
                    });
                });

            // 5. Fetch latest vitals
            const { data: vitalsRows } = await supabase
                .from('sakhi_clinic_patient_vitals')
                .select('vital_type, vital_value, recorded_at')
                .eq('patient_id', patient.sub)
                .order('recorded_at', { ascending: false })
                .limit(10);

            let vitals: any = undefined;
            if (vitalsRows && vitalsRows.length > 0) {
                const bpRow = vitalsRows.find(v => v.vital_type?.toLowerCase().includes('bp') || v.vital_type?.toLowerCase().includes('pressure'));
                const pulseRow = vitalsRows.find(v => v.vital_type?.toLowerCase().includes('pulse') || v.vital_type?.toLowerCase().includes('heart'));
                const tempRow = vitalsRows.find(v => v.vital_type?.toLowerCase().includes('temp'));
                const weightRow = vitalsRows.find(v => v.vital_type?.toLowerCase().includes('weight'));

                vitals = {
                    bloodPressure: bpRow ? bpRow.vital_value : undefined,
                    heartRate: pulseRow ? parseInt(pulseRow.vital_value, 10) || undefined : undefined,
                    temperature: tempRow ? parseFloat(tempRow.vital_value) || undefined : undefined,
                    weight: weightRow ? parseFloat(weightRow.vital_value) || undefined : undefined,
                    recordedAt: vitalsRows[0].recorded_at
                };
            }

            // 6. Fetch Medical Alerts
            const { data: allergies } = await supabase
                .from('sakhi_clinic_allergies')
                .select('allergy_name, severity')
                .eq('patient_id', patient.sub);

            const medicalAlerts: any[] = [];
            if (allergies && allergies.length > 0) {
                allergies.forEach(a => {
                    medicalAlerts.push({
                        title: `Allergy: ${a.allergy_name}`,
                        description: `Severity: ${a.severity || 'Moderate'}`,
                        severity: a.severity === 'Severe' || a.severity === 'High' ? 'High' : 'Medium'
                    });
                });
            }

            return {
                success: true,
                data: {
                    patient: {
                        id: patientProfile?.id || patient.sub,
                        name: patientProfile?.name || patient.name,
                        uhid: patientProfile?.uhid || patient.uhid,
                        gender: patientProfile?.gender,
                        age: patientProfile?.age,
                        mobile: patientProfile?.mobile || patient.mobile,
                        blood_group: patientProfile?.blood_group
                    },
                    upcomingAppointment,
                    prescriptions,
                    labReports,
                    vitals,
                    medicalAlerts
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
            // Fixed query: start_time instead of appointment_time, join doctor
            const { data: appointments, error } = await supabase
                .from('sakhi_clinic_appointments')
                .select(`
                    id,
                    appointment_date,
                    start_time,
                    end_time,
                    status,
                    queue_status,
                    token_number,
                    visit_reason,
                    doctor_name_snapshot,
                    doctor:sakhi_clinic_users!doctor_id(first_name, last_name, specialization)
                `)
                .eq('patient_id', patient.sub)
                .order('appointment_date', { ascending: false })
                .order('start_time', { ascending: false });

            if (error) {
                this.logger.error('Supabase appointments error:', error);
                throw error;
            }

            const mapped = (appointments || []).map((a: any) => {
                const doc = a.doctor as any;
                const doctorName = a.doctor_name_snapshot || 
                    (doc ? `Dr. ${doc.first_name || ''} ${doc.last_name || ''}`.trim() : 'Doctor Consultation');
                return {
                    id: a.id,
                    appointment_date: a.appointment_date,
                    appointment_time: a.start_time,
                    status: a.status || 'Scheduled',
                    queueToken: a.token_number ? `#${a.token_number}` : undefined,
                    queueStatus: a.queue_status,
                    doctorName,
                    specialty: doc?.specialization || 'Outpatient Care',
                    reason_for_visit: a.visit_reason
                };
            });

            return { success: true, data: mapped };
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
                .maybeSingle();

            if (!admission) {
                return { success: true, data: null };
            }

            let attendingDoctorName = 'Doctor Assigned';
            if (admission.attending_doctor_id) {
                const { data: doctor } = await supabase
                    .from('sakhi_clinic_users')
                    .select('first_name, last_name')
                    .eq('id', admission.attending_doctor_id)
                    .maybeSingle();
                if (doctor) attendingDoctorName = `${doctor.first_name || ''} ${doctor.last_name || ''}`.trim();
            }

            const assignment = admission.sakhi_clinic_bed_assignments?.[0] as any;
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
            return { success: true, data: null };
        }
    }

    @Get('vault')
    async getClinicalVault(@Headers('authorization') authHeader: string) {
        const patient = this.verifyPatientToken(authHeader);
        const supabase = this.supabaseService.getClient();

        try {
            // 1. Fetch Documents (Prescriptions, Lab Reports, Scans)
            const { data: documentsRaw } = await supabase
                .from('sakhi_clinic_documents')
                .select('*')
                .eq('patient_id', patient.sub)
                .order('created_at', { ascending: false });

            // 2. Fetch Structured Prescriptions
            const { data: prescriptionsRaw } = await supabase
                .from('sakhi_clinic_prescriptions')
                .select('*')
                .eq('patient_id', patient.sub)
                .neq('status', 'CANCELLED')
                .order('created_at', { ascending: false });

            const enrichedDocuments: any[] = [];

            // Add signed document files
            if (documentsRaw && documentsRaw.length > 0) {
                for (const doc of documentsRaw) {
                    let url: string | undefined = doc.url || undefined;
                    if (doc.file_path) {
                        try {
                            url = await this.s3Service.generatePresignedDownloadUrl(doc.file_path);
                        } catch (err) {
                            this.logger.warn(`Failed to generate S3 URL for ${doc.file_path}`);
                        }
                    }

                    let docType = (doc.document_type || '').toLowerCase();
                    const name = (doc.name || '').toLowerCase();
                    if (!docType || docType === 'document') {
                        if (name.includes('prescription')) docType = 'prescription';
                        else if (name.includes('scan') || name.includes('imaging') || name.includes('xray')) docType = 'scan-imaging';
                        else docType = 'lab-report';
                    }

                    enrichedDocuments.push({
                        id: doc.id,
                        name: doc.name || 'Clinical Document',
                        document_type: docType,
                        url,
                        file_path: doc.file_path,
                        uploaded_at: doc.created_at || new Date().toISOString(),
                        is_file: true
                    });
                }
            }

            // Add structured doctor prescriptions into the vault
            if (prescriptionsRaw && prescriptionsRaw.length > 0) {
                for (const rx of prescriptionsRaw) {
                    enrichedDocuments.push({
                        id: rx.id,
                        name: `${rx.medication_name || 'Prescription'} (${rx.dosage || 'As directed'})`,
                        document_type: 'prescription',
                        dosage: rx.dosage,
                        frequency: rx.frequency,
                        duration: rx.duration,
                        instructions: rx.instructions,
                        uploaded_at: rx.created_at || new Date().toISOString(),
                        is_file: false
                    });
                }
            }

            // Sort all records latest first
            enrichedDocuments.sort((a, b) => new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime());

            return { success: true, data: { documents: enrichedDocuments } };
        } catch (error: any) {
            this.logger.error('Vault data fetch error:', error);
            throw new HttpException({ success: false, error: 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Get('timeline')
    async getTimeline(
        @Headers('authorization') authHeader: string, 
        @Query('page') page: string = '1', 
        @Query('limit') limit: string = '20',
        @Query('types') types?: string
    ) {
        const patient = this.verifyPatientToken(authHeader);
        const supabase = this.supabaseService.getClient();
        const pageNum = parseInt(page, 10);
        const limitNum = parseInt(limit, 10);
        const offset = (pageNum - 1) * limitNum;

        try {
            let query = supabase
                .from('sakhi_clinic_patient_timeline_view')
                .select('*')
                .eq('patient_id', patient.sub);

            if (types) {
                const typeList = types.split(',').map(t => t.trim().toUpperCase());
                if (typeList.length > 0) {
                    query = query.in('event_type', typeList);
                }
            }

            const { data: timeline, error } = await query
                .order('event_date', { ascending: false })
                .range(offset, offset + limitNum - 1);

            if (error) throw error;

            // Generate presigned URLs for documents & categorize prescription files
            const enriched = await Promise.all(
                (timeline || []).map(async (item) => {
                    let url: string | undefined = undefined;
                    if (item.file_url) {
                        try {
                            url = await this.s3Service.generatePresignedDownloadUrl(item.file_url);
                        } catch (err) {
                            this.logger.warn(`Failed to generate S3 URL for timeline file ${item.file_url}`);
                        }
                    }

                    // If it is a document with prescription in the title/filename, categorize as PRESCRIPTION
                    let eventType = item.event_type;
                    const isPrescriptionFile = (item.title || '').toLowerCase().includes('prescription') || 
                                              (item.file_url || '').toLowerCase().includes('prescription');
                    if (eventType === 'INVESTIGATION' && isPrescriptionFile) {
                        eventType = 'PRESCRIPTION';
                    }

                    return {
                        id: item.source_id,
                        patient_id: item.patient_id,
                        event_type: eventType,
                        title: item.title,
                        description: item.description,
                        file_url: item.file_url,
                        url,
                        created_at: item.event_date || item.created_at,
                        event_date: item.event_date
                    };
                })
            );

            return { success: true, data: enriched };
        } catch (error: any) {
            this.logger.error('Timeline fetch error:', error);
            throw new HttpException({ success: false, error: 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
}
