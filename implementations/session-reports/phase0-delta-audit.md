# Session Reports — Phase 0 Delta Audit

> Companion to `implementations/session-reports/implementation-plan.md`. Produced during
> Phase 0 (audit) + Phase 1 (permission gate) execution. No Phase 2 schema/code was written;
> this document only classifies existing code and specifies the Phase 2 migration SQL for a
> follow-on agent.

---

## 1. Reuse / Rewrite / Delete catalogue

Scope: `src/features/sessions/**`, `api/sessions/**`, `api/session-records/**`,
`api/loose-sessions/**`, `api/work-sessions/**` (no backend folder exists for the last one —
see below).

### Backend (`api/`)

All three existing backend endpoints write to `withOrgScope(supabase, 'SessionRecords', orgId)`.
**The `SessionRecords` table was never created** in `setup-sql.js` (confirmed by grep — zero
`CREATE TABLE ... SessionRecords` anywhere), so every one of these endpoints is currently
broken/dead in production; they only "work" in the sense that Postgres would return a table-not-
found error at runtime. None of them are called today because every frontend caller self-guards
behind the (now-removed) `SESSION_RECORDS_ENABLED = false` constant.

| Path | Verdict | Notes |
|---|---|---|
| `api/sessions/index.js` | **Rewrite** (target: new report-create endpoint on `form_submissions`) | POST-only. Full permission/role resolution logic (instructor attribution, loose-report instructor selection) references `SessionRecords`. The role-resolution branching for "who is the instructor" is worth mining for Phase 2's `lesson_instances.instructor_employee_id` derivation, but the loose/unassigned branch (`isLoose`) must be dropped per Decision #4. |
| `api/session-records/index.js` | **Rewrite** (target: report list/read endpoint) | GET-only, fetches by `student_id`. Reusable shape: joins `Employees` for instructor display name. Needs to become a `lesson_participant_id`-anchored read once Phase 2 lands. |
| `api/loose-sessions/index.js` | **Delete** | GET (`view=mine`/`view=pending`) + POST (`assign_existing`/`create_and_assign`/`reject`) all operate on the loose-report/admin-assigns workflow that Decision #4 retires outright. Also creates `Students` rows on `create_and_assign` — a side effect that has no place in the new lesson-anchored model. |
| `api/work-sessions/` (backend) | **N/A — does not exist** | No `api/work-sessions/function.json` or `index.js` in the repo. Only a frontend client stub exists (see below); there is nothing to delete on the backend. |
| `function.json` siblings for `sessions`, `session-records`, `loose-sessions` | **Delete alongside their `index.js`** | Standard Azure Functions binding files; no independent logic. |

### Frontend (`src/features/sessions/**`)

| File | Verdict | Notes / imported by |
|---|---|---|
| `api/loose-sessions.js` | **Delete in Phase 2** (patched, not removed, in Phase 1 — see §Phase 1 notes) | Client wrapper around `api/loose-sessions`. Imported by `PendingReportsPage.jsx`, `MyPendingReportsCard.jsx`, `ResolvePendingReportDialog.jsx`, `BulkResolvePendingReportsDialog.jsx`. All of those call sites are themselves slated for rewrite/delete, so this module's only remaining consumers disappear together with it in Phase 2. |
| `api/work-sessions.js` | **Delete in Phase 2** | Already a no-op stub (`throw new Error('WorkSessions API is retired...')`). Re-exported verbatim by `src/api/work-sessions.js`. No functional import sites found (grep for `work-sessions` call sites beyond the stub/re-export turned up none) — dead code today. |
| `context/SessionModalContext.jsx` | **Reuse (adapt)** | Generic open/close modal context; no SessionRecords coupling. Consumed by `AppShell.jsx` (provider) and implicitly available to any descendant. Keep as the fill-shell context for the future report drawer. |
| `hooks/useLooseReportNameSuggestions.js` | **Delete in Phase 2** | Name-based fuzzy suggestion hook purpose-built for the loose-report flow (calls `students-search`). Not needed once reports require a real `lesson_participant_id` (student identity is already known from the calendar, not typed in). |
| `utils/form-config.js` | **Delete in Phase 2** | Parses the ad hoc `session_form_config` Settings blob into a question array. Superseded by Forms builder schema (`form_schema` on `forms`). Used by `NewSessionModal.jsx`, `NewSessionForm.jsx` (indirectly via `NewSessionModal`), `PendingReportsPage.jsx`, `ResubmitRejectedReportDialog.jsx`. |
| `utils/version-helpers.js` | **Delete in Phase 2** | Wraps `version-lookup.js` + `form-config.js` to fetch questions "for a version" out of the legacy Settings blob. No import sites found outside this pair (grep found no external importers — looks like dead/unused code already, or was wired into a component this audit didn't find referencing it directly by name; regardless it's superseded by `forms.version` + `form_submissions.form_version`). |
| `utils/version-lookup.js` | **Delete in Phase 2** | Same versioned-blob lookup logic, framework-agnostic (usable server-side too, per its own doc comment) — but the blob format it parses (`session_form_config` current/history) goes away with the Forms-based design. |
| `components/PreanswersPickerDialog.jsx` | **Reuse (adapt)** | Pure UI: searches/selects from an org list + a personal list of free-text preanswers, with add/remove for the personal list. No `SessionRecords` coupling — takes `answers`/`personalAnswers` arrays as props. Directly reusable for Phase 4 (service-universal + per-employee preanswer banks), once its data source is repointed from `session_form_config`/`Employees.metadata.custom_preanswers` to `Services.metadata.report_preanswers` / `Employees.metadata.report_preanswers`. |
| `components/QuestionFieldPreview.jsx` | **Reuse (adapt)** | Pure visual/disabled-state renderer for a single question (text/textarea/number/date/select/radio/buttons/scale), driven entirely by props. Reused today by `src/components/settings/QuestionTypePreview.jsx` for the Settings question-type preview popover. Keep; the type taxonomy will need to reconcile with the Forms builder's own field-type vocabulary in Phase 3. |
| `components/NewSessionModal.jsx` | **Reuse (adapt)** | Fill-shell dialog: fetches students/instructors/services, loads `session_form_config` questions, handles submit + a "create another" success flow. Rewrite target: swap the `authenticatedFetch('sessions', ...)` POST and `session_form_config` question loading for the Phase 2 report-create endpoint + a `SectionedFormRenderer` schema from `Services.report_form_id`. The date-choice / success-footer / preanswers-integration UX is worth keeping. Imported by `AppShell.jsx`, `SessionListDrawer.jsx`, `ComplianceHeatmap.jsx` — **see finding below: these three mount it unconditionally, with no session-records/session-reports gate today.** |
| `components/NewSessionForm.jsx` | **Reuse (adapt)** | The actual form body: student picker (with day/status/instructor filters), loose-mode fields (to be deleted per Decision #4), date/time/service fields, and per-question-type field rendering (duplicates `QuestionFieldPreview`'s type switch but with live state). The non-loose parts (student picker, date/service fields, question rendering skeleton) are reusable; the entire `looseMode`/`unassignedName`/`unassignedReason`/`looseInstructorId` branch must be stripped in Phase 2/3 per Decision #4. |
| `components/RejectReportDialog.jsx` | **Delete in Phase 2** | Reason-picker dialog for rejecting a *loose* report (reasons: duplicate/wrong_filling/error/other). Tied to the loose-report workflow's reject action; the plan's resolved-questions section clarifies `reviewed_by/reviewed_at` is an informational marker only, not an approve/reject workflow, so this UX has no direct Phase 2 equivalent as-is. |
| `components/ResolvePendingReportDialog.jsx` | **Delete in Phase 2** | "Assign existing / create-and-assign" UI for loose reports; calls `assignLooseSession`/`createAndAssignLooseSession`. Entirely a loose-report artifact. |
| `components/BulkResolvePendingReportsDialog.jsx` | **Delete in Phase 2** | Bulk variant of the above. Same fate. |
| `components/ResubmitRejectedReportDialog.jsx` | **Delete in Phase 2** | Lets an instructor resubmit a rejected loose report; parses `session_form_config` questions and posts a new loose `sessions` record referencing `resubmitted_from`. Tied to both the loose workflow and the legacy question-config format. |
| `pages/PendingReportsPage.jsx` | **Rewrite** | Admin-only "pending reports" list — today literally the list of *loose/unassigned* reports (`fetchLooseSessions`), not "attended-but-undocumented lessons." Per the plan's Phase 5 redefinition, this becomes a `lesson_participants` LEFT JOIN `form_submissions` query. Keep the page shell (filters, admin-only guard, permission gate pattern — this is exactly where the new `useSessionReportsEnabled()` redirect now lives) and replace the data source + row shape + row actions (view/assign/reject → view/open-report/etc.). |
| `components/MyPendingReportsCard.jsx` | **Rewrite** | Instructor's own dashboard card of loose reports (pending/rejected/accepted tabs). Same redefinition as above: becomes "my attended lessons without a report yet," with rejected/accepted tabs dropped (no reject/assign concept survives Decision #4) in favor of a simple pending-count + list. |
| `config/session-records.js` | **Deleted in this Phase 1 pass** | Replaced by `config/session-reports-permission.js` (org-permission-backed). See §3 below. |

### Cross-cutting import site not previously called out in the plan

`src/components/settings/QuestionTypePreview.jsx` imports `QuestionFieldPreview` from
`features/sessions/components/`. This is a **Settings-page** consumer (question-type preview
popover for whatever form-question builder currently lives in Settings), unrelated to the
session-records gate. It is unaffected by the Phase 1 permission swap (no `isSessionRecordsEnabled`
usage) — flagged here only so Phase 2/3 knows `QuestionFieldPreview.jsx` cannot be deleted
alongside the rest of the session-report components without checking this importer first.

### Finding: `NewSessionModal` mounting was never gated

`src/components/layout/AppShell.jsx` (provider), `src/features/dashboard/components/
SessionListDrawer.jsx`, and `src/features/dashboard/components/ComplianceHeatmap.jsx` all import
and mount `NewSessionModal` directly, and **none of them ever called `isSessionRecordsEnabled()`**
— only the pages/cards that *link into* the feature (`StudentsPage`, `PendingReportsPage`,
`MyPendingReportsCard`) were gated. The modal component itself always existed in the render tree;
it simply had no reachable trigger because every caller of `openSessionModal()` / direct
`<NewSessionModal open={...}>` toggles lived behind an already-gated surface (dashboard heatmap
cells / session list drawer "quick documentation" actions — themselves reachable from dashboard
widgets that assume the feature is live). This audit did not find a currently-reachable, ungated
entry point into `NewSessionModal` in the *existing* build, so there is no user-facing regression
today — but Phase 1 did **not** add a `useSessionReportsEnabled()` check inside `AppShell`,
`SessionListDrawer`, or `ComplianceHeatmap`, because:
1. `NewSessionModal` itself still POSTs to the dead `api/sessions` endpoint (`SessionRecords`
   table), so it is non-functional regardless of the permission gate.
2. It is explicitly a **Reuse (adapt)** target for Phase 2/3, at which point its submit path and
   trigger points will change together.

**Recommendation for Phase 2/3:** when `NewSessionModal` is rewired to the new report-create
endpoint, gate its dashboard/AppShell mount points (or at least the buttons that call
`openSessionModal()` / render `<NewSessionModal open>`) with `useSessionReportsEnabled()` at the
same time, so the feature doesn't become silently reachable-but-broken again.

---

## 2. Internal tokenless submission path

### How a submission is created today

All submission creation in `api/form-submissions/index.js` currently flows through the
**external OTP/token model** — there is no authenticated-internal branch yet.

- `initiateSubmission` (`api/form-submissions/index.js:1180-1419`) — called via `POST
  form-submissions` (no `action` param, admin/office authenticated). Requires
  `isAdminOrOffice(role)` (line 1181). Creates a **blank** `form_submissions` row
  (`answers: {}`, `source: deliveryMethod` where `deliveryMethod` is `'whatsapp'` or `'email'`
  — line 1269-1280) plus an `otp_challenges` row and a control-tenant `active_routing` row
  carrying the OTP code (`createSubmissionAccessArtifacts`, lines 981-1045). This is the
  **admin-initiates-a-request-for-the-client-to-fill** flow, not a direct write.
- `verifySubmissionAccess` (`api/form-submissions/index.js:1769-` , dispatched at line
  2380-2384 via `POST ?action=verify`) — **fully public, unauthenticated.** Takes
  `identity_number` + `otp` in the body, looks up `active_routing` by those values. No bearer
  token is read or required in this branch at all.
- `finalizeSubmission` (`api/form-submissions/index.js:2020-2282`, dispatched at line
  2386-2391 via `PUT ?action=submit`) — **also fully public, unauthenticated.** Takes
  `submission_id` + `otp` + `answers`. Re-derives `orgId` from the `active_routing` row matched
  by `(submissionId, otp)` (line 2033-2049, `findActiveRoutingBySubmission`). Writes the final
  `answers`/`alert_flags`/`submitted_at`/`otp_metadata` onto the pre-existing blank row (lines
  2167-2191). **There is no `resolveBearerAuthorization` call anywhere in this function** — the
  only "auth" is knowledge of the submission id + a 6-digit OTP that was delivered out-of-band
  (email/WhatsApp) at `initiateSubmission` time.
- `listStudentSubmissions` / `resendSubmission` (both behind the bearer-token branch at
  `formSubmissions` line 2304-2378) are the only authenticated-session code paths in this file,
  and neither of them writes a submission — they list existing ones or resend the OTP delivery.

### Where OTP/token verification happens

Both write-capable actions that actually populate `answers` — `verify` (which only validates
identity+OTP and does not write, it just confirms) and `submit`/`finalizeSubmission` (which
does write) — authenticate exclusively via the OTP/`active_routing` mechanism, never via
`resolveBearerAuthorization`. `resolveBearerAuthorization` (imported at line 2-3, actually not
imported in this file at all — see below) is **not referenced anywhere in
`api/form-submissions/index.js`**; the bearer-token check that does exist (lines 2305-2318,
inside `formSubmissions`) uses `resolveBearerAuthorization` — correction: it *is* used, at
line 2305, only inside the `(method === 'POST' && (!action || action === 'resend')) ||
(method === 'GET' && !action)` branch, i.e. only for `initiate`/`resend`/`list`, never for
`verify`/`submit`.

### `source='internal'` support today

`'internal'` is **already a legal value** in the DB CHECK constraint —
`src/lib/setup-sql.js:2560`: `CONSTRAINT form_submissions_source_check CHECK (source IN
('web','whatsapp','internal','email','sms') OR source IS NULL)`. However, **no code path
anywhere in the repo writes `source: 'internal'`** (repo-wide grep for the literal string
`'internal'` in `.js` files returns only `setup-sql.js`). The schema anticipated this mode; the
API never implemented it.

### What a new authenticated internal write path needs (Phase 2 scope)

To add an internal, tokenless, single-shot report-submission path (an authenticated
instructor/office user submits directly, no OTP round-trip), Phase 2 needs a **new action
branch** in `api/form-submissions/index.js` (or a new sibling endpoint, per the plan's
"otherwise add an internal endpoint" fallback) that:

**Checks to reuse from the existing authenticated branch (lines 2304-2378):**
- `resolveBearerAuthorization(req)` + `controlClient.auth.getUser(authorization.token)` (lines
  2305-2318) — standard bearer auth, already used for `initiate`/`resend`/`list`.
- `resolveOrgId(req, body)` + `ensureMembership(controlClient, orgId, userId)` (lines
  2321-2347) — org scoping + membership role resolution.
- `isAdminOrOffice(role)` is the wrong check for this new path — the plan requires "instructor
  or office/admin" (i.e. **also allow plain `instructor`/`member` role**, not just
  admin/office), so a *new* authorization predicate is needed here: caller must be either
  `isAdminOrOffice(role)` **or** the specific lesson's `instructor_employee_id` (resolved via
  the caller's `Employees.user_id`), scoped to the one `lesson_participant_id` being
  documented. This is a per-resource check, not a role-only check — closer to the pattern in
  `api/sessions/index.js`'s `isMemberRole`/instructor-ownership branching (lines 126-241) than
  to the blanket `isAdminOrOffice` gate used by `initiateSubmission`.

**Checks to skip (OTP-specific, irrelevant to an authenticated internal write):**
- No `otp_challenges` row, no `active_routing` row, no `identity_number`/`otp` matching
  (`verifySubmissionAccess`'s entire body, `finalizeSubmission`'s `findActiveRoutingBySubmission`
  + `findTenantOtpChallenge` lookups).
- No delivery (`sendSubmissionDelivery` / Brevo email) — nothing to send, the user is already
  authenticated and physically present in the report drawer.
- No `expires_in_minutes` / TTL handling.

**New checks Phase 2 must add (not present in either existing flow):**
- Resolve `lesson_participant_id` → `lesson_instance_id` → verify `participant_status NOT IN
  ('no_show','cancelled_student','cancelled_clinic')` (Invariant).
- Verify caller is the lesson's instructor (via `Employees.user_id` match on
  `lesson_instances.instructor_employee_id`) **or** `isAdminOrOffice(role)`.
- Verify `lesson_instances.datetime_start <= now()` (edge case E5, locked policy).
- Verify no existing **non-legacy** report for this `lesson_participant_id` (the partial unique
  index from §3 below enforces this at the DB layer, but the API should also pre-check for a
  clean error message rather than surfacing a raw `23505`).
- Verify org permission `organizations.permissions.session_reports_enabled === true` (Invariant
  — server-side enforcement layer added in Phase 2, separate from the Phase 1 frontend gate).
- Set `form_id` = the participant's lesson's service's `Services.report_form_id`, `form_version`
  = that form's current `forms.version`, `source = 'internal'`, `is_legacy = false`,
  `student_id`/`client_profile_id`/`service_id` derived from the participant/lesson (reusing
  `resolveSubmissionSubject`'s student↔client_profile resolution pattern, lines 157-205, is a
  good starting point), and `metadata.authored_by` = the acting user id (+ role).
- Reuse `prepareAnswersForStorage` / `evaluateAlertFlags` / schema-snapshot machinery from
  `finalizeSubmission` (lines 2156-2189) for consistency with the external flow's answer
  handling, since both ultimately populate the same `form_submissions.answers` shape.

No changes were made to `api/form-submissions/*` in this pass, per the task constraints
("Do not touch api/form-submissions behavior").

---

## 3. Final column-migration list for Phase 2

Verified against the current `src/lib/setup-sql.js` definitions (line numbers as of this audit):

- `form_submissions` — `CREATE TABLE` at line 2540, existing columns through line 2561, plus a
  later `ALTER TABLE ... ADD COLUMN IF NOT EXISTS service_id` migration at lines 2576-2578.
  Current `source` CHECK (line 2560) already allows `'internal'`. **No `form_usage` column
  exists on `form_submissions`** — `form_usage` lives on `forms` (see next).
- `forms.form_usage` CHECK — table defined at line 2437, `form_usage` column at line 2442
  (`text NOT NULL DEFAULT 'general'`), inline CHECK at line 2454. The **migration pattern**
  used when `'required_form'` was added is at lines 2459-2467: a data-normalizing `UPDATE`
  followed by `ALTER TABLE ... DROP CONSTRAINT IF EXISTS ... , ADD CONSTRAINT ... CHECK (...)`
  (idempotent because `DROP CONSTRAINT IF EXISTS` no-ops on rerun before the `ADD CONSTRAINT`
  re-adds the same-named constraint with the new value list). Phase 2 must mirror this exact
  shape to add `'session_report'`.
- `Services` — table at line 1083, columns through line 1097, existing `required_forms jsonb`
  migration pattern at lines 1099-1101 (`ADD COLUMN IF NOT EXISTS ... DEFAULT '[]'::jsonb`).
  `report_form_id` does not yet exist.
- `lesson_participants` — table at line 1588, `participant_status` CHECK at line 1612:
  `CHECK (participant_status IN ('scheduled','attended','cancelled_student','cancelled_clinic',
  'no_show'))`. Unique index at lines 1625-1626: `lesson_participants_instance_client_profile_uidx
  ON (org_id, lesson_instance_id, client_profile_id)` — this is keyed by `client_profile_id`,
  **not** `id`, so it does not conflict with or substitute for the new partial unique index Phase
  2 needs on `lesson_participant_id` in `form_submissions`.
- `lesson_instances` — table at line 1498. `status` CHECK (lines 1552-1557, via
  drop+re-add pattern) restricts to `('scheduled','completed','cancelled')` — note this is a
  **lesson-level** status distinct from `lesson_participants.participant_status` (the plan's
  invariant about non-arrival statuses refers to the *participant* status, not this column).
  `documentation_status` CHECK (line 1524): `('undocumented','documented')` — likely relevant to
  Phase 5's "pending" redefinition (whether report creation should also flip this column is a
  Phase 2/5 decision not addressed by this audit; the plan's Invariant "Report creation never
  creates or mutates a lesson_instances / lesson_participants row" reads as a **no** — leave
  `documentation_status` alone).

### Exact SQL for Phase 2 (drafted here, NOT applied)

```sql
-- form_submissions: lesson anchor + versioning + legacy flag
ALTER TABLE public.form_submissions
  ADD COLUMN IF NOT EXISTS lesson_participant_id uuid NULL
    REFERENCES public.lesson_participants(id);

ALTER TABLE public.form_submissions
  ADD COLUMN IF NOT EXISTS form_version int NULL;

ALTER TABLE public.form_submissions
  ADD COLUMN IF NOT EXISTS is_legacy boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS form_submissions_lesson_participant_id_idx
  ON public.form_submissions (org_id, lesson_participant_id)
  WHERE lesson_participant_id IS NOT NULL;

-- Enforce: at most one non-legacy report per lesson_participant_id (Invariant)
CREATE UNIQUE INDEX IF NOT EXISTS form_submissions_lesson_participant_unique
  ON public.form_submissions (lesson_participant_id)
  WHERE lesson_participant_id IS NOT NULL AND is_legacy = false;

-- Services: per-service report form template
ALTER TABLE public."Services"
  ADD COLUMN IF NOT EXISTS report_form_id uuid NULL
    REFERENCES public.forms(id);

CREATE INDEX IF NOT EXISTS services_report_form_id_idx
  ON public."Services" (org_id, report_form_id)
  WHERE report_form_id IS NOT NULL;

-- forms.form_usage: add 'session_report' (mirrors the 'required_form' migration at
-- setup-sql.js:2459-2467)
UPDATE public.forms
SET form_usage = COALESCE(NULLIF(form_usage, ''), 'general')
WHERE form_usage IS NULL OR form_usage = '';

ALTER TABLE public.forms
  DROP CONSTRAINT IF EXISTS forms_form_usage_check,
  ADD CONSTRAINT forms_form_usage_check
    CHECK (form_usage IN ('general','waiting_list_intake','required_form','session_report'));
```

Notes for whoever implements Phase 2:
- `lesson_participant_id` is intentionally **nullable** at the column level (legacy reports
  imported via Phase 6 may fail to match a participant and sit in the review queue with a null
  anchor until resolved — though per Decision #10 unmatched legacy reports should not be
  auto-created as `form_submissions` rows at all, so in practice this column should be non-null
  for every row that *does* get created; nullability here is defensive, matching how
  `client_profile_id`/`student_id` are already handled elsewhere in this table).
  No `ON DELETE` action was specified, matching the plan's edge-case E3 (FK-protect via RESTRICT
  semantics — Postgres FKs default to `NO ACTION`/`RESTRICT`, which is what's wanted here; do
  **not** add `ON DELETE CASCADE`).
- The partial unique index's `WHERE` clause matches the plan's spec exactly:
  `lesson_participant_id IS NOT NULL AND is_legacy = false`.
- No `lint:upsert-conflicts` implications: none of these are upsert-conflict columns by
  themselves, but if Phase 2's report-create endpoint uses `.upsert({ onConflict:
  'lesson_participant_id' })` instead of a plain `.insert()` + pre-check, remember to add that
  conflict key to `scripts/validate-upsert-conflicts.js`'s `EXPECTED_CONFLICTS_BY_TABLE` per
  CLAUDE.md, since the unique index above would then back an `onConflict` target.

---

## 4. Backend permission enforcement — explicitly out of scope for Phase 1

Per the task instructions, **no backend permission checks were added** to
`api/sessions`, `api/session-records`, or `api/loose-sessions`. All three reference the
nonexistent `SessionRecords` table and are catalogued **Rewrite**/**Delete** above; adding a
`session_reports_enabled` check to code that is being replaced in Phase 2 would be wasted work.
Server-side enforcement of the permission belongs on the **new** Phase 2 report-write endpoint
(see §2's "New checks Phase 2 must add").

---

## 5. Permission backfill mechanism (`initialize_org_permissions`)

`public.initialize_org_permissions(p_org_id UUID)` (`src/lib/setup-sql.js:4683-4737`):

1. Reads the org's current `organizations.permissions` jsonb.
2. Computes `default_permissions := public.get_default_permissions()` — a
   `jsonb_object_agg(permission_key, default_value)` over the **entire** `permission_registry`
   table (lines 4663-4677), so it always reflects every registry row, including the new
   `session_reports_enabled` entry added in this pass.
3. If the org's current `permissions` is null/empty/has zero keys, it is **replaced entirely**
   with `default_permissions` (lines 4701-4711).
4. Otherwise, it **merges**: for each `(permission_key, default_value)` pair in
   `default_permissions`, if `merged_permissions` does not already have that key
   (`NOT (merged_permissions ? permission_key)`), it's added via `jsonb_set(...)` (lines
   4714-4728). **Existing keys are never overwritten** — an org that was previously granted (or
   denied) a value for a key that already existed keeps its explicit value; only genuinely
   *missing* keys (like the brand-new `session_reports_enabled` for any org created before this
   migration) get backfilled from the registry default (`'false'::jsonb`, i.e. off by default).
5. Persists the merged/replaced result back onto `organizations.permissions` and returns it.

**Trigger point:** this function is not invoked automatically on every request. It's exposed as
a Postgres RPC (`GRANT EXECUTE ... TO authenticated, app_user`) and called from two client-side
sites found in this repo: `src/pages/Settings.jsx` (on mount, whenever `activeOrgId` is set —
`rpc('initialize_org_permissions', { p_org_id: activeOrgId })`) and the shared helper
`api/_shared/permissions-utils.js#initializeOrgPermissions` (a thin wrapper around the same RPC,
plus a `ensureOrgPermissions` variant that does the same missing-key merge in JS instead of SQL
for server-side callers that already have the row in hand). Practically: an org's
`organizations.permissions.session_reports_enabled` key gets backfilled to `false` the next time
that org's admin opens **Settings**, or the next time any API code path calls
`ensureOrgPermissions`/`initializeOrgPermissions` for that org — not instantly for all orgs the
moment this migration runs. `useOrg()`'s `orgSettings.permissions` (consumed by the new
`useSessionReportsEnabled()` hook) reads directly from `activeOrg.permissions` (`OrgContext.jsx`
line 799) with **no fallback to the registry default** if the key is simply absent from the org
row — so until an org's row is backfilled, `session_reports_enabled` reads as `undefined` there,
and `useSessionReportsEnabled()` correctly treats that as "disabled" (`permissions
?.session_reports_enabled === true` is `false` for `undefined`), which is safe fail-closed
behavior but is worth Phase 5 knowing about if a full-rollout QA pass finds an org where the
Settings page was never opened after this migration.

---

## 6. Phase 1 implementation notes (what was actually done)

- **Registry seed**: added `session_reports_enabled` (category `features`, `default_value
  'false'::jsonb`, `requires_approval true`, matching the sibling `can_export_pdf_reports` /
  `can_reupload_legacy_reports` style) to the `permission_registry` INSERT block in
  `src/lib/setup-sql.js`, alphabetically between `session_form_preanswers_enabled` and
  `storage_access_level`. `npm run lint:sql` passes (0 errors; pre-existing unrelated warnings
  only).
- **New hook/config**: `src/features/sessions/config/session-reports-permission.js` exports
  `useSessionReportsEnabled()` (reads `useOrg().orgSettings.permissions
  ?.session_reports_enabled === true`) and a plain, non-hook
  `isSessionReportsEnabledFromPermissions(permissions)` for any future non-component caller
  that already has a permissions object in hand.
- **Call-site swaps** (hook-based, all inside React components already under `OrgProvider`):
  `src/features/students/pages/StudentsPage.jsx`,
  `src/features/sessions/pages/PendingReportsPage.jsx`,
  `src/features/sessions/components/MyPendingReportsCard.jsx`.
- **`src/main.jsx` route gating**: `App()` is *not* itself inside the `OrgProvider` tree it
  renders (it calls `<OrgProvider>` around the router; `App` the function component is the
  provider's parent, not a consumer), so it cannot call `useOrg()`/`useSessionReportsEnabled()`
  directly. Removed the module-scope `isSessionRecordsEnabled()` call and the conditional route
  element; `/pending-reports` now always renders `<PendingReportsPage />`, and
  `/admin/pending-reports` always redirects to `/pending-reports`. Gating moved inside
  `PendingReportsPage`, which already had a redirect-when-disabled pattern
  (`if (!sessionReportsEnabled) return <Navigate to="/students-list" replace />`) — that pattern
  is preserved, just re-sourced from the hook instead of the deleted constant.
- **Non-React module `src/features/sessions/api/loose-sessions.js`**: chose the
  **minimal-churn option** — left it untouched functionally (still short-circuits every export
  to a no-op / throw) but repointed its self-guard from the deleted
  `isSessionRecordsEnabled()` import to a local `const LOOSE_SESSIONS_RETIRED = true` with an
  explanatory comment, since this whole module (and its only remaining callers — the
  Resolve/BulkResolve dialogs and the two pages, all catalogued **Delete**/**Rewrite** above) is
  slated for deletion in Phase 2 and there is no `activeOrg.permissions` object available inside
  a plain fetch-wrapper module without threading it through every call site for code that's
  about to be deleted anyway. **Did not** wire it to
  `isSessionReportsEnabledFromPermissions` — deliberately, so nobody mistakes "loose sessions"
  for a still-supported workflow once the permission is turned on for a pilot org.
  `src/features/sessions/api/work-sessions.js` needed no change (already an unconditional throw
  stub with no `session-records` import).
- **Deleted**: `src/features/sessions/config/session-records.js` (the `SESSION_RECORDS_ENABLED`
  constant + `isSessionRecordsEnabled()` function). Repo-wide grep after deletion confirms zero
  remaining imports of that path and zero remaining calls to `isSessionRecordsEnabled()`; the
  only textual matches left are two explanatory code comments (in the new config file and in
  `loose-sessions.js`) that mention the old flag by name for context, not references to it.
- **Not gated in this pass (see §1 finding above)**: `AppShell.jsx`'s `NewSessionModal` mount,
  `SessionListDrawer.jsx`, `ComplianceHeatmap.jsx` — left untouched deliberately, since
  `NewSessionModal` still posts to the dead `api/sessions` endpoint and is a Phase 2/3 rewrite
  target; gating a component that's about to be functionally rewritten seemed like wasted churn
  and the instructions scoped Phase 1 call sites explicitly (main.jsx, StudentsPage,
  PendingReportsPage, MyPendingReportsCard, loose-sessions.js, work-sessions.js).
- **Backend**: no changes to `api/sessions`, `api/session-records`, `api/loose-sessions` per
  task instructions (§4 above).
