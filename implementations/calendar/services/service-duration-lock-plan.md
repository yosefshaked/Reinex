# Service Duration Lock For Calendar Instances

Status: implemented
Owner scope: calendar instance create/edit flows
Decision date: 2026-04-20
Implementation completed: 2026-04-20

## Goal
Make lesson-instance duration in normal calendar workflows authoritative from the selected service, so office users cannot freely create billing-inconsistent lessons by changing instance length manually.

## Final product rule
- In normal calendar instance creation and editing, `duration_minutes` is locked to the selected service's `duration_minutes`.
- When the selected service changes during create/edit, the instance duration updates to the newly selected service duration.
- Users do not get a manual duration override in these flows.
- Service catalog duration changes do not retroactively change already-created lesson instances.
- If staff want an already-created lesson to differ, that remains out of scope for this batch and must be handled through explicit per-instance editing.

## Non-goals
- No finance contract refactor.
- No duration-based student billing redesign.
- No service-level toggle such as "duration locked" vs "duration editable".
- No exception path in the current UI.
- No external drag-from-service-palette feature in this batch.
- No retroactive migration of existing `lesson_instances.duration_minutes`.

## Implementation summary
This batch was completed as a guardrail implementation, not as a pricing-model redesign.

What was done:
- Backend create/update now treat active service duration as the source of truth.
- Normal calendar dialogs no longer allow free-hand duration editing.
- Existing lessons keep their stored duration unless the user explicitly changes the service on that lesson.
- Service catalog edits do not automatically rewrite stored lesson instances.
- Calendar domain documentation was updated to record the new invariant.
- A future brainstorm issue was opened for broader service-to-calendar UX and policy work: GitHub issue `#27`.

## Delivered changes

### 1. Backend enforcement
File: `api/calendar/index.js`

Implemented:
- Added `normalizePositiveDurationMinutes(value)` to validate and normalize service duration values before use.
- Added `loadActiveServiceForCalendar(client, orgId, serviceId)` to load the service with org scoping and reject inactive/missing services for normal calendar flows.
- Updated create flow to ignore caller-supplied `duration_minutes` and resolve the canonical duration from the selected service.
- Updated update flow so duration changes only when `service_id` changes on that lesson instance.

Small details:
- Service duration is now resolved before instructor availability validation.
- Inserted `lesson_instances.duration_minutes` now comes from the service record, not free-hand UI input.
- Audit payload details now reflect the resolved service duration instead of arbitrary client-provided duration.
- Update behavior is intentionally split:
  - service unchanged: preserve the lesson's stored duration
  - service changed: replace duration from the newly selected service
- Validation/server responses added for this enforcement:
  - `invalid_service_duration`
  - `failed_to_load_service`

Final invariant:
- Existing lesson instances are stable records.
- Changing `Services.duration_minutes` later affects only future create/edit operations where the user actively selects that service.

### 2. Add lesson UI
File: `src/features/calendar/components/AddLessonDialog.jsx`

Implemented:
- Removed normal free-hand duration editing from the create dialog.
- Replaced the editable duration control with a read-only service-derived duration display.
- Preserved the existing service-selection sync so local form state still tracks the selected service duration.

Small details:
- Added derived state for selected service duration validity.
- Submit is blocked when the selected service has no valid usable duration.
- Backend errors `invalid_service_duration` and `failed_to_load_service` are now surfaced in the dialog.
- The payload still carries `duration_minutes` for compatibility, but it is now aligned with the selected service and is no longer user-authored.

### 3. Lesson edit UI
File: `src/features/calendar/components/LessonInstanceDialog.jsx`

Implemented:
- Removed free-hand duration editing from the standard lesson edit flow.
- Made duration read-only and service-derived in the edit experience.
- Updated service change handling so selecting a different service updates local duration immediately.

Small details:
- Opening an existing lesson still shows that lesson's stored duration.
- If the user edits date/time only, duration stays unchanged.
- If the user changes service, the dialog updates duration from the newly selected service before save.
- Save is blocked when the chosen service has an invalid duration.
- Backend errors `invalid_service_duration` and `failed_to_load_service` are surfaced in the edit flow as well.

### 4. Service catalog stability
Files:
- `api/services/index.js`
- `api/calendar/index.js`

Outcome:
- No direct service-catalog write-path change was needed for this batch.
- The required behavior was enforced by the calendar create/edit path instead.

Small details:
- Updating a service duration in settings does not trigger any background rewrite of existing `lesson_instances`.
- This was kept intentionally, per product decision.
- If staff want old instances updated, they must enter and edit the relevant instances manually.

### 5. Documentation update
File: `agents-docs/60-calendar-and-sessions.md`

Implemented:
- Added the calendar invariant that duration is service-derived in normal create/edit flows.
- Added the rule that service duration changes are non-retroactive for already-created lesson instances.

Small details:
- The doc now reflects both sides of the rule:
  - duration is locked during normal calendar operations
  - existing stored lessons remain stable until explicitly edited

## Technical notes
- This remains a guardrail, not a billing redesign.
- Billing continues to follow the current finance contract.
- Instructor earnings continue to use the current duration-aware logic.
- The purpose of this batch was to stop the calendar from creating service/lesson-duration mismatches in normal office workflows.

## Risks and accepted tradeoffs
- Existing lessons that were previously saved with custom durations remain as-is. That was accepted intentionally.
- Services with null/zero/invalid duration are now invalid for normal calendar create/edit until fixed in settings.
- Template generation flows were not the target of this batch.
- The UI is intentionally strict for now; no exception path was added.

## Verification completed
- `npx eslint api/calendar/index.js src/features/calendar/components/AddLessonDialog.jsx src/features/calendar/components/LessonInstanceDialog.jsx`
- `npm run build`

Verified behaviors:
- Creating a lesson from the calendar with service A stores service A duration.
- Changing service during create updates the displayed locked duration.
- Editing an existing lesson without changing service does not allow manual duration editing.
- Editing an existing lesson and changing service updates duration to the new service duration.
- Updating a service's duration in settings does not mutate existing stored lesson instances.
- Calendar create/update still validates availability using the resolved effective duration.

## Deferred follow-up topics
- Whether duration locking should remain global or later become a configurable service policy.
- Whether duration-based student billing should exist for some services.
- Whether the calendar should support dragging services from a side palette into the schedule to create locked-duration lessons faster.
- Whether service-to-calendar creation UX should be redesigned more broadly in a future batch.
