# Phase 1 - Foundation

Status: in progress

## Objective

Create the shared settlement model and backend evaluation primitives that the rest of the workflow will depend on.

This phase does not yet introduce the final user prompt for instructor compensation. It establishes the data and shared logic needed so later changes are implemented once and reused everywhere.

## Scope

- Define and persist settlement-relevant participant decisions in schema-safe form.
- Add shared backend helpers for:
  - participant attendance resolution state
  - billing resolution state
  - instructor compensation resolution state
  - HMO resolution state
  - lesson closure evaluation
- Stop treating lesson closure as equivalent to `status === 'completed'`.
- Start deriving `lesson_instances.is_closed` from settlement state.

## Required Changes

### Schema

- Extend `lesson_participants.metadata` usage with a well-defined workflow object for:
  - `student_billing_decision`
  - `instructor_compensation_decision`
  - `hmo_claim_requirement`
  - audit metadata about who/when decided
- Keep the first implementation in structured metadata because the table already supports `metadata jsonb`.
- Update SSOT comments and migration logic so this structure is explicit and not ad hoc.

### Backend shared logic

- Add one shared calendar workflow helper module that owns:
  - reading participant workflow metadata safely
  - normalizing defaults for legacy rows
  - evaluating whether a participant is:
    - attendance-resolved
    - billing-resolved
    - instructor-compensation-resolved
    - HMO-resolved
  - evaluating whether the lesson instance should be `is_closed`
- Ensure helper comments clearly separate:
  - stable shared evaluation logic
  - per-action business logic that still belongs in API handlers

### API integration

- Update current attendance mutation flows so they can call the shared closure evaluator after each mutation.
- Do not force-close any lesson yet unless the evaluator says all obligations are resolved.
- Preserve backward compatibility for legacy rows without workflow metadata.

## Checklist

- [x] Add shared workflow helper module
- [x] Normalize legacy participant workflow metadata reads
- [x] Implement participant settlement evaluation helpers
- [x] Implement lesson `is_closed` evaluator
- [x] Wire evaluator into calendar attendance mutations
- [x] Wire evaluator into lesson instance mutations that affect financial state
- [x] Update SSOT documentation/comments for workflow metadata usage
- [ ] Broaden closure sync coverage to all remaining relevant write paths
- [ ] Validate closure criteria against payroll/claim lock behavior on real data
- [ ] Validate legacy and singleton lesson behavior

## Acceptance Criteria

- Every attendance-affecting mutation can evaluate lesson closure consistently through one shared path.
- Legacy rows without workflow metadata still behave safely.
- `lesson_instances.is_closed` is no longer a dead field in workflow logic.
- No UI change in this phase depends on fake or inferred placeholder state.

## Completion Notes

Implemented:
- New shared helper: [calendar-workflow.js](/C:/dev/Reinex/api/_shared/calendar-workflow.js)
- `fetchLessonMutationState()` now includes `lesson_instances.is_closed`
- Attendance and lesson-instance mutations now resync `lesson_instances.is_closed`
- SSOT comments now document the intended use of `is_closed` and `metadata.workflow`

Open items:
- The closure evaluator currently uses existing payroll/claim locks plus current artifacts.
- Later phases still need to make instructor compensation decisions explicit instead of inferred.
- Closure sync should still be reviewed for every remaining write path that can affect settlement state.
