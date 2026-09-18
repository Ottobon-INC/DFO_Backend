import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ClinicsAuthGuard } from '../domains/clinics/guards/clinics-auth.guard';

@Controller('debug')
@UseGuards(ClinicsAuthGuard)
export class DebugController {
    @Get('ping')
    ping() {
        return { message: 'pong', status: 'alive' };
    }

    @Post('test')
    test() {
        return { message: 'post-working' };
    }

    @Get('tenant')
    checkTenant() {
        // This will fetch the tenant details from the global context!
        const state = require('../infrastructure/context/tenant.context').TenantContext.getState();
        return {
            success: true,
            tenant_context: state || 'No context found. Did you send a valid JWT?',
        };
    }
}
