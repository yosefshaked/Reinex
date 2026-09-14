/* eslint-env node */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LESSON_CLOSURE_RESYNC_DEFAULT_LIMIT,
  LESSON_CLOSURE_RESYNC_MAX_LIMIT,
  normalizeLessonClosureResyncRequest,
  runLessonClosureResyncBatch,
} from './lesson-closure-maintenance.js';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const id = (n) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;
const flagged = (reasons) => ({ workflow_state: { reasons_open: reasons } });

// Records the candidate query and resolves it with the given rows (capped by limit()).
function createCandidateClient(rows) {
  const calls = [];
  const builder = {
    select(columns) { calls.push(['select', columns]); return builder; },
    eq(column, value) { calls.push(['eq', column, value]); return builder; },
    contains(column, value) { calls.push(['contains', column, value]); return builder; },
    gt(column, value) { calls.push(['gt', column, value]); return builder; },
    order(column, options) { calls.push(['order', column, options]); return builder; },
    limit(count) {
      calls.push(['limit', count]);
      return Promise.resolve({ data: rows.slice(0, count), error: null });
    },
  };
  return {
    calls,
    from(table) { calls.push(['from', table]); return builder; },
  };
}

function fakePlans(plansById) {
  const applied = [];
  return {
    applied,
    plan: async (_client, lessonInstanceId) => {
      const entry = plansById[lessonInstanceId];
      if (entry instanceof Error) throw entry;
      return entry ?? null;
    },
    apply: async (_client, lessonPlan) => { applied.push(lessonPlan.lessonInstanceId); return true; },
  };
}

const changedPlan = (lessonInstanceId, reasons, isClosed = false) => ({
  lessonInstanceId,
  hasChanged: true,
  result: { reasons_open: reasons, is_closed: isClosed },
});
const unchangedPlan = (lessonInstanceId, reasons) => ({
  lessonInstanceId,
  hasChanged: false,
  result: { reasons_open: reasons, is_closed: false },
});

test('normalizeLessonClosureResyncRequest validates mode, scope, ids and clamps the page size', () => {
  assert.deepEqual(normalizeLessonClosureResyncRequest({ mode: 'preview' }), {
    request: { mode: 'preview', scope: 'hmo_claim_unresolved', orgId: null, cursor: null, limit: LESSON_CLOSURE_RESYNC_DEFAULT_LIMIT },
  });
  assert.equal(normalizeLessonClosureResyncRequest({ mode: 'apply', limit: 999 }).request.limit, LESSON_CLOSURE_RESYNC_MAX_LIMIT);
  assert.equal(normalizeLessonClosureResyncRequest({ mode: 'apply', scope: 'OPEN_REASONS' }).request.scope, 'open_reasons');
  assert.deepEqual(normalizeLessonClosureResyncRequest({}), { error: 'invalid_mode' });
  assert.deepEqual(normalizeLessonClosureResyncRequest({ mode: 'delete' }), { error: 'invalid_mode' });
  assert.deepEqual(normalizeLessonClosureResyncRequest({ mode: 'preview', scope: 'all' }), { error: 'invalid_scope' });
  assert.deepEqual(normalizeLessonClosureResyncRequest({ mode: 'preview', org_id: 'nope' }), { error: 'invalid_org_id' });
  assert.deepEqual(normalizeLessonClosureResyncRequest({ mode: 'preview', cursor: "1' or 1=1" }), { error: 'invalid_cursor' });
});

test('preview never writes and reports what would change', async () => {
  const client = createCandidateClient([
    { id: id(1), org_id: ORG_ID, metadata: flagged(['instructor_compensation_unresolved', 'hmo_claim_unresolved']) },
    { id: id(2), org_id: ORG_ID, metadata: flagged(['hmo_claim_unresolved']) },
    { id: id(3), org_id: ORG_ID, metadata: {} },
    { id: id(4), org_id: ORG_ID, metadata: flagged([]) },
  ]);
  const plans = fakePlans({
    [id(1)]: changedPlan(id(1), ['instructor_compensation_unresolved']),
    [id(2)]: changedPlan(id(2), [], true),
  });

  const result = await runLessonClosureResyncBatch(
    client,
    normalizeLessonClosureResyncRequest({ mode: 'preview' }).request,
    { plan: plans.plan, apply: plans.apply },
  );

  assert.deepEqual(plans.applied, [], 'preview must not write');
  assert.equal(result.scanned, 4);
  assert.deepEqual(result.items.map((item) => [item.lesson_instance_id, item.status]), [
    [id(1), 'would_change'],
    [id(2), 'would_change'],
  ], 'never-evaluated and nothing-open lessons are skipped');
  assert.deepEqual(result.items[0].before_reasons, ['instructor_compensation_unresolved', 'hmo_claim_unresolved']);
  assert.deepEqual(result.items[0].after_reasons, ['instructor_compensation_unresolved']);
  assert.equal(result.items[1].closes, true);
  assert.deepEqual(result.totals, { would_change: 2, changed: 0, unchanged: 0, closes: 1, failed: 0 });
  assert.equal(result.next_cursor, null, 'a short page ends the scan');
});

test('apply writes only changed lessons', async () => {
  const client = createCandidateClient([
    { id: id(1), org_id: ORG_ID, metadata: flagged(['hmo_claim_unresolved']) },
    { id: id(2), org_id: ORG_ID, metadata: flagged(['hmo_claim_unresolved']) },
  ]);
  const plans = fakePlans({
    [id(1)]: changedPlan(id(1), []),
    [id(2)]: unchangedPlan(id(2), ['hmo_claim_unresolved']),
  });

  const result = await runLessonClosureResyncBatch(
    client,
    normalizeLessonClosureResyncRequest({ mode: 'apply' }).request,
    { plan: plans.plan, apply: plans.apply },
  );

  assert.deepEqual(plans.applied, [id(1)]);
  assert.deepEqual(result.items.map((item) => item.status), ['changed', 'unchanged']);
  assert.deepEqual(result.totals, { would_change: 0, changed: 1, unchanged: 1, closes: 0, failed: 0 });
});

test('a failing or missing lesson is reported and does not stop the page', async () => {
  const client = createCandidateClient([
    { id: id(1), org_id: ORG_ID, metadata: flagged(['hmo_claim_unresolved']) },
    { id: id(2), org_id: ORG_ID, metadata: flagged(['hmo_claim_unresolved']) },
    { id: id(3), org_id: ORG_ID, metadata: flagged(['hmo_claim_unresolved']) },
  ]);
  const failures = [];
  const plans = fakePlans({
    [id(1)]: new Error('database exploded: raw detail'),
    [id(3)]: changedPlan(id(3), []),
  });

  const result = await runLessonClosureResyncBatch(
    client,
    normalizeLessonClosureResyncRequest({ mode: 'apply' }).request,
    { plan: plans.plan, apply: plans.apply, onLessonError: (lessonId, error) => failures.push([lessonId, error.message]) },
  );

  assert.deepEqual(result.items.map((item) => item.status), ['error', 'missing', 'changed']);
  assert.equal(result.items[0].error, 'lesson_resync_failed', 'raw error detail stays server-side');
  assert.deepEqual(failures, [[id(1), 'database exploded: raw detail']]);
  assert.equal(result.totals.failed, 2);
  assert.deepEqual(plans.applied, [id(3)]);
});

test('the candidate query scopes by closure, org, reason and cursor, and pages by id', async () => {
  const rows = [
    { id: id(5), org_id: ORG_ID, metadata: flagged(['attendance_unresolved']) },
    { id: id(6), org_id: ORG_ID, metadata: flagged(['attendance_unresolved']) },
  ];
  const client = createCandidateClient(rows);
  const plans = fakePlans({ [id(5)]: unchangedPlan(id(5), ['attendance_unresolved']), [id(6)]: unchangedPlan(id(6), ['attendance_unresolved']) });

  const hmoScoped = await runLessonClosureResyncBatch(
    client,
    normalizeLessonClosureResyncRequest({ mode: 'preview', org_id: ORG_ID, cursor: id(4), limit: 2 }).request,
    { plan: plans.plan, apply: plans.apply },
  );

  assert.deepEqual(client.calls, [
    ['from', 'lesson_instances'],
    ['select', 'id, org_id, metadata'],
    ['eq', 'is_closed', false],
    ['eq', 'org_id', ORG_ID],
    ['contains', 'metadata', { workflow_state: { reasons_open: ['hmo_claim_unresolved'] } }],
    ['gt', 'id', id(4)],
    ['order', 'id', { ascending: true }],
    ['limit', 2],
  ]);
  assert.equal(hmoScoped.next_cursor, id(6), 'a full page continues from its last id');

  const allClient = createCandidateClient(rows);
  await runLessonClosureResyncBatch(
    allClient,
    normalizeLessonClosureResyncRequest({ mode: 'preview', scope: 'open_reasons' }).request,
    { plan: plans.plan, apply: plans.apply },
  );
  assert.ok(!allClient.calls.some(([method]) => method === 'contains'), 'open_reasons does not filter by reason');
  assert.ok(!allClient.calls.some(([method, column]) => method === 'eq' && column === 'org_id'), 'no org filter means all orgs');
});
