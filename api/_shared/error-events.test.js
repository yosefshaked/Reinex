/* eslint-env node */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { respondTrackedError, trackErrorEvent } from './error-events.js';

function createSupabaseMock({ failInsert = false } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      return {
        delete() {
          calls.push({ table, action: 'delete' });
          return {
            lt(column, value) {
              calls.push({ table, action: 'delete.lt', column, value });
              return Promise.resolve({ error: null });
            },
          };
        },
        insert(payload) {
          calls.push({ table, action: 'insert', payload });
          return Promise.resolve({ error: failInsert ? new Error('insert_failed') : null });
        },
      };
    },
  };
}

describe('error-events', () => {
  it('respondTrackedError returns safe body and stores raw details internally', async () => {
    const context = { log: { warn() {} } };
    const req = {
      method: 'GET',
      url: 'https://app.test/api/documents-download?document_id=secret',
      headers: { 'user-agent': 'node-test' },
    };
    const supabase = createSupabaseMock();
    const rawError = Object.assign(new Error('provider secret failure'), {
      code: 'PGRST123',
      details: 'table internals',
    });

    await respondTrackedError(context, req, supabase, {
      status: 500,
      message: 'failed_to_generate_download_url',
      orgId: '11111111-1111-1111-1111-111111111111',
      userId: '22222222-2222-2222-2222-222222222222',
      error: rawError,
      metadata: { documentId: 'doc-1' },
      supportCode: 'ERR-20260510-ABC123',
      now: new Date('2026-05-10T10:00:00.000Z'),
    });

    assert.equal(context.res.status, 500);
    assert.deepEqual(JSON.parse(context.res.body), {
      message: 'failed_to_generate_download_url',
      error_id: 'ERR-20260510-ABC123',
    });

    const insert = supabase.calls.find((call) => call.action === 'insert');
    assert.equal(insert.table, 'error_events');
    assert.equal(insert.payload.support_code, 'ERR-20260510-ABC123');
    assert.equal(insert.payload.internal_error.message, 'provider secret failure');
    assert.equal(insert.payload.internal_error.details, 'table internals');
    assert.equal(insert.payload.metadata.documentId, 'doc-1');
    assert.equal(insert.payload.expires_at, '2026-08-08T10:00:00.000Z');
  });

  it('tracking failure does not block the intended response', async () => {
    const warnings = [];
    const context = { log: { warn(message, meta) { warnings.push({ message, meta }); } } };
    const supabase = createSupabaseMock({ failInsert: true });

    await assert.doesNotReject(() => respondTrackedError(context, { method: 'POST', url: '/api/test' }, supabase, {
      status: 503,
      message: 'backend_unavailable',
      supportCode: 'ERR-20260510-FAIL01',
    }));

    assert.equal(context.res.status, 503);
    assert.equal(JSON.parse(context.res.body).error_id, 'ERR-20260510-FAIL01');
    assert.equal(warnings.some((entry) => entry.message === 'error-events insert failed'), true);
  });

  it('trackErrorEvent stores 4xx events too', async () => {
    const supabase = createSupabaseMock();
    const code = await trackErrorEvent({ log: { warn() {} } }, { method: 'PATCH', url: '/api/students-list/1' }, supabase, {
      status: 400,
      message: 'invalid_student_id',
      supportCode: 'ERR-20260510-BAD400',
    });

    assert.equal(code, 'ERR-20260510-BAD400');
    const insert = supabase.calls.find((call) => call.action === 'insert');
    assert.equal(insert.payload.status, 400);
    assert.equal(insert.payload.severity, 'info');
  });
});

