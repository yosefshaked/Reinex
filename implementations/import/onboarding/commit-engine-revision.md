# Commit Engine Revision — Reuse System APIs, `customer_type` + `is_active`

Status: IMPLEMENTING — open questions resolved, all five phases in progress.

## Locked decisions
1. **Reuse system-side APIs, per-row idempotent commit.** Replace the single-transaction
   PL/pgSQL `commit_import_chunk` RPC with a JS orchestrator that calls the existing
   domain helpers, so the import follows the exact same business rules as the rest of
   the product. We lose cross-row transactional atomicity; we gain logic parity and
   "fill-empty" for free.
2. **Collapse `active_student` / `inactive_student` into one person entity** carrying two
   user-set fields: `customer_type` (`student` | `one_time_customer`) and `is_active`.
3. **Fill-empty merge** (non-destructive) is the default on link/dedup — already the
   behavior of `createOrReuseClientProfile`.

## Why this is safe / good
- `createOrReuseClientProfile()` (`api/_shared/client-profiles.js`) already matches by
  `identity_number` and, on an existing record, **only fills blank** phone/email/tags/
  onboarding_status — never overwrites. Reusing it delivers fill-empty and identical
  dedup logic automatically.
- **Student** = `createOrReuseClientProfile` + `ensureStudentForClientProfile`.
  **One-time customer** = `createOrReuseClientProfile` only (no `students` row) — exactly
  the existing one-time-customer create path in `api/client-profiles/index.js`.
- Per-row commit is acceptable because every helper is *create-or-reuse* (idempotent by
  identity), so re-running a partially-failed chunk reuses existing records instead of
  duplicating. This satisfies the real intent of the old "atomic chunk" rule (no
  duplicates, no half-records, resumable) without a single DB transaction.

## 1. Data model (`src/lib/setup-sql.js`)
- `import_candidates.entity_type`: introduce umbrella value **`customer`**. Guarded
  `DO $$ ... $$` ALTER to drop & recreate `import_candidates_entity_type_check` allowing
  `customer, guardian, guardian_link, service, student_note`. Keep `active_student`/
  `inactive_student` in the allowed set only if we choose migration-by-compat (see §7).
- `candidate_data` gains documented keys: `customer_type` (`student`|`one_time_customer`)
  and `is_active` (boolean). No column change — these live in the JSONB.
- `commit_import_chunk` RPC: **no longer called.** Leave defined this phase; drop it (and
  its GRANT) in a cleanup commit once the JS path is proven.
- `patch_import_workspace_config` RPC: unchanged.

## 2. Analyzer (`api/import-workspaces-analyze-chunk/index.js`)
- `ENTITY_SCHEMA`: replace `active_student`/`inactive_student` with `customer`.
  Blockers: `first_name`, `last_name` (+ `identity_number` only when `is_active=false`,
  pending §9 Q1). Warnings: phone/email/date_of_birth.
- Map `customer_type` and `is_active` from the mapping (fixed value or a source column);
  default per §9 Q2. Write them into `candidate_data`.
- Emit `entity_type='customer'`. Keep idempotent upsert on `(workspace_id, source_row_id)`
  and the preserve-committed/skipped logic.

## 3. Commit engine (`api/import-commit-chunk/index.js`) — the core rewrite
Replace the `supabase.rpc('commit_import_chunk', …)` call with JS orchestration:
- Load requested candidates (org + workspace scoped). Pre-validate each: status in
  (`ready`,`skipped`), `blocking_issues_count = 0`, dependency satisfied, and the
  inactive-completeness rule (§9 Q1).
- Process in topological order: **customer → guardian / service → guardian_link →
  student_note** (committed candidates earlier in the same chunk satisfy dependencies).
- Per candidate, inside try/catch (failure does NOT abort the chunk):
  - **customer**: resolve the merge target from `decisions`:
    - `link_to_existing` + `linked_id` → update that profile id with fill-empty.
    - `create_as_new` → force-create a new profile (see §9 Q4 re: unique identity).
    - default → `createOrReuseClientProfile({...fields, is_active})`.
    - if `customer_type === 'student'` → `ensureStudentForClientProfile(...)`.
    - write `import_commit_ledger` rows for each live resource touched.
  - **guardian**: `createOrReuseGuardianByParts(...)` → ledger.
  - **guardian_link**: resolve student profile by identity + guardian by phone →
    `upsertClientGuardianLink(...)` → ledger.
  - **service**: reuse Services create/lookup logic (add a small `_shared` helper or call
    the same code path as `api/services`) → ledger.
  - **student_note**: append to `students.notes_internal` (reuse existing path) → ledger.
  - On success mark candidate `committed`; on failure mark `failed`, record the message,
    push to `failures[]`, continue.
- After the loop: flip workspace status from remaining uncommitted counts; return
  `{ committed, failed, results, failures }`.
- **Ledger idempotency under retry**: only write a ledger row when an actual create/update
  happened, OR guard with a unique index on `(candidate_id, live_resource_type,
  live_resource_id, action_taken)` so re-runs don't duplicate audit rows. (Decide in impl.)
- Keep `attachErrorTracking` + tracked 5xx responses; map per-row business errors to the
  `failures[]` payload rather than a 500.

## 4. Frontend
- **MappingEditor**: entity selector offers the person entity; expose `customer_type`
  (select) and `is_active` (toggle/dictionary) as mappable or fixed values.
- **CandidateDetailSheet**: add `customer_type` (select) and `is_active` (toggle) to the
  inline-editable fields for the `customer` entity.
- **CandidateQueue**: update `ENTITY_TYPE_LABELS`; show `customer_type` / active badges.
- **CommitStep**: `COMMIT_WAVES` → customer first; surface per-row `failures` (count +
  retry of only the failed ids); drop the all-or-nothing assumption in copy.
- **Dashboard**: existing `onCandidateUpdated` wiring stays.

## 5. Dry-run (`api/import-dry-run/index.js`)
- Align `simulateClientProfile` outcomes with fill-empty + `customer_type` (student adds a
  `students` row) + `is_active`. Still read-only; it simulates, never writes.

## 6. Bulk & SWA constraints
- The chunked frontend orchestrator + per-row commit *is* the bulk mechanism. Each row is
  several round-trips (lookup + write + student/guardian), so **reduce the commit chunk
  size from 50 → ~25** to stay well under the 30s SWA limit. Keep progress + resumability.
- Optional future optimization: set-based bulk insert for pure-create chunks (faster) —
  conflicts with per-row helper reuse, so defer unless volume demands it.

## 7. Migration / backward compatibility
- Existing staging `import_candidates` with `active_student`/`inactive_student`: simplest
  is **re-analyze** (staging data is transient and the feature is pre-release). Include a
  guarded one-shot migration as a safety net:
  `UPDATE import_candidates SET entity_type='customer', candidate_data =
  candidate_data || jsonb_build_object('customer_type','student','is_active',
  (entity_type='active_student'))` (guarded, idempotent).

## 8. Validation gates
- `npm run lint:sql` (constraint change), `npm run lint:api`, `npm run lint:error-tracking`
  (warn), `npm run lint`, `npm run build`. Update `validate-upsert-conflicts.js` if any new
  `onConflict` is introduced.

## 9. Resolved decisions (2026-06-18)
1. **Inactive completeness**: `identity_number` is ALWAYS required for `customer` entity,
   regardless of `is_active`. It is the duplicate blocker and cannot be null.
2. **Default `customer_type`**: NO default — require an explicit decision. The UI must offer
   a "set all as X" bulk action to apply one value to all rows in a source.
3. **Link to existing**: Non-destructive (fill-empty only). `is_active` and `customer_type`
   are NOT updated on the linked record. Add a grayed-out "prefer file" placeholder labeled
   "future feature" in the link UI with a note that only missing fields are filled.
4. **`create_as_new` with a duplicate identity**: Identity cannot be null — option (a).
   `create_as_new` is only available when the duplicate issue is by email/name. A
   `duplicate_identity_number` blocker must be resolved via link-to-existing or ID
   correction before the candidate can commit. Duplicate name/email is a warning only.

## 10. Suggested implementation order
1. Data-model + analyzer fields (`customer_type`, `is_active`, entity collapse).
2. Commit engine rewrite (JS orchestration, per-row, ledger idempotency).
3. Dry-run alignment.
4. Frontend (mapping, drawer, queues, commit waves + failure UI).
5. Docs (`data-model.md`, `workflow.md`) + validation gates.
