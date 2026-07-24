import { Controller, Post, Body, Logger, HttpException, HttpStatus, UseGuards } from '@nestjs/common';
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import { ClinicsSupabaseService } from '../services/clinics-supabase.service';
import * as jwt from 'jsonwebtoken';
import * as bcrypt from 'bcrypt';

@Controller('api/patient-auth')
export class PatientAuthController {
    private readonly logger = new Logger(PatientAuthController.name);
    private readonly jwtSecret: string;
    private readonly jwtExpiresIn = '1h'; // Short expiry for patient portals
    private readonly LOCKOUT_DURATION_MINUTES = 20;
    private readonly MAX_FAILED_ATTEMPTS = 3;

    constructor(
        private readonly supabaseService: ClinicsSupabaseService,
        private readonly configService: ConfigService,
    ) {
        this.jwtSecret = this.configService.get<string>('JWT_SECRET') as string;
        if (!this.jwtSecret) throw new Error('JWT_SECRET must be defined in environment configuration');
    }

    @UseGuards(ThrottlerGuard)
    @Throttle({ default: { limit: 5, ttl: 60000 } })
    @Post('login')
    async login(@Body() body: { mobile: string; pin: string; clinic_id?: string }) {
        try {
            const { mobile, pin, clinic_id } = body;
            this.logger.log(`Patient login attempt: mobile="${mobile}", clinic_id="${clinic_id || 'unspecified'}"`);

            if (!mobile || !pin) {
                throw new HttpException({ success: false, error: 'Mobile number and PIN are required' }, HttpStatus.BAD_REQUEST);
            }

            const supabase = this.supabaseService.getClient();

            // 1. Fetch patient record by mobile number (and clinic_id if specified to disambiguate multi-tenant patients)
            let patientQuery = supabase
                .from('sakhi_clinic_patients')
                .select('id, clinic_id, name, mobile, uhid, pin_hash, failed_attempts, locked_until')
                .eq('mobile', mobile);

            if (clinic_id) {
                patientQuery = patientQuery.eq('clinic_id', clinic_id);
            }

            const { data: patients, error } = await patientQuery.limit(5);

            if (error || !patients || patients.length === 0) {
                // Return a generic error to prevent user enumeration
                throw new HttpException({ success: false, error: 'Invalid mobile number or PIN' }, HttpStatus.UNAUTHORIZED);
            }

            // If multiple records exist for this phone number across clinics and no clinic_id was specified, pick the first active PIN record
            const patient = patients.find(p => !!p.pin_hash) || patients[0];

            // 2. Check Lockout State
            if (patient.locked_until) {
                const lockTime = new Date(patient.locked_until).getTime();
                const now = new Date().getTime();

                if (now < lockTime) {
                    const remainingMinutes = Math.ceil((lockTime - now) / 60000);
                    throw new HttpException(
                        { success: false, error: `Account locked. Try again in ${remainingMinutes} minutes.` },
                        HttpStatus.FORBIDDEN
                    );
                }
            }

            // If patient has no PIN setup yet (e.g., brand new or old patient)
            if (!patient.pin_hash) {
                throw new HttpException({ success: false, error: 'No PIN has been set for this patient. Please contact the clinic.' }, HttpStatus.UNAUTHORIZED);
            }

            // 3. Crypto Verification
            let isPinValid = await bcrypt.compare(pin, patient.pin_hash);


            // 4. Handle Failure & Counter
            if (!isPinValid) {
                const newAttempts = (patient.failed_attempts || 0) + 1;
                const updateData: any = { failed_attempts: newAttempts };

                if (newAttempts >= this.MAX_FAILED_ATTEMPTS) {
                    const lockUntilDate = new Date(new Date().getTime() + this.LOCKOUT_DURATION_MINUTES * 60000);
                    updateData.locked_until = lockUntilDate.toISOString();
                }

                await supabase
                    .from('sakhi_clinic_patients')
                    .update(updateData)
                    .eq('id', patient.id);

                throw new HttpException({ success: false, error: 'Invalid mobile number or PIN' }, HttpStatus.UNAUTHORIZED);
            }

            // PIN is valid - Reset failed attempts
            await supabase
                .from('sakhi_clinic_patients')
                .update({ failed_attempts: 0, locked_until: null })
                .eq('id', patient.id);

            // 5. Issue JWT Token (with clinic_id context)
            const token = jwt.sign(
                {
                    sub: patient.id,
                    patient_id: patient.id,
                    clinic_id: patient.clinic_id,
                    uhid: patient.uhid,
                    mobile: patient.mobile,
                    role: 'patient',
                    name: patient.name,
                },
                this.jwtSecret,
                { expiresIn: this.jwtExpiresIn },
            );

            return {
                success: true,
                token,
                user: {
                    id: patient.id,
                    clinic_id: patient.clinic_id,
                    uhid: patient.uhid,
                    name: patient.name,
                    mobile: patient.mobile,
                }
            };

        } catch (error: any) {
            if (error instanceof HttpException) throw error;
            this.logger.error('Patient login error:', error);
            throw new HttpException({ success: false, error: error.message || 'Internal server error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
}
