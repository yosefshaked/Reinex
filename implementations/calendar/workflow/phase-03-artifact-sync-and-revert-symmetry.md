# Phase 3 - Artifact Sync and Revert Symmetry

Status: in progress

## Objective

Make billing, lesson earnings, instructor attendance, and HMO artifacts fully symmetric for apply and revert flows.

## Scope

- Rework artifact sync so it derives from persisted participant decisions plus current state.
- Ensure revert uses both:
  - persisted source decisions
  - current existing artifacts
- Remove remaining asymmetries where preview, apply, and revert disagree.

## Checklist

- [ ] Refactor student billing sync to respect persisted source decisions
- [ ] Refactor instructor earning sync to respect persisted source decisions
- [x] Refactor instructor attendance sync to respect persisted source decisions
- [x] Make restore preview and apply paths use the same shared derivation logic
- [x] Extend preview/apply symmetry to “not arrived” type-to-type transitions
- [x] Add explicit audit events for downstream artifact reversals

## Acceptance Criteria

- Preview and apply match for billing, payroll, attendance, and HMO.
- Reverting a participant clears or updates all related downstream artifacts correctly.
- No downstream artifact remains only because current org policy changed after the original action.

## Completion Notes

System attendance now only counts completed lessons whose participants still imply instructor compensation, instead of every completed lesson by default.
The calendar attendance preview endpoint now supports arbitrary participant status transitions, and the dialog uses that preview before confirming type-to-type non-arrival changes.
Attendance transitions now write explicit student/control and tenant audit entries with the same projected downstream impacts the user reviewed before confirming.
