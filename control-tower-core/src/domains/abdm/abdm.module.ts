import { Module } from '@nestjs/common';
import { AbdmService } from './abdm.service';
import { AbdmController } from './abdm.controller';

import { ClinicsModule } from '../clinics/clinics.module';

@Module({
    imports: [ClinicsModule],
    controllers: [AbdmController],
    providers: [AbdmService],
    exports: [AbdmService], // Exported for other modules to use ABDM services internally
})
export class AbdmModule {}
