import { Injectable, Logger, Inject, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { PiiDecrypterService } from './pii-decrypter.service';

@Injectable()
export class ThreadOperationsRepository implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(ThreadOperationsRepository.name);
    private lastProcessedId: number = 0;
    private pollingInterval: NodeJS.Timeout | null = null;

    constructor(
        @Inject('SUPABASE_CLIENT') private readonly supabase: SupabaseClient,
        @Inject('ORG_SUPABASE_CLIENT') private readonly orgSupabase: SupabaseClient,
        private readonly piiDecrypter: PiiDecrypterService
    ) { }

    async onModuleInit() {
        // 1. Initialize lastProcessedId with the highest existing message ID
        try {
            const { data, error } = await this.orgSupabase
                .from('sakhi_conversations_new')
                .select('id')
                .order('id', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (error) {
                this.logger.error('Error fetching latest message ID for initialization:', error);
            } else if (data) {
                this.lastProcessedId = data.id;
                this.logger.log(`Initialized message polling starting after ID: ${this.lastProcessedId}`);
            }
        } catch (e) {
            this.logger.error('Failed to initialize lastProcessedId:', e);
        }

        // 2. Setup real-time listener (may fail or time out on self-hosted Hostinger DB)
        this.orgSupabase
            .channel('sakhi-listener')
            .on('postgres_changes', { 
                event: 'INSERT', 
                schema: 'public', 
                table: 'sakhi_conversations_new' 
            }, async (payload) => {
                try {
                    const msg = payload.new;
                    if (msg && msg.id > this.lastProcessedId) {
                        this.lastProcessedId = msg.id;
                        await this.handleIncomingMessage(msg);
                    }
                } catch (e) {
                    this.logger.error('Error handling incoming message from sakhi real-time:', e);
                }
            })
            .subscribe((status) => {
                this.logger.log(`Realtime subscription status for sakhi-listener: ${status}`);
            });

        // 3. Setup periodic polling loop as a reliable fallback
        this.pollingInterval = setInterval(async () => {
            try {
                await this.pollNewMessages();
            } catch (e) {
                this.logger.error('Error in message polling loop:', e);
            }
        }, 5000); // Check every 5 seconds

        this.logger.log('Started polling fallback (5s interval) for sakhi_conversations_new.');
    }

    onModuleDestroy() {
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.logger.log('Cleared message polling interval.');
        }
    }

    async pollNewMessages() {
        const { data, error } = await this.orgSupabase
            .from('sakhi_conversations_new')
            .select('*')
            .gt('id', this.lastProcessedId)
            .order('id', { ascending: true });

        if (error) {
            this.logger.error('Failed to poll new messages:', error.message);
            return;
        }

        if (data && data.length > 0) {
            this.logger.log(`Polled ${data.length} new messages from sakhi_conversations_new.`);
            for (const msg of data) {
                if (msg.id > this.lastProcessedId) {
                    this.lastProcessedId = msg.id;
                    await this.handleIncomingMessage(msg);
                }
            }
        }
    }

    async handleIncomingMessage(msg: any) {
        if (!msg || msg.message_type !== 'user' || !msg.user_id) {
            return;
        }

        const text = msg.message_text || '';
        this.logger.log(`New message from patient ${msg.user_id}: "${text}"`);

        // Decrypt PII and GMED tokens in the message text first before keyword/sentiment analysis
        let decryptedText = text;
        const matches = text.match(/\{\{[A-Z]+_[a-zA-Z0-9]+\}\}/g);
        if (matches && matches.length > 0) {
            const tokens = new Set<string>();
            const gmedTokens = new Set<string>();
            for (const t of matches) {
                if (t.startsWith('{{GMED_')) {
                    gmedTokens.add(t);
                } else {
                    tokens.add(t);
                }
            }

            const tokenMap = new Map<string, string>();
            if (tokens.size > 0) {
                try {
                    const { data: vaultRows } = await this.orgSupabase
                        .from('sakhi_pii_vault')
                        .select('token_key, encrypted_value')
                        .in('token_key', Array.from(tokens));

                    for (const r of vaultRows || []) {
                        const decrypted = this.piiDecrypter.decrypt(r.encrypted_value);
                        tokenMap.set(r.token_key, decrypted);
                    }
                } catch (vaultError) {
                    this.logger.error('Failed to query or decrypt sakhi_pii_vault for incoming message:', vaultError);
                }
            }

            if (gmedTokens.size > 0) {
                try {
                    const { data: dictRows } = await this.orgSupabase
                        .from('sakhi_medical_dictionary')
                        .select('token_key, encrypted_term')
                        .in('token_key', Array.from(gmedTokens));

                    for (const r of dictRows || []) {
                        const decrypted = this.piiDecrypter.decrypt(r.encrypted_term);
                        tokenMap.set(r.token_key, decrypted);
                    }
                } catch (dictError) {
                    this.logger.error('Failed to query or decrypt sakhi_medical_dictionary for incoming message:', dictError);
                }
            }

            for (const t of matches) {
                if (tokenMap.has(t)) {
                    const replacement = tokenMap.get(t) || '';
                    const escapedT = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    decryptedText = decryptedText.replace(new RegExp(escapedT, 'g'), replacement);
                }
            }
            this.logger.log(`Decrypted message text to: "${decryptedText}"`);
        }

        // Check if thread exists
        let { data: thread, error } = await this.supabase
            .from('conversation_threads')
            .select('*')
            .eq('user_id', msg.user_id)
            .maybeSingle();

        if (error) {
            this.logger.error('Error fetching thread:', error);
            return;
        }

        // If no thread exists, create one
        if (!thread) {
            this.logger.log(`Thread not found for patient ${msg.user_id}. Creating new thread.`);
            const { data: newThread, error: createError } = await this.supabase
                .from('conversation_threads')
                .insert([{
                    domain: 'janmasethu',
                    user_id: msg.user_id,
                    channel: 'whatsapp',
                    status: 'green',
                    ownership: 'AI',
                    ai_suppressed: false,
                    last_message_preview: decryptedText.substring(0, 100),
                    last_message_at: new Date(),
                    created_at: new Date(),
                    updated_at: new Date()
                }])
                .select()
                .single();

            if (createError) {
                this.logger.error('Error creating thread:', createError);
                return;
            }
            thread = newThread;
        } else {
            // Update last message preview & last_message_at
            const { error: updateError } = await this.supabase
                .from('conversation_threads')
                .update({
                    last_message_preview: decryptedText.substring(0, 100),
                    last_message_at: new Date(),
                    updated_at: new Date()
                })
                .eq('id', thread.id);
            if (updateError) {
                this.logger.error(`Error updating thread message info for thread ${thread.id}:`, updateError);
            }
        }

        // Perform keyword and sentiment analysis
        const lowText = decryptedText.toLowerCase();
        
        // Doctor level: urgent clinical red-flags, suicide ideation / critical distress
        const doctorKeywords = [
            'bleeding', 'blood', 'pain', 'severe', 'emergency', 'cramp', 'fever', 
            'headache', 'discharge', 'leakage', 'vomiting', 'painful', 'hurts', 'accident',
            'die', 'suicide', 'kill myself', 'end my life', 'kill me'
        ];
        
        // Nurse level: operational or minor questions
        const nurseKeywords = [
            'price', 'cost', 'appointment', 'timing', 'schedule', 'doctor available',
            'report', 'prescription', 'how to take', 'ivf steps', 'scan timing', 'fee'
        ];

        let escalateStatus: string | null = null;
        let reason = '';

        // Check Doctor keywords first
        const matchedDocKeyword = doctorKeywords.find(kw => lowText.includes(kw));
        if (matchedDocKeyword) {
            escalateStatus = 'red';
            reason = `High Risk: Clinical red-flag keyword "${matchedDocKeyword}" detected.`;
        } else {
            // Check Nurse keywords
            const matchedNurseKeyword = nurseKeywords.find(kw => lowText.includes(kw));
            if (matchedNurseKeyword) {
                escalateStatus = 'yellow';
                reason = `Triage needed: Keyword "${matchedNurseKeyword}" detected.`;
            }
        }

        // Simple sentiment check (distress detection)
        const negativeWords = ['bad', 'worse', 'help', 'crying', 'sad', 'scared', 'afraid', 'dying', 'sick', 'depressed', 'hopeless', 'helpless'];
        if (!escalateStatus) {
            const matchedNeg = negativeWords.find(kw => lowText.includes(kw));
            if (matchedNeg) {
                escalateStatus = 'yellow';
                reason = `Sentiment analysis: Distress indicator "${matchedNeg}" detected.`;
            }
        }

        if (escalateStatus) {
            this.logger.log(`Escalating thread ${thread.id} to ${escalateStatus} due to: "${reason}"`);
            await this.escalateThread(
                thread.id,
                reason,
                escalateStatus,
                escalateStatus === 'red' ? 90 : 50,
                'AI Sentiment Engine'
            );

            // Send automated "We will assist you ASAP" response to Sakhi chatbot
            const { error: replyError } = await this.orgSupabase
                .from('sakhi_conversations_new')
                .insert([{
                    user_id: msg.user_id,
                    message_text: "We will assist you ASAP",
                    message_type: 'sakhi',
                    language: 'en',
                    created_at: new Date()
                }]);
            
            if (replyError) {
                this.logger.error('Failed to insert automated escalation response:', replyError);
            } else {
                this.logger.log(`Sent automated escalation message to user ${msg.user_id}`);
            }
        }
    }

    async findThreads(user?: { id: string; role: string }) {
        let query = this.supabase
            .from('conversation_threads')
            .select('*');

        if (user) {
            const roleUpper = user.role.toUpperCase();
            if (roleUpper === 'NURSE') {
                query = query
                    .eq('assigned_role', 'NURSE')
                    .or(`assigned_user_id.eq.${user.id},assigned_user_id.eq.nurse_divya`);
            } else if (roleUpper === 'DOCTOR') {
                query = query
                    .eq('assigned_role', 'DOCTOR')
                    .or(`assigned_user_id.eq.${user.id},assigned_user_id.eq.dr_sireesha`);
            }
        }

        const { data, error } = await query.order('last_message_at', { ascending: false });
        if (error) throw error;

        // Group by user_id to keep only the latest thread per unique user
        const unique = new Map<string, any>();
        for (const t of data || []) {
            if (!t.user_id) continue;
            const existing = unique.get(t.user_id);
            if (!existing || new Date(t.last_message_at || t.updated_at) > new Date(existing.last_message_at || existing.updated_at)) {
                unique.set(t.user_id, t);
            }
        }
        const groupedThreads = Array.from(unique.values());

        // For CRO role: Filter out threads that are assigned to DOCTOR or NURSE unless their SLA has expired
        let visibleThreads = groupedThreads;
        if (user && user.role.toUpperCase() === 'CRO') {
            visibleThreads = groupedThreads.filter(t => {
                const isAssigned = !!t.assigned_role;
                const isSlaExpired = t.sla_due_at && new Date(t.sla_due_at).getTime() < Date.now();
                return !isAssigned || isSlaExpired;
            });
        }

        // Enrich with patient name
        const enriched = await Promise.all(visibleThreads.map(async (t) => {
            const { data: patient } = await this.orgSupabase
                .from('sakhi_clinic_patients')
                .select('name')
                .eq('mobile', t.user_id)
                .maybeSingle();

            // Map the database UUID to dropdown IDs for frontend consistency
            let displayOwnerId = t.assigned_user_id;
            if (t.assigned_user_id === '24efa0aa-16d8-4b59-8c1b-91847d7b5599') displayOwnerId = 'dr_sireesha';
            else if (t.assigned_user_id === 'adf72781-93d8-4827-ad1f-607d40c0edf3') displayOwnerId = 'nurse_divya';

            return {
                ...t,
                current_owner_type: t.assigned_role,
                current_owner_id: displayOwnerId,
                patient_name: patient?.name || 'Patient ' + (t.user_id ? t.user_id.substring(0, 5) : 'Unknown')
            };
        }));
        return enriched;
    }

    async findThreadById(id: string) {
        const { data, error } = await this.supabase
            .from('conversation_threads')
            .select('*')
            .eq('id', id)
            .maybeSingle();
        if (error) throw error;
        if (!data) return null;

        const { data: patient } = await this.orgSupabase
            .from('sakhi_clinic_patients')
            .select('name')
            .eq('mobile', data.user_id)
            .maybeSingle();

        // Map the database UUID to dropdown IDs for frontend consistency
        let displayOwnerId = data.assigned_user_id;
        if (data.assigned_user_id === '24efa0aa-16d8-4b59-8c1b-91847d7b5599') displayOwnerId = 'dr_sireesha';
        else if (data.assigned_user_id === 'adf72781-93d8-4827-ad1f-607d40c0edf3') displayOwnerId = 'nurse_divya';

        return {
            ...data,
            current_owner_type: data.assigned_role,
            current_owner_id: displayOwnerId,
            patient_name: patient?.name || 'Patient ' + (data.user_id ? data.user_id.substring(0, 5) : 'Unknown')
        };
    }

    async findMessagesByThreadId(threadId: string) {
        // Fetch the user_id of the thread
        const { data: thread } = await this.supabase
            .from('conversation_threads')
            .select('user_id')
            .eq('id', threadId)
            .maybeSingle();

        if (!thread || !thread.user_id) {
            return [];
        }

        const { data, error } = await this.orgSupabase
            .from('sakhi_conversations_new')
            .select('*')
            .eq('user_id', thread.user_id)
            .order('created_at', { ascending: true });
            
        if (error) throw error;

        // Extract PII and GMED tokens across all messages to perform a single batch query
        const tokens = new Set<string>();
        const gmedTokens = new Set<string>();
        for (const m of data || []) {
            if (m.message_text) {
                const matches = m.message_text.match(/\{\{[A-Z]+_[a-zA-Z0-9]+\}\}/g);
                if (matches) {
                    for (const t of matches) {
                        if (t.startsWith('{{GMED_')) {
                            gmedTokens.add(t);
                        } else {
                            tokens.add(t);
                        }
                    }
                }
            }
        }

        const tokenMap = new Map<string, string>();
        if (tokens.size > 0) {
            try {
                const { data: vaultRows } = await this.orgSupabase
                    .from('sakhi_pii_vault')
                    .select('token_key, encrypted_value')
                    .in('token_key', Array.from(tokens));

                for (const r of vaultRows || []) {
                    const decrypted = this.piiDecrypter.decrypt(r.encrypted_value);
                    tokenMap.set(r.token_key, decrypted);
                }
            } catch (vaultError) {
                this.logger.error('Failed to query or decrypt sakhi_pii_vault:', vaultError);
            }
        }

        if (gmedTokens.size > 0) {
            try {
                const { data: dictRows } = await this.orgSupabase
                    .from('sakhi_medical_dictionary')
                    .select('token_key, encrypted_term')
                    .in('token_key', Array.from(gmedTokens));

                for (const r of dictRows || []) {
                    const decrypted = this.piiDecrypter.decrypt(r.encrypted_term);
                    tokenMap.set(r.token_key, decrypted);
                }
            } catch (dictError) {
                this.logger.error('Failed to query or decrypt sakhi_medical_dictionary:', dictError);
            }
        }

        const seen = new Set<string>();
        return (data || [])
            .map(m => {
                let sender_type = 'HUMAN';
                if (m.message_type === 'user') {
                    sender_type = 'PATIENT';
                } else if (m.message_type === 'sakhi') {
                    sender_type = 'AI';
                }

                // Replace tokens with decrypted values
                let text = m.message_text || '';
                const matches = text.match(/\{\{[A-Z]+_[a-zA-Z0-9]+\}\}/g);
                if (matches) {
                    for (const t of matches) {
                        if (tokenMap.has(t)) {
                            const replacement = tokenMap.get(t) || '';
                            // Escape regex special chars to do safe replacement
                            const escapedT = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                            text = text.replace(new RegExp(escapedT, 'g'), replacement);
                        }
                    }
                }

                return {
                    id: m.id.toString(),
                    thread_id: threadId,
                    sender_id: m.message_type === 'user' ? thread.user_id : 'SYSTEM',
                    sender_type: sender_type,
                    message: text,
                    content: text,
                    created_at: m.created_at
                };
            })
            .filter(m => {
                if (seen.has(m.id)) return false;
                seen.add(m.id);
                return true;
            });
    }

    async assignThread(id: string, assignTo: string, role: string) {
        const roleUpper = role.toUpperCase();
        const { error } = await this.supabase
            .from('conversation_threads')
            .update({
                assigned_to: assignTo,
                assigned_user_id: assignTo,
                assigned_role: roleUpper,
                status: roleUpper === 'DOCTOR' ? 'DOCTOR_ASSIGNED' : 'NURSE_ASSIGNED',
                ai_suppressed: true,
                sla_due_at: new Date(Date.now() + 10 * 60 * 1000), // Start a 10 min SLA countdown upon assignment
                updated_at: new Date()
            })
            .eq('id', id);
        if (error) throw error;

        // Fetch clinician's name
        const { data: user } = await this.orgSupabase
            .from('sakhi_clinic_users')
            .select('name')
            .eq('id', assignTo)
            .maybeSingle();

        let clinicianName = user?.name;
        if (!clinicianName) {
            if (assignTo === 'dr_sireesha') clinicianName = 'Dr. Sireesha';
            else if (assignTo === 'dr_ananya') clinicianName = 'Dr. Ananya';
            else if (assignTo === 'nurse_divya') clinicianName = 'Nurse Divya';
            else if (assignTo === 'nurse_sarah') clinicianName = 'Nurse Sarah';
            else clinicianName = roleUpper === 'DOCTOR' ? `Doctor (${assignTo})` : `Nurse (${assignTo})`;
        }

        await this.replyToThread(id, 'SYSTEM', 'SYSTEM', `Thread assigned to ${clinicianName}.`);
    }

    async escalateThread(id: string, reason: string, status: string, score: number, actor: string) {
        const { error } = await this.supabase
            .from('conversation_threads')
            .update({
                status: status,
                escalation_reason: reason,
                risk_score: score,
                escalated_by: actor,
                escalated_at: new Date(),
                sla_due_at: new Date(Date.now() + 10 * 60 * 1000), // 10 min SLA default
                ai_suppressed: true, // Silence AI chatbot immediately
                ownership: 'HUMAN',  // Take ownership away from AI chatbot
                updated_at: new Date()
            })
            .eq('id', id);
        if (error) throw error;
    }

    async replyToThread(threadId: string, senderType: string, senderId: string, message: string) {
        const thread = await this.findThreadById(threadId);
        if (!thread || !thread.user_id) {
            throw new Error('Thread not found or user_id missing');
        }

        const { data, error } = await this.orgSupabase
            .from('sakhi_conversations_new')
            .insert([{
                user_id: thread.user_id,
                message_text: message,
                message_type: 'human',
                language: 'en',
                created_at: new Date()
            }])
            .select()
            .single();
        if (error) throw error;

        // Also update thread last message preview and time
        await this.supabase
            .from('conversation_threads')
            .update({
                last_message_at: new Date(),
                last_message_preview: message.substring(0, 100),
                sla_due_at: null, // Clear SLA timer since a reply has been sent
                updated_at: new Date()
            })
            .eq('id', threadId);

        return {
            id: data.id.toString(),
            thread_id: threadId,
            sender_id: senderId,
            sender_type: senderType,
            message: message,
            content: message,
            created_at: data.created_at
        };
    }

    async resolveThread(id: string, userId?: string) {
        const { error } = await this.supabase
            .from('conversation_threads')
            .update({
                assigned_to: null,
                assigned_user_id: null,
                assigned_role: null,
                status: 'AI_ACTIVE',
                ai_suppressed: false,
                resolved_at: new Date(),
                resolved_by: userId || null,
                updated_at: new Date()
            })
            .eq('id', id);
        if (error) throw error;

        await this.replyToThread(id, 'SYSTEM', 'SYSTEM', 'Thread resolved and returned to AI.');
    }

    async refreshSummary(id: string, clinicalSummary: string, handoffSummary: string) {
        const { error } = await this.supabase
            .from('conversation_threads')
            .update({
                clinical_summary: clinicalSummary,
                handoff_summary: handoffSummary,
                updated_at: new Date()
            })
            .eq('id', id);
        if (error) throw error;
    }

    async findClinicians() {
        const { data, error } = await this.supabase
            .from('sakhi_clinic_users')
            .select('id, name, role')
            .in('role', ['Doctor', 'Nurse', 'Receptionist']);
        if (error) throw error;
        return (data || []).map(u => ({
            ...u,
            role: (u.role === 'Front_Desk' || u.role === 'Receptionist') ? 'Nurse' : u.role
        }));
    }
}
