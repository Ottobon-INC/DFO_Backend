import { Module } from '@nestjs/common';
import { SupportEngagementService } from './support-engagement.service';
import { SupportEngagementController } from './support-engagement.controller';
import { JanmasethuRepositoryModule } from '../janmasethu-repository.module';
import { AuthModule } from '../auth/auth.module';

@Module({
    imports: [
        JanmasethuRepositoryModule,
        AuthModule,
    ],
    providers: [
        SupportEngagementService,
    ],
    controllers: [
        SupportEngagementController,
    ],
    exports: [
        SupportEngagementService,
    ],
})
export class SupportEngagementModule {}
