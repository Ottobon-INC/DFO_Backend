import { Module } from '@nestjs/common';
import { ClinicalIntelligenceController } from './clinical-intelligence.controller';
import { ClinicalIntelligenceService } from './clinical-intelligence.service';
import { ClinicalIntelligenceRepository } from './clinical-intelligence.repository';
import { EncryptionService } from '../../../infrastructure/security/encryption.service';
import { AuditService } from '../../../infrastructure/audit/audit.service';

@Module({
  controllers: [ClinicalIntelligenceController],
  providers: [
    ClinicalIntelligenceService,
    ClinicalIntelligenceRepository,
    EncryptionService
  ],
  exports: [ClinicalIntelligenceService],
})
export class ClinicalIntelligenceModule { }
