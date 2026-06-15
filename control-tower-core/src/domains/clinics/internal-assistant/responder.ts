import { Intent } from './types';

export class Responder {
    static async generateResponse(intent: Intent, data: any, userMessage: string = ""): Promise<string> {
        if (intent === Intent.UNKNOWN) {
            return "I'm sorry, I didn't understand that request. I can help you with stalling leads, today's appointments, waiting patients, or a clinic summary.";
        }

        if (!data) {
            return "I found no data matching your request.";
        }

        switch (intent) {
            case Intent.GET_STALLING_LEADS: {
                if (data.total_count === 0) {
                    return "Great news! There are currently no stalling leads in the system.";
                }

                let list = `Found **${data.total_count}** stalling lead(s):\n\n`;
                data.leads.forEach((lead: any, idx: number) => {
                    list += `${idx + 1}. **${lead.name}** (${lead.gender || 'N/A'}, Age: ${lead.age || 'N/A'}) - Inquiry: *${lead.inquiry || 'General Inquiry'}* (Added: ${new Date(lead.date_added).toLocaleDateString()})\n`;
                });
                return list;
            }

            case Intent.GET_TODAY_APPOINTMENTS: {
                const breakdownList = Object.entries(data.breakdown)
                    .map(([status, count]) => `- ${status}: **${count}**`)
                    .join('\n');

                return `📅 **Today's Appointments Summary**:\n` +
                       `- Total Appointments: **${data.total_count}**\n` +
                       `${breakdownList ? breakdownList : '- No status breakdown available'}`;
            }

            case Intent.GET_WAITING_PATIENTS: {
                return `⏳ **Queue Status**:\n` +
                       `- Patients Currently Waiting: **${data.total_waiting}**\n` +
                       `- Max Wait Time: **${data.max_wait_time_minutes} minutes**\n` +
                       `- Waiting >30 Mins: **${data.long_wait_count} patient(s)**`;
            }

            case Intent.GET_CLINIC_SUMMARY: {
                return `📊 **Clinic Summary (Today)**:\n` +
                       `- New Leads: **${data.total_leads_today}**\n` +
                       `- Total Appointments: **${data.total_appointments_today}**\n` +
                       `- Waiting Queue: **${data.total_waiting_patients}**\n` +
                       `- Stalling Leads: **${data.stalling_leads_count}**`;
            }

            default:
                return "Request processed successfully.";
        }
    }
}
