import { Controller, Post, Get, HttpCode, HttpStatus, Logger, UseGuards, Body } from '@nestjs/common';
import { AbdmService } from './abdm.service';
import { ClinicsAuthGuard } from '../clinics/guards/clinics-auth.guard';

// Note: Using existing project guards (e.g., AuthGuard, PermissionsGuard) may be needed later,
// but for the temporary testing endpoint we assume either basic protection or internal usage.
// You should add @UseGuards() if this is exposed publicly.

@Controller('api/v1/abdm')
export class AbdmController {
    private readonly logger = new Logger(AbdmController.name);

    constructor(private readonly abdmService: AbdmService) {}

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
    @UseGuards(ClinicsAuthGuard)
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
}
