export const DFO_EVENTS = {
  // Documents
  DOCUMENT_REGISTERED: 'document.registered',
  DOCUMENT_ASSIGNED: 'document.assigned',
  DOCUMENT_UNASSIGNED: 'document.unassigned',
  DOCUMENT_DELETED: 'document.deleted',
  DOCUMENT_ASSIGNED_NEW_PATIENT: 'document.assignedWithNewPatient',

  // Patients
  PATIENT_CREATED: 'patient.created',
  PATIENT_UPDATED: 'patient.updated',
  PATIENT_DOCUMENT_UPLOADED: 'patient.document.uploaded',
  PATIENT_NOTE_CREATED: 'patient.note.created',
  PATIENT_PIN_RESET: 'patient.pin.reset',

  // Appointments
  APPOINTMENT_CREATED: 'appointment.created',
  APPOINTMENT_UPDATED: 'appointment.updated',
  APPOINTMENT_STATUS_CHANGED: 'appointment.statusChanged',

  // Room Allocation
  ADMISSION_CREATED: 'admission.created',
  ADMISSION_DISCHARGED: 'admission.discharged',
  ADMISSION_CANCELLED: 'admission.cancelled',
  ADMISSION_TRANSFERRED: 'admission.transferred',
  BED_TRANSFERRED: 'bed.transferred',

  // Leads
  LEAD_CREATED: 'lead.created',
  LEAD_BULK_IMPORTED: 'lead.bulkImported',
  LEAD_UPDATED: 'lead.updated',
  LEAD_REENGAGED: 'lead.reEngaged',

  // Staff & Users
  STAFF_ASSIGNED: 'staff.assigned',
  STAFF_UNASSIGNED: 'staff.unassigned',
  USER_CREATED: 'user.created',
  USER_UPDATED: 'user.updated',
  USER_REMOVED: 'user.removed',

  // Auth
  AUTH_LOGIN: 'auth.login',
  AUTH_LOGIN_FAILED: 'auth.loginFailed',
  AUTH_PASSWORD_CHANGED: 'auth.passwordChanged',
  AUTH_PROFILE_UPDATED: 'auth.profileUpdated',
} as const;
