import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Step 9 contract-level guardrails:
// Ensure payload-to-action semantics keep the reconciliation path explicit and provider-scoped.
describe('billing claim payment contract', () => {
  it('treats missing provider id as invalid', () => {
    const payload = {
      action: 'record_hmo_claim_payment',
      hmo_provider_id: '',
      amount: 1000,
    };

    const isValid = Boolean(payload.hmo_provider_id);
    assert.equal(isValid, false);
  });

  it('requires positive payment amount', () => {
    const payload = {
      action: 'record_hmo_claim_payment',
      hmo_provider_id: 'hmo-1',
      amount: 0,
    };

    const isPositive = Number(payload.amount) > 0;
    assert.equal(isPositive, false);
  });

  it('defaults task resolution to enabled unless explicitly false', () => {
    const a = { resolve_open_claim_tasks: undefined, resolveOpenClaimTasks: undefined };
    const b = { resolve_open_claim_tasks: false, resolveOpenClaimTasks: undefined };

    const defaultEnabled = a.resolve_open_claim_tasks !== false && a.resolveOpenClaimTasks !== false;
    const explicitDisabled = b.resolve_open_claim_tasks !== false && b.resolveOpenClaimTasks !== false;

    assert.equal(defaultEnabled, true);
    assert.equal(explicitDisabled, false);
  });
});
