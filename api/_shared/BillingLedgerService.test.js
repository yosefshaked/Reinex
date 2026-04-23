// @ts-check
/* eslint-env node */
import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';

import BillingLedgerService, {
  buildDesiredChargeDescriptors,
  extractActiveLedgerAmounts,
} from './BillingLedgerService.js';

// ---------------------------------------------------------------------------
// In-memory Supabase client mock
// ---------------------------------------------------------------------------

class MockTable {
  constructor(store, tableName) {
    this._store = store;
    this._table = tableName;
    this._filters = [];
    this._selectedColumns = null;
    this._insertPayload = null;
    this._upsertPayload = null;
    this._upsertOptions = null;
    this._updatePayload = null;
    this._deleteMode = false;
    this._singleMode = false;
    this._maybeSingleMode = false;
    this._orderBy = [];
    this._limitN = null;
    this._inFilters = [];
    this._isFilters = [];
    this._gteFilters = [];
    this._lteFilters = [];
    this._notFilters = [];
  }

  select(cols) { this._selectedColumns = cols; return this; }
  insert(payload) { this._insertPayload = payload; return this; }
  upsert(payload, opts) { this._upsertPayload = payload; this._upsertOptions = opts || {}; return this; }
  update(payload) { this._updatePayload = payload; return this; }
  delete() { this._deleteMode = true; return this; }
  single() { this._singleMode = true; return this._execute(); }
  maybeSingle() { this._maybeSingleMode = true; return this._execute(); }
  eq(col, val) { this._filters.push({ col, val }); return this; }
  in(col, vals) { this._inFilters.push({ col, vals }); return this; }
  is(col, val) { this._isFilters.push({ col, val }); return this; }
  gte(col, val) { this._gteFilters.push({ col, val }); return this; }
  lte(col, val) { this._lteFilters.push({ col, val }); return this; }
  not(col, op, val) { this._notFilters.push({ col, op, val }); return this; }
  order() { return this; }
  limit(n) { this._limitN = n; return this; }
  filter(col, op, val) { this._filters.push({ col, val, op }); return this; }

  then(resolve) { return Promise.resolve(this._execute()).then(resolve); }

  _execute() {
    const rows = this._store[this._table] || [];

    if (this._insertPayload !== null) {
      const items = Array.isArray(this._insertPayload) ? this._insertPayload : [this._insertPayload];
      const inserted = items.map((item) => ({ id: `uuid-${Math.random().toString(36).slice(2)}`, ...item }));
      this._store[this._table] = [...rows, ...inserted];
      if (this._singleMode) {
        return { data: inserted[0], error: null };
      }
      // batch insert returns array
      return { data: inserted, error: null };
    }

    if (this._upsertPayload !== null) {
      const items = Array.isArray(this._upsertPayload) ? this._upsertPayload : [this._upsertPayload];
      const results = [];
      for (const item of items) {
        const conflictCol = this._upsertOptions?.onConflict;
        const existingIdx = conflictCol
          ? rows.findIndex((r) => r[conflictCol] === item[conflictCol])
          : -1;
        if (existingIdx >= 0) {
          results.push(rows[existingIdx]);
        } else {
          const newRow = { id: `uuid-${Math.random().toString(36).slice(2)}`, ...item };
          this._store[this._table] = [...this._store[this._table], newRow];
          results.push(newRow);
        }
      }
      this._store[this._table] = this._store[this._table] || rows;
      if (this._singleMode) {
        return { data: results[0] || null, error: null };
      }
      return { data: results, error: null };
    }

    if (this._updatePayload !== null) {
      const updated = this._applyFilters(this._store[this._table] || []);
      this._store[this._table] = (this._store[this._table] || []).map((r) => {
        if (updated.includes(r)) {
          return { ...r, ...this._updatePayload };
        }
        return r;
      });
      return { data: null, error: null };
    }

    if (this._deleteMode) {
      const toDelete = this._applyFilters(this._store[this._table] || []);
      this._store[this._table] = (this._store[this._table] || []).filter((r) => !toDelete.includes(r));
      return { data: null, error: null };
    }

    let result = this._applyFilters(rows);
    if (this._limitN !== null) {
      result = result.slice(0, this._limitN);
    }

    if (this._maybeSingleMode) {
      return { data: result[0] || null, error: null };
    }
    if (this._singleMode) {
      return { data: result[0] || null, error: null };
    }
    return { data: result, error: null };
  }

  _applyFilters(rows) {
    let result = rows;
    for (const { col, val } of this._filters) {
      result = result.filter((r) => r[col] === val);
    }
    for (const { col, vals } of this._inFilters) {
      result = result.filter((r) => vals.includes(r[col]));
    }
    for (const { col, val } of this._isFilters) {
      if (val === null) {
        result = result.filter((r) => r[col] == null);
      } else {
        result = result.filter((r) => r[col] === val);
      }
    }
    for (const { col, val } of this._gteFilters) {
      result = result.filter((r) => String(r[col] ?? '') >= String(val));
    }
    for (const { col, val } of this._lteFilters) {
      result = result.filter((r) => String(r[col] ?? '') <= String(val));
    }
    for (const { col, op, val } of this._notFilters) {
      if (op === 'is' && val === null) {
        result = result.filter((r) => r[col] != null);
      }
    }
    return result;
  }
}

function createMockClient(initialStore = {}) {
  const store = {
    ledger_accounts: [],
    ledger_transactions: [],
    hmo_invoice_batches: [],
    hmo_invoice_batch_items: [],
    students: [makeStudent()],
    lesson_participants: [],
    lesson_instances: [],
    Services: [],
    hmo_authorizations: [],
    hmo_providers: [],
    client_profiles: [{ id: 'client-1', first_name: 'Avi', middle_name: null, last_name: 'Cohen' }],
    finance_policies: [],
    participant_locks: [],
    dashboard_tasks: [],
    ...initialStore,
  };

  for (const [tableName, rows] of Object.entries(store)) {
    if (!Array.isArray(rows)) continue;
    store[tableName] = rows.map((row) => {
      if (row && typeof row === 'object' && !Object.prototype.hasOwnProperty.call(row, 'org_id')) {
        return { org_id: 'org-1', ...row };
      }
      return row;
    });
  }

  return {
    _store: store,
    from(tableName) {
      return new MockTable(store, tableName);
    },
    rpc() {
      return Promise.resolve({ data: null, error: null });
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers to seed test data
// ---------------------------------------------------------------------------

const FIXED_CLOCK = () => '2025-06-01T10:00:00.000Z';
const FIXED_DATE = '2025-06-01T09:00:00.000Z';

function makeService(overrides = {}) {
  return {
    id: 'svc-1',
    org_id: 'org-1',
    name: 'Physio',
    color: '#fff',
    default_customer_charge_amount: 5000,
    is_active: true,
    ...overrides,
  };
}

function makeStudent(overrides = {}) {
  return {
    id: 'student-1',
    org_id: 'org-1',
    client_profile_id: 'client-1',
    client_profile: { id: 'client-1', first_name: 'Avi', middle_name: null, last_name: 'Cohen' },
    ...overrides,
  };
}

function makeInstance(overrides = {}) {
  return {
    id: 'instance-1',
    org_id: 'org-1',
    service_id: 'svc-1',
    datetime_start: FIXED_DATE,
    status: 'completed',
    is_closed: false,
    metadata: {},
    ...overrides,
  };
}

function makeParticipant(overrides = {}) {
  return {
    id: 'part-1',
    org_id: 'org-1',
    lesson_instance_id: 'instance-1',
    client_profile_id: 'client-1',
    student_id: 'student-1',
    participant_status: 'attended',
    metadata: {},
    client_profile: { id: 'client-1', first_name: 'Avi', middle_name: null, last_name: 'Cohen' },
    lesson_instance: makeInstance(),
    ...overrides,
  };
}

function makeAuthorization(overrides = {}) {
  return {
    id: 'auth-1',
    org_id: 'org-1',
    student_id: 'student-1',
    service_id: 'svc-1',
    provider_id: 'hmo-1',
    provider_track_id: 'track-1',
    authorization_reference: 'AUTH-001',
    authorized_lessons: 10,
    valid_from: '2025-01-01',
    expires_at: '2025-12-31',
    covered_customer_charge_amount: 3000,
    covered_insurer_claim_amount: 2000,
    post_coverage_policy: 'service_default',
    post_coverage_customer_charge_amount: null,
    status: 'active',
    notes: null,
    metadata: {},
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    reminder_date: null,
    student: { client_profile_id: 'client-1' },
    ...overrides,
  };
}

function makeFinancePolicies() {
  return [{
    id: 'pol-1',
    billing_consumption_policy: {
      attended: true,
      no_show: true,
      cancelled_student: false,
      cancelled_clinic: false,
    },
  }];
}

// ---------------------------------------------------------------------------
// buildDesiredChargeDescriptors — pure unit tests
// ---------------------------------------------------------------------------

describe('buildDesiredChargeDescriptors', () => {
  const basePolicies = {
    billingConsumptionPolicy: {
      attended: true,
      no_show: true,
      cancelled_student: false,
      cancelled_clinic: false,
    },
  };

  it('returns noop for unresolved participant status', () => {
    const result = buildDesiredChargeDescriptors({
      participant: makeParticipant({ participant_status: 'scheduled' }),
      service: makeService(),
      coverageDecision: null,
      policies: basePolicies,
    });
    assert.equal(result.status, 'noop');
    assert.equal(result.billingReason, 'participant_not_resolved');
    assert.deepEqual(result.entries, []);
  });

  it('returns noop when policy excludes the status', () => {
    const result = buildDesiredChargeDescriptors({
      participant: makeParticipant({ participant_status: 'cancelled_student' }),
      service: makeService(),
      coverageDecision: null,
      policies: basePolicies,
    });
    assert.equal(result.status, 'noop');
    assert.equal(result.billingReason, 'policy_excluded_status');
  });

  it('returns blocked when service has no default_customer_charge_amount', () => {
    const result = buildDesiredChargeDescriptors({
      participant: makeParticipant(),
      service: makeService({ default_customer_charge_amount: null }),
      coverageDecision: null,
      policies: basePolicies,
    });
    assert.equal(result.status, 'blocked');
    assert.equal(result.billingReason, 'missing_service_default_customer_charge_amount');
  });

  it('returns blocked when participant has no client_profile_id', () => {
    const result = buildDesiredChargeDescriptors({
      participant: makeParticipant({ client_profile_id: null }),
      service: makeService(),
      coverageDecision: null,
      policies: basePolicies,
    });
    assert.equal(result.status, 'blocked');
    assert.equal(result.billingReason, 'missing_client_profile_id');
  });

  it('direct-client charge — no student_id → single client_profile debit', () => {
    const result = buildDesiredChargeDescriptors({
      participant: makeParticipant({ student_id: null }),
      service: makeService(),
      coverageDecision: null,
      policies: basePolicies,
    });
    assert.equal(result.status, 'debited');
    assert.equal(result.billingReason, 'direct_client_charge');
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].accountType, 'client_profile');
    assert.equal(result.entries[0].amount, 5000);
    assert.equal(result.entries[0].rateSource, 'service_rate');
  });

  it('student service-rate charge — no authorization → single student debit at full rate', () => {
    const result = buildDesiredChargeDescriptors({
      participant: makeParticipant(),
      service: makeService(),
      coverageDecision: null,
      policies: basePolicies,
    });
    assert.equal(result.status, 'debited');
    assert.equal(result.billingReason, 'service_rate_charge');
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].accountType, 'student');
    assert.equal(result.entries[0].amount, 5000);
  });

  it('HMO split — student copay + HMO debit', () => {
    const result = buildDesiredChargeDescriptors({
      participant: makeParticipant(),
      service: makeService({ default_customer_charge_amount: 5000 }),
      coverageDecision: {
        status: 'covered',
        reason: 'authorization_applies',
        authorization_id: 'auth-1',
        authorization: makeAuthorization(),
        covered_customer_charge_amount: 3000,
        covered_insurer_claim_amount: 2000,
      },
      policies: basePolicies,
    });
    assert.equal(result.status, 'debited');
    assert.equal(result.billingReason, 'covered_hmo_charge');
    assert.equal(result.entries.length, 2);
    const studentEntry = result.entries.find((e) => e.accountType === 'student');
    const hmoEntry = result.entries.find((e) => e.accountType === 'hmo_provider');
    assert.ok(studentEntry, 'student entry missing');
    assert.ok(hmoEntry, 'hmo entry missing');
    assert.equal(studentEntry.amount, 3000); // 5000 - 2000
    assert.equal(hmoEntry.amount, 2000);
    assert.equal(studentEntry.rateSource, 'hmo_authorization');
    assert.equal(hmoEntry.rateSource, 'hmo_authorization');
  });

  it('HMO split — copay floored at zero when contracted_rate >= service_rate', () => {
    const result = buildDesiredChargeDescriptors({
      participant: makeParticipant(),
      service: makeService({ default_customer_charge_amount: 2000 }),
      coverageDecision: {
        status: 'covered',
        reason: 'authorization_applies',
        authorization_id: 'auth-1',
        authorization: makeAuthorization(),
        covered_customer_charge_amount: 0,
        covered_insurer_claim_amount: 3000,
      },
      policies: basePolicies,
    });
    assert.equal(result.entries.length, 1);
    const hmoEntry = result.entries[0];
    assert.equal(hmoEntry.accountType, 'hmo_provider');
    assert.equal(hmoEntry.amount, 3000);
  });

  it('post coverage explicit amount charges the student only', () => {
    const result = buildDesiredChargeDescriptors({
      participant: makeParticipant(),
      service: makeService(),
      coverageDecision: {
        status: 'post_coverage',
        reason: 'authorization_exhausted',
        authorization_id: 'auth-1',
        authorization: makeAuthorization(),
        post_coverage_policy: 'explicit_customer_charge',
        post_coverage_customer_charge_amount: 13000,
      },
      policies: basePolicies,
    });
    assert.equal(result.status, 'debited');
    assert.equal(result.billingReason, 'post_coverage_explicit_customer_charge');
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].amount, 13000);
  });
});

// ---------------------------------------------------------------------------
// extractActiveLedgerAmounts — pure unit tests
// ---------------------------------------------------------------------------

describe('extractActiveLedgerAmounts', () => {
  it('sums debits and credits correctly', () => {
    const rows = [
      { direction: 'DEBIT', amount: 5000 },
      { direction: 'CREDIT', amount: 3000 },
    ];
    const result = extractActiveLedgerAmounts(rows);
    assert.equal(result.debit, 5000);
    assert.equal(result.credit, 3000);
    assert.equal(result.net, -2000);
  });

  it('returns zeros for empty input', () => {
    const result = extractActiveLedgerAmounts([]);
    assert.equal(result.net, 0);
  });

  it('handles non-array gracefully', () => {
    const result = extractActiveLedgerAmounts(null);
    assert.equal(result.net, 0);
  });
});

// ---------------------------------------------------------------------------
// BillingLedgerService.getAccountBalance
// ---------------------------------------------------------------------------

describe('BillingLedgerService.getAccountBalance', () => {
  it('throws on invalid asOf', async () => {
    const client = createMockClient();
    const service = new BillingLedgerService({ tenantClient: client, orgId: 'org-1', clock: FIXED_CLOCK });
    await assert.rejects(
      () => service.getAccountBalance({ accountType: 'student', accountRefId: 'student-1', asOf: 'not-a-date' }),
      /invalid_asOf_date/,
    );
  });

  it('computes correct balance from DEBIT/CREDIT mix', async () => {
    const client = createMockClient({
      ledger_accounts: [{ id: 'acct-1', account_type: 'student', student_id: 'student-1', client_profile_id: null, hmo_provider_id: null, is_active: true, metadata: {} }],
      ledger_transactions: [
        { id: 't1', ledger_account_id: 'acct-1', student_id: 'student-1', direction: 'CREDIT', amount: 10000, effective_at: '2025-01-01T00:00:00Z' },
        { id: 't2', ledger_account_id: 'acct-1', student_id: 'student-1', direction: 'DEBIT', amount: 3000, effective_at: '2025-02-01T00:00:00Z' },
      ],
    });
    const service = new BillingLedgerService({ tenantClient: client, orgId: 'org-1', clock: FIXED_CLOCK });
    const { balance } = await service.getAccountBalance({ accountType: 'student', accountRefId: 'student-1' });
    assert.equal(balance, 7000); // 10000 - 3000
  });
});

// ---------------------------------------------------------------------------
// BillingLedgerService.appendManualCredit / appendManualDebit
// ---------------------------------------------------------------------------

describe('BillingLedgerService.appendManualCredit', () => {
  it('throws on invalid source type', async () => {
    const client = createMockClient();
    const service = new BillingLedgerService({ tenantClient: client, orgId: 'org-1', clock: FIXED_CLOCK });
    await assert.rejects(
      () => service.appendManualCredit({ accountType: 'student', accountRefId: 's1', amount: 1000, effectiveAt: FIXED_DATE, actorUserId: 'u1', sourceType: 'manual_adjustment' }),
      /invalid_manual_credit_source_type/,
    );
  });

  it('throws on zero amount', async () => {
    const client = createMockClient();
    const service = new BillingLedgerService({ tenantClient: client, orgId: 'org-1', clock: FIXED_CLOCK });
    await assert.rejects(
      () => service.appendManualCredit({ accountType: 'student', accountRefId: 's1', amount: 0, effectiveAt: FIXED_DATE, actorUserId: 'u1', sourceType: 'manual_payment' }),
      /amount_must_be_positive_integer/,
    );
  });

  it('throws on negative amount', async () => {
    const client = createMockClient();
    const service = new BillingLedgerService({ tenantClient: client, orgId: 'org-1', clock: FIXED_CLOCK });
    await assert.rejects(
      () => service.appendManualCredit({ accountType: 'student', accountRefId: 's1', amount: -100, effectiveAt: FIXED_DATE, actorUserId: 'u1', sourceType: 'manual_payment' }),
      /amount_must_be_positive_integer/,
    );
  });

  it('student prepaid: credit → debit → balance decreases correctly', async () => {
    const client = createMockClient();
    const service = new BillingLedgerService({ tenantClient: client, orgId: 'org-1', clock: FIXED_CLOCK });

    // Manual payment credit of 10,000
    await service.appendManualCredit({
      accountType: 'student',
      accountRefId: 'student-1',
      amount: 10000,
      effectiveAt: FIXED_DATE,
      actorUserId: 'user-1',
      sourceType: 'manual_payment',
    });

    let { balance } = await service.getAccountBalance({ accountType: 'student', accountRefId: 'student-1' });
    assert.equal(balance, 10000, 'balance after credit');

    // Manual debit of 3,000
    await service.appendManualDebit({
      accountType: 'student',
      accountRefId: 'student-1',
      amount: 3000,
      effectiveAt: FIXED_DATE,
      actorUserId: 'user-1',
      sourceType: 'manual_adjustment',
    });

    ({ balance } = await service.getAccountBalance({ accountType: 'student', accountRefId: 'student-1' }));
    assert.equal(balance, 7000, 'balance after debit');
  });
});

describe('BillingLedgerService.appendManualDebit', () => {
  it('throws on invalid source type', async () => {
    const client = createMockClient();
    const service = new BillingLedgerService({ tenantClient: client, orgId: 'org-1', clock: FIXED_CLOCK });
    await assert.rejects(
      () => service.appendManualDebit({ accountType: 'student', accountRefId: 's1', amount: 1000, effectiveAt: FIXED_DATE, actorUserId: 'u1', sourceType: 'manual_payment' }),
      /invalid_manual_debit_source_type/,
    );
  });

  it('student postpaid: debit first → balance goes negative → credit restores it', async () => {
    const client = createMockClient();
    const service = new BillingLedgerService({ tenantClient: client, orgId: 'org-1', clock: FIXED_CLOCK });

    await service.appendManualDebit({
      accountType: 'student',
      accountRefId: 'student-1',
      amount: 5000,
      effectiveAt: FIXED_DATE,
      actorUserId: 'user-1',
      sourceType: 'manual_adjustment',
    });

    let { balance } = await service.getAccountBalance({ accountType: 'student', accountRefId: 'student-1' });
    assert.equal(balance, -5000, 'balance is negative after debit');

    await service.appendManualCredit({
      accountType: 'student',
      accountRefId: 'student-1',
      amount: 5000,
      effectiveAt: FIXED_DATE,
      actorUserId: 'user-1',
      sourceType: 'manual_payment',
    });

    ({ balance } = await service.getAccountBalance({ accountType: 'student', accountRefId: 'student-1' }));
    assert.equal(balance, 0, 'balance restored after credit');
  });
});

// ---------------------------------------------------------------------------
// BillingLedgerService.reverseTransaction
// ---------------------------------------------------------------------------

describe('BillingLedgerService.reverseTransaction', () => {
  it('throws when transaction does not exist', async () => {
    const client = createMockClient();
    const service = new BillingLedgerService({ tenantClient: client, orgId: 'org-1', clock: FIXED_CLOCK });
    await assert.rejects(
      () => service.reverseTransaction({ transactionId: 'nonexistent', actorUserId: 'u1', reasonCode: 'test' }),
      /transaction_not_reversible/,
    );
  });

  it('is idempotent — returns existing reversal if one already exists', async () => {
    const client = createMockClient({
      ledger_accounts: [{ id: 'acct-1', account_type: 'student', student_id: 's1', client_profile_id: null, hmo_provider_id: null, is_active: true, metadata: {} }],
      ledger_transactions: [
        { id: 'orig-1', ledger_account_id: 'acct-1', direction: 'DEBIT', amount: 5000, source_type: 'manual_payment', effective_at: FIXED_DATE, student_id: 's1', client_profile_id: null, hmo_provider_id: null, hmo_authorization_id: null, service_id: null, rate_source: 'manual', reverses_transaction_id: null },
        { id: 'rev-1', ledger_account_id: 'acct-1', direction: 'CREDIT', amount: 5000, source_type: 'reversal', effective_at: FIXED_DATE, student_id: 's1', client_profile_id: null, hmo_provider_id: null, hmo_authorization_id: null, service_id: null, rate_source: 'manual', reverses_transaction_id: 'orig-1' },
      ],
    });
    const service = new BillingLedgerService({ tenantClient: client, orgId: 'org-1', clock: FIXED_CLOCK });
    const result = await service.reverseTransaction({ transactionId: 'orig-1', actorUserId: 'u1', reasonCode: 'test' });
    assert.equal(result.originalTransactionId, 'orig-1');
    assert.equal(result.reversalTransactionId, 'rev-1');
    // No new transaction was created
    assert.equal(client._store.ledger_transactions.length, 2);
  });

  it('creates a reversal entry with opposite direction', async () => {
    const client = createMockClient({
      ledger_accounts: [{ id: 'acct-1', account_type: 'student', student_id: 's1', client_profile_id: null, hmo_provider_id: null, is_active: true, metadata: {} }],
      ledger_transactions: [
        { id: 'orig-1', ledger_account_id: 'acct-1', direction: 'DEBIT', amount: 5000, source_type: 'manual_payment', effective_at: FIXED_DATE, student_id: 's1', client_profile_id: null, hmo_provider_id: null, hmo_authorization_id: null, service_id: null, rate_source: 'manual', reverses_transaction_id: null },
      ],
    });
    const service = new BillingLedgerService({ tenantClient: client, orgId: 'org-1', clock: FIXED_CLOCK });
    const result = await service.reverseTransaction({ transactionId: 'orig-1', actorUserId: 'u1', reasonCode: 'attendance_changed' });
    assert.ok(result.reversalTransactionId);
    const reversal = client._store.ledger_transactions.find((r) => r.id === result.reversalTransactionId);
    assert.equal(reversal.direction, 'CREDIT');
    assert.equal(reversal.amount, 5000);
    assert.equal(reversal.reverses_transaction_id, 'orig-1');
  });
});

// ---------------------------------------------------------------------------
// BillingLedgerService.syncLessonParticipantCharge
// ---------------------------------------------------------------------------

describe('BillingLedgerService.syncLessonParticipantCharge', () => {
  let client;
  let service;

  beforeEach(() => {
    client = createMockClient({
      students: [makeStudent(), makeStudent({ id: 'student-2', client_profile_id: 'client-2', client_profile: { id: 'client-2', first_name: 'Dana', middle_name: null, last_name: 'Levi' } })],
      client_profiles: [
        { id: 'client-1', first_name: 'Avi', middle_name: null, last_name: 'Cohen' },
        { id: 'client-2', first_name: 'Dana', middle_name: null, last_name: 'Levi' },
      ],
      Services: [makeService()],
      lesson_instances: [makeInstance()],
      lesson_participants: [makeParticipant()],
      finance_policies: makeFinancePolicies(),
      hmo_authorizations: [],
    });
    service = new BillingLedgerService({ tenantClient: client, orgId: 'org-1', clock: FIXED_CLOCK });
  });

  it('returns blocked when participant not found', async () => {
    const result = await service.syncLessonParticipantCharge({
      lessonParticipantId: 'nonexistent',
      actorUserId: 'u1',
      reasonCode: 'attendance_changed',
    });
    assert.equal(result.status, 'blocked');
    assert.ok(result.warnings.includes('lesson_participant_not_found'));
  });

  it('student service-rate charge — creates one debit transaction', async () => {
    const result = await service.syncLessonParticipantCharge({
      lessonParticipantId: 'part-1',
      actorUserId: 'u1',
      reasonCode: 'attendance_changed',
    });
    assert.equal(result.status, 'debited');
    assert.equal(result.createdTransactionIds.length, 1);
    assert.equal(result.reversedTransactionIds.length, 0);
    const tx = client._store.ledger_transactions[0];
    assert.equal(tx.direction, 'DEBIT');
    assert.equal(tx.amount, 5000);
    assert.equal(tx.source_type, 'lesson_charge');
    assert.equal(tx.student_id, 'student-1');
  });

  it('is idempotent — same charge synced twice produces noop on second call', async () => {
    await service.syncLessonParticipantCharge({
      lessonParticipantId: 'part-1',
      actorUserId: 'u1',
      reasonCode: 'attendance_changed',
    });
    const result2 = await service.syncLessonParticipantCharge({
      lessonParticipantId: 'part-1',
      actorUserId: 'u1',
      reasonCode: 'attendance_changed',
    });
    assert.equal(result2.status, 'noop');
    // Still only one transaction in the store
    assert.equal(client._store.ledger_transactions.length, 1);
  });

  it('direct-client charge — no student_id creates client_profile debit', async () => {
    client._store.lesson_participants = [makeParticipant({ student_id: null })];
    const result = await service.syncLessonParticipantCharge({
      lessonParticipantId: 'part-1',
      actorUserId: 'u1',
      reasonCode: 'lesson_updated',
    });
    assert.equal(result.status, 'debited');
    const tx = client._store.ledger_transactions[0];
    assert.equal(tx.direction, 'DEBIT');
    assert.equal(tx.client_profile_id, 'client-1');
    assert.equal(tx.student_id, null);
  });

  it('HMO split — two debits created (student copay + HMO share)', async () => {
    client._store.hmo_authorizations = [makeAuthorization()];
    const result = await service.syncLessonParticipantCharge({
      lessonParticipantId: 'part-1',
      actorUserId: 'u1',
      reasonCode: 'attendance_changed',
    });
    assert.equal(result.status, 'debited');
    assert.equal(result.createdTransactionIds.length, 2);
    const txs = client._store.ledger_transactions;
    const studentTx = txs.find((t) => t.student_id === 'student-1' && t.direction === 'DEBIT');
    const hmoTx = txs.find((t) => t.hmo_provider_id === 'hmo-1');
    assert.ok(studentTx, 'student debit missing');
    assert.ok(hmoTx, 'HMO debit missing');
    assert.equal(studentTx.amount, 3000); // 5000 - 2000
    assert.equal(hmoTx.amount, 2000);
    assert.equal(studentTx.hmo_authorization_id, 'auth-1');
    assert.equal(hmoTx.hmo_authorization_id, 'auth-1');
  });

  it('attendance reversal — original rows remain, reversing credits appended, no mutation', async () => {
    // First sync
    await service.syncLessonParticipantCharge({
      lessonParticipantId: 'part-1',
      actorUserId: 'u1',
      reasonCode: 'attendance_changed',
    });
    const originalTxCount = client._store.ledger_transactions.length;
    const originalTxId = client._store.ledger_transactions[0].id;

    // Cancel participant
    client._store.lesson_participants = [makeParticipant({ participant_status: 'cancelled_clinic' })];

    const result = await service.syncLessonParticipantCharge({
      lessonParticipantId: 'part-1',
      actorUserId: 'u1',
      reasonCode: 'attendance_changed',
    });

    assert.equal(result.status, 'reversed_only', 'should be reversed_only for cancelled_clinic');
    // Original transaction still exists (append-only)
    const originalTx = client._store.ledger_transactions.find((t) => t.id === originalTxId);
    assert.ok(originalTx, 'original transaction must not be deleted');
    // A reversal credit was appended
    assert.equal(client._store.ledger_transactions.length, originalTxCount + 1);
    const reversal = client._store.ledger_transactions.find((t) => t.source_type === 'reversal');
    assert.ok(reversal);
    assert.equal(reversal.direction, 'CREDIT');
    assert.equal(reversal.reverses_transaction_id, originalTxId);
  });

  it('lesson repricing — changes rate → reverses old, creates new debit', async () => {
    // Initial charge at 5000
    await service.syncLessonParticipantCharge({
      lessonParticipantId: 'part-1',
      actorUserId: 'u1',
      reasonCode: 'lesson_updated',
    });

    // Change service rate
    client._store.Services = [makeService({ default_customer_charge_amount: 6000 })];

    const result = await service.syncLessonParticipantCharge({
      lessonParticipantId: 'part-1',
      actorUserId: 'u1',
      reasonCode: 'lesson_updated',
    });

    assert.equal(result.status, 'reversed_and_debited');
    const txs = client._store.ledger_transactions;
    const reversal = txs.find((t) => t.source_type === 'reversal');
    const newDebit = txs.find((t) => t.source_type === 'lesson_charge' && t.amount === 6000);
    assert.ok(reversal, 'reversal must exist');
    assert.ok(newDebit, 'new debit at updated rate must exist');
    assert.equal(txs.length, 3); // original + reversal + new debit
  });
});

// ---------------------------------------------------------------------------
// BillingLedgerService.syncLessonInstanceCharges
// ---------------------------------------------------------------------------

describe('BillingLedgerService.syncLessonInstanceCharges', () => {
  it('processes all participants in an instance', async () => {
    const client = createMockClient({
      students: [
        makeStudent(),
        makeStudent({ id: 'student-2', client_profile_id: 'client-2', client_profile: { id: 'client-2', first_name: 'Dana', middle_name: null, last_name: 'Levi' } }),
      ],
      client_profiles: [
        { id: 'client-1', org_id: 'org-1', first_name: 'Avi', middle_name: null, last_name: 'Cohen' },
        { id: 'client-2', org_id: 'org-1', first_name: 'Dana', middle_name: null, last_name: 'Levi' },
      ],
      Services: [makeService()],
      lesson_instances: [makeInstance()],
      lesson_participants: [
        makeParticipant({ id: 'part-1' }),
        makeParticipant({ id: 'part-2', student_id: 'student-2', client_profile_id: 'client-2' }),
      ],
      finance_policies: makeFinancePolicies(),
      hmo_authorizations: [],
    });
    const service = new BillingLedgerService({ tenantClient: client, orgId: 'org-1', clock: FIXED_CLOCK });

    const result = await service.syncLessonInstanceCharges({
      lessonInstanceId: 'instance-1',
      actorUserId: 'u1',
      reasonCode: 'attendance_changed',
    });

    assert.equal(result.participantResults.length, 2);
    assert.equal(result.createdTransactionCount, 2);
  });
});

// ---------------------------------------------------------------------------
// BillingLedgerService.createHmoInvoiceBatch
// ---------------------------------------------------------------------------

describe('BillingLedgerService.createHmoInvoiceBatch', () => {
  it('throws when hmoProviderId is missing', async () => {
    const client = createMockClient();
    const service = new BillingLedgerService({ tenantClient: client, orgId: 'org-1', clock: FIXED_CLOCK });
    await assert.rejects(
      () => service.createHmoInvoiceBatch({ hmoProviderId: '', actorUserId: 'u1' }),
      /missing_hmo_provider_id/,
    );
  });

  it('creates batch with only eligible (unbatched) debit transactions', async () => {
    const client = createMockClient({
      hmo_providers: [{ id: 'hmo-1', org_id: 'org-1', name: 'Provider', is_active: true }],
      ledger_accounts: [{ id: 'acct-hmo', org_id: 'org-1', account_type: 'hmo_provider', student_id: null, client_profile_id: null, hmo_provider_id: 'hmo-1', is_active: true, metadata: {} }],
      ledger_transactions: [
        { id: 'tx-1', org_id: 'org-1', hmo_provider_id: 'hmo-1', source_type: 'lesson_charge', direction: 'DEBIT', amount: 2000, effective_at: '2025-03-01T00:00:00Z', reverses_transaction_id: null },
        { id: 'tx-2', org_id: 'org-1', hmo_provider_id: 'hmo-1', source_type: 'lesson_charge', direction: 'DEBIT', amount: 2000, effective_at: '2025-04-01T00:00:00Z', reverses_transaction_id: null },
      ],
      hmo_invoice_batches: [
        { id: 'old-batch', org_id: 'org-1', hmo_provider_id: 'hmo-1', status: 'submitted', total_amount: 2000, paid_amount: 0 },
      ],
      hmo_invoice_batch_items: [
        // tx-1 already batched
        { id: 'item-1', org_id: 'org-1', batch_id: 'old-batch', ledger_transaction_id: 'tx-1', amount: 2000 },
      ],
    });
    const service = new BillingLedgerService({ tenantClient: client, orgId: 'org-1', clock: FIXED_CLOCK });
    const result = await service.createHmoInvoiceBatch({
      hmoProviderId: 'hmo-1',
      actorUserId: 'u1',
    });
    assert.equal(result.totalAmount, 2000, 'only tx-2 is eligible');
    assert.deepEqual(result.ledgerTransactionIds, ['tx-2']);
    assert.equal(client._store.hmo_invoice_batch_items.length, 2); // old item + new item
  });

  it('blocks explicitly selected ledger rows from another provider with a clear error', async () => {
    const client = createMockClient({
      hmo_providers: [
        { id: 'hmo-1', org_id: 'org-1', name: 'Provider 1', is_active: true },
        { id: 'hmo-2', org_id: 'org-1', name: 'Provider 2', is_active: true },
      ],
      ledger_transactions: [
        { id: 'tx-1', org_id: 'org-1', hmo_provider_id: 'hmo-2', source_type: 'lesson_charge', direction: 'DEBIT', amount: 2000, effective_at: '2025-03-01T00:00:00Z', reverses_transaction_id: null },
      ],
    });
    const service = new BillingLedgerService({ tenantClient: client, orgId: 'org-1', clock: FIXED_CLOCK });

    await assert.rejects(
      () => service.createHmoInvoiceBatch({
        hmoProviderId: 'hmo-1',
        ledgerTransactionIds: ['tx-1'],
        actorUserId: 'u1',
      }),
      /hmo_claim_provider_mismatch/,
    );
  });

  it('issued HMO invoice batch — balance unchanged until payment is recorded', async () => {
    // Must seed ledger_account_id so getAccountBalance (which queries by ledger_account_id) can find the debit.
    const client = createMockClient({
      hmo_providers: [{ id: 'hmo-1', org_id: 'org-1', name: 'Provider', is_active: true }],
      ledger_accounts: [{ id: 'acct-hmo', org_id: 'org-1', account_type: 'hmo_provider', student_id: null, client_profile_id: null, hmo_provider_id: 'hmo-1', is_active: true, metadata: {} }],
      ledger_transactions: [
        { id: 'tx-1', org_id: 'org-1', ledger_account_id: 'acct-hmo', client_profile_id: 'anchor-client', hmo_provider_id: 'hmo-1', source_type: 'lesson_charge', direction: 'DEBIT', amount: 2000, effective_at: '2025-03-01T00:00:00Z', reverses_transaction_id: null },
      ],
    });
    const service = new BillingLedgerService({ tenantClient: client, orgId: 'org-1', clock: FIXED_CLOCK });

    const { batchId } = await service.createHmoInvoiceBatch({ hmoProviderId: 'hmo-1', actorUserId: 'u1' });
    await service.submitHmoInvoiceBatch({ batchId, actorUserId: 'u1' });

    // Balance still -2000 (only debit, no payment yet)
    const { balance: balanceBefore } = await service.getAccountBalance({ accountType: 'hmo_provider', accountRefId: 'hmo-1' });
    assert.equal(balanceBefore, -2000);

    // Record payment
    await service.recordHmoInvoiceBatchPayment({
      batchId,
      amount: 2000,
      effectiveAt: FIXED_DATE,
      actorUserId: 'u1',
    });

    const { balance: balanceAfter } = await service.getAccountBalance({ accountType: 'hmo_provider', accountRefId: 'hmo-1' });
    assert.equal(balanceAfter, 0, 'balance resolves after payment');

    const batch = client._store.hmo_invoice_batches.find((b) => b.id === batchId);
    assert.equal(batch.status, 'paid');
    assert.equal(batch.paid_amount, 2000);
  });

  it('requires payment reference when provider policy requires it', async () => {
    const client = createMockClient({
      hmo_providers: [{ id: 'hmo-1', org_id: 'org-1', name: 'Provider', is_active: true, claim_reference_required: true }],
      ledger_accounts: [{ id: 'acct-hmo', org_id: 'org-1', account_type: 'hmo_provider', student_id: null, client_profile_id: null, hmo_provider_id: 'hmo-1', is_active: true, metadata: {} }],
      ledger_transactions: [
        { id: 'tx-1', org_id: 'org-1', ledger_account_id: 'acct-hmo', client_profile_id: 'anchor-client', hmo_provider_id: 'hmo-1', source_type: 'lesson_charge', direction: 'DEBIT', amount: 2000, effective_at: '2025-03-01T00:00:00Z', reverses_transaction_id: null },
      ],
    });
    const service = new BillingLedgerService({ tenantClient: client, orgId: 'org-1', clock: FIXED_CLOCK });
    const { batchId } = await service.createHmoInvoiceBatch({ hmoProviderId: 'hmo-1', actorUserId: 'u1' });
    await service.submitHmoInvoiceBatch({ batchId, actorUserId: 'u1' });

    await assert.rejects(
      () => service.recordHmoInvoiceBatchPayment({
        batchId,
        amount: 2000,
        effectiveAt: FIXED_DATE,
        actorUserId: 'u1',
      }),
      /hmo_payment_reference_required/,
    );
  });

  it('blocks payment above open batch balance', async () => {
    const client = createMockClient({
      hmo_providers: [{ id: 'hmo-1', org_id: 'org-1', name: 'Provider', is_active: true }],
      ledger_accounts: [{ id: 'acct-hmo', org_id: 'org-1', account_type: 'hmo_provider', student_id: null, client_profile_id: null, hmo_provider_id: 'hmo-1', is_active: true, metadata: {} }],
      ledger_transactions: [
        { id: 'tx-1', org_id: 'org-1', ledger_account_id: 'acct-hmo', client_profile_id: 'anchor-client', hmo_provider_id: 'hmo-1', source_type: 'lesson_charge', direction: 'DEBIT', amount: 2000, effective_at: '2025-03-01T00:00:00Z', reverses_transaction_id: null },
      ],
    });
    const service = new BillingLedgerService({ tenantClient: client, orgId: 'org-1', clock: FIXED_CLOCK });
    const { batchId } = await service.createHmoInvoiceBatch({ hmoProviderId: 'hmo-1', actorUserId: 'u1' });
    await service.submitHmoInvoiceBatch({ batchId, actorUserId: 'u1' });

    await assert.rejects(
      () => service.recordHmoInvoiceBatchPayment({
        batchId,
        amount: 2001,
        effectiveAt: FIXED_DATE,
        actorUserId: 'u1',
      }),
      /hmo_payment_exceeds_batch_balance/,
    );
  });

  it('cancels unpaid batch and releases participant locks', async () => {
    const client = createMockClient({
      hmo_providers: [{ id: 'hmo-1', org_id: 'org-1', name: 'Provider', is_active: true }],
      ledger_accounts: [{ id: 'acct-hmo', org_id: 'org-1', account_type: 'hmo_provider', student_id: null, client_profile_id: null, hmo_provider_id: 'hmo-1', is_active: true, metadata: {} }],
      ledger_transactions: [
        { id: 'tx-1', org_id: 'org-1', ledger_account_id: 'acct-hmo', client_profile_id: 'anchor-client', lesson_participant_id: 'part-1', hmo_provider_id: 'hmo-1', source_type: 'lesson_charge', direction: 'DEBIT', amount: 2000, effective_at: '2025-03-01T00:00:00Z', reverses_transaction_id: null },
      ],
      participant_locks: [],
      dashboard_tasks: [],
    });
    const service = new BillingLedgerService({ tenantClient: client, orgId: 'org-1', clock: FIXED_CLOCK });
    const { batchId } = await service.createHmoInvoiceBatch({ hmoProviderId: 'hmo-1', actorUserId: 'u1' });
    await service.submitHmoInvoiceBatch({ batchId, actorUserId: 'u1' });
    assert.equal(client._store.participant_locks.length, 1);

    await service.cancelHmoInvoiceBatch({ batchId, actorUserId: 'u1', reason: 'test' });
    const batch = client._store.hmo_invoice_batches.find((row) => row.id === batchId);
    const item = client._store.hmo_invoice_batch_items.find((row) => row.batch_id === batchId);
    assert.equal(batch.status, 'cancelled');
    assert.equal(item.status, 'cancelled');
    assert.equal(client._store.participant_locks.length, 0);
  });
});

// ---------------------------------------------------------------------------
// resolveLedgerAccount — upsert idempotency
// ---------------------------------------------------------------------------

describe('resolveLedgerAccount (via appendManualCredit)', () => {
  it('does not create duplicate accounts on repeated calls', async () => {
    const client = createMockClient();
    const service = new BillingLedgerService({ tenantClient: client, orgId: 'org-1', clock: FIXED_CLOCK });

    await service.appendManualCredit({ accountType: 'student', accountRefId: 'student-1', amount: 1000, effectiveAt: FIXED_DATE, actorUserId: 'u1', sourceType: 'manual_payment' });
    await service.appendManualCredit({ accountType: 'student', accountRefId: 'student-1', amount: 2000, effectiveAt: FIXED_DATE, actorUserId: 'u1', sourceType: 'manual_payment' });

    const accounts = client._store.ledger_accounts.filter((a) => a.student_id === 'student-1');
    assert.equal(accounts.length, 1, 'only one account per student');
    assert.equal(client._store.ledger_transactions.length, 2);
  });
});

// ---------------------------------------------------------------------------
// Regression guards
// ---------------------------------------------------------------------------

describe('Regression guards', () => {
  it('no code references commitments.total_amount', async () => {
    const { readFile } = await import('node:fs/promises');
    const { resolve, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
    const content = await readFile(resolve(dir, 'api/_shared/BillingLedgerService.js'), 'utf8');
    assert.ok(!content.includes('commitments'), 'BillingLedgerService must not reference commitments');
    assert.ok(!content.includes('price_charged'), 'BillingLedgerService must not reference price_charged');
    assert.ok(!content.includes('pricing_breakdown'), 'BillingLedgerService must not reference pricing_breakdown');
    assert.ok(!content.includes('get_student_remaining_balance'), 'BillingLedgerService must not call legacy RPC');
  });

  it('manual_adjustment is not in MANUAL_CREDIT_SOURCE_TYPES', async () => {
    // appendManualCredit with manual_adjustment should throw
    const client = createMockClient();
    const service = new BillingLedgerService({ tenantClient: client, orgId: 'org-1', clock: FIXED_CLOCK });
    await assert.rejects(
      () => service.appendManualCredit({ accountType: 'student', accountRefId: 's1', amount: 100, effectiveAt: FIXED_DATE, actorUserId: 'u1', sourceType: 'manual_adjustment' }),
      /invalid_manual_credit_source_type/,
    );
  });
});
