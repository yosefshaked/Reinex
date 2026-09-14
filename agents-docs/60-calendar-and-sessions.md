# 60 Calendar And Sessions

## When to read
- Calendar page work.
- Lesson instances, templates, overrides, attendance, corrections, conflicts, or pending reports work.

## Load these files first
- [`../src/features/calendar/pages/CalendarPage.jsx`](../src/features/calendar/pages/CalendarPage.jsx)
- [`../src/features/calendar/hooks/useCalendar.js`](../src/features/calendar/hooks/useCalendar.js)
- [`../src/features/calendar/hooks/useTemplates.js`](../src/features/calendar/hooks/useTemplates.js)
- [`../src/features/calendar/components/`](../src/features/calendar/components/)
- [`../src/features/calendar/utils/`](../src/features/calendar/utils/)
- [`../src/features/sessions/pages/PendingReportsPage.jsx`](../src/features/sessions/pages/PendingReportsPage.jsx)
- [`../src/features/sessions/components/NewSessionModal.jsx`](../src/features/sessions/components/NewSessionModal.jsx)
- [`../src/features/sessions/components/ReportView.jsx`](../src/features/sessions/components/ReportView.jsx)
- [`../src/features/sessions/config/session-reports-permission.js`](../src/features/sessions/config/session-reports-permission.js)
- [`../api/calendar/index.js`](../api/calendar/index.js)
- [`../api/calendar-attendance/index.js`](../api/calendar-attendance/index.js)
- [`../api/calendar-corrections/index.js`](../api/calendar-corrections/index.js)
- [`../api/calendar-conflicts/index.js`](../api/calendar-conflicts/index.js)
- [`../api/lesson-instances/index.js`](../api/lesson-instances/index.js)
- [`../api/lesson-templates/index.js`](../api/lesson-templates/index.js)
- [`../api/lesson-template-overrides/index.js`](../api/lesson-template-overrides/index.js)
- [`../api/session-reports/index.js`](../api/session-reports/index.js)
- [`../api/_shared/BillingLedgerService.js`](../api/_shared/BillingLedgerService.js)
- [`../api/_shared/calendar-editing.js`](../api/_shared/calendar-editing.js)
- [`../api/_shared/calendar-workflow.js`](../api/_shared/calendar-workflow.js)
- [`../api/_shared/calendar-corrections.js`](../api/_shared/calendar-corrections.js)
- [`../api/_shared/calendar-workflow-decisions.js`](../api/_shared/calendar-workflow-decisions.js)
- [`../api/_shared/lesson-instance-status.js`](../api/_shared/lesson-instance-status.js)
- [`../api/_shared/session-metadata.js`](../api/_shared/session-metadata.js)
- [`../api/_shared/session-reports-guards.js`](../api/_shared/session-reports-guards.js)

## Shared helpers to reuse
- Lesson dialog building blocks (reuse them instead of re-deriving inside components):
  - [`../src/features/calendar/utils/lessonDialogModel.js`](../src/features/calendar/utils/lessonDialogModel.js): pure helpers. Display-state derivation with correction overlays (`getDisplayInstance`, `getDisplayParticipants`), Hebrew status/decision/reason labels, `resolveMutationError` (API code → Hebrew), `buildConflictLines`, `groupPreviewImpacts`, scheduling-override metadata, and the default finance policies. It has no React and no `@/` aliases, so `node:test` can import it (`test/lesson-dialog-model.test.js`).
  - [`../src/features/calendar/hooks/useLessonDialogData.js`](../src/features/calendar/hooks/useLessonDialogData.js): `useLessonSessionReports`, `useLessonFinancePolicies`, `useAbsenceRequirements` (results keyed by participant+status; never reset them by hand) and `useLessonVersions` (fresh versions after the dialog's own writes).
  - Dialog pieces (session-modal v4): `LessonDialogHeader.jsx` (service · date/time · instructor, tabs on the bottom edge), `LessonParticipantRoster.jsx` (list rows: status pill, HMO tooltip, reminder bell, report signal, ✓ / ✕ / ⋯ with `data-participant-row` / `data-mark-attended` hooks for tests), `LessonImpactStrip.jsx` (the one-line confirm for **every** participant status change, fed by the server preview through `summarizePreviewImpacts`; amounts use Hebrew verbs, never +/- signs) and `LessonHistoryTab.jsx` (`GET lesson-instances/{id}?view=history`). Participant status labels/tones come from `PARTICIPANT_STATUS_DISPLAY` in the model; don't add local copies.
- HMO closure rule: `calendar-attendance` stores `hmo_claim.decision = 'pending'` for **every** attended participant, so `evaluateParticipantSettlement` never treats `pending` as "claim required". A claim is required only with an HMO ledger row (`hmo_provider_id`), an open `hmo_claim_submission` task, or an explicit `required` decision. Stored `workflow_state` is recalculated only when the lesson is written to, so a rule change leaves already-evaluated lessons stale until something re-syncs them.
- `useCalendarInstances`, `useCalendarInstructors`
- `useTemplates`, `useTemplateMutations`, `useTemplateOverrides`
- Local date and adapter helpers in [`../src/features/calendar/utils/`](../src/features/calendar/utils/)
- `fetchLessonMutationState`, `parseExpectedVersion`, `respondWithLockedMutation`, `respondWithVersionConflict`
- `syncLessonClosureState`, correction helpers, lesson-status helpers
- `enrichLessonInstancesWithHmoCoverage` in [`../api/_shared/calendar-hmo-coverage.js`](../api/_shared/calendar-hmo-coverage.js) for read-only calendar response enrichment of participant HMO coverage context. `hmo_coverage` also carries display-only `authorization_reference`, `authorized_lessons`, `expires_at` (null when no authorization applies); billing never reads them.
- `buildLessonHistoryEvents` / `collectLessonHistoryReferenceIds` in [`../api/_shared/lesson-history.js`](../api/_shared/lesson-history.js): pure mapping from lesson/participant `audit_log` rows + `calendar_instance_corrections` rows to the lesson dialog history contract (`GET /api/lesson-instances/{id}?view=history`, admin/office only). It merges the duplicate rows one action writes (control `logAuditEvent` + tenant `logTenantAuditEvent` + attendance status-transition rows). New lesson/participant audit event types must be added to its mapping, or they surface as a generic `other` entry.
- `cancelLessonInstanceWithParticipants`, `completeLessonInstanceWithParticipants`, and `cancelSelectedScheduledParticipantsAndReconcileInstance` in [`../api/_shared/lesson-instance-status.js`](../api/_shared/lesson-instance-status.js) are RPC wrappers over org-scoped SQL functions and must always receive `orgId` alongside `instanceId`
- `useSessionReportsEnabled`, `openSessionReportModal`
- `findBlockingReportParticipantIds`, `hasBlockingReportForParticipants`
- `normalizeWorkflowDecision`, `readParticipantWorkflowMetadata`, `shouldParticipantTriggerInstructorCompensation` in [`../api/_shared/calendar-workflow-decisions.js`](../api/_shared/calendar-workflow-decisions.js)

## Known patterns / do not reinvent
- Calendar writes must enforce membership scope and instructor self-scope for non-admin users.
- Availability checks come from service-capability `availability_windows`; do not duplicate availability math.
- In normal calendar lesson-instance create/edit flows, `duration_minutes` is service-derived, not free-hand. Create uses the selected service's current duration; existing instances keep their stored duration unless the user explicitly changes the service on that instance.
- Lesson-template create/edit flows also treat `duration_minutes` as service-derived, not free-hand. The template API resolves duration from `Services.duration_minutes`; frontend dialogs may display it but must not let users manually type it.
- Lesson-template writes must protect instructor time slots the same way calendar instance writes do for now: one instructor cannot have overlapping active templates on the same recurring day/date range. Group capacity is represented by the single template/slot, not by creating parallel templates at the same time.
- External service drag-to-calendar uses FullCalendar `droppable` + external `Draggable` items, but it does not create lessons directly on drop. Drop opens the existing add-lesson dialog prefilled with service/instructor/date/time so normal validation, participant selection, conflicts, and billing side-effects still go through the shared create flow.
- External service drag-to-template-manager follows the same pattern: drag opens the existing add-template dialog prefilled with service/instructor/day/time, and the API remains responsible for final validation and service-derived duration.
- Service catalog duration changes do not retroactively mutate already-created lesson instances. They affect only future instance creation and explicit service changes during instance editing.
- Manual template generation must resolve `lesson_participants.client_profile_id` from `students.client_profile_id` during proposal building, not only at apply time; preview and apply must follow the same participant-validity rules.
- Manual template generation must treat template `target_date` + `time_of_day` as `Asia/Jerusalem` local time when creating or comparing `lesson_instances.datetime_start`; never compare or insert using raw naive timestamps.
- Manual template generation apply is intentionally partial-success, not all-or-nothing. The backend must return a structured actionable issue list with student/template identifiers and retry metadata so the frontend can persist a repair review and offer retry-failed-only flows.
- The manual generation UI must gate every apply behind a fresh preview for the exact same scope. If the scope changes, the previous preview is stale and apply must be disabled until preview runs again.
- Manual generation opens on the next Sunday-Saturday week by default, independent of the currently selected calendar date. Generation warnings/issues must render user-facing Hebrew labels and person/service names; never expose raw UUIDs or backend enum strings as primary frontend text.
- Manual generation must not warn only because no HMO authorization exists for a student/service. Missing HMO authorization means regular/private billing unless existing HMO finance data is present but inactive, out of range, conflicting, exhausted, or malformed.
- Repair/retry review state for manual generation lives in frontend session storage; users may navigate to student or template screens to fix issues and then return to the saved review without losing the issue list.
- Version conflict and locked-state payloads already exist in [`../api/_shared/calendar-editing.js`](../api/_shared/calendar-editing.js).
- Billing is centralized. Calendar endpoints must not compute lesson prices or write `ledger_transactions` directly; they call `BillingLedgerService.syncLessonInstanceCharges(...)` or another service method after the lesson mutation succeeds.
- Attendance changes, lesson edits, and HMO authorization changes are coupled to ledger resync. Skipping the ledger service will create billing drift even if the lesson mutation succeeds.
- Calendar UI may display scheduled HMO-covered participants as "expected claim" from read-only coverage context, but claim-required closure state remains ledger/task-driven after attendance.
- HMO dashboard task creation on attendance must key off the synced billing result / active HMO ledger impact for that participant, not by re-running coverage resolution after the sync. Coverage entitlement is enforced from active ledger rows, so resolving again after the debit may incorrectly hide the just-created covered lesson.
- Correction flows may add manual financial adjustments, but the persisted ledger write still goes through `BillingLedgerService`.
- Instructor earnings previews and sync must stay aligned:
  - canonical payout rate comes from `instructor_service_capabilities.base_rate`
  - the preserved admin input lives in `metadata.compensation_input` and is display-only
  - payout uses lesson duration plus `Services.payment_model`
  - `payment_model = fixed_rate` pays once per lesson
  - `payment_model = per_student` multiplies by compensation-eligible participant count
- Templates and date-specific overrides are separate resources; do not collapse them into one model.
- Template management is rendered as a recurring weekly FullCalendar resource-timegrid view, not as real dated lesson instances. Use a fixed synthetic week/day model for display only; persisted templates still store `day_of_week` + `time_of_day`, and add/edit actions must continue through the template dialogs and `lesson-templates` API.
- Template management defaults to week view. Its calendar hides instructors without availability in the current view by default, but keeps instructors visible when they have visible templates there. The "show unavailable" and "show inactive" toggles live under template display options.
- Instructor WhatsApp schedule messages are built by [`../src/features/calendar/utils/instructor-whatsapp.js`](../src/features/calendar/utils/instructor-whatsapp.js). Keep lesson rows grouped by service, use "משתתפים" terminology, and let breaks interrupt service groups so the message remains scannable.
- Template creation must not silently auto-move an unavailable day/time to another available slot. Calendar slot selection and service drag should block immediately on unavailable instructor days/service windows and offer a path to edit instructor availability; dialogs may show validation but must not rewrite the user's selected day/time.
- Template creation UI should also warn/block before submit when the selected instructor/day/time overlaps an existing active template; the backend remains the final source of truth for overlap enforcement.
- Cancellation modal uses a server-backed preview action (`PUT /api/calendar/instances` with `action: 'preview-cancel-instance'`) before submitting cancellation, so UI impact text is based on current server state.
- Lesson `is_closed` is a workflow-state flag and does not hard-lock edits by itself. Hard lock enforcement for mutations uses finance lock sources only (`payroll_run`, `claim_batch`).
- `syncLessonClosureState` writes `lesson_instances` only when the closure evaluation really changed: `is_closed` / `closed_*`, or `workflow_state` compared key-sorted and without `evaluated_at`. Every write bumps `lesson_instances.version` via trigger, so never reintroduce an unconditional write. As a result, `workflow_state.evaluated_at` means "last changed", not "last checked".
- The lesson dialog's own mutations still bump lesson/participant versions (attendance changes `workflow_state.participants`), while the `instance` prop only refreshes after the calendar refetch.
  - After each successful write, `LessonInstanceDialog.jsx` re-reads `GET lesson-instances/:id` (`syncVersionsFromServer`) and sends the fresher versions (`getCurrentInstanceVersion` / `getCurrentParticipantVersion`), so follow-up actions don't hit false `version_conflict` 409s.
  - New dialog mutations must follow the same pattern.
- Session reports are internal `form_submissions` rows with `source='internal'`, a non-null `lesson_participant_id`, and a per-service `Services.report_form_id`. Do not reintroduce `SessionRecords`, loose reports, or the admin assign/reject workflow; those endpoints and clients are retired.
- Report writes and reads must fail closed unless `organizations.permissions.session_reports_enabled === true`. Non-admin instructors are self-scoped through `lesson_instances.instructor_employee_id` resolved from their own `Employees.user_id`.
- Report creation may document a past `scheduled` or `attended` participant, never creates or mutates lesson/attendance rows, and must reject future lessons plus `no_show`/`cancelled_*` participants.
- Post-save continuation must remain anchor-based. Pending-report callers may pass an ordered `continuationQueue` of real `lesson_participant_id` contexts; calendar callers without a queue route users to `/pending-reports`. Never restore TutTiud's loose student/date chooser.
- E1/E2 are blocking policies: attendance/cancellation paths must call the shared session-report guard before moving a documented participant to a non-arrival state or cancelling a documented lesson. The guard only considers non-legacy anchored reports.
- Pending reports come from `GET /api/session-reports?mode=pending&scope=mine|all&page=...`; they are past eligible participants with an assigned service report form and no non-legacy report. Exact report-excluding pagination/counting lives in the org-scoped `list_pending_session_reports` SQL function in `setup-sql.js`; do not paginate candidates before removing documented rows. `scope=all` is office/admin only, while instructors see only their own lessons. Admin/office page 1 also receives the E7 `documented_unconfirmed` drift set.
- Import Workspace lessons use `created_source='migration'` and retain source-system IDs in
  metadata. Past imported lessons set `metadata.import.exclude_from_pending_reports=true`;
  both the exact pending SQL function and the E7 drift reader must exclude them. Future
  imported lessons do not set the exclusion and become pending normally after they occur.
- Historical imported attendance suggestions remain under participant import metadata while
  live `participant_status` stays `scheduled`; this deliberately avoids invoking or later
  accidentally triggering historical billing/payroll before that migration policy exists.
  Future imported participants are also scheduled and enter the normal attendance mutation
  flow, which remains responsible for billing/payroll synchronization.
