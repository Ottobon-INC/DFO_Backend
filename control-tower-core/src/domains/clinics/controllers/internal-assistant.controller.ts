import { Controller, Post, Body, Req, UseGuards, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ClinicsAuthGuard } from '../guards/clinics-auth.guard';
import { ClinicsSupabaseService } from '../services/clinics-supabase.service';
import { ClinicsEncryptionService } from '../services/clinics-encryption.service';
import { processUserMessage } from '../internal-assistant';

@Controller('api/internal-assistant')
@UseGuards(ClinicsAuthGuard)
export class InternalAssistantController {
    private readonly logger = new Logger(InternalAssistantController.name);

    constructor(
        private readonly supabaseService: ClinicsSupabaseService,
        private readonly encryptionService: ClinicsEncryptionService
    ) {}

    @Post('chat')
    async chat(@Req() req: any, @Body() body: { message?: string; confirmationToken?: string }) {
        try {
            const user = req.user;
            if (!user) {
                throw new HttpException({ error: 'Unauthorized' }, HttpStatus.UNAUTHORIZED);
            }

            const { message, confirmationToken } = body;
            if (!confirmationToken && (!message || typeof message !== 'string')) {
                throw new HttpException({ error: 'Message or Confirmation Token is required' }, HttpStatus.BAD_REQUEST);
            }

            // Run the local zero-LLM assistant
            const client = this.supabaseService.getClient();
            const decrypter = (text: string) => this.encryptionService.decrypt(text);

            const result = await processUserMessage(
                client,
                decrypter,
                user.id,
                user.role,
                message || '',
                confirmationToken
            );

            return {
                reply: result.reply,
                actionRequired: result.actionRequired,
                options: result.options,
            };
        } catch (error: any) {
            if (error instanceof HttpException) throw error;
            this.logger.error('POST /api/internal-assistant/chat error:', error);
            throw new HttpException({ error: error.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
}

