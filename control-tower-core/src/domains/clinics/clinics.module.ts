import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

// Services
import { ClinicsSupabaseService } from './services/clinics-supabase.service';
import { ClinicsEncryptionService } from './services/clinics-encryption.service';
import { ClinicsUtilsService } from './services/clinics-utils.service';

// Guards
import { ClinicsAuthGuard } from './guards/clinics-auth.guard';

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

@Module({
    imports: [ConfigModule],
    providers: [
        ClinicsSupabaseService,
        ClinicsEncryptionService,
        ClinicsUtilsService,
        ClinicsAuthGuard,
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
    ],
    exports: [
        ClinicsSupabaseService,
        ClinicsEncryptionService,
        ClinicsUtilsService,
    ],
})
export class ClinicsModule {}
