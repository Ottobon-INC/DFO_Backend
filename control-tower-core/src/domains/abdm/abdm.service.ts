import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';

@Injectable()
export class AbdmService {
    private readonly logger = new Logger(AbdmService.name);

    constructor(private readonly configService: ConfigService) {}

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
}
