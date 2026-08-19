# DFO Backend — Source Code Map & Developer Guide

> **Version**: 2.0  
> **Last Updated**: 2026-08-18  
> **System**: DFO Control Tower Backend  
> **Purpose**: Navigate the codebase efficiently. Every file listed with size, role, and importance.

---

## 1. Root Directory Structure

```
DFO_Backend/
├── docker-compose.yml              # Full stack: backend + frontend + PostgreSQL + Redis
├── docs/                           # Architecture documentation (you are here)
│   ├── 01_ARCHITECTURE.md          # Legacy system architecture (v1)
│   ├── 02_DATABASE_SCHEMA.md       # Legacy database schema reference
│   ├── 03_LOW_LEVEL_DESIGN.md      # Legacy low-level design
│   ├── 04_API_CONTRACTS.md         # Legacy API contracts
│   ├── 05_BUSINESS_OVERVIEW.md     # Business overview & vision
│   ├── ARCHITECTURE_01_*.md        # NEW: System overview
│   ├── ARCHITECTURE_02_*.md        # NEW: Security architecture
│   ├── ARCHITECTURE_03_*.md        # NEW: Domain architecture
│   ├── ARCHITECTURE_04_*.md        # NEW: Infrastructure & data flows
│   └── ARCHITECTURE_05_*.md        # NEW: This file (source map)
└── control-tower-core/             # Main backend application
    ├── src/                        # Source code (TypeScript)
    ├── db/                         # SQL migration files (37 files)
    ├── scripts/                    # Utility scripts
    ├── Dockerfile                  # Container build
    ├── package.json                # Dependencies & scripts
    ├── tsconfig.json               # TypeScript configuration
    ├── nest-cli.json               # NestJS CLI configuration
    └── eslint.config.mjs           # ESLint configuration
```

---

## 2. Source Code Map (`src/`)

### 2.1 Application Entry Points

| File | Size | Role |
|:---|:---|:---|
| `main.ts` | 1.7 KB | **Primary entry point.** Creates NestExpressApplication, applies Helmet, CORS, ValidationPipe, Swagger, and starts listening on PORT. |
| `app.module.ts` | 2.0 KB | **Root module.** Imports all global modules, registers TenantInterceptor as APP_INTERCEPTOR, declares root controllers. |
| `main-minimal.ts` | 0.7 KB | Minimal entry point for testing (fewer modules) |
| `main-super-minimal.ts` | 0.6 KB | Ultra-minimal entry point |
| `main-tiny.ts` | 0.6 KB | Tiny entry point (health check only) |
| `janmasethu-only.main.ts` | 0.7 KB | JanmaSethu-only entry point |
| `minimal-app.module.ts` | 0.5 KB | Minimal module for testing |
| `super-minimal-app.module.ts` | 0.6 KB | Super-minimal module |
| `tiny-app.module.ts` | 0.2 KB | Tiny module (controller only) |
| `tiny-controller.ts` | 0.1 KB | Minimal health check controller |

### 2.2 API Layer (`src/api/`)

| File | Size | Routes | Role |
|:---|:---|:---|:---|
| `thread.controller.ts` | 4.7 KB | `/thread` | Core thread CRUD, listing by status, message operations |
| `health.controller.ts` | 0.9 KB | `/health` | Kubernetes/load-balancer health probes (Terminus) |
| `debug.controller.ts` | 0.7 KB | `/debug` | Development diagnostics endpoint |

### 2.3 Config & Types

| File | Size | Role |
|:---|:---|:---|
| `config/configuration.ts` | 1.7 KB | Typed configuration factory: supabase, orgSupabase, redis, domains, hardening |
| `types/index.ts` | 1.3 KB | Core enums (ThreadStatus, OwnershipType, Channel) and interfaces (Thread, Message, SentimentEvaluation, AuditLog) |
| `types/config.types.ts` | 0.4 KB | Config type definitions |
| `contracts/index.ts` | 0.6 KB | Plugin contracts: SentimentProvider, EscalationPolicy, DomainNotifier |

---

### 2.4 Kernel Module (`src/kernel/`)

| File | Size | Role |
|:---|:---|:---|
| `kernel.module.ts` | 3.5 KB | **Kernel orchestration module.** Global, exports all services. Has `register()` static method for legacy domain registration. |
| `thread/thread.service.ts` | 4.8 KB | Thread lifecycle: init, get, appendMessage, validateAIAction, updateStatus with version check |
| `ownership/ownership.service.ts` | 4.5 KB | Atomic AI↔HUMAN ownership transitions, lock toggle, transition validation |
| `routing/routing.service.ts` | ~2.6 KB | BullMQ-backed human agent routing with dead-letter handling |
| `sentiment/sentiment.service.ts` | ~1.0 KB | Delegates sentiment evaluation to domain-specific SentimentProvider |
| `audit/` (module) | — | Immutable audit log creation |
| `guardrail/` (module) | — | Regex/keyword scanning for dangerous content |
| `metrics/` (module) | — | Concurrency conflict counting, ownership switch metrics |
| `services/provider-registry.service.ts` | 0.9 KB | Multi-domain plugin registry: register/getPlugins by domain name |
| `api/ingress.controller.ts` | 2.0 KB | Universal message ingestion: POST /ingress/message |
| `rate-limiter.service.ts` | 0.8 KB | Per-thread request throttling |

---

### 2.5 JanmaSethu Domain (`src/domains/janmasethu/`)

#### Core Files (Root)

| File | Size | Role | Importance |
|:---|:---|:---|:---|
| `janmasethu.module.ts` | 7.8 KB | Module registration with 12 sub-module imports, 27 providers, ProviderRegistry registration, and background job scheduling | ⭐⭐⭐ |
| `janmasethu.handler.ts` | 12.6 KB | **Main message processing pipeline** — Idempotency, guardrails, consent, sentiment, transitions, engagement | ⭐⭐⭐ |
| `janmasethu.repository.ts` | 38.1 KB | **Largest file** — All Supabase data access for JanmaSethu domain (CRUD for patients, threads, messages, consultations, prescriptions, analytics) | ⭐⭐⭐ |
| `janmasethu.controller.ts` | 20.4 KB | REST API endpoints for DFO: patients, consultations, prescriptions, analytics, thread management | ⭐⭐ |
| `thread-operations.controller.ts` | 6.3 KB | Thread management APIs: list, filter, assign, takeover, release | ⭐⭐ |
| `thread-operations.repository.ts` | 35.7 KB | Thread query operations with complex filtering and joins | ⭐⭐ |
| `janmasethu.assignment.ts` | 6.5 KB | Thread auto-assignment with workload balancing across clinicians | ⭐⭐ |
| `janmasethu-assignment.engine.ts` | 3.1 KB | Enhanced assignment engine with algorithm selection | ⭐ |
| `janmasethu.takeover.ts` | 3.9 KB | Human clinician takeover flow (AI→HUMAN) with SLA scheduling | ⭐⭐ |
| `janmasethu.context.ts` | 2.8 KB | Full thread context aggregation (messages, sentiment, patient profile) | ⭐ |
| `janmasethu.dfo.service.ts` | 7.3 KB | Patient journey, consultations, prescriptions, analytics | ⭐⭐ |
| `janmasethu.leads.service.ts` | 12.6 KB | Lead CRM: stalled lead processing, lead-to-patient conversion | ⭐⭐ |
| `janmasethu.summary.service.ts` | 6.3 KB | AI-powered consultation summaries | ⭐ |
| `janmasethu.reporting.service.ts` | 3.1 KB | Patient journey reports generation | ⭐ |
| `janmasethu.audit.service.ts` | 2.9 KB | PII access logging, clinical update auditing | ⭐ |
| `janmasethu.rbac.ts` | 3.6 KB | Permission checks per role (CRO/DOCTOR/NURSE) | ⭐⭐ |
| `janmasethu.sla.ts` | 6.5 KB | SLA enforcement worker (BullMQ processor): schedule, cancel, breach detection, escalation | ⭐⭐⭐ |
| `janmasethu.feedback.service.ts` | 1.6 KB | Clinician feedback on AI accuracy | ⭐ |
| `janmasethu.policy.ts` | 0.9 KB | Escalation policy implementation for kernel contract | ⭐ |
| `JanmasethuScopePolicy.ts` | 5.0 KB | Visibility enforcement, take-control rules, assignment validation, AI suppression, state transition actions | ⭐⭐⭐ |
| `janmasethu.types.ts` | 2.4 KB | Domain enums (roles, permissions), SLA configs, escalation rules | ⭐⭐ |
| `dfo.types.ts` | 2.7 KB | DFO entity interfaces (Patient, Doctor, Appointment, Consultation, Prescription) | ⭐⭐ |
| `security.utils.ts` | 2.1 KB | Security utility functions | ⭐ |
| `pii-decrypter.service.ts` | 3.0 KB | Bulk PII decryption for list views | ⭐ |
| `chat-decrypter.service.ts` | 3.1 KB | Message content decryption for chat views | ⭐ |

#### Sub-Modules

| Directory | Files | Key Files | Role |
|:---|:---|:---|:---|
| `risk-engine/` | 8 | `janmasethu-risk.service.ts` (4.5KB), `keyword-detector.ts` (5.4KB), `janmasethu-guardrails.ts` (2.9KB) | Hybrid risk scoring: keywords + sentiment + context + profile awareness |
| `clinical-intelligence/` | 5 | `clinical-intelligence.service.ts` (8.1KB) | Gemini AI conversation analysis with Zod schema validation |
| `vitals/` | 6 | `vitals.service.ts` (5.3KB), `vitals.repository.ts` (3.7KB) | Patient vital signs tracking with Zod validation |
| `alerting/` | 5 | `alerting.service.ts` (3.7KB), `webhook.worker.ts` (2.3KB) | Clinical alerting with webhook delivery |
| `consent/` | 5 | `consent-enforcement.service.ts` (4.6KB), `consent.repository.ts` (2.2KB) | Patient consent management with quiet hours + emergency override |
| `documents/` | 11 | `document.service.ts` (11.6KB), `document.generator.ts` (14.9KB) | Clinical document generation (DOCX via Puppeteer), S3 storage |
| `engagement/` | 5 | `engagement.service.ts` (6.1KB), `engagement.worker.ts` (4.7KB) | Proactive patient engagement dispatch |
| `engagement-engine/` | 1 | `engine.service.ts` (10.1KB) | Rule-based engagement engine (event→action mapping, journey milestones) |
| `channel/` | 4 | `janmasethu-channel.service.ts` (3.1KB), `janmasethu-dispatch.service.ts` (3.7KB) | Multi-channel messaging (WhatsApp, web) |
| `analytics/` | 4 | `analytics.service.ts` (6.6KB), `analytics.worker.ts` (2.7KB) | Analytics aggregation with BullMQ workers |
| `auth/` | 4 | `auth.service.ts` (3.1KB), `jwt-auth.guard.ts` (2.4KB) | JanmaSethu-specific JWT authentication |
| `notifications/` | 1 | `notification.service.ts` (3.5KB) | Notification dispatch service |
| `appointments/` | 2 | `appointment.service.ts` (9.5KB), `no-show.worker.ts` (1.1KB) | Maternal-specific appointment handling, no-show detection |
| `support-engagement/` | 4 | `support-engagement.service.ts` (12.7KB) | Support ticket and engagement management |
| `api/` | 2 | `realtime-events.controller.ts`, `health.controller.ts` | SSE for real-time dashboard events, health endpoint |
| `utils/` | 3+ | `encryption.service.ts`, `emergency-hotline.service.ts`, `maintenance.service.ts` | Encryption, hotline alerts, backend stabilization |
| `dto/` | — | — | Data transfer objects |

---

### 2.6 Clinics Domain (`src/domains/clinics/`)

#### Controllers (21 files)

| File | Size | Route Prefix | Role |
|:---|:---|:---|:---|
| `patients.controller.ts` | **56.1 KB** | `api/v1/clinics/patients` | **Largest controller.** Full patient CRUD, clinical notes, documents, PIN reset, timeline, treatments |
| `appointments.controller.ts` | **37.6 KB** | `api/v1/clinics/appointments` | Scheduling with double-booking prevention, status FSM, QMS integration |
| `documents.controller.ts` | **30.8 KB** | `api/v1/clinics/documents` | S3 upload tickets, register, link/unlink patients, triage queue, download |
| `leads.controller.ts` | **26.2 KB** | `api/leads` | CRM lead management, bulk CSV import, export, conversion |
| `users.controller.ts` | 17.8 KB | — | User management, CRUD, role assignment |
| `auth.controller.ts` | 14.4 KB | `api/auth` | Staff login/logout, profile update, password change |
| `room-allocation.controller.ts` | 12.3 KB | `api/v1/clinics` | Room categories, rooms, beds, admissions, transfers, discharge |
| `patient-portal.controller.ts` | 11.6 KB | `api/patient-portal` | Patient dashboard, appointments, clinical vault, care timeline |
| `control-tower.controller.ts` | 10.1 KB | — | Thread management from clinic context |
| `super-admin.controller.ts` | 10.3 KB | `api/v1/superadmin` | Clinic CRUD, platform analytics, clinic deletion |
| `qms-queue.controller.ts` | 10.0 KB | — | QMS queue operations: enqueue, transition, live status |
| `dashboard.controller.ts` | 8.9 KB | `api/dashboard` | Summary dashboard, CRO funnel analytics |
| `staff.controller.ts` | 8.4 KB | `api/v1/clinics/staff` | Staff assignment via bridge table, Redis caching |
| `super-admin-auth.controller.ts` | 7.7 KB | `api/v1/superadmin/auth` | Super admin login/signup with secret code |
| `patient-auth.controller.ts` | 6.1 KB | `api/patient-auth` | Patient PIN-based login with lockout protection |
| `audit.controller.ts` | 5.1 KB | — | Data access audit trail queries |
| `qms-config.controller.ts` | 2.7 KB | — | QMS configuration management |
| `analytics.controller.ts` | 2.2 KB | — | Analytics API endpoints |
| `internal-assistant.controller.ts` | 2.3 KB | — | AI assistant chat interface |
| `knowledge.controller.ts` | 1.8 KB | — | Knowledge base management |
| `clinics.controller.ts` | 1.7 KB | — | Clinic-level operations |
| `schedules.controller.ts` | 1.8 KB | — | Doctor schedule management |

#### Services (12 files)

| File | Size | Role |
|:---|:---|:---|
| `room-allocation.service.ts` | **25.1 KB** | Full room/bed/admission lifecycle with atomic operations |
| `schedules.service.ts` | 8.9 KB | Doctor schedule management, availability checking |
| `qms-engine.service.ts` | 7.5 KB | QMS: atomic enqueue, status transitions, predictive ETA, sweeper cron |
| `clinics-utils.service.ts` | 7.6 KB | Shared utilities (sanitization, validation, formatting) |
| `analytics.service.ts` | 6.0 KB | Doctor performance metrics, consultation time analytics |
| `qms-notification.service.ts` | 4.6 KB | QMS notification management |
| `qms-notification.processor.ts` | 3.3 KB | QMS notification BullMQ processor |
| `slot-engine.service.ts` | 4.6 KB | Appointment slot availability engine |
| `clinics-supabase.service.ts` | 2.8 KB | Supabase client accessor for clinics domain |
| `clinics-encryption.service.ts` | 2.3 KB | Clinic-specific PII encryption/decryption |
| `documents.service.ts` | 1.7 KB | Document management service |
| `staff-cache.service.ts` | 1.0 KB | Redis-cached staff list per clinic |

#### Other Components

| Directory | Files | Role |
|:---|:---|:---|
| `guards/` | 4 | `ClinicsAuthGuard`, `SuperAdminGuard`, `RolesGuard`, `PermissionsGuard` |
| `dto/` | 2 | `CreateClinicDto`, `RoomAllocationDto` |
| `gateways/` | 1 | `QmsGateway` — WebSocket for real-time queue updates |
| `listeners/` | 2 | `AuditEventProcessor`, `CacheEventProcessor` — event-driven side effects |
| `helpers/` | 1 | `leads.helpers.ts` — lead processing utilities |
| `internal-assistant/` | 11 | AI chat assistant with intent classifier, gatekeeper, data fetcher, responder, and action handlers |

---

### 2.7 Infrastructure Layer (`src/infrastructure/`)

| File/Directory | Size | Role |
|:---|:---|:---|
| `database.module.ts` | 1.2 KB | Global Supabase client injection (dual: primary + org) |
| `queue.module.ts` | 1.4 KB | Global BullMQ root config + 3 named queues |
| `in-memory-redis.module.ts` | 1.9 KB | Dev-only Redis mock using redis-memory-server |
| `mock-supabase.module.ts` | 0.8 KB | Mock Supabase for testing |
| `ai-suppression.guard.ts` | 1.7 KB | HTTP-level AI action blocking guard |
| **`cache/`** | | |
| `redis-cache.module.ts` | 1.4 KB | Global Redis client injection (ioredis) |
| `redis-cache.service.ts` | 2.1 KB | Redis get/set/del with TTL support |
| **`aws/`** | | |
| `aws.module.ts` | 0.3 KB | AWS module registration |
| `s3.service.ts` | 6.4 KB | S3 presigned URLs (upload/download), file deletion, path sanitization |
| **`context/`** | | |
| `tenant.context.ts` | 0.7 KB | AsyncLocalStorage-based TenantContext with static getters |
| **`interceptors/`** | | |
| `tenant.interceptor.ts` | 1.2 KB | Extracts JWT claims into AsyncLocalStorage on every request |
| `transform.interceptor.ts` | 0.7 KB | Response transformation interceptor |
| **`security/`** | | |
| `encryption.service.ts` | 2.2 KB | AES-256-GCM encryption/decryption service |
| `roles.decorator.ts` | 0.1 KB | `@Roles()` metadata decorator |
| `permissions.decorator.ts` | 0.2 KB | `@Permissions()` metadata decorator |
| **`filters/`** | | |
| `healthcare-exception.filter.ts` | 1.3 KB | Global exception filter: standardized error response format |
| **`exceptions/`** | | |
| Various | — | `AISuppressionException`, `ConcurrencyException`, `InvalidTransitionError` |
| **`events/`** | | |
| `event-constants.ts` | 1.7 KB | 32 strongly-typed event names across 6 categories |
| `event-payloads.ts` | 2.0 KB | Typed event payload classes (BaseEvent → domain-specific) |
| **`repositories/`** | | |
| `thread.repository.ts` | 2.9 KB | Kernel thread CRUD with atomic update |
| `message.repository.ts` | 3.0 KB | Kernel message CRUD |
| `sentiment.repository.ts` | 1.0 KB | Sentiment evaluation storage |
| `routing.repository.ts` | 2.6 KB | Routing event storage |
| `dead-letter.repository.ts` | 0.6 KB | Dead letter queue storage |
| **`audit/`** | | |
| `audit.service.ts` | — | Immutable audit log service |

---

## 3. Database Migrations (`db/`)

| Migration | Size | Category | What It Does |
|:---|:---|:---|:---|
| `init-db.sql` | 6.2 KB | Foundation | Core tables: threads, messages, sentiment, audit, routing, users |
| `02_clinical_os.sql` | 0.7 KB | Clinical | Clinical threads, templates |
| `03_audit_and_messages.sql` | 1.0 KB | Clinical | Clinical messages, ownership audits |
| `004_dfo_documents.sql` | 4.1 KB | DFO | Document tables, access logs, analytics cache |
| `007_multi_tenant_foundation.sql` | 4.5 KB | **Multi-Tenancy** | Clinics, users, patients, appointments, documents, leads |
| `014_room_allocation.sql` | 4.8 KB | Rooms | Categories, rooms, beds, admissions |
| `018_patient_timeline.sql` | 5.3 KB | Timeline | Patient timeline event tracking |
| `019_medical_metrics.sql` | 5.3 KB | Metrics | Medical metrics schema |
| `021_atomic_create_clinic.sql` | 3.2 KB | RPC | Atomic clinic + admin creation RPC |
| `023_convert_lead_rpc.sql` | 2.8 KB | RPC | Lead-to-patient conversion RPC |
| `027_enable_rls_for_clinics.sql` | 2.8 KB | Security | Row Level Security policies |
| `030_leads_conversion_and_rls.sql` | 4.7 KB | Leads | Lead conversion pipeline + RLS |

---

## 4. NPM Scripts

| Script | Command | Purpose |
|:---|:---|:---|
| `dev` | `nest start --watch` | Development with hot reload |
| `build` | `nest build` | Production build |
| `start` | `nest start` | Start without watch |
| `start:prod` | `node dist/src/main` | Production startup |
| `start:debug` | `nest start --debug --watch` | Debug mode with inspector |
| `lint` | `eslint ... --fix` | Lint and auto-fix |
| `format` | `prettier --write` | Format source code |
| `test` | `jest` | Run unit tests |
| `test:watch` | `jest --watch` | Tests with watch mode |
| `test:cov` | `jest --coverage` | Tests with coverage report |
| `test:e2e` | `jest --config ./test/jest-e2e.json` | End-to-end tests |
| `test:integration` | `jest --config ./test/jest-integration.json` | Integration tests (TestContainers) |

---

## 5. Key Dependencies

| Package | Version | Purpose |
|:---|:---|:---|
| `@nestjs/core` | 11.x | Core framework |
| `@nestjs/bullmq` | 11.x | BullMQ job queue integration |
| `@nestjs/config` | 4.x | Configuration management |
| `@nestjs/jwt` | 11.x | JWT utilities |
| `@nestjs/passport` | 11.x | Authentication strategies |
| `@nestjs/throttler` | 6.x | Rate limiting |
| `@nestjs/terminus` | 11.x | Health checks |
| `@nestjs/websockets` | 11.x | WebSocket support |
| `@nestjs/schedule` | 6.x | Cron job scheduling |
| `@supabase/supabase-js` | 2.x | Database client |
| `bullmq` | 5.70 | Job queue engine |
| `ioredis` | 5.x | Redis client |
| `@aws-sdk/client-s3` | 3.x | AWS S3 SDK |
| `@google/generative-ai` | 0.24 | Google Gemini AI |
| `jsonwebtoken` | 9.x | JWT signing/verification |
| `bcrypt` | 5.x | Password/PIN hashing |
| `helmet` | 8.x | HTTP security headers |
| `class-validator` | 0.15 | DTO validation |
| `zod` | 4.x | Schema validation |
| `docx` | 9.x | DOCX document generation |
| `puppeteer-core` | 24.x | PDF generation |
| `socket.io` | 4.x | WebSocket engine |
| `uuid` | 14.x | UUID generation |
| `async-retry` | 1.3 | Retry with backoff |
