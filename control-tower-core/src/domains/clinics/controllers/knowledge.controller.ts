import { Controller, Get, Query, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ClinicsSupabaseService } from '../services/clinics-supabase.service';

@Controller('api/knowledge')
export class KnowledgeController {
    private readonly logger = new Logger(KnowledgeController.name);

    constructor(private readonly supabaseService: ClinicsSupabaseService) {}

    @Get('articles')
    async getArticles(@Query('page') page = '1', @Query('perPage') perPage?: string, @Query('limit') limit?: string) {
        const supabase = this.supabaseService.getClient();
        const pageNum = Number(page);
        const perPageNum = Number(perPage || limit || '100');
        const from = (pageNum - 1) * perPageNum;
        const to = from + perPageNum - 1;

        try {
            const { data, error, count } = await supabase
                .from('sakhi_knowledge_hub')
                .select('*', { count: 'exact' })
                .order('published_at', { ascending: false })
                .range(from, to);
            if (error) throw error;
            const articles = data?.map((row: any) => ({
                ...row,
                summary: row.summary ?? row.content_summary ?? null,
                content: row.content ?? row.body ?? null,
            })) ?? [];
            return { success: true, data: articles, pagination: { page: pageNum, perPage: perPageNum, total: count ?? articles.length ?? 0 } };
        } catch (error: any) {
            this.logger.error('GET /api/knowledge/articles', error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
}
