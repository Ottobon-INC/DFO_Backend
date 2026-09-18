import { Module, Global } from '@nestjs/common';
import { ConsentController } from './consent.controller';
import { ConsentEnforcementService } from './consent-enforcement.service';
import { ConsentRepository } from './consent.repository';
import { EncryptionService } from '../../../infrastructure/security/encryption.service';

@Global()
@Module({
  controllers: [ConsentController],
  providers: [
    ConsentEnforcementService,
    ConsentRepository,
    EncryptionService,
  ],
  exports: [ConsentEnforcementService, ConsentRepository],
})
export class ConsentModule { }
