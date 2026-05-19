# HMO Claims Lifecycle v2 - Pre-Prod Release Evidence

Status: ready for pre-prod testing
Date: 2026-04-23

## Scope Verified

Implemented for pre-prod:

- Ledger-backed HMO claim read model.
- Draft claim batch creation from selected active HMO receivable ledger rows.
- Batch submission with participant locks.
- Batch payment through `BillingLedgerService` ledger credit only.
- Cancellation of unpaid batches with lock release.
- Provider claim policy controls for submission mode, payment timing, reference requirement, period granularity, and matching mode.
- Hebrew user-facing messages for common HMO claim lifecycle errors.
- Compatibility with legacy `issued` batch status.

Not implemented for pre-prod:

- Rich partial/disputed reconciliation workflow.
- Rejected claim item workflow.
- Multi-batch remittance allocation.
- External HMO portal integration.
- Calendar-side pre-blocking for authorization cap before attendance billing.
- Separate `claim_lines` or `hmo_remittances` tables.

## Data Integrity Checks

- Ledger remains append-only.
- HMO claim existence is derived from `ledger_transactions`.
- No new durable claim-line table was introduced.
- Batch and item inserts include `org_id`.
- Batch item uniqueness still prevents the same ledger receivable from being attached to more than one active batch.
- Authorization cap is enforced by selected/non-cancelled batch item count, not by paid count.
- Payment credits are appended through `BillingLedgerService.recordHmoInvoiceBatchPayment(...)`.
- Generic provider/date credit is no longer the primary UI path.

## Verification Commands

Passed:

```powershell
node --test api/_shared/BillingLedgerService.test.js
```

Passed:

```powershell
npx eslint api/_shared/BillingLedgerService.js api/billing/index.js api/_shared/BillingLedgerService.test.js src/pages/FinancialsPage.jsx src/features/finance/components/HmoProviderBillingWorkspace.jsx
```

Passed:

```powershell
npm run build
```

Build warnings:

- Existing large chunk warnings remain.
- Browserslist data warning remains.
- No build failure.

## Required Pre-Prod Smoke Test

1. Apply the updated `src/lib/setup-sql.js` schema to pre-prod.
2. Create or use an active HMO provider and authorization.
3. Mark an HMO-covered lesson participant as attended.
4. Verify a claim line appears in Financials > HMO Claims.
5. Select claim lines for one provider and create a draft batch.
6. Submit the draft batch.
7. Verify unsafe calendar edits are blocked by the claim lock.
8. Record a partial payment against the submitted batch.
9. Verify overpayment is blocked.
10. Enable required payment reference for the provider and verify payment without reference is blocked.
11. Create another unpaid draft/submitted batch, cancel it, and verify its claim lines become available again.

## Go / No-Go Notes

Go for pre-prod testing if:

- schema setup runs successfully
- the smoke test starts from a non-production org
- testers understand that rejected/disputed reconciliation is not part of this phase

No-go for production if:

- setup SQL was not applied
- claim lines do not appear after attended covered HMO lessons
- payment can be recorded against a draft batch
- overpayment is accepted
- same ledger receivable can be added to two non-cancelled batches
