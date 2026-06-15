import { SupabaseClient } from '@supabase/supabase-js';
import { IntentClassifier } from './intent-classifier';
import { Gatekeeper } from './gatekeeper';
import { DataFetcher } from './data-fetcher';
import { Sanitizer } from './sanitizer';
import { Responder } from './responder';
import { ChatResponse, Intent, Role } from './types';
import { CheckInAction } from './actions/check-in';
import { MarkCompletedAction } from './actions/mark-completed';
import { MarkNoShowAction } from './actions/mark-no-show';
import { PendingActions } from './pending-actions';

export async function processUserMessage(
    supabase: SupabaseClient,
    decrypter: (text: string) => string,
    userId: string,
    role: Role | string,
    message: string,
    confirmationToken?: string
): Promise<ChatResponse> {
    const startTime = Date.now();
    let intent = Intent.UNKNOWN;
    let allowed = false;

    try {
        // =========================================================
        // STEP 6: BACKEND EXECUTION (NO LLM, NO CLASSIFICATION)
        // =========================================================
        if (confirmationToken) {
            const pendingAction = PendingActions.consumeToken(confirmationToken);

            if (!pendingAction) {
                return { reply: "This confirmation link has expired or is invalid. Please start over.", intent: Intent.UNKNOWN };
            }

            if (pendingAction.userId !== userId) {
                return { reply: "Unauthorized action.", intent: Intent.UNKNOWN };
            }

            if (pendingAction.actionType === Intent.ACTION_CHECK_IN_PATIENT) {
                const { appointmentId } = pendingAction.payload;
                const result = await CheckInAction.execute(supabase, appointmentId, userId, role);
                return {
                    reply: result.message,
                    intent: Intent.ACTION_CHECK_IN_PATIENT,
                };
            }
            if (pendingAction.actionType === Intent.ACTION_MARK_APPOINTMENT_COMPLETED) {
                const { appointmentId } = pendingAction.payload;
                const result = await MarkCompletedAction.execute(supabase, appointmentId, userId, role);
                return {
                    reply: result.message,
                    intent: Intent.ACTION_MARK_APPOINTMENT_COMPLETED,
                };
            }
            if (pendingAction.actionType === Intent.ACTION_MARK_PATIENT_NO_SHOW) {
                const { appointmentId } = pendingAction.payload;
                const result = await MarkNoShowAction.execute(supabase, appointmentId, userId, role);
                return {
                    reply: result.message,
                    intent: Intent.ACTION_MARK_PATIENT_NO_SHOW,
                };
            }
        }

        // =========================================================
        // STEP 2: INTENT CLASSIFICATION (LOCAL REGEX)
        // =========================================================
        const classification = await IntentClassifier.classify(message);
        intent = classification.intent;
        const searchHint = classification.searchHint;

        // =========================================================
        // STEP 3: RESOLUTION & SEARCH (LOCAL ONLY)
        // =========================================================
        if (intent === Intent.ACTION_CHECK_IN_PATIENT || intent === Intent.ACTION_MARK_APPOINTMENT_COMPLETED || intent === Intent.ACTION_MARK_PATIENT_NO_SHOW) {
            const authResult = Gatekeeper.authorize(role, intent);
            if (!authResult.allowed) {
                return { reply: authResult.reason || "Unauthorized.", intent };
            }

            if (!searchHint) {
                return { reply: "Who is the patient? Please provide a name.", intent };
            }

            let candidates: any[] = [];
            if (intent === Intent.ACTION_CHECK_IN_PATIENT) {
                candidates = await CheckInAction.search(supabase, searchHint);
            } else if (intent === Intent.ACTION_MARK_APPOINTMENT_COMPLETED) {
                candidates = await MarkCompletedAction.search(supabase, searchHint);
            } else if (intent === Intent.ACTION_MARK_PATIENT_NO_SHOW) {
                candidates = await MarkNoShowAction.search(supabase, searchHint);
            }

            if (candidates.length === 0) {
                return { reply: `I couldn't find any relevant appointments for "${searchHint}" from today or the last 3 days.`, intent };
            }

            // =========================================================
            // STEP 4: CONFIRMATION STATE (LOCAL ONLY)
            // =========================================================
            const options = candidates.map(c => {
                const token = PendingActions.createToken(userId, intent as any, { appointmentId: c.id });
                return {
                    label: `${c.patientName} – ${c.time} – ${c.doctorName} (${c.currentStatus})`,
                    token,
                };
            });

            return {
                reply: `I found ${candidates.length} match(es) for "${searchHint}". Please select the appointment:`,
                intent,
                actionRequired: true,
                options
            };
        }

        // =========================================================
        // STANDARD READ-ONLY FLOW
        // =========================================================
        const authResult = Gatekeeper.authorize(role, intent);
        allowed = authResult.allowed;

        if (!allowed) {
            return {
                reply: authResult.reason || "You are not authorized to perform this action.",
                intent
            };
        }

        if (intent === Intent.UNKNOWN) {
            const reply = await Responder.generateResponse(intent, null, message);
            return { reply, intent };
        }

        const rawData = await DataFetcher.fetchData(supabase, intent, role as Role, userId, decrypter);
        const sanitizedData = Sanitizer.sanitize(rawData, intent);
        const reply = await Responder.generateResponse(intent, sanitizedData, message);

        return { reply, intent };

    } catch (error: any) {
        console.error('Error in processUserMessage:', error);
        return {
            reply: "An internal error occurred while processing your request.",
            intent: Intent.UNKNOWN
        };
    }
}
