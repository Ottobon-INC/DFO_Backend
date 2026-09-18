import { Module, Global } from '@nestjs/common';

@Global()
@Module({
    providers: [
        {
            provide: 'SUPABASE_CLIENT',
            useValue: {
                from: (table) => ({
                    select: () => ({ eq: () => ({ in: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }), single: () => Promise.resolve({ data: {}, error: null }) }),
                    insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: 'mock-id' }, error: null }) }) }),
                    update: () => ({ eq: () => Promise.resolve({ data: {}, error: null }) }),
                }),
            },
        },
    ],
    exports: ['SUPABASE_CLIENT'],
})
export class MockSupabaseModule { }
