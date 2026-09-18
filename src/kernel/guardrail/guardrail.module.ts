import { Module, forwardRef } from '@nestjs/common';
import { GuardrailService } from './guardrail.service';
import { AuditModule } from '../audit/audit.module';

@Module({
    imports: [
        AuditModule,
    ],
    providers: [GuardrailService],
    exports: [GuardrailService],
})
export class GuardrailModule { }
