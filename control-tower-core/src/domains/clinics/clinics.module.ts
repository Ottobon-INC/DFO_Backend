import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

// Services
import { ClinicsSupabaseService } from './services/clinics-supabase.service';
import { ClinicsEncryptionService } from './services/clinics-encryption.service';
import { ClinicsUtilsService } from './services/clinics-utils.service';
import { DocumentsService } from './services/documents.service';
import { StaffCacheService } from './services/staff-cache.service';
import { RoomAllocationService } from './services/room-allocation.service';

// Guards
import { ClinicsAuthGuard } from './guards/clinics-auth.guard';

// Processors
import { AuditEventProcessor } from './listeners/audit-event.processor';
import { CacheEventProcessor } from './listeners/cache-event.processor';

// Controllers
import { AppointmentsController } from './controllers/appointments.controller';
import { AuthController } from './controllers/auth.controller';
import { ControlTowerController } from './controllers/control-tower.controller';
import { DashboardController } from './controllers/dashboard.controller';
import { InternalAssistantController } from './controllers/internal-assistant.controller';
import { KnowledgeController } from './controllers/knowledge.controller';
import { LeadsController } from './controllers/leads.controller';
import { PatientsController } from './controllers/patients.controller';
import { UsersController } from './controllers/users.controller';
import { SuperAdminController } from './controllers/super-admin.controller';
import { SuperAdminAuthController } from './controllers/super-admin-auth.controller';
import { PatientAuthController } from './controllers/patient-auth.controller';
import { PatientPortalController } from './controllers/patient-portal.controller';
import { StaffController } from './controllers/staff.controller';
import { DocumentsController } from './controllers/documents.controller';
import { AuditController } from './controllers/audit.controller';
import { RoomAllocationController } from './controllers/room-allocation.controller';

// Feature Modules
import { AwsModule } from '../../infrastructure/aws/aws.module';
import { BullModule } from '@nestjs/bullmq';

@Module({
    imports: [
        ConfigModule, 
        AwsModule,
        BullModule.registerQueue({ name: 'dfo_events_queue' }),
    ],
    providers: [
        ClinicsSupabaseService,
        ClinicsEncryptionService,
        ClinicsUtilsService,
        DocumentsService,
        StaffCacheService,
        ClinicsAuthGuard,
        AuditEventProcessor,
        CacheEventProcessor,
        RoomAllocationService,
    ],
    controllers: [
        AppointmentsController,
        AuthController,
        ControlTowerController,
        DashboardController,
        InternalAssistantController,
        KnowledgeController,
        LeadsController,
        PatientsController,
        UsersController,
        SuperAdminController,
        SuperAdminAuthController,
        PatientAuthController,
        PatientPortalController,
        StaffController,
        DocumentsController,
        AuditController,
        RoomAllocationController,
    ],
    exports: [
        ClinicsSupabaseService,
        ClinicsEncryptionService,
        ClinicsUtilsService,
        DocumentsService,
        StaffCacheService,
        RoomAllocationService,
    ],
})
export class ClinicsModule {}
