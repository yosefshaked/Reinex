import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeString } from '../api/_shared/org-bff.js';
import { coerceAgorot } from '../api/_shared/currency.js';
import { resolveOpenClaimTasksEnabled } from '../api/billing/index.js';

describe('billing claim payment — hmo_provider_id validation', () => {
  // The handler does: normalizeString(body.hmo_provider_id || body.hmoProviderId)
  // and throws 'missing_hmo_provider_id' when the result is falsy.

  it('empty string is rejected', () => {
    assert.equal(!normalizeString(''), true);
  });

  it('whitespace-only string is rejected (normalizeString trims)', () => {
    assert.equal(!normalizeString('   '), true);
  });

  it('null coerces to empty and is rejected', () => {
    assert.equal(!normalizeString(null), true);
  });

  it('undefined coerces to empty and is rejected', () => {
    assert.equal(!normalizeString(undefined), true);
  });

  it('valid id is accepted', () => {
    assert.ok(normalizeString('hmo-abc-123'));
  });

  it('camelCase hmoProviderId fallback is used when snake_case is empty', () => {
    const snake = '';
    const camel = 'hmo-provider-uuid';
    assert.ok(normalizeString(snake || camel));
  });

  it('both fields empty — neither fallback saves it', () => {
    const snake = '';
    const camel = '';
    assert.equal(!normalizeString(snake || camel), true);
  });
});

describe('billing claim payment — amount validation (coerceAgorot gate)', () => {
  // appendManualCredit does: coerceAgorot(amount) <= 0 → throws 'amount_must_be_positive_integer'

  it('zero fails the positive check', () => {
    assert.equal(coerceAgorot(0) <= 0, true);
  });

  it('negative agorot fails the positive check', () => {
    assert.equal(coerceAgorot(-1) <= 0, true);
  });

  it('non-numeric string coerces to zero and fails', () => {
    assert.equal(coerceAgorot('abc') <= 0, true);
  });

  it('null coerces to zero and fails', () => {
    assert.equal(coerceAgorot(null) <= 0, true);
  });

  it('positive integer passes', () => {
    assert.equal(coerceAgorot(1) > 0, true);
  });

  it('large agorot amount (10 000 ₪) passes', () => {
    assert.equal(coerceAgorot(1_000_000) > 0, true);
  });

  it('float is rounded to nearest agora and evaluated correctly', () => {
    // 0.4 rounds to 0 → rejected; 0.6 rounds to 1 → accepted
    assert.equal(coerceAgorot(0.4) <= 0, true);
    assert.equal(coerceAgorot(0.6) > 0, true);
  });
});

describe('billing claim payment — resolve_open_claim_tasks defaulting', () => {
  // resolveOpenClaimTasksEnabled mirrors billing/index.js handler logic exactly.

  it('defaults to enabled when body has no flag set', () => {
    assert.equal(resolveOpenClaimTasksEnabled({}), true);
  });

  it('defaults to enabled when body is undefined', () => {
    assert.equal(resolveOpenClaimTasksEnabled(undefined), true);
  });

  it('disabled when snake_case field is explicitly false', () => {
    assert.equal(resolveOpenClaimTasksEnabled({ resolve_open_claim_tasks: false }), false);
  });

  it('disabled when camelCase field is explicitly false', () => {
    assert.equal(resolveOpenClaimTasksEnabled({ resolveOpenClaimTasks: false }), false);
  });

  it('enabled when snake_case field is explicitly true', () => {
    assert.equal(resolveOpenClaimTasksEnabled({ resolve_open_claim_tasks: true }), true);
  });

  it('enabled when snake_case is true and camelCase is undefined', () => {
    assert.equal(resolveOpenClaimTasksEnabled({ resolve_open_claim_tasks: true, resolveOpenClaimTasks: undefined }), true);
  });

  it('disabled when camelCase is false regardless of snake_case', () => {
    assert.equal(resolveOpenClaimTasksEnabled({ resolve_open_claim_tasks: true, resolveOpenClaimTasks: false }), false);
  });
});
