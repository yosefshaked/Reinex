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
- `fetchLooseSessions`, `assignLooseSession`, `createAndAssignLooseSession`, `rejectLooseSession`
- `buildSessionMetadata`, session form version helpers
- `normalizeWorkflowDecision`, `readParticipantWorkflowMetadata`, `shouldParticipantTriggerInstructorCompensation` in [`../api/_shared/calendar-workflow-decisions.js`](../api/_shared/calendar-workflow-decisions.js)
- `extractQuestionsForVersion` in [`../api/_shared/version-lookup.js`](../api/_shared/version-lookup.js) — backend mirror of `src/features/sessions/utils/version-lookup.js`; keep both in sync

## Known patterns / do not reinvent
- Calendar writes must enforce membership scope and instructor self-scope for non-admin users.
- Availability checks come from service-capability `availability_windows`; do not duplicate availability math.
- Version conflict and locked-state payloads already exist in [`../api/_shared/calendar-editing.js`](../api/_shared/calendar-editing.js).
- Billing is centralized. Calendar endpoints must not compute lesson prices or write `ledger_transactions` directly; they call `BillingLedgerService.syncLessonInstanceCharges(...)` or another service method after the lesson mutation succeeds.
- Attendance changes, lesson edits, and HMO authorization changes are coupled to ledger resync. Skipping the ledger service will create billing drift even if the lesson mutation succeeds.
- Correction flows may add manual financial adjustments, but the persisted ledger write still goes through `BillingLedgerService`.
- Templates and date-specific overrides are separate resources; do not collapse them into one model.
- Pending reports / loose sessions already have shared API wrappers and error mapping.
