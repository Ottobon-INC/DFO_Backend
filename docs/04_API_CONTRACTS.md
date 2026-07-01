# Patient management— API Contracts Reference

> **Version**: 1.0  
> **Last Updated**: 2026-07-01  
> **Base URL**: `http://localhost:3001`  
> **Content-Type**: `application/json`

---

## Table of Contents

1. [Authentication](#1-authentication)
2. [Super Admin](#2-super-admin)
3. [Patients](#3-patients)
4. [Appointments](#4-appointments)
5. [Documents](#5-documents)
6. [Leads CRM](#6-leads-crm)
7. [Staff Management](#7-staff-management)
8. [Room Allocation](#8-room-allocation)
9. [Dashboard & Analytics](#9-dashboard--analytics)
10. [Patient Portal](#10-patient-portal)
11. [Kernel (Threads)](#11-kernel-threads)
12. [Standard Response Envelope](#12-standard-response-envelope)

---

## Standard Headers

| Header | Value | Required |
|:---|:---|:---|
| `Content-Type` | `application/json` | All requests |
| `Authorization` | `Bearer <JWT>` | All authenticated endpoints |

---

## 12. Standard Response Envelope

All API responses follow this envelope:

**Success**:
```json
{
    "success": true,
    "data": { ... },
    "pagination": { "page": 1, "limit": 20, "total": 100 },  // Optional
    "cached": true  // Optional — present when served from cache
}
```

**Error**:
```json
{
    "success": false,
    "error": "Human-readable error message",
    "details": { ... }  // Optional
}
```

---

## 1. Authentication

### 1.1 Staff Login

```
POST /api/auth/login
```

**Auth**: None  
**Request Body**:
```json
{
    "email": "doctor@clinic.com",
    "password": "s3cureP@ss"
}
```

**Response** `200 OK`:
```json
{
    "success": true,
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "user": {
        "id": "uuid",
        "name": "Dr. Priya",
        "email": "doctor@clinic.com",
        "role": "Doctor",
        "clinic_id": "uuid",
        "is_super_admin": false,
        "is_clinic_admin": true,
        "token": "eyJ..."
    },
    "data": {
        "token": "eyJ...",
        "user": { ... }
    }
}
```

**Error Responses**:
| Status | Condition |
|:---|:---|
| `400` | Missing email or password |
| `401` | Invalid credentials |

---

### 1.2 Staff Logout

```
POST /api/auth/logout
```

**Auth**: None (stateless JWT)  
**Response** `200 OK`:
```json
{
    "success": true,
    "message": "Logged out successfully"
}
```

---

### 1.3 Update Profile

```
PATCH /api/auth/profile
```

**Auth**: `Bearer <staff_token>`  
**Request Body**:
```json
{
    "name": "Dr. Priya Updated",
    "email": "newemail@clinic.com"
}
```

**Response** `200 OK`:
```json
{
    "success": true,
    "data": { "id": "uuid", "name": "...", "email": "...", "role": "...", "clinic_id": "..." },
    "token": "new_jwt_token"
}
```

**Error Responses**: `400` (nothing to update), `409` (email exists)

---

### 1.4 Change Password

```
POST /api/auth/change-password
```

**Auth**: `Bearer <staff_token>`  
**Request Body**:
```json
{
    "currentPassword": "oldPass123",
    "newPassword": "newPass456"
}
```

**Response** `200 OK`:
```json
{
    "success": true,
    "message": "Password updated successfully"
}
```

**Error Responses**: `400` (missing fields), `401` (wrong password), `500` (hashing library missing)

---

### 1.5 Patient Login

```
POST /api/patient-auth/login
```

**Auth**: None  
**Request Body**:
```json
{
    "mobile": "+919876543210",
    "pin": "1234"
}
```

**Response** `200 OK`:
```json
{
    "success": true,
    "token": "eyJ...",
    "user": {
        "id": "uuid",
        "uhid": "UHID-000042",
        "name": "Meera Devi",
        "mobile": "+919876543210"
    }
}
```

**Error Responses**:
| Status | Condition |
|:---|:---|
| `400` | Missing mobile or PIN |
| `401` | Invalid credentials / no PIN set |
| `403` | Account locked (includes remaining minutes) |

---

## 2. Super Admin

### 2.1 Super Admin Login

```
POST /api/v1/superadmin/auth/login
```

**Auth**: None  
**Request/Response**: Same structure as Staff Login, returns `is_super_admin: true`

---

### 2.2 Super Admin Signup

```
POST /api/v1/superadmin/auth/signup
```

**Auth**: None (requires secret code)  
**Request Body**:
```json
{
    "name": "Admin Name",
    "email": "admin@medcy.com",
    "password": "securePassword",
    "secret_code": "<SUPER_ADMIN_SECRET>"
}
```

**Response** `200 OK`:
```json
{
    "success": true,
    "message": "Super Admin created successfully",
    "data": {
        "token": "eyJ...",
        "user": { "id": "uuid", "name": "...", "email": "...", "is_super_admin": true }
    }
}
```

**Error Responses**: `400` (missing fields), `403` (invalid secret), `409` (email exists)

---

### 2.3 Create Clinic

```
POST /api/v1/superadmin/clinics
```

**Auth**: `Bearer <super_admin_token>`  
**Guard**: `SuperAdminGuard`  
**Request Body**:
```json
{
    "clinic_name": "Sakhi Women's Hospital",
    "owner_name": "Dr. Anita",
    "owner_email": "anita@sakhi.com",
    "owner_role": "Doctor"
}
```

**Response** `200 OK`:
```json
{
    "success": true,
    "message": "Clinic and Admin created successfully",
    "data": {
        "clinic": { "id": "uuid", "name": "Sakhi Women's Hospital", ... },
        "admin": { "id": "uuid", "name": "Dr. Anita", "email": "...", "role": "Doctor", "is_clinic_admin": true }
    }
}
```

---

### 2.4 List Clinics

```
GET /api/v1/superadmin/clinics
```

**Auth**: `Bearer <super_admin_token>`  
**Response** `200 OK`:
```json
{
    "success": true,
    "data": [
        { "id": "uuid", "name": "Clinic Name", "is_active": true, "users_count": 5, "created_at": "..." }
    ]
}
```

---

### 2.5 Delete Clinic

```
DELETE /api/v1/superadmin/clinics/:id
```

**Auth**: `Bearer <super_admin_token>`  
**Response** `200 OK`:
```json
{ "success": true, "message": "Clinic completely deleted" }
```

> ⚠️ **Destructive**: Deletes all clinic users first, then the clinic record.

---

### 2.6 Platform Analytics

```
GET /api/v1/superadmin/analytics
```

**Auth**: `Bearer <super_admin_token>`  
**Response** `200 OK`:
```json
{
    "success": true,
    "data": {
        "total_clinics": 12,
        "total_patients": 4560,
        "total_files": 892
    },
    "cached": true
}
```

---

## 3. Patients

**Base Path**: `/api/v1/clinics/patients`  
**Auth**: `Bearer <staff_token>`  
**Guards**: `ClinicsAuthGuard`, `RolesGuard`

### 3.1 List Patients

```
GET /api/v1/clinics/patients?page=1&limit=20&phone=+91...&q=searchTerm
```

**Query Parameters**:
| Param | Type | Default | Description |
|:---|:---|:---|:---|
| `page` | number | 1 | Page number |
| `limit` | number | 20 | Items per page |
| `phone` | string | — | Exact phone match |
| `q` | string | — | Search name or mobile (ilike) |

**Response** `200 OK`:
```json
{
    "success": true,
    "data": [ { "id": "uuid", "name": "...", "uhid": "UHID-...", "mobile": "...", ... } ],
    "pagination": { "page": 1, "limit": 20, "total": 156 }
}
```

---

### 3.2 Create Patient

```
POST /api/v1/clinics/patients
```

**Request Body**:
```json
{
    "name": "Meera Devi",
    "mobile": "+919876543210",
    "gender": "Female",
    "dob": "1990-05-15",
    "blood_group": "B+",
    "marital_status": "Married",
    "email": "meera@example.com",
    "city": "Hyderabad",
    "state": "Telangana",
    "assigned_doctor_id": "uuid",
    "emergency_contact_name": "Rajesh",
    "emergency_contact_phone": "+919876543211",
    "emergency_contact_relation": "Husband"
}
```

**Required**: `name`, `mobile` (or `phone`)  
**Auto-generated**: `uhid`, 4-digit PIN

**Response** `200 OK`:
```json
{
    "success": true,
    "data": { "id": "uuid", "uhid": "UHID-000042", ... },
    "generatedPin": "7234"
}
```

**Error Responses**: `400` (missing fields), `409` (mobile exists)

---

### 3.3 Get Patient

```
GET /api/v1/clinics/patients/:id
```

**Response** `200 OK`:
```json
{ "success": true, "data": { ... } }
```

---

### 3.4 Update Patient

```
PATCH /api/v1/clinics/patients/:id
```

**Roles**: `Admin`, `Receptionist`, `Doctor`  
**Immutable Fields** (silently ignored): `id`, `uhid`, `created_at`, `clinic_id`

**Error Responses**: `404` (not found), `409` (mobile conflict)

---

### 3.5 Patient Appointments

```
GET /api/v1/clinics/patients/:id/appointments
```

---

### 3.6 Clinical Notes (Simple)

```
GET /api/v1/clinics/patients/:id/clinical-notes
POST /api/v1/clinics/patients/:id/clinical-notes
```

**POST Roles**: `Admin`, `Doctor`  
**POST Body**:
```json
{ "note": "Patient reports improvement...", "doctor_id": "uuid" }
```

---

### 3.7 SOAP Notes (Structured)

```
GET /api/v1/clinics/patients/:id/notes
POST /api/v1/clinics/patients/:id/notes
```

**POST Roles**: `Admin`, `Doctor`  
**POST Body**:
```json
{
    "doctor_id": "uuid",
    "appointment_id": "uuid",
    "subjective": "Patient complains of...",
    "objective": "BP: 120/80, Temp: 98.6F",
    "assessment": "Diagnosis: ...",
    "plan": "Follow-up in 2 weeks..."
}
```

---

### 3.8 Patient Documents

```
GET /api/v1/clinics/patients/:id/documents
POST /api/v1/clinics/patients/:id/documents
```

**POST Roles**: `Admin`, `Receptionist`, `Doctor`, `Nurse`  
**POST Body** (supports base64 upload or URL):
```json
{
    "name": "Blood Test Report.pdf",
    "document_type": "lab_report",
    "base64": "JVBERi0xLjQKM...",
    "contentType": "application/pdf"
}
```

---

### 3.9 Reset Patient PIN

```
POST /api/v1/clinics/patients/:id/reset-pin
```

**Request Body** (optional):
```json
{ "newPin": "5678" }
```

If `newPin` is not provided, a random 4-digit PIN is generated.

**Response** `200 OK`:
```json
{
    "success": true,
    "message": "PIN successfully reset",
    "newPin": "5678"
}
```

---

## 4. Appointments

**Base Path**: `/api/v1/clinics/appointments`  
**Auth**: `Bearer <staff_token>`  
**Guards**: `ClinicsAuthGuard`

### 4.1 List Appointments

```
GET /api/v1/clinics/appointments?date=2026-07-01&status=Scheduled&doctor_id=uuid&page=1&limit=20
```

**Query Parameters**:
| Param | Type | Description |
|:---|:---|:---|
| `date` | string (YYYY-MM-DD) | Filter by date |
| `status` | string | Filter by status |
| `doctor_id` | UUID | Filter by doctor |
| `patient_id` | UUID | Filter by patient |
| `page` | number | Page (default: 1) |
| `limit` | number | Per page (default: 20) |

---

### 4.2 Create Appointment

```
POST /api/v1/clinics/appointments
```

**Request Body**:
```json
{
    "patient_id": "uuid",
    "doctor_id": "uuid",
    "appointment_date": "2026-07-15",
    "start_time": "10:00",
    "end_time": "10:30",
    "type": "Consultation",
    "visit_reason": "Regular checkup",
    "source": "Walk-in"
}
```

**Type Enum**: `Consultation` | `Follow-up` | `Procedure` | `Emergency` | `Scan` | `Surgery` | `Camp`  
**Status**: Auto-set to `Scheduled`

**Response**: Includes denormalized snapshots of patient and doctor data.

**Error Responses**: `400` (missing fields, invalid IDs), `409` (time slot conflict)

---

### 4.3 Update Appointment

```
PATCH /api/v1/clinics/appointments/:id
```

**Body**: Any updatable appointment fields. Status transitions can trigger events.

---

### 4.4 Cancel Appointment

```
PATCH /api/v1/clinics/appointments/:id/cancel
```

**Request Body**:
```json
{ "reason": "Patient requested reschedule" }
```

**Response** `200 OK`:
```json
{
    "success": true,
    "data": { "id": "uuid", "status": "Canceled", "cancellation_reason": "...", "cancelled_at": "..." }
}
```

---

## 5. Documents

**Base Path**: `/api/v1/clinics/documents`  
**Auth**: `Bearer <staff_token>`  
**Guard**: `ClinicsAuthGuard`

### 5.1 Generate Upload Ticket

```
POST /api/v1/clinics/documents/upload-ticket
```

**Request Body**:
```json
{
    "filename": "report.pdf",
    "fileSize": 1048576,
    "documentType": "lab_report"
}
```

**Max File Size**: 25 MB

**Response** `200 OK`:
```json
{
    "success": true,
    "data": {
        "uploadUrl": "https://s3.amazonaws.com/bucket/...",
        "path": "clinic_id/staging/1719...-report.pdf",
        "method": "PUT",
        "expiresIn": 300
    }
}
```

---

### 5.2 Register Document

```
POST /api/v1/clinics/documents/register
```

**Request Body**:
```json
{
    "patient_id": "uuid",
    "name": "Blood Test Report",
    "file_path": "clinic_id/staging/1719...-report.pdf",
    "file_size": 1048576,
    "mime_type": "application/pdf",
    "document_type": "lab_report"
}
```

**Notes**: `patient_id` is optional. If omitted, document status is `unassigned`.

---

### 5.3 Get Unassigned Documents

```
GET /api/v1/clinics/documents/unassigned?page=1&limit=10
```

**Response** `200 OK`:
```json
{
    "success": true,
    "data": [
        {
            "id": "uuid", "name": "...", "file_path": "...", "status": "unassigned",
            "previewUrl": "https://presigned-s3-url...",
            "uploader": { "name": "Nurse Priya" }
        }
    ],
    "meta": { "page": 1, "limit": 10, "total": 5, "totalPages": 1 }
}
```

---

### 5.4 Link Document to Patient

```
PATCH /api/v1/clinics/documents/:id/link
```

**Request Body**:
```json
{
    "patient_id": "uuid",
    "document_type": "prescription"
}
```

**Error Responses**: `404` (doc/patient not found), `403` (cross-tenant), `409` (already assigned)

---

### 5.5 Unlink Document

```
PATCH /api/v1/clinics/documents/:id/unlink
```

**Request Body**:
```json
{ "reason": "Assigned to wrong patient" }
```

**Required**: `reason` must be non-empty.

---

### 5.6 Delete Document

```
DELETE /api/v1/clinics/documents/:id
```

> Deletes both the database record AND the S3 file.

---

### 5.7 Create Patient + Link Document

```
POST /api/v1/clinics/documents/:id/link-new-patient
```

Atomically creates a new patient and links the document in a single transaction.

**Request Body**: Same as Patient creation (`name`, `mobile` required).

**Response** `200 OK`:
```json
{
    "success": true,
    "message": "Patient created and document linked successfully",
    "data": {
        "id": "uuid",
        "uhid": "UHID-...",
        "generatedPin": "4567",
        ...
    }
}
```

---

## 6. Leads CRM

**Base Path**: `/api/leads`  
**Auth**: `Bearer <staff_token>` (via `@UseGuards(ClinicsAuthGuard)`)

### 6.1 List Leads

```
GET /api/leads?page=1&limit=20&phone=...&status=...&q=searchTerm
```

**Response** includes decrypted PII fields (`problem`, `treatment_suggested`, `treatment_doctor`).

---

### 6.2 Create Lead

```
POST /api/leads
```

**Request Body**:
```json
{
    "name": "Lakshmi",
    "phone": "+919876543210",
    "age": 28,
    "gender": "Female",
    "source": "Facebook",
    "inquiry": "IVF Consultation",
    "problem": "Difficulty conceiving for 2 years",
    "treatment_suggested": "IVF treatment recommended",
    "status": "New"
}
```

**Required**: `name`, `phone`  
**Encrypted on write**: `problem`, `treatment_suggested`, `treatment_doctor`

---

### 6.3 Update Lead

```
PATCH /api/leads/:id
```

---

### 6.4 Re-Engage Lead

```
POST /api/leads/:id/re-engage
```

Sets status back to `Follow Up`.

---

### 6.5 Bulk Import

```
POST /api/leads/bulk
```

**Request Body**:
```json
{
    "leads": [
        { "name": "Lead 1", "phone": "+91...", "status": "New" },
        { "name": "Lead 2", "phone": "+91...", "status": "Follow Up" }
    ]
}
```

**Response** `200 OK`:
```json
{
    "success": true,
    "count": 8,
    "failed": 2,
    "errors": [
        { "phone": "+91...", "name": "Dup Lead", "reason": "Duplicate - already exists in database" }
    ]
}
```

---

### 6.6 Export CSV

```
GET /api/leads/export?phone=...&status=...&q=...
```

**Response**: `Content-Type: text/csv` file download.

---

## 7. Staff Management

**Base Path**: `/api/v1/clinics/staff`  
**Auth**: `Bearer <staff_token>`  
**Guards**: `ClinicsAuthGuard`, `RolesGuard`

### 7.1 List Staff

```
GET /api/v1/clinics/staff
```

**Response** `200 OK` (may be cached):
```json
{
    "success": true,
    "data": [
        {
            "assignment_id": "uuid",
            "user_id": "uuid",
            "role": "Doctor",
            "is_active": true,
            "name": "Dr. Priya",
            "email": "priya@clinic.com",
            "joined_at": "2026-01-15T..."
        }
    ],
    "cached": true
}
```

---

### 7.2 Assign Staff

```
POST /api/v1/clinics/staff
```

**RBAC**: Clinic Admin or Super Admin only  
**Request Body**:
```json
{
    "user_id": "uuid",
    "role": "Doctor"
}
```

**Allowed Roles**: `Doctor`, `CRO`, `Receptionist`, `Nurse`, `Admin`

**Error Responses**: `400` (invalid role), `403` (not admin), `404` (user not found), `409` (already assigned)

---

### 7.3 Unassign Staff

```
DELETE /api/v1/clinics/staff/:assignment_id
```

**RBAC**: Clinic Admin or Super Admin only

---

## 8. Room Allocation

**Base Path**: `/api/v1/clinics`  
**Auth**: `Bearer <staff_token>`  
**Guards**: `ClinicsAuthGuard`, `RolesGuard`

### 8.1 Room Categories

```
GET    /api/v1/clinics/room-categories
POST   /api/v1/clinics/room-categories         # Roles: Admin, Superadmin
PATCH  /api/v1/clinics/room-categories/:id      # Roles: Admin, Superadmin
DELETE /api/v1/clinics/room-categories/:id       # Roles: Admin, Superadmin
```

**POST Body**:
```json
{
    "name": "ICU",
    "description": "Intensive Care Unit",
    "daily_rate": 5000.00
}
```

---

### 8.2 Rooms

```
GET    /api/v1/clinics/rooms
POST   /api/v1/clinics/rooms                    # Roles: Admin, Superadmin
PATCH  /api/v1/clinics/rooms/:id                 # Roles: Admin, Superadmin
```

**POST Body**:
```json
{
    "category_id": "uuid",
    "room_number": "101",
    "floor": "1st",
    "capacity": 4
}
```

---

### 8.3 Beds

```
GET    /api/v1/clinics/beds?status=available
POST   /api/v1/clinics/rooms/:roomId/beds        # Roles: Admin, Superadmin
PATCH  /api/v1/clinics/beds/:id/status            # Roles: Admin, Superadmin, Nurse, Doctor
```

**POST Body**:
```json
{ "bed_identifier": "A" }
```

**PATCH Body**:
```json
{ "status": "maintenance" }
```

**Status Enum**: `available` | `occupied` | `maintenance` | `reserved`

---

### 8.4 Admissions

```
GET    /api/v1/clinics/admissions?status=admitted
POST   /api/v1/clinics/admissions                # Roles: Admin, Doctor, Nurse, Receptionist
PATCH  /api/v1/clinics/admissions/:id/discharge   # Same roles
POST   /api/v1/clinics/admissions/:id/transfer    # Same roles
```

**POST Body** (Create Admission):
```json
{
    "patient_id": "uuid",
    "bed_id": "uuid",
    "admitting_doctor_id": "uuid",
    "diagnosis": "Post-operative care",
    "notes": "Admitted for 3-day observation"
}
```

**POST Body** (Transfer):
```json
{ "new_bed_id": "uuid" }
```

---

### 8.5 Room Dashboard

```
GET /api/v1/clinics/room-dashboard/summary
```

**Response** `200 OK`:
```json
{
    "success": true,
    "data": {
        "total_rooms": 20,
        "total_beds": 60,
        "occupied_beds": 35,
        "available_beds": 22,
        "maintenance_beds": 3,
        "occupancy_rate": 58.33,
        "active_admissions": 35
    }
}
```

---

## 9. Dashboard & Analytics

### 9.1 General Summary

```
GET /api/dashboard/summary
```

**Response** `200 OK`:
```json
{
    "success": true,
    "data": {
        "todayAppointments": [ ... ],
        "recentLeads": [ ... ],
        "leadFunnel": [
            { "status": "New", "count": 45 },
            { "status": "Follow Up", "count": 23 }
        ]
    }
}
```

---

### 9.2 CRO Dashboard

```
GET /api/dashboard/cro
```

**Response** `200 OK`:
```json
{
    "success": true,
    "data": {
        "kpis": {
            "conversionRate": 12.5,
            "croSuccessRate": 45.0,
            "avgTimeToConvertDays": 8.3,
            "patientChurnRate": 15.2
        },
        "funnel": {
            "newLeads": 50,
            "firstConsult": 30,
            "followUp": 15,
            "converted": 8
        },
        "interventionQueue": [
            {
                "id": "uuid",
                "name": "Lead Name",
                "phone": "+91...",
                "status": "Stalling - Sent to CRO",
                "stalledDays": 12,
                "priority": "High"
            }
        ]
    }
}
```

---

## 10. Patient Portal

**Base Path**: `/api/patient-portal`  
**Auth**: `Bearer <patient_token>` (role: `patient`, TTL: 1 hour)

### 10.1 Dashboard

```
GET /api/patient-portal/dashboard
```

**Response** `200 OK`:
```json
{
    "success": true,
    "data": {
        "patient": { "name": "Meera Devi", "uhid": "UHID-000042" },
        "upcomingAppointment": { ... },
        "medicalAlerts": [
            { "type": "Condition", "title": "...", "severity": "Medium", "description": "..." }
        ],
        "carePlanTimeline": [
            { "step": 1, "day": "Day 1", "label": "Consultation", "status": "completed" },
            { "step": 2, "day": "Day 3", "label": "Follow-up", "status": "active" },
            { "step": 3, "day": "Day 7", "label": "Review", "status": "pending" }
        ]
    }
}
```

---

### 10.2 Appointments

```
GET /api/patient-portal/appointments
```

Returns all appointments for the authenticated patient.

---

### 10.3 Clinical Vault

```
GET /api/patient-portal/vault
```

**Response** `200 OK`:
```json
{
    "success": true,
    "data": {
        "documents": [
            {
                "id": "uuid",
                "name": "Blood Test Report",
                "document_type": "lab_report",
                "url": "https://presigned-s3-url...",
                "uploaded_at": "2026-07-01T..."
            }
        ]
    }
}
```

> Document URLs are presigned S3 download URLs, valid for a limited time.

---

## 11. Kernel (Threads)

**Base Path**: `/thread` (Core API) and `/ingress` (Message ingestion)

### 11.1 Initialize Thread

```
POST /thread/initialize
```

**Request Body**:
```json
{
    "domain": "janmasethu",
    "user_id": "patient-uuid",
    "channel": "whatsapp",
    "metadata": { "pregnancy_stage": 28 }
}
```

**Channel Enum**: `web` | `mobile` | `api`

---

### 11.2 Get Thread

```
GET /thread/:id
```

---

### 11.3 Get Thread Messages

```
GET /thread/:id/messages
```

---

### 11.4 List All Threads

```
GET /thread
```

---

### 11.5 Threads by Status

```
GET /thread/status/:status
```

**Status Enum**: `green` | `yellow` | `red`

---

### 11.6 Ingest Message

```
POST /ingress/message
```

**Request Body**:
```json
{
    "thread_id": "uuid",
    "sender_id": "user-uuid",
    "sender_type": "USER",
    "content": "I'm experiencing some discomfort...",
    "domain": "janmasethu"
}
```

**Sender Type Enum**: `USER` | `AI` | `HUMAN`

> If `sender_type = AI`, the system validates that the thread is AI-owned and not locked before allowing the message.

---

## Error Code Reference

| HTTP Status | Meaning | Common Triggers |
|:---|:---|:---|
| `400` | Bad Request | Missing required fields, invalid UUID format |
| `401` | Unauthorized | Invalid/expired JWT, wrong credentials |
| `403` | Forbidden | Cross-tenant access, insufficient role, account locked |
| `404` | Not Found | Resource doesn't exist or not in current tenant |
| `409` | Conflict | Duplicate mobile/email, time slot conflict, already assigned |
| `413` | Payload Too Large | File exceeds 25MB limit |
| `422` | Unprocessable Entity | DTO validation failure (class-validator) |
| `500` | Internal Server Error | Unexpected database/service errors |
