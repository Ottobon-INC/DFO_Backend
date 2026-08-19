import { Injectable, Logger, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';
import { SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class AbdmService {
    private readonly logger = new Logger(AbdmService.name);

    constructor(
        private readonly configService: ConfigService,
        @Inject('SUPABASE_CLIENT') private readonly supabase: SupabaseClient
    ) { }

    /**
     * Generates a new session token from the ABDM Sandbox.
     * Must never expose credentials or the full token to the frontend.
     */
    async generateSession(): Promise<any> {
        const clientId = this.configService.get<string>('app.abdm.clientId');
        const clientSecret = this.configService.get<string>('app.abdm.clientSecret');
        const xCmId = this.configService.get<string>('app.abdm.xCmId');
        const sessionUrl = this.configService.get<string>('app.abdm.sessionUrl');

        if (!clientId || !clientSecret || !sessionUrl) {
            this.logger.error('ABDM configuration is incomplete. Cannot generate session.');
            throw new HttpException('ABDM Configuration Error', HttpStatus.INTERNAL_SERVER_ERROR);
        }

        const requestId = uuidv4();
        const timestamp = new Date().toISOString();

        const headers = {
            'REQUEST-ID': requestId,
            'TIMESTAMP': timestamp,
            'X-CM-ID': xCmId || 'sbx',
            'Content-Type': 'application/json',
        };

        const payload = {
            clientId,
            clientSecret,
            grantType: 'client_credentials',
        };

        try {
            const response = await axios.post(sessionUrl, payload, { headers });

            // Safe logging, never log tokens
            this.logger.log(`ABDM Session generated successfully. REQUEST-ID: ${requestId}`);

            // Return the full response for internal use by other backend services
            return {
                success: true,
                ...response.data
            };
        } catch (error: any) {
            // Strip the secret out of any logged payload to prevent leakage
            const safePayload = { ...payload, clientSecret: '***REDACTED***' };

            if (error.response) {
                // ABDM responded with a non-2xx status code
                this.logger.error(
                    `ABDM Session API failed. REQUEST-ID: ${requestId}, Status: ${error.response.status}, Error: ${JSON.stringify(error.response.data)}`,
                );
                // Return safe diagnostic info
                throw new HttpException({
                    success: false,
                    error: 'ABDM API Error',
                    status: error.response.status,
                    details: error.response.data,
                    requestId
                }, HttpStatus.BAD_GATEWAY);
            } else if (error.request) {
                // Network error
                this.logger.error(`ABDM Session API network error. REQUEST-ID: ${requestId}. Error: ${error.message}`);
                throw new HttpException({
                    success: false,
                    error: 'Network Error connecting to ABDM',
                    requestId
                }, HttpStatus.GATEWAY_TIMEOUT);
            } else {
                // Generic error
                this.logger.error(`ABDM Session API unexpected error. REQUEST-ID: ${requestId}. Error: ${error.message}`);
                throw new HttpException({
                    success: false,
                    error: 'Unexpected Error connecting to ABDM',
                    requestId
                }, HttpStatus.INTERNAL_SERVER_ERROR);
            }
        }
    }

    /**
     * Retrieves the ABDM Public Certificate.
     * Required for data encryption.
     */
    async getPublicCertificate(accessToken?: string): Promise<{ publicKey: string; encryptionAlgorithm: string }> {
        const publicCertUrl = this.configService.get<string>('app.abdm.publicCertUrl');

        if (!publicCertUrl) {
            this.logger.error('ABDM configuration is incomplete. Missing publicCertUrl.');
            throw new HttpException('ABDM Configuration Error', HttpStatus.INTERNAL_SERVER_ERROR);
        }

        // We must authenticate first if no token provided
        if (!accessToken) {
            const session = await this.generateSession();
            accessToken = session.accessToken as string;
        }

        const requestId = uuidv4();
        const timestamp = new Date().toISOString();

        const headers = {
            'Authorization': `Bearer ${accessToken}`,
            'REQUEST-ID': requestId,
            'TIMESTAMP': timestamp,
            'Content-Type': 'application/json',
        };

        try {
            const response = await axios.get(publicCertUrl, { headers });

            this.logger.log(`ABDM Public Certificate fetched successfully. REQUEST-ID: ${requestId}`);

            return {
                publicKey: response.data.publicKey,
                encryptionAlgorithm: response.data.encryptionAlgorithm || 'RSA/ECB/OAEPWithSHA-1AndMGF1Padding'
            };
        } catch (error: any) {
            if (error.response) {
                this.logger.error(
                    `ABDM Public Certificate API failed. REQUEST-ID: ${requestId}, Status: ${error.response.status}, Error: ${JSON.stringify(error.response.data)}`,
                );
                throw new HttpException({
                    success: false,
                    error: 'ABDM Public Cert API Error',
                    status: error.response.status,
                    details: error.response.data,
                    requestId
                }, HttpStatus.BAD_GATEWAY);
            } else if (error.request) {
                this.logger.error(`ABDM Public Cert API network error. REQUEST-ID: ${requestId}. Error: ${error.message}`);
                throw new HttpException({
                    success: false,
                    error: 'Network Error connecting to ABDM',
                    requestId
                }, HttpStatus.GATEWAY_TIMEOUT);
            } else {
                this.logger.error(`ABDM Public Cert API unexpected error. REQUEST-ID: ${requestId}. Error: ${error.message}`);
                throw new HttpException({
                    success: false,
                    error: 'Unexpected Error connecting to ABDM',
                    requestId
                }, HttpStatus.INTERNAL_SERVER_ERROR);
            }
        }
    }

    /**
     * Encrypts plaintext data using the ABDM Public Certificate.
     * Implements RSA/ECB/OAEPWithSHA-1AndMGF1Padding.
     */
    encryptData(plaintext: string, publicKey: string): string {
        try {
            let formattedKey = publicKey;

            // Check if the public key is raw Base64 and lacks PEM headers
            if (!formattedKey.includes('-----BEGIN PUBLIC KEY-----')) {
                // Split base64 into 64-character lines
                const matchedLines = formattedKey.match(/.{1,64}/g) || [];
                formattedKey = `-----BEGIN PUBLIC KEY-----\n${matchedLines.join('\n')}\n-----END PUBLIC KEY-----`;
            }

            const encryptedBuffer = crypto.publicEncrypt(
                {
                    key: formattedKey,
                    padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
                    oaepHash: 'sha1',
                },
                Buffer.from(plaintext, 'utf8')
            );

            return encryptedBuffer.toString('base64');
        } catch (error: any) {
            this.logger.error(`Encryption failed: ${error.message}`);
            throw new HttpException('Data encryption failed', HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    /**
     * Request Aadhaar OTP from ABDM Sandbox.
     * Generates a single session token to be used across certificate fetch and OTP request.
     */
    async requestAadhaarOtp(aadhaarNumber: string): Promise<{ txnId: string; message: string }> {
        if (!/^\d{12}$/.test(aadhaarNumber)) {
            throw new HttpException('Invalid Aadhaar format', HttpStatus.BAD_REQUEST);
        }

        const aadhaarOtpUrl = this.configService.get<string>('app.abdm.aadhaarOtpUrl');
        if (!aadhaarOtpUrl) {
            this.logger.error('ABDM configuration is incomplete. Missing aadhaarOtpUrl.');
            throw new HttpException('ABDM Configuration Error', HttpStatus.INTERNAL_SERVER_ERROR);
        }

        const requestId = uuidv4();

        try {
            // 1. Authenticate once
            const session = await this.generateSession();
            const accessToken = session.accessToken;

            // 2. Fetch Public Certificate using the existing token
            const { publicKey } = await this.getPublicCertificate(accessToken);

            // 3. Encrypt Aadhaar number
            const encryptedAadhaar = this.encryptData(aadhaarNumber, publicKey);

            // 4. Request OTP
            const timestamp = new Date().toISOString();
            const headers = {
                'REQUEST-ID': requestId,
                'TIMESTAMP': timestamp,
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            };

            const payload = {
                txnId: "",
                scope: ["abha-enrol"],
                loginHint: "aadhaar",
                loginId: encryptedAadhaar,
                otpSystem: "aadhaar"
            };

            const response = await axios.post(aadhaarOtpUrl, payload, { headers });

            const { txnId, message } = response.data || {};

            if (!txnId || !message) {
                throw new Error('ABDM Response missing txnId or message');
            }

            this.logger.log(`Aadhaar OTP request successful. REQUEST-ID: ${requestId}`);

            return { txnId, message };
        } catch (error: any) {
            if (error.response) {
                // Ensure no sensitive data is leaked from response payload
                let safeDetails = error.response.data;
                if (typeof safeDetails === 'object' && safeDetails !== null) {
                    safeDetails = { ...safeDetails };
                    delete safeDetails.loginId; // just in case ABDM echoes back
                }

                this.logger.error(
                    `Aadhaar OTP request failed. REQUEST-ID: ${requestId}, Status: ${error.response.status}, Error: ${JSON.stringify(safeDetails)}`,
                );
                throw new HttpException({
                    success: false,
                    error: 'ABDM OTP Request Error',
                    status: error.response.status,
                    details: safeDetails,
                    requestId
                }, HttpStatus.BAD_GATEWAY);
            } else if (error.request) {
                this.logger.error(`Aadhaar OTP request network error. REQUEST-ID: ${requestId}. Error: ${error.message}`);
                throw new HttpException({
                    success: false,
                    error: 'Network Error connecting to ABDM',
                    requestId
                }, HttpStatus.GATEWAY_TIMEOUT);
            } else {
                this.logger.error(`Aadhaar OTP request unexpected error. REQUEST-ID: ${requestId}. Error: ${error.message}`);
                throw new HttpException({
                    success: false,
                    error: 'Unexpected Error requesting Aadhaar OTP',
                    requestId
                }, HttpStatus.INTERNAL_SERVER_ERROR);
            }
        }
    }

    /**
     * Step 3: Enrol ABHA via Aadhaar OTP
     * Verified strictly against the official M1 Postman structure.
     */
    async enrolAbhaViaAadhaarOtp(patientId: string, txnId: string, otp: string, mobile: string): Promise<any> {
        if (!patientId || !txnId || !otp || !mobile) {
            throw new HttpException('Missing required parameters for ABHA enrolment', HttpStatus.BAD_REQUEST);
        }

        const enrolByAadhaarUrl = this.configService.get<string>('app.abdm.enrolByAadhaarUrl');
        if (!enrolByAadhaarUrl) {
            this.logger.error('ABDM configuration is incomplete. Missing enrolByAadhaarUrl.');
            throw new HttpException('ABDM Configuration Error', HttpStatus.INTERNAL_SERVER_ERROR);
        }

        const requestId = uuidv4();

        try {
            // 1. Authenticate once internally (do not expose or require from frontend)
            const session = await this.generateSession();
            const accessToken = session.accessToken;

            // 2. Fetch Public Certificate using the internal token
            const { publicKey } = await this.getPublicCertificate(accessToken);

            // 3. Encrypt the OTP using the public key
            const encryptedOtp = this.encryptData(otp, publicKey);

            // 4. Construct the official request body (without timeStamp as per the authoritative guide)
            const timestamp = new Date().toISOString();
            const headers = {
                'REQUEST-ID': requestId,
                'TIMESTAMP': timestamp,
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            };

            const payload = {
                authData: {
                    authMethods: ["otp"],
                    otp: {
                        txnId: txnId,
                        otpValue: encryptedOtp,
                        mobile: mobile
                    }
                },
                consent: {
                    code: "abha-enrollment",
                    version: "1.4"
                }
            };

            // 5. Fire request
            const response = await axios.post(enrolByAadhaarUrl, payload, { headers });

            // 6. Return only sanitized success metrics
            const responseData = response.data || {};
            const profile = responseData.ABHAProfile || {};

            const abhaNumber = profile.ABHANumber || profile.abhaNumber || '';
            const phrAddressArray = profile.phrAddress || [];
            const abhaAddress = phrAddressArray.length > 0 ? phrAddressArray[0] : '';

            // Mask ABHA Number (e.g. 12-3456-7890-1234 -> **-****-****-1234)
            let maskedAbhaNumber = abhaNumber;
            if (maskedAbhaNumber.length > 4) {
                maskedAbhaNumber = maskedAbhaNumber.slice(0, -4).replace(/[0-9]/g, '*') + maskedAbhaNumber.slice(-4);
            }

            // Mask ABHA Address
            let maskedAbhaAddress = abhaAddress;
            if (maskedAbhaAddress.includes('@')) {
                const parts = maskedAbhaAddress.split('@');
                if (parts[0].length > 2) {
                    maskedAbhaAddress = parts[0].substring(0, 2) + '***@' + parts[1];
                }
            }

            this.logger.log(`ABHA Enrolment via Aadhaar successful. REQUEST-ID: ${requestId}`);

            // === DFO HIMS ABHA PERSISTENCE ===
            try {
                // 1. Verify patient and get clinic_id
                const { data: patient, error: patientError } = await this.supabase
                    .from('sakhi_clinic_patients')
                    .select('clinic_id')
                    .eq('id', patientId)
                    .single();

                if (patientError || !patient) {
                    throw new HttpException('Patient not found', HttpStatus.NOT_FOUND);
                }

                const clinicId = patient.clinic_id;

                // 2. Check existing active ABHA for this patient
                const { data: existingActive } = await this.supabase
                    .from('patient_abha')
                    .select('id, abha_number')
                    .eq('patient_id', patientId)
                    .eq('is_active', true)
                    .single();

                if (existingActive) {
                    // Identity conflict check
                    if (existingActive.abha_number && abhaNumber && existingActive.abha_number !== abhaNumber) {
                        throw new HttpException('Identity Conflict: Patient already has a different active ABHA number', HttpStatus.CONFLICT);
                    }

                    // If same number or updating, update the record
                    await this.supabase
                        .from('patient_abha')
                        .update({
                            abha_number: abhaNumber || null,
                            abha_address: abhaAddress || null,
                            verification_status: 'VERIFIED',
                            verified_at: new Date().toISOString(),
                            updated_at: new Date().toISOString()
                        })
                        .eq('id', existingActive.id);

                } else {
                    // 3. Check Clinic-level Number conflict
                    if (abhaNumber) {
                        const { data: numberConflict } = await this.supabase
                            .from('patient_abha')
                            .select('id')
                            .eq('clinic_id', clinicId)
                            .eq('abha_number', abhaNumber)
                            .eq('is_active', true)
                            .single();

                        if (numberConflict) {
                            throw new HttpException('ABHA Number Conflict: Already actively linked to another patient in this clinic', HttpStatus.CONFLICT);
                        }
                    }

                    // 4. Check Clinic-level Address conflict
                    if (abhaAddress) {
                        const { data: addressConflict } = await this.supabase
                            .from('patient_abha')
                            .select('id')
                            .eq('clinic_id', clinicId)
                            .eq('abha_address', abhaAddress)
                            .eq('is_active', true)
                            .single();

                        if (addressConflict) {
                            throw new HttpException('ABHA Address Conflict: Already actively linked to another patient in this clinic', HttpStatus.CONFLICT);
                        }
                    }

                    // 5. Insert new record
                    const payload = {
                        patient_id: patientId,
                        clinic_id: clinicId,
                        abha_number: abhaNumber || null,
                        abha_address: abhaAddress || null,
                        verification_status: 'VERIFIED',
                        is_active: true,
                        verified_at: new Date().toISOString()
                    };

                    const { error: insertError } = await this.supabase.from('patient_abha').insert([payload]);
                    if (insertError) {
                        this.logger.error(`Database insert error for patient_abha: ${JSON.stringify(insertError)}`);
                        throw new HttpException('Database error while persisting ABHA', HttpStatus.INTERNAL_SERVER_ERROR);
                    }
                }
            } catch (dbError: any) {
                // If it's our own HttpException, rethrow it
                if (dbError instanceof HttpException) {
                    throw dbError;
                }
                this.logger.error(`Unexpected database error: ${dbError.message}`);
                throw new HttpException('Database error while persisting ABHA', HttpStatus.INTERNAL_SERVER_ERROR);
            }
            // ===================================

            return {
                success: true,
                isNew: responseData.isNew,
                message: responseData.message || 'ABHA Profile created successfully',
                maskedAbhaNumber,
                maskedAbhaAddress
            };

        } catch (error: any) {
            if (error instanceof HttpException) {
                throw error;
            }

            if (error.response) {
                this.logger.error(`ABHA Enrolment via Aadhaar failed. REQUEST-ID: ${requestId}. Status: ${error.response.status}`);
                throw new HttpException({
                    success: false,
                    error: 'ABDM Enrolment Error',
                    status: error.response.status,
                    details: error.response.data,
                    requestId
                }, HttpStatus.BAD_GATEWAY);
            }

            this.logger.error(`Unexpected Error during ABHA Enrolment. REQUEST-ID: ${requestId}. Error: ${error.message}`);
            throw new HttpException('Unexpected Error during ABHA Enrolment', HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    /**
     * Get ABHA Address suggestions for a given enrollment transaction
     */
    async getAbhaAddressSuggestions(patientId: string, txnId: string): Promise<any> {
        if (!patientId || !txnId) {
            throw new HttpException('Missing required parameters', HttpStatus.BAD_REQUEST);
        }

        const suggestionUrl = this.configService.get<string>('app.abdm.abhaAddressSuggestionUrl');
        if (!suggestionUrl) {
            throw new HttpException('ABDM Configuration Error', HttpStatus.INTERNAL_SERVER_ERROR);
        }

        const requestId = uuidv4();

        try {
            // 1. Verify patient context
            const { data: patient, error: patientError } = await this.supabase
                .from('sakhi_clinic_patients')
                .select('id')
                .eq('id', patientId)
                .single();

            if (patientError || !patient) {
                throw new HttpException('Patient not found', HttpStatus.NOT_FOUND);
            }

            // Allow suggestions even if abha_address is null
            const { data: existingActive } = await this.supabase
                .from('patient_abha')
                .select('id')
                .eq('patient_id', patientId)
                .eq('is_active', true)
                .single();

            if (!existingActive) {
                throw new HttpException('No active ABHA enrollment context found for this patient', HttpStatus.BAD_REQUEST);
            }

            // 2. Authenticate
            const session = await this.generateSession();
            const accessToken = session.accessToken;

            // 3. Request
            const timestamp = new Date().toISOString();
            const headers = {
                'REQUEST-ID': requestId,
                'TIMESTAMP': timestamp,
                'Authorization': `Bearer ${accessToken}`,
                'Transaction_Id': txnId
            };

            const response = await axios.get(suggestionUrl, { headers });

            return {
                success: true,
                suggestions: response.data || []
            };

        } catch (error: any) {
            if (error instanceof HttpException) {
                throw error;
            }
            if (error.response) {
                this.logger.error(`ABHA Address Suggestion failed. REQUEST-ID: ${requestId}. Status: ${error.response.status}`);
                throw new HttpException({
                    success: false,
                    error: 'Failed to fetch ABHA Address suggestions',
                    details: error.response.data
                }, HttpStatus.BAD_GATEWAY);
            }
            throw new HttpException('Unexpected Error fetching suggestions', HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    /**
     * Create ABHA Address and link it to the patient profile
     */
    async createAbhaAddress(patientId: string, txnId: string, abhaAddress: string): Promise<any> {
        if (!patientId || !txnId || !abhaAddress) {
            throw new HttpException('Missing required parameters', HttpStatus.BAD_REQUEST);
        }

        const createUrl = this.configService.get<string>('app.abdm.abhaAddressCreateUrl');
        if (!createUrl) {
            throw new HttpException('ABDM Configuration Error', HttpStatus.INTERNAL_SERVER_ERROR);
        }

        const requestId = uuidv4();

        try {
            // 1. Verify patient context and clinic
            const { data: patient, error: patientError } = await this.supabase
                .from('sakhi_clinic_patients')
                .select('clinic_id')
                .eq('id', patientId)
                .single();

            if (patientError || !patient) {
                throw new HttpException('Patient not found', HttpStatus.NOT_FOUND);
            }

            // 2. Ensure active ABHA record exists
            const { data: existingActive } = await this.supabase
                .from('patient_abha')
                .select('id, abha_number')
                .eq('patient_id', patientId)
                .eq('is_active', true)
                .single();

            if (!existingActive) {
                throw new HttpException('No active ABHA context found for this patient', HttpStatus.BAD_REQUEST);
            }

            // 3. Authenticate
            const session = await this.generateSession();
            const accessToken = session.accessToken;

            // 4. Request
            const timestamp = new Date().toISOString();
            const headers = {
                'REQUEST-ID': requestId,
                'TIMESTAMP': timestamp,
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            };

            const payload = {
                txnId: txnId,
                abhaAddress: abhaAddress,
                preferred: 1
            };

            const response = await axios.post(createUrl, payload, { headers });

            const responseData = response.data || {};
            const preferredAbhaAddress = responseData.preferredAbhaAddress || abhaAddress;
            const healthIdNumber = responseData.healthIdNumber; // The ABHA Number

            // 5. Check if healthIdNumber matches (or is missing)
            let abhaNumberToSave = existingActive.abha_number;

            if (healthIdNumber) {
                if (existingActive.abha_number && existingActive.abha_number !== healthIdNumber) {
                    throw new HttpException('Identity Conflict: ABDM returned a different ABHA Number than what is stored', HttpStatus.CONFLICT);
                }
                abhaNumberToSave = healthIdNumber;
            }

            // 6. Update the existing active patient_abha record
            const { error: updateError } = await this.supabase
                .from('patient_abha')
                .update({
                    abha_address: preferredAbhaAddress,
                    abha_number: abhaNumberToSave, // Usually unchanged, but reconciled if null previously
                    updated_at: new Date().toISOString()
                })
                .eq('id', existingActive.id);

            if (updateError) {
                throw new HttpException('Database error updating patient ABHA address', HttpStatus.INTERNAL_SERVER_ERROR);
            }

            return {
                success: true,
                message: 'ABHA Address created and linked successfully',
                abhaAddress: preferredAbhaAddress
            };

        } catch (error: any) {
            if (error instanceof HttpException) {
                throw error;
            }

            if (error.response) {
                this.logger.error(`ABHA Address Creation failed. REQUEST-ID: ${requestId}. Status: ${error.response.status}`);
                throw new HttpException({
                    success: false,
                    error: 'Failed to create ABHA Address',
                    details: error.response.data
                }, HttpStatus.BAD_GATEWAY);
            }
            throw new HttpException('Unexpected Error creating ABHA address', HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    /**
     * Search Auth Methods for ABHA Address Verification
     */
    async searchAuthMethods(patientId: string, abhaAddress: string): Promise<any> {
        if (!patientId || !abhaAddress) {
            throw new HttpException('Missing required parameters', HttpStatus.BAD_REQUEST);
        }

        const searchUrl = this.configService.get<string>('app.abdm.abhaAddressSearchUrl') || 'https://abhasbx.abdm.gov.in/abha/api/v3/phr/web/login/abha/search';
        const requestId = uuidv4();

        try {
            // 1. Verify patient exists
            const { data: patient, error: patientError } = await this.supabase
                .from('sakhi_clinic_patients')
                .select('id')
                .eq('id', patientId)
                .single();

            if (patientError || !patient) {
                throw new HttpException('Patient not found', HttpStatus.NOT_FOUND);
            }

            // 2. Authenticate
            const session = await this.generateSession();
            const accessToken = session.accessToken;

            // 3. Request
            const timestamp = new Date().toISOString();
            const headers = {
                'REQUEST-ID': requestId,
                'TIMESTAMP': timestamp,
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            };

            const payload = {
                abhaAddress: abhaAddress
            };

            const response = await axios.post(searchUrl, payload, { headers });

            return {
                success: true,
                ...response.data
            };

        } catch (error: any) {
            if (error instanceof HttpException) {
                throw error;
            }
            if (error.response) {
                this.logger.error(`Search Auth Methods failed. REQUEST-ID: ${requestId}. Status: ${error.response.status}`);
                throw new HttpException({
                    success: false,
                    error: 'Failed to search auth methods',
                    details: error.response.data
                }, HttpStatus.BAD_GATEWAY);
            }
            throw new HttpException('Unexpected Error searching auth methods', HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    /**
     * Request Mobile OTP for ABHA Address Verification
     */
    async requestMobileOtp(patientId: string, abhaAddress: string): Promise<any> {
        if (!patientId || !abhaAddress) {
            throw new HttpException('Missing required parameters', HttpStatus.BAD_REQUEST);
        }

        const requestOtpUrl = this.configService.get<string>('app.abdm.abhaAddressRequestOtpUrl') || 'https://abhasbx.abdm.gov.in/abha/api/v3/phr/web/login/abha/request/otp';
        const requestId = uuidv4();

        try {
            // 1. Verify patient exists
            const { data: patient, error: patientError } = await this.supabase
                .from('sakhi_clinic_patients')
                .select('id')
                .eq('id', patientId)
                .single();

            if (patientError || !patient) {
                throw new HttpException('Patient not found', HttpStatus.NOT_FOUND);
            }

            // 2. Authenticate
            const session = await this.generateSession();
            const accessToken = session.accessToken;

            // 3. Fetch Public Certificate
            const { publicKey } = await this.getPublicCertificate(accessToken);

            // 4. Encrypt ABHA Address
            const encryptedAbhaAddress = this.encryptData(abhaAddress, publicKey);

            // 5. Request OTP
            const timestamp = new Date().toISOString();
            const headers = {
                'REQUEST-ID': requestId,
                'TIMESTAMP': timestamp,
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            };

            const payload = {
                scope: ["abha-address-login", "mobile-verify"],
                loginHint: "abha-address",
                loginId: encryptedAbhaAddress,
                otpSystem: "abdm"
            };

            const response = await axios.post(requestOtpUrl, payload, { headers });

            const { txnId, message } = response.data || {};

            if (!txnId || !message) {
                throw new Error('ABDM Response missing txnId or message');
            }

            return {
                success: true,
                txnId,
                message
            };

        } catch (error: any) {
            if (error instanceof HttpException) {
                throw error;
            }
            if (error.response) {
                this.logger.error(`Request Mobile OTP failed. REQUEST-ID: ${requestId}. Status: ${error.response.status}`);
                throw new HttpException({
                    success: false,
                    error: 'Failed to request mobile OTP',
                    details: error.response.data
                }, HttpStatus.BAD_GATEWAY);
            }
            throw new HttpException('Unexpected Error requesting mobile OTP', HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    /**
     * Verify Mobile OTP and associate ABHA Address
     */
    async verifyMobileOtp(patientId: string, txnId: string, otp: string, abhaAddress: string): Promise<any> {
        if (!patientId || !txnId || !otp || !abhaAddress) {
            throw new HttpException('Missing required parameters', HttpStatus.BAD_REQUEST);
        }

        const verifyOtpUrl = this.configService.get<string>('app.abdm.abhaAddressVerifyOtpUrl') || 'https://abhasbx.abdm.gov.in/abha/api/v3/phr/web/login/abha/verify';
        const profileUrl = this.configService.get<string>('app.abdm.abhaProfileUrl') || 'https://abhasbx.abdm.gov.in/abha/api/v3/phr/web/login/profile/abha-profile';
        const requestId = uuidv4();

        try {
            // 1. Verify patient and get clinic_id
            const { data: patient, error: patientError } = await this.supabase
                .from('sakhi_clinic_patients')
                .select('clinic_id')
                .eq('id', patientId)
                .single();

            if (patientError || !patient) {
                throw new HttpException('Patient not found', HttpStatus.NOT_FOUND);
            }

            const clinicId = patient.clinic_id;

            // 2. Authenticate
            const session = await this.generateSession();
            const accessToken = session.accessToken;

            // 3. Fetch Public Certificate
            const { publicKey } = await this.getPublicCertificate(accessToken);

            // 4. Encrypt OTP
            const encryptedOtp = this.encryptData(otp, publicKey);

            // 5. Verify OTP
            const timestamp = new Date().toISOString();
            const headers = {
                'REQUEST-ID': requestId,
                'TIMESTAMP': timestamp,
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            };

            const payload = {
                scope: ["abha-address-login", "mobile-verify"],
                authData: {
                    authMethods: ["otp"],
                    otp: {
                        txnId: txnId,
                        otpValue: encryptedOtp
                    }
                }
            };

            const response = await axios.post(verifyOtpUrl, payload, { headers });

            const responseData = response.data || {};
            const tokens = responseData.tokens || {};
            const xToken = tokens.token;

            if (!xToken) {
                throw new Error('ABDM Response missing X-token');
            }

            // 6. Fetch Profile
            const profileHeaders = {
                'REQUEST-ID': uuidv4(),
                'TIMESTAMP': new Date().toISOString(),
                'Authorization': `Bearer ${accessToken}`,
                'X-token': `Bearer ${xToken}`,
                'Content-Type': 'application/json'
            };

            const profileResponse = await axios.get(profileUrl, { headers: profileHeaders });
            const profile = profileResponse.data || {};

            const fetchedAbhaAddress = profile.abhaAddress || abhaAddress;
            const fetchedAbhaNumber = profile.abhaNumber || null;

            // 7. Check for conflicts and persist
            // Check existing active ABHA for this patient
            const { data: existingActive } = await this.supabase
                .from('patient_abha')
                .select('id, abha_number, abha_address')
                .eq('patient_id', patientId)
                .eq('is_active', true)
                .single();

            if (existingActive) {
                // Identity conflict check
                if (existingActive.abha_address && fetchedAbhaAddress && existingActive.abha_address !== fetchedAbhaAddress) {
                    throw new HttpException('Identity Conflict: Patient already has a different active ABHA address', HttpStatus.CONFLICT);
                }

                // If same address or updating, update the record
                await this.supabase
                    .from('patient_abha')
                    .update({
                        abha_number: fetchedAbhaNumber || existingActive.abha_number,
                        abha_address: fetchedAbhaAddress,
                        verification_status: 'VERIFIED',
                        verified_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', existingActive.id);

            } else {
                // Check Clinic-level Address conflict
                if (fetchedAbhaAddress) {
                    const { data: addressConflict } = await this.supabase
                        .from('patient_abha')
                        .select('id')
                        .eq('clinic_id', clinicId)
                        .eq('abha_address', fetchedAbhaAddress)
                        .eq('is_active', true)
                        .single();

                    if (addressConflict) {
                        throw new HttpException('ABHA Address Conflict: Already actively linked to another patient in this clinic', HttpStatus.CONFLICT);
                    }
                }

                // Insert new record
                const dbPayload = {
                    patient_id: patientId,
                    clinic_id: clinicId,
                    abha_number: fetchedAbhaNumber,
                    abha_address: fetchedAbhaAddress,
                    verification_status: 'VERIFIED',
                    is_active: true,
                    verified_at: new Date().toISOString()
                };

                const { error: insertError } = await this.supabase.from('patient_abha').insert([dbPayload]);
                if (insertError) {
                    this.logger.error(`Database insert error for patient_abha: ${JSON.stringify(insertError)}`);
                    throw new HttpException('Database error while persisting ABHA', HttpStatus.INTERNAL_SERVER_ERROR);
                }
            }

            // Mask ABHA Address
            let maskedAbhaAddress = fetchedAbhaAddress;
            if (maskedAbhaAddress && maskedAbhaAddress.includes('@')) {
                const parts = maskedAbhaAddress.split('@');
                if (parts[0].length > 2) {
                    maskedAbhaAddress = parts[0].substring(0, 2) + '***@' + parts[1];
                }
            }

            return {
                success: true,
                message: 'ABHA Address verified and linked successfully',
                maskedAbhaAddress
            };

        } catch (error: any) {
            if (error instanceof HttpException) {
                throw error;
            }
            if (error.response) {
                this.logger.error(`Verify Mobile OTP failed. REQUEST-ID: ${requestId}. Status: ${error.response.status}`);
                throw new HttpException({
                    success: false,
                    error: 'Failed to verify mobile OTP',
                    details: error.response.data
                }, HttpStatus.BAD_GATEWAY);
            }
            throw new HttpException('Unexpected Error verifying mobile OTP', HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    /**
     * Search Auth Methods for ABHA Address Verification via Aadhaar OTP
     */
    async searchAuthMethodsAadhaar(patientId: string, abhaAddress: string): Promise<any> {
        if (!patientId || !abhaAddress) {
            throw new HttpException('Missing required parameters', HttpStatus.BAD_REQUEST);
        }

        const searchUrl = this.configService.get<string>('app.abdm.abhaAddressSearchUrl') || 'https://abhasbx.abdm.gov.in/abha/api/v3/phr/web/login/abha/search';
        const requestId = uuidv4();

        try {
            // 1. Verify patient exists
            const { data: patient, error: patientError } = await this.supabase
                .from('sakhi_clinic_patients')
                .select('id')
                .eq('id', patientId)
                .single();

            if (patientError || !patient) {
                throw new HttpException('Patient not found', HttpStatus.NOT_FOUND);
            }

            // 2. Authenticate
            const session = await this.generateSession();
            const accessToken = session.accessToken;

            // 3. Request
            const timestamp = new Date().toISOString();
            const headers = {
                'REQUEST-ID': requestId,
                'TIMESTAMP': timestamp,
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            };

            const payload = {
                abhaAddress: abhaAddress
            };

            const response = await axios.post(searchUrl, payload, { headers });

            return {
                success: true,
                ...response.data
            };

        } catch (error: any) {
            if (error instanceof HttpException) {
                throw error;
            }
            if (error.response) {
                this.logger.error(`Search Auth Methods (Aadhaar) failed. REQUEST-ID: ${requestId}. Status: ${error.response.status}`);
                throw new HttpException({
                    success: false,
                    error: 'Failed to search auth methods',
                    details: error.response.data
                }, HttpStatus.BAD_GATEWAY);
            }
            throw new HttpException('Unexpected Error searching auth methods', HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    /**
     * Request Aadhaar OTP for ABHA Address Verification
     */
    async requestAadhaarOtpForVerification(patientId: string, abhaAddress: string): Promise<any> {
        if (!patientId || !abhaAddress) {
            throw new HttpException('Missing required parameters', HttpStatus.BAD_REQUEST);
        }

        const requestOtpUrl = this.configService.get<string>('app.abdm.abhaAddressRequestOtpUrl') || 'https://abhasbx.abdm.gov.in/abha/api/v3/phr/web/login/abha/request/otp';
        const requestId = uuidv4();

        try {
            // 1. Verify patient exists
            const { data: patient, error: patientError } = await this.supabase
                .from('sakhi_clinic_patients')
                .select('id')
                .eq('id', patientId)
                .single();

            if (patientError || !patient) {
                throw new HttpException('Patient not found', HttpStatus.NOT_FOUND);
            }

            // 2. Authenticate
            const session = await this.generateSession();
            const accessToken = session.accessToken;

            // 3. Fetch Public Certificate
            const { publicKey } = await this.getPublicCertificate(accessToken);

            // 4. Encrypt ABHA Address
            const encryptedAbhaAddress = this.encryptData(abhaAddress, publicKey);

            // 5. Request OTP
            const timestamp = new Date().toISOString();
            const headers = {
                'REQUEST-ID': requestId,
                'TIMESTAMP': timestamp,
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            };

            const payload = {
                scope: ["abha-address-login", "aadhaar-verify"],
                loginHint: "abha-address",
                loginId: encryptedAbhaAddress,
                otpSystem: "aadhaar"
            };

            const response = await axios.post(requestOtpUrl, payload, { headers });

            const { txnId, message } = response.data || {};

            if (!txnId || !message) {
                throw new Error('ABDM Response missing txnId or message');
            }

            return {
                success: true,
                txnId,
                message
            };

        } catch (error: any) {
            if (error instanceof HttpException) {
                throw error;
            }
            if (error.response) {
                this.logger.error(`Request Aadhaar OTP failed. REQUEST-ID: ${requestId}. Status: ${error.response.status}`);
                throw new HttpException({
                    success: false,
                    error: 'Failed to request Aadhaar OTP',
                    details: error.response.data
                }, HttpStatus.BAD_GATEWAY);
            }
            throw new HttpException('Unexpected Error requesting Aadhaar OTP', HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    /**
     * Verify Aadhaar OTP and associate ABHA Address
     */
    async verifyAadhaarOtpForVerification(patientId: string, txnId: string, otp: string, abhaAddress: string): Promise<any> {
        if (!patientId || !txnId || !otp || !abhaAddress) {
            throw new HttpException('Missing required parameters', HttpStatus.BAD_REQUEST);
        }

        const verifyOtpUrl = this.configService.get<string>('app.abdm.abhaAddressVerifyOtpUrl') || 'https://abhasbx.abdm.gov.in/abha/api/v3/phr/web/login/abha/verify';
        const profileUrl = this.configService.get<string>('app.abdm.abhaProfileUrl') || 'https://abhasbx.abdm.gov.in/abha/api/v3/phr/web/login/profile/abha-profile';
        const requestId = uuidv4();

        try {
            // 1. Verify patient and get clinic_id
            const { data: patient, error: patientError } = await this.supabase
                .from('sakhi_clinic_patients')
                .select('clinic_id')
                .eq('id', patientId)
                .single();

            if (patientError || !patient) {
                throw new HttpException('Patient not found', HttpStatus.NOT_FOUND);
            }

            const clinicId = patient.clinic_id;

            // 2. Fetch Public Certificate (need session token to fetch cert, but verify API does NOT use it)
            const session = await this.generateSession();
            const { publicKey } = await this.getPublicCertificate(session.accessToken);

            // 3. Encrypt OTP
            const encryptedOtp = this.encryptData(otp, publicKey);

            // 4. Verify OTP
            const timestamp = new Date().toISOString();
            const headers = {
                'REQUEST-ID': requestId,
                'TIMESTAMP': timestamp,
                'Authorization': `Bearer ${session.accessToken}`,
                'Content-Type': 'application/json'
            };

            const payload = {
                scope: ["abha-address-login", "aadhaar-verify"],
                authData: {
                    authMethods: ["otp"],
                    otp: {
                        txnId: txnId,
                        otpValue: encryptedOtp
                    }
                }
            };

            const response = await axios.post(verifyOtpUrl, payload, { headers });

            const responseData = response.data || {};
            const tokens = responseData.tokens || {};
            const xToken = tokens.token;

            if (!xToken) {
                throw new Error('ABDM Response missing X-token');
            }

            // 5. Fetch Profile
            const profileHeaders = {
                'REQUEST-ID': uuidv4(),
                'TIMESTAMP': new Date().toISOString(),
                'Authorization': `Bearer ${session.accessToken}`,
                'X-token': `Bearer ${xToken}`,
                'Content-Type': 'application/json'
            };

            const profileResponse = await axios.get(profileUrl, { headers: profileHeaders });
            const profile = profileResponse.data || {};

            const fetchedAbhaAddress = profile.abhaAddress || abhaAddress;
            const fetchedAbhaNumber = profile.abhaNumber || null;

            // 6. Check for conflicts and persist
            const { data: existingActive } = await this.supabase
                .from('patient_abha')
                .select('id, abha_number, abha_address')
                .eq('patient_id', patientId)
                .eq('is_active', true)
                .single();

            if (existingActive) {
                const storedNumber = existingActive.abha_number;
                const storedAddress = existingActive.abha_address;

                // - Different ABHA Number -> ConflictException (409)
                if (storedNumber && fetchedAbhaNumber && storedNumber !== fetchedAbhaNumber) {
                    throw new HttpException('Identity Conflict: Patient already has a different active ABHA number', HttpStatus.CONFLICT);
                }

                // - Different ABHA Address where an existing verified address is present -> ConflictException (409)
                if (storedAddress && fetchedAbhaAddress && storedAddress !== fetchedAbhaAddress) {
                    throw new HttpException('Identity Conflict: Patient already has a different active ABHA address', HttpStatus.CONFLICT);
                }

                // - Same ABHA Number + same Address -> update verification/timestamps
                // - Existing ABHA Number matches but address is missing -> safely fill the address
                await this.supabase
                    .from('patient_abha')
                    .update({
                        abha_number: fetchedAbhaNumber || storedNumber,
                        abha_address: fetchedAbhaAddress || storedAddress,
                        verification_status: 'VERIFIED',
                        verified_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', existingActive.id);

            } else {
                // - Incoming ABHA Number/Address already belongs to another active patient in the same clinic -> ConflictException (409)
                if (fetchedAbhaNumber) {
                    const { data: numberConflict } = await this.supabase
                        .from('patient_abha')
                        .select('id')
                        .eq('clinic_id', clinicId)
                        .eq('abha_number', fetchedAbhaNumber)
                        .eq('is_active', true)
                        .single();

                    if (numberConflict) {
                        throw new HttpException('ABHA Number Conflict: Already actively linked to another patient in this clinic', HttpStatus.CONFLICT);
                    }
                }

                if (fetchedAbhaAddress) {
                    const { data: addressConflict } = await this.supabase
                        .from('patient_abha')
                        .select('id')
                        .eq('clinic_id', clinicId)
                        .eq('abha_address', fetchedAbhaAddress)
                        .eq('is_active', true)
                        .single();

                    if (addressConflict) {
                        throw new HttpException('ABHA Address Conflict: Already actively linked to another patient in this clinic', HttpStatus.CONFLICT);
                    }
                }

                // Insert new record
                const dbPayload = {
                    patient_id: patientId,
                    clinic_id: clinicId,
                    abha_number: fetchedAbhaNumber,
                    abha_address: fetchedAbhaAddress,
                    verification_status: 'VERIFIED',
                    is_active: true,
                    verified_at: new Date().toISOString()
                };

                const { error: insertError } = await this.supabase.from('patient_abha').insert([dbPayload]);
                if (insertError) {
                    this.logger.error(`Database insert error for patient_abha: ${JSON.stringify(insertError)}`);
                    throw new HttpException('Database error while persisting ABHA', HttpStatus.INTERNAL_SERVER_ERROR);
                }
            }

            // Mask ABHA Address
            let maskedAbhaAddress = fetchedAbhaAddress;
            if (maskedAbhaAddress && maskedAbhaAddress.includes('@')) {
                const parts = maskedAbhaAddress.split('@');
                if (parts[0].length > 2) {
                    maskedAbhaAddress = parts[0].substring(0, 2) + '***@' + parts[1];
                }
            }

            return {
                success: true,
                message: 'ABHA Address verified and linked successfully',
                maskedAbhaAddress
            };

        } catch (error: any) {
            if (error instanceof HttpException) {
                throw error;
            }
            if (error.response) {
                this.logger.error(`Verify Aadhaar OTP failed. REQUEST-ID: ${requestId}. Status: ${error.response.status}`);
                throw new HttpException({
                    success: false,
                    error: 'Failed to verify Aadhaar OTP',
                    details: error.response.data
                }, HttpStatus.BAD_GATEWAY);
            }
            throw new HttpException('Unexpected Error verifying Aadhaar OTP', HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
}
