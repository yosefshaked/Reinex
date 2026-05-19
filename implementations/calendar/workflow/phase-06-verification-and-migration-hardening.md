# Phase 6 - Verification and Migration Hardening

Status: in progress

## Objective

Finish the workflow professionally with migration safety, legacy compatibility, and explicit verification coverage.

## Scope

- Harden legacy fallback behavior.
- Ensure existing rows receive safe defaults.
- Verify singleton and multi-participant lessons.
- Verify payroll-paid closure behavior against `payroll_runs`.

## Checklist

- [ ] Add SSOT-safe migrations for legacy workflow metadata defaults
- [ ] Verify singleton `no_show` and cancellation lessons
- [ ] Verify multi-participant mixed-resolution lessons
- [ ] Verify restore from each non-arrival type
- [ ] Verify payroll-run settlement closes lessons only after month payment
- [ ] Verify HMO claim submission closes relevant lessons only when complete
- [ ] Document final operational test matrix in this folder

## Acceptance Criteria

- Legacy rows do not break the workflow.
- Closure behaves correctly before and after payroll payment.
- The test matrix covers all major participant-state transitions and closeout paths.

## Completion Notes

Legacy display fallback is now hardened in the lesson dialog so missing workflow metadata does not automatically degrade to ambiguous "unknown" badges when current participant state already implies a safe display fallback.
