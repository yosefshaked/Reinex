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
- [`../src/features/sessions/api/loose-sessions.js`](../src/features/sessions/api/loose-sessions.js)
- [`../src/features/sessions/utils/`](../src/features/sessions/utils/)
- [`../api/calendar/index.js`](../api/calendar/index.js)
- [`../api/calendar-attendance/index.js`](../api/calendar-attendance/index.js)
- [`../api/calendar-corrections/index.js`](../api/calendar-corrections/index.js)
- [`../api/calendar-conflicts/index.js`](../api/calendar-conflicts/index.js)
- [`../api/lesson-instances/index.js`](../api/lesson-instances/index.js)
- [`../api/lesson-templates/index.js`](../api/lesson-templates/index.js)
- [`../api/lesson-template-overrides/index.js`](../api/lesson-template-overrides/index.js)
- [`../api/loose-sessions/index.js`](../api/loose-sessions/index.js)
- [`../api/_shared/BillingLedgerService.js`](../api/_shared/BillingLedgerService.js)
- [`../api/_shared/calendar-editing.js`](../api/_shared/calendar-editing.js)
- [`../api/_shared/calendar-workflow.js`](../api/_shared/calendar-workflow.js)
- [`../api/_shared/calendar-corrections.js`](../api/_shared/calendar-corrections.js)
- [`../api/_shared/calendar-workflow-decisions.js`](../api/_shared/calendar-workflow-decisions.js)
- [`../api/_shared/lesson-instance-status.js`](../api/_shared/lesson-instance-status.js)
- [`../api/_shared/session-metadata.js`](../api/_shared/session-metadata.js)
- [`../api/_shared/version-lookup.js`](../api/_shared/version-lookup.js)

## Shared helpers to reuse
- `useCalendarInstances`, `useCalendarInstructors`
- `useTemplates`, `useTemplateMutations`, `useTemplateOverrides`
- Local date and adapter helpers in [`../src/features/calendar/utils/`](../src/features/calendar/utils/)
- `fetchLessonMutationState`, `parseExpectedVersion`, `respondWithLockedMutation`, `respondWithVersionConflict`
- `syncLessonClosureState`, correction helpers, lesson-status helpers
- `enrichLessonInstancesWithHmoCoverage` in [`../api/_shared/calendar-hmo-coverage.js`](../api/_shared/calendar-hmo-coverage.js) for read-only calendar response enrichment of participant HMO coverage context.
- `cancelLessonInstanceWithParticipants`, `completeLessonInstanceWithParticipants`, and `cancelSelectedScheduledParticipantsAndReconcileInstance` in [`../api/_shared/lesson-instance-status.js`](../api/_shared/lesson-instance-status.js) are RPC wrappers over org-scoped SQL functions and must always receive `orgId` alongside `instanceId`
- `fetchLooseSessions`, `assignLooseSession`, `createAndAssignLooseSession`, `rejectLooseSession`
- `buildSessionMetadata`, session form version helpers
- `normalizeWorkflowDecision`, `readParticipantWorkflowMetadata`, `shouldParticipantTriggerInstructorCompensation` in [`../api/_shared/calendar-workflow-decisions.js`](../api/_shared/calendar-workflow-decisions.js)
- `extractQuestionsForVersion` in [`../api/_shared/version-lookup.js`](../api/_shared/version-lookup.js) — backend mirror of `src/features/sessions/utils/version-lookup.js`; keep both in sync

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
- Template creation must not silently auto-move an unavailable day/time to another available slot. Calendar slot selection and service drag should block immediately on unavailable instructor days/service windows and offer a path to edit instructor availability; dialogs may show validation but must not rewrite the user's selected day/time.
- Cancellation modal uses a server-backed preview action (`PUT /api/calendar/instances` with `action: 'preview-cancel-instance'`) before submitting cancellation, so UI impact text is based on current server state.
- Lesson `is_closed` is a workflow-state flag and does not hard-lock edits by itself. Hard lock enforcement for mutations uses finance lock sources only (`payroll_run`, `claim_batch`).
- Pending reports / loose sessions already have shared API wrappers and error mapping.
- Session Records / loose-session flows are currently feature-disabled in the frontend via `src/features/sessions/config/session-records.js`. Do not remove the backend endpoints, but do not mount UI flows or fire API calls while the feature is off.
