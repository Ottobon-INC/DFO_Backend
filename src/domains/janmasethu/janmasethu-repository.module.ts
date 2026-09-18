import { Module, Global } from '@nestjs/common';
import { JanmasethuRepository } from './janmasethu.repository';
import { SupabaseClient } from '@supabase/supabase-js';

@Global()
@Module({
    providers: [
        JanmasethuRepository,
    ],
    exports: [JanmasethuRepository],
})
export class JanmasethuRepositoryModule { }
