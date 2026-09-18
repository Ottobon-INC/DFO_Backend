import { Injectable } from '@nestjs/common';
import { JanmasethuUserRole, JanmasethuUserContext, JanmasethuRole } from './janmasethu.types';
import { Thread, OwnershipType, ThreadStatus } from '../../types';
import { InvalidTransitionError } from '../../infrastructure/exceptions';

@Injectable()
export class JanmasethuScopePolicy {

    /**
     * VISIBILITY ENFORCEMENT
     * CRO: All janmasethu threads
     * DOCTOR: status = 'red'
     * NURSE: status = 'yellow'
     */
    canView(user: JanmasethuUserContext, thread: Thread): boolean {
        if (user.role === JanmasethuUserRole.CRO) return true;

        const status = thread.status as string;

        if (user.role === JanmasethuUserRole.DOCTOR) {
            return status === 'red';
        }

        if (user.role === JanmasethuUserRole.NURSE) {
            return ['yellow', 'red'].includes(status);
        }

        return false;
    }

    /**
     * TAKE CONTROL RULES
     * - ownership = HUMAN
     * - is_locked = true
     * - assigned_user_id must already match user
     */
    canTakeControl(user: JanmasethuUserContext, thread: Thread): boolean {
        // Must be assigned to the user first before they can take control
        if (thread.assigned_user_id !== user.id) return false;

        const status = thread.status as string;

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

    /**
     * ASSIGNMENT RULES
     * - RED -> DOCTOR_QUEUE only
     * - YELLOW -> NURSE_QUEUE only
     */
    validateAssignment(targetRole: JanmasethuRole, threadStatus: string): boolean {
        if (threadStatus === 'red' || threadStatus === 'yellow') {
            return targetRole === JanmasethuRole.DOCTOR_QUEUE || targetRole === JanmasethuRole.NURSE_QUEUE;
        }
        return false;
    }

    /**
     * FINAL AI SUPPRESSION RULE
     * AI must NOT respond if:
     * - status IN ('yellow', 'red')
     * - OR ownership = HUMAN
     * - OR is_locked = true
     */
    shouldSuppressAI(thread: Thread): boolean {
        const status = thread.status as string;
        const isEmergency = ['yellow', 'red'].includes(status);
        const isHumanOwned = thread.ownership === OwnershipType.HUMAN;
        const isLocked = thread.is_locked;

        return isEmergency || isHumanOwned || isLocked;
    }

    /**
     * SLA RULES
     * Start SLA ONLY when:
     * - status = red
     * - AND assigned_user_id != null
     */
    shouldStartSLA(thread: Thread): boolean {
        const status = thread.status as string;
        // Start SLA for both RED and YELLOW if assigned to a clinician
        return ['red', 'yellow'].includes(status) && !!thread.assigned_user_id;
    }

    /**
     * STATE TRANSITION ACTIONS (FINAL)
     */
    getTransitionActions(previousStatus: string, newStatus: string) {
        /**
         * EXPLICIT SEVERITY DOWNGRADE POLICY
         * There is NO automatic RED -> YELLOW downgrade.
         * Blocked transition: RED -> YELLOW -> throw InvalidTransitionError
         */
        if (previousStatus === 'red' && newStatus === 'yellow') {
            throw new InvalidTransitionError('Security Violation: Medical severity downgrade from RED to YELLOW is prohibited.');
        }

        // YELLOW -> RED (Upgrade)
        if (previousStatus === 'yellow' && newStatus === 'red') {
            return {
                clearAssignment: true, // assigned_user_id = null
                unlockThread: true,    // ownership = AI, is_locked = false
                targetRole: JanmasethuRole.DOCTOR_QUEUE,
                cancelSla: true,
                notifyCRO: true
            };
        }

        // RED/YELLOW -> GREEN (Resolution)
        if (['red', 'yellow'].includes(previousStatus) && newStatus === 'green') {
            return {
                clearAssignment: true,
                unlockThread: true,
                targetRole: null,
                cancelSla: true,
                notifyCRO: false,
                clearAlerts: true
            };
        }

        // GREEN -> YELLOW
        if (previousStatus === 'green' && newStatus === 'yellow') {
            return {
                targetRole: JanmasethuRole.NURSE_QUEUE,
                notifyCRO: true // CRO notified on Yellow creation
            };
        }

        // GREEN -> RED
        if (previousStatus === 'green' && newStatus === 'red') {
            return {
                targetRole: JanmasethuRole.DOCTOR_QUEUE,
                notifyCRO: true // CRO notified on Red creation
            };
        }

        return null;
    }
}
