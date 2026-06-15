import {
    Controller, Post, Get, Patch, Body, Param, Headers,
    UnauthorizedException, BadRequestException, Logger, UseGuards, Request, UseInterceptors
} from '@nestjs/common';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { ConfigService } from '@nestjs/config';
import { JanmasethuHandler } from './janmasethu.handler';
import { JanmasethuAssignmentService } from './janmasethu.assignment';
import { JanmasethuTakeoverService } from './janmasethu.takeover';
import { JanmasethuContextService } from './janmasethu.context';
import { JanmasethuRepository } from './janmasethu.repository';
import { JanmasethuDispatchService } from './channel/janmasethu-dispatch.service';
import { JanmasethuSummaryService } from './janmasethu.summary.service';
import { JanmasethuFeedbackService } from './janmasethu.feedback.service';
import { JanmasethuDFOService } from './janmasethu.dfo.service';
import { EngagementEngineService } from './engagement-engine/engine.service';
import { AppointmentService } from './appointments/appointment.service';
import { JanmasethuLeadsService } from './janmasethu.leads.service';
import { ThreadService } from '../../kernel/thread/thread.service';
import { JanmasethuReportingService } from './janmasethu.reporting.service';
import { JanmasethuAuditService } from './janmasethu.audit.service';
import { JanmasethuEncryptionService } from './utils/encryption.service';
import { JanmasethuRbacService } from './janmasethu.rbac';
import { DocumentService } from './documents/document.service';
import { ClinicalIntelligenceService } from './clinical-intelligence/clinical-intelligence.service';
import { JANMASETHU_DOMAIN, JanmasethuUserRole, JanmasethuUserContext, JanmasethuPermission, JanmasethuRole } from './janmasethu.types';
import { JourneyStage, ConsultationStatus } from './dfo.types';
import {
    SyncPatientDto, UpdateJourneyDto, BookAppointmentDto,
    StartConsultationDto, CloseConsultationDto, AddPrescriptionDto
} from './dto/dfo.dto';

import { JanmasethuResponseInterceptor } from './utils/response.interceptor';
import { ThreadStatus, OwnershipType } from '../../types';

@Controller('janmasethu')
@UseGuards(JwtAuthGuard)
@UseInterceptors(JanmasethuResponseInterceptor)
export class JanmasethuController {
    private readonly logger = new Logger(JanmasethuController.name);

    constructor(
        private readonly handler: JanmasethuHandler,
        private readonly assignmentService: JanmasethuAssignmentService,
        private readonly takeoverService: JanmasethuTakeoverService,
        private readonly contextService: JanmasethuContextService,
        private readonly repository: JanmasethuRepository,
        private readonly threadService: ThreadService,
        private readonly dispatchService: JanmasethuDispatchService,
        private readonly configService: ConfigService,
        private readonly summaryService: JanmasethuSummaryService,
        private readonly feedbackService: JanmasethuFeedbackService,
        private readonly dfoService: JanmasethuDFOService,
        private readonly engagementEngine: EngagementEngineService,
        private readonly appointmentService: AppointmentService,
        private readonly leadsService: JanmasethuLeadsService,
        private readonly reportingService: JanmasethuReportingService,
        private readonly auditService: JanmasethuAuditService,
        private readonly encryption: JanmasethuEncryptionService,
        private readonly rbacService: JanmasethuRbacService,
        private readonly documentService: DocumentService,
        private readonly clinicalIntelligence: ClinicalIntelligenceService,
    ) { }

    private getUserContext(req: any): JanmasethuUserContext {
        return req.user;
    }

    @Get('reporting/journey/:patient_id')
    async getJourneyReport(@Param('patient_id') patientId: string, @Request() req: any) {
        try {
            const ctx = this.getUserContext(req);
            await this.auditService.logPIIAccess(ctx.id, ctx.role, patientId, 'REQUESTED_FULL_JOURNEY_REPORT');
            return await this.reportingService.generateJourneyReport(patientId);
        } catch (error) {
            this.logger.error(`Journey Report Final Failure: ${error.message} - ${error.stack}`);
            throw new BadRequestException(`Clinical Aggregator Trace: ${error.message}`);
        }
    }

    @Get('audit-logs')
    async getAuditLogs(@Request() req: any) {
        const ctx = this.getUserContext(req);
        if (ctx.role !== JanmasethuUserRole.CRO) {
            throw new UnauthorizedException('Audit access limited to Clinical Compliance Officers (CRO)');
        }
        return this.auditService.getAuditHistory();
    }

    // --- DFO PATIENT & JOURNEY ---

    @Get('doctors/availability')
    async getAvailability(@Param('doctor_id') doctorId?: string) {
        return this.repository.findDoctorAvailability(doctorId);
    }

    @Post('appointments')
    async bookAppointment(@Body() dto: BookAppointmentDto, @Request() req: any) {
        const ctx = this.getUserContext(req);
        const appt = await this.dfoService.bookAppointment({
            ...dto,
            appointment_date: new Date(dto.appointment_date)
        } as any);
        await this.auditService.logClinicalUpdate(ctx.id, 'APPOINTMENT_BOOKED', dto.patient_id, { appointmentId: appt.id });
        return appt;
    }

    // --- DFO CONSULTATIONS & HISTORY ---

    @Get('patient/:id/history')
    async getPatientHistory(@Param('id') id: string, @Request() req: any) {
        const ctx = this.getUserContext(req);
        await this.auditService.logPIIAccess(ctx.id, ctx.role, id, 'VIEWED_PATIENT_CLINICAL_HISTORY');
        return this.dfoService.getPatientHistory(id);
    }

    @Post('consultations/start')
    async startConsultation(@Body() dto: StartConsultationDto, @Request() req: any) {
        try {
            const user = this.getUserContext(req);
            const consultation = await this.dfoService.startConsultation(dto.threadId, user.id);

            // AUTO-TRIGGER: Clinical Intelligence analysis on consultation start
            this.clinicalIntelligence.analyzeConversation(dto.threadId, user.id)
                .catch(e => this.logger.warn(`Clinical Analysis auto-trigger failed: ${e.message}`));

            return consultation;
        } catch (error) {
            this.logger.error(`Consultation Start Failure: ${error.message}`);
            throw new BadRequestException(`Clinic Logic Error: ${error.message}`);
        }
    }

    @Post('consultations/prescription')
    async addPrescription(@Body() dto: AddPrescriptionDto, @Request() req: any) {
        const ctx = this.getUserContext(req);
        const res = await this.dfoService.addPrescription(dto);
        await this.auditService.logClinicalUpdate(ctx.id, 'PRESCRIPTION_ADDED', dto.consultation_id, { medication: dto.medication_name });

        // AUTO-TRIGGER: Queue document generation asynchronously (non-blocking)
        const consultation = await this.repository.findThreadById(dto.consultation_id).catch(() => null);
        const patientId: string = (consultation?.metadata?.patient_id as string) || 'unknown';

        this.documentService.queuePrescriptionGeneration({
            prescription_id: res.id!,
            consultation_id: dto.consultation_id,
            patient_id: patientId,
            doctor_id: ctx.id,
            generated_by: ctx.id,
        }).catch(e => this.logger.warn(`Document auto-queue failed (non-critical): ${e.message}`));

        return { ...res, document_generation: 'queued' };
    }

    @Post('consultations/close')
    async closeConsultation(@Body() dto: CloseConsultationDto, @Request() req: any) {
        const ctx = this.getUserContext(req);
        await this.dfoService.closeConsultation(dto.id, dto.notes);
        await this.auditService.logClinicalUpdate(ctx.id, 'CONSULTATION_CLOSED', dto.id, { notes: dto.notes.substring(0, 50) });

        // AUTO-TRIGGER: AI Summary on consultation close
        const threadId = await this.repository.findThreadByConsultationId(dto.id).catch(() => null);
        if (threadId) {
            this.summaryService.generateSummary(threadId).catch(e => this.logger.warn(`AI Summary auto-trigger failed: ${e.message}`));
        }

        return { status: 'closed' };
    }

    @Post('reports/upload')
    async uploadReport(@Body() dto: any) {
        return this.dfoService.uploadReport(dto);
    }

    // --- DFO ANALYTICS ---

    @Get('analytics')
    async getOverview() {
        return this.dfoService.getDFOAnalytics();
    }

    @Get('threads')
    async listThreads(@Request() req: any) {
        const user = this.getUserContext(req);
        return this.repository.findThreads(user);
    }

    @Get('workload')
    async getWorkload() {
        return this.repository.findWorkload();
    }

    @Get('risk/:patient_id')
    async getPatientRiskTrend(@Param('patient_id') patientId: string) {
        return this.repository.findRiskLogsByPatient(patientId);
    }

    @Get('context/:id')
    async getThreadContext(
        @Param('id') threadId: string,
        @Request() req: any
    ) {
        const user = this.getUserContext(req);
        if (!this.rbacService.canViewThread(user, { id: threadId } as any)) {
            throw new UnauthorizedException('Access denied to this thread context');
        }
        return this.contextService.getThreadContext(threadId, user);
    }

    @Post('summary/:thread_id')
    async generateSummary(@Param('thread_id') threadId: string) {
        return this.summaryService.generateSummary(threadId);
    }

    @Post('feedback')
    async submitFeedback(@Body() body: any, @Request() req: any) {
        const user = this.getUserContext(req);
        await this.feedbackService.submitFeedback(body.threadId, user, {
            accuracy_score: body.accuracyScore,
            comment: body.comment,
            risk_mismatch: body.riskMismatch,
        });
        return { status: 'recorded' };
    }

    @Post('assign/auto/:id')
    async autoAssign(@Param('id') threadId: string) {
        await this.assignmentService.autoAssignThread(threadId);
        return { status: 'auto-assigned', threadId };
    }

    @Post('assign/:id')
    async assignThread(
        @Param('id') threadId: string,
        @Body() body: any,
        @Request() req: any
    ) {
        const user = this.getUserContext(req);
        const { targetUserId, targetRole } = body;
        await this.assignmentService.assignThread(threadId, targetUserId, targetRole, user);
        return { status: 'assigned', threadId };
    }

    @Post('take-control/:id')
    async takeControl(
        @Param('id') threadId: string,
        @Request() req: any
    ) {
        const user = this.getUserContext(req);
        await this.takeoverService.takeControl(threadId, user);
        return { status: 'controlled', threadId };
    }

    @Post('escalate/:id')
    async escalateThread(
        @Param('id') threadId: string,
        @Body() body: { targetStatus: 'red' | 'yellow'; assignedUserId?: string },
        @Request() req: any
    ) {
        const ctx = this.getUserContext(req);
        if (ctx.role !== JanmasethuUserRole.CRO) {
            throw new UnauthorizedException('Only CROs can escalate threads');
        }

        const thread = await this.repository.findThreadById(threadId);
        if (!thread) throw new BadRequestException('Thread not found');

        const targetRole = body.targetStatus === 'red' ? JanmasethuRole.DOCTOR_QUEUE : JanmasethuRole.NURSE_QUEUE;
        const targetStatusEnum = body.targetStatus === 'red' ? ThreadStatus.RED : ThreadStatus.YELLOW;

        await this.repository.updateThreadAtomic(threadId, thread.version, {
            status: targetStatusEnum,
            assigned_role: targetRole,
            assigned_user_id: body.assignedUserId || undefined,
            ownership: OwnershipType.AI,
            is_locked: false,
        });

        await this.repository.insertAuditLog({
            thread_id: threadId,
            actor_id: ctx.id,
            actor_type: 'HUMAN',
            event_type: 'THREAD_ESCALATED',
            payload: { targetStatus: body.targetStatus, targetRole },
        });

        return { status: 'escalated', threadId, targetStatus: body.targetStatus };
    }

    @Post('refer/:id')
    async referCase(
        @Param('id') threadId: string,
        @Body() body: { targetDoctorId: string; reason: string },
        @Request() req: any
    ) {
        const user = this.getUserContext(req);
        if (user.role !== JanmasethuUserRole.DOCTOR) {
            throw new UnauthorizedException('Only DOCTOR roles can issue formal clinical referrals.');
        }

        await this.repository.referCase(threadId, body.targetDoctorId, user.id, body.reason);
        return { status: 'referred', threadId, target: body.targetDoctorId };
    }

    @Post('reply')
    async handleReply(
        @Body() body: { thread_id: string; sender_type: string; content: string },
        @Request() req: any
    ) {
        const user = this.getUserContext(req);

        // 1. Save message to thread
        await this.threadService.appendMessage(body.thread_id, {
            sender_id: user.id,
            sender_type: 'HUMAN',
            content: body.content,
        });

        // 2. Fetch thread to get channel and original userId
        const thread = await this.threadService.getThread(body.thread_id);

        // 3. Dispatch to external channel
        await this.dispatchService.dispatchResponse(
            thread.channel,
            thread.user_id,
            body.content
        );

        return { status: 'sent', thread_id: body.thread_id };
    }

    @Get('appointments')
    async listAppointments() {
        return this.appointmentService.findAll();
    }

    @Get('doctors/:id/slots')
    async getDoctorSlots(@Param('id') doctorId: string) {
        return this.appointmentService.findSlots(doctorId);
    }

    @Post('appointments/book')
    async completeBookAppointment(@Body() body: { patientId: string, doctorId: string, date: string, notes?: string }) {
        return this.appointmentService.bookAppointment({
            patientId: body.patientId,
            doctorId: body.doctorId,
            date: new Date(body.date),
            notes: body.notes
        });
    }

    @Post('appointments/reschedule/:id')
    async rescheduleAppointment(@Param('id') id: string, @Body() body: { newDate: string; reason: string }) {
        return this.appointmentService.rescheduleAppointment(id, new Date(body.newDate), body.reason);
    }

    @Post('appointments/cancel/:id')
    async cancelAppointment(@Param('id') id: string, @Body() body: { reason: string }) {
        return this.appointmentService.cancelAppointment(id, body.reason);
    }

    @Post('appointments/complete/:id')
    async completeAppointment(@Param('id') id: string) {
        return this.appointmentService.completeAppointment(id);
    }

    // --- PROACTIVE ENGAGEMENT TRIGGER ---
    @Post('engagement/trigger')
    async triggerEngagement(@Body() body: { event: string, payload: any }) {
        return this.engagementEngine.processEvent(body.event, body.payload);
    }

    // --- CLINIC LEADS (MIGRATED) ---
    @Get('leads')
    async listLeads(@Body() filters: any) {
        return this.leadsService.getLeads(filters);
    }

    @Post('leads')
    async createLead(@Body() payload: any, @Request() req: any) {
        const ctx = this.getUserContext(req);
        await this.auditService.logPIIAccess(ctx.id, ctx.role, 'SYSTEM', 'REGISTERED_NEW_LEAD');
        return this.leadsService.createLead(payload);
    }

    @Post('leads/:id/convert')
    async convertLead(@Param('id') id: string, @Request() req: any) {
        const ctx = this.getUserContext(req);
        return this.leadsService.convertLeadToPatient(id, ctx.id);
    }

    @Post('leads/process-stalled')
    async processStalled(@Request() req: any) {
        const ctx = this.getUserContext(req);
        if (!this.rbacService.canViewPII(ctx)) {
            throw new BadRequestException('Unauthorized to process clinical funnel.');
        }

        await this.auditService.logPIIAccess(ctx.id, ctx.role, 'SYSTEM', 'TRIGGERED_LEAD_CONVERSION_BATCH');
        return this.leadsService.processStalledLeads();
    }

    @Get('patients')
    async listPatients(@Request() req: any) {
        const ctx = this.getUserContext(req);
        if (!this.rbacService.canViewPII(ctx)) {
            throw new BadRequestException('Unauthorized PII Access');
        }

        await this.auditService.logPIIAccess(ctx.id, ctx.role, 'ALL_PATIENTS', 'BULK_PATIENT_LIST_ACCESS');
        const rawPatients = await this.repository.findAllPatients();

        // AUTO-DECRYPT FOR DOCTOR VIEW
        return rawPatients.map(p => ({
            ...p,
            full_name: this.encryption.decrypt(p.full_name),
            phone_number: this.encryption.decrypt(p.phone_number || '')
        }));
    }

    @Get('patients/:id')
    async getPatient(@Param('id') id: string, @Request() req: any) {
        const ctx = this.getUserContext(req);
        await this.auditService.logPIIAccess(ctx.id, ctx.role, id, 'DETAILED_PATIENT_PROFILE_ACCESS');
        return this.dfoService.getPatientProfile(id);
    }

    @Patch('patients/:id')
    async updatePatient(@Param('id') id: string, @Body() dto: any, @Request() req: any) {
        const ctx = this.getUserContext(req);
        await this.auditService.logClinicalUpdate(ctx.id, 'PATIENT_PROFILE_UPDATED', id, dto);
        return this.repository.upsertDFOPatient({ ...dto, id });
    }

    @Get('clinic-metrics')
    async getClinicalMetrics() {
        return this.dfoService.getClinicalMetrics();
    }

    @Post('clinical-intelligence/analyze')
    async analyzeIntelligence(@Body('thread_id') threadId: string, @Request() req: any) {
        const ctx = this.getUserContext(req);

        // 1. Fetch thread messages
        const messages = await this.repository.findMessagesByThreadId(threadId);
        if (!messages || messages.length === 0) {
            throw new BadRequestException('Thread has no messages to analyze.');
        }

        // 2. Transcribe messages into a conversation text format
        const conversationText = messages.map(m => `[${m.sender_type}]: ${m.content}`).join('\n');

        // 3. Send transcript to AI
        return this.clinicalIntelligence.analyzeConversation(conversationText, ctx.id);
    }
}
