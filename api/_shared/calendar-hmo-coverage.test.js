/* eslint-env node */
import test from 'node:test';
import assert from 'node:assert/strict';
import { enrichLessonInstancesWithHmoCoverage } from './calendar-hmo-coverage.js';

// Minimal chainable Supabase stand-in: every query on a table resolves to that table's rows.
function createFakeClient(rowsByTable = {}) {
  return {
    from(table) {
      const result = { data: rowsByTable[table] || [], error: null };
      const builder = {
        select: () => builder,
        order: () => builder,
        eq: () => builder,
        in: () => builder,
        then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
      };
      return builder;
    },
  };
}

const LESSON = {
  id: 'lesson-1',
  service_id: 'service-1',
  datetime_start: '2026-09-14T08:00:00.000Z',
  participants: [{ id: 'participant-1', student_id: 'student-1' }],
};

test('enrichLessonInstancesWithHmoCoverage exposes authorization reference, lesson quota and expiry', async () => {
  const client = createFakeClient({
    hmo_authorizations: [{
      id: 'auth-1',
      student_id: 'student-1',
      service_id: 'service-1',
      provider_id: 'provider-1',
      provider_track_id: 'track-1',
      authorization_reference: ' APR-7788 ',
      authorized_lessons: 12,
      valid_from: '2026-01-01',
      expires_at: '2026-12-31',
      covered_customer_charge_amount: 2000,
      covered_insurer_claim_amount: 15000,
      post_coverage_policy: 'manual_block',
      status: 'active',
      created_at: '2026-01-01T00:00:00.000Z',
    }],
    hmo_providers: [{ id: 'provider-1', name: 'כללית' }],
    hmo_provider_tracks: [{ id: 'track-1', provider_id: 'provider-1', service_id: 'service-1', name: 'מסלול טיפולי' }],
    ledger_transactions: [],
  });

  const [instance] = await enrichLessonInstancesWithHmoCoverage(client, 'org-1', [LESSON]);
  const coverage = instance.participants[0].hmo_coverage;

  assert.equal(coverage.status, 'covered');
  assert.equal(coverage.authorization_id, 'auth-1');
  assert.equal(coverage.authorization_reference, 'APR-7788');
  assert.equal(coverage.authorized_lessons, 12);
  assert.equal(coverage.expires_at, '2026-12-31');
  assert.equal(coverage.remaining_authorized_lessons, 12);
  assert.equal(coverage.hmo_provider_name, 'כללית');
  assert.equal(coverage.hmo_provider_track_name, 'מסלול טיפולי');
});

test('enrichLessonInstancesWithHmoCoverage returns null authorization fields when nothing applies', async () => {
  const [instance] = await enrichLessonInstancesWithHmoCoverage(createFakeClient(), 'org-1', [LESSON]);
  const coverage = instance.participants[0].hmo_coverage;

  assert.equal(coverage.status, 'standard_uncovered');
  assert.equal(coverage.reason, 'no_authorization_found');
  assert.equal(coverage.authorization_reference, null);
  assert.equal(coverage.authorized_lessons, null);
  assert.equal(coverage.expires_at, null);
});
