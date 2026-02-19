# Reinex — Refactor & Migration Plan (from TutTiud codebase)

**Date:** 2025-12-15  
**Author:** Copilot (GPT-5.2 Preview)  
**Scope:** Plan + initial foundation changes (schema routing + core SQL script).  

This plan describes how to evolve the copied TutTiud codebase into a new sibling system **Reinex**, while **not breaking existing TutTiud behavior** and while safely coexisting with an existing **TutRate** payroll/services system that already uses the tenant DB **public** schema.

This plan also establishes **tenant public-schema Students as the single source of truth (SSOT)** across all products (Reinex, TutTiud, TutRate), with TutTiud gradually migrating off `tuttiud."Students"`.

Database naming rule (critical): The tenant database is a **shared, product-agnostic** layer. Table names are **domain-based** (e.g., `public.students`, `public.lesson_instances`) and must not encode product/system names (no `reinex_*`, `tuttiud_*`, `tutrate_*` table prefixes).

---

## 1. High-level understanding

### 1.1 What TutTiud does today (based on this repo snapshot)

From the repository docs and code structure:

- **Product focus:** TutTiud is a multi-tenant “student support / session documentation” product. Its primary workflow is: instructors/admins log session reports (`SessionRecords`) for students.
- **Tenant data:** Tenant DB schema is **`tuttiud`** created via the setup wizard script in [src/lib/setup-sql.js](src/lib/setup-sql.js). Core tables include:
  - `tuttiud."Students"` with assignment to `tuttiud."Instructors"`.
  - `tuttiud."SessionRecords"` (documentation after sessions) and special flows like “loose” unassigned reports.
  - `tuttiud."Settings"` as a JSON configuration store.
  - `tuttiud."Documents"` (polymorphic document storage) in later phases.
- **Backend architecture:** Azure Functions act as a BFF under `/api/*`, with a shared helper [api/_shared/org-bff.js](api/_shared/org-bff.js):
  - Validate user JWT.
  - Check org membership in control DB.
  - Decrypt stored dedicated tenant key.
  - Create a privileged tenant Supabase client (now supports `db.schema = 'tuttiud'` or `db.schema = 'public'`).
- **Frontend architecture:** React + Vite + Tailwind + shadcn UI; feature-sliced under `src/features/`.
  - App navigation shell in [src/components/layout/AppShell.jsx](src/components/layout/AppShell.jsx) (mobile bottom tabs + desktop sidebar).
  - Routes defined in [src/main.jsx](src/main.jsx) (HashRouter).

### 1.2 What Reinex needs to do (based on the PRD)

Reinex is a multi-tenant clinic operations system for therapeutic riding/clinics that replaces Excel/paper workflows.

Core pillars:

- **Scheduling:** Weekly recurring lesson templates + generated concrete lesson instances; rescheduling, one-time bookings; conflicts; never overwrite existing instances.
- **Attendance tracking:** completed/cancelled/no-show statuses; confirmations via WhatsApp/email; instructor daily views.
- **Financial layer:** commitments (packages/HMO/private) and per-lesson consumption; cancellation charging rules and HMO-specific logic.
- **Payroll:** per-lesson earnings (rate_used + payout_amount) stored in lesson-based earnings tables; optional sync/export into `public.WorkSessions` for the existing payroll pipeline while keeping the two models separate but linkable.
- **Forms:** onboarding forms with OTP verification + logging + alert flags and visibility rules.
- **Waiting list:** prioritize and match open slots.
- **Security:** soft-delete everywhere, audit trail, OTP logging, versioning for templates and undo mechanisms.

### 1.3 Main domain differences (Tuttiud vs Reinex)

- **Entity of truth:**
  - TutTiud’s “truth” is the *documentation record* (`SessionRecords`) with optional inferred schedule.
  - Reinex’s “truth” is the *scheduled occurrence* (`LessonInstances`) with participation + attendance + derived documentation state.
- **Scheduling model:**
  - TutTiud: simple student defaults used mainly for compliance heatmap.
  - Reinex: recurring templates + generated instances, conflict detection, diff preview, and undo.
- **Money model:**
  - TutTiud: `service_context` is mostly a label.
  - Reinex: commitments + consumption ledger + cancellation fees + HMO rules + overrides.
- **Payroll model:**
  - TutTiud: payroll/WorkSessions is explicitly “legacy/deprecated” within this repo.
  - Reinex: payroll is a core requirement and must interoperate with the existing public payroll system (TutRate).
- **Client onboarding:**
  - TutTiud: internal staff-facing session questionnaire config.
  - Reinex: external onboarding forms with OTP security and strict legal/audit logging.
- **Messaging:**
  - TutTiud: no messaging automation.
  - Reinex: WhatsApp confirmations/reminders and templating, starting with “manual copy/paste” MVP.

---

## 2. Target architecture for Reinex

### 2.1 Backend architecture (Azure Functions)

Keep the existing “BFF + shared helpers” model, but introduce Reinex as a parallel module set that targets **tenant `public` schema**.

**Guiding rule:** Reinex endpoints must not change the behavior of existing TutTiud endpoints.

#### Proposed API folder layout

- `api/_shared/`
  - Keep: `org-bff.js`, `supabase-admin.js`, `http.js`, `audit-log.js`, `permissions-utils.js`, validation helpers.
  - Add:
    - `schema-routing.js` (or similar): selects tenant schema (`tuttiud` vs `public`) per endpoint.
    - `reinex-domain/` utilities:
      - `reinex-pricing.js` (charging rules evaluator)
      - `reinex-generation.js` (template→instance engine + diff)
      - `reinex-conflicts.js` (time overlap, capacity)
      - `reinex-otp.js` (OTP challenge, verification policy)
      - `reinex-visibility.js` (instructor exposure rules)
- `api/reinex-students/` (CRUD students + flags + onboarding status)
- `api/reinex-guardians/` (CRUD guardians)
- `api/reinex-student-guardians/` (link/unlink guardian relationships)
- `api/reinex-services/` (read Services + Reinex overrides)
- `api/reinex-instructors/` (read Employees + Reinex capability overlay)
- `api/reinex-lesson-templates/` (CRUD templates, versioning)
- `api/reinex-lesson-overrides/` (date overrides/cancellations)
- `api/reinex-lesson-instances/` (CRUD instances, reschedule, attendance)
- `api/reinex-generation/` (dry-run, apply, undo)
- `api/reinex-commitments/` (CRUD commitments)
- `api/reinex-consumption/` (ledger entries, balances)
- `api/reinex-earnings/` (earnings rows)
- `api/reinex-payroll-export/` (export/sync job to create/link WorkSessions rows without merging schemas)
- `api/reinex-forms/` (form builder CRUD)
- `api/reinex-form-submissions/` (external submit + OTP)
- `api/reinex-waiting-list/` (entries + match suggestions)
- `api/reinex-notifications/` (templates + manual message generation)
- `api/reinex-settings/` (keys in `public.Settings`)

#### Cross-cutting backend requirements

- **Auth & membership:** reuse existing control-plane membership checks (`org_memberships`).
- **Permissions:** reuse permission registry & org_settings.permissions model in the control DB; add Reinex-specific permission keys (see section 7).
- **Audit log:** every write that changes schedule, attendance, charging, OTP status, or payroll export should create a control-DB audit event.
- **Soft delete:** for Reinex tables, prefer `deleted boolean default false` or `is_active` flags + timestamps, rather than physical deletes.

### 2.2 Frontend architecture

#### Proposed route map (Reinex)

- `/dashboard` — operational overview (today’s load, confirmations, cancellations)
- `/calendar/day` — primary daily view
- `/calendar/week` — manager weekly overview
- `/students` — roster
- `/students/:id` — student profile (upcoming lessons, history, flags, commitments, forms)
- `/instructors/:id` — instructor page (today, week, undocumented, payroll summary)
- `/waiting-list` — waiting list entries + suggested matches
- `/commitments` — commitments overview (optional if embedded into student page only)
- `/payroll` — earnings + export
- `/forms` — form builder + publish links
- `/settings` — business hours, cancellation rules, notification templates, service rules, etc.

#### Feature slice structure

- `src/features/scheduling/` (calendar UI, templates, instances, generation diff/undo)
- `src/features/students/` (reuse base patterns, expand for guardians/commitments/forms)
- `src/features/commitments/`
- `src/features/payroll/`
- `src/features/forms/`
- `src/features/waiting-list/`
- `src/features/notifications/`
- `src/features/settings/`

### 2.3 Data layer (tenant DB public schema)

**Key principles:**

- Reinex operates on tenant `public` schema.
- **Students in tenant `public` schema are the SSOT across all products** (Reinex, TutTiud, TutRate) via `public.students`.
- TutTiud remains on `tuttiud` schema for legacy tables until migrated, but its student model is expected to move from `tuttiud."Students"` to the shared public students set over time.

#### Table set (high-level)

- Students (SSOT, shared across products), Guardians, StudentGuardians
- LessonTemplates (+ versioning), LessonTemplateOverrides
- LessonInstances, LessonParticipants
- Commitments, ConsumptionEntries (+ balances view)
- Instructor capability overlay tied to Employees/Services
- Forms, FormSubmissions, OtpChallenges
- WaitingListEntries (+ optional WaitingListMatches)
- LessonEarnings (lesson-based earnings; separate from WorkSessions but linkable)

---

## 3. Mapping from TutTiud code to Reinex

### 3.1 What can be reused from TutTiud (conceptually and technically)

- **Control-plane integration + tenant resolution:** the pattern in [api/_shared/org-bff.js](api/_shared/org-bff.js) is exactly the right base for Reinex.
- **Permission registry:** already implemented in control DB scripts; extend with Reinex flags.
- **Audit logging:** already standardized across endpoints (per AGENTS.md). Reuse for schedule/OTP/charging events.
- **Frontend AppShell + mobile-first UI primitives:** reuse the layout system, dialog footer pattern, RTL form components.
- **Docs patterns:** feature slice conventions under `src/features` and API conventions under `api/`.

### 3.2 Backend modules mapping

Existing TutTiud endpoints are primarily about:

- roster (`students-list`)
- post-session reports (`sessions`, `session-records`)
- compliance aggregations (`weekly-compliance`, `daily-compliance`)
- settings (`settings`)
- documents (`documents`, `documents-download`, `documents-check`)

Reinex equivalents:

- TutTiud `students-list` → Reinex `reinex-students` (+ guardians and flags) as the initial Reinex entrypoint into the **shared public students SSOT** (with a later TutTiud migration to the same SSOT).
- TutTiud `sessions` → Reinex `reinex-lesson-instances` update flows (attendance, completion) + optional “documentation link”
- TutTiud compliance endpoints → Reinex calendar endpoints (daily/weekly schedule + status icons)
- TutTiud `settings` → Reinex `reinex-settings` (public.Settings keys)

### 3.3 Frontend components mapping

- Reuse:
  - `AppShell` structure (but rebrand, new nav items).
  - `PageLayout`, dialog primitives, RTL forms-ui.
- Replace/avoid:
  - ComplianceHeatmap + SessionRecords-first UI as core flows.
  - Loose reports admin flows (not part of Reinex problem space).

### 3.4 Parts of TutTiud that should NOT be reused in Reinex

- “Compliance” logic based on inferred schedules from student defaults.
- Loose-session flows (unassigned documentation records).
- TutTiud-specific documents management, unless later required.

---

## 4. Database and schema plan

### 4.1 Constraints and collision strategy (public schema)

Because TutRate already uses the **tenant `public` schema**, Reinex must be designed to avoid unsafe assumptions:

- **Do not rename or repurpose existing public tables.**
- Prefer **overlay tables** keyed by existing IDs (`Employees.id`, `Services.id`).
- Use **domain-generic table names** (required). Tables must not encode product/system names.

**Naming strategy (required):**

- Use generic, domain-based names in `public` (e.g., `public.students`, `public.lesson_templates`, `public.commitments`, `public.otp_challenges`).
- A single table may serve multiple systems; naming must not imply product ownership.

**If a generic name already exists in `public` with conflicting semantics:**

- Do **not** fall back to product-prefixed names.
- First, inventory the existing table (columns + meaning) and explicitly document the conflict.
- Then choose an alternative **domain-generic** name (examples: `clinic_students`, `lesson_commitments`, `schedule_instances`) that still does not embed a product/system name.

### 4.2 Proposed Reinex tables (public schema)

Below are “exact” proposed tables and columns.

Notes:

- The tenant DB is product-agnostic. The table names below are **generic domain names** in `public`.
- `public.students` is the **SSOT across products**.
- Some tables reference shared entities like `public.Employees`, `public.Services`, and `public.WorkSessions`.

#### 4.2.1 Students

**Table:** `public.students`

This is the **tenant-wide Students SSOT** for Reinex, TutTiud, and TutRate.

- `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
- `first_name text NOT NULL`
- `middle_name text NULL`
- `last_name text NULL`
- `date_of_birth date NULL`
- `notes_internal text NULL`
- `default_notification_method text NOT NULL DEFAULT 'whatsapp' CHECK (default_notification_method IN ('whatsapp','email'))`
- `special_rate numeric NULL`
- `medical_flags jsonb NULL` (structured list; store severity + tags)
- `onboarding_status text NOT NULL DEFAULT 'not_started' CHECK (onboarding_status IN ('not_started','pending_forms','approved'))`
- `is_active boolean NOT NULL DEFAULT true`
- `created_at timestamptz NOT NULL DEFAULT now()`
- `updated_at timestamptz NOT NULL DEFAULT now()`
- `metadata jsonb NULL`

Indexes:
- `(is_active)`
- `(first_name, last_name)` (btree; optional trigram/fts later if needed)

#### 4.2.2 Guardians

**Table:** `public.guardians`

- `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
- `first_name text NOT NULL`
- `middle_name text NULL`
- `last_name text NULL`
- `phone text NULL`
- `email text NULL`
- `created_at timestamptz NOT NULL DEFAULT now()`
- `metadata jsonb NULL`

#### 4.2.3 Student–Guardian relations

**Table:** `public.student_guardians`

- `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
- `student_id uuid NOT NULL REFERENCES public.students(id)`
- `guardian_id uuid NOT NULL REFERENCES public.guardians(id)`
- `relationship text NOT NULL CHECK (relationship IN ('father','mother','self','caretaker','other'))`
  - **Required at link creation** (each student–guardian connection must include a relationship)
- `is_primary boolean NOT NULL DEFAULT false`
- `created_at timestamptz NOT NULL DEFAULT now()`

Constraints:
- `UNIQUE(student_id, guardian_id)`

#### 4.2.4 Instructor overlay (ties to public.Employees)

**Table:** `public.instructor_profiles`

- `employee_id uuid PRIMARY KEY` (FK to `public.Employees(id)` if that FK is viable; if not, enforce in API)
- `working_days int[] NULL` (0-6) or `jsonb`
- `break_time_minutes int NULL`
- `metadata jsonb NULL`

**Table:** `public.instructor_service_capabilities`

- `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
- `employee_id uuid NOT NULL` (Employees)
- `service_id uuid NOT NULL` (Services)
- `max_students int NOT NULL DEFAULT 1`
- `base_rate numeric NULL` (optional; may defer to RateHistory)
- `metadata jsonb NULL`
- `UNIQUE(employee_id, service_id)`

#### 4.2.5 Weekly lesson templates

**Table:** `public.lesson_templates`

- `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
- `student_id uuid NOT NULL REFERENCES public.students(id)`
- `instructor_employee_id uuid NOT NULL` (Employees)
- `service_id uuid NOT NULL` (Services)
- `day_of_week int NOT NULL CHECK (day_of_week BETWEEN 0 AND 6)`
- `time_of_day time NOT NULL`
- `duration_minutes int NOT NULL`
- `valid_from date NOT NULL`
- `valid_until date NULL`
- `price_override numeric NULL`
- `notes_internal text NULL`
- `flags jsonb NULL`
- `is_active boolean NOT NULL DEFAULT true`
- `version int NOT NULL DEFAULT 1`
- `supersedes_template_id uuid NULL REFERENCES public.lesson_templates(id)`
- `created_at timestamptz NOT NULL DEFAULT now()`
- `updated_at timestamptz NOT NULL DEFAULT now()`
- `metadata jsonb NULL`

**Table:** `public.lesson_template_overrides`

- `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
- `template_id uuid NOT NULL REFERENCES public.lesson_templates(id)`
- `target_date date NOT NULL`
- `override_type text NOT NULL CHECK (override_type IN ('cancel','modify'))`
- `new_instructor_employee_id uuid NULL`
- `new_service_id uuid NULL`
- `new_time_of_day time NULL`
- `new_duration_minutes int NULL`
- `note text NULL`
- `created_by uuid NULL` (control-plane user id)
- `created_at timestamptz NOT NULL DEFAULT now()`
- `UNIQUE(template_id, target_date)`

#### 4.2.6 Lesson instances (occurrences)

**Table:** `public.lesson_instances`

- `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
- `template_id uuid NULL REFERENCES public.lesson_templates(id)`
- `datetime_start timestamptz NOT NULL`
- `duration_minutes int NOT NULL`
- `instructor_employee_id uuid NOT NULL`
- `service_id uuid NOT NULL`
- `status text NOT NULL CHECK (status IN ('scheduled','completed','cancelled_student','cancelled_clinic','no_show'))`
- `documentation_status text NOT NULL DEFAULT 'undocumented' CHECK (documentation_status IN ('undocumented','documented'))`
- `created_source text NOT NULL CHECK (created_source IN ('weekly_generation','one_time','manual_reschedule','migration'))`
- `created_at timestamptz NOT NULL DEFAULT now()`
- `updated_at timestamptz NOT NULL DEFAULT now()`
- `metadata jsonb NULL`

Indexes:
- `(datetime_start)`
- `(instructor_employee_id, datetime_start)`

**Table:** `public.lesson_participants`

- `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
- `lesson_instance_id uuid NOT NULL REFERENCES public.lesson_instances(id)`
- `student_id uuid NOT NULL REFERENCES public.students(id)`
- `participant_status text NOT NULL CHECK (participant_status IN ('scheduled','attended','cancelled_student','cancelled_clinic','no_show'))`
- `price_charged numeric NULL`
- `pricing_breakdown jsonb NULL`
- `commitment_id uuid NULL` (FK → commitments)
- `documentation_ref jsonb NULL` (bridge to TutTiud SessionRecords or Reinex docs)
- `metadata jsonb NULL`
- `UNIQUE(lesson_instance_id, student_id)`

#### 4.2.7 Commitments & consumption

**Table:** `public.commitments`

- `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
- `student_id uuid NOT NULL REFERENCES public.students(id)`
- `service_id uuid NOT NULL`
- `total_amount numeric NOT NULL`
- `created_at timestamptz NOT NULL DEFAULT now()`
- `expires_at timestamptz NULL`
- `metadata jsonb NULL` (payer type, HMO provider, quotas, Form17, etc.)

**Table:** `public.consumption_entries`

- `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
- `lesson_participant_id uuid NOT NULL REFERENCES public.lesson_participants(id)`
- `commitment_id uuid NULL REFERENCES public.commitments(id)`
- `amount_charged numeric NOT NULL`
- `created_at timestamptz NOT NULL DEFAULT now()`
- `metadata jsonb NULL`

**View:** `public.commitment_balances` (computed)

- `commitment_id`
- `total_amount`
- `consumed_amount`
- `remaining_balance`

#### 4.2.8 Earnings & payroll

**Table:** `public.lesson_earnings`

- `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
- `employee_id uuid NOT NULL`
- `lesson_instance_id uuid NOT NULL REFERENCES public.lesson_instances(id)`
- `rate_used numeric NOT NULL`
- `payout_amount numeric NOT NULL`
- `work_session_id uuid NULL` (optional link to `public.WorkSessions(id)`; populated when a payroll sync creates/associates a WorkSessions row)
- `created_at timestamptz NOT NULL DEFAULT now()`
- `metadata jsonb NULL`

Payroll bridging and linkage (Phase 4):

- **Separation of concerns:** Reinex computes and stores lesson-based earnings in `public.lesson_earnings`. The existing payroll flow continues to use `public.WorkSessions` for global/hourly/non-lesson entries.
- **Linking (choose one or both patterns):**
  - Pattern A (lesson earnings → payroll): `public.lesson_earnings.work_session_id` points to the created/associated `public.WorkSessions` row.
  - Pattern B (payroll → lesson earnings): additive nullable columns on `public.WorkSessions` such as `source_system` and `source_ref` (e.g., `source_system='reinex'`, `source_ref=<lesson_earnings.id>`).
- A later sync/export job may create WorkSessions rows for eligible lesson earnings and write linkage in one or both directions for reconciliation and traceability.

#### 4.2.9 Forms, submissions, OTP

**Table:** `public.forms`

- `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
- `name text NOT NULL`
- `description text NULL`
- `form_schema jsonb NOT NULL`
- `alert_rules jsonb NULL`
- `visibility_rules jsonb NULL`
- `created_by uuid NOT NULL` (control-plane user id)
- `updated_at timestamptz NOT NULL DEFAULT now()`
- `is_active boolean NOT NULL DEFAULT true`

**Table:** `public.form_submissions`

- `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
- `form_id uuid NOT NULL REFERENCES public.forms(id)`
- `student_id uuid NOT NULL REFERENCES public.students(id)`
- `answers jsonb NOT NULL`
- `alert_flags jsonb NULL`
- `otp_metadata jsonb NOT NULL` (ip, channel, verified_at, destination)
- `submitted_at timestamptz NOT NULL DEFAULT now()`
- `reviewed_by uuid NULL`
- `metadata jsonb NULL`

**Table:** `public.otp_challenges`

- `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
- `student_id uuid NULL REFERENCES public.students(id)` (nullable until student identity is known; can be backfilled later)
- `channel text NOT NULL CHECK (channel IN ('whatsapp','email'))`
- `destination text NOT NULL`
- `token_hash text NOT NULL`
- `status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','expired','cancelled'))`
- `expires_at timestamptz NOT NULL`
- `verified_at timestamptz NULL`
- `attempts int NOT NULL DEFAULT 0`
- `ip text NULL`
- `metadata jsonb NULL`

Status behavior:

- On creation: `status = 'pending'`.
- On successful verification: set `status = 'verified'` and set `verified_at`.
- When TTL passes without verification: set `status = 'expired'` (lazily on read, or via a maintenance job).
- If explicitly revoked/invalidated: set `status = 'cancelled'`.

Consumers should rely on the `status` field as the primary indicator (fast filtering), with `verified_at` kept mainly for audit.

Student history:

- Because challenges can be keyed by `student_id`, the student profile can show recent OTP-based actions (verification history) and administrators can review OTP activity per student.

#### 4.2.10 Waiting list

**Table:** `public.waiting_list_entries`

- `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
- `student_id uuid NOT NULL REFERENCES public.students(id)`
- `desired_service_id uuid NOT NULL`
- `preferred_days int[] NULL`
- `preferred_times jsonb NULL`
- `instructor_preferences uuid[] NULL`
- `willing_to_pay_premium boolean NOT NULL DEFAULT false`
- `priority_flag boolean NOT NULL DEFAULT false`
- `priority_reason text NULL`
- `notes text NULL`
- `status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','matched','closed'))`
- `created_at timestamptz NOT NULL DEFAULT now()`
- `metadata jsonb NULL`

### 4.3 Backwards-compatibility and cross-system integration

#### 4.3.1 Reinex does not break TutTiud

- Reinex domain tables are new in public schema; TutTiud remains on tuttiud schema for legacy tables.
- **Students are the intentional exception:** Students move to tenant `public` schema as SSOT, and TutTiud will gradually migrate off `tuttiud."Students"`.
- The only shared layer is control DB permissions/audit/memberships.

#### 4.3.2 TutTiud ↔ Reinex linking

If TutTiud needs to “document” a Reinex lesson (immediate interop):

- Store linkage in TutTiud `tuttiud."SessionRecords".metadata`:
  - `reinex.lesson_instance_id`
  - `reinex.lesson_participant_id`
  - `reinex.datetime_start`
  - `reinex.service_id`
- Optionally add nullable columns to TutTiud schema later (additive) for faster joins.

TutTiud → public Students migration (gradual):

- Step 1 (link + import): Import/migrate existing `tuttiud."Students"` rows into the shared `public.students` SSOT and maintain a mapping so TutTiud can resolve legacy IDs to public student IDs.
- Step 2 (dual-read / cutover): Update TutTiud reads to use public students as authoritative while keeping legacy table for backward compatibility.
- Step 3 (full migration): Deprecate TutTiud’s independent student table as a source of truth; retain only what’s needed for historical linkage.

#### 4.3.3 Sharing Employees/Services with TutRate

- Treat `public.Employees` and `public.Services` as shared, authoritative entities.
- Do not embed Reinex-specific fields into them initially; use overlay tables (`instructor_service_capabilities`, etc.).
- If both systems later align, add columns additively with defaults.

---

## 5. Scheduling & generation engine design

### 5.1 Weekly templates model

Requirements addressed:

- Multiple services per student per week → multiple templates per student.
- Validity windows → `valid_from`, `valid_until`.
- Instructor replacement and “from next week onward” changes → create a new template effective next week, set old template `valid_until`.
- Undo safety mechanism → generation runs are tagged and undoable.

Template change policy:

- **Do not mutate past meaning.** Any change that should apply “from date X onward” results in:
  - Create new template row with `valid_from = X` and `supersedes_template_id = old.id`.
  - Update old template `valid_until = X - 1`.

### 5.2 Lesson instances model

Hard requirements addressed:

- Instance must not be overwritten by generation.
- Must support one-time lesson in a slot normally occupied by someone else.
- Manual edits with audit.
- Conflict surfacing.

Design:

- `lesson_instances` is the calendar “slot”.
- `lesson_participants` attaches student(s) to that slot.
- Manual rescheduling is implemented as:
  - update instance datetime/instructor/service OR create new instance and mark old as cancelled.
  - In all cases, preserve audit log record of change.

### 5.3 Weekly generation job

#### Automated weekly job

- Runs on schedule (e.g., Sunday 03:00).
- Generates 14 days ahead.
- Does not overwrite existing instances.
- Skips cancelled dates from overrides.
- Applies template changes only for dates within each template validity window.
- Supports dry-run mode.

Algorithm (conceptual):

1. Determine target date range `[today, today+14d]`.
2. Load active templates whose validity overlaps the range.
3. For each date in range:
   - For each template that applies on that weekday:
     - Apply overrides for that template/date (cancel or modify fields).
     - Compute `datetime_start`.
     - Check if a matching instance already exists:
       - If exists, do not overwrite.
       - If not, propose insert.
     - Check conflicts:
       - Student overlapping other participant bookings.
       - Instructor overlap.
       - Capacity (max_students for that instructor/service).
4. Produce diff:
   - `to_insert_instances`, `to_insert_participants`, `conflicts[]`.
5. If apply:
   - Insert instances/participants in a transaction.
   - Tag `metadata.generation_run_id` on created rows.
   - Emit audit event with counts.

#### Manual “Generate week” UI

- Admin triggers generation for selected week.
- Backend returns dry-run diff.
- UI shows before/after and conflicts.
- Admin confirms apply.

#### Undo of a specific generation run (short window)

Each generation run is tagged with a unique `generation_run_id` stored in `metadata` on both `public.lesson_instances` and `public.lesson_participants`.

Undo is allowed for a short time window (e.g., X minutes) and must be **strictly safe**:

Undo may ONLY delete instances/participants that meet **all** of the following:

- Created by that specific generation run (same `metadata.generation_run_id`).
- Future-only: `datetime_start` strictly greater than now (or an org-configured cutoff).
- Neutral statuses only:
  - `lesson_instances.status = 'scheduled'`
  - `lesson_participants.participant_status = 'scheduled'`
- No documentation:
  - `lesson_instances.documentation_status = 'undocumented'`
- No downstream processing:
  - No consumption entries linked (directly or via participant).
  - No earnings rows linked (directly or via instance).
- Not manually edited/overridden:
  - No non-generation metadata flags indicating manual edits (e.g., `metadata.manual_override = true`).

Undo must never touch completed, cancelled, or partially processed lessons. If any safety condition fails, those rows are skipped; the system reports a partial undo and logs the result to the audit log (counts deleted vs skipped + reasons).

#### Reset Forward from date D (safe regeneration)

Reset Forward is a deliberate, surgical operation to “rebuild only the future generated schedule that is still untouched and safe, from date D onward.” It must **not** blindly delete all future lessons.

Input:

- Date `D` (and optionally an org-configurable offset/cutoff).
- A set of templates that changed (explicitly selected or derived from version/supersession).

Algorithm (conceptual):

1. Identify candidate future instances where `datetime_start >= D`.
2. Filter to only instances originally created by generation:
   - `created_source = 'weekly_generation'`.
3. Filter to only safe instances/participants:
   - Instance status `scheduled` only.
   - Participant status `scheduled` only.
   - Documentation remains `undocumented`.
   - No consumption entries.
   - No lesson earnings rows.
   - Not marked as manually overridden/edited (e.g., `metadata.manual_override = true`).
4. Delete only the safe subset in a transaction.
5. Run generation for the target date range, inserting new instances/participants according to the latest templates.

Hard rule:

- Completed, cancelled, partially charged, earnings-linked, or manually edited lessons are **never** removed by Reset Forward. They stay as-is and may cause local differences between templates and reality.

### 5.4 Status updates and charging rules

State transitions:

- WhatsApp confirmation “I’m coming” → keep `scheduled` but mark confirmed in metadata.
- “I’m not coming” → set participant status to `cancelled_student` and compute cancellation charge if applicable.
- Clinic cancellation → `cancelled_clinic` with 0 charge.
- Completion → mark instance `completed`, participant `attended`, generate consumption + earnings.
- No-show → participant `no_show` and compute charge per rules.

Charging engine inputs:

- Org settings: cancellation windows, HMO splits, medical note quotas.
- Per student: `special_rate`.
- Per template: `price_override`.
- Per instance: override fields in metadata.

Charging engine outputs:

- Immutable `price_charged` and `pricing_breakdown` stored on participant.
- Consumption entry inserted if charged.

---

## 6. Integration points

### 6.1 WhatsApp

MVP:

- “Manual copy/paste” message generation.
- Store templates in `public.Settings` keys (Reinex-scoped keys).
- Provide a “Copy message” button + `wa.me` deep link.

Phase 2:

- Introduce a notifications module:
  - outbound reminder scheduling
  - inbound reply parsing
  - idempotent mapping from reply → lesson participant update

### 6.2 Email

- Same as WhatsApp but lower priority.
- Reuse notifications module; channel = email.

### 6.3 GreenInvoice

- MVP: prepare invoice payloads + export.
- Phase 2: integrate API calls.
- Store API keys only in control DB org_settings (encrypted), not tenant DB.

### 6.4 TutTiud interop

- Reinex exposes read-only endpoints for lesson instances and participant status.
- TutTiud can link documentation to Reinex participants via SessionRecords.metadata.

---

## 7. Roles & permissions

### 7.1 Role capabilities (Reinex)

- Owner: full control, settings, payroll, financials.
- Admin: scheduling, financials, forms.
- Office: daily scheduling + confirmations + attendance; limited financial access.
- Instructor: see own lessons, mark attendance, basic student info per visibility rules.
- Read-only: reports only.

### 7.2 Integration with control DB permissions model

- Continue using `org_memberships.role` for coarse role.
- Add Reinex fine-grained permissions in `permission_registry` and `org_settings.permissions`.

### 7.3 Proposed new permission keys

Category `features` (examples):

- `reinex_enabled`
- `reinex_schedule_manage`
- `reinex_financials_manage`
- `reinex_financials_view`
- `reinex_payroll_manage`
- `reinex_forms_manage`
- `reinex_waiting_list_manage`
- `reinex_whatsapp_manual_enabled`
- `reinex_whatsapp_automated_enabled` (requires approval)
- `reinex_greeninvoice_enabled` (requires approval)
- `reinex_medical_flags_view` (gates sensitive info)

---

## 8. Phased refactor and implementation plan

This is designed to be incremental and non-breaking.

### Phase 0 — Reinex app identity and safe separation

- Create/modify (frontend):
  - Introduce product identity constants (name, domain, nav).
  - Update `AppShell` branding to “Reinex” and add Reinex routes.
- Create/modify (backend):
  - Add schema routing utility so Reinex endpoints target `public` schema while existing ones remain `tuttiud`.
    - Implemented in [api/_shared/org-bff.js](api/_shared/org-bff.js) via `resolveTenantClient(..., { schema })` and helpers `resolveTenantPublicClient()` / `resolveTenantTuttiudClient()`.
- Reuse: auth, org selection, permissions init.
- Risks:
  - Accidentally changing shared helper behavior used by TutTiud.

### Phase 1 — Core public schema tables (students/guardians/scheduling)

- Add SQL migrations for the `public.*` domain tables.
  - Implemented as [scripts/tenant-public-core-domain.sql](scripts/tenant-public-core-domain.sql).
- Establish tenant public Students as SSOT:
  - Create `public.students` (physical table SSOT).
  - Plan the import/mapping path from TutTiud `tuttiud."Students"` into the SSOT.
- Add minimal APIs:
  - students, guardians, student_guardians
  - instructors/services read wrappers
  - lesson_templates CRUD
- Add UX scaffolding: !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
  - Student lifecycle flow progress indicator (create → schedule/instructor → onboarding)
- Risks:
  - Name collisions; mitigate by explicitly documenting the conflict and selecting an alternative domain-generic name (no product/system prefixes).

### Phase 2 — Calendar UI + lesson instances

- Build daily calendar UI (15-minute rows, instructor columns, service colors, status icons).
- Build instance creation/reschedule flows.
- Add APIs:
  - lesson_instances list/create/update
  - lesson_participants add/remove
- Risks:
  - Timezone correctness and overlap detection.

### Phase 3 — Commitments & consumption

- Build commitment creation and consumption ledger.
- Add charging rules config UI under settings.
- Risks:
  - Correctness of remaining balances; use ledger views not mutable counters.

### Phase 4 — Earnings and payroll bridge

- Implement earnings generation on completion.
- Export/sync endpoint that may create WorkSessions rows but keeps Reinex earnings separate.
- Implement a linking mechanism (one or both): `lesson_earnings.work_session_id` and/or `public.WorkSessions.source_system/source_ref`.
- Risks:
  - Don’t break TutRate payroll semantics.

### Phase 5 — Forms & OTP onboarding

- Forms builder UI.
- External submission endpoints with OTP challenges.
- Audit all OTP events.
- OTP model includes explicit `status` and optional `student_id` linkage to support per-student OTP verification history.
- Risks:
  - Security (rate limiting, replay, impersonation).

### Phase 6 — Waiting list + matching engine

- Create waiting list UI and matching suggestions.
- Provide “create template” or “create one-time booking” actions.
- Risks:
  - Duplicate detection and template conflicts.

### Phase 7 — WhatsApp/Email automation

- Phase 7a: manual templates + copy/paste flows.
- Phase 7b: automated reminders and inbound reply parsing.
- Risks:
  - Opt-in compliance and message delivery retries.

---

## 9. Open questions and assumptions

### 9.1 Assumptions

- Tenant `public` schema already contains payroll-related tables (at least WorkSessions and LeaveBalances) as implied by [scripts/checkSchema.js](scripts/checkSchema.js).
- Control DB already supports permission registry and audit log.
- Reinex will be deployed under `reinex.thepcrunners.com` (domain routing and environment config will be handled in deployment phase).

### 9.2 Open questions to confirm before implementation

- Exact existing `public` tables in tenant DB (Employees, Services, Settings, WorkSessions, RateHistory) and their columns.
- Whether Employees/Services are per-tenant (implicit org scope) or include org_id.
- Group lessons: must we support multiple participants in MVP or can it be Phase 2?
- What constitutes “documentation” in Reinex MVP (link to TutTiud SessionRecords vs Reinex-native notes/forms).
- Which WhatsApp provider is planned for automation phase.
- GreenInvoice integration details (per org key, invoice schema, compliance).

---

## Appendix: Notes about the current repo snapshot

- The current repo is still branded and structured as TutTiud (see [README.md](README.md) and [ProjectDoc/Eng.md](ProjectDoc/Eng.md)).
- The existing tenant client creation in [api/_shared/org-bff.js](api/_shared/org-bff.js) sets `db.schema = 'tuttiud'` today; Reinex requires a parallel client targeting `public`.
- Payroll-related public tables are referenced by schema verification scripts, but their creation SQL is not present in this snapshot (they likely come from TutRate’s deployment/migrations).
