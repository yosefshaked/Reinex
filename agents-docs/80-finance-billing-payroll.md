# 80 Finance Billing Payroll

## When to read
- Billing, commitments, HMO, ledger, payroll, or financial settings work.
- Student or one-time-customer billing UI work.

## Load these files first
- [`../src/pages/FinancialsPage.jsx`](../src/pages/FinancialsPage.jsx)
- [`../src/features/students/components/StudentBillingWorkspace.jsx`](../src/features/students/components/StudentBillingWorkspace.jsx)
- [`../src/features/clients/components/ClientBillingWorkspace.jsx`](../src/features/clients/components/ClientBillingWorkspace.jsx)
- [`../src/features/students/components/student-billing-helpers.js`](../src/features/students/components/student-billing-helpers.js)
- [`../api/billing/index.js`](../api/billing/index.js)
- [`../api/commitments/index.js`](../api/commitments/index.js)
- [`../api/consumption-entries/index.js`](../api/consumption-entries/index.js) ← route name is legacy; this endpoint reads/writes `ledger_transactions` directly
- [`../api/hmo-authorizations/index.js`](../api/hmo-authorizations/index.js)
- [`../api/payroll/index.js`](../api/payroll/index.js)
- [`../api/payroll-adjustments/index.js`](../api/payroll-adjustments/index.js)
- [`../api/_shared/student-billing.js`](../api/_shared/student-billing.js)
- [`../api/_shared/employee-finance.js`](../api/_shared/employee-finance.js)
- [`../api/_shared/hmo.js`](../api/_shared/hmo.js)
- [`../api/_shared/commitment-behavior.js`](../api/_shared/commitment-behavior.js)
- [`../src/lib/currency.js`](../src/lib/currency.js)

## Shared helpers to reuse
- `fetchBillingSnapshot`, `assignLessonParticipantCommitment`, `clearLessonParticipantCommitment`, `createCommitmentTransfer`, `reconcileStudentBilling`
- Finance policy helpers in [`../api/_shared/employee-finance.js`](../api/_shared/employee-finance.js)
- HMO loaders/attachers/ensurers in [`../api/_shared/hmo.js`](../api/_shared/hmo.js)
- Commitment runtime helpers in [`../api/_shared/commitment-behavior.js`](../api/_shared/commitment-behavior.js)
- Billing form helpers in [`../src/features/students/components/student-billing-helpers.js`](../src/features/students/components/student-billing-helpers.js)
- Currency helpers in [`../src/lib/currency.js`](../src/lib/currency.js)

## Known patterns / do not reinvent
- Money is stored and passed as agorot integers.
- Billing state is derived from attendance status, commitments, HMO authorization state, and finance policy helpers; do not recompute this separately in UI or endpoints.
- Student billing and one-time-customer billing share ledger concepts but use different workspaces.
- HMO-specific behavior already lives in [`../api/_shared/hmo.js`](../api/_shared/hmo.js) and is attached to commitments there.
- **COUPLING:** `hmo_authorization_id` is UNIQUE on the `commitments` table (1:1). Do not attempt to link the same HMO authorization to more than one commitment; the DB constraint will reject it.
- Payroll, leave, attendance, and instructor earnings rules are driven from `Settings` through [`../api/_shared/employee-finance.js`](../api/_shared/employee-finance.js).
