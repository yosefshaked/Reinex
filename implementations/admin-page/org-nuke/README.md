# Smart Nuke — Complete Org Purge Tool

**Version:** manifest-v1.2  
**Scope:** System-admin console (`/system-admin/*`)  
**Access gate:** AAL2 + `profiles.is_system_admin = true` + service-role key  
**SSOT for schema:** `src/lib/setup-sql.js`

---

## 1. Overview

The Smart Nuke tool permanently and completely removes a single `organization_id` and all data it owns from the Reinex Supabase database. It is a two-step operation: **Prepare** (build a purge plan with a challenge token) → **Execute** (redeem the token and run the deletion sequence).

### When to use it

- An org was created for testing and must be cleaned up
- An org has formally requested account deletion with all data removed
- A corrupted or orphaned org must be surgically removed

### What it does NOT do

- It does **not** rely on `ON DELETE CASCADE` from the `organizations` row as its primary deletion mechanism. That approach is unreliable due to mixed cascade behaviour across 54 tables.
- It does **not** delete platform-control records (`profiles`, `permission_registry`, `admin_data`, `email_log`, `error_events`) that are not owned by the org.
- It does **not** hard-delete the `organizations` row. The root record is **tombstoned** — all sensitive columns are wiped to NULL/empty defaults and the name is rewritten to `'PURGED: <original name>'`. The UUID is preserved to maintain referential integrity for system-level logs (see Section 3 Phase 14).
- It does **not** hard-delete `audit_log` rows. Those are retention-governed and retain their `org_id` FK pointing to the tombstone row, providing a permanent archive link.
- It does **not** run as a single transaction. Volumes may be large. It uses an advisory lock + phased deletion with row counts surfaced per phase.

---

## 2. Architecture Decision: Why Hybrid Manifest + Drift Check

### Rejected approach: dynamic pg_catalog traversal

A dynamic approach that reads `pg_constraint` at runtime to build the deletion order was rejected because:

1. **FK graph ≠ logical data ownership.** Many FKs point to `auth.users` or cross-reference within the org, not upward to `organizations`. A pure FK graph produces wrong ordering.
2. **Mixed cascade behaviour.** Some tables have `ON DELETE CASCADE`, some `ON DELETE RESTRICT`, some no constraint. Treating them uniformly causes silent data loss or constraint violations.
3. **Storage artifacts are invisible to pg_catalog.** `public."Documents"` rows hold `path` values in Supabase Storage that must be removed separately before the DB row is deleted.
4. **Retention tables must not be hard-deleted.** `audit_log`, `impersonation_sessions`, and `email_log` have legal/compliance retention requirements.
5. **Large-transaction risk.** A single DELETE on `organizations` + cascades inside one transaction can time out or cause replication lag on large orgs.

### Approved approach: Versioned Purge Manifest + Drift Check Validator

- **Purge Manifest** (this document, Section 3): The human-authored, version-controlled contract that defines the exact deletion order, strategy, and retention class for every table.
- **Drift Check Validator** (Section 5): Runs against `pg_catalog` at prepare-time to detect tables that exist in the live DB but are missing from the manifest, or tables in the manifest that no longer exist. The validator _never drives_ the deletion order — it only gates the prepare step.
- **Two-Step Workflow** (Section 6): `prepare` builds the plan and returns a challenge; `execute` consumes the challenge and runs the manifest phases sequentially.

---

## 3. Purge Manifest v1

This manifest is the **authoritative contract** for what gets deleted, in what order, and how. Any schema change that adds an org-scoped table **must** update this manifest before the new table goes to production.

### 3.1 Classification key

| Field | Values |
|-------|--------|
| `ownership` | `tenant` — org-scoped data to be purged; `platform` — cross-tenant/system data to retain or archive |
| `strategy` | `hard_delete` — explicit `DELETE … WHERE org_id = $1`; `cascade_via_fk` — deleted implicitly by a parent `hard_delete` in the same wave (listed for completeness); `storage_then_delete` — delete Storage files then DB row; `tombstone` — UPDATE the row to wipe all sensitive columns, preserve the UUID and rewrite the name; `retain` — do not touch; `fk_points_to_tombstone` — FK to organizations is preserved; the tombstone row satisfies referential integrity |
| `retention` | `none` — no retention required; `archive_7y` — legal hold, do not delete; `soft` — not applicable (data retained by platform) |
| `phase` | Execution wave. Lower phases run first. |

### 3.2 Platform tables (not deleted)

These tables are **not touched** by the purge. They are listed here for completeness and to allow the drift-check validator to ignore them.

| Table | Reason | strategy |
|-------|--------|----------|
| `public.profiles` | Linked to `auth.users(id)`, not to `organizations`. User identity persists after org deletion. | `retain` |
| `public.permission_registry` | Global reference data, no `org_id` column. | `retain` |
| `public.admin_data` | System-admin console store. No `org_id` FK to `organizations`. | `retain` |
| `public.email_log` | Platform outbound email log. `org_id` is nullable, no hard FK constraint. Archived, never hard-deleted. | `retain` |
| `public.error_events` | Operational support/debug events. `org_id REFERENCES organizations(id) ON DELETE SET NULL`. Rows are retained until their 90-day expiry; `org_id` continues to point to the tombstone row while retained. | `fk_points_to_tombstone` |
| `public.audit_log` | Compliance/legal log. `org_id REFERENCES organizations(id) ON DELETE SET NULL`. Rows are retained; `org_id` continues to point to the tombstone row — the FK is satisfied and the archive link is preserved. | `fk_points_to_tombstone` |
| `public.impersonation_sessions` | Admin audit trail. `target_org_id REFERENCES organizations(id) ON DELETE SET NULL`. Rows are retained; FK points to the tombstone row. | `fk_points_to_tombstone` |

### 3.3 Tenant tables — ordered purge manifest

Phases run sequentially. Within a phase, tables run in the listed row order. Each table must complete (row count = 0 for the org) before the next phase begins.

#### Phase 1 — Lock records (must be removed before locked rows can be deleted)

| # | Table | FK dependencies | Notes |
|---|-------|-----------------|-------|
| 1.1 | `public.instance_locks` | `lesson_instance_id → lesson_instances(id) ON DELETE CASCADE`; `org_id → organizations(id)` | Explicit delete. Removes `payroll_run` and `claim_batch` locks that would block phase-3 instance deletes. |
| 1.2 | `public.participant_locks` | `lesson_participant_id → lesson_participants(id) ON DELETE CASCADE`; `org_id → organizations(id)` | Explicit delete. |
| 1.3 | `public.calendar_instance_corrections` | `original_instance_id → lesson_instances(id) ON DELETE CASCADE`; `org_id → organizations(id)` | Explicit delete. |

#### Phase 2 — Financial leaf records

| # | Table | FK dependencies | Notes |
|---|-------|-----------------|-------|
| 2.1 | `public.ledger_transactions` | `client_profile_id → client_profiles(id) ON DELETE CASCADE`; `student_id → students(id) ON DELETE CASCADE`; `commitment_id → commitments(id) ON DELETE CASCADE` | Delete explicitly to surface row count before parents are removed. |
| 2.2 | `public.lesson_earnings` | `employee_id → "Employees"(id)`; `lesson_instance_id → lesson_instances(id)` | No cascade on FK. Must be deleted before instances and employees. |
| 2.3 | `public.hmo_invoice_batch_items` | `org_id → organizations(id)`; references `hmo_invoice_batches` | Child table; delete before `hmo_invoice_batches`. |
| 2.4 | `public.hmo_invoice_batches` | `org_id → organizations(id)` | Delete after items. |
| 2.5 | `public.payroll_runs` | `org_id → organizations(id)` | Standalone; no child tables with hard FKs. |
| 2.6 | `public.claim_batches` | `org_id → organizations(id)` | Standalone; lock rows already removed in phase 1. |
| 2.7 | `public.finance_corrections` | `employee_id → "Employees"(id)` | No cascade on FK. Delete before employees. |

#### Phase 3 — Employee attendance and leave

| # | Table | FK dependencies | Notes |
|---|-------|-----------------|-------|
| 3.1 | `public.employee_leave_balance_events` | `employee_id → "Employees"(id)`; `leave_entry_id → employee_leave_entries(id) ON DELETE SET NULL`; `leave_day_id → employee_leave_days(id) ON DELETE SET NULL` | Delete before entries and days to avoid trigger conflicts. |
| 3.2 | `public.employee_leave_days` | `leave_entry_id → employee_leave_entries(id) ON DELETE CASCADE`; `employee_id → "Employees"(id)` | Delete before entries (also covered by cascade, but explicit for auditability). |
| 3.3 | `public.employee_leave_entries` | `employee_id → "Employees"(id)` | Delete after days. |
| 3.4 | `public.employee_attendance_records` | `employee_id → "Employees"(id)` | Standalone per employee. |

#### Phase 4 — Calendar participants and instances

| # | Table | FK dependencies | Notes |
|---|-------|-----------------|-------|
| 4.1 | `public.grace_cancellation_requests` | `lesson_participant_id → lesson_participants(id)` | Delete before participants. |
| 4.2 | `public.lesson_participants` | `lesson_instance_id → lesson_instances(id)`; `client_profile_id → client_profiles(id)`; `student_id → students(id)`; `commitment_id → commitments(id)` | Lock rows already removed. Delete before instances. |
| 4.3 | `public.lesson_instances` | `template_id → lesson_templates(id)` (nullable); `instructor_employee_id → "Employees"(id)`; `service_id → "Services"(id)`; `applied_override_id → lesson_template_overrides(id)` | Lock and participant rows already removed. |

#### Phase 5 — Lesson templates and overrides

| # | Table | FK dependencies | Notes |
|---|-------|-----------------|-------|
| 5.1 | `public.lesson_template_participants` | `template_id → lesson_templates(id) ON DELETE CASCADE`; `student_id → students(id)` | Multi-student template membership SSOT. Delete before templates and students. |
| 5.2 | `public.lesson_template_overrides` | `template_id → lesson_templates(id)`; `new_instructor_employee_id → "Employees"(id)`; `new_service_id → "Services"(id)` | Delete before templates. |
| 5.3 | `public.lesson_templates` | `student_id → students(id)`; `instructor_employee_id → "Employees"(id)`; `service_id → "Services"(id)`; `supersedes_template_id → lesson_templates(id)` (self-ref) | Delete after participants, overrides, and instances. |

#### Phase 6 — HMO records (RESTRICT constraints require careful ordering)

| # | Table | FK dependencies | Notes |
|---|-------|-----------------|-------|
| 6.1 | `public.hmo_authorizations` | `student_id → students(id)`; `service_id → "Services"(id)`; `provider_id → hmo_providers(id) ON DELETE RESTRICT`; `provider_track_id → hmo_provider_tracks(id) ON DELETE RESTRICT` | Commitments reference this; delete before commitments. |
| 6.2 | `public.commitments` | `student_id → students(id)`; `service_id → "Services"(id)`; `hmo_provider_id → hmo_providers(id) ON DELETE RESTRICT`; `hmo_provider_track_id → hmo_provider_tracks(id) ON DELETE RESTRICT`; `hmo_authorization_id → hmo_authorizations(id)` | Ledger transactions already deleted in phase 2. |

#### Phase 7 — Forms and waiting list

| # | Table | FK dependencies | Notes |
|---|-------|-----------------|-------|
| 7.1 | `public.form_shared_block_links` | `form_id → forms(id) ON DELETE CASCADE`; `shared_block_id → shared_form_blocks(id) ON DELETE CASCADE` | Delete before forms. |
| 7.2 | `public.form_submissions` | `form_id → forms(id)`; `client_profile_id → client_profiles(id)`; `student_id → students(id)`; `submitted_by_guardian_id → guardians(id)` | Delete before forms, clients, students, guardians. |
| 7.3 | `public.otp_challenges` | `client_profile_id → client_profiles(id)`; `student_id → students(id)` | Delete before clients and students. |
| 7.4 | `public.waiting_list_entries` | `client_profile_id → client_profiles(id)`; `student_id → students(id)`; `desired_service_id → "Services"(id)`; `latest_submission_id → form_submissions(id)` | Delete before clients, students, and submissions. |
| 7.5 | `public.forms` | `org_id → organizations(id)` | After link records and submissions. |
| 7.6 | `public.shared_form_blocks` | `org_id → organizations(id)` | After link records. |

#### Phase 8 — Documents (storage-aware)

| # | Table | FK dependencies | Strategy | Notes |
|---|-------|-----------------|----------|-------|
| 8.1 | `public."Documents"` | `org_id → organizations(id)` | `storage_then_delete` | **List all `path` values for `org_id` first. Delete from Supabase Storage bucket. Then DELETE rows.** The `path` column holds the storage object path. If storage deletion fails for a file, log the failure and continue — orphaned storage files are cleaned by a reconciliation job; they must not block DB purge. See Section 8 for full handler spec. |

#### Phase 9 — Org settings and dashboard tasks

| # | Table | FK dependencies | Notes |
|---|-------|-----------------|-------|
| 9.1 | `public.dashboard_tasks` | `org_id → organizations(id)` | Standalone. |
| 9.2 | `public."Settings"` | `org_id → organizations(id)` | Standalone. |
| 9.3 | `public.ledger_accounts` | `org_id → organizations(id)` | v2 ledger chart-of-accounts. Ledger transactions already deleted. |

#### Phase 10 — Instructor profiles

| # | Table | FK dependencies | Notes |
|---|-------|-----------------|-------|
| 10.1 | `public.instructor_service_capabilities` | `employee_id → "Employees"(id)`; `service_id → "Services"(id)` | Delete before employees and services. |
| 10.2 | `public.instructor_profiles` | `employee_id → "Employees"(id)` | Delete before employees. |
| 10.3 | `public."RateHistory"` | `employee_id → "Employees"(id)`; `service_id → "Services"(id)` | Delete before employees and services. |

#### Phase 11 — HMO provider hierarchy (RESTRICT constraints)

| # | Table | FK dependencies | Notes |
|---|-------|-----------------|-------|
| 11.1 | `public.hmo_provider_tracks` | `provider_id → hmo_providers(id) ON DELETE RESTRICT`; `service_id → "Services"(id)` | All referencing records (commitments, authorizations) are deleted in phases 6+. Delete before providers. |
| 11.2 | `public.hmo_providers` | `org_id → organizations(id)` | After tracks deleted. |

#### Phase 12 — Core client and student entities

| # | Table | FK dependencies | Notes |
|---|-------|-----------------|-------|
| 12.1 | `public.students` | `org_id → organizations(id)`; `client_profile_id → client_profiles(id)` (added via ALTER TABLE) | Lesson templates, participants, commitments, HMO authorizations all deleted in earlier phases. |
| 12.2 | `public.client_guardians` | `org_id → organizations(id)`; `client_profile_id → client_profiles(id)`; `guardian_id → guardians(id)` | Delete before client_profiles and guardians. |
| 12.3 | `public.guardians` | `org_id → organizations(id)` | After client_guardians and form_submissions deleted. |
| 12.4 | `public.client_profiles` | `org_id → organizations(id)` | All FK references deleted in earlier phases. |

#### Phase 13 — Employee and service roots

| # | Table | FK dependencies | Notes |
|---|-------|-----------------|-------|
| 13.1 | `public."Employees"` | `org_id → organizations(id)` | All employee-referencing tables deleted in earlier phases. |
| 13.2 | `public."Services"` | `org_id → organizations(id)` | All service-referencing tables deleted in earlier phases. |

#### Phase 14 — Org root (tombstone)

| # | Table | FK dependencies | Strategy | Notes |
|---|-------|-----------------|----------|-------|
| 14.1 | `public.active_routing` | `org_id → organizations(id) ON DELETE CASCADE` | `hard_delete` | Explicit delete before tombstone write for auditability. |
| 14.2 | `public.org_invitations` | `org_id → organizations(id) ON DELETE CASCADE` | `hard_delete` | Explicit delete before tombstone write. |
| 14.3 | `public.org_memberships` | `org_id → organizations(id) ON DELETE CASCADE` | `hard_delete` | Explicit delete before tombstone write. |
| 14.4 | `public.organizations` | Root record | `tombstone` | **Tombstone last.** Run `UPDATE public.organizations SET ... WHERE id = $orgId`. Preserves the UUID so `audit_log.org_id` and `impersonation_sessions.target_org_id` FKs continue to resolve to the now-dead stub. See Section 14.5 for the exact UPDATE statement. |

#### Phase 14.5 — Tombstone UPDATE contract

The `organizations` row is rewritten to a zero-data-footprint stub:

```sql
UPDATE public.organizations
SET
  name                 = 'PURGED: ' || name,
  slug                 = 'purged-' || id::text,
  setup_completed      = false,
  verified_at          = NULL,
  permissions          = '{}'::jsonb,
  logo_url             = NULL,
  storage_profile      = '{}'::jsonb,
  storage_grace_ends_at = NULL,
  backup_history       = '[]'::jsonb,
  policy_links         = NULL,
  legal_settings       = NULL,
  metadata             = NULL,
  updated_at           = now()
WHERE id = $1;
```

**Preserved columns** (intentional — read the reasoning before changing):

| Column | Reason |
|--------|--------|
| `id` | Primary key. Preserved so all FK references in `audit_log`, `impersonation_sessions`, etc. remain valid. |
| `created_by` | NOT NULL FK to `auth.users`. The user account may still exist independently. Kept to avoid orphaned FK violation. |
| `created_at` | Historical timestamp — not personal data. |

**Self-identifying archive requirement:** The `original_org_name` (captured before the tombstone write) must be stamped into:
1. The root of the JSON export/backup payload as `"org_name": "<original name>"`.
2. The backup file name: `org-purge-<slug>-<ISO8601-date>.json`.
3. The `before_state` object in the `audit_log` entry.

---

## 4. Manifest Table Count

| Phase | Tables | Description |
|-------|--------|-------------|
| 1 | 3 | Lock records |
| 2 | 7 | Financial leaf records |
| 3 | 4 | Employee attendance & leave |
| 4 | 3 | Calendar participants & instances |
| 5 | 3 | Lesson templates, participants & overrides |
| 6 | 2 | HMO records |
| 7 | 6 | Forms & waiting list |
| 8 | 1 | Documents (storage-aware) |
| 9 | 3 | Settings, dashboard tasks, ledger accounts |
| 10 | 3 | Instructor profiles & rate history |
| 11 | 2 | HMO provider hierarchy |
| 12 | 4 | Core client/student entities |
| 13 | 2 | Employee & service roots |
| 14 | 4 | Org root — 3 hard deletes + 1 tombstone |
| **Total** | **47 tables touched** | 46 hard-deleted + 1 tombstoned |

**7 platform tables retained:** `profiles`, `permission_registry`, `admin_data`, `email_log`, `error_events` (FK → tombstone), `audit_log` (FK → tombstone), `impersonation_sessions` (FK → tombstone).

Total manifest coverage: **54 tables** = 46 hard-deleted + 1 tombstoned (`organizations`) + 7 platform.

---

## 5. Drift Check Validator

The validator runs **before** the purge plan is returned to the caller (inside the `prepare` handler). It does **not** drive the deletion order — it only gates the operation when drift is detected.

### 5.1 Check definitions

| # | Check | Failure action |
|---|-------|----------------|
| C1 | **Coverage:** All tables in the live DB with an `org_id` column referencing `public.organizations(id)` must appear in the manifest. | Block prepare; return `{ check: 'C1_COVERAGE_GAP', missing_from_manifest: [...] }` |
| C2 | **Manifest existence:** All tenant tables listed in the manifest must physically exist in the live DB. | Block prepare; return `{ check: 'C2_MANIFEST_GHOST', missing_from_db: [...] }` |
| C3 | **FK behaviour audit:** For each tenant table in the manifest, verify the `org_id → organizations(id)` FK action matches expectations. Tables expected to have `CASCADE` must have `CASCADE`; `RESTRICT` tables must not have silently changed to `CASCADE` (which would alter safe ordering). | Warn only (do not block). Return `{ check: 'C3_FK_DRIFT', warnings: [...] }` in plan metadata. |
| C4 | **Retention table guard:** The six platform tables (`profiles`, `permission_registry`, `admin_data`, `email_log`, `audit_log`, `impersonation_sessions`) must NOT appear as org-FK-referenced tables in pg_catalog with `ON DELETE CASCADE`. | Block prepare; return `{ check: 'C4_RETENTION_CASCADE_RISK', affected: [...] }` |
| C5 | **External artifact check:** `public."Documents"` must exist and have a `path` column of type `text`. If the table or column is missing, the storage handler cannot run. | Block prepare; return `{ check: 'C5_STORAGE_HANDLER_BROKEN' }` |
| C6 | **Preflight row count:** Count total tenant rows across all manifest tenant tables for the target org. Return counts per table in the plan. If any table that should be empty (e.g. `instance_locks`, `participant_locks`) has rows, surface as a warning in the plan so the operator can review before executing. | Never block — informational only. Counts included in `prepare` response. |
| C7 | **Backup guard:** Verify that a backup of the org exists and was created within the last 30 days (check `organizations.backup_history` JSONB array). If no recent backup exists, block the prepare with `{ check: 'C7_NO_RECENT_BACKUP', last_backup_at: null }`. | Block prepare unless `force_skip_backup_check: true` is passed in the request (requires explicit acknowledgement). |

### 5.2 SQL catalog queries for each check

#### C1 — Coverage gap (tables in DB not in manifest)

```sql
-- Returns tables that have an org_id FK to organizations but are NOT in the known manifest list.
-- Run with service_role. Substitute :manifest_tables with the array of known manifest table names.
SELECT
  c.table_name,
  c.column_name,
  rc.update_rule,
  rc.delete_rule
FROM information_schema.referential_constraints rc
JOIN information_schema.key_column_usage kcu
  ON kcu.constraint_name = rc.constraint_name
  AND kcu.constraint_schema = rc.constraint_schema
JOIN information_schema.columns c
  ON c.table_schema = kcu.table_schema
  AND c.table_name = kcu.table_name
  AND c.column_name = kcu.column_name
JOIN information_schema.constraint_column_usage ccu
  ON ccu.constraint_name = rc.unique_constraint_name
  AND ccu.constraint_schema = rc.unique_constraint_schema
WHERE kcu.table_schema = 'public'
  AND c.column_name = 'org_id'
  AND ccu.table_name = 'organizations'
  AND kcu.table_name NOT IN (
    -- Inline the manifest table list here (or pass as array from JS)
    'instance_locks','participant_locks','calendar_instance_corrections',
    'ledger_transactions','lesson_earnings','hmo_invoice_batch_items',
    'hmo_invoice_batches','payroll_runs','claim_batches','finance_corrections',
    'employee_leave_balance_events','employee_leave_days','employee_leave_entries',
    'employee_attendance_records','grace_cancellation_requests','lesson_participants',
    'lesson_instances','lesson_template_overrides','lesson_templates',
    'hmo_authorizations','commitments','form_shared_block_links','form_submissions',
    'otp_challenges','waiting_list_entries','forms','shared_form_blocks',
    'dashboard_tasks','Documents','Settings','ledger_accounts','instructor_service_capabilities',
    'instructor_profiles','RateHistory','hmo_provider_tracks','hmo_providers',
    'students','client_guardians','guardians','client_profiles',
    'Employees','Services','active_routing','org_invitations','org_memberships','organizations',
    -- Platform retain list (these appear in pg_catalog but are intentionally excluded)
    'audit_log','impersonation_sessions','email_log'
  )
ORDER BY c.table_name;
```

#### C2 — Manifest ghost (tables in manifest not in DB)

```sql
-- Returns which manifest table names do not exist in information_schema.
-- In JS: run pg_tables query and diff against MANIFEST_TABLES array.
SELECT tablename
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename = ANY(:manifest_tables_array);
-- The missing ones are those in :manifest_tables_array but NOT in this result.
```

#### C3 — FK action drift

```sql
-- Returns org_id FK action for every public tenant table.
SELECT
  kcu.table_name,
  rc.delete_rule,
  rc.update_rule
FROM information_schema.referential_constraints rc
JOIN information_schema.key_column_usage kcu
  ON kcu.constraint_name = rc.constraint_name
  AND kcu.constraint_schema = rc.constraint_schema
JOIN information_schema.constraint_column_usage ccu
  ON ccu.constraint_name = rc.unique_constraint_name
  AND ccu.constraint_schema = rc.unique_constraint_schema
WHERE kcu.table_schema = 'public'
  AND kcu.column_name = 'org_id'
  AND ccu.table_name = 'organizations'
ORDER BY kcu.table_name;
```

#### C4 — Retention table cascade risk

```sql
-- Check if any retention-class table has acquired ON DELETE CASCADE on its org_id FK.
SELECT
  kcu.table_name,
  rc.delete_rule
FROM information_schema.referential_constraints rc
JOIN information_schema.key_column_usage kcu
  ON kcu.constraint_name = rc.constraint_name
  AND kcu.constraint_schema = rc.constraint_schema
JOIN information_schema.constraint_column_usage ccu
  ON ccu.constraint_name = rc.unique_constraint_name
  AND ccu.constraint_schema = rc.unique_constraint_schema
WHERE kcu.table_schema = 'public'
  AND kcu.column_name = 'org_id'
  AND ccu.table_name = 'organizations'
  AND kcu.table_name IN ('audit_log', 'impersonation_sessions', 'email_log')
  AND rc.delete_rule = 'CASCADE';
-- Result must be empty. Any row here is a C4 violation.
```

#### C5 — Storage handler check

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'Documents'
  AND column_name = 'path';
-- Must return exactly one row with data_type = 'text'.
```

#### C6 — Preflight row counts

```sql
-- Run one per manifest table. Example for lesson_instances:
SELECT COUNT(*)::bigint AS row_count
FROM public.lesson_instances
WHERE org_id = $1;
-- Repeat for all 46 tenant tables. Aggregate results in JS, not in SQL.
```

#### C7 — Backup guard

```sql
-- Read backup_history from the organizations row.
SELECT
  id,
  name,
  backup_history
FROM public.organizations
WHERE id = $1;
-- In JS: parse backup_history JSONB array, find entries within last 30 days.
-- Block if empty or all entries older than 30 days.
```

---

## 6. Two-Step Admin Workflow

```
Admin UI                           /api/org-purge/prepare          /api/org-purge/execute
   │                                        │                               │
   │──── POST /prepare { org_id } ─────────▶│                               │
   │                                        │── run C1..C7 drift checks ───▶│
   │                                        │── count rows per table         │
   │                                        │── generate plan_id (UUID)      │
   │                                        │── generate challenge token     │
   │                                        │   (HMAC-SHA256 of plan_id +    │
   │                                        │    org_id + timestamp)         │
   │◀──── 200 { plan_id, challenge, counts, warnings } ──────────────────────│
   │                                                                          │
   │  Admin reviews counts, warnings, enters org name to confirm             │
   │                                                                          │
   │──── POST /execute { plan_id, challenge, org_name_confirm } ────────────▶│
   │                                                                          │── verify challenge not expired (15 min TTL)
   │                                                                          │── verify org_name_confirm matches org.name
   │                                                                          │── acquire pg_advisory_lock(org_id_as_bigint)
   │                                                                          │── run phases 1–13 sequentially (hard deletes)
   │                                                                          │── delete Storage files (phase 8)
   │                                                                          │── phase 14: delete active_routing, invitations, memberships
   │                                                                          │── phase 14.4: tombstone UPDATE on organizations row
   │                                                                          │── write audit_log entry (org_id = tombstone UUID)
   │                                                                          │── release advisory lock
   │◀──── 200 { deleted_counts, tombstoned_org, storage_errors, duration_ms } ─│
```

### Advisory lock strategy

The advisory lock key is derived from the org UUID:

```js
// Derive a stable int64 from the org UUID for pg_advisory_lock
const lockKey = BigInt('0x' + orgId.replace(/-/g, '').slice(0, 16));
await client.rpc('pg_advisory_lock', { key: lockKey });
// ... run phases ...
await client.rpc('pg_advisory_unlock', { key: lockKey });
```

This prevents two concurrent execute calls for the same org.

---

## 7. API Contracts

### `POST /api/org-purge/prepare`

**Auth:** Bearer token → `resolveBearerAuthorization(req)` → `supabase.auth.getUser(token)` → verify `profiles.is_system_admin = true`  
**Client:** `createSingleClient(env)` (service-role)  
**Route:** `api/org-purge/index.js` with `method === 'POST'` + `action === 'prepare'`

#### Request body

```jsonc
{
  "org_id": "uuid",                      // Required. The org to purge.
  "force_skip_backup_check": false       // Optional. Set true to bypass C7 backup guard. Defaults to false.
}
```

#### Response 200 — plan ready

```jsonc
{
  "plan_id": "uuid",
  "org_id": "uuid",
  "org_name": "string",
  "challenge": "string",                 // HMAC-SHA256 hex. Valid for 15 minutes.
  "challenge_expires_at": "ISO8601",
  "row_counts": {
    "instance_locks": 0,
    "participant_locks": 0,
    "calendar_instance_corrections": 12,
    "ledger_transactions": 847,
    "lesson_earnings": 312,
    "hmo_invoice_batch_items": 0,
    "hmo_invoice_batches": 0,
    "payroll_runs": 6,
    "claim_batches": 2,
    "finance_corrections": 14,
    "employee_leave_balance_events": 88,
    "employee_leave_days": 92,
    "employee_leave_entries": 24,
    "employee_attendance_records": 430,
    "grace_cancellation_requests": 7,
    "lesson_participants": 3421,
    "lesson_instances": 1140,
    "lesson_template_overrides": 55,
    "lesson_templates": 18,
    "hmo_authorizations": 9,
    "commitments": 22,
    "form_shared_block_links": 4,
    "form_submissions": 63,
    "otp_challenges": 5,
    "waiting_list_entries": 2,
    "forms": 3,
    "shared_form_blocks": 1,
    "dashboard_tasks": 0,
    "Documents": 74,
    "Settings": 4,
    "ledger_accounts": 0,
    "instructor_service_capabilities": 8,
    "instructor_profiles": 3,
    "RateHistory": 11,
    "hmo_provider_tracks": 0,
    "hmo_providers": 0,
    "students": 15,
    "client_guardians": 9,
    "guardians": 7,
    "client_profiles": 15,
    "Employees": 3,
    "Services": 5,
    "active_routing": 0,
    "org_invitations": 2,
    "org_memberships": 4,
    "organizations": 1
  },
  "drift_warnings": [],                  // Array of C3 warning objects, if any.
  "manifest_version": "v1",
  "storage_file_count": 74              // Count of Documents.path values to be deleted from Storage.
}
```

#### Response 400 — drift check failed

```jsonc
{
  "error": "DRIFT_CHECK_FAILED",
  "checks": [
    {
      "check": "C1_COVERAGE_GAP",
      "missing_from_manifest": ["new_table_added_without_update"]
    },
    {
      "check": "C7_NO_RECENT_BACKUP",
      "last_backup_at": null,
      "hint": "Pass force_skip_backup_check: true to bypass."
    }
  ]
}
```

#### Response 404 — org not found

```jsonc
{ "error": "ORG_NOT_FOUND" }
```

---

### `POST /api/org-purge/execute`

**Auth:** Same as prepare — Bearer + `is_system_admin = true`  
**Client:** service-role

#### Request body

```jsonc
{
  "plan_id": "uuid",                     // Required. Must match a valid unexpired prepare response.
  "challenge": "string",                 // Required. The HMAC token from prepare.
  "org_name_confirm": "string"           // Required. Must exactly match organizations.name (case-sensitive).
}
```

#### Response 200 — purge complete

```jsonc
{
  "org_id": "uuid",
  "org_name": "string",
  "purged_at": "ISO8601",
  "duration_ms": 4823,
  "manifest_version": "v1",
  "deleted_counts": {
    "instance_locks": 0,
    "ledger_transactions": 847,
    // ... one entry per hard-deleted manifest tenant table
    "org_memberships": 4,
    "org_invitations": 2,
    "active_routing": 0
    // organizations is NOT in deleted_counts — it is tombstoned, not deleted
  },
  "tombstoned_org": {
    "id": "uuid",
    "original_name": "Acme Clinic",
    "tombstone_name": "PURGED: Acme Clinic",
    "tombstone_slug": "purged-<uuid>"
  },
  "storage": {
    "files_attempted": 74,
    "files_deleted": 74,
    "files_failed": 0,
    "failed_paths": []
  },
  "audit_log_event_id": "uuid"
}
```

#### Response 400 — validation failure

```jsonc
{
  "error": "EXECUTE_VALIDATION_FAILED",
  "reason": "CHALLENGE_EXPIRED" | "ORG_NAME_MISMATCH" | "CHALLENGE_INVALID" | "PLAN_NOT_FOUND"
}
```

#### Response 409 — advisory lock held (concurrent execute)

```jsonc
{
  "error": "ORG_PURGE_IN_PROGRESS",
  "hint": "Another purge for this org is currently running. Wait and retry."
}
```

---

## 8. External Artifact Handler (Supabase Storage)

`public."Documents"` stores file metadata. The actual files live in Supabase Storage under paths recorded in the `path` column.

### Handler algorithm (Phase 8)

```js
// 1. Collect all storage paths for the org
const { data: docs } = await client
  .from('Documents')
  .select('id, path')
  .eq('org_id', orgId);

const paths = docs.map(d => d.path).filter(Boolean);

// 2. Delete from Storage bucket (bucket name from env: STORAGE_DOCUMENTS_BUCKET)
// Supabase Storage supports batch remove up to 1000 objects per call.
const bucketName = env.STORAGE_DOCUMENTS_BUCKET ?? 'documents';
const BATCH_SIZE = 1000;
const failedPaths = [];
for (let i = 0; i < paths.length; i += BATCH_SIZE) {
  const batch = paths.slice(i, i + BATCH_SIZE);
  const { error } = await client.storage.from(bucketName).remove(batch);
  if (error) {
    // Log failure but do NOT abort. Storage cleanup failure must not block DB purge.
    failedPaths.push(...batch);
    console.error('[org-nuke] storage delete error', error.message, batch.slice(0, 3));
  }
}

// 3. Delete the DB rows regardless of storage outcome
await client
  .from('Documents')
  .delete()
  .eq('org_id', orgId);
```

**Storage failure policy:** Failed storage paths are recorded in the execute response under `storage.failed_paths`. A background reconciliation job (not in scope for v1) sweeps for orphaned storage paths by diffing Storage bucket listing against active `Documents` rows. Failed paths accumulate there naturally.

---

## 9. Security and Operational Guardrails

| Guardrail | Enforcement |
|-----------|-------------|
| AAL2 required | Middleware must check `amr` claim in JWT for MFA factor before reaching prepare/execute. |
| `is_system_admin` required | Always call `resolveBearerAuthorization(req)` → `supabase.auth.getUser(token)` → fetch `profiles.is_system_admin`. Reject with 403 if false. |
| Service-role only | `createSingleClient(env)` with `SUPABASE_SERVICE_ROLE_KEY`. Never use the anon key. RLS is bypassed. |
| Challenge TTL | HMAC challenge expires in **15 minutes**. After expiry, the operator must call prepare again. |
| Org name confirmation | Execute requires the operator to type the exact org name. This is the final human gate before irreversible deletion. |
| Advisory lock | Prevents two concurrent executes for the same org. Returns 409 if lock cannot be acquired. |
| Audit log entry | Write a `system_admin.org_purge_executed` event to `audit_log` with `retention_category = 'critical'` and `org_id = <tombstone UUID>` (the org row still exists as a stub — the FK is valid). Include `before_state` with `original_org_name`, total row counts, storage counts, and tombstone column snapshot. |
| No route named `admin/*` | The Azure Functions host reserves the `admin` route prefix. The route must be `/api/org-purge/*`, not `/api/admin-org-purge/*`. |
| No `resolveTenantClient()` | Deprecated. Always use `createSingleClient(env)`. |
| `respond()` for all returns | All Azure Function responses must go through `respond(context, statusCode, body)`. |
| Row-count verification | After each phase, assert that the deleted count matches the preflight count (from prepare). Log discrepancies as warnings in the execute response — do not abort. |

---

## 10. Challenge Token Implementation

The challenge is a time-bound HMAC-SHA256 token so that:
1. A prepare call can only be executed once (the token embeds the plan_id and timestamp).
2. Tokens cannot be forged by the caller.

```js
import { createHmac } from 'crypto';

const CHALLENGE_SECRET = env.ORG_PURGE_CHALLENGE_SECRET; // 32+ char random secret in Azure Function settings
const CHALLENGE_TTL_MS = 15 * 60 * 1000; // 15 minutes

export function generateChallenge(planId, orgId) {
  const ts = Date.now();
  const payload = `${planId}:${orgId}:${ts}`;
  const sig = createHmac('sha256', CHALLENGE_SECRET).update(payload).digest('hex');
  // Encode as base64url: payload + sig
  return Buffer.from(JSON.stringify({ payload, sig, ts })).toString('base64url');
}

export function verifyChallenge(token, planId, orgId) {
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
  } catch {
    return { valid: false, reason: 'CHALLENGE_INVALID' };
  }
  const { payload, sig, ts } = parsed;
  if (Date.now() - ts > CHALLENGE_TTL_MS) {
    return { valid: false, reason: 'CHALLENGE_EXPIRED' };
  }
  const expectedPayload = `${planId}:${orgId}:${ts}`;
  if (payload !== expectedPayload) {
    return { valid: false, reason: 'CHALLENGE_INVALID' };
  }
  const expectedSig = createHmac('sha256', CHALLENGE_SECRET).update(payload).digest('hex');
  // Constant-time comparison to prevent timing attacks
  if (!timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expectedSig, 'hex'))) {
    return { valid: false, reason: 'CHALLENGE_INVALID' };
  }
  return { valid: true };
}
```

The `plan_id` and `row_counts` from prepare are stored **in memory / process-local cache keyed by `plan_id`** for the 15-minute TTL. This is sufficient because the Azure Function host is single-tenant for admin operations. If multi-instance caching is needed in future, store the plan in a `admin_data` row instead.

---

## 11. Required Environment Variables

| Variable | Purpose |
|----------|---------|
| `SUPABASE_URL` | Standard Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key (bypasses RLS) |
| `ORG_PURGE_CHALLENGE_SECRET` | HMAC secret for challenge token. Must be ≥32 characters. Generate with `openssl rand -hex 32`. |
| `STORAGE_DOCUMENTS_BUCKET` | Supabase Storage bucket name for Documents. Defaults to `'documents'` if unset. |

---

## 12. File Locations

| File | Purpose |
|------|---------|
| `api/org-purge/index.js` | Azure Function handler. Routes `prepare` and `execute` sub-actions. |
| `api/org-purge/purge-manifest.js` | Exports `PURGE_MANIFEST` array (ordered phase/table records) and `PLATFORM_TABLES` set. |
| `api/org-purge/drift-check.js` | Exports `runDriftChecks(client, orgId, options)` → `{ passed, errors, warnings }`. |
| `api/org-purge/execute-phases.js` | Exports `executePhases(client, orgId, manifest)` → `{ deletedCounts, errors }`. |
| `api/org-purge/storage-handler.js` | Exports `deleteOrgStorageFiles(client, orgId, env)` → `{ attempted, deleted, failed, failedPaths }`. |
| `api/org-purge/challenge.js` | Exports `generateChallenge`, `verifyChallenge`. |
| `src/features/system-admin/pages/OrgNukePage.jsx` | Admin UI: two-step form (prepare → review counts → confirm org name → execute). |

---

## 13. Implementation Milestones

- [ ] **M1 — Purge manifest module:** Create `api/org-purge/purge-manifest.js` with the exact ordered table array from Section 3. Include `phase`, `table`, `schema_quoted` (e.g. `'"Documents"'`), `strategy`, `org_id_column` fields.
- [ ] **M2 — Drift check module:** Create `api/org-purge/drift-check.js` implementing checks C1–C7 using the SQL from Section 5.2.
- [ ] **M3 — Challenge module:** Create `api/org-purge/challenge.js` with HMAC generate/verify using constant-time comparison.
- [ ] **M4 — Execute phases module:** Create `api/org-purge/execute-phases.js`. Runs phases 1–14 sequentially. Phases 1–14.3 use `supabase.from(table).delete().eq('org_id', orgId)`. Phase 14.4 issues the tombstone UPDATE from Section 14.5 via `supabase.rpc` or a raw query. Collects deleted counts + tombstone result.
- [ ] **M5 — Storage handler module:** Create `api/org-purge/storage-handler.js` implementing the algorithm from Section 8.
- [ ] **M6 — Azure Function handler:** Create `api/org-purge/index.js`. Wire prepare (C1–C7 + row counts + challenge) and execute (verify challenge + advisory lock + phases + storage + audit log) sub-actions. Use `respond(context, ...)` and `resolveBearerAuthorization(req)`.
- [ ] **M7 — Admin UI:** Create `OrgNukePage.jsx` in `/system-admin`. Show org lookup, row count table, warning banners, org-name confirmation field, and phased progress indicator during execute.
- [ ] **M8 — Environment variables:** Add `ORG_PURGE_CHALLENGE_SECRET` to `api/local.settings.example.json` and Azure Function App settings.
- [ ] **M9 — Test:** Write an integration test in `test/` that creates a test org, seeds ≥1 row per manifest table, runs prepare, verifies counts, runs execute, and verifies all tables return 0 rows for the org.
- [ ] **M10 — Doc update:** After implementation, update `agents-docs/95-system-admin-console.md` to document the org-purge endpoints and link to this README.

---

## 14. Manifest Version History

| Version | Date | Changes |
|---------|------|---------|
| v1 | Initial | Full 52-table manifest. 46 tenant tables, 6 platform tables. 14 deletion phases. Hard-delete on organizations root. |
| v1.1 | 2026-05-03 | **Tombstone pivot.** Phase 14.4 changed from `hard_delete` to `tombstone` UPDATE on organizations row. UUID preserved for FK integrity. Added Phase 14.5 (tombstone SQL contract). Updated platform table classification for audit_log and impersonation_sessions (FK → tombstone, not SET NULL). Added self-identifying archive requirement (original org name in export, filename, and audit entry). Updated API execute response shape (tombstoned_org field). |
| v1.2 | 2026-05-14 | Added `lesson_template_participants` to Phase 5 as the multi-student template membership table. Classified `error_events` as retained platform/support data pointing to the tombstone while retained. Coverage is now 54 tables: 46 hard-deleted, 1 tombstoned, 7 retained platform tables. |

> **Important:** When a new org-scoped table is added to `src/lib/setup-sql.js`, this manifest **must be updated before the table ships to production**. Failure to do so will cause the drift check (C1) to block all future org purge operations until the manifest is updated.
