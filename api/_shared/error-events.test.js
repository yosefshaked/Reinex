/* eslint-env node */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { attachErrorTracking, respondTracked, respondTrackedError, trackErrorEvent } from './error-events.js';
import { handleGet } from '../system-admin-error-events/index.js';

/** Captures every operational log call by level. */
function createLogs() {
  const entries = [];
  const log = {};
  for (const level of ['error', 'warn', 'info']) {
    log[level] = (message, meta) => entries.push({ level, message, meta });
  }
  return { log, entries };
}

// failInsert: false, true (the insert returns { error }) or 'throw' (the insert rejects).
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
          if (failInsert === 'throw') return Promise.reject(new Error('network_down'));
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

  it('tracking failure does not block the intended response, and shows no support code', async () => {
    const context = { log: createLogs().log };
    const supabase = createSupabaseMock({ failInsert: true });

    await assert.doesNotReject(() => respondTrackedError(context, { method: 'POST', url: '/api/test' }, supabase, {
      status: 503,
      message: 'backend_unavailable',
      supportCode: 'ERR-20260510-FAIL01',
    }));

    assert.equal(context.res.status, 503);
    // Before F2 this response carried error_id 'ERR-20260510-FAIL01', a code with no saved record.
    assert.deepEqual(JSON.parse(context.res.body), { message: 'backend_unavailable' });
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

  it('respondTracked uses attached request/client context for nested handlers', async () => {
    const context = { log: { warn() {} } };
    const req = {
      method: 'POST',
      url: '/api/calendar-attendance',
      headers: { 'x-request-id': 'req-1' },
    };
    const supabase = createSupabaseMock();

    attachErrorTracking(context, req, supabase, {
      orgId: '11111111-1111-1111-1111-111111111111',
      userId: '22222222-2222-2222-2222-222222222222',
      metadata: { endpoint: 'calendar-attendance' },
    });

    await respondTracked(context, 500, { message: 'failed_to_update_attendance' }, undefined, {
      error: new Error('database update failed'),
      supportCode: 'ERR-20260510-NESTED',
      now: new Date('2026-05-10T10:00:00.000Z'),
    });

    assert.equal(context.res.status, 500);
    assert.deepEqual(JSON.parse(context.res.body), {
      message: 'failed_to_update_attendance',
      error_id: 'ERR-20260510-NESTED',
    });

    const insert = supabase.calls.find((call) => call.action === 'insert');
    assert.equal(insert.payload.org_id, '11111111-1111-1111-1111-111111111111');
    assert.equal(insert.payload.actor_user_id, '22222222-2222-2222-2222-222222222222');
    assert.equal(insert.payload.metadata.endpoint, 'calendar-attendance');
    assert.equal(insert.payload.internal_error.message, 'database update failed');
  });
});

describe('F2: a support code shown to the user points to a saved record', () => {
  const req = { method: 'POST', url: '/api/lesson-templates' };
  const originalError = Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' });

  it('a saved event: the response code equals the stored support_code (the support search matches it exactly)', async () => {
    const context = { log: createLogs().log };
    const supabase = createSupabaseMock();
    await respondTrackedError(context, req, supabase, { status: 500, message: 'failed_to_create_lesson_template', error: originalError });

    const body = JSON.parse(context.res.body);
    const insert = supabase.calls.find((call) => call.action === 'insert');
    assert.match(body.error_id, /^ERR-\d{8}-[A-Z0-9]{6}$/);
    assert.equal(body.error_id, insert.payload.support_code);
    assert.equal(body.message, 'failed_to_create_lesson_template');
  });

  for (const [label, failInsert] of [['returns an error', true], ['rejects', 'throw']]) {
    it(`the insert ${label}: no support code, and the operational log keeps both errors, once`, async () => {
      const logs = createLogs();
      const context = { log: logs.log };
      const supabase = createSupabaseMock({ failInsert });
      const code = await trackErrorEvent(context, req, supabase, { status: 500, message: 'failed_to_create_lesson_template', error: originalError });
      assert.equal(code, null);

      const failure = logs.entries.find((entry) => entry.level === 'error' && entry.message === 'error-events: tracking failed');
      assert.ok(failure, 'the tracking failure is logged as an error');
      assert.equal(failure.meta.originalError.message, 'duplicate key value violates unique constraint');
      assert.equal(failure.meta.originalError.code, '23505');
      assert.match(failure.meta.trackingError, failInsert === 'throw' ? /network_down/ : /insert_failed/);
      assert.equal(failure.meta.status, 500);
      // No recursive tracking: exactly one insert attempt, and no second event about the failure.
      assert.equal(supabase.calls.filter((call) => call.action === 'insert').length, 1);
    });
  }

  it('the response after a failed insert has no error_id', async () => {
    const context = { log: createLogs().log };
    await respondTrackedError(context, req, createSupabaseMock({ failInsert: 'throw' }), { status: 500, message: 'failed_to_create_lesson_template', error: originalError });
    assert.deepEqual(JSON.parse(context.res.body), { message: 'failed_to_create_lesson_template' });
  });

  it('no client: no support code, no insert, and the original error is logged', async () => {
    const logs = createLogs();
    const context = { log: logs.log };
    const code = await trackErrorEvent(context, req, null, { status: 500, message: 'missing_configuration', error: originalError });
    assert.equal(code, null);
    await respondTrackedError(context, req, undefined, { status: 500, message: 'missing_configuration', error: originalError });
    assert.deepEqual(JSON.parse(context.res.body), { message: 'missing_configuration' });
    const failure = logs.entries.find((entry) => entry.message === 'error-events: tracking failed');
    assert.equal(failure.meta.trackingError, 'no_tracking_client');
    assert.equal(failure.meta.originalError.message, 'duplicate key value violates unique constraint');
  });

  it('respondTracked without attachErrorTracking: no support code, and the original error is logged', async () => {
    const logs = createLogs();
    const context = { log: logs.log };
    await respondTracked(context, 500, { message: 'failed_to_update_attendance' }, undefined, { error: originalError });
    assert.deepEqual(JSON.parse(context.res.body), { message: 'failed_to_update_attendance' });
    const failure = logs.entries.find((entry) => entry.message === 'error-events: tracking failed');
    assert.equal(failure.meta.trackingError, 'tracking_not_attached');
    assert.equal(failure.meta.originalError.message, 'duplicate key value violates unique constraint');
  });
});

/**
 * A tiny in-memory error_events table that both the tracking insert and the support search use,
 * so a test can follow a code from the response to the record support finds.
 */
function createErrorEventsStore() {
  const rows = [];
  function query() {
    const filters = [];
    const api = {
      select() { return api; },
      order() { return api; },
      range() { return api; },
      eq(column, value) { filters.push((row) => row[column] === value); return api; },
      ilike() { return api; },
      gte() { return api; },
      lt() { return api; },
      or(expression) {
        const needle = /support_code\.ilike\.%([^%]*)%/.exec(expression)?.[1] || '';
        filters.push((row) => String(row.support_code).includes(needle) || String(row.route).includes(needle));
        return api;
      },
      then(resolve, reject) {
        const data = rows.filter((row) => filters.every((filter) => filter(row)));
        return Promise.resolve({ data, error: null, count: data.length }).then(resolve, reject);
      },
    };
    return api;
  }
  return {
    rows,
    from(table) {
      assert.equal(table, 'error_events');
      return {
        ...query(),
        insert(payload) { rows.push({ id: `event-${rows.length + 1}`, ...payload }); return Promise.resolve({ error: null }); },
        delete() { return { lt() { return Promise.resolve({ error: null }); } }; },
      };
    },
  };
}

describe('F2: the code the user sees is found by the support search', () => {
  it('a returned error_id finds exactly its saved event, by exact code and by free search', async () => {
    const store = createErrorEventsStore();
    const context = { log: createLogs().log };
    // Another event first, so the search has something to tell apart.
    await respondTrackedError({ log: createLogs().log }, { method: 'GET', url: '/api/other' }, store, { status: 500, message: 'other_failure' });
    await respondTrackedError(context, { method: 'POST', url: '/api/lesson-templates' }, store, {
      status: 500, message: 'failed_to_create_lesson_template', error: new Error('db down'),
    });
    const { error_id: errorId } = JSON.parse(context.res.body);

    const exact = {};
    await handleGet(exact, { query: { support_code: errorId } }, store);
    const found = JSON.parse(exact.res.body).errors;
    assert.equal(found.length, 1);
    assert.equal(found[0].support_code, errorId);
    assert.equal(found[0].public_message, 'failed_to_create_lesson_template');
    assert.equal(found[0].route, 'lesson-templates');

    const free = {};
    await handleGet(free, { query: { q: errorId } }, store);
    assert.deepEqual(JSON.parse(free.res.body).errors.map((row) => row.support_code), [errorId]);
  });

  it('when the insert failed there is no code to search for, and the store has no such event', async () => {
    const context = { log: createLogs().log };
    await respondTrackedError(context, { method: 'POST', url: '/api/x' }, createSupabaseMock({ failInsert: true }), { status: 500, message: 'x_failed' });
    assert.equal(JSON.parse(context.res.body).error_id, undefined);
  });
});
