import { Controller, Post, Body, Logger, HttpException, HttpStatus } from '@nestjs/common';
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
        this.jwtSecret = this.configService.get<string>('JWT_SECRET') || 'fallback_secret_do_not_use_in_prod';
    }

    @Post('login')
    async login(@Body() body: { mobile: string; pin: string }) {
        try {
            const { mobile, pin } = body;
            this.logger.log(`Patient login attempt: mobile="${mobile}"`);
            
            if (!mobile || !pin) {
                throw new HttpException({ success: false, error: 'Mobile number and PIN are required' }, HttpStatus.BAD_REQUEST);
            }

            const supabase = this.supabaseService.getClient();

            // 1. Fetch patient record by mobile number
            const { data: patient, error } = await supabase
                .from('sakhi_clinic_patients')
                .select('id, name, mobile, uhid, pin_hash, failed_attempts, locked_until')
                .eq('mobile', mobile)
                .single();

            if (error || !patient) {
                // Return a generic error to prevent user enumeration
                throw new HttpException({ success: false, error: 'Invalid mobile number or PIN' }, HttpStatus.UNAUTHORIZED);
            }

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
            const isPinValid = await bcrypt.compare(pin, patient.pin_hash);

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

            // 5. Issue JWT Token
            const token = jwt.sign(
                { 
                    sub: patient.id, 
                    patient_id: patient.id,
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
                    uhid: patient.uhid,
                    name: patient.name,
                    mobile: patient.mobile
                }
            };

        } catch (error: any) {
            if (error instanceof HttpException) throw error;
            this.logger.error('Patient login error:', error);
            throw new HttpException({ success: false, error: error.message || 'Internal server error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
}
