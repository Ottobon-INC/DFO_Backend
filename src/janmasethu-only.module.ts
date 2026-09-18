import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { DatabaseModule } from './infrastructure/database.module';
import { JanmasethuModule } from './domains/janmasethu/janmasethu.module';
import { ClinicsModule } from './domains/clinics/clinics.module';
import { KernelModule } from './kernel/kernel.module';
import { ThreadController } from './api/thread.controller';
import { SchedulesController } from './domains/clinics/controllers/schedules.controller';

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
            load: [configuration],
            envFilePath: '.env',
        }),
        DatabaseModule,
        JanmasethuModule,
        ClinicsModule,
        KernelModule,
    ],
    controllers: [
        ThreadController,
        SchedulesController,
    ],
})
export class JanmasethuOnlyModule { }
