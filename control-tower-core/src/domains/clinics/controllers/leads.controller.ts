import { Controller, Get, Post, Patch, Param, Query, Body, UseGuards, Res, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DFO_EVENTS } from '../../../infrastructure/events/event-constants';
import { LeadEvent } from '../../../infrastructure/events/event-payloads';
import { Response } from 'express';
import { ClinicsSupabaseService } from '../services/clinics-supabase.service';
import { ClinicsUtilsService } from '../services/clinics-utils.service';
import { ClinicsEncryptionService } from '../services/clinics-encryption.service';
import { TenantContext } from '../../../infrastructure/context/tenant.context';
import { ClinicsAuthGuard } from '../guards/clinics-auth.guard';
import { COLUMN_MAPPINGS, VALID_STATUSES, SOURCE_VALUES, normalizeStatus, looksLikeSource, looksLikeStatus, normalizeLead } from '../helpers/leads.helpers';

@Controller('api/leads')
export class LeadsController {
    private readonly logger = new Logger(LeadsController.name);

    constructor(
        private readonly supabaseService: ClinicsSupabaseService,
        private readonly utils: ClinicsUtilsService,
        private readonly encryption: ClinicsEncryptionService,
        @InjectQueue('dfo_events_queue') private readonly eventsQueue: Queue,
    ) {}

    @Get()
    @UseGuards(ClinicsAuthGuard)
    async list(
        @Query('page') page = '1', @Query('limit') limit = '20',
        @Query('phone') phone?: string, @Query('status') status?: string, @Query('q') q?: string,
    ) {
        const supabase = this.supabaseService.getClient();
        const pageNum = Number(page);
        const limitNum = Number(limit);
        const from = (pageNum - 1) * limitNum;
        const to = from + limitNum - 1;
        try {
            let query = supabase.from('sakhi_clinic_leads').select('*', { count: 'exact' }).order('date_added', { ascending: false }).range(from, to);
            if (phone) query = query.eq('phone', phone);
            else if (status) query = query.eq('status', status);
            else if (q) query = query.or(`name.ilike.%${q}%,phone.ilike.%${q}%`);
            const { data, error, count } = await query;
            if (error) throw error;
            const decryptedData = data?.map(lead => ({ ...lead, problem: this.encryption.decrypt(lead.problem), treatment_suggested: this.encryption.decrypt(lead.treatment_suggested), treatment_doctor: this.encryption.decrypt(lead.treatment_doctor) }));
            return { success: true, data: { items: decryptedData ?? [], pagination: { page: pageNum, limit: limitNum, total: count ?? data?.length ?? 0 } } };
        } catch (error: any) {
            this.logger.error('GET /api/leads', error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Post()
    @UseGuards(ClinicsAuthGuard)
    async create(@Body() rawBody: any) {
        const supabase = this.supabaseService.getClient();
        const tv = this.utils.toValue.bind(this.utils);
        try {
            const body = normalizeLead(rawBody);
            const name = tv(body.name); const phone = tv(body.phone);
            if (!name || !phone) throw new HttpException({ success: false, error: 'name and phone are required' }, HttpStatus.BAD_REQUEST);
            
            // Strict number format check (supports 10-15 digits, optional leading +)
            const phoneStr = String(phone).trim();
            const isValidPhone = /^\+?[1-9]\d{9,14}$/.test(phoneStr);
            if (!isValidPhone) {
                throw new HttpException({ success: false, error: 'Invalid phone number format. Must be a valid 10-15 digit number.' }, HttpStatus.BAD_REQUEST);
            }
            
            const payload = this.utils.sanitizePayload({
                name, phone, date_added: tv(body.date_added), status: normalizeStatus(tv(body.status)),
                age: tv(body.age), gender: tv(body.gender), source: tv(body.source), inquiry: tv(body.inquiry),
                problem: this.encryption.encrypt(tv(body.problem)), treatment_doctor: this.encryption.encrypt(tv(body.treatment_doctor)),
                treatment_suggested: this.encryption.encrypt(tv(body.treatment_suggested)),
                assigned_to_user_id: tv(body.assigned_to_user_id), guardian_name: tv(body.guardian_name),
                guardian_age: tv(body.guardian_age), location: tv(body.location),
                alternate_phone: tv(body.alternate_phone), referral_required: tv(body.referral_required),
            });
            const { data, error } = await supabase.from('sakhi_clinic_leads').insert(payload).select().single();
            if (error) throw error;
            
            const actor_id = TenantContext.getUserId();
            const clinic_id = TenantContext.getClinicId() || '';
            await this.eventsQueue.add(DFO_EVENTS.LEAD_CREATED, new LeadEvent(
                clinic_id, actor_id, data.id, { action: 'create_lead' }
            ), { attempts: 5, backoff: { type: 'exponential', delay: 1000 } });

            return { success: true, data };
        } catch (error: any) {
            if (error instanceof HttpException) throw error;
            this.logger.error('POST /api/leads', error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Get('export')
    @UseGuards(ClinicsAuthGuard)
    async exportCsv(@Query('phone') phone?: string, @Query('status') status?: string, @Query('q') q?: string, @Res() res?: Response) {
        const supabase = this.supabaseService.getClient();
        try {
            let query = supabase.from('sakhi_clinic_leads').select('*').order('date_added', { ascending: false });
            if (phone) query = query.eq('phone', phone);
            else if (status) query = query.eq('status', status);
            else if (q) query = query.or(`name.ilike.%${q}%,phone.ilike.%${q}%`);
            const { data, error } = await query;
            if (error) throw error;
            const leads = data?.map(lead => ({ ...lead, problem: this.encryption.decrypt(lead.problem), treatment_suggested: this.encryption.decrypt(lead.treatment_suggested), treatment_doctor: this.encryption.decrypt(lead.treatment_doctor) })) || [];
            const columns = [{ header: 'Name', key: 'name' }, { header: 'Phone', key: 'phone' }, { header: 'Status', key: 'status' }, { header: 'Date Added', key: 'date_added' }, { header: 'Age', key: 'age' }, { header: 'Gender', key: 'gender' }, { header: 'Source', key: 'source' }, { header: 'Inquiry', key: 'inquiry' }, { header: 'Problem', key: 'problem' }, { header: 'Treatment Doctor', key: 'treatment_doctor' }, { header: 'Treatment Suggested', key: 'treatment_suggested' }, { header: 'Assigned User ID', key: 'assigned_to_user_id' }];
            const escapeCsv = (field: any) => { if (field === null || field === undefined) return ''; const s = String(field); if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) return `"${s.replace(/"/g, '""')}"`; return s; };
            const headerRow = columns.map(c => escapeCsv(c.header)).join(',');
            const rows = leads.map(lead => columns.map(c => escapeCsv((lead as any)[c.key])).join(','));
            const csvContent = [headerRow, ...rows].join('\n');
            res!.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="leads_export.csv"' });
            res!.send(csvContent);
        } catch (error: any) {
            this.logger.error('GET /api/leads/export', error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Post('bulk')
    @UseGuards(ClinicsAuthGuard)
    async bulkCreate(@Body() body: any) {
        const supabase = this.supabaseService.getClient();
        const tv = this.utils.toValue.bind(this.utils);
        try {
            const leads = body.leads;
            if (!Array.isArray(leads)) throw new HttpException({ success: false, error: 'leads must be an array' }, HttpStatus.BAD_REQUEST);
            const errors: any[] = [];
            const validLeadsToInsert: any[] = [];
            const normalizedLeads = leads.map((lead: Record<string, any>) => normalizeLead(lead));
            const phonesForCheck = normalizedLeads.map(l => tv(l.phone)).filter((p: any): p is string => !!p);
            let existingPhones = new Set<string>();
            if (phonesForCheck.length > 0) {
                const { data: existingData, error: checkError } = await supabase.from('sakhi_clinic_leads').select('phone').in('phone', phonesForCheck);
                if (checkError) throw checkError;
                if (existingData) existingData.forEach(row => existingPhones.add(row.phone));
            }
            for (const lead of normalizedLeads) {
                const phone = tv(lead.phone); const name = tv(lead.name);
                if (!name || !phone) { errors.push({ phone: phone || 'N/A', name: name || 'N/A', reason: 'Missing name or phone' }); continue; }
                if (existingPhones.has(phone)) { errors.push({ phone, name, reason: 'Duplicate - already exists in database' }); continue; }
                if (validLeadsToInsert.find(l => l.phone === phone)) { errors.push({ phone, name, reason: 'Duplicate in batch' }); continue; }
                validLeadsToInsert.push(this.utils.sanitizePayload({
                    name, phone, status: normalizeStatus(tv(lead.status)), date_added: tv(lead.date_added),
                    age: tv(lead.age), gender: tv(lead.gender),
                    source: tv(lead.source) || (looksLikeSource(tv(lead.status)) ? tv(lead.status) : undefined),
                    inquiry: tv(lead.inquiry), problem: this.encryption.encrypt(tv(lead.problem)),
                    treatment_doctor: this.encryption.encrypt(tv(lead.treatment_doctor)),
                    treatment_suggested: this.encryption.encrypt(tv(lead.treatment_suggested)),
                    assigned_to_user_id: tv(lead.assigned_to_user_id),
                }));
            }
            let successCount = 0;
            if (validLeadsToInsert.length > 0) {
                const { error: insertError } = await supabase.from('sakhi_clinic_leads').insert(validLeadsToInsert);
                if (insertError) {
                    errors.push(`Database insert failed: ${insertError.message}`);
                } else {
                    successCount = validLeadsToInsert.length;
                    
                    const actor_id = TenantContext.getUserId();
                    const clinic_id = TenantContext.getClinicId() || '';
                    await this.eventsQueue.add(DFO_EVENTS.LEAD_BULK_IMPORTED, new LeadEvent(
                        clinic_id, actor_id, 'bulk_import', { action: 'bulk_import_leads', count: successCount }
                    ), { attempts: 5, backoff: { type: 'exponential', delay: 1000 } });
                }
            }
            return { success: true, count: successCount, failed: errors.length, errors };
        } catch (error: any) {
            if (error instanceof HttpException) throw error;
            this.logger.error('POST /api/leads/bulk', error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Get(':id')
    async getById(@Param('id') id: string) {
        if (!this.utils.isUuid(id)) throw new HttpException({ success: false, error: 'Invalid lead id' }, HttpStatus.BAD_REQUEST);
        const supabase = this.supabaseService.getClient();
        const { data, error } = await supabase.from('sakhi_clinic_leads').select('*').eq('id', id).single();
        if (error?.code === 'PGRST116') throw new HttpException({ success: false, error: 'Lead not found' }, HttpStatus.NOT_FOUND);
        if (error) throw new HttpException({ success: false, error: error.message }, HttpStatus.INTERNAL_SERVER_ERROR);
        return { success: true, data };
    }

    @Patch(':id')
    async update(@Param('id') id: string, @Body() body: any) {
        if (!this.utils.isUuid(id)) throw new HttpException({ success: false, error: 'Invalid lead id' }, HttpStatus.BAD_REQUEST);
        const supabase = this.supabaseService.getClient();
        const tv = this.utils.toValue.bind(this.utils);
        try {
            const statusRaw = tv(body.status);
            const normalizedStatus = statusRaw === 'Contacted' ? 'Follow Up' : statusRaw;
            const updates = this.utils.sanitizePayload({
                name: tv(body.name), phone: tv(body.phone), age: tv(body.age), gender: tv(body.gender),
                source: tv(body.source), inquiry: tv(body.inquiry), problem: tv(body.problem),
                treatment_doctor: tv(body.treatment_doctor) ?? tv(body.treatmentDoctor),
                treatment_suggested: tv(body.treatment_suggested) ?? tv(body.treatmentSuggested),
                status: normalizedStatus, assigned_to_user_id: tv(body.assigned_to_user_id) ?? tv(body.assignedToUserId),
                date_added: tv(body.date_added) ?? tv(body.dateAdded),
            });
            if (!Object.keys(updates).length) throw new HttpException({ success: false, error: 'No fields provided to update' }, HttpStatus.BAD_REQUEST);
            const { data, error } = await supabase.from('sakhi_clinic_leads').update(updates).eq('id', id).select().single();
            if (error?.code === 'PGRST116') throw new HttpException({ success: false, error: 'Lead not found' }, HttpStatus.NOT_FOUND);
            if (error) throw new HttpException({ success: false, error: error.message || 'Internal Server Error', details: error.details }, HttpStatus.INTERNAL_SERVER_ERROR);
            
            const actor_id = TenantContext.getUserId();
            const clinic_id = TenantContext.getClinicId() || '';
            await this.eventsQueue.add(DFO_EVENTS.LEAD_UPDATED, new LeadEvent(
                clinic_id, actor_id, id, { action: 'update_lead', status: updates.status }
            ), { attempts: 5, backoff: { type: 'exponential', delay: 1000 } });

            return { success: true, data };
        } catch (error: any) {
            if (error instanceof HttpException) throw error;
            this.logger.error(`PATCH /api/leads/${id}`, error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Post(':id/re-engage')
    async reEngage(@Param('id') id: string) {
        if (!this.utils.isUuid(id)) throw new HttpException({ success: false, error: 'Invalid lead id' }, HttpStatus.BAD_REQUEST);
        const supabase = this.supabaseService.getClient();
        try {
            const clinic_id = TenantContext.getClinicId() || '';
            const updates = { status: 'Follow Up' };
            const { data, error } = await supabase.from('sakhi_clinic_leads').update(updates).eq('id', id).eq('clinic_id', clinic_id).select().single();
            if (error?.code === 'PGRST116') throw new HttpException({ success: false, error: 'Lead not found' }, HttpStatus.NOT_FOUND);
            if (error) throw error;
            
            const actor_id = TenantContext.getUserId();
            await this.eventsQueue.add(DFO_EVENTS.LEAD_UPDATED, new LeadEvent(
                clinic_id, actor_id, id, { action: 'update_lead', status: updates.status }
            ), { attempts: 5, backoff: { type: 'exponential', delay: 1000 } });

            return { success: true, data };
        } catch (error: any) {
            if (error instanceof HttpException) throw error;
            this.logger.error(`POST /api/leads/${id}/re-engage`, error);
            throw new HttpException({ success: false, error: error?.message || 'Internal Server Error' }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
}
