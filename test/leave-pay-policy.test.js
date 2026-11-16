// The organisation default leave-pay method: the settings block helpers
// (src/features/finance/lib/leave-pay-policy.js) and the server check on write
// (validateLeavePayPolicyInput in api/_shared/employee-finance.js).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  LEAVE_PAY_DEFAULT_METHODS,
  buildLeavePayDraft,
  buildLeavePayPolicyPayload,
  describeLeavePayMethod,
  getEffectiveDefaultMethod,
  getLeavePayMethodLabel,
  isLeavePayDraftChanged,
  readLeavePayPolicy,
  validateLeavePayDraft,
} from '../src/features/finance/lib/leave-pay-policy.js';
import { DEFAULT_LEAVE_PAY_POLICY, validateLeavePayPolicyInput } from '../api/_shared/employee-finance.js';

const SEEDED = { default_method: 'legal', lookback_months: 3, legal_allow_12m_if_better: true, fixed_rate_default: 0 };

describe('readLeavePayPolicy', () => {
  it('uses the seeded defaults when nothing is stored', () => {
    assert.deepEqual(readLeavePayPolicy(null), SEEDED);
    assert.deepEqual(readLeavePayPolicy('not json'), SEEDED);
  });

  it('matches the server defaults', () => {
    assert.deepEqual(readLeavePayPolicy(null), { ...DEFAULT_LEAVE_PAY_POLICY });
  });

  it('reads a stored JSON string and falls back on unknown values', () => {
    assert.deepEqual(
      readLeavePayPolicy('{"default_method":"avg_hourly_x_avg_day_hours","lookback_months":6,"legal_allow_12m_if_better":false}'),
      { default_method: 'avg_hourly_x_avg_day_hours', lookback_months: 6, legal_allow_12m_if_better: false, fixed_rate_default: 0 },
    );
    assert.equal(readLeavePayPolicy({ default_method: 'weird' }).default_method, 'legal');
    assert.equal(readLeavePayPolicy({ lookback_months: -2 }).lookback_months, 3);
  });
});

describe('describeLeavePayMethod', () => {
  it('describes the legal average with the 12-month comparison', () => {
    assert.equal(
      describeLeavePayMethod('legal', { lookbackMonths: 3 }),
      'השכר היומי הממוצע בימים שעבד/ה ב-3 החודשים האחרונים, או ב-12 החודשים האחרונים אם שם הממוצע גבוה יותר.',
    );
    assert.equal(
      describeLeavePayMethod('legal', { lookbackMonths: 1 }),
      'השכר היומי הממוצע בימים שעבד/ה בחודש האחרון, או ב-12 החודשים האחרונים אם שם הממוצע גבוה יותר.',
    );
  });

  it('describes the historic average for N months only', () => {
    assert.equal(
      describeLeavePayMethod('avg_hourly_x_avg_day_hours', { lookbackMonths: 6 }),
      'השכר היומי הממוצע בימים שעבד/ה ב-6 החודשים האחרונים בלבד.',
    );
  });

  it('offers only the two averages as an organisation default', () => {
    assert.deepEqual(LEAVE_PAY_DEFAULT_METHODS.map((option) => option.value), ['legal', 'avg_hourly_x_avg_day_hours']);
    assert.equal(getLeavePayMethodLabel('fixed_rate'), 'ערך קבוע ליום');
    assert.equal(getLeavePayMethodLabel('avg_hourly_x_avg_day_hours'), 'ממוצע היסטורי');
  });
});

describe('the edit draft', () => {
  it('starts from the stored values', () => {
    assert.deepEqual(buildLeavePayDraft(SEEDED), { method: 'legal', lookbackMonths: '3' });
  });

  it('shows legal with the 12-month comparison off as the historic average', () => {
    const old = { ...SEEDED, legal_allow_12m_if_better: false };
    assert.equal(getEffectiveDefaultMethod(old), 'avg_hourly_x_avg_day_hours');
    assert.equal(getEffectiveDefaultMethod(SEEDED), 'legal');
    const draft = buildLeavePayDraft(old);
    assert.equal(draft.method, 'avg_hourly_x_avg_day_hours');
    assert.equal(isLeavePayDraftChanged(old, draft), false);
    assert.equal(isLeavePayDraftChanged(old, { ...draft, method: 'legal' }), true);
  });

  it('starts with no method when the stored default is a fixed value', () => {
    const draft = buildLeavePayDraft({ ...SEEDED, default_method: 'fixed_rate', fixed_rate_default: 25000 });
    assert.equal(draft.method, '');
    assert.equal(validateLeavePayDraft(draft), 'יש לבחור שיטה.');
  });

  it('accepts whole months from 1 to 12 only', () => {
    const base = { method: 'legal' };
    assert.equal(validateLeavePayDraft({ ...base, lookbackMonths: '1' }), '');
    assert.equal(validateLeavePayDraft({ ...base, lookbackMonths: '12' }), '');
    for (const bad of ['0', '13', '2.5', '', 'abc']) {
      assert.match(validateLeavePayDraft({ ...base, lookbackMonths: bad }), /בין 1 ל-12/, bad);
    }
  });

  it('is unchanged until a value differs from what is stored', () => {
    const draft = buildLeavePayDraft(SEEDED);
    assert.equal(isLeavePayDraftChanged(SEEDED, draft), false);
    assert.equal(isLeavePayDraftChanged(SEEDED, { ...draft, method: 'avg_hourly_x_avg_day_hours' }), true);
    assert.equal(isLeavePayDraftChanged(SEEDED, { ...draft, lookbackMonths: '4' }), true);
  });

  it('builds the stored value, always with the 12-month flag on, and keeps the fields it does not edit', () => {
    const stored = { ...SEEDED, legal_allow_12m_if_better: false, fixed_rate_default: 30000 };
    assert.deepEqual(
      buildLeavePayPolicyPayload(stored, { method: 'avg_hourly_x_avg_day_hours', lookbackMonths: ' 6 ' }),
      { default_method: 'avg_hourly_x_avg_day_hours', lookback_months: 6, legal_allow_12m_if_better: true, fixed_rate_default: 30000 },
    );
    assert.equal(buildLeavePayPolicyPayload(stored, { method: 'legal', lookbackMonths: '3' }).legal_allow_12m_if_better, true);
  });
});

describe('validateLeavePayPolicyInput (server, settings write)', () => {
  it('accepts what the settings block sends', () => {
    const payload = buildLeavePayPolicyPayload(SEEDED, { method: 'avg_hourly_x_avg_day_hours', lookbackMonths: '12' });
    assert.deepEqual(validateLeavePayPolicyInput(payload), { value: payload });
  });

  it('fills left-out fields with the defaults', () => {
    assert.deepEqual(validateLeavePayPolicyInput({ default_method: 'legal' }), { value: { ...DEFAULT_LEAVE_PAY_POLICY } });
  });

  it('refuses bad values instead of replacing them', () => {
    assert.deepEqual(validateLeavePayPolicyInput(null), { error: 'invalid_leave_pay_policy' });
    assert.deepEqual(validateLeavePayPolicyInput([]), { error: 'invalid_leave_pay_policy' });
    assert.deepEqual(validateLeavePayPolicyInput({ default_method: 'monthly' }), { error: 'invalid_leave_pay_method' });
    for (const months of [0, 13, 2.5, null, '', 'x']) {
      assert.deepEqual(
        validateLeavePayPolicyInput({ ...SEEDED, lookback_months: months }),
        { error: 'invalid_leave_pay_lookback_months' },
        String(months),
      );
    }
    assert.deepEqual(validateLeavePayPolicyInput({ ...SEEDED, legal_allow_12m_if_better: 'yes' }), { error: 'invalid_leave_pay_12m_flag' });
    assert.deepEqual(validateLeavePayPolicyInput({ ...SEEDED, fixed_rate_default: -1 }), { error: 'invalid_leave_pay_fixed_rate_default' });
  });

  it('still accepts a fixed-rate default written by another client', () => {
    assert.equal(validateLeavePayPolicyInput({ ...SEEDED, default_method: 'fixed_rate', fixed_rate_default: 25000 }).value.default_method, 'fixed_rate');
  });
});
