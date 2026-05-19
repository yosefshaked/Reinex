# Calendar Instance Editing - Edge Cases and Importance Classification

This document classifies edge cases for enabling edits on calendar instances and historical instances (same source of code), with focus on payroll, claims, and student transfers.

## Badge Legend
- [NEW-HEAVY]: Requires substantial new implementation (backend + business rules + workflow changes).
- [NEW-LIGHT]: Requires small/targeted implementation (validation, UI/API guard, or small schema/process addition).
- [CONFIG/POLICY]: Mostly policy/config/process and can be applied with minimal code changes.

## Very High Importance
Destructive and not temporarily acceptable even with responsible handling.

1. [NEW-HEAVY] Retroactive status change after payroll finalized
- Risk: historical payroll corruption and incorrect instructor compensation.
- Why destructive: rewrites closed financial truth.

2. [NEW-HEAVY] Retroactive attendance/status change after claim submission
- Risk: claim mismatch, legal/compliance exposure.
- Why destructive: mutates data already used for external filing.

3. [NEW-HEAVY] Instructor reassignment in closed payroll period
- Risk: compensation assigned to wrong person and period.
- Why destructive: invalidates finalized payroll ledger.

4. [NEW-HEAVY] Service type/rate-affecting edit after billing posted
- Risk: wrong pricing and reimbursement basis.
- Why destructive: changes historical financial contract context.

5. [NEW-HEAVY] Datetime edit crossing pay/claim boundary after finalization
- Risk: event moves across locked accounting/claim windows.
- Why destructive: alters period ownership of already settled records.

6. [NEW-HEAVY] Reopen completed instance without reversing downstream artifacts
- Risk: double counting or orphaned payroll/claim adjustments.
- Why destructive: creates inconsistent system-of-record chain.

7. [NEW-LIGHT] Deleting/overwriting original reason or notes for sensitive statuses
- Risk: loss of legal/audit traceability.
- Why destructive: removes historical evidence.

8. [NEW-LIGHT] Cross-tenant/org edit due to weak server-side scoping
- Risk: data breach and corruption of another tenant.
- Why destructive: unauthorized modification of external domain data.

9. [NEW-HEAVY] Roster mutation after completion in finalized periods
- Risk: ghost attendance and payroll drift.
- Why destructive: changes who was recorded as participating post factum.

10. [NEW-LIGHT] Backdated edits beyond compliance/legal lock date
- Risk: non-compliant historical records.
- Why destructive: rewrites records that must remain immutable by policy.

## High Importance
Non-destructive but not temporarily acceptable even with responsible handling.

1. [NEW-LIGHT] Concurrent edits by multiple users without conflict control
- Risk: silent last-write-wins and hidden data loss.

2. [NEW-LIGHT] Stale-tab edits (old version saved over new state)
- Risk: valid newer data overwritten unintentionally.

3. [NEW-LIGHT] Missing mandatory reason/explanation for sensitive edits
- Risk: weak governance and poor accountability.

4. [NEW-LIGHT] Privilege overreach (instructor editing non-owned or historical-sensitive records)
- Risk: unauthorized business impact.

5. [NEW-HEAVY] Inconsistent transition rules between instance status and participant status
- Risk: broken downstream interpretation despite data still present.

6. [NEW-LIGHT] No idempotency protection on retries
- Risk: duplicate side effects and repeated adjustments.

7. [NEW-LIGHT] Improper timezone/DST handling on edit validation
- Risk: operational misclassification across dates/periods.

8. [NEW-LIGHT] Reason code taxonomy uncontrolled (free text only)
- Risk: reporting/governance degradation and ambiguous corrections.

9. [NEW-LIGHT] Same mutation path for operational edits and historical corrections
- Risk: missing policy separation and wrong authorization logic.

10. [NEW-LIGHT] Template edits accidentally affecting historical concrete instances
- Risk: silent policy violation and unexpected record drift.

## Medium Importance
Destructive but temporarily acceptable with proper and responsible handling.

1. [NEW-LIGHT] Clearing non-critical descriptive fields used in analytics only
- Risk: reduced context quality.
- Temporary acceptability condition: full audit snapshot + reversible history.

2. [NEW-LIGHT] Rewording free-text note that is not legal/claim-critical
- Risk: historical nuance loss.
- Temporary acceptability condition: append-only note revision log.

3. [NEW-HEAVY] Bulk correction where subset fails and manual follow-up is required
- Risk: partial destructive outcomes in intermediate state.
- Temporary acceptability condition: per-item transaction log + retry workflow.

4. [NEW-LIGHT] Correcting mis-tagged cancellation reason in open periods
- Risk: historical categorization rewrite.
- Temporary acceptability condition: supervisor review + audit before/after.

## Low Importance
Non-destructive and temporarily acceptable with proper and responsible handling.

1. [NEW-HEAVY] Notification mismatch after edit (student/guardian messaging lag)
- Risk: communication inconsistency.
- Temporary acceptability condition: reconciliation queue and user-visible status.

2. [NEW-LIGHT] Exported report becoming stale after edit
- Risk: external consumer reads outdated export.
- Temporary acceptability condition: mark exports stale and require regeneration.

3. [NEW-LIGHT] UI caching delay after successful update
- Risk: short-lived display inconsistency.
- Temporary acceptability condition: forced refresh or optimistic-update rollback.

4. [CONFIG/POLICY] Minor display field updates (non-financial, non-claim-impact)
- Risk: low operational confusion.
- Temporary acceptability condition: actor/time audit and role check.

## Other Importance
Anything else relevant that does not fit strictly into the matrix above.

1. [NEW-HEAVY] Data lineage and provenance requirements
- Keep immutable metadata: who changed what, when, from where, and why.

2. [NEW-HEAVY] Correction model recommendation
- Prefer correction entries for financially relevant fields over destructive in-place overwrite.

3. [NEW-HEAVY] Impact preview recommendation
- Show pre-save impact summary for payroll, claims, and transfer ownership.

4. [NEW-HEAVY] Approval workflow recommendation
- Require second approver for high-risk transitions (for example attended <-> no_show in historical records).

5. [CONFIG/POLICY] Policy matrix recommendation
- Define per-field editability by role, record age, and period lock state.

6. [NEW-LIGHT] Operational observability recommendation
- Emit structured events for every sensitive edit and monitor anomaly patterns.

7. [NEW-HEAVY] Fallback strategy recommendation
- If downstream recalculation fails, keep mutation in pending-correction state until reconciliation succeeds.
