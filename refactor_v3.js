const fs = require('fs');
const path = require('path');

const tablesList = "Appointment,AppointmentReminderLog,AuditLog,ChatMessage,ConversationMapping,Department,Doctor,DoctorLeave,DoctorNotification,DoctorPreferences,DoctorSchedule,DoctorScheduleOverride,FAQ,HolidayCalendar,Hospital,HospitalClosure,KnowledgeBase,NotificationLog,NotificationTemplate,Patient,PatientFollowUp,Prescription,PrescriptionDownload,PrescriptionItem,PrescriptionTemplate,Report,SupportTicket,TicketNote,User,WhatsAppChannel,alembic_version,appointment_slots,appointments,approved_rules,audit_logs,automation_audit_log,automation_audit_logs,automation_chat_message,automation_conversation_mapping,automation_doctor_leave,automation_doctor_schedule,automation_doctor_schedule_override,automation_events,automation_hospital,automation_hospital_closure,automation_integration_configs,automation_jobs,automation_knowledge_base,automation_locks,automation_metrics,automation_notification_log,automation_notification_template,automation_partner_clinic,automation_patient_follow_up,automation_plugin_registry,automation_queue_tokens,automation_referral_attribution,automation_report,automation_rules,automation_subscription_plan,automation_support_ticket,automation_tenant_plugins,automation_whatsapp_channel,automation_workflow_graphs,automation_workflow_registry,branches,clinic_staff,clinical_analyses,clinics,clinics_coverage,conversation_messages,conversation_sessions,conversation_threads,data_access_audit,dead_letter_queue,departments,dfo_appointments,dfo_clinician_workload,dfo_medical_reports,dfo_notification_logs,dfo_prescriptions,dfo_risk_logs,dfo_summaries,dfo_support_tickets,doctor_branches,doctor_departments,doctor_schedules,doctor_slot_config,doctors,feedback_configuration,feedback_questions,follow_ups,google_review_configuration,guardrail_evaluations,hospital_booking_config,hospital_workflow_config,notification_logs,patient_abha,patient_consents,patient_feedback,patients,qms_audit_logs,qms_notifications_outbox,routing_events,sakhi_audit_logs,sakhi_chat_states,sakhi_clinic_admissions,sakhi_clinic_allergies,sakhi_clinic_appointments,sakhi_clinic_availability_slots,sakhi_clinic_bed_assignments,sakhi_clinic_beds,sakhi_clinic_demo_requests,sakhi_clinic_doctor_leaves,sakhi_clinic_doctor_schedules,sakhi_clinic_documents,sakhi_clinic_follow_ups,sakhi_clinic_leads,sakhi_clinic_medical_history,sakhi_clinic_patient_notes,sakhi_clinic_patient_timeline_view,sakhi_clinic_patient_vitals,sakhi_clinic_patients,sakhi_clinic_phi_access_logs,sakhi_clinic_prescriptions,sakhi_clinic_room_categories,sakhi_clinic_rooms,sakhi_clinic_treatments,sakhi_clinic_users,sakhi_clinical_notes,sakhi_clinical_rules,sakhi_conversations_new,sakhi_encrypted_chats,sakhi_escalations,sakhi_gynec_records,sakhi_ivf_baseline_usg,sakhi_ivf_cycles,sakhi_ivf_female_profile,sakhi_ivf_lab_panels,sakhi_ivf_male_profile,sakhi_ivf_procedures,sakhi_ivf_semen_analysis,sakhi_ivf_stimulation_sheet,sakhi_ivf_treatment_tracking,sakhi_knowledge_hub,sakhi_medical_dictionary,sakhi_medical_knowledge,sakhi_pii_vault,sakhi_users,sentiment_evaluations,services,staging_rules,super_admins,system_state,tenant_configs,tenant_sequences,thread_routing_events,transient_tickets,workflow_registry";

const tables = tablesList.split(',');

function processDirectory(dir) {
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            if (fullPath.includes('node_modules') || fullPath.includes('.git') || fullPath.includes('dist') || fullPath.includes('.next')) continue;
            processDirectory(fullPath);
        } else if (fullPath.endsWith('.ts') || fullPath.endsWith('.tsx') || fullPath.endsWith('.js') || fullPath.endsWith('.jsx')) {
            let content = fs.readFileSync(fullPath, 'utf8');
            let original = content;
            
            for (const table of tables) {
                // Fix upsertSection calls
                const upsertRegex = new RegExp(`(upsertSection\\(client,\\s*['"\`])${table}(['"\`])`, 'g');
                content = content.replace(upsertRegex, `$1opdesk_${table}$2`);
            }
            
            if (content !== original) {
                fs.writeFileSync(fullPath, content);
                console.log('Updated: ' + fullPath);
            }
        }
    }
}

console.log('Starting Refactor V3...');
processDirectory('./src');
console.log('Done.');
