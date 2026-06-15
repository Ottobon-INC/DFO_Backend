import { Intent } from './types';

export class IntentClassifier {
    static async classify(message: string): Promise<{ intent: Intent; searchHint?: string }> {
        const text = message.toLowerCase().trim();

        // 1. Check-in actions
        if (text.includes('check-in') || text.includes('check in') || text.includes('arrived')) {
            const name = this.extractPatientName(message, ['check-in', 'check in', 'arrived', 'patient']);
            return { intent: Intent.ACTION_CHECK_IN_PATIENT, searchHint: name };
        }

        // 2. Mark completed actions
        if (text.includes('complete') || text.includes('completed') || text.includes('finish') || text.includes('done')) {
            const name = this.extractPatientName(message, ['complete', 'completed', 'finish', 'done', 'mark', 'appointment', 'patient']);
            return { intent: Intent.ACTION_MARK_APPOINTMENT_COMPLETED, searchHint: name };
        }

        // 3. Mark no show actions
        if (text.includes('no show') || text.includes('no-show') || text.includes('absent') || text.includes('missed')) {
            const name = this.extractPatientName(message, ['no show', 'no-show', 'absent', 'missed', 'mark', 'appointment', 'patient']);
            return { intent: Intent.ACTION_MARK_PATIENT_NO_SHOW, searchHint: name };
        }

        // 4. Stalling leads
        if (
            text.includes('stalling leads') || 
            text.includes('stuck leads') || 
            text.includes('stuck') || 
            text.includes('stalling') || 
            text.includes('old leads') ||
            text === 'leads'
        ) {
            return { intent: Intent.GET_STALLING_LEADS };
        }

        // 5. Today's appointments
        if (
            text.includes('today\'s appointments') || 
            text.includes('appointments today') || 
            text.includes('schedule') || 
            text.includes('appointments') ||
            text === 'appointment'
        ) {
            return { intent: Intent.GET_TODAY_APPOINTMENTS };
        }

        // 6. Waiting patients
        if (
            text.includes('waiting list') || 
            text.includes('waiting patients') || 
            text.includes('queue') || 
            text.includes('waiting') ||
            text === 'patients' ||
            text === 'patient'
        ) {
            return { intent: Intent.GET_WAITING_PATIENTS };
        }

        // 7. Clinic summary
        if (
            text.includes('clinic summary') || 
            text.includes('dashboard summary') || 
            text.includes('overview') || 
            text.includes('summary')
        ) {
            return { intent: Intent.GET_CLINIC_SUMMARY };
        }

        return { intent: Intent.UNKNOWN };
    }

    private static extractPatientName(msg: string, keywords: string[]): string {
        let clean = msg;
        // Remove keywords case-insensitively
        keywords.forEach(kw => {
            const regex = new RegExp(`\\b${kw}\\b`, 'gi');
            clean = clean.replace(regex, '');
        });
        
        // Remove common punctuation and trim
        return clean.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, "").replace(/\s+/g, " ").trim();
    }
}
