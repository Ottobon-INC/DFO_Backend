import { Module } from '@nestjs/common';
import { VitalsController } from './vitals.controller';
import { VitalsService } from './vitals.service';
import { VitalsRepository } from './vitals.repository';
import { AlertingModule } from '../alerting/alerting.module';
import { InfrastructureAuditModule } from '../../../infrastructure/audit/audit.service';
import { EncryptionService } from '../../../infrastructure/security/encryption.service';

@Module({
  imports: [AlertingModule, InfrastructureAuditModule],
  controllers: [VitalsController],
  providers: [
    VitalsService,
    VitalsRepository,
    EncryptionService,
  ],
  exports: [VitalsService],
})
export class VitalsModule { }
