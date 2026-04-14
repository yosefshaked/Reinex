# 80 Finance Billing Payroll

## When to read
- Billing, ledger, HMO receivables, manual payments, invoice batching, payroll, or financial settings work.
- Student or one-time-customer billing UI work.

## Load these files first
- [`../src/pages/FinancialsPage.jsx`](../src/pages/FinancialsPage.jsx)
- [`../src/features/students/components/StudentBillingWorkspace.jsx`](../src/features/students/components/StudentBillingWorkspace.jsx)
- [`../src/features/clients/components/ClientBillingWorkspace.jsx`](../src/features/clients/components/ClientBillingWorkspace.jsx)
- [`../src/features/students/components/HmoAuthorizationManager.jsx`](../src/features/students/components/HmoAuthorizationManager.jsx)
- [`../api/billing/index.js`](../api/billing/index.js)
- [`../api/consumption-entries/index.js`](../api/consumption-entries/index.js)
- [`../api/hmo-authorizations/index.js`](../api/hmo-authorizations/index.js)
- [`../api/payroll/index.js`](../api/payroll/index.js)
- [`../api/payroll-adjustments/index.js`](../api/payroll-adjustments/index.js)
- [`../api/_shared/BillingLedgerService.js`](../api/_shared/BillingLedgerService.js)
- [`../api/_shared/student-billing.js`](../api/_shared/student-billing.js)
- [`../api/_shared/employee-finance.js`](../api/_shared/employee-finance.js)
- [`../api/_shared/hmo.js`](../api/_shared/hmo.js)
- [`../src/lib/currency.js`](../src/lib/currency.js)
- [`../src/lib/setup-sql.js`](../src/lib/setup-sql.js)

## Shared helpers to reuse
- `BillingLedgerService` is the only place that may:
  resolve billing targets,
  resolve lesson rates,
  append ledger debits and credits,
  create reversals,
  create HMO invoice batches,
  compute balances and billing snapshots.
- `fetchBillingSnapshot`, `buildBillingDecision`, `buildDirectClientBillingDecision`, `reconcileStudentBilling` in [`../api/_shared/student-billing.js`](../api/_shared/student-billing.js) are compatibility/read helpers over the ledger service.
- Finance policy helpers in [`../api/_shared/employee-finance.js`](../api/_shared/employee-finance.js)
- HMO authorization loaders in [`../api/_shared/hmo.js`](../api/_shared/hmo.js)
- Currency helpers in [`../src/lib/currency.js`](../src/lib/currency.js)

## Known patterns / do not reinvent
- Money is stored and passed as agorot integers.
- The append-only ledger is the single source of truth for balances. Do not derive balances from cached lesson fields, commitment totals, or ad-hoc SQL sums.
- `commitments` are removed from the active billing model. Do not add new code that reads or writes commitment balances or commitment-linked lesson billing.
- `ledger_transactions` are immutable. Fixes must be expressed as reversing rows plus replacement rows, never `UPDATE` or `DELETE`.
- Calendar, attendance, HMO authorization, and manual billing endpoints must stay thin. They orchestrate domain changes and then call `BillingLedgerService`; they do not contain billing math or direct ledger SQL.
- Student billing uses a `student` ledger account. One-time customers use a `client_profile` ledger account. HMO receivables use an `hmo_provider` ledger account.
- HMO split billing for MVP is fixed:
  student debit = `max(service.default_customer_charge_amount - hmo_authorizations.contracted_rate_amount, 0)`
  HMO provider debit = `hmo_authorizations.contracted_rate_amount`
- HMO invoice batches are workflow metadata only. Balance changes happen only when explicit ledger credits or debits are appended.
- Payroll, leave, attendance, and instructor earnings rules are still driven from `Settings` through [`../api/_shared/employee-finance.js`](../api/_shared/employee-finance.js).
