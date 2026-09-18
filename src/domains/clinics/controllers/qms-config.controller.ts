import { Controller, Get, Put, Body, UseGuards, Req, Param } from '@nestjs/common';
import { ClinicsAuthGuard } from '../guards/clinics-auth.guard';
import { ClinicsSupabaseService } from '../services/clinics-supabase.service';

@Controller('api/v1/clinics/qms')
@UseGuards(ClinicsAuthGuard)
export class QMSConfigController {
    constructor(private readonly supabaseService: ClinicsSupabaseService) {}

    @Get('config')
    async getConfig(@Req() req: any) {
        const tenantId = req.tenantId || req.user?.clinic_id;
        if (!tenantId) {
            return { error: 'No tenant id' };
        }
        const supabase = this.supabaseService.getClient();

        let { data, error } = await supabase
            .from('tenant_configs')
            .select('*')
            .eq('tenant_id', tenantId)
            .single();

        if (error && error.code === 'PGRST116') {
            // Not found, create default
            const defaultConfig = {
                tenant_id: tenantId,
                queue_rules: {
                    enable_skip: true,
                    enable_priority: false,
                    avg_duration_mins: 15
                },
                notification_templates: {
                    booking_confirmed: "Your appointment is confirmed. Token: {{token}}",
                    queue_update: "Your turn is approaching. {{patients_ahead}} patients ahead."
                },
                branding: {},
                working_hours: {}
            };

            const { data: newData, error: insertError } = await supabase
                .from('tenant_configs')
                .insert(defaultConfig)
                .select()
                .single();
                
            if (insertError) throw insertError;
            data = newData;
        } else if (error) {
            throw error;
        }

        return data;
    }

    @Put('config')
    async updateConfig(@Req() req: any, @Body() body: any) {
        const tenantId = req.tenantId || req.user?.clinic_id;
        const supabase = this.supabaseService.getClient();

        const { data, error } = await supabase
            .from('tenant_configs')
            .upsert({
                tenant_id: tenantId,
                queue_rules: body.queue_rules,
                notification_templates: body.notification_templates,
                branding: body.branding,
                working_hours: body.working_hours,
                updated_at: new Date().toISOString()
            })
            .select()
            .single();

        if (error) throw error;
        return data;
    }
}
