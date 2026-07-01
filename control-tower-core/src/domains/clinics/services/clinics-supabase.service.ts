import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Agent as UndiciAgent } from 'undici';

@Injectable()
export class ClinicsSupabaseService {
    private readonly logger = new Logger(ClinicsSupabaseService.name);
    private client: SupabaseClient;

    constructor(private readonly configService: ConfigService) {
        const url = this.configService.get<string>('SUPABASE_URL') ?? this.configService.get<string>('app.supabase.url');
        const key = this.configService.get<string>('SUPABASE_SERVICE_ROLE_KEY') ?? this.configService.get<string>('SUPABASE_KEY') ?? this.configService.get<string>('app.supabase.key');

        if (!url || !key) {
            this.logger.error('Supabase credentials missing (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)');
            throw new Error('Supabase credentials are missing');
        }

        this.client = createClient(url, key, {
            auth: {
                autoRefreshToken: false,
                persistSession: false,
            }
        });

        this.logger.log('Supabase admin client initialized for Clinics module');
    }

    getClient(): SupabaseClient {
        return this.client;
    }
}
