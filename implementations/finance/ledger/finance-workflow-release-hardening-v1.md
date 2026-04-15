# Finance Workflow Release Hardening v1

Status: active baseline for Mission Step 10
Depends on:
- implementations/finance/ledger/finance-workflow-contract-v1.md
- implementations/finance/ledger/finance-workflow-acceptance-criteria-v1.md
Date: 2026-04-15

## Objective
Define an enforceable two-pass AI review protocol and staged rollout checklist for finance workflow changes, minimizing hallucinated regressions across billing, attendance, generation, and claims.

## Bounded File Set
- implementations/finance/ledger/finance-workflow-contract-v1.md
- implementations/finance/ledger/finance-workflow-acceptance-criteria-v1.md
- api/calendar-attendance/index.js
- api/calendar-generate/index.js
- api/billing/index.js
- src/features/calendar/components/LessonInstanceDialog.jsx
- src/features/calendar/components/ManualGenerationDialog.jsx
- src/pages/FinancialsPage.jsx
- test/finance-preview-contract.test.js
- test/calendar-generate-hmo-warning.test.js
- test/billing-claim-payment.test.js

## Expected Output Schema
Each release validation record must include:

- release_id: unique string
- pass_1:
  - reviewer_agent: string
  - acceptance_ids: string[]
  - evidence:
    - tests: string[]
    - diagnostics: string[]
    - anchor_checks: string[]
  - findings: []
- pass_2:
  - reviewer_agent: string
  - non_goal_checks: string[]
  - coupling_checks: string[]
  - findings: []
- rollout:
  - stage: canary | limited | general
  - scope: org ids or environment scope
  - monitor_window_minutes: number
  - rollback_ready: boolean
- decision: approved | blocked

## Two-Pass Review Protocol

### Pass 1: implementation-to-acceptance verification
Owner: implementation agent that produced the batch.

Required checks:
1. Map every changed behavior to one or more AC ids.
2. Run targeted tests for mapped criteria.
3. Run diagnostics on changed files.
4. Run anchor checks for expected response fields, reason codes, and action names.

Blockers:
- Any failing mapped test.
- Any missing AC mapping for a behavior change.
- Any diagnostics error in changed files.

### Pass 2: independent regression and non-goal review
Owner: separate reviewer agent (not the implementing agent).

Required checks:
1. Verify explicit non-goals from contract and step docs still hold.
2. Verify coupling invariants:
   - ledger mutations are append-only and corrections are reverse then append.
   - attendance status changes still route through billing and payroll sync.
   - HMO warning flows remain non-blocking in generation.
   - claims payment remains provider-scoped and ledger-only.
3. Verify no hidden schema or API contract expansion without AC updates.

Blockers:
- Any high-severity regression risk.
- Any violation of non-goals or coupling invariants.

## AC-to-Evidence Mapping (Mission Steps 3-9)
- AC-PREVIEW-004, AC-PREVIEW-005, AC-UI-PREVIEW-003:
  - evidence: node --test test/finance-preview-contract.test.js
- AC-GEN-001, AC-GEN-002, AC-GEN-003:
  - evidence: node --test test/calendar-generate-hmo-warning.test.js
- AC-CLAIMS-003, AC-CLAIMS-004:
  - evidence: node --test test/billing-claim-payment.test.js
- AC-REL-001, AC-REL-002:
  - evidence: completion of this protocol with recorded pass_1 and pass_2 outputs

## Staged Rollout Checklist

### Stage 0: pre-prod gate
1. Run:
   - node --test test/finance-preview-contract.test.js
   - node --test test/calendar-generate-hmo-warning.test.js
   - node --test test/billing-claim-payment.test.js
2. Run diagnostics for changed files.
3. Run anchor checks:
   - hmo_split_detail
   - hmo_authorization_gap
   - view=hmo_claims
   - record_hmo_claim_payment
4. Confirm no new direct SQL balance arithmetic was introduced in API endpoints.

Exit criteria:
- All checks pass and both review passes are approved.

### Stage 1: canary rollout
Scope:
- limited internal orgs only.

Checks during monitoring window:
- claims tab loads successfully and payment action refreshes read model.
- generation warnings render but do not block apply.
- attendance preview includes HMO split details when applicable.

Exit criteria:
- No sev-1 or sev-2 finance incidents.

### Stage 2: limited rollout
Scope:
- selected production org cohort.

Checks:
- support tickets and error logs stay within baseline thresholds.
- no unexplained drift between provider receivables and posted HMO payments.

Exit criteria:
- Stable for agreed monitor window.

### Stage 3: general availability
Scope:
- full production rollout.

Checks:
- retain review artifacts and verification logs in release evidence.
- schedule post-release audit sample for claim payment and reversal correctness.

## Rollback Policy
- Do not mutate or delete ledger transaction rows.
- Use reverse-then-append correction flows through BillingLedgerService.
- If UI behavior must be disabled quickly, remove or hide mutation entry points while preserving read models.
- If rollout gate fails, decision is blocked until pass_1 and pass_2 findings are resolved and re-verified.

## Explicit Non-Goals
- No new endpoint behavior in this step.
- No schema migrations in this step.
- No changes to billing formulas in this step.

## Verification Command Set
1. node --test test/finance-preview-contract.test.js
2. node --test test/calendar-generate-hmo-warning.test.js
3. node --test test/billing-claim-payment.test.js
4. Use search to verify release anchors exist in documentation:
   - finance-workflow-release-hardening-v1.md
   - AC-REL-001
   - AC-REL-002

## Rollback Note
Documentation-only step. Rollback by reverting this file and resetting Step 10 status in implementations/finance/ledger/implementation-to-do.md.
