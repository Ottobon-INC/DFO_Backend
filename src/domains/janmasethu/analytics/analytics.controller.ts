import { Controller, Get, Post, Headers, UnauthorizedException, Logger, ForbiddenException, UseGuards, Request } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { JanmasethuRbacService } from '../janmasethu.rbac';
import { JanmasethuAuditService } from '../janmasethu.audit.service';
import { JanmasethuUserRole, JanmasethuUserContext } from '../janmasethu.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

/**
 * AnalyticsController
 *
 * Exposes the hardened DFO Dashboard endpoints.
 * Logic: Read from precomputed JSON Cache (optimized for performance).
 */
@Controller('janmasethu/analytics')
@UseGuards(JwtAuthGuard)
export class AnalyticsController {
    private readonly logger = new Logger(AnalyticsController.name);

    constructor(
        private readonly analytics: AnalyticsService,
        private readonly rbac: JanmasethuRbacService,
        private readonly audit: JanmasethuAuditService,
    ) { }

    private getUserContext(req: any): JanmasethuUserContext {
        const user = req.user;
        if (!user) throw new UnauthorizedException('Missing clinician headers');
        return { id: user.id, role: user.role };
    }

    /**
     * GET /janmasethu/analytics/dashboard
     * 
     * Core dashboard API. High-performance (Cache Read).
     * Accessible by DOCTOR and ADMIN.
     */
    @Get('dashboard')
    async getDashboardStats(@Request() req: any) {
        const ctx = this.getUserContext(req);

        // RBAC: Only Doctors and Admins allowed on dashboard analytics
        if (ctx.role === JanmasethuUserRole.NURSE) {
            throw new ForbiddenException('Nurses are restricted from the executive dashboard.');
        }

        this.logger.log(`📊 Stats requested by ${ctx.id} (${ctx.role})`);

        // Log the PII-free access to analytics audit ledger
        await this.audit.logPIIAccess(ctx.id, ctx.role, 'DASHBOARD', 'VIEWED_ANALYTICS');

        return this.analytics.getCachedDashboardStats();
    }

    /**
     * POST /janmasethu/analytics/refresh
     * 
     * Manual override to force recalculation (bypass 60s window).
     * Admin only.
     */
    @Post('refresh')
    async forceRefresh(@Request() req: any) {
        const ctx = this.getUserContext(req);

        if (ctx.role !== JanmasethuUserRole.DOCTOR) {
            throw new ForbiddenException('Manual refresh restricted to lead physicians.');
        }

        return this.analytics.recalculateAllMetrics();
    }
}
