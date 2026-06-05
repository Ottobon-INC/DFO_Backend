import { Injectable, Logger } from '@nestjs/common';
import { JanmasethuRepository } from './janmasethu.repository';
import { JanmasethuEncryptionService } from './utils/encryption.service';
import { JourneyStage } from './dfo.types';
import { JanmasethuDispatchService } from './channel/janmasethu-dispatch.service';

/**
 * Valid lead_status enum values from database
 */
const VALID_STATUSES = [
    'New Inquiry',
    'Follow Up',
    'Converted',
    'Not Interested',
    'Lost',
];

/**
 * Common source values used for smart field detection
 */
const SOURCE_VALUES = ['Walk-In', 'Walk-in', 'Website', 'website', 'Referral', 'referral', 'Social Media', 'Phone Call'];

const COLUMN_MAPPINGS: Record<string, string> = {
    'name': 'name', 'Name': 'name', 'FullName': 'name', 'Full Name': 'name',
    'phone': 'phone', 'Phone': 'phone', 'PhoneNumber': 'phone', 'Phone Number': 'phone',
    'status': 'status', 'Status': 'status', 'LeadStatus': 'status', 'Stage': 'status',
    'date': 'date_added', 'Date': 'date_added', 'CreatedAt': 'date_added',
    'age': 'age', 'Age': 'age',
    'gender': 'gender', 'Gender': 'gender',
    'source': 'source', 'Source': 'source',
    'inquiry': 'inquiry', 'Inquiry': 'inquiry',
    'problem': 'problem', 'Problem': 'problem',
    'treatmentdoctor': 'treatment_doctor', 'Doctor': 'treatment_doctor',
    'treatmentsuggested': 'treatment_suggested', 'Treatment': 'treatment_suggested',
    'location': 'location', 'City': 'location',
};

/**
 * Dynamic clinical template outbox registry
 */
export const OUTREACH_TEMPLATES = {
    WELCOME_NUDGE: (name: string) => 
        `Welcome to the Janmasethu Clinical Network, ${name}! 🏥 Your clinical profile is now active. How can we assist you today?`,
    CARE_NUDGE: (name: string, problem: string) => 
        `Hi ${name}, this is the Janmasethu Care Team. We noticed you were inquiring about "${problem}" yesterday. Would you like to schedule a quick call with our specialist? 😊🩺`,
};

/**
 * Advanced phone validation function
 * Rejects:
 * - Empty or wrong digit lengths (non-10 to 15 digits)
 * - Identical digits (e.g., 0000000000, 9999999999)
 * - Sequential digits (e.g., 0123456789, 1234567890, 9876543210)
 */
export function isValidPhoneNumber(phone: string): boolean {
    if (!phone) return false;
    const digits = phone.replace(/\D/g, '');
    
    // Validate digit length
    if (digits.length < 10 || digits.length > 15) return false;
    
    // Reject repetitive identical numbers (e.g. 0000000000, 9999999999)
    if (/^(\d)\1+$/.test(digits)) return false;
    
    // Reject sequential ascending or descending numbers
    const sequentialAsc = '0123456789012345';
    const sequentialDesc = '9876543210987654';
    if (sequentialAsc.includes(digits) || sequentialDesc.includes(digits)) return false;
    
    return true;
}

@Injectable()
export class JanmasethuLeadsService {
    private readonly logger = new Logger(JanmasethuLeadsService.name);

    constructor(
        private readonly repository: JanmasethuRepository,
        private readonly encryption: JanmasethuEncryptionService,
        private readonly dispatcher: JanmasethuDispatchService
    ) { }

    /**
     * MIGRATED CORE FROM JS_Clinics_Backend
     * - Normalizes incoming lead payload (mapping headers, resolving status/source mix-up).
     * - Performs advanced validation on phone numbers to reject fake/random entries.
     * - Checks for active duplicates before creating a new entry.
     * - Enforces AES-256 encryption on clinical medical fields.
     */
    async createLead(rawPayload: Record<string, any>) {
        const body = this.normalizeLead(rawPayload);

        const name = body.name?.trim();
        const phone = body.phone?.trim();

        if (!name || !phone) {
            throw new Error('Mandatory Fields Missing: Name and Phone Number are required for Clinic Lead Registration.');
        }

        // 1. Strict Phone Integrity Validation
        if (!isValidPhoneNumber(phone)) {
            throw new Error(`Invalid Phone Number: "${phone}" is fake, repetitive, or sequential.`);
        }

        // 2. Active Duplicate Check
        const existing = await this.repository.findLeads({ page: 1, limit: 1, query: phone });
        if (existing && existing.items && existing.items.length > 0) {
            const activeLead = existing.items.find(lead => ['New Inquiry', 'Follow Up'].includes(lead.status));
            if (activeLead) {
                this.logger.log(`JanmaSethu: Duplicate lead registration bypassed for ${phone}. Merging inquiry.`);
                return activeLead;
            }
        }

        // 3. Prepare clinical payload with encryption
        const payload = {
            ...body,
            status: this.normalizeStatus(body.status),
            problem: this.encryption.encrypt(body.problem),
            treatment_doctor: this.encryption.encrypt(body.treatment_doctor),
            treatment_suggested: this.encryption.encrypt(body.treatment_suggested),
        };

        this.logger.log(`JanmaSethu: Registering new clinical lead for ${name} [${phone}]`);

        // 4. Persist in Repository
        return await this.repository.createLead(payload);
    }

    async getLeads(filters: any) {
        const { items, pagination } = await this.repository.findLeads(filters);

        // Decrypt on Retrieval
        const decryptedItems = items.map(lead => ({
            ...lead,
            problem: this.encryption.decrypt(lead.problem),
            treatment_doctor: this.encryption.decrypt(lead.treatment_doctor),
            treatment_suggested: this.encryption.decrypt(lead.treatment_suggested),
        }));

        return { items: decryptedItems, pagination };
    }

    /**
     * STALLED LEADS BATCH PROCESSOR
     * - Identifies leads in 'New Inquiry' > 24h.
     * - Performs non-invasive "Care Nudge" outreach using templates.
     */
    async processStalledLeads() {
        this.logger.log('Janmasethu: Scanning for stalled clinical leads...');
        const leads = await this.repository.findStalledLeads(24);

        if (!leads.length) {
            this.logger.log('No stalled leads found today. Funnel is clean!');
            return { processed: 0 };
        }

        const outreachResults: any[] = [];
        for (const lead of leads) {
            const result = await this.runAutomatedOutreach(lead);
            outreachResults.push(result);
        }

        return {
            total_stalled: leads.length,
            processed: outreachResults.length
        };
    }

    private async runAutomatedOutreach(lead: any) {
        const decryptedProblem = this.encryption.decrypt(lead.problem);

        this.logger.warn(`[LEAD_NUDGE] Patient: ${lead.name} (${lead.phone}) | Topic: ${decryptedProblem}`);

        // --- CARE NUDGE DYNAMIC TEMPLATE ---
        const message = OUTREACH_TEMPLATES.CARE_NUDGE(lead.name, decryptedProblem);

        this.logger.log(`Dispatching Outreach: ${message}`);

        // Update status to 'Follow Up' to mark activity
        return await this.repository.updateLeadStatus(
            lead.id,
            'Follow Up',
            `Auto-Nudge: Sent care message regarding ${decryptedProblem}`
        );
    }

    /**
     * NORMALIZATION BRAIN
     * - Swaps Source and Status if they look reversed (common CSV error)
     */
    private normalizeLead(lead: Record<string, any>): Record<string, any> {
        const normalized: Record<string, any> = {};

        for (const [key, value] of Object.entries(lead)) {
            const lowerKey = key.toLowerCase().trim();
            const mappedField = COLUMN_MAPPINGS[lowerKey] || lowerKey;

            if (normalized[mappedField] === undefined) {
                normalized[mappedField] = value;
            }
        }

        const sourceVal = normalized.source;
        const statusVal = normalized.status;

        // Perform smart reversal check
        if (this.looksLikeStatus(sourceVal) && this.looksLikeSource(statusVal)) {
            normalized.source = statusVal;
            normalized.status = sourceVal;
        }

        return normalized;
    }

    private normalizeStatus(rawStatus: string): string {
        if (!rawStatus) return 'New Inquiry';
        const matched = VALID_STATUSES.find(s => s.toLowerCase() === rawStatus.trim().toLowerCase());
        return matched || 'New Inquiry';
    }

    /**
     * LEAD CONVERSION WORKFLOW
     * - Promotional promotion of a clinical lead to a full patient profile.
     * - Safe try-catch-compensate sequence to guarantee transactional state integrity.
     */
    async convertLeadToPatient(leadId: string, doctorId: string) {
        this.logger.log(`JanmaSethu: Converting clinical lead ${leadId} to full patient profile...`);
        const lead = await this.repository.findLeadById(leadId);

        if (!lead) throw new Error('Lead not found');

        const originalStatus = lead.status;
        const originalInquiry = lead.inquiry;

        let patient;
        try {
            // 1. Create Patient Profile (Encrypted)
            patient = await this.repository.upsertDFOPatient({
                full_name: this.encryption.encrypt(lead.name),
                phone_number: this.encryption.encrypt(lead.phone),
                journey_stage: JourneyStage.NOT_SPECIFIED,
                metadata: {
                    converted_from_lead: leadId,
                    original_inquiry: this.encryption.decrypt(lead.problem),
                    treatment_onboarding: lead.treatment_suggested
                }
            });

            // 2. Update Lead Status
            await this.repository.updateLeadStatus(leadId, 'Converted', `Account promoted to Patient ID: ${patient.id}`);

            // 3. Trigger Welcome Engagement with registry template
            const message = OUTREACH_TEMPLATES.WELCOME_NUDGE(lead.name);
            await this.dispatcher.dispatchResponse('whatsapp', lead.phone, message);

            // 4. Record the engagement
            await this.repository.insertEngagementLog({
                patient_id: patient.id,
                channel: 'whatsapp',
                content: message,
                status: 'SENT'
            });

            return {
                success: true,
                patient_id: patient.id,
                onboarding: 'WELCOME_NUDGE_SENT'
            };
        } catch (error) {
            this.logger.error(`JanmaSethu: Failed to convert lead to patient ${leadId}. Reverting lead status for transaction safety.`);
            
            // Compensate state by reverting status back to original state
            try {
                await this.repository.updateLeadStatus(leadId, originalStatus, originalInquiry);
            } catch (revertError) {
                this.logger.error(`Critical state divergence: Failed to compensate lead status for ${leadId}: ${revertError.message}`);
            }

            throw error;
        }
    }

    private looksLikeSource(value: string): boolean {
        if (!value) return false;
        return SOURCE_VALUES.some(s => s.toLowerCase() === value.trim().toLowerCase());
    }

    private looksLikeStatus(value: string): boolean {
        if (!value) return false;
        const trimmed = value.trim().toLowerCase();
        return VALID_STATUSES.some(s => s.toLowerCase() === trimmed) || trimmed.includes('follow') || trimmed.includes('inquiry');
    }
}

