# Phase 5 - UI Completion and Operational Visibility

Status: in progress

## Objective

Surface the workflow state clearly in the UI so users can understand why a lesson is still open, what decisions were made, and what remains before closure.

## Scope

- Show settlement-relevant status in the lesson dialog.
- Show why a lesson is not closed.
- Improve previews and success feedback for participant transitions.
- Make audit/history readable for operations staff.

## Checklist

- [x] Add visible settlement status sections to lesson dialog
- [x] Show unresolved obligations blocking closure
- [x] Show persisted instructor compensation decision where relevant
- [x] Expand revert and reclassification previews
- [x] Improve audit labels/details for student and instructor history

## Acceptance Criteria

- Users can explain why a lesson is still open from the UI.
- Users can see what financial/operational decisions were made per participant.
- Revert and reclassification previews are operationally complete.

## Completion Notes

The lesson dialog now shows whether the lesson is operationally open/closed, the workflow blockers that still prevent closure, and each participant's persisted billing/compensation/HMO decisions.
Transition previews are now grouped by operational area instead of one flat list, and the audit formatter has explicit labels for the new attendance-workflow impact structures.
