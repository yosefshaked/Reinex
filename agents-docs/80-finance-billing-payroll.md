# 80 Finance Billing Payroll

## Contract baseline (must read first for behavior-changing finance work)
- [`../implementations/finance/ledger/finance-workflow-contract-v1.md`](../implementations/finance/ledger/finance-workflow-contract-v1.md)
- This contract is the frozen baseline for finance flow behavior across ledger, attendance, HMO authorization coupling, and calendar preview consumption.
- If a change intentionally diverges from this contract, update the contract and acceptance criteria in the same implementation batch.

## Release hardening baseline (must read before finance rollout)
- [`../implementations/finance/ledger/finance-workflow-release-hardening-v1.md`](../implementations/finance/ledger/finance-workflow-release-hardening-v1.md)
- This protocol defines dual-review gates, AC-to-test evidence mapping, and staged rollout checks for finance changes.
- For any finance release involving behavior or contract changes, attach completed protocol evidence to the rollout PR.

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
- Currency helpers (frontend): [`../src/lib/currency.js`](../src/lib/currency.js) — `formatCurrency`, `toShekel`, `toAgorot`, `coerceAgorot`
- Currency helpers (backend): [`../api/_shared/currency.js`](../api/_shared/currency.js) — `coerceAgorot`, `toShekel`, `assertAgorot`, `assertAgorotNullable`, `FINANCE_LIMITS`, `BILLING_THRESHOLDS`
- HMO claims UI feedback helper: [`../src/features/finance/lib/hmo-claim-feedback.js`](../src/features/finance/lib/hmo-claim-feedback.js) — maps HMO claim/payment errors to user-facing next-step guidance

## Currency helpers — mandatory usage
- **All monetary values in the DB and API layer are integers (agorot). 1 ₪ = 100 agorot.**
- Backend: import `coerceAgorot`, `toShekel`, `assertAgorot`, `assertAgorotNullable` from [`../api/_shared/currency.js`](../api/_shared/currency.js).
- Frontend: import `formatCurrency`, `toShekel`, `toAgorot`, `coerceAgorot` from [`../src/lib/currency.js`](../src/lib/currency.js).
- Use `coerceAgorot(value)` when reading any monetary value from the DB or an API response.
- Use `assertAgorot(value, fieldName)` when validating monetary input from a request body.
- Use `toShekel(agorot)` to convert to shekels for display. **Never interpolate a raw agorot integer into a user-facing string.** Build display strings like: `` `₪${toShekel(coerceAgorot(amount)).toFixed(2)}` `` (backend) or `formatCurrency(amount)` (frontend).
- Do **not** write local currency helpers (`roundCurrency`, `formatAmount`, etc.). Use the shared helpers above.
- The `FINANCE_LIMITS` and `BILLING_THRESHOLDS` constants in `api/_shared/currency.js` are the canonical financial guard rails — use them instead of hardcoding limits.

## Known patterns / do not reinvent
- Money is stored and passed as agorot integers.
- Finance policy reads from `Settings` must always be org-scoped (`org_id`) in backend code; service-role reads without `withOrgScope(..., orgId)` can silently pull another tenant's billing policy.
- The append-only ledger is the single source of truth for balances. Do not derive balances from cached lesson fields, commitment totals, or ad-hoc SQL sums.
- The Financials HMO claims read model must be ledger-backed. `ledger_transactions` with active HMO `lesson_charge` rows determine whether a claim exists; `dashboard_tasks` may overlay workflow state (`open` / `resolved`) but must not be the only source used to decide if an HMO claim row should appear.
- `commitments` are removed from the active billing model. Do not add new code that reads or writes commitment balances or commitment-linked lesson billing.
- `ledger_transactions` are immutable. Fixes must be expressed as reversing rows plus replacement rows, never `UPDATE` or `DELETE`.
- Calendar, attendance, HMO authorization, and manual billing endpoints must stay thin. They orchestrate domain changes and then call `BillingLedgerService`; they do not contain billing math or direct ledger SQL.
- Student billing uses a `student` ledger account. One-time customers use a `client_profile` ledger account. HMO receivables use an `hmo_provider` ledger account.
- `ledger_accounts` must hold first-class HMO provider accounts (`account_type = 'hmo_provider'`, `hmo_provider_id = provider id`). Do not represent HMO receivables as ledger rows with `ledger_account_id = null`.
- Legacy student `ledger_accounts` rows may exist without `client_profile_id`. Migrations should backfill that link when possible, but schema constraints must not fail solely because a historical student account is missing that column.
- For existing environments, `ledger_accounts` integrity rollout should be staged: add columns permissively, backfill/repair legacy rows, abort with a clear diagnostic if invalid rows remain, and only then add strict validated constraints. Do not rely on looser long-term constraints as the default migration strategy.
- Schema backfills may repair missing HMO `ledger_account_id` links on historical rows, but must not alter financial facts such as amount, direction, source, effective date, or reversal linkage.
- HMO billing now uses a canonical coverage-decision model:
  `hmo_provider_tracks` are templates only and hold defaults for `default_customer_charge_amount`, `default_insurer_claim_amount`, `default_post_coverage_policy`, and `default_post_coverage_customer_charge_amount`
  `hmo_authorizations` are the source of truth for live covered pricing via `covered_customer_charge_amount`, `covered_insurer_claim_amount`, `authorized_lessons`, `post_coverage_policy`, and `post_coverage_customer_charge_amount`
  `resolveLessonCoverageDecision(...)` in [`../api/_shared/hmo.js`](../api/_shared/hmo.js) is the single resolver for `covered`, `post_coverage`, `standard_uncovered`, and `blocked`
  `authorized_lessons` is enforced dynamically from active ledger rows carrying `hmo_authorization_id`; reversal rows restore entitlement
  no finance path may derive customer copay from `service.default_customer_charge_amount - insurer amount`
  `post_coverage_policy = service_default` means fall back to the service list price after entitlement exhaustion
  `post_coverage_policy = explicit_customer_charge` means charge the stored explicit post-coverage customer amount
  `post_coverage_policy = manual_block` means billing must stop with a clear blocked reason after entitlement exhaustion
  overlapping matching active authorizations are treated as a data conflict and billing is blocked until resolved
- HMO invoice batches are workflow metadata only. Balance changes happen only when explicit ledger credits or debits are appended.
- HMO claim lifecycle v2 uses `hmo_invoice_batches` / `hmo_invoice_batch_items` as the operational submission model. New batches are created as `draft`, submitted via `BillingLedgerService.submitHmoInvoiceBatch(...)`, and payments must be recorded against submitted batches via `recordHmoInvoiceBatchPayment(...)`.
- HMO claim batch creation must select active HMO receivable ledger rows, exclude reversed/already-batched rows, include `org_id` on both batch and item inserts, and enforce `hmo_authorizations.authorized_lessons` by selected/submitted claim count, not by paid claim count.
- Before HMO claim-line validation, batch creation should ensure the target HMO provider has a real `ledger_accounts` row and should backfill missing `ledger_transactions.ledger_account_id` links for that provider's historical HMO receivable rows. This repair must remain metadata/account-link only and must not change financial facts.
- For pre-prod/backward compatibility, HMO batch creation may accept `dashboard_tasks.id` values from older UI/read-model payloads, but it must resolve them to active `ledger_transactions` before validation. `dashboard_tasks` remain workflow prompts only and must never be treated as financial claim-line truth.
- `BillingLedgerService.inspectHmoClaimReadiness(...)` is the read-only diagnostic entrypoint for system-admin HMO claim investigations. Use it when an admin needs to understand why a participant or requested claim batch is not claimable; do not build parallel ad-hoc SQL diagnostics in page code.
- Submitted HMO invoice batches create `participant_locks` with `lock_source_type = 'claim_batch'`; workflow readers must resolve those locks against both legacy `claim_batches` and current `hmo_invoice_batches`.
- Payroll, leave, attendance, and instructor earnings rules are still driven from `Settings` through [`../api/_shared/employee-finance.js`](../api/_shared/employee-finance.js).
- Instructor earnings are calculated from the canonical hourly `base_rate` on `instructor_service_capabilities`.
- The UI may preserve the admin's original pay entry in `instructor_service_capabilities.metadata.compensation_input`, but finance math must not read from that display helper field.
- Instructor payout now also depends on `Services.payment_model`:
  - `fixed_rate` pays once per lesson
  - `per_student` multiplies by compensation-eligible participant count
- Do not add "rebuild billing" fallback buttons to student/client billing workspaces. Billing recalculation belongs to the mutation source: attendance/session changes, lesson-instance edits, and HMO authorization create/update/cancel already trigger the relevant ledger resync and should communicate that in their own UX.
