# Phase 2 - Participant Financial Decisions

Status: in progress

## Objective

Make student billing and instructor compensation explicit participant-side decisions instead of long-term implicit guesses from participant status alone.

## Scope

- Add per-participant decision persistence for ambiguous non-arrival flows.
- Introduce the instructor-compensation prompt in the UI for the allowed cases only.
- Persist the decision at the source level before syncing downstream artifacts.

## Required Changes

- Attendance dialog prompt for chargeable ambiguous non-arrival statuses.
- Backend payload support for instructor compensation choice.
- Persist decision details into participant workflow metadata.
- Keep student billing decision and instructor compensation decision separate.

## Checklist

- [x] Define exact decision payload contract
- [x] Implement UI prompt for eligible non-arrival actions
- [x] Persist decision source-side on participant metadata
- [x] Add audit coverage for decision capture
- [ ] Update previews to show the chosen compensation path

## Acceptance Criteria

- UI asks the compensation question only when product rules require it.
- The chosen decision is persisted before artifact sync.
- Revert preview can explain what was chosen and what will be reversed.

## Completion Notes

Backend now accepts `instructor_compensation_decision` for chargeable ambiguous non-arrival statuses and persists it into participant workflow metadata.
The calendar lesson dialog now asks that question only when the billing policy says the participant should still be charged for the selected non-arrival status.
