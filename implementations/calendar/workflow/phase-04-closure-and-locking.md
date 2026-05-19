# Phase 4 - Closure and Locking

Status: in progress

## Objective

Drive `lesson_instances.is_closed` from real settlement completion and align lock behavior with that state.

## Scope

- Compute lesson closure from:
  - all participants attendance-resolved
  - student billing posted
  - instructor compensation either not applicable or included in a paid payroll run
  - HMO claim submitted/resolved when required
- Prevent closure while any required obligation remains open.
- Use closure in lock/guard logic.

## Checklist

- [x] Add payroll-run settlement evaluation for lesson earnings
- [x] Add HMO settlement evaluation for relevant participants
- [x] Update `lesson_instances.is_closed` whenever relevant downstream state changes
- [x] Align mutation guards with `is_closed`
- [ ] Ensure correction workflows still behave correctly for closed lessons

## Acceptance Criteria

- A lesson can remain attendance-resolved but open.
- A lesson closes only after student billing, payroll settlement, and HMO obligations are complete.
- Closed lessons are guarded consistently.

## Completion Notes

Closure now requires a finalized payroll run behind payroll locks, and submitted/paid claim batches behind claim locks.
Open HMO tasks are no longer enough to determine closure by themselves; participants with pending/required HMO workflow stay open until claim-settlement evidence exists.
Direct lesson mutations now treat `is_closed` as a lock guard, while correction list payloads expose closed lessons as locked so the correction route stays available.
