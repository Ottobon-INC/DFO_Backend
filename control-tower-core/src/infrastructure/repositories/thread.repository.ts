import { Injectable, Inject, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { Thread } from '../../types';
import { ConcurrencyException } from '../exceptions';

@Injectable()
export class ThreadRepository {
    private readonly logger = new Logger(ThreadRepository.name);

    constructor(@Inject('SUPABASE_CLIENT') private readonly supabase: SupabaseClient) { }

    private async enrichThreadsWithPatientInfo(threads: any[]): Promise<any[]> {
        if (!threads || threads.length === 0) return [];

        const patientMap: Record<string, string> = {};
        try {
            const { data: pts } = await this.supabase
                .from('sakhi_clinic_patients')
                .select('name, mobile');
            if (pts) {
                for (const p of pts) {
                    if (p.mobile) {
                        const clean = p.mobile.replace(/\D/g, '');
                        patientMap[clean] = p.name;
                        if (clean.length > 10) {
                            patientMap[clean.slice(-10)] = p.name;
                        }
                    }
                }
            }
        } catch (e) {
            this.logger.warn(`Failed to fetch patients from Supabase: ${e}`);
        }

        // Known patient records from local SQLite DB
        const localPatients: Record<string, string> = {
            '919346101504': 'Harini Rampa',
            '9346101504': 'Harini Rampa',
            '1234567890': 'Test Patient',
            '917207180691': 'Aditya',
            '7207180691': 'Aditya',
        };

        return threads.map(t => {
            const isPhone = /^\+?[0-9]{10,13}$/.test(t.user_id || '');
            const cleanUser = (t.user_id || '').replace(/\D/g, '');
            const resolvedName =
                t.patient_name ||
                patientMap[cleanUser] ||
                patientMap[cleanUser.slice(-10)] ||
                localPatients[cleanUser] ||
                localPatients[cleanUser.slice(-10)] ||
                t.metadata?.patient_name ||
                (isPhone ? `Patient +${cleanUser}` : `Patient #${t.id.slice(0, 6)}`);

            return {
                ...t,
                patient_name: resolvedName,
                patientName: resolvedName,
            };
        });
    }

    async findById(id: string): Promise<Thread | null> {
        const { data, error } = await this.supabase
            .from('conversation_threads')
            .select('*')
            .eq('id', id)
            .single();

        if (error || !data) return null;
        const [enriched] = await this.enrichThreadsWithPatientInfo([data]);
        return enriched || data;
    }

    /**
     * Enforced atomic update with version check.
     * EVERY update to conversation_threads must use: WHERE id = ? AND version = ?
     */
    async updateAtomic(id: string, version: number, updates: Partial<Thread>): Promise<Thread> {
        const { data, error } = await this.supabase
            .from('conversation_threads')
            .update({
                ...updates,
                version: version + 1,
                updated_at: new Date(),
            })
            .eq('id', id)
            .eq('version', version)
            .select();

        if (error) {
            this.logger.error(`Database error during atomic update for thread ${id}: ${error.message}`);
            throw error;
        }

        if (!data || data.length === 0) {
            this.logger.warn(`Concurrency conflict detected for thread ${id}. Expected version: ${version}`);
            throw new ConcurrencyException();
        }

        return data[0];
    }

    async create(thread: Partial<Thread>): Promise<Thread> {
        const { data, error } = await this.supabase
            .from('conversation_threads')
            .insert([thread])
            .select()
            .single();

        if (error) throw error;
        return data;
    }

    async findAll(): Promise<Thread[]> {
        const { data, error } = await this.supabase
            .from('conversation_threads')
            .select('*')
            .order('updated_at', { ascending: false });

        if (error) throw error;
        return this.enrichThreadsWithPatientInfo(data || []);
    }

    async findByStatus(status: string): Promise<Thread[]> {
        let statusList = [status];
        if (status === 'red') statusList = ['red', 'DOCTOR_ASSIGNED'];
        else if (status === 'yellow') statusList = ['yellow', 'NURSE_ASSIGNED'];
        else if (status === 'green') statusList = ['green', 'AI_ACTIVE'];

        const { data, error } = await this.supabase
            .from('conversation_threads')
            .select('*')
            .in('status', statusList)
            .order('updated_at', { ascending: false });

        if (error) throw error;
        return this.enrichThreadsWithPatientInfo(data || []);
    }

    async findFrontDeskQueue(): Promise<Thread[]> {
        const { data, error } = await this.supabase
            .from('conversation_threads')
            .select('*')
            .order('updated_at', { ascending: false });

        if (error) throw error;
        // Front desk handles active live tickets: WhatsApp escalations, support tickets, and urgent queues
        const filtered = (data || []).filter(t =>
            t.assigned_role === 'FRONT_DESK' ||
            t.assigned_role === 'SUPPORT_AGENT' ||
            t.assigned_role === 'RECEPTIONIST' ||
            t.channel === 'whatsapp' ||
            t.status === 'red' ||
            t.status === 'yellow'
        );
        return this.enrichThreadsWithPatientInfo(filtered);
    }
}
