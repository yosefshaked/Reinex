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

1. A report anchors to a **`lesson_participants` row** whose `participant_status='attended'`.
   Granularity is **per participant** (group lesson → one report per attending student).
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
   can be a per-org / subscription feature. Replaces the global `SESSION_RECORDS_ENABLED` flag.
9. **User migration is API-driven, no invite emails:** admin bulk endpoint creates Reinex auth
   users (`auth.admin.createUser`, `email_confirm:true`, generated temp password) + profile +
   `Employees` + `org_memberships`, sets `must_reset_password`, returns temp passwords for the
   owner to send via WhatsApp. Email is the person join-key.
10. **Migrations designed after the feature is built.** Reuse Import Workspaces. Student match
    = national ID. Report→Amir-lesson match = **student national ID + date**. Unmatched legacy
    reports → **review queue**, never auto-created.

## Invariants (agents: never violate)

- A report is a `form_submissions` row with `source='internal'`, `form_usage='session_report'`,
  bound to exactly one `lesson_participant_id`.
- **Unique**: at most one non-legacy report per `lesson_participant_id`.
- Report creation **never** creates or mutates a `lesson_instances` / `lesson_participants` row.
- An instructor may create a report only for a lesson where they are the instructor and the
  participant's `participant_status='attended'`.
- The feature is inert unless the org has `permissions.session_reports_enabled === true`; every
  report write API also enforces it server-side.
- Legacy reports set `is_legacy=true` and must still bind to an (Amir-imported) participant, or
  route to the review queue.

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

- [ ] Write the exact column migration list for `form_submissions` + `Services` + `form_usage`
      + the `session_reports_enabled` registry entry (see below), reviewed against `setup-sql.js`.
- [ ] Catalogue the ported `src/features/sessions/*` and `api/session-*` code into **reuse /
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
- [ ] Confirm the Forms submit path can run **internal, tokenless** (`source='internal'`) — read
      `api/form-submissions/*` + `src/pages/SubmitFormPage.jsx` submit calls; identify where OTP
      is required and add/confirm an authenticated internal branch.

Verification: a short reuse/rewrite/delete doc + a final column-migration list. No code changes.

---

## Phase 1 — Org-permission gate

- [ ] Seed `session_reports_enabled` (category `'features'`, default `false`) in the
      `permission_registry` INSERT block in `src/lib/setup-sql.js` (near `can_export_pdf_reports`,
      ~lines 4527–4655). `initialize_org_permissions()` will backfill orgs.
- [ ] Frontend gate: read `useOrg().orgSettings.permissions.session_reports_enabled`
      (`src/org/OrgContext.jsx`). Replace all `isSessionRecordsEnabled()` call sites
      (`src/main.jsx`, `StudentsPage.jsx`, `PendingReportsPage.jsx`, `MyPendingReportsCard.jsx`,
      nav "דוחות") with this org-permission check; delete `config/session-records.js`.
- [ ] Backend gate: every report write endpoint checks the org permission (read `organizations.
      permissions`) in addition to `ensureMembership` / `isAdminOrOffice`
      (`src/features/students/utils/endpoints.js` role helpers pattern).

Verification: permission OFF → nav/pages/cards hidden and report APIs 403; ON → visible/allowed;
togglable per org.

---

## Phase 2 — Report write path (internal form_submissions, lesson-anchored)

- [ ] Schema migration: the `form_submissions` columns + `form_usage` value + `Services.
      report_form_id` from "the report entity" section. Follow CLAUDE.md SQL rules; run
      `npm run lint:sql` (+ `lint:upsert-conflicts` if any upsert `onConflict` is added).
- [ ] New/extended API: create a report = insert a `form_submissions` row. Reuse the existing
      form-submission write helper if present (`api/form-submissions/*`); otherwise add an
      internal endpoint. On create it MUST: resolve the `lesson_participant_id`; verify caller is
      the lesson instructor or office/admin; verify `participant_status='attended'`; block a
      second non-legacy report for the pair; set `form_id` = the lesson service's `report_form_id`,
      `form_version` = current `forms.version`, `source='internal'`, `student_id`/`client_profile_id`/
      `service_id` from the participant/lesson; write `metadata.authored_by`. All via
      `withOrgScope`. Reject any loose/no-lesson create (Decision #4).
- [ ] Edit path: allow the author/office to update answers until `locked_at`; reuse
      `reviewed_by/reviewed_at/locked_at` for optional review/reject-redo (no student re-assign).

Verification: create from an attended participant → succeeds; second for same pair → blocked;
no-show/cancelled participant → blocked; loose/no-lesson → blocked; answers persist with
`form_version`.

---

## Phase 3 — Report form via the Forms builder (per service)

- [ ] Services settings UI: assign a `report_form_id` (a `session_report` form) per service
      (find the Services settings component; add the picker).
- [ ] Report drawer: render the service's form via `SectionedFormRenderer` in the adapted
      `NewSessionModal`/`NewSessionForm`, submitting through the internal report write path.
- [ ] Rendering a saved report uses its captured `form_version` (fetch that form version's schema);
      legacy reports (`is_legacy=true`) render raw answers.
- [ ] One-time: convert TutTiud's `session_form_config` into a `session_report` Reinex Form as the
      default template, so the existing question set carries over.

Verification: service with a report form → drawer shows it; submit stores versioned answers under
`form_id`; bumping the form version leaves old reports rendering correctly against their version.

---

## Phase 4 — Preanswers (service-universal + per-employee)

- [ ] Service-universal bank: `Services.metadata.report_preanswers` (keyed by form field),
      editable in service settings, gated by `session_form_preanswers_enabled`, capped by `_cap`.
- [ ] Per-employee bank: `Employees.metadata.report_preanswers`, CRUD from the employee's profile,
      capped by `_cap`. Adapt `PreanswersPickerDialog.jsx` to source from service → employee banks.
- [ ] (Bonus, low-effort) "copy from my last report for this student/service" prefill.

Verification: instructor saves a personal template → one-tap fills a new report; service default
applies when no personal template exists; cap enforced.

---

## Phase 5 — "Pending reports" + enable end-to-end

- [ ] Redefine pending: `lesson_participants` with `participant_status='attended'` on lessons whose
      service has a `report_form_id`, with **no** report `form_submissions` row yet. New endpoint +
      query (LEFT JOIN reports). Drive the rewritten `PendingReportsPage` + `MyPendingReportsCard`
      (instructor = `lesson_instances.instructor_employee_id` matching their `Employees` row).
- [ ] Wire the "דוחות" nav to it; dashboard "my pending reports" card off the same query.
- [ ] PDF export (reuse `can_export_pdf_reports`) renders anchored + legacy reports.
- [ ] Full manual E2E on a pilot org with the permission ON.

Verification: schedule lesson → mark participant attended → appears in pending → document →
clears; my-pending shows only my lessons; PDF export works; counts reconcile.

---

## Phase 6 — Migration ETL (designed last; strict order; cross-Supabase)

> Reuse: `api/_shared/client-profiles.js` (`findClientProfileByIdentityNumber`,
> `createOrReuseClientProfile`, `ensureStudentForClientProfile`, guardian helpers),
> `api/_shared/import-relations.js` (`canonicalIdentityKey`), `api/_shared/supabase-admin.js`
> (`createSupabaseAdminClient` + `auth.admin.createUser`), and the Import Workspaces pipeline.

1. [ ] **Users** (by email): admin bulk endpoint — `auth.admin.createUser({email, password:temp,
       email_confirm:true})` + `profiles` + `Employees` (`employee_type='instructor'`, `user_id`)
       + `org_memberships` (map TutTiud role → owner/admin/office/instructor/member) +
       `must_reset_password`; return temp passwords for WhatsApp. Build **email → Reinex user-id**.
2. [ ] **Students** (by national ID): reuse Import Workspaces → `client_profiles`/`students`.
       Build **national-id → Reinex student-id**. Dirty/missing IDs → existing review/dedup path.
3. [ ] **Amir lessons** → `lesson_instances` + `lesson_participants` (legacy-flagged). Prerequisite
       for legacy reports. Extract via `tools/Amir-System-Migration/` (lesson queries).
4. [ ] **TutTiud reports** → `form_submissions` (`is_legacy=true`): resolve student (national-id
       map) + instructor (email map); match to an Amir-imported `lesson_participant` by **(student
       national ID + date)**; bind `lesson_participant_id`. Unmatched → **review queue** (never
       auto-create a lesson). Store raw answers; `form_id` null / legacy-render.

Verification: dry-run counts (matched vs review-queue) before commit; spot-check a migrated report
renders and anchors to the right lesson/student/instructor; re-run is idempotent.

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

## Still-open items to confirm during Phase 0
- Exact `form_submissions` review-column reuse for any report reject/redo flow (or drop it).
- Whether a service may need **multiple** report forms (then `report_form_id` → a jsonb map).
- Confirm Amir lesson rows carry enough (student key + date + instructor) to build participants.
