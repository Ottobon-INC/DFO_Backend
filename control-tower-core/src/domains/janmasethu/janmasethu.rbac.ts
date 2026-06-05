import { Injectable } from '@nestjs/common';
import { JanmasethuUserRole, JanmasethuPermission, JanmasethuUserContext } from './janmasethu.types';
import { Thread } from '../../types';
import { JanmasethuScopePolicy } from './JanmasethuScopePolicy';

@Injectable()
export class JanmasethuRbacService {
    private readonly permissionMatrix: Record<JanmasethuUserRole, JanmasethuPermission[]> = {
        [JanmasethuUserRole.CRO]: [
            JanmasethuPermission.VIEW_THREAD,
            JanmasethuPermission.ASSIGN_THREAD,
            JanmasethuPermission.TAKE_CONTROL,
            JanmasethuPermission.REPLY,
            JanmasethuPermission.OVERRIDE_SLA,
            JanmasethuPermission.VIEW_PII,
        ],
        [JanmasethuUserRole.DOCTOR]: [
            JanmasethuPermission.VIEW_THREAD,
            JanmasethuPermission.TAKE_CONTROL,
            JanmasethuPermission.REPLY,
            JanmasethuPermission.VIEW_PII,
        ],
        [JanmasethuUserRole.NURSE]: [
            JanmasethuPermission.VIEW_THREAD,
            JanmasethuPermission.TAKE_CONTROL,
            JanmasethuPermission.REPLY,
        ],
    };

    constructor(private readonly scopePolicy: JanmasethuScopePolicy) {}

    hasPermission(role: JanmasethuUserRole, permission: JanmasethuPermission): boolean {
        return this.permissionMatrix[role]?.includes(permission) || false;
    }

    canViewThread(user: JanmasethuUserContext, thread: Thread): boolean {
        if (!this.hasPermission(user.role, JanmasethuPermission.VIEW_THREAD)) return false;

        // Enforce symmetrical status visibility logic with Scope Policy
        if (!this.scopePolicy.canView(user, thread)) return false;

        if (user.role === JanmasethuUserRole.CRO) return true;

        if (user.role === JanmasethuUserRole.DOCTOR) {
            return thread.assigned_user_id === user.id || thread.assigned_role === 'DOCTOR_QUEUE';
        }

        if (user.role === JanmasethuUserRole.NURSE) {
            return thread.assigned_user_id === user.id || thread.assigned_role === 'NURSE_QUEUE';
        }

        return false;
    }

    canAssign(user: JanmasethuUserContext): boolean {
        return this.hasPermission(user.role, JanmasethuPermission.ASSIGN_THREAD);
    }

    canTakeControl(user: JanmasethuUserContext, thread: Thread): boolean {
        if (!this.hasPermission(user.role, JanmasethuPermission.TAKE_CONTROL)) return false;

        // Enforce strict assignment match constraint symmetrically
        if (thread.assigned_user_id !== user.id) return false;

        return this.scopePolicy.canTakeControl(user, thread);
    }

    canReply(user: JanmasethuUserContext, thread: Thread): boolean {
        if (!this.hasPermission(user.role, JanmasethuPermission.REPLY)) return false;

        // Clinicians must be assigned to reply
        if (user.role !== JanmasethuUserRole.CRO && thread.assigned_user_id !== user.id) return false;

        const status = thread.status as string;

        // CRO can reply to red and yellow
        if (user.role === JanmasethuUserRole.CRO) {
            return ['red', 'yellow'].includes(status);
        }

        if (user.role === JanmasethuUserRole.DOCTOR) {
            return status === 'red';
        }

        if (user.role === JanmasethuUserRole.NURSE) {
            return ['yellow', 'red'].includes(status);
        }

        return false;
    }

    canViewPII(user: JanmasethuUserContext): boolean {
        return this.hasPermission(user.role, JanmasethuPermission.VIEW_PII);
    }
}
