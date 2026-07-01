import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Global()
@Module({
  providers: [
    {
      provide: 'SUPABASE_CLIENT',
      useFactory: (configService: ConfigService) => {
        const url = configService.get<string>('app.supabase.url');
        const key = configService.get<string>('app.supabase.key');
        return createClient(url || 'https://dummy.supabase.co', key || 'dummy-key');
      },
      inject: [ConfigService],
    },
    {
      provide: 'ORG_SUPABASE_CLIENT',
      useFactory: (configService: ConfigService) => {
        const url = configService.get<string>('app.orgSupabase.url');
        const key = configService.get<string>('app.orgSupabase.key');
        const primaryUrl = configService.get<string>('app.supabase.url');
        const primaryKey = configService.get<string>('app.supabase.key');
        return createClient(url || primaryUrl || 'https://dummy.supabase.co', key || primaryKey || 'dummy-key');
      },
      inject: [ConfigService],
    },
  ],
  exports: ['SUPABASE_CLIENT', 'ORG_SUPABASE_CLIENT'],
})
export class DatabaseModule { }
