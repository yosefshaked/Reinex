# Reinex Session Reports — Implementation Plan

> Bring the instructor **session-reporting** feature ("TutTiud") natively into Reinex,
> anchored to the real calendar, and deprecate the standalone TutTiud app.
>
> **Agent-executable.** Phases are ordered; each task lists files to touch, existing code
> to reuse, and an acceptance check. Cross-phase **invariants** are stated up front — never
> violate them. A follow-on agent (Codex / Antigravity) can resume at any unchecked box.
> A TutTiud reference clone is available at `yosefshaked/TutTiud-Refactored` for comparison.

---

## Context

Reinex is replacing **TutTiud**, a separate app whose only job is instructor **session
reports** (an instructor documents what happened in a student's session). We move it into
Reinex because Reinex has a real calendar (`lesson_instances` + `lesson_participants`) that
TutTiud never had — so reports can be **strictly anchored** to the lesson a student
actually attended, and "pending reports" / compliance become exact instead of heuristic.

State of the world discovered during planning:
- Reinex already contains a **partial, disabled port** of TutTiud reporting: `src/features/
  sessions/*` (UI) and `api/session-records|sessions|loose-sessions|work-sessions`, gated by
  `SESSION_RECORDS_ENABLED = false` in `src/features/sessions/config/session-records.js`.
- **The `SessionRecords` table was never created** in `src/lib/setup-sql.js` — the ported
  API/UI reference a table that doesn't exist. So storage is greenfield.
- The ported workflow is TutTiud's **loose-report → admin-assigns-to-student** model, which
  the owner is **retiring** (reports must anchor to a lesson).

**Chosen storage model (owner decision): a report IS an internal `form_submissions` row.**
No `SessionRecords` table. The questionnaire is a per-service **Reinex Form** (Forms
builder). This unifies reporting with the existing forms system (one answer store, shared
review/lock/versioning) at the cost of rewriting the ported session APIs/UI against
`form_submissions`.

Three separate Supabase projects: **Reinex tenant** (target), **TutTiud control tenant**
(auth/users), **TutTiud data tenant** (reports). Migration is a cross-project ETL. Two
legacy sources feed history: **TutTiud** (reports) and **"Amir"** (legacy Access calendar,
`tools/Amir-System-Migration/`). Amir has **no per-service data** (verified: the tool sees
lesson records, not lesson-type/form config).

## Locked product decisions

1. A report anchors to a **`lesson_participants` row** whose status is NOT a non-arrival
   (`participant_status NOT IN ('no_show','cancelled_student','cancelled_clinic')` — i.e.
   `'attended'` **or still `'scheduled'`**). Instructors may document before the calendar
   owner confirms attendance; attendance confirmation must not block documentation.
   Granularity is **per participant** (group lesson → one report per attending student).
   See "Anchoring edge cases" below — the late-status-change policies are Phase 0 decisions.
2. Reports **never create lessons** (would clash with the Amir calendar import). Lessons come
   only from the Reinex calendar (forward) or the Amir import (history).
3. **Instructors cannot create lessons** (payment/scheduling backfill). Lesson creation stays
   an office/admin action.
4. **No free-floating reports.** The whole loose-report/unassigned/admin-assign workflow is
   retired. If a real session has no lesson, office creates the lesson first.
5. **Report = internal `form_submissions`** (`source='internal'`, `form_usage='session_report'`),
   questionnaire = a per-service Reinex Form, answers in `form_submissions.answers`.
6. **Internal fill, no token** — the report drawer reuses the Forms renderer, submits as the
   authenticated instructor/office user (no OTP; attribution from session).
7. **Preanswers:** service-level **universal** bank + **per-employee** personal bank, governed
   by `session_form_preanswers_enabled` / `_cap`.
8. **Org-scoped gate** via `organizations.permissions` (key `session_reports_enabled`), so it
   can be a per-org / subscription feature. Two layers, both must be filled: the **global
   default** lives in `permission_registry.default_value` (this is the system-wide "flag"),
   and each org's effective value lives in `organizations.permissions` (an org may be granted
   more or less than the default). Only the hard-coded `SESSION_RECORDS_ENABLED` constant is
   deleted — the *default* concept moves into the registry, it is not removed.
9. **User migration is API-driven, no invite emails:** admin bulk endpoint creates Reinex auth
   users (`auth.admin.createUser`, `email_confirm:true`, generated temp password) + profile +
   `Employees` + `org_memberships`, sets `must_reset_password`, returns temp passwords for the
   owner to send via WhatsApp. Email is the person join-key.
10. **Migrations designed after the feature is built — and built source-agnostically.** All
    historical data enters through **Import Workspaces** (potentially multiple sources per
    workspace); Amir and TutTiud are just *sources* (CSV extracts), never bespoke pipelines.
    Student match = national ID. Report→lesson match = **student national ID + date**.
    Unmatched legacy reports → **review queue** (the import-candidates blocked/review state),
    never auto-created. Instructor names from legacy sources may be dirty (reversed
    first/last order, misspellings) → the import must support an explicit **instructor alias
    mapping** (source label → Reinex `Employees` row) persisted per workspace.

## Invariants (agents: never violate)

- A report is a `form_submissions` row with `source='internal'`, `form_usage='session_report'`,
  bound to exactly one `lesson_participant_id`.
- **Unique**: at most one non-legacy report per `lesson_participant_id`.
- Report creation **never** creates or mutates a `lesson_instances` / `lesson_participants` row.
- An instructor may create a report only for a lesson where they are the instructor and the
  participant's status is not a non-arrival (`NOT IN ('no_show','cancelled_student',
  'cancelled_clinic')`).
- The feature is inert unless the org has `permissions.session_reports_enabled === true`; every
  report write API also enforces it server-side.
- Legacy reports set `is_legacy=true` and must still bind to an imported participant, or
  route to the review queue.

## Anchoring edge cases (documenting before attendance is confirmed)

Because a report may be filed on a still-`'scheduled'` participant, documentation and
attendance can contradict each other later. Policy matrix (recommendations marked ✔;
final calls are a Phase 0 checkbox):

| # | Scenario | Handling |
|---|----------|----------|
| E1 | Report exists on a `'scheduled'` participant; calendar owner later tries to mark `no_show` / `cancelled_*` | ✔ **Block the transition** with a clear message ("קיים דיווח לשיעור הזה") and require deleting/voiding the report first, OR (alt.) allow + push both records into an attention queue. Blocking keeps data self-consistent and makes the conflict a deliberate human decision. |
| E2 | Whole lesson gets cancelled after a report exists on one of its participants | Same guard at lesson level: block cancel while non-legacy reports exist; message lists the documented participants. |
| E3 | Participant removed from a lesson / lesson deleted while a report exists | FK-protect: `lesson_participant_id` FK without CASCADE (RESTRICT semantics in API) — deletion paths must check for reports first. |
| E4 | Does filing a report auto-mark attendance? | ✔ **No.** Report creation stays strictly non-mutating (invariant); the calendar owner owns attendance. A report on a `'scheduled'` participant is valid on its own; attendance workflows keep their own pending state. (Alt., if later desired: an explicit "סמן כהגיע" affordance *in the calendar UI* next to the documented flag — still an attendance action, not a report side effect.) |
| E5 | Report filed for a **future** lesson | ✔ Block: report creation requires `lesson_instances.datetime_start <= now()`. Documenting something that hasn't happened is always an error. |
| E6 | Report exists, participant later confirmed `'attended'` | No-op — states agree; nothing to reconcile. |
| E7 | Documented-but-never-confirmed drift (report exists, participant stays `'scheduled'` for days) | Surface as a low-priority attention item for the calendar owner ("מתועד אך נוכחות לא אושרה") so attendance data stays trustworthy for billing. |

## The report entity (Option 2 concrete spec)

A report = row in `form_submissions` (`src/lib/setup-sql.js` ~lines 2540–2578) with columns to
**add** (guarded `ADD COLUMN IF NOT EXISTS`, then `npm run lint:sql`):
- `lesson_participant_id uuid REFERENCES public.lesson_participants(id)` — the anchor.
  Enforce presence for reports in the API; partial **unique index** on `lesson_participant_id
  WHERE lesson_participant_id IS NOT NULL AND is_legacy = false`.
- `form_version int` — the `forms.version` captured at submit time (TutTiud renders old reports
  against their version; `form_submissions` currently stores **no version** — this is the gap).
- `is_legacy boolean NOT NULL DEFAULT false`.
- Author/instructor: `service_id`, `student_id`, `client_profile_id` already exist. Store the
  filling user in `metadata.authored_by` (+ role); the report's **instructor** is derived from
  `lesson_instances.instructor_employee_id` via the participant. Reuse existing
  `reviewed_by/reviewed_at/locked_at` for any review/reject flow.
Add `'session_report'` to the `form_usage` CHECK (follow the existing `'required_form'` migration
pattern near line 2463). Add `Services.report_form_id uuid REFERENCES public.forms(id)` (the
service's report template; do NOT overload `Services.required_forms`).

### Confirmed reuse surfaces (from codebase audit)
- Forms: `forms` table (single incrementing `version` int; draft/publish via `published_at`),
  `form_submissions` (already has `service_id`, `student_id`, `client_profile_id`, `answers`,
  `source` incl. `'internal'`, `reviewed_by/reviewed_at/locked_at`), builder
  `src/features/forms/pages/FormBuilderPage.jsx`, renderer
  `src/features/forms/components/SectionedFormRenderer.jsx`, submit path `api/form-submissions/*`
  (`/verify`, `/submit`; OTP only for external).
- Calendar anchor: `lesson_participants` (status enum incl. `'attended'`, unique
  `(org_id, lesson_instance_id, client_profile_id)`), `lesson_instances.instructor_employee_id`.
- Permissions: `organizations.permissions` jsonb + `permission_registry` table +
  `initialize_org_permissions()` / `get_default_permissions()`; frontend read via
  `src/org/OrgContext.jsx` → `orgSettings.permissions`; role helpers in
  `src/features/students/utils/endpoints.js` (`isAdminOrOffice`).
- Migration: `api/_shared/client-profiles.js` (`findClientProfileByIdentityNumber`,
  `createOrReuseClientProfile`, `createOrReuseGuardianByParts`, `upsertClientGuardianLink`),
  `api/_shared/import-relations.js` (`canonicalIdentityKey`), `api/_shared/supabase-admin.js`
  (`createSupabaseAdminClient`, `auth.admin.createUser`).

---

## Phase 0 — Delta audit + finalize schema (no user-facing change)

- [x] Write the exact column migration list for `form_submissions` + `Services` + `form_usage`
      + the `session_reports_enabled` registry entry (see below), reviewed against `setup-sql.js`.
      See `implementations/session-reports/phase0-delta-audit.md` §3.
- [x] Catalogue the ported `src/features/sessions/*` and `api/session-*` code into **reuse /
      rewrite / delete** given Option 2 + Decision #4:
      - **Reuse (adapt):** `NewSessionModal.jsx` / `NewSessionForm.jsx` (fill shell),
        `PreanswersPickerDialog.jsx`, `QuestionFieldPreview.jsx`, `SessionModalContext.jsx`,
        the Forms renderer `src/features/forms/components/SectionedFormRenderer.jsx`.
      - **Rewrite:** `PendingReportsPage.jsx` + `MyPendingReportsCard.jsx` (new "pending" =
        attended participants without a report — see Phase 5). `api/sessions`,
        `api/session-records` → new report endpoints on `form_submissions`.
      - **Delete/retire:** `api/loose-sessions`, `api/work-sessions`,
        `src/features/sessions/api/loose-sessions.js|work-sessions.js`, the loose/unassigned
        assignment dialogs (`ResolvePendingReportDialog`, `BulkResolvePendingReportsDialog`,
        Reject/Resubmit if not repurposed), `utils/form-config.js|version-helpers.js|
        version-lookup.js` (replaced by Forms versioning), and the Settings
        `session_form_config` questionnaire path in `api/settings/index.js`.
      See `implementations/session-reports/phase0-delta-audit.md` §1 for the full file-by-file
      catalogue (including a finding that `NewSessionModal` mounting in `AppShell.jsx` /
      `SessionListDrawer.jsx` / `ComplianceHeatmap.jsx` was never gated by the old flag).
- [x] Confirm the Forms submit path can run **internal, tokenless** (`source='internal'`) — read
      `api/form-submissions/*` + `src/pages/SubmitFormPage.jsx` submit calls; identify where OTP
      is required and add/confirm an authenticated internal branch.
      See `implementations/session-reports/phase0-delta-audit.md` §2: confirmed today's
      `verify`/`submit` actions are fully OTP-based with **no** authenticated internal branch;
      `source='internal'` is already legal in the DB CHECK but unused by any code path. Phase 2
      must add a new authenticated branch — exact checks-to-reuse/skip/add are documented there.
      No `api/form-submissions/*` code was changed (out of scope for this pass).

Verification: a short reuse/rewrite/delete doc + a final column-migration list. No code changes.
`implementations/session-reports/phase0-delta-audit.md` delivered; no files under `api/` or
`src/features/sessions/**` behavior were changed as part of Phase 0 (Phase 1 below made the
permission-gate edits).

---

## Phase 1 — Org-permission gate

- [x] Seed `session_reports_enabled` (category `'features'`, `default_value` = the global
      default, `false` for now) in the `permission_registry` INSERT block in
      `src/lib/setup-sql.js` (near `can_export_pdf_reports`, ~lines 4527–4655), AND verify
      `initialize_org_permissions()` backfills the key into every existing org's
      `organizations.permissions` (both layers must be filled — registry = default, org row =
      effective grant, which may differ from the default in either direction).
      `npm run lint:sql` passes. Backfill mechanism documented in
      `implementations/session-reports/phase0-delta-audit.md` §5 (merge-missing-keys-only
      semantics, triggered via the `initialize_org_permissions` RPC from `Settings.jsx` or
      `api/_shared/permissions-utils.js`, not automatically on every request).
- [x] Frontend gate: read `useOrg().orgSettings.permissions.session_reports_enabled`
      (`src/org/OrgContext.jsx`). Replace all `isSessionRecordsEnabled()` call sites
      (`src/main.jsx`, `StudentsPage.jsx`, `PendingReportsPage.jsx`, `MyPendingReportsCard.jsx`,
      nav "דוחות") with this org-permission check; delete `config/session-records.js`.
      Implemented via new `src/features/sessions/config/session-reports-permission.js`
      (`useSessionReportsEnabled()` hook + plain `isSessionReportsEnabledFromPermissions()`).
      `main.jsx` now always registers `/pending-reports`; the page itself redirects when the
      permission is off (moved out of module-scope route gating, since `App()` is not inside
      `OrgProvider`'s consumer subtree). No "דוחות" nav entry exists yet in `Sidebar.jsx` — that's
      still Phase 5 scope. `config/session-records.js` deleted; zero remaining imports (grep
      verified). See `implementations/session-reports/phase0-delta-audit.md` §6 for full
      per-call-site notes, including the deliberate choice to leave
      `src/features/sessions/api/loose-sessions.js` self-guarding via a local
      `LOOSE_SESSIONS_RETIRED` constant rather than wiring it to the new permission (it's
      Delete-in-Phase-2 dead code either way).
- [x] Backend gate: every report write endpoint checks the org permission (read `organizations.
      permissions`) in addition to `ensureMembership` / `isAdminOrOffice`
      (`src/features/students/utils/endpoints.js` role helpers pattern).
      **Completed in Phase 2**: `api/session-reports/index.js` calls
      `ensureOrgPermissions(supabase, orgId)` (from `api/_shared/permissions-utils.js`) on every
      method (GET/POST/PATCH), after `ensureMembership`, and returns 403
      `session_reports_disabled` when `permissions.session_reports_enabled !== true`
      (fail-closed: a missing key — org row never backfilled — reads as disabled, matching the
      registry default). The old dead `api/sessions`/`api/session-records`/`api/loose-sessions`
      endpoints were intentionally left untouched (still reference the nonexistent
      `SessionRecords` table; retirement is Phase 5 scope).

Verification: permission OFF → nav/pages/cards hidden and report APIs 403; ON → visible/allowed;
togglable per org. Frontend half verified (pages/cards redirect/hide via the new hook,
`npm run lint` / `npx eslint src/features/sessions/ src/main.jsx` clean — see audit doc for full
command output). The "report APIs 403" half of this verification is deferred to Phase 2 since no
new report-write API exists yet to enforce it on.

---

## Phase 2 — Report write path (internal form_submissions, lesson-anchored)

- [x] Schema migration: the `form_submissions` columns + `form_usage` value + `Services.
      report_form_id` from "the report entity" section. Follow CLAUDE.md SQL rules; run
      `npm run lint:sql` (+ `lint:upsert-conflicts` if any upsert `onConflict` is added).
      Implemented in `src/lib/setup-sql.js`: `form_submissions.lesson_participant_id` (FK,
      RESTRICT/no CASCADE per E3), `form_version`, `is_legacy`; supporting index
      `form_submissions_lesson_participant_id_idx` and partial unique index
      `form_submissions_report_participant_uidx`; `Services.report_form_id` (column added
      where `Services` is defined, FK constraint deferred via a `DO $$ ... $$` block placed
      after `public.forms` is created, since `forms` is defined later in the file than
      `Services` — a plain inline `REFERENCES public.forms(id)` would have tripped the
      SQL012 reference-order lint); `forms_form_usage_check` expanded to include
      `'session_report'`, mirroring the existing `'required_form'` migration shape exactly.
      `npm run lint:sql` — 0 errors (21 pre-existing warnings, unrelated). `npm run
      lint:upsert-conflicts` — passes (no upserts added in Phase 2).
- [x] New/extended API: create a report = insert a `form_submissions` row. New sibling endpoint
      `api/session-reports/index.js` (+ `function.json`, route `session-reports/{reportId?}`,
      methods get/post/patch) — a fresh endpoint rather than extending
      `api/form-submissions/*` (kept that file untouched per the Phase 0 audit's scope note).
      On create it: resolves `lesson_participant_id`; verifies caller is the lesson instructor
      (via `Employees.user_id`) or office/admin; verifies `participant_status` is not a
      non-arrival; verifies the lesson has started (`datetime_start <= now()`, E5); pre-checks
      + DB-unique-index-backed block on a second non-legacy report for the pair (`23505` mapped
      to the same `report_already_exists` 409); resolves `form_id`/`form_version` via the
      lesson's `Services.report_form_id` → `forms` (must be `form_usage='session_report'` and
      published); writes `metadata.authored_by`/`authored_role`; all via `withOrgScope`. Loose/
      no-lesson creates are structurally rejected (`lesson_participant_id` is required).
      Server-side permission gate (`organizations.permissions.session_reports_enabled`) enforced
      on every method via `ensureOrgPermissions` — this also closes out the Phase 1 leftover
      "backend gate" checkbox below.
- [x] Edit path: `PATCH /session-reports/{reportId}` allows the author or office/admin to update
      `answers`/`metadata.notes` until `locked_at`; `reviewed_by/reviewed_at` settable by
      office/admin only via `{ mark_reviewed: true }` (informational marker, not an
      approve/reject workflow, per the Resolved Questions section).

Verification: create from an attended participant → succeeds; from a still-`scheduled`
participant of a past lesson → succeeds; second for same pair → blocked; no-show/cancelled
participant → blocked; future lesson → blocked; loose/no-lesson → blocked; answers persist with
`form_version`; late no_show/cancel transitions honor the E1/E2 policy chosen in Phase 0.

**Done (static verification — no live DB in this pass):** all guard branches implemented and
statically traced (see below); `npm run lint:sql` (0 errors), `npm run lint:api` (clean),
`npx eslint src/lib/api-client.js` (clean), `npm run lint:upsert-conflicts` (passes). E1/E2
guards wired into every identified write site (see below) via the new shared helper
`api/_shared/session-reports-guards.js` (`findBlockingReportParticipantIds` /
`hasBlockingReportForParticipants`). E3 (participant-delete path) has no existing endpoint to
guard today — confirmed by repo-wide grep — so there is nothing to wire yet; flagged for
whoever adds a participant-delete endpoint to call the same helper first.

E1/E2 write-site trace:
- `api/calendar-attendance/index.js` (`handleMarkAttendance`, single-participant status write) —
  guard inserted immediately before `participantUpdate.participant_status = participantStatus`
  is set, when the target status is `no_show`/`cancelled_student`/`cancelled_clinic` and differs
  from the current status → 409 `report_has_documentation` with `documented_participant_ids`.
- `api/calendar/index.js` (`handleUpdateInstance`, single-instance cancel via
  `cancelLessonInstanceWithParticipants`) — guard inserted immediately before the RPC call,
  loads the instance's participant ids and checks all of them → 409 `report_has_documentation`.
- `api/lesson-instances/index.js` (single-instance cancel via the same RPC) — same guard shape,
  inserted immediately before that call site.
- `api/lesson-instances/index.js` (bulk student-cancel via
  `cancelSelectedScheduledParticipantsAndReconcileInstance`, looped per instance) — guard
  inserted once before the per-instance loop, checking every targeted participant id across all
  instances in a single query → 409 `report_has_documentation` (blocks the whole bulk op rather
  than partially cancelling).

---

## Phase 3 — Report form via the Forms builder (per service)

- [x] Services settings UI: assign a `report_form_id` (a `session_report` form) per service.
      `src/pages/ServicesPage.jsx` — new "טופס דיווח" section in the service create/edit dialog:
      a `SelectField` listing published `session_report` forms (fetched via `GET forms?
      form_usage=session_report&is_active=true`, filtered client-side to `published_at` rows) plus
      a `ללא טופס דיווח` clear option (sentinel value, since Radix `Select` can't use `''`), and a
      hint that lessons of the service can only be documented once a report form is assigned.
      `api/services/index.js` POST/PUT now accept and persist `report_form_id` (new
      `normalizeOptionalUuid` validator; column already existed from Phase 2).
- [x] `'session_report'` usage in the Forms builder: `src/features/forms/pages/FormsListPage.jsx`
      create dialog gained a "דוח מפגש" option (label + Hebrew defaults + badge/usage-label
      mapping); `api/forms/index.js`'s `normalizeFormUsage` allowlist extended to accept it
      (the DB CHECK already allowed the value since Phase 2).
- [x] Default report-form seeding (TutTiud parity): `src/features/sessions/config/
      default-report-form.js` builds a schema with two `long_text` questions — `session_summary`
      ("סיכום המפגש", required) and `next_steps` ("המשך טיפול / צעדים הבאים", optional) — using the
      builder's own `createSection`/`createQuestion`/`normalizeFormSchema` helpers so the shape
      can't drift from the real Forms contract. `ServicesPage.jsx`'s picker shows a "צור טופס דיווח
      ברירת מחדל" button when the org has no published `session_report` forms; it POSTs the form
      as a draft then immediately PUTs `{ publish: true }` (created **published**, matching the
      "prefer creating it published if the API allows" instruction), then re-loads the picker and
      preselects the new form.
- [x] Report drawer: `src/features/sessions/components/NewSessionModal.jsx` +
      `NewSessionForm.jsx` rewritten around the anchored contract — open with
      `{ lessonParticipantId, studentName?, serviceName?, lessonDateTime? }` (see
      `SessionModalContext.jsx`'s `openSessionReportModal`), resolve the fill target via the new
      `GET /api/session-reports?lesson_participant_id=X&mode=context` (added in
      `api/session-reports/index.js`, same permission/role guards as POST), render with
      `SectionedFormRenderer`, submit via `POST /api/session-reports`. Every 409 the API can return
      is already mapped to Hebrew in `src/lib/api-client.js` (added the one missing code,
      `form_not_session_report`). The old "loose report" fields (student/reason/time inputs,
      instructor picker for unassigned reports) are gone — anchored context only, per Decision #4.
- [x] Viewing a saved report: new `src/features/sessions/components/ReportView.jsx`, a read-only
      component that renders `metadata.form_schema_snapshot` (falling back to a passed-in current
      schema, then to a raw answers dump) through `SectionedFormRenderer` in `readOnly` mode.
      Exported standalone so Phase 5's student-profile history can use it without importing the
      fill flow.
- [x] Gate: every previously-ungated `NewSessionModal` mount now respects
      `useSessionReportsEnabled()`. `src/components/layout/AppShell.jsx` only renders the modal
      when the permission is on, and `openSessionReportModal()` itself no-ops when the permission
      is off. `src/features/dashboard/components/SessionListDrawer.jsx` and `ComplianceHeatmap.jsx`
      never had a `lesson_participant_id` to anchor to (their heatmap data model is
      `Students.default_day_of_week`/`default_session_time` heuristics, not real
      `lesson_instances`/`lesson_participants` rows — confirmed by reading `api/weekly-compliance/
      index.js`); rewiring them to real lesson data is Phase 5 scope ("pending reports"
      redefinition), so their `NewSessionModal` mounts and "document now" triggers were removed
      rather than left pointing at an anchor they can't supply.
- [x] Rendering a saved report uses its captured `form_version` (fetch that form version's schema);
      legacy reports (`is_legacy=true`) render raw answers. **Superseded by a stronger mechanism**:
      see "Schema-snapshot decision" below — `ReportView.jsx` renders from `metadata.
      form_schema_snapshot` and covers legacy raw-answer rendering. Now mounted (Phase 5) by
      `src/features/students/components/StudentReportsTab.jsx` (the student profile's "דוחות
      מפגשים" tab), read-only, opened per-report from a list fetched via
      `GET /api/session-reports?student_id=`.
- [ ] One-time: convert TutTiud's `session_form_config` into a `session_report` Reinex Form as the
      default template. **Partially done**: the default-template *shape* is built
      (`default-report-form.js`, same two questions TutTiud used) and is one click away per-org via
      the picker's seeding button, but no *automatic* one-time org-wide conversion/migration was
      run — deliberately, since Phase 6 (migration) is explicitly out of scope for this pass and
      "convert TutTiud's config" reads as a migration-time action, not a Phase 3 UI action.

**Schema-snapshot decision** (Task 1, done ahead of the rest of Phase 3): the plan above called for
"fetch that form version's schema" at render time, but `forms` only ever stores the *current*
schema — old versions aren't retained anywhere, so a version number alone isn't enough to
reconstruct historical rendering. Instead, `api/session-reports/index.js` POST now stores the full
resolved schema verbatim in `metadata.form_schema_snapshot` at create time (untrimmed — it's the
permanent rendering contract for that report), and `ReportView.jsx` renders from the snapshot
first, falling back to a passed-in current schema only when no snapshot exists (legacy imports).
`form_version` is still stored and still useful for audit/debugging, but the snapshot — not a
version-keyed schema lookup — is what actually drives rendering.

**Post-handoff hardening (Codex, 2026-07-16):** report fill now resolves only the canonical
`metadata.published_form_schema` contract (never the editable draft), resolves and materializes
active shared blocks, and snapshots visibility and alert rules alongside the schema. The drawer
uses the published visibility rules for rendering and validation, while `ReportView` reuses the
captured visibility snapshot. Deactivated, legacy-published-but-not-migrated, cross-org, and
non-`session_report` form assignments are rejected server-side.

Verification: service with a report form → drawer shows it; submit stores versioned answers under
`form_id`; bumping the form version leaves old reports rendering correctly against their version.
Confirmed via code trace (no live DB in this pass, matching Phase 2's verification style): the
picker only lists published `session_report` forms, the drawer's context GET 404/409s cleanly when
no report form is assigned or it isn't published, and `ReportView.jsx` reads
`metadata.form_schema_snapshot` ahead of any live/current schema so a later form edit (which bumps
`forms.version` and overwrites `forms.form_schema`) cannot change how an already-saved report
renders.

---

## Phase 4 — Preanswers (service-universal + per-employee)

- [x] Service-universal bank: `Services.metadata.report_preanswers` (keyed by form field),
      editable in service settings, gated by `session_form_preanswers_enabled`, capped by `_cap`.
      `src/pages/ServicesPage.jsx` — new "תשובות מוכנות ארגוניות" section (per-question add/remove
      lists) that only renders when a report form is assigned; gate reads
      `orgSettings.permissions.session_form_preanswers_enabled` directly (not the broader
      `session_reports_enabled`). Saved via the existing `metadata` field on
      `POST/PUT api/services` (already accepted the whole `metadata` blob before this phase — no
      backend change needed).
- [x] Per-employee bank: `Employees.metadata.report_preanswers`. **Deviation from the plan text**:
      CRUD happens inline while filling a report (save/delete next to each field via
      `PreanswersPickerDialog.jsx`), not from a separate employee-profile page — a narrow backend
      surface (`POST /api/session-reports/preanswers` in `api/session-reports/index.js`,
      `updatePersonalPreanswers`) writes **only** the caller's own `Employees` row (resolved via
      `Employees.user_id = caller`, never a supplied id). `PreanswersPickerDialog.jsx` sources
      service-bank answers first, personal-bank answers second, and is wired into
      `NewSessionForm.jsx`/`NewSessionModal.jsx` per short/long-text field; hidden whenever
      `session_form_preanswers_enabled !== true` (the picker is only rendered when
      `reportContext.preanswers` is present, which the API only returns when the permission is on).
- [x] (Bonus) "copy from my last report for this student/service" prefill: `GET /api/session-reports
      ?mode=context` returns `last_report_answers` (most recent non-legacy report for the same
      student+service, excluding the current participant), surfaced as a "העתק מהדיווח האחרון"
      button in `NewSessionForm.jsx`.

Verification: instructor saves a personal template → one-tap fills a new report; service default
applies when no personal template exists; cap enforced (`session_form_preanswers_cap`, read
server-side in both the picker's context payload and the personal-bank write endpoint). Confirmed
via code trace (no live DB in this pass, matching Phases 2/3's verification style).

Post-handoff hardening also applies the same cap to service-bank metadata in `api/services` and
prevents "copy last report" from copying signature or approval answers into a new report.

---

## Phase 5 — "Pending reports" + enable end-to-end

- [x] Redefine pending: `lesson_participants` with `participant_status IN ('attended','scheduled')`
      on **past** lessons (`datetime_start <= now()`) whose service has a `report_form_id`, with
      **no** report `form_submissions` row yet. `GET /api/session-reports?mode=pending&scope=
      mine|all&page=` in `api/session-reports/index.js` (`resolvePendingReports`) — exact
      report-excluding pagination (50/page) is performed by the org-scoped
      `list_pending_session_reports` SQL function and returns a top-level `total`; the same
      `session_reports_disabled` gate applies as every other mode, and `scope=all` is
      restricted to admin/office (403 otherwise). Drives the rewritten
      `src/features/sessions/pages/PendingReportsPage.jsx` and
      `src/features/sessions/components/MyPendingReportsCard.jsx` — both now open the existing
      anchored report drawer (`SessionModalContext.openSessionReportModal`) per row instead of the
      retired assign/reject workflow. Instructor scope resolves `lesson_instances.
      instructor_employee_id` against the caller's own `Employees` row. Separately surfaces the E7
      drift signal (`documented_unconfirmed` — reported but `participant_status` still
      `'scheduled'`) for admin/office, rendered as a modest dashed-border section on
      `PendingReportsPage.jsx`.
      Post-handoff hardening fixed two edge cases in the original implementation: documented
      participants are excluded before pagination/counting, and an admin/office user without a
      linked `Employees` row receives an empty `scope=mine` result instead of accidentally seeing
      the organization-wide queue.
- [x] Wire the "דוחות" nav to it: `src/components/layout/Sidebar.jsx` gained a "דוחות מפגשים" item
      (`sessionReportsOnly: true`, filtered by `useSessionReportsEnabled()`); dashboard "my pending
      reports" card (`MyPendingReportsCard`) and `StudentsPage.jsx`'s own pending-count badge/dialog
      both moved off the retired `fetchLooseSessions` onto the same `mode=pending` endpoint.
      **Deviation**: `PendingReportsPage.jsx` is no longer admin-only — it now serves both roles
      (admin/office see `scope=all` plus the E7 section; instructors see their own `scope=mine`
      list with pagination), since the redefined "pending" concept is meaningful self-service data
      for instructors too, not just an admin queue.
- [x] PDF export (reuse `can_export_pdf_reports`): real machinery already existed
      (`api/students-export/index.js`, puppeteer/chromium HTML-to-PDF) but read from the
      never-created `SessionRecords` table (dead code — see phase0-delta-audit.md) and the retired
      `Settings.session_form_config` version-history model. Rewired to `form_submissions`
      (`student_id` match, both legacy and non-legacy), rendering each report from its own
      `metadata.form_schema_snapshot` (flattened sections→questions) instead of a version lookup;
      service name resolved via a small `Services` batch fetch. `api/_shared/version-lookup.js`
      became unimported as a result and was deleted. **No UI trigger was added** — the wrapper
      (`src/api/students-export.js`) has no caller anywhere in `src/**`; adding an "export PDF"
      button is a separate, un-requested UI task and was left out to keep this change scoped to
      "wire reports in minimally."
- [ ] Full manual E2E on a pilot org with the permission ON. **Not done** — no live DB/deployed
      environment available in this pass; all Phase 4/5 work is verified by static code trace only,
      matching the verification style already used for Phases 2/3.

Verification: schedule lesson → mark participant attended → appears in pending → document →
clears; my-pending shows only my lessons; PDF export works; counts reconcile. Confirmed via code
trace for every item except the full manual E2E box above.

---

## Phase 6 — Migration (designed last; strict order; SOURCE-AGNOSTIC via Import Workspaces)

> **Framing rule:** do NOT build "an Amir importer" or "a TutTiud importer". Extend **Import
> Workspaces** with new entity types so ANY source (Amir CSV extract, TutTiud export, a future
> system) flows through the same map → analyze → review → commit pipeline, multi-source per
> workspace. Amir/TutTiud specifics live only in their extract tools, never in the pipeline.
>
> Reuse: the Import Workspaces pipeline (`api/_shared/import-mapping.js` ENTITY_SCHEMA,
> analyze/commit engines), `api/_shared/client-profiles.js` (`findClientProfileByIdentityNumber`,
> `createOrReuseClientProfile`, guardian helpers), `api/_shared/import-relations.js`
> (`canonicalIdentityKey`), `api/_shared/supabase-admin.js` (`createSupabaseAdminClient` +
> `auth.admin.createUser`).

1. [ ] **Users** (by email): admin bulk endpoint — `auth.admin.createUser({email, password:temp,
       email_confirm:true})` + `profiles` + `Employees` (`employee_type='instructor'`, `user_id`)
       + `org_memberships` (map source role → owner/admin/office/instructor/member) +
       `must_reset_password`; return temp passwords for WhatsApp. Build **email → Reinex user-id**.
2. [ ] **Students** (by national ID): existing Import Workspaces entity types →
       `client_profiles`/`students`. Dirty/missing IDs → existing review/dedup path.
3. [ ] **Lessons: new Import Workspaces entity types** `lesson` + `lesson_participation` —
       schema/mapping in `import-mapping.js`, analyze validation + commit into
       `lesson_instances` + `lesson_participants` (legacy-flagged, e.g.
       `created_source='import'`). Prerequisite for legacy reports. Amir extract
       (`tools/Amir-System-Migration/`, lesson queries) is just the first source.
       **Instructor alias mapping:** legacy instructor names are dirty (last-name-first,
       misspellings). Add a per-workspace mapping step — distinct source instructor labels →
       Reinex `Employees` rows — persisted in workspace config (e.g.
       `mappings.instructor_aliases`), offered with fuzzy suggestions (normalized/reversed
       name match), required before commit; unmapped labels → blocker issue on the candidates.
4. [ ] **Reports: new entity type** `session_report` → `form_submissions` (`is_legacy=true`):
       resolve student (national-id) + instructor (email map / alias mapping); match to an
       imported `lesson_participant` by **(student national ID + date)**; bind
       `lesson_participant_id`. Unmatched → stays a **blocked import candidate** (the
       existing review queue) — never auto-create a lesson. Store raw answers; `form_id`
       null / legacy-render.

Verification: dry-run counts (matched vs review-queue) before commit; spot-check a migrated report
renders and anchors to the right lesson/student/instructor; re-run is idempotent; a second source
imported into the same org reuses the same pipeline without code changes.

---

## Agent-handoff notes

- Work phases in order; a phase's Verification must pass before the next.
- Lint/build after edits (repo CLAUDE.md): `setup-sql.js` → `npm run lint:sql`
  (+ `lint:upsert-conflicts` for new upserts); `api/**` → `npm run lint:api`; `src/**` →
  `npm run lint`; pre-deploy → `npm run build`.
- Reuse over rebuild: the Forms renderer/builder/versioning, `form_submissions` + its API,
  `organizations.permissions` (`initialize_org_permissions`, OrgContext read), role helpers,
  Import Workspaces + client-profiles/supabase-admin shared helpers.
- Do not resurrect `SessionRecords`, loose reports, or `session_form_config`.
- Never break the Invariants block.

## Resolved questions (owner decisions)
- **`reviewed_by`/`reviewed_at`** = informational "this report was reviewed" marker only — NOT
  an approve/reject workflow. Keep the columns; do not build approval semantics around them.
- **One report form per service** (`report_form_id`) for now. If multi-form is ever needed:
  migrate the column to a jsonb map + small API fix — feasible, with one caveat to remember:
  the pending-reports definition and the one-report-per-participant unique index become
  per-(participant, form), so those two must change together with the column.
- **Amir carries enough** (student key + date + instructor) to build participants — BUT legacy
  instructor names are unreliable (reversed order, misspellings), hence the mandatory
  **instructor alias mapping** step in Phase 6.3.

## Phase 0 policy decisions — LOCKED (owner, 2026-07-02)
- **E1/E2: BLOCK** late no_show/cancel transitions (participant or whole lesson) while a
  non-legacy report exists; the report must be voided first. Revisit later only if it
  proves too rigid in practice.
- **E5 boundary: lesson START** (`datetime_start <= now()`). If a lesson finishes early,
  the instructor may begin reporting immediately — no waiting for the scheduled end.
