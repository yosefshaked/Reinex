# Finance + Calendar Change Checklist

Use this checklist before returning any change that touches calendar status, lesson generation, HMO authorization, billing policy, ledger rows, claim batches, or finance UI.

## Source Of Truth
- Billing math is in `api/_shared/BillingLedgerService.js`.
- Coverage decisions are in `api/_shared/hmo.js`.
- Finance policy loading is in `api/_shared/employee-finance.js`.
- Calendar endpoints may orchestrate mutations, but must not calculate lesson prices or write ledger rows directly.
- Self-seeded backend workflow contracts live in `test/finance-calendar-workflows.test.js`.
- Browser-driven end-to-end scenarios belong under `test/automatic-tester/scripts/`.

## Required Questions
- Which participant statuses can this change affect: `scheduled`, `attended`, `no_show`, `cancelled_student`, `cancelled_clinic`?
- Does preview use the same shared billing decision as apply?
- Does apply leave exactly the active ledger rows expected for the final participant status?
- Are old ledger rows preserved and reversed instead of updated/deleted?
- Can this create duplicate active `lesson_charge` rows for the same participant/account/source?
- If HMO coverage is involved, do reversed rows stay out of entitlement, claim readiness, and claim capacity?
- If a policy setting changed, are existing rows resynced or explicitly skipped because they are locked?
- Are locked/submitted-claim participants skipped instead of silently rewritten?
- What stale-data risk remains after this change?

## Required Commands
Run these before handing back calendar/finance work:

```bash
npm run test:finance-calendar
npm run audit:finance-calendar:fixture
npm run lint:api
npm run lint:api-responses:strict-ux
npm run build
```

For a pre-beta release branch, prefer:

```bash
npm run verify:beta
```

## Expected Evidence In Final Answer
- Mention the affected billing source-of-truth function.
- List the important status transitions tested.
- List any skipped/locked behavior.
- State any remaining manual QA risk.
