/* eslint-env node */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { evaluateLessonClosureState, syncLessonClosureState } from './calendar-workflow.js';

// ---------------------------------------------------------------------------
// Minimal in-memory tenant client for loadLessonWorkflowState/syncLessonClosureState.
//
// Rows are stored "jsonb-style": every write is round-tripped through JSON and
// object keys are re-ordered the way Postgres jsonb stores them (shorter keys
// first, then bytewise). That ordering differs from the order the code builds
// metadata.workflow_state in, which is exactly what the change-detection must
// tolerate. Reads return deep copies so the code under test never aliases the
// store. Every update() is recorded; updating lesson_instances bumps `version`
// the way the DB trigger does.
// ---------------------------------------------------------------------------

function compareJsonbKeys(left, right) {
  if (left.length !== right.length) return left.length - right.length;
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function reorderLikeJsonb(value) {
  if (Array.isArray(value)) return value.map(reorderLikeJsonb);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort(compareJsonbKeys).reduce((ordered, key) => {
      ordered[key] = reorderLikeJsonb(value[key]);
      return ordered;
    }, {});
  }
  return value;
}

function toStoredRow(row) {
  return reorderLikeJsonb(JSON.parse(JSON.stringify(row)));
}

class MockQuery {
  constructor(client, table) {
    this._client = client;
    this._table = table;
    this._filters = [];
    this._filterLog = [];
    this._updatePayload = null;
    this._single = false;
  }

  select() { return this; }
  order() { return this; }

  eq(column, value) {
    this._filters.push((row) => row[column] === value);
    this._filterLog.push(['eq', column, value]);
    return this;
  }

  in(column, values) {
    this._filters.push((row) => values.includes(row[column]));
    this._filterLog.push(['in', column, values]);
    return this;
  }

  update(payload) {
    this._updatePayload = payload;
    return this;
  }

  maybeSingle() {
    this._single = true;
    return this;
  }

  then(resolve, reject) {
    return Promise.resolve().then(() => this._execute()).then(resolve, reject);
  }

  _matchingRows() {
    const rows = this._client.tables[this._table] || [];
    return rows.filter((row) => this._filters.every((predicate) => predicate(row)));
  }

  _execute() {
    if (this._updatePayload !== null) {
      this._client.updates.push({
        table: this._table,
        payload: structuredClone(this._updatePayload),
        filters: this._filterLog.slice(),
      });
      const stored = toStoredRow(this._updatePayload);
      for (const row of this._matchingRows()) {
        Object.assign(row, stored);
        if (this._table === 'lesson_instances') {
          row.version = (row.version || 0) + 1;
        }
      }
      return { data: null, error: null };
    }

    const rows = this._matchingRows().map((row) => structuredClone(row));
    if (this._single) {
      return { data: rows[0] || null, error: null };
    }
    return { data: rows, error: null };
  }
}

function createWorkflowMockClient(seed) {
  const client = {
    tables: {},
    updates: [],
    from(table) {
      if (!client.tables[table]) client.tables[table] = [];
      return new MockQuery(client, table);
    },
  };
  for (const [table, rows] of Object.entries(seed)) {
    client.tables[table] = rows.map(toStoredRow);
  }
  return client;
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const ORG_ID = 'org-closure';
const INSTANCE_ID = 'instance-closure-1';
const PARTICIPANT_A = 'participant-a';
const PARTICIPANT_B = 'participant-b';
const ACTOR_USER_ID = 'user-admin';
const STALE_EVALUATED_AT = '2026-01-01T00:00:00.000Z';
const SCHEDULING_OVERRIDE = {
  reason: 'manual_move',
  original_datetime_start: '2026-04-26T12:00:00.000Z',
};

const RESULT_KEYS = ['is_closed', 'lesson_instance_id', 'participants', 'reasons_open', 'summary'];
const SUMMARY_KEYS = [
  'all_attendance_resolved',
  'all_hmo_resolved',
  'all_student_billing_resolved',
  'finalized_payroll_run_ids',
  'has_payroll_lock',
  'hmo_claim_required',
  'instructor_compensation_required',
  'instructor_compensation_resolved',
  'lesson_earning_exists',
  'settled_claim_batch_ids',
  'student_billing_required',
];
const PARTICIPANT_EVALUATION_KEYS = [
  'attendance_resolved',
  'hmo_claim_required',
  'hmo_claim_resolved',
  'instructor_compensation_required',
  'participant_id',
  'participant_status',
  'student_billing_amount',
  'student_billing_required',
  'student_billing_resolved',
];

function makeClient() {
  return createWorkflowMockClient({
    lesson_instances: [{
      id: INSTANCE_ID,
      org_id: ORG_ID,
      status: 'scheduled',
      is_closed: false,
      closed_at: null,
      closed_by: null,
      datetime_start: '2026-04-26T13:30:00.000Z',
      duration_minutes: 30,
      instructor_employee_id: 'employee-1',
      service_id: 'svc-therapy',
      version: 1,
      // No workflow_state yet: the lesson has never been evaluated.
      metadata: {
        generated_from_template: true,
        scheduling_override: SCHEDULING_OVERRIDE,
      },
    }],
    lesson_participants: [
      {
        id: PARTICIPANT_A,
        org_id: ORG_ID,
        lesson_instance_id: INSTANCE_ID,
        student_id: 'student-a',
        participant_status: 'scheduled',
        metadata: {},
      },
      {
        id: PARTICIPANT_B,
        org_id: ORG_ID,
        lesson_instance_id: INSTANCE_ID,
        student_id: 'student-b',
        participant_status: 'scheduled',
        metadata: {},
      },
    ],
    Settings: [],
    instance_locks: [],
    participant_locks: [],
    lesson_earnings: [],
    ledger_transactions: [],
    dashboard_tasks: [],
  });
}

function storedInstance(client) {
  return client.tables.lesson_instances.find((row) => row.id === INSTANCE_ID);
}

function lessonInstanceUpdates(client) {
  return client.updates.filter((entry) => entry.table === 'lesson_instances');
}

function assertResultShape(result) {
  assert.deepEqual(Object.keys(result).sort(), RESULT_KEYS);
  assert.equal(result.lesson_instance_id, INSTANCE_ID);
  assert.equal(typeof result.is_closed, 'boolean');
  assert.ok(Array.isArray(result.reasons_open));
  assert.deepEqual(Object.keys(result.summary).sort(), SUMMARY_KEYS);
  assert.ok(Array.isArray(result.participants));
  assert.equal(result.participants.length, 2);
  for (const entry of result.participants) {
    assert.deepEqual(Object.keys(entry).sort(), PARTICIPANT_EVALUATION_KEYS);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('syncLessonClosureState change detection', () => {
  it('writes once, including evaluated_at, when no workflow_state is stored yet', async () => {
    const client = makeClient();

    await syncLessonClosureState(client, INSTANCE_ID, ACTOR_USER_ID);

    const updates = lessonInstanceUpdates(client);
    assert.equal(updates.length, 1);
    const [{ payload, filters }] = updates;
    assert.deepEqual(filters, [['eq', 'id', INSTANCE_ID]]);
    assert.deepEqual(Object.keys(payload).sort(), ['closed_at', 'closed_by', 'is_closed', 'metadata']);
    assert.equal(payload.is_closed, false);
    assert.equal(payload.closed_at, null);
    assert.equal(payload.closed_by, null);

    const workflowState = payload.metadata.workflow_state;
    assert.equal(typeof workflowState.evaluated_at, 'string');
    assert.ok(!Number.isNaN(Date.parse(workflowState.evaluated_at)));
    assert.deepEqual(workflowState.reasons_open, ['attendance_unresolved']);
    assert.deepEqual(
      workflowState.participants.map((entry) => entry.participant_id),
      [PARTICIPANT_A, PARTICIPANT_B],
    );
    assert.deepEqual(payload.metadata.scheduling_override, SCHEDULING_OVERRIDE);
    assert.equal(payload.metadata.generated_from_template, true);
    assert.equal(storedInstance(client).version, 2);
  });

  it('does not write when nothing changed, despite jsonb key order, reversed participants and a stale evaluated_at', async () => {
    const client = makeClient();
    await syncLessonClosureState(client, INSTANCE_ID, ACTOR_USER_ID);
    const [firstUpdate] = lessonInstanceUpdates(client);
    const builtWorkflowState = firstUpdate.payload.metadata.workflow_state;

    const stored = storedInstance(client);
    const storedWorkflowState = stored.metadata.workflow_state;
    storedWorkflowState.participants.reverse();
    storedWorkflowState.evaluated_at = STALE_EVALUATED_AT;

    // Preconditions: the stored state really differs in ordering from what the code builds,
    // so a naive JSON.stringify comparison would report a change.
    assert.notDeepEqual(Object.keys(storedWorkflowState), Object.keys(builtWorkflowState));
    assert.notDeepEqual(Object.keys(storedWorkflowState.summary), Object.keys(builtWorkflowState.summary));
    assert.notDeepEqual(
      Object.keys(storedWorkflowState.participants[0]),
      Object.keys(builtWorkflowState.participants[0]),
    );
    assert.deepEqual(
      storedWorkflowState.participants.map((entry) => entry.participant_id),
      [PARTICIPANT_B, PARTICIPANT_A],
    );
    assert.notEqual(
      JSON.stringify(storedWorkflowState),
      JSON.stringify({ ...builtWorkflowState, evaluated_at: STALE_EVALUATED_AT }),
    );

    client.updates.length = 0;
    const versionBefore = stored.version;

    const result = await syncLessonClosureState(client, INSTANCE_ID, ACTOR_USER_ID);

    assert.equal(lessonInstanceUpdates(client).length, 0);
    assert.equal(storedInstance(client).version, versionBefore);
    assert.equal(storedInstance(client).metadata.workflow_state.evaluated_at, STALE_EVALUATED_AT);
    assert.equal(result.is_closed, false);
  });

  it('writes once with a fresh evaluated_at and preserves unrelated metadata when a participant becomes attended', async () => {
    const client = makeClient();
    await syncLessonClosureState(client, INSTANCE_ID, ACTOR_USER_ID);

    const stored = storedInstance(client);
    stored.metadata.workflow_state.evaluated_at = STALE_EVALUATED_AT;
    const participantA = client.tables.lesson_participants.find((row) => row.id === PARTICIPANT_A);
    participantA.participant_status = 'attended';
    client.updates.length = 0;
    const versionBefore = stored.version;

    await syncLessonClosureState(client, INSTANCE_ID, ACTOR_USER_ID);

    const updates = lessonInstanceUpdates(client);
    assert.equal(updates.length, 1);
    const { payload } = updates[0];
    const workflowState = payload.metadata.workflow_state;

    assert.notEqual(workflowState.evaluated_at, STALE_EVALUATED_AT);
    assert.ok(Date.parse(workflowState.evaluated_at) > Date.parse(STALE_EVALUATED_AT));

    const evaluationA = workflowState.participants.find((entry) => entry.participant_id === PARTICIPANT_A);
    assert.equal(evaluationA.participant_status, 'attended');
    assert.equal(evaluationA.attendance_resolved, true);

    // Participant B is still scheduled, so the lesson stays open; only workflow_state changed.
    assert.equal(payload.is_closed, false);
    assert.deepEqual(workflowState.reasons_open, ['attendance_unresolved']);

    assert.deepEqual(payload.metadata.scheduling_override, SCHEDULING_OVERRIDE);
    assert.equal(payload.metadata.generated_from_template, true);
    assert.deepEqual(storedInstance(client).metadata.scheduling_override, SCHEDULING_OVERRIDE);
    assert.equal(storedInstance(client).version, versionBefore + 1);
  });

  it('returns the same result shape whether or not it writes', async () => {
    const client = makeClient();

    const firstResult = await syncLessonClosureState(client, INSTANCE_ID, ACTOR_USER_ID);
    assertResultShape(firstResult);
    assert.equal(firstResult.is_closed, false);
    assert.deepEqual(firstResult.reasons_open, ['attendance_unresolved']);
    assert.deepEqual(
      firstResult.participants,
      lessonInstanceUpdates(client)[0].payload.metadata.workflow_state.participants,
    );

    client.updates.length = 0;
    const unchangedResult = await syncLessonClosureState(client, INSTANCE_ID, ACTOR_USER_ID);
    assert.equal(lessonInstanceUpdates(client).length, 0);
    assertResultShape(unchangedResult);
    assert.deepEqual(unchangedResult, firstResult);

    client.tables.lesson_participants.find((row) => row.id === PARTICIPANT_A).participant_status = 'attended';
    const changedResult = await syncLessonClosureState(client, INSTANCE_ID, ACTOR_USER_ID);
    assert.equal(lessonInstanceUpdates(client).length, 1);
    assertResultShape(changedResult);
  });
});

// One attended participant; calendar-attendance always stores hmo_claim.decision = 'pending' on attend.
function attendedClosureState({ decision = 'pending', ledgerRows = [], openHmoTask = null } = {}) {
  return {
    instance: { id: INSTANCE_ID, status: 'scheduled' },
    participants: [{
      id: PARTICIPANT_A,
      participant_status: 'attended',
      metadata: { workflow: { hmo_claim: { decision, reason: 'attended' } } },
    }],
    policies: { billingConsumptionPolicy: {} },
    instanceLocks: [],
    participantLocks: [],
    participantLocksByParticipant: new Map(),
    lessonEarnings: [],
    ledgerRowsByParticipant: new Map([[PARTICIPANT_A, ledgerRows]]),
    openHmoTaskByParticipant: openHmoTask ? new Map([[PARTICIPANT_A, openHmoTask]]) : new Map(),
    payrollRunById: new Map(),
    claimBatchById: new Map(),
  };
}

describe('evaluateLessonClosureState HMO claim requirement', () => {
  it('does not require a claim for an attended participant without HMO coverage, despite the stored "pending"', () => {
    const result = evaluateLessonClosureState(attendedClosureState());
    assert.equal(result.participants[0].hmo_claim_required, false);
    assert.equal(result.summary.hmo_claim_required, false);
    assert.ok(!result.reasons_open.includes('hmo_claim_unresolved'));
  });

  it('requires a claim when the lesson produced an HMO ledger row', () => {
    const result = evaluateLessonClosureState(attendedClosureState({
      ledgerRows: [{ direction: 'DEBIT', amount: 15000, hmo_provider_id: 'provider-1' }],
    }));
    assert.equal(result.participants[0].hmo_claim_required, true);
    assert.ok(result.reasons_open.includes('hmo_claim_unresolved'));
  });

  it('requires a claim while an HMO claim submission task is open', () => {
    const result = evaluateLessonClosureState(attendedClosureState({
      openHmoTask: { id: 'task-1', task_type: 'hmo_claim_submission' },
    }));
    assert.equal(result.participants[0].hmo_claim_required, true);
    assert.ok(result.reasons_open.includes('hmo_claim_unresolved'));
  });

  it('honours an explicit "required" decision', () => {
    const result = evaluateLessonClosureState(attendedClosureState({ decision: 'required' }));
    assert.equal(result.participants[0].hmo_claim_required, true);
    assert.ok(result.reasons_open.includes('hmo_claim_unresolved'));
  });
});
