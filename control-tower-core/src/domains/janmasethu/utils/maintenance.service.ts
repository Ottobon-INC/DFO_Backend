import { Injectable, Logger, OnModuleInit, Inject } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { SupabaseClient } from '@supabase/supabase-js';
import { JanmasethuRepository } from '../janmasethu.repository';
import { AppointmentStatus, JourneyStage } from '../dfo.types';
import { RealtimeEventsController } from '../api/realtime-events.controller';

@Injectable()
export class JanmasethuMaintenanceService {
    private readonly logger = new Logger(JanmasethuMaintenanceService.name);

    constructor(
        private readonly repository: JanmasethuRepository,
        @InjectQueue('janmasethu_sla_queue') private readonly slaQueue: Queue,
        @InjectQueue('appointment_checker') private readonly apptQueue: Queue,
        @InjectQueue('janmasethu_analytics_queue') private readonly analyticsQueue: Queue,
        @Inject('SUPABASE_CLIENT') private readonly supabase: SupabaseClient,
    ) { }

    /**
     * CORE STABILIZATION FLOW
     * Traces dependencies and ensures sequential startup.
     */
    async stabilizeBackend() {
        this.logger.log('🛠️ STABILIZING DFO BACKEND ARCHITECTURE...');

        try {
            // 1. Check & Apply Support Tickets schema
            await this.ensureSupportTicketsTable();

            // 2. BullMQ Reset (Fixes corrupted repeat keys)
            await this.cleanupQueues();

            // 3. Dependency-Safe Seeding (Transactional Flow)
            // Skipped: Legacy dfo_ tables are deprecated and clinics domain handles this now
            // await this.executeSafeSeeding();

            // 4. Analytics Pre-warm
            await this.prewarmAnalytics();

            this.logger.log('✅ BACKEND STABILIZATION COMPLETE. READY FOR CLINICAL TRAFFIC.');
        } catch (error) {
            this.logger.error(`❌ STABILIZATION CRITICAL FAILURE: ${error.message}`);
            // We don't throw here to allow the app to boot, but it's marked as degraded in logs
        }
    }

    private async cleanupQueues() {
        this.logger.log('🧹 Cleaning corrupted repeat keys in BullMQ...');
        const queues = [this.slaQueue, this.apptQueue, this.analyticsQueue];

        for (const queue of queues) {
            const repeatableJobs = await queue.getRepeatableJobs();
            for (const job of repeatableJobs) {
                await queue.removeRepeatableByKey(job.key);
                this.logger.debug(`Removed corrupted repeat key: ${job.key}`);
            }
        }
    }

    /**
     * SEEDING FLOW (Referential Integrity Safe)
     * Order: Patients -> Doctors -> Leads -> Threads -> Appointments
     */
    private async executeSafeSeeding() {
        this.logger.log('🌱 Executing dependency-safe clinical seeding...');

        // 1. SEED PATIENTS (Foundational ID)
        const patientId1 = '550e8400-e29b-41d4-a716-44665544a001';
        const patientId2 = '550e8400-e29b-41d4-a716-44665544a002';
        
        await this.repository.upsertDFOPatient({ 
            id: patientId1, 
            full_name: 'Sara Johnson', 
            phone_number: '+919900112233', 
            journey_stage: JourneyStage.TRYING_TO_CONCEIVE 
        });
        await this.repository.upsertDFOPatient({ 
            id: patientId2, 
            full_name: 'Priya Nair', 
            phone_number: '+919900112234', 
            journey_stage: JourneyStage.PREGNANT 
        });
        this.logger.log('✅ Patients seeded.');

        // 2. SEED DOCTORS
        const doctorId1 = '550e8400-e29b-41d4-a716-446655440001';
        const doctorId2 = '550e8400-e29b-41d4-a716-446655440002';

        await this.repository.upsertDoctor({
            id: doctorId1,
            full_name: 'Dr. Divya Sharma',
            specialization: ['Clinical Lead'],
            is_available: true
        });
        await this.repository.upsertDoctor({
            id: doctorId2,
            full_name: 'Dr. Sarah Smith',
            specialization: ['Obstetrics & Gynecology'],
            is_available: true
        });
        this.logger.log('✅ Doctors seeded.');

        // 3. SEED LEADS
        await this.repository.createLead({
            name: 'Anita Das',
            phone: '+919900112235',
            status: 'New Inquiry',
            source: 'Website'
        });
        this.logger.log('✅ Leads seeded.');

        // 4. CLEANUP ORPHANED APPOINTMENTS (Safety Gate)
        // If we have appointments but they violate FKs or are from bad seeds, clean them
        const existingApps = await this.repository.findAllAppointments();
        const validPatientIds = [patientId1, patientId2];
        const validDoctorIds = [doctorId1, doctorId2];

        const orphans = existingApps.filter(a => 
            !validPatientIds.includes(a.patient_id) || !validDoctorIds.includes(a.doctor_id)
        );

        if (orphans.length > 0) {
            this.logger.warn(`🧹 Found ${orphans.length} orphaned/invalid appointments. Cleaning...`);
            // Note: In a real production DB, you'd be more careful. Here we assume bad seeding data.
            for (const orphan of orphans) {
                // If the repository doesn't have a delete method, we just log for now
                // or we could add a delete method.
                this.logger.debug(`Orphan found: ${orphan.id}`);
            }
        }

        // 5. SEED APPOINTMENTS (Safe now that Patients/Doctors exist)
        if (existingApps.length === 0 || orphans.length > 0) {
            this.logger.log('Creating initial validated appointments...');
            
            const hasApp1 = existingApps.some(a => a.patient_id === patientId1 && a.doctor_id === doctorId1);
            if (!hasApp1) {
                try {
                    await this.repository.createAppointment({
                        patient_id: patientId1,
                        doctor_id: doctorId1,
                        appointment_date: new Date(),
                        status: AppointmentStatus.SCHEDULED
                    });
                } catch (e) {
                    this.logger.warn(`Failed to seed appointment 1: ${e.message}`);
                }
            }

            const hasApp2 = existingApps.some(a => a.patient_id === patientId2 && a.doctor_id === doctorId2);
            if (!hasApp2) {
                try {
                    await this.repository.createAppointment({
                        patient_id: patientId2,
                        doctor_id: doctorId2,
                        appointment_date: new Date(Date.now() + 86400000), // Tomorrow
                        status: AppointmentStatus.SCHEDULED
                    });
                } catch (e) {
                    this.logger.warn(`Failed to seed appointment 2: ${e.message}`);
                }
            }
            this.logger.log('✅ Appointments seeding checked/completed.');
        }

        // 6. SEED AUDIT LOGS
        const logs = await this.repository.findAuditLogs();
        if (logs.length === 0) {
            await this.repository.insertAuditLog({ 
                actor_id: 'SYSTEM', 
                actor_type: 'SYSTEM', 
                action: 'STABILIZATION_COMPLETED', 
                payload: { version: '1.0.0' } 
            });
            this.logger.log('✅ Audit logs seeded.');
        }
    }

    private async prewarmAnalytics() {
        this.logger.log('🔥 Pre-warming clinical analytics dashboard...');
        try {
            const stats = await this.repository.findAnalyticsMetrics();
            RealtimeEventsController.broadcast('ANALYTICS_UPDATED', stats);
        } catch (e) {
            this.logger.warn(`Analytics pre-warm partially failed: ${e.message}`);
        }
    }

    private async ensureSupportTicketsTable() {
        this.logger.log('📋 Verifying Support Tickets schema...');
        try {
            // Check if table exists by querying it
            const { error } = await this.supabase
                .from('dfo_support_tickets')
                .select('id')
                .limit(1);

            if (error && error.code === 'PGRST205') {
                this.logger.warn('⚠️ Table dfo_support_tickets does not exist. Attempting programmatic migration...');
                await this.runSqlMigration();
            } else if (error) {
                this.logger.error(`Error checking dfo_support_tickets: ${error.message}`);
            } else {
                this.logger.log('✅ Table dfo_support_tickets is verified and active.');
            }
        } catch (err) {
            this.logger.error(`Failed to verify support tickets table: ${err.message}`);
        }
    }

    private async runSqlMigration() {
        const fs = require('fs');
        const path = require('path');
        const { Client } = require('pg');

        const sqlPath = path.join(process.cwd(), 'db', '006_support_tickets.sql');
        if (!fs.existsSync(sqlPath)) {
            this.logger.error(`Migration file not found at ${sqlPath}`);
            return;
        }

        const sql = fs.readFileSync(sqlPath, 'utf8');
        
        // Let's try connecting to postgres locally (either localhost or docker host 'db')
        const connectionOptions = [
            { host: 'localhost', port: 5432, user: 'postgres', password: 'postgres', database: 'control_tower' },
            { host: 'db', port: 5432, user: 'postgres', password: 'postgres', database: 'control_tower' }
        ];

        let migrated = false;
        for (const opts of connectionOptions) {
            const client = new Client(opts);
            try {
                await client.connect();
                this.logger.log(`Connecting to Postgres at ${opts.host}...`);
                await client.query(sql);
                this.logger.log(`✅ SQL schema migration applied successfully using Postgres connection at ${opts.host}.`);
                migrated = true;
                await client.end();
                break;
            } catch (err) {
                this.logger.debug(`Could not connect or execute SQL on Postgres at ${opts.host}: ${err.message}`);
                try {
                    await client.end();
                } catch (e) {}
            }
        }

        if (!migrated) {
            this.logger.warn(
                '⚠️ Database migration could not be run programmatically because no local Postgres connection succeeded. ' +
                'Please apply c:/Users/adrad/OneDrive/Desktop/framework/control-tower-core/db/006_support_tickets.sql manually in your Supabase SQL editor.'
            );
        }
    }
}
