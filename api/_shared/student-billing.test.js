/* eslint-env node */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIntakeFinanceNotice } from './student-billing.js';

const NOW = new Date('2026-05-07T10:00:00.000Z');

function matchedEntry(overrides = {}) {
  return {
    id: 'entry-1',
    status: 'matched',
    created_at: '2026-05-01T10:00:00.000Z',
    metadata: {
      payment_path_intent: 'hmo',
      hmo_provider_name: 'כללית',
      hmo_approval_status: 'no_approval_yet',
      matched_at: '2026-05-01T10:00:00.000Z',
    },
    ...overrides,
  };
}

test('buildIntakeFinanceNotice exposes recent matched waiting-list funding intent', () => {
  const notice = buildIntakeFinanceNotice({ entry: matchedEntry(), now: NOW });

  assert.equal(notice.waiting_list_entry_id, 'entry-1');
  assert.equal(notice.payment_path_intent, 'hmo');
  assert.equal(notice.label, 'גורם מממן');
  assert.equal(notice.hmo_provider_name, 'כללית');
});

test('buildIntakeFinanceNotice hides once finance activity exists', () => {
  assert.equal(buildIntakeFinanceNotice({
    entry: matchedEntry(),
    hasLedgerActivity: true,
    now: NOW,
  }), null);
  assert.equal(buildIntakeFinanceNotice({
    entry: matchedEntry(),
    hasHmoAuthorization: true,
    now: NOW,
  }), null);
});

test('buildIntakeFinanceNotice expires after 30 days', () => {
  assert.equal(buildIntakeFinanceNotice({
    entry: matchedEntry({
      metadata: {
        payment_path_intent: 'private',
        matched_at: '2026-04-01T10:00:00.000Z',
      },
    }),
    now: NOW,
  }), null);
});
