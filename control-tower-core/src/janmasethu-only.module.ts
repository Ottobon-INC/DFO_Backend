import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { DatabaseModule } from './infrastructure/database.module';
import { JanmasethuModule } from './domains/janmasethu/janmasethu.module';
import { KernelModule } from './kernel/kernel.module';

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
            load: [configuration],
            envFilePath: '.env',
        }),
        DatabaseModule,
        JanmasethuModule,
        KernelModule,
    ],
})
export class JanmasethuOnlyModule { }
