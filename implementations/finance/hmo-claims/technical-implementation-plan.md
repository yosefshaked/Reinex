# HMO Claims Lifecycle v2 - Technical Implementation Plan

Status: implemented for pre-prod testing
Owner: AI dev team
Created: 2026-04-23
Primary domain: finance / billing / HMO claims

## 1. Purpose

This document is the source of truth for implementing the HMO claims lifecycle v2.

The goal is to replace the current weak "record HMO credit by date" workflow with a proper claims lifecycle:

- covered attended lessons create HMO receivables through the ledger
- claimable lines are derived from active ledger rows, not manually entered
- staff submit claim batches per HMO provider and period
- HMO payments are recorded as remittances against batches, not generic credits
- dashboard shows grouped operational summaries, not one noisy task card per claim line
- authorization max lesson limits are enforced by submitted/selected claim count, not by paid count

This implementation must preserve the existing finance architecture:

- append-only `ledger_transactions` remain the financial source of truth
- HMO claim lines are read models from active ledger receivable rows
- `hmo_invoice_batches` and `hmo_invoice_batch_items` are the operational submission model
- `dashboard_tasks` are inbox prompts only, not the durable workflow source of truth
- no direct ledger math or balance mutation outside `BillingLedgerService`

## 2. Required Reading Before Any Code

Every agent working on this implementation must read these files before touching code:

- `AGENTS.md`
- `agents-docs/00-core-rules.md`
- `agents-docs/60-calendar-and-sessions.md`
- `agents-docs/80-finance-billing-payroll.md`
- `implementations/finance/ledger/finance-workflow-contract-v1.md`
- `implementations/finance/ledger/finance-workflow-release-hardening-v1.md`
- `src/lib/setup-sql.js`
- `api/_shared/BillingLedgerService.js`
- `api/_shared/hmo.js`
- `api/billing/index.js`
- `api/calendar-attendance/index.js`
- `src/pages/FinancialsPage.jsx`

If an agent believes this plan conflicts with those files, stop and propose an explicit plan amendment before coding.

## 3. Current State Discovered In Code

### Existing schema

The schema already contains the main objects needed for this feature:

- `public.hmo_providers`
- `public.hmo_provider_tracks`
- `public.hmo_authorizations`
- `public.ledger_transactions`
- `public.ledger_accounts`
- `public.hmo_invoice_batches`
- `public.hmo_invoice_batch_items`
- `public.dashboard_tasks`
- `public.participant_locks`
- `public.instance_locks`
- `public.claim_batches`

Important decision:

- Do not create a new `claim_lines` table in v2.
- Do not create a new generic `hmo_remittances` table in v2 unless explicitly approved later.
- Do not use both `claim_batches` and `hmo_invoice_batches` for HMO submissions in parallel.
- Use and harden `hmo_invoice_batches` and `hmo_invoice_batch_items`.

### Existing HMO receivable model

Covered HMO attendance currently creates ledger rows with:

- `source_type = 'lesson_charge'`
- `direction = 'DEBIT'`
- `hmo_provider_id`
- `hmo_authorization_id`
- `lesson_participant_id`
- metadata including coverage snapshot

That means claimability can be derived from active ledger rows.

### Existing batch primitives

`hmo_invoice_batches` currently has:

- `org_id`
- `hmo_provider_id`
- `period_start`
- `period_end`
- `status`
- `total_amount`
- `paid_amount`
- `external_reference`
- `external_link`
- `notes`
- `issued_at`
- `paid_at`
- `metadata`

`hmo_invoice_batch_items` currently has:

- `org_id`
- `batch_id`
- `ledger_transaction_id`
- `amount`
- `metadata`

There is already a unique constraint on `hmo_invoice_batch_items.ledger_transaction_id`, which is good because one active ledger receivable cannot be attached to multiple invoice batches.

### Existing gaps / bugs that must be fixed as part of v2

- `BillingLedgerService.createHmoInvoiceBatch(...)` currently needs hardening before it can be trusted:
  - it must include `org_id` on inserted `hmo_invoice_batches`
  - it must include `org_id` on inserted `hmo_invoice_batch_items`
  - it must use `withOrgScope`-equivalent filtering directly where applicable
  - it must filter out reversed ledger rows correctly
  - it must enforce authorization max submitted claim count
  - it must not rely only on `source_type = lesson_charge` with no reversal exclusion
- current Financials UI still exposes a generic HMO credit/payment action that feels operationally cheap
- HMO dashboard tasks are useful as prompts, but not enough as lifecycle truth

## 4. Product / Workflow Model

### 4.1 Claim line

A claim line is not a table in v2.

It is a backend read-model row derived from an active HMO receivable ledger transaction.

Claim line source criteria:

- `ledger_transactions.org_id = active org`
- `source_type = 'lesson_charge'`
- `direction = 'DEBIT'`
- `hmo_provider_id IS NOT NULL`
- `lesson_participant_id IS NOT NULL`
- not reversed by any active `reversal` transaction
- not itself a reversal

Claim line enrichment:

- participant status
- lesson instance date/duration/service
- student/client profile name
- provider name/config
- authorization reference/status
- batch item if attached
- batch status if attached
- workflow/dashboard task overlay if present

### 4.2 Claimability

A ledger-backed HMO claim line is claimable if:

- it is an active HMO receivable
- participant status is still a claimable status, primarily `attended`
- it is not already attached to a non-cancelled HMO invoice batch
- attaching it would not breach `hmo_authorizations.authorized_lessons`
- the authorization is still traceable by `hmo_authorization_id`

### 4.3 Authorization max lesson cap

This is a hard backend rule.

If `hmo_authorizations.authorized_lessons = 10`, the system must not allow the 11th submitted/selected claim for that authorization.

Important distinction:

- Count lessons already submitted or selected for claim.
- Do not count by lessons already paid by the HMO.
- Payment timing does not restore entitlement for claim submission.
- Reversed/cancelled claim batch items should not count.

Count source:

- existing `hmo_invoice_batch_items` joined through their ledger transactions by `hmo_authorization_id`
- count only items whose batch status is not `cancelled`
- add the new selected items in the attempted batch
- block if resulting count exceeds `authorized_lessons`

Calendar should eventually pre-warn/guard before attendance creates over-cap claimable rows, but the batch submission guard is mandatory and authoritative.

### 4.4 HMO invoice batch

`hmo_invoice_batches` is the canonical operational submission object.

Recommended lifecycle statuses:

- `draft`
- `submitted`
- `acknowledged`
- `partially_paid`
- `paid`
- `disputed`
- `closed`
- `cancelled`

Current schema supports only:

- `draft`
- `issued`
- `partially_paid`
- `paid`
- `cancelled`

Implementation should migrate from `issued` toward `submitted`, while preserving backward compatibility for existing rows.

Recommended migration approach:

- Add new statuses to the check constraint.
- Treat old `issued` as `submitted` in read models.
- New code should write `submitted`, not `issued`.
- Do not rewrite historical rows unless a migration explicitly does it safely.

### 4.5 HMO invoice batch item

`hmo_invoice_batch_items` attaches one active ledger receivable to one HMO invoice batch.

It should remain small and avoid stale duplicated data.

Recommended columns to add:

- `lesson_participant_id uuid NULL`
- `hmo_authorization_id uuid NULL`
- `hmo_provider_id uuid NULL`
- `status text NOT NULL DEFAULT 'submitted'`
- `expected_amount integer NOT NULL DEFAULT 0`
- `expected_unit_count integer NOT NULL DEFAULT 1`
- `paid_amount integer NOT NULL DEFAULT 0`
- `rejected_at timestamptz NULL`
- `rejection_reason text NULL`
- `dispute_reason text NULL`

Rationale:

- Keep `ledger_transaction_id` as the canonical financial line pointer.
- Add denormalized foreign keys only for constraints/query performance/safety.
- Store expected amount at submission time because claim amount can be historically meaningful.
- Do not duplicate student names, service names, or provider names. Those are read-model joins.

Important: if the team decides this is too much for v2, minimum required additions are:

- `lesson_participant_id`
- `hmo_authorization_id`
- `status`
- `expected_amount`
- `paid_amount`

### 4.6 Remittance / provider payment

For v2, avoid creating a separate `hmo_remittances` table unless the team confirms a concrete need.

Use `hmo_invoice_batches` payment fields plus ledger transactions:

- batch-level `paid_amount`
- batch-level `paid_at`
- batch-level `metadata.remittance_reference`
- batch-level `metadata.remittance_received_at`
- batch-level `metadata.remittance_notes`
- ledger credit with `source_type = 'hmo_invoice_payment'`
- ledger credit `source_id = hmo_invoice_batches.id`

If later we need one HMO payment allocated across many batches with a single remittance identity, then introduce `hmo_remittances` and `hmo_remittance_allocations`.

Do not introduce it in v2 unless this limitation blocks real workflow.

## 5. Provider Configuration

`hmo_providers.metadata` is not enough for common operational behavior. Provider policy should be represented by explicit columns for filtering, reporting, validation, and UI.

Final implemented columns on `hmo_providers`:

- `claim_submission_mode text NOT NULL DEFAULT 'amount'`
- `claim_payment_timing text NOT NULL DEFAULT 'after_submission'`
- `claim_reference_required boolean NOT NULL DEFAULT false`
- `claim_period_granularity text NOT NULL DEFAULT 'monthly'`
- `claim_payment_matching_mode text NOT NULL DEFAULT 'batch_amount'`

Implementation decision:

- Do not add both the originally proposed names and the final names. That would create duplicate configuration state and future stale-data risk.
- `claim_submission_mode` replaces `settlement_basis`.
- `claim_period_granularity` replaces `default_batch_period`.
- `claim_reference_required` replaces `requires_reference_number`.
- `claim_payment_matching_mode` replaces `matching_strategy`.
- `claim_payment_timing` carries the operational payment timing category for v2.
- Payment tolerance and expected delay were not added as persisted columns in this phase because the current UI/API does not yet expose reconciliation/tolerance behavior. Adding unused persisted controls now would create misleading configuration.

Constraints:

- `claim_submission_mode IN ('amount', 'unit_count', 'hybrid')`
- `claim_payment_timing IN ('after_submission', 'monthly', 'quarterly', 'custom')`
- `claim_period_granularity IN ('monthly', 'quarterly', 'custom')`
- `claim_payment_matching_mode IN ('batch_amount', 'line_amount', 'unit_count', 'manual_reconciliation')`

Keep `metadata` for rare provider-specific details only.

Examples that belong in columns:

- provider usually settles by visit count
- provider usually pays after 90 days
- provider requires reference number

Examples that can stay in metadata:

- free-text operational notes
- contact escalation details
- provider-specific portal instructions

## 6. Backend API Contract

Prefer extending `api/billing/index.js` only if the file remains maintainable. If it becomes too large, create a dedicated endpoint such as `api/hmo-claims/index.js`.

If creating a new endpoint, follow Azure Functions rules:

- use `resolveBearerAuthorization(req)`
- use `respond(context, ...)`
- use `readSupabaseAdminConfig(...)`
- use `createSupabaseAdminClient(...)`
- enforce `ensureMembership(...)`
- require `admin` / `owner` / `office` role
- resolve org through `resolveOrgId(req, body)`
- scope every query by `org_id`

### 6.1 Read model

Endpoint:

- `GET /api/billing?view=hmo_claims`

Existing endpoint can remain.

Return shape should evolve to:

```ts
type HmoClaimsReadModel = {
  summary: {
    claimable_count: number;
    submitted_count: number;
    overdue_batch_count: number;
    disputed_count: number;
    provider_count: number;
    expected_claim_total: number;
    received_total: number;
    outstanding_total: number;
  };
  claim_lines: HmoClaimLine[];
  batches: HmoInvoiceBatchSummary[];
  provider_receivables: HmoProviderReceivable[];
  notices: string[];
  generated_at: string;
};
```

Keep compatibility during transition:

- continue returning `claims` as an alias of `claim_lines`
- continue returning old summary keys if the UI still reads them

### 6.2 Create draft batch

Action:

- `POST /api/billing`
- `action = 'create_hmo_claim_batch'`

Request:

```json
{
  "org_id": "...",
  "action": "create_hmo_claim_batch",
  "hmo_provider_id": "...",
  "period_start": "2026-04-01",
  "period_end": "2026-04-30",
  "ledger_transaction_ids": ["..."],
  "notes": "optional"
}
```

Rules:

- all ledger rows must belong to org
- all rows must be active HMO receivables
- all rows must belong to same `hmo_provider_id`
- rows must not already be attached to active/non-cancelled batch
- authorization max submitted count must not be breached
- if provider `settlement_basis = visits`, expected unit count is line count
- if provider `settlement_basis = amount`, expected total is sum amount
- if provider `settlement_basis = mixed`, show both amount and visit count

Response:

```ts
{
  batch_id: string;
  status: "draft";
  item_count: number;
  expected_total: number;
  expected_unit_count: number;
  blocked?: HmoClaimBatchBlock[];
}
```

### 6.3 Submit batch

Action:

- `POST /api/billing`
- `action = 'submit_hmo_claim_batch'`

Request:

```json
{
  "org_id": "...",
  "action": "submit_hmo_claim_batch",
  "batch_id": "...",
  "external_reference": "optional",
  "external_link": "optional",
  "submitted_at": "optional"
}
```

Rules:

- batch must be `draft`
- if provider requires reference number, `external_reference` is required
- re-run authorization cap validation at submit time
- create participant locks with `lock_source_type = 'claim_batch'`
- resolve or update line-level `hmo_claim_submission` dashboard tasks
- write audit event

### 6.4 Record batch payment / remittance

Replace the primary UI for `record_hmo_claim_payment`.

Action:

- `POST /api/billing`
- `action = 'record_hmo_batch_payment'`

Request:

```json
{
  "org_id": "...",
  "action": "record_hmo_batch_payment",
  "batch_id": "...",
  "amount": 10000,
  "received_at": "2026-04-30",
  "reference_number": "optional",
  "notes": "optional"
}
```

Rules:

- amount is agorot integer, validated by backend `assertAgorot`
- if provider requires reference number, reference is mandatory
- if partial payment is not allowed and amount is less than outstanding, block
- apply tolerance rules when deciding `paid` vs `partially_paid`
- append ledger credit through `BillingLedgerService`
- update `hmo_invoice_batches.paid_amount`
- update `hmo_invoice_batches.status`
- update `hmo_invoice_batch_items.paid_amount` if allocation is item-level
- write audit event

### 6.5 Mark item rejected / disputed

Action:

- `POST /api/billing`
- `action = 'update_hmo_batch_item_status'`

Supported statuses:

- `submitted`
- `accepted`
- `rejected`
- `disputed`
- `paid`

Use this for payer response handling.

## 7. Schema Migration Plan

All schema changes go in `src/lib/setup-sql.js`.

### 7.1 hmo_providers

Implemented columns:

```sql
ALTER TABLE public.hmo_providers
  ADD COLUMN IF NOT EXISTS claim_submission_mode text NOT NULL DEFAULT 'amount',
  ADD COLUMN IF NOT EXISTS claim_payment_timing text NOT NULL DEFAULT 'after_submission',
  ADD COLUMN IF NOT EXISTS claim_reference_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS claim_period_granularity text NOT NULL DEFAULT 'monthly',
  ADD COLUMN IF NOT EXISTS claim_payment_matching_mode text NOT NULL DEFAULT 'batch_amount';
```

Check constraints are added in guarded `DO $$ BEGIN IF NOT EXISTS ... END $$;` blocks.

### 7.2 hmo_invoice_batches

Add columns:

```sql
ALTER TABLE public.hmo_invoice_batches
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS submitted_by uuid NULL,
  ADD COLUMN IF NOT EXISTS received_at timestamptz NULL;
```

Not implemented in this phase:

- `acknowledged_at`
- `expected_unit_count` on the batch header
- `settlement_basis` on the batch header

Reason: item-level expected amount/unit count is already stored, while header-level settlement fields would duplicate provider policy until acknowledgement/reconciliation behavior is implemented.

Replace status check to support:

- `draft`
- `issued` legacy
- `submitted`
- `acknowledged`
- `partially_paid`
- `paid`
- `disputed`
- `closed`
- `cancelled`

Do not remove `issued` immediately.

### 7.3 hmo_invoice_batch_items

Add columns:

```sql
ALTER TABLE public.hmo_invoice_batch_items
  ADD COLUMN IF NOT EXISTS lesson_participant_id uuid NULL,
  ADD COLUMN IF NOT EXISTS hmo_authorization_id uuid NULL,
  ADD COLUMN IF NOT EXISTS hmo_provider_id uuid NULL,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'submitted',
  ADD COLUMN IF NOT EXISTS expected_amount integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expected_unit_count integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS paid_amount integer NOT NULL DEFAULT 0;
```

Not implemented in this phase:

- `rejected_at`
- `rejection_reason`
- `dispute_reason`

Reason: rejected/disputed item handling is explicitly left for the richer reconciliation phase.

Add indexes:

```sql
CREATE INDEX IF NOT EXISTS hmo_invoice_batch_items_authorization_idx
  ON public.hmo_invoice_batch_items (org_id, hmo_authorization_id)
  WHERE hmo_authorization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS hmo_invoice_batch_items_participant_idx
  ON public.hmo_invoice_batch_items (org_id, lesson_participant_id)
  WHERE lesson_participant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS hmo_invoice_batch_items_status_idx
  ON public.hmo_invoice_batch_items (org_id, status);
```

Keep unique `ledger_transaction_id`.

### 7.4 Do not use claim_batches for HMO v2

`claim_batches` exists and lock logic references `claim_batch`.

Decision:

- Do not use `claim_batches` as the HMO submission table in this implementation.
- Use `hmo_invoice_batches`.
- Continue using `lock_source_type = 'claim_batch'` for finance locks if existing calendar lock code expects that vocabulary.
- Set `lock_source_id = hmo_invoice_batches.id`.
- Document this explicitly in finance docs to avoid future confusion.

## 8. Service Layer Changes

All financial writes must go through `BillingLedgerService`.

Add or harden these methods:

### 8.1 buildHmoClaimLinesReadModel

Location:

- preferred: `api/_shared/hmo-claims.js`

Responsibilities:

- load active HMO receivable ledger rows
- remove reversed rows
- join batch item/batch state
- join participant/lesson/student/service/provider/authorization
- compute claimability
- compute authorization submitted counts
- return stable DTOs

### 8.2 validateHmoClaimBatchSelection

Inputs:

- `orgId`
- `hmoProviderId`
- `ledgerTransactionIds`

Validates:

- all rows exist in org
- all rows are active HMO receivable debits
- all rows belong to same provider
- no row already attached to active/non-cancelled batch
- no authorization cap breach
- no missing `lesson_participant_id`
- no missing `hmo_authorization_id`

Returns:

- eligible rows
- blocked rows
- authorization count details

### 8.3 createHmoInvoiceBatch

Harden existing method.

Required changes:

- include `org_id` in batch insert
- include `org_id` in item insert
- validate active ledger rows using shared validation
- support explicit selected ledger ids
- support `draft` creation
- support provider settlement policy
- store expected amount/unit count
- store item `lesson_participant_id`, `hmo_authorization_id`, `hmo_provider_id`

### 8.4 submitHmoInvoiceBatch

Add method.

Responsibilities:

- load draft batch
- validate provider rules
- re-run cap validation
- set status to `submitted`
- set `submitted_at`
- set `submitted_by`
- create participant locks
- resolve/update dashboard tasks
- audit

### 8.5 recordHmoInvoiceBatchPayment

Harden existing method.

Required changes:

- source credit must point to batch
- use backend `assertAgorot`
- enforce provider rules
- support partial payments
- support tolerance
- update batch status
- optionally allocate across items
- audit

## 9. Frontend UX Plan

Primary file today:

- `src/pages/FinancialsPage.jsx`

If this becomes too large, split into:

- `src/features/finance/hmo-claims/HmoClaimsWorkspace.jsx`
- `src/features/finance/hmo-claims/HmoClaimQueue.jsx`
- `src/features/finance/hmo-claims/HmoBatchList.jsx`
- `src/features/finance/hmo-claims/HmoBatchPaymentDialog.jsx`
- `src/features/finance/hmo-claims/hmoClaimsApi.js`

### 9.1 Replace current tab structure

Financials > HMO Claims should show:

- Queue: claimable active receivables not submitted
- Batches: draft/submitted/paid/disputed/cancelled
- Payments: batch payment/remittance history
- Provider balances: existing ledger-backed balances

### 9.2 Primary actions

Replace the visible primary "record payment by provider/date" flow with:

- `Create claim batch`
- `Submit batch`
- `Record payment for batch`

Move old `record_hmo_claim_payment` behind:

- `Advanced manual correction`
- admin/owner only if possible
- explicit warning that it bypasses batch reconciliation

### 9.3 Queue UI

Group claimable rows by:

- provider
- authorization
- student
- period

Show for each row:

- lesson date
- student
- service
- expected amount
- authorization reference
- submitted count / authorized lesson cap
- status: claimable / blocked / already submitted / over cap

### 9.4 Batch UI

Show:

- provider
- period
- status
- expected amount
- expected visit count
- paid amount
- outstanding amount
- overdue marker based on provider `expected_payment_delay_days`

### 9.5 Dashboard UI

Dashboard should summarize by kind/provider:

- `X HMO claims ready to submit for Provider`
- `Y submitted batches awaiting payment for Provider`
- `Z disputed/rejected HMO lines need review`

Do not render one task card per claim line by default.

## 10. AI Dev Team Work Breakdown

Use separate AI agents only when tasks have disjoint write sets. Do not assign overlapping edits in parallel.

### Agent 1 - Schema and backend service foundation

Ownership:

- `src/lib/setup-sql.js`
- `api/_shared/hmo-claims.js` new file
- `api/_shared/BillingLedgerService.js`

Tasks:

- add schema columns and constraints
- build claim line read model helper
- implement selection validation
- harden `createHmoInvoiceBatch`
- add `submitHmoInvoiceBatch`
- harden `recordHmoInvoiceBatchPayment`

Do not edit frontend files.

### Agent 2 - Billing endpoint/API integration

Ownership:

- `api/billing/index.js`
- tests under `test/` for billing endpoint behavior

Tasks:

- expose read model changes
- add actions:
  - `create_hmo_claim_batch`
  - `submit_hmo_claim_batch`
  - `record_hmo_batch_payment`
  - `update_hmo_batch_item_status`
- preserve compatibility for `view=hmo_claims`
- demote but do not remove `record_hmo_claim_payment`
- map backend validation errors to stable API error codes

Do not edit schema directly unless coordinating with Agent 1.

### Agent 3 - Frontend HMO workspace

Ownership:

- `src/pages/FinancialsPage.jsx`
- optionally new files under `src/features/finance/hmo-claims/`
- `src/lib/currency.js` only if absolutely required, but prefer no changes

Tasks:

- split HMO tab into queue/batches/payments/provider balances
- add batch creation UI
- add batch submission UI
- add batch payment UI
- move manual provider credit to advanced/manual correction
- use `formatCurrency` and `toAgorot`
- keep RTL Hebrew UI consistent with current design

### Agent 4 - Dashboard and workflow tasks

Ownership:

- `src/pages/DashboardPage.jsx`
- `api/dashboard-tasks/index.js`
- `api/_shared/dashboard-tasks.js` only if new helper behavior is needed
- `api/calendar-attendance/index.js` only for HMO task lifecycle integration

Tasks:

- ensure dashboard summaries group by operational kind/provider
- ensure HMO task prompts do not become durable truth
- add grouped task links into filtered Financials/HMO view where feasible
- verify `orgId` is passed to all dashboard task helpers

### Agent 5 - QA/review agent

Ownership:

- no production code unless fixing tests only
- `test/` files
- implementation evidence docs under this folder

Tasks:

- write targeted tests
- run finance hardening protocol
- review non-goals
- check no duplicated HMO truth tables were introduced
- check no ledger mutation bypasses `BillingLedgerService`
- check no currency manual multiply/round remains in HMO payment flows

## 11. AI Agent Best Practices For This Work

Required:

- Read this plan and required docs before coding.
- Keep each agent write set disjoint.
- Do not reimplement currency helpers.
- Do not query finance tables without `org_id`.
- Do not use `resolveTenantClient`.
- Do not mutate ledger rows.
- Do not create new HMO workflow tables unless this plan is amended.
- Prefer shared helpers over endpoint-local finance logic.
- Update `agents-docs/80-finance-billing-payroll.md` for every new invariant.
- Update this plan if implementation decisions change.

Parallelization guidance:

- Agent 1 and Agent 3 can work in parallel only after API DTO contract is stable.
- Agent 2 should start after Agent 1 publishes helper signatures.
- Agent 4 can work after Agent 2 defines dashboard summary DTOs or filters.
- Agent 5 should run after each phase, not only at the end.

Stop conditions:

- Any proposed schema that creates duplicate financial truth.
- Any flow that posts ledger credits outside `BillingLedgerService`.
- Any flow that counts paid lessons instead of submitted claim items against authorization cap.
- Any implementation that uses tasks as durable HMO claim state.

## 12. Acceptance Criteria

### AC-HMO-001 Claim lines are ledger-backed

Given an attended covered HMO lesson with active ledger debit,
when Financials HMO claims loads,
then the claim line appears even if no dashboard task exists.

### AC-HMO-002 Reversed receivables disappear or become invalidated

Given an HMO lesson charge was reversed,
when HMO claims loads,
then it is not claimable and cannot be included in a new batch.

### AC-HMO-003 Batch creation uses existing tables

Given selected claimable lines,
when staff creates a batch,
then one `hmo_invoice_batches` row and multiple `hmo_invoice_batch_items` rows are created with `org_id`.

### AC-HMO-004 Duplicate batch item prevention

Given a ledger transaction is already attached to a non-cancelled batch,
when staff attempts to add it to another batch,
then the backend blocks it.

### AC-HMO-005 Authorization cap enforcement

Given `authorized_lessons = 10`,
and 10 claim items are already in non-cancelled submitted/draft batches for that authorization,
when staff attempts to submit another claim line for that authorization,
then the backend blocks the operation.

### AC-HMO-006 Cap counts submitted/selected claims, not paid claims

Given 10 submitted claim items are unpaid,
when staff attempts to submit an 11th claim,
then the backend blocks it.

### AC-HMO-007 Provider policy columns drive UI and validation

Given a provider has `settlement_basis = visits`,
when staff creates a batch,
then the UI and backend show visit count as a first-class expected measure.

### AC-HMO-008 Batch payment is ledger-backed

Given a submitted batch,
when staff records payment,
then a ledger credit is appended through `BillingLedgerService` with `source_type = hmo_invoice_payment`.

### AC-HMO-009 Manual provider credit is no longer primary

Given the HMO claims tab,
then the main user flow is batch/remittance based and the old generic credit action is hidden behind advanced/manual correction.

### AC-HMO-010 Dashboard is summarized

Given many open HMO claim items,
when dashboard loads,
then it shows grouped summaries rather than one card per claim line.

### AC-HMO-011 Calendar lock behavior remains safe

Given a claim line is submitted in a batch,
when staff attempts a locked calendar mutation,
then existing finance lock behavior prevents unsafe edits.

### AC-HMO-012 No duplicate source of truth

Given the implementation is complete,
then HMO claim line existence is still derived from ledger and no new claim line table exists.

## 13. Test Plan

### Unit tests

Add or update:

- `test/billing-hmo-claims-read-model.test.js`
- `test/billing-hmo-batch-lifecycle.test.js`
- `test/billing-claim-payment.test.js`

Minimum test cases:

- active HMO receivable appears as claimable
- reversed receivable excluded
- duplicate batch item blocked
- missing `org_id` cannot happen in batch/item insert
- authorization cap blocks 11th submitted item
- unpaid submitted items still count against cap
- cancelled batch items do not count against cap
- provider `requires_reference_number` blocks submit/payment without reference
- partial payment updates batch to `partially_paid`
- exact/tolerated payment updates batch to `paid`
- payment posts ledger credit through service

### Integration smoke tests

- create HMO provider with policy columns
- create HMO authorization with 2 authorized lessons
- mark two lessons attended
- create and submit batch with two lines
- verify third claim is blocked by cap
- record partial payment
- record remaining payment
- verify provider balance changes
- verify dashboard summary changes

### Frontend manual QA

- HMO queue shows claimable lines
- batch creation selection is clear
- over-cap lines show reason
- payment dialog uses agorot conversion correctly
- old manual credit path is not the primary visible flow
- grouped dashboard summary links to relevant HMO view

## 14. Rollout Plan

### Phase 0 - Foundation

- schema columns
- helper read model
- helper validation
- tests for helpers

No UI changes except hidden compatibility.

### Phase 1 - Batch creation/submission

- create draft batch
- submit batch
- participant locks
- dashboard summaries

Manual old payment can remain as fallback.

### Phase 2 - Batch payment/remittance

- record payment against batch
- update batch status
- update provider receivable snapshots
- move old generic credit to advanced/manual correction

### Phase 3 - Provider policy UI

- expose provider settlement settings
- enforce reference/tolerance/delay behavior

### Phase 4 - Hardening and cleanup

- remove or strongly restrict old `record_hmo_claim_payment`
- add reconciliation reports
- close documentation gaps

## 15. Rollback Strategy

Rollback must not mutate ledger rows.

Safe rollback options:

- hide new HMO claims UI
- disable batch creation/submission actions
- keep read model available
- leave existing `hmo_invoice_batches/items` data intact
- reverse any incorrect payment ledger credits through `BillingLedgerService.reverseTransaction`

Unsafe rollback options:

- deleting ledger rows
- deleting batch rows after submission
- directly editing ledger amounts
- moving claim lines between batches without audit

## 16. Documentation Updates Required During Implementation

Update:

- `agents-docs/80-finance-billing-payroll.md`
- `agents-docs/60-calendar-and-sessions.md` if lock/calendar behavior changes
- `implementations/finance/ledger/finance-workflow-contract-v1.md` if existing baseline behavior changes
- this document when implementation details change

Add after implementation:

- `implementations/finance/hmo-claims/release-evidence.md`

## 17. Open Questions

These should be resolved before Phase 2 if possible:

- Should one HMO payment be allowed to cover multiple batches in v2, or is batch-level payment enough for first rollout?
- Should `issued` be renamed in the UI to `submitted` while kept in DB for compatibility?
- Should rejected claim lines free authorization cap immediately, or only after a formal cancellation/resubmission decision?
- Should cancelled batches release participant locks automatically?
- Should provider payment tolerance be amount-only in v2, with percent added later?

Default assumptions until changed:

- batch-level payment is enough for v2
- UI uses `submitted`; DB may still accept legacy `issued`
- rejected claim lines do not automatically free cap until explicitly cancelled
- cancelled batches release locks
- amount tolerance is implemented first; percent tolerance can be read-only/display until needed

## 18. Non-Goals

Do not implement in this project phase:

- generic insurance provider abstraction beyond HMO
- separate `claim_lines` table
- separate `hmo_remittances` table
- automatic external HMO portal integration
- automatic OCR/import of HMO remittance documents
- calendar-side pre-blocking for authorization cap
- rewriting historical ledger transactions
- deleting old batch/payment records

## 19. Implementation Progress

### 2026-04-23 - Phase 1 foundation started

Implemented backend/data foundations:

- Added provider-level claim policy columns to `hmo_providers` in `src/lib/setup-sql.js`:
  - `claim_submission_mode`
  - `claim_payment_timing`
  - `claim_reference_required`
  - `claim_period_granularity`
  - `claim_payment_matching_mode`
- Expanded `hmo_invoice_batches` lifecycle support:
  - new default status is `draft`
  - accepted statuses now include `submitted`, `acknowledged`, `disputed`, and `closed`
  - added `submitted_at`, `submitted_by`, and `received_at`
  - kept legacy `issued` accepted for compatibility
- Expanded `hmo_invoice_batch_items` so each item can carry operational claim metadata:
  - `expected_amount`
  - `expected_unit_count`
  - `paid_amount`
  - `status`
  - `lesson_participant_id`
  - `hmo_authorization_id`
  - `hmo_provider_id`

Implemented ledger service hardening:

- `BillingLedgerService.createHmoInvoiceBatch(...)` now:
  - requires `orgId`
  - validates the HMO provider exists and is active
  - supports explicit selected `ledgerTransactionIds`
  - writes `org_id` to batches and items
  - creates new batches as `draft`, not `issued`
  - excludes reversed ledger rows
  - excludes claim rows already attached to a non-cancelled batch
  - blocks empty/zero-amount batches
  - enforces `authorized_lessons` by existing active batch-item count plus selected rows
- Added `BillingLedgerService.submitHmoInvoiceBatch(...)`:
  - only draft batches can be submitted
  - validates batch has items
  - rechecks authorization cap before submit
  - updates batch/item status to `submitted`
  - creates participant locks with `lock_source_type = 'claim_batch'`
  - resolves matching open HMO dashboard tasks
- Hardened `recordHmoInvoiceBatchPayment(...)`:
  - requires org scope
  - requires submitted/issued-or-later batch status
  - records payment ledger credit against the HMO provider
  - updates batch paid/status fields

Implemented API/read-model foundations:

- Added billing API actions:
  - `create_hmo_claim_batch`
  - `submit_hmo_claim_batch`
  - `record_hmo_batch_payment`
- Kept legacy action names accepted where practical for compatibility.
- HMO claims read model now exposes:
  - `ledger_transaction_id`
  - batch/item linkage per claim
  - batch workflow status
  - provider claim policy snapshot
  - `invoice_batches` list for the visible claim range
- Calendar workflow lock resolution now checks both legacy `claim_batches` and current `hmo_invoice_batches`.

Implemented first UI pass:

- The HMO claims tab now has a guided claim-batch area:
  - select open claim lines
  - create a draft claim batch
  - view created batches in the visible range
  - submit draft batches
- The previous generic “credit by provider/date” payment card was removed from the primary UI path because it bypasses the intended batch lifecycle.
- Hebrew labels were added for batch statuses to keep the workflow understandable for non-technical office users.

Verification completed:

- `npx eslint api/_shared/BillingLedgerService.js api/billing/index.js api/_shared/calendar-workflow.js api/_shared/BillingLedgerService.test.js src/pages/FinancialsPage.jsx`
- `node --test api/_shared/BillingLedgerService.test.js`

Known remaining work:

- Add a dedicated batch-payment UI against submitted batches.
- Add provider policy UI and enforce provider-specific reference/tolerance rules where needed.
- Add UI grouping by provider so “select all” does not accidentally mix providers.
- Add cancellation/reopen behavior for draft/submitted batches.
- Add release evidence in `implementations/finance/hmo-claims/release-evidence.md` before rollout.

### 2026-04-23 - Phase 2 operational controls continued

Implemented additional lifecycle controls:

- Added `BillingLedgerService.cancelHmoInvoiceBatch(...)`:
  - only unpaid batches can be cancelled
  - cancelled batches mark their items as `cancelled`
  - participant locks created by the submitted batch are released
  - paid batches are explicitly blocked from cancellation
- Hardened `recordHmoInvoiceBatchPayment(...)`:
  - blocks payment before batch submission
  - blocks payment above the open batch balance
  - enforces provider `claim_reference_required`
  - keeps the ledger as the only source of financial balance mutation
- Added billing API actions:
  - `cancel_hmo_claim_batch`
  - `update_hmo_provider_claim_policy`
- Exposed provider claim policies in the HMO claims read model and provider receivables cards.

Implemented UI controls:

- Claim-line selection now guides users to pick one provider at a time instead of using a risky global “select all”.
- Submitted/acknowledged/partial batches now show an inline payment form tied to that exact batch.
- Draft/submitted unpaid batches can be cancelled from the UI with a confirmation prompt.
- Provider cards now allow updating first-pass claim policy settings:
  - submission mode
  - payment timing
  - payment matching mode
  - whether payment reference is mandatory
- User-facing error messages were mapped to Hebrew for common HMO claim lifecycle failures.
- `HmoProviderBillingWorkspace` was aligned with the new lifecycle:
  - it now labels the workflow as draft/submitted claim demands rather than generic invoices
  - draft batches must be submitted before payment
  - payment is disabled for draft/cancelled/paid batches
  - unpaid batches can be cancelled
  - payment amount is checked against the open batch balance before submit

Verification completed:

- `node --test api/_shared/BillingLedgerService.test.js`
- `npx eslint api/_shared/BillingLedgerService.js api/billing/index.js api/_shared/BillingLedgerService.test.js src/pages/FinancialsPage.jsx src/features/finance/components/HmoProviderBillingWorkspace.jsx`

Remaining work after this phase:

- Add a richer reconciliation view for partial/disputed payments.
- Add provider period granularity to the UI if users need non-monthly operational filtering.
- Add explicit reopen/resubmit workflow if real operations require it; do not silently reopen cancelled batches.
- Add release evidence in `implementations/finance/hmo-claims/release-evidence.md` before rollout.

### 2026-04-23 - Pre-prod claim id and HMO ledger-account hardening

Implemented compatibility and integrity fixes discovered during pre-prod testing:

- `BillingLedgerService.createHmoInvoiceBatch(...)` now accepts legacy/current HMO dashboard task ids as explicit selected claim ids and resolves them to active `ledger_transactions` before creating a batch.
- This compatibility path is intentionally not a new source of truth: `dashboard_tasks.resource_id` is used only to locate the lesson participant, and the batch is still created only from an active HMO receivable ledger row with the expected provider/authorization.
- Error details for `hmo_claim_line_not_claimable` now include requested claim ids, resolved dashboard task ids, missing claim ids, and found ledger ids so pre-prod diagnostics identify whether the UI sent task ids or ledger ids.
- `ledger_accounts` now supports first-class HMO provider accounts via `account_type = 'hmo_provider'` and `hmo_provider_id`.
- `BillingLedgerService.resolveLedgerAccount(...)` now creates/reuses real HMO ledger accounts instead of returning an HMO target with `ledger_account_id = null`.
- `ledger_transactions.client_profile_id` is no longer required for HMO-provider-only ledger activity; the validation trigger now requires either `client_profile_id` or `hmo_provider_id`.
- `setup-sql.js` backfills HMO provider ledger accounts for existing providers and links historical HMO ledger rows that were created with `ledger_account_id = null`. This is a technical account-link repair only; it does not change ledger amounts, directions, source ids, or effective dates.
- Unit coverage now verifies that covered HMO attendance creates an HMO debit linked to a real HMO ledger account, and that existing dashboard task ids can still be submitted after resolving to ledger rows.

Verification completed:

- `node --test api/_shared/BillingLedgerService.test.js`
- `npx eslint api/_shared/BillingLedgerService.js api/_shared/BillingLedgerService.test.js src/lib/setup-sql.js`
