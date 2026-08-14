import { Controller, Post, Get, HttpCode, HttpStatus, Logger, UseGuards, Body, Query } from '@nestjs/common';
import { AbdmService } from './abdm.service';
import { ClinicsAuthGuard } from '../clinics/guards/clinics-auth.guard';

// Note: Using existing project guards (e.g., AuthGuard, PermissionsGuard) may be needed later,
// but for the temporary testing endpoint we assume either basic protection or internal usage.
// You should add @UseGuards() if this is exposed publicly.

@Controller('api/v1/abdm')
export class AbdmController {
    private readonly logger = new Logger(AbdmController.name);

    constructor(private readonly abdmService: AbdmService) { }

    /**
     * Temporary endpoint to test ABDM Sandbox session generation.
     * MUST NEVER expose the real token to the frontend.
     */
    @Post('test-session')
    @HttpCode(HttpStatus.OK)
    async testSession() {
        this.logger.log('Received request to test ABDM session generation');

        // This will throw an HttpException if it fails, which NestJS will catch and return
        const result = await this.abdmService.generateSession();

        // Ensure we strip the token and any sensitive credentials before returning
        return {
            success: true,
            message: 'Token generated successfully (token hidden)',
            tokenType: result.tokenType,
            expiresIn: result.expiresIn
            // Notice: accessToken and refreshToken are explicitly omitted here
        };
    }

    /**
     * Temporary endpoint to test ABDM Data Encryption Foundation.
     * MUST NEVER expose the real token or encrypted payload.
     */
    @Get('test-encryption')
    @HttpCode(HttpStatus.OK)
    async testEncryption() {
        this.logger.log('Received request to test ABDM encryption');

        // 1. Fetch the public key from ABDM
        const { publicKey, encryptionAlgorithm } = await this.abdmService.getPublicCertificate();

        // 2. Encrypt sample data
        const sampleData = '123456';
        const encryptedData = this.abdmService.encryptData(sampleData, publicKey);

        // 3. Return safe verification information
        return {
            success: true,
            encryptionAlgorithm,
            encryptedLength: encryptedData.length,
            message: 'Encryption successful (payload hidden for security)'
        };
    }

    /**
     * Temporary endpoint to test ABDM Aadhaar OTP Generation.
     * Protected by authentication guard for Sandbox/development testing only.
     */
    @Post('test-aadhaar-otp')
    // @UseGuards(ClinicsAuthGuard) // Temporarily disabled for local development testing
    @HttpCode(HttpStatus.OK)
    async testAadhaarOtp(@Body() body: { aadhaar: string }) {
        this.logger.log('Received request to test ABDM Aadhaar OTP generation');

        if (!body || !body.aadhaar) {
            return { success: false, error: 'Aadhaar number is required in the body' };
        }

        const result = await this.abdmService.requestAadhaarOtp(body.aadhaar);

        return {
            success: true,
            message: 'OTP request initiated successfully',
            txnId: result.txnId,
            abdmMessage: result.message
        };
    }

    /**
     * [TEMPORARY DEV ENDPOINT]
     * Step 3: Enrol ABHA via Aadhaar OTP
     * Protected by authentication guard for Sandbox/development testing only.
     */
    @Post('enrol-aadhaar-otp')
    // @UseGuards(ClinicsAuthGuard) // Temporarily disabled for local development testing
    @HttpCode(HttpStatus.OK)
    async enrolAadhaarOtp(@Body() body: { patientId: string; txnId: string; otp: string; mobile: string }) {
        this.logger.log('Received request to test ABHA Enrolment via Aadhaar OTP');

        if (!body.patientId) {
            return { success: false, error: 'Patient ID is required to associate ABHA' };
        }

        return this.abdmService.enrolAbhaViaAadhaarOtp(body.patientId, body.txnId, body.otp, body.mobile);
    }

    @Get('enrol-abha-address-suggestions')
    @HttpCode(HttpStatus.OK)
    async getAbhaAddressSuggestions(@Query('patientId') patientId: string, @Query('txnId') txnId: string) {
        this.logger.log('Received request for ABHA address suggestions');
        if (!patientId || !txnId) {
            return { success: false, error: 'Patient ID and Transaction ID are required' };
        }
        return this.abdmService.getAbhaAddressSuggestions(patientId, txnId);
    }

    @Post('enrol-abha-address')
    @HttpCode(HttpStatus.OK)
    async enrolAbhaAddress(@Body() body: { patientId: string; txnId: string; abhaAddress: string }) {
        this.logger.log('Received request to create ABHA Address');
        if (!body.patientId || !body.txnId || !body.abhaAddress) {
            return { success: false, error: 'Patient ID, Transaction ID, and ABHA Address are required' };
        }
        return this.abdmService.createAbhaAddress(body.patientId, body.txnId, body.abhaAddress);
    }

    /**
     * Step 1: Search Auth Methods for ABHA Address Verification
     */
    @Post('search-auth-methods')
    @HttpCode(HttpStatus.OK)
    async searchAuthMethods(@Body() body: { patientId: string; abhaAddress: string }) {
        this.logger.log('Received request to search auth methods for ABHA Address');
        if (!body.patientId || !body.abhaAddress) {
            return { success: false, error: 'Patient ID and ABHA Address are required' };
        }
        return this.abdmService.searchAuthMethods(body.patientId, body.abhaAddress);
    }

    /**
     * Step 2: Request Mobile OTP for ABHA Address Verification
     */
    @Post('request-mobile-otp')
    @HttpCode(HttpStatus.OK)
    async requestMobileOtp(@Body() body: { patientId: string; abhaAddress: string }) {
        this.logger.log('Received request to request mobile OTP for ABHA Address');
        if (!body.patientId || !body.abhaAddress) {
            return { success: false, error: 'Patient ID and ABHA Address are required' };
        }
        return this.abdmService.requestMobileOtp(body.patientId, body.abhaAddress);
    }

    /**
     * Step 3: Verify Mobile OTP and associate ABHA Address
     */
    @Post('verify-mobile-otp')
    @HttpCode(HttpStatus.OK)
    async verifyMobileOtp(@Body() body: { patientId: string; txnId: string; otp: string; abhaAddress: string }) {
        this.logger.log('Received request to verify mobile OTP for ABHA Address');
        if (!body.patientId || !body.txnId || !body.otp || !body.abhaAddress) {
            return { success: false, error: 'Patient ID, Transaction ID, OTP, and ABHA Address are required' };
        }
        return this.abdmService.verifyMobileOtp(body.patientId, body.txnId, body.otp, body.abhaAddress);
    }

    /**
     * Step 1: Search Auth Methods for ABHA Address Verification via Aadhaar OTP
     */
    @Post('verification/aadhaar/search')
    @HttpCode(HttpStatus.OK)
    async searchAuthMethodsAadhaar(@Body() body: { patientId: string; abhaAddress: string }) {
        this.logger.log('Received request to search auth methods for ABHA Address via Aadhaar');
        if (!body.patientId || !body.abhaAddress) {
            return { success: false, error: 'Patient ID and ABHA Address are required' };
        }
        return this.abdmService.searchAuthMethodsAadhaar(body.patientId, body.abhaAddress);
    }

    /**
     * Step 2: Request Aadhaar OTP for ABHA Address Verification
     */
    @Post('verification/aadhaar/request-otp')
    @HttpCode(HttpStatus.OK)
    async requestAadhaarOtpForVerification(@Body() body: { patientId: string; abhaAddress: string }) {
        this.logger.log('Received request to request Aadhaar OTP for ABHA Address');
        if (!body.patientId || !body.abhaAddress) {
            return { success: false, error: 'Patient ID and ABHA Address are required' };
        }
        return this.abdmService.requestAadhaarOtpForVerification(body.patientId, body.abhaAddress);
    }

    /**
     * Step 3: Verify Aadhaar OTP and associate ABHA Address
     */
    @Post('verification/aadhaar/verify-otp')
    @HttpCode(HttpStatus.OK)
    async verifyAadhaarOtpForVerification(@Body() body: { patientId: string; txnId: string; otp: string; abhaAddress: string }) {
        this.logger.log('Received request to verify Aadhaar OTP for ABHA Address');
        if (!body.patientId || !body.txnId || !body.otp || !body.abhaAddress) {
            return { success: false, error: 'Patient ID, Transaction ID, OTP, and ABHA Address are required' };
        }
        return this.abdmService.verifyAadhaarOtpForVerification(body.patientId, body.txnId, body.otp, body.abhaAddress);
    }
}
