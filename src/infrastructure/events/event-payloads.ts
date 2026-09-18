export class BaseEvent {
  constructor(
    public readonly clinicId: string,
    public readonly actorId: string | null | undefined,
    public readonly timestamp: string = new Date().toISOString(),
  ) {}
}

export class DocumentEvent extends BaseEvent {
  constructor(
    clinicId: string,
    actorId: string | null | undefined,
    public readonly documentId: string,
    public readonly payload?: Record<string, any>,
  ) { 
    super(clinicId, actorId); 
  }
}

export class PatientEvent extends BaseEvent {
  constructor(
    clinicId: string,
    actorId: string | null | undefined,
    public readonly patientId: string,
    public readonly payload?: Record<string, any>,
  ) {
    super(clinicId, actorId);
  }
}

export class AppointmentEvent extends BaseEvent {
  constructor(
    clinicId: string,
    actorId: string | null | undefined,
    public readonly appointmentId: string,
    public readonly payload?: Record<string, any>,
  ) {
    super(clinicId, actorId);
  }
}

export class AdmissionEvent extends BaseEvent {
  constructor(
    clinicId: string,
    actorId: string | null | undefined,
    public readonly admissionId: string,
    public readonly payload?: Record<string, any>,
  ) {
    super(clinicId, actorId);
  }
}

export class LeadEvent extends BaseEvent {
  constructor(
    clinicId: string,
    actorId: string | null | undefined,
    public readonly leadId: string,
    public readonly payload?: Record<string, any>,
  ) {
    super(clinicId, actorId);
  }
}

export class StaffEvent extends BaseEvent {
  constructor(
    clinicId: string,
    actorId: string | null | undefined,
    public readonly payload?: Record<string, any>,
  ) {
    super(clinicId, actorId);
  }
}

export class AuthEvent extends BaseEvent {
  constructor(
    clinicId: string | null,
    actorId: string | null | undefined,
    public readonly payload?: Record<string, any>,
  ) {
    // Some auth events might not have a clinicId yet (e.g. login)
    super(clinicId || '', actorId);
  }
}
