# Calendar Workflow Implementation Plan

Status: active
Owner: Codex
Last updated: 2026-03-31

This folder tracks the end-to-end implementation of the calendar attendance, billing, payroll, HMO, and closure workflow around `lesson_instances`.

The goal is to stop overloading one status field with multiple meanings and make the system behave correctly for:
- participant attendance decisions
- student billing decisions
- instructor compensation decisions
- HMO claim obligations
- lesson closure via `lesson_instances.is_closed`

## Core Decisions

These decisions are treated as the approved implementation direction for this workflow:

1. Attendance resolution and closure are different things.
   - Attendance resolution answers: what happened for each participant?
   - Closure answers: can this lesson instance be locked because all required downstream work is done?

2. `lesson_instances.is_closed` is the closure field.
   - `is_closed = false` means the lesson is still operationally open.
   - `is_closed = true` means all required downstream obligations are complete and the lesson may be treated as locked/closed.

3. Student billing and instructor compensation are independent decisions.
   - Student billing is driven by participant status plus org billing policy.
   - Instructor compensation is not implied forever by participant status.
   - For chargeable ambiguous non-arrival states, the user will explicitly choose whether the instructor is compensated for that participant.

4. Instructor compensation prompt scope is per participant.
   - Ask only when the participant status is a chargeable ambiguous non-arrival state.
   - Do not ask for `attended`.
   - Do not ask when policy makes the answer irrelevant.

5. Student billing is resolved when the ledger effect is posted.
   - Students pay in advance.
   - Negative balance is allowed for later billing flows.
   - The closure rule does not wait for real-world cash collection.

6. Instructor compensation is resolved only when payroll is paid.
   - `lesson_earnings` means earning created, not fully settled.
   - Actual closure waits for the lesson's instructor-compensation obligation to be included in a paid `payroll_run`.

7. HMO is resolved when the claim obligation is submitted/resolved.
   - Open HMO submission tasks keep the lesson open.

8. Current payroll model remains per lesson unless explicitly changed later.
   - Current system creates one `lesson_earnings` row per `employee_id + lesson_instance_id`.
   - Per-student payroll is not part of this implementation unless later approved as a separate payroll-model change.

## End State

At the end of this implementation:
- attendance actions will persist explicit participant-side financial/compensation decisions
- revert previews will explain every downstream effect that will be reversed
- restore/reclassification flows will reconcile billing, payroll, instructor attendance, and HMO tasks correctly
- `lesson_instances.is_closed` will be automatically derived from real settlement state
- locked/closed behavior will align with payroll-paid, student-billed, and HMO-submitted reality

## Phase Index

1. [Phase 1 - Foundation](/C:/dev/Reinex/implementations/calendar/workflow/phase-01-foundation.md)
2. [Phase 2 - Participant Financial Decisions](/C:/dev/Reinex/implementations/calendar/workflow/phase-02-participant-financial-decisions.md)
3. [Phase 3 - Artifact Sync and Revert Symmetry](/C:/dev/Reinex/implementations/calendar/workflow/phase-03-artifact-sync-and-revert-symmetry.md)
4. [Phase 4 - Closure and Locking](/C:/dev/Reinex/implementations/calendar/workflow/phase-04-closure-and-locking.md)
5. [Phase 5 - UI Completion and Operational Visibility](/C:/dev/Reinex/implementations/calendar/workflow/phase-05-ui-completion-and-operational-visibility.md)
6. [Phase 6 - Verification and Migration Hardening](/C:/dev/Reinex/implementations/calendar/workflow/phase-06-verification-and-migration-hardening.md)
7. [Phase 7 - Review and Anti-Hallucination Sweep](/C:/dev/Reinex/implementations/calendar/workflow/phase-07-review-and-anti-hallucination-sweep.md)

## Progress Tracker

- [x] Planning documents created
- [~] Phase 1 in progress
- [~] Phase 2 in progress
- [~] Phase 3 in progress
- [~] Phase 4 in progress
- [~] Phase 5 in progress
- [ ] Phase 6 implemented
- [~] Phase 7 in progress

## Current Stage

Current implementation stage: Phase 6

Implemented in code so far:
- shared calendar workflow helper added
- participant workflow metadata normalization added
- lesson closure evaluation added
- `lesson_instances.is_closed` sync wired into key mutation flows
- SSOT comments updated to document closure/workflow intent
- explicit per-participant instructor-compensation decision capture added for chargeable ambiguous non-arrival states
- calendar dialog now prompts for that decision only when required by billing policy
- restore preview generalized into participant-status transition preview
- system instructor attendance now counts only completed lessons that actually imply instructor compensation
- closure evaluation now inspects underlying `payroll_runs` / `claim_batches` statuses behind locks instead of treating any lock as settled
- direct lesson/attendance mutations now treat `is_closed` as a lock guard and still expose the correction path cleanly
- lesson dialog now shows operational closure state, unresolved blockers, and per-participant workflow decisions
- lesson dialog now derives safer display decisions for legacy participants even when workflow metadata is missing
- Phase 7 review sweep has started and already removed unsupported assumptions in preview billing context and legacy HMO display inference

Still remaining in the current stage:
- validate the closure evaluator against real payroll/claim lock realities
- validate behavior on legacy rows and singleton/multi-participant lessons
- document the final operational test matrix and perform a review sweep for strange or unsupported assumptions

## Non-Negotiables For This Work

- No silent financial state changes.
- No status-driven shortcuts where a persisted source decision is required.
- No closure based only on attendance resolution.
- No UI prompt without persisted source-side meaning.
- No revert logic that depends only on current policy without consulting persisted decisions and current artifacts.

## Tracking Convention

Each phase file contains:
- objective
- scope
- required schema/API/UI changes
- implementation checklist
- acceptance criteria
- completion notes

When a phase is completed, mark its checklist items and update this README.
