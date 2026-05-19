# Phase 1 Blueprint: Calendar Immutability, Corrections, OCC, and Dual-Layer Audit

Status: Planning document only. No implementation code included.
Date: 2026-03-29

## 1. Current-State Snapshot (What Exists Today)

1. Calendar instance updates are currently mutable through API flows in calendar and lesson-instances endpoints.
2. Calendar updates already trigger downstream sync routines for billing artifacts and instructor earnings.
3. Tenant schema already contains financial tables that can be leveraged:
- lesson_instances
- lesson_participants
- lesson_earnings
- ledger_transactions
- finance_corrections
4. Tenant schema currently does not contain a finalized payroll run concept.
5. Tenant schema currently does not contain a submitted claim batch concept.
6. Tenant schema currently does not contain a tenant-level audit log table.
7. Control DB already contains audit_log and log_audit_event() for cross-system admin/security audit.
8. Version-based optimistic concurrency is not consistently implemented on lesson_instances and lesson_participants.

## 2. Part A: Prerequisite and Gap Analysis

## 2.1 Missing Trigger Mechanism for Locking

Problem: There is no authoritative event that says "this time window or record set is financially finalized".

Minimal professional design:

1. Add payroll_runs table (tenant DB).
- Purpose: represent payroll finalization events.
- Core fields: id, period_start, period_end, status, finalized_at, finalized_by, metadata.
- Status examples: draft, finalized, cancelled.

2. Add claim_batches table (tenant DB).
- Purpose: represent claim submission events.
- Core fields: id, service_provider_id (nullable), period_start, period_end, status, submitted_at, submitted_by, metadata.
- Status examples: draft, submitted, rejected, paid, cancelled.

3. Add instance_locks table (tenant DB).
- Purpose: explicit lock linkage between finalized events and concrete lesson records.
- Core fields: id, lesson_instance_id, lock_source_type, lock_source_id, lock_reason, created_at, created_by, metadata.
- lock_source_type examples: payroll_run, claim_batch, manual_compliance_lock.

4. Add participant_locks table (tenant DB).
- Purpose: explicit lock linkage at participant level for claim-sensitive rows.
- Core fields: id, lesson_participant_id, lock_source_type, lock_source_id, lock_reason, created_at, created_by, metadata.

Why this is simplest and robust:

1. It avoids fragile runtime lock computation based only on dates.
2. It persists an immutable lock decision at finalization time.
3. It lets lock checks be deterministic and fast in triggers and APIs.
4. It prevents accidental unlock when lesson datetime/service/instructor changes later.

How finalized events link to lesson data:

1. On payroll finalization:
- Resolve candidate lesson_instances by period and payroll rules.
- Insert one row per instance into instance_locks with lock_source_type=payroll_run.

2. On claim submission:
- Resolve candidate lesson_participants (and parent instances) by claim criteria.
- Insert rows into participant_locks and optionally instance_locks with lock_source_type=claim_batch.

3. Lock state is then queryable via simple EXISTS checks on lock tables.

## 2.2 Additional Prerequisites Required Before Epic Work

1. A correction linkage table is required for append-only correction chain integrity.
- Proposed table: calendar_instance_corrections.
- Purpose: connect original locked instance/participant to correction artifact and financial deltas.

2. Tenant audit table is required for deep domain-level before/after details.
- Proposed table: tenant_audit_log.
- Control DB remains summary and compliance layer.

3. Version columns and update contract must be standardized on mutable business tables.

4. Permission extension is required for sensitive operations.
- New permissions in control DB permission registry:
- can_finalize_payroll
- can_submit_claim_batch
- can_request_locked_correction
- can_approve_locked_correction

## 3. Part B: Detailed Execution Plan (Full Stack)

## 3.1 Epic 1: Status Lock (Immutability)

Goal: prevent direct edits to financially/compliance-locked historical data.

Step-by-step plan:

1. Database schema changes.
- Create payroll_runs.
- Create claim_batches.
- Create instance_locks.
- Create participant_locks.
- Add indexes for lookup by lesson_instance_id and lesson_participant_id.

2. Database enforcement triggers.
- Add BEFORE UPDATE/DELETE trigger on lesson_instances.
- Add BEFORE UPDATE/DELETE trigger on lesson_participants.
- Trigger behavior: if corresponding lock exists, raise SQL exception with structured code and lock metadata.

3. Finalization procedures.
- Add RPC or server-side transaction flow to finalize payroll run.
- Add RPC or server-side transaction flow to submit claim batch.
- Finalization writes lock rows atomically with status transition to finalized/submitted.

4. API middleware and endpoint checks.
- In calendar update endpoints, pre-check lock tables before mutation.
- Return HTTP 423 (Locked) or 409 (Conflict) with lock source details.
- Keep DB trigger as last line of defense even if API check is bypassed.

5. UI behavior.
- In calendar/history editors, render locked badge and disable direct save.
- Show lock source summary: payroll run id, claim batch id, lock timestamp.
- Offer "Create Correction" flow instead of edit.

6. Backfill rollout.
- Migration script to create lock rows for any already-finalized historical records once finalization entities exist.

## 3.2 Epic 2: Append-Only Correction Model (Ledger Adjustments)

Goal: allow safe correction of locked records without destructive rewrite.

User flow:

1. User opens locked instance and clicks "Request Correction".
2. User provides reason code + free text explanation.
3. UI calls correction preview endpoint to compute impact.
4. UI displays impact preview:
- payroll delta
- billing/ledger delta
- claim impact flag
5. User confirms.
6. API creates correction transaction.

API transactional behavior:

1. Create calendar_instance_corrections row with status=pending or applied.
2. Do not overwrite locked row as original truth.
3. Write financial deltas as append-only records:
- finance_corrections for payroll impacts
- ledger_transactions for student balance impacts (manual_adjustment usage type)
4. If needed, create replacement operational records linked through correction metadata.
5. Persist source linkage:
- original_instance_id
- original_participant_id(s)
- lock_source references
- created adjustment IDs

Data model details:

1. Extend finance_corrections metadata to include:
- source_type=calendar_instance_correction
- source_id=<correction id>
- original_instance_id

2. Extend ledger_transactions metadata similarly:
- source_type=calendar_instance_correction
- source_id=<correction id>
- original_participant_id

3. calendar_instance_corrections should store:
- id
- original_instance_id
- correction_mode (value_only, replacement_instance, participant_adjustment)
- reason_code
- reason_text
- impact_snapshot jsonb
- approval fields
- applied_at/applied_by

Guardrails:

1. Mandatory reason code and explanation for locked corrections.
2. Optional dual approval based on impact threshold.
3. Full transaction rollback on any insert failure.

## 3.3 Epic 3: Optimistic Concurrency Control (OCC)

Goal: prevent silent last-write-wins data loss.

Tables to receive version column:

1. lesson_instances
2. lesson_participants
3. finance_corrections
4. claim_batches
5. payroll_runs
6. calendar_instance_corrections

Notes:

1. Do not add OCC to append-only ledger_transactions inserts unless update/delete operations are introduced.
2. Existing lesson_templates/forms versioning patterns can be used as reference but must be standardized for conflict semantics.

API contract:

1. Every editable resource returns version.
2. Update request must include expected version.
3. SQL update uses where id=? and version=? then increments version=version+1.
4. If 0 rows updated, return HTTP 409 with payload:
- code=version_conflict
- current snapshot
- current version

UI handling:

1. On 409, show conflict dialog with:
- server value
- user draft value
- actions: reload, overwrite-via-correction (if locked), or discard.
2. For unlocked records, user may retry with refreshed version.
3. For locked records, retry path must route to correction flow.

## 3.4 Epic 4: Dual-Layer Audit Logging

Goal: keep global control-plane audit while adding deep tenant-domain audit.

Separation model:

1. Control DB audit (existing audit_log):
- Who did what at high level.
- Security/compliance/admin trace.
- Cross-system and permission-sensitive events.

2. Tenant DB audit (new tenant_audit_log):
- Full domain details for financial/calendar mutations.
- before/after snapshots.
- lock and correction linkage.
- OCC conflict payloads.

Events that go to Control DB:

1. payroll_run.finalized
2. claim_batch.submitted
3. locked_correction.requested
4. locked_correction.approved_or_rejected
5. permission changes affecting correction/finalization powers

Events that go to Tenant DB:

1. calendar.instance.update_attempted
2. calendar.instance.update_blocked_locked
3. calendar.instance.corrected
4. lesson_participant.status_changed
5. finance_correction.created
6. ledger_transaction.adjustment_created
7. occ.version_conflict

Triggering strategy:

1. API middleware writes control DB summary events.
2. DB triggers on sensitive tenant tables write tenant_audit_log for guaranteed capture.
3. For multi-row workflows, API writes a correlation_id passed to all records and audits.

Minimum tenant_audit_log fields:

1. id
2. correlation_id
3. actor_user_id
4. event_type
5. resource_type
6. resource_id
7. before_state jsonb
8. after_state jsonb
9. details jsonb
10. created_at

## 4. Delivery Sequence (Recommended)

1. Milestone A: foundation schema and permissions.
- payroll_runs, claim_batches, lock tables, correction table, tenant_audit_log.

2. Milestone B: lock enforcement.
- DB triggers first, then API checks and UI lock messaging.

3. Milestone C: correction flow.
- preview endpoint, apply endpoint, append-only financial artifacts.

4. Milestone D: OCC standardization.
- version columns, API 409 contract, UI conflict dialogs.

5. Milestone E: dual-layer audit hardening.
- control summaries + tenant detail capture + correlation IDs.

6. Milestone F: migration/backfill and release guardrails.
- backfill lock links where possible.
- feature flag rollout by org.

## 5. Acceptance Criteria for "Go" to Phase 2

1. PM approves the lock trigger mechanism and proposed tables.
2. PM approves correction model semantics (non-destructive vs replacement strategy).
3. PM approves 409 UX behavior for OCC conflicts.
4. PM approves control-vs-tenant audit boundary.
5. PM approves delivery sequence and rollout approach.

## 6. Explicit Open Decisions Requiring PM Sign-off

1. Should locked correction require one approver or two approvers above threshold?
2. Should claim-related corrections be blocked after claim status becomes paid?
3. Should lock response code be 423 Locked or 409 Conflict for client compatibility?
4. Should replacement-instance corrections be allowed, or only monetary adjustments in Phase 2?
5. Retention policy for tenant_audit_log (mirror 7 years or shorter with archive).

## 7. Why This Plan Minimizes Bloat While Staying Production-Grade

1. Reuses existing finance_corrections and ledger_transactions instead of inventing parallel ledgers.
2. Introduces only minimal foundational entities that do not currently exist but are mandatory:
- payroll_runs
- claim_batches
- lock link tables
- correction linkage table
- tenant_audit_log
3. Keeps database as final enforcement point, with API/UI as usability layers.
4. Preserves historical truth with append-only corrections for legal and financial defensibility.
