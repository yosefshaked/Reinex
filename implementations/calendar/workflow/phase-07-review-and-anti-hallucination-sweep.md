# Phase 7 - Review and Anti-Hallucination Sweep

Status: in progress

## Objective

Perform a disciplined post-implementation review to catch hallucinations, unsupported assumptions, inconsistent flows, and weird implementation artifacts before the workflow is treated as complete.

## Scope

- Review each prior phase against the actual code paths now in production.
- Look for assumptions that were never backed by schema or real runtime behavior.
- Look for UX or audit outputs that expose internal implementation details instead of operational meaning.
- Remove strange legacy fallbacks or one-off exceptions that no longer belong.

## Checklist

- [~] Review Phase 1 foundation code against real mutation/write paths
- [ ] Review Phase 2 participant-decision logic against actual allowed status transitions
- [ ] Review Phase 3 preview/apply symmetry for unsupported edge cases
- [ ] Review Phase 4 closure rules against actual payroll/claim artifacts and lock semantics
- [ ] Review Phase 5 UI/audit surfaces for misleading or low-signal outputs
- [ ] Document findings, fixes, and any intentionally accepted risks

## Acceptance Criteria

- Every major workflow assumption is traceable to real schema or runtime behavior.
- No known "AI-style" abstraction remains where the product actually requires a concrete domain rule.
- Any remaining risk is explicitly documented rather than silently implied away.

## Completion Notes

Review started.

Initial fixes already applied:
- Removed a preview-billing assumption that used a raw commitment row instead of the runtime-enriched commitment shape used by the real billing engine.
- Removed an unsupported UI inference that treated any `commitment_id` as enough evidence to show pending HMO workflow.
- Removed an unsupported lock-helper assumption that checked `participant.is_closed` even though participants do not have a closure field in the schema or mutation-state loader.
- Removed a closure-evaluator inconsistency that kept zero-participant lessons permanently attendance-unresolved even though the surrounding workflow already treats zero-participant lessons as exempt from attendance blocking.
- Removed a closure/billing mismatch where student-billing settlement was inferred only from positive ledger amount even though the billing engine can persist a resolved `charged` decision with zero student charge.
- Removed an HMO-closure assumption that depended only on workflow metadata or open tasks by deriving required HMO claim handling from actual attended HMO commitments as well.
- Removed a UI gating mismatch where participant actions were blocked as soon as an instance stopped being `scheduled`, even though the workflow now intentionally allows open-but-completed lessons to remain mutable until they are truly closed.
- Removed a correction-path gap where manual calendar corrections could change billing/payroll/attendance artifacts without resyncing `lesson_instances.is_closed` afterward.
- Removed an outdated reminder-confirmation shortcut that still posted `cancelled_student` directly and bypassed the newer compensation-decision flow for chargeable cancellations.
- Removed a closure-evaluator mismatch where persisted billing outcomes such as `not_chargeable` could still leave a participant looking billing-unresolved because closure re-inferred chargeability too loosely from policy instead of respecting the stored billing decision context.
- Removed a correction-preview divergence where payroll and billing deltas were still calculated with local pre-workflow heuristics instead of the shared instructor-compensation and billing-decision helpers used by the live attendance flow.
- Removed an instance-completion shortcut that promoted scheduled participants directly to `attended` without persisting participant workflow metadata, attendance-resolution snapshots, or attended-HMO task side effects.
- Removed a student-suspension bulk-cancel bypass where future participant cancellations were written directly without workflow metadata, attendance-resolution snapshots, or downstream artifact/closure resync.
- Removed a stale calendar-instance comment that still described the billing/decision trail as future work even though the shared workflow implementation now exists.

Current static-review notes / accepted risks:
- `lesson_participants.locked_at` exists in the schema and is still respected by mutation guards, but no active write path was found in the reviewed repo code. It is being treated as a legacy/manual lock signal until proven otherwise during manual QA.
