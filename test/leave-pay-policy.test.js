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
import {
  buildEntitlementStepDraft,
  buildLeaveSettingsVersions,
  describeLeavePayVersion,
  isEntitlementStepChanged,
  validateLeaveSettingsDraft,
} from '../src/features/finance/lib/leave-settings.js';

const SEEDED = { default_method: 'legal', lookback_months: 3, fixed_rate_default: 0 };

describe('readLeavePayPolicy', () => {
  it('uses the seeded defaults when nothing is stored', () => {
    assert.deepEqual(readLeavePayPolicy(null), SEEDED);
    assert.deepEqual(readLeavePayPolicy('not json'), SEEDED);
  });

  it('matches the server defaults', () => {
    assert.deepEqual(readLeavePayPolicy(null), { ...DEFAULT_LEAVE_PAY_POLICY });
  });

  it('reads a stored JSON string and falls back on unknown values; the old 12-month flag is dropped', () => {
    assert.deepEqual(
      readLeavePayPolicy('{"default_method":"avg_hourly_x_avg_day_hours","lookback_months":6,"legal_allow_12m_if_better":false}'),
      { default_method: 'avg_hourly_x_avg_day_hours', lookback_months: 6, fixed_rate_default: 0 },
    );
    assert.equal(readLeavePayPolicy({ default_method: 'weird' }).default_method, 'legal');
    assert.equal(readLeavePayPolicy({ lookback_months: -2 }).lookback_months, 3);
  });
});

describe('describeLeavePayMethod', () => {
  it('describes "ממוצע מומלץ" in plain words, whatever the months, with no 12-month comparison', () => {
    const text = 'השכר של 3 החודשים האחרונים (או 3 החודשים המלאים ביותר בשנה האחרונה), לפי ימים קלנדריים.';
    assert.equal(describeLeavePayMethod('legal', { lookbackMonths: 3 }), text);
    assert.equal(describeLeavePayMethod('legal', { lookbackMonths: 1 }), text);
    assert.doesNotMatch(text, /12 החודשים|לפי החוק/);
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

  it('ignores an old stored 12-month flag: "legal" is shown as "ממוצע מומלץ" either way', () => {
    const old = { ...SEEDED, legal_allow_12m_if_better: false };
    assert.equal(getEffectiveDefaultMethod(old), 'legal');
    assert.equal(getEffectiveDefaultMethod(SEEDED), 'legal');
    const draft = buildLeavePayDraft(old);
    assert.equal(draft.method, 'legal');
    assert.equal(isLeavePayDraftChanged(old, draft), false);
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
    // "ממוצע מומלץ" does not use the months, so changing them alone is no change.
    assert.equal(isLeavePayDraftChanged(SEEDED, { ...draft, lookbackMonths: '4' }), false);
    const historic = { ...SEEDED, default_method: 'avg_hourly_x_avg_day_hours' };
    assert.equal(isLeavePayDraftChanged(historic, { method: 'avg_hourly_x_avg_day_hours', lookbackMonths: '4' }), true);
  });

  it('builds the stored value without the old 12-month flag, and keeps the fields it does not edit', () => {
    const stored = { ...SEEDED, legal_allow_12m_if_better: false, fixed_rate_default: 30000 };
    assert.deepEqual(
      buildLeavePayPolicyPayload(stored, { method: 'avg_hourly_x_avg_day_hours', lookbackMonths: ' 6 ' }),
      { default_method: 'avg_hourly_x_avg_day_hours', lookback_months: 6, fixed_rate_default: 30000 },
    );
    assert.equal('legal_allow_12m_if_better' in buildLeavePayPolicyPayload(stored, { method: 'legal', lookbackMonths: '3' }), false);
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
    // The retired 12-month flag is no longer read, so any value of it is dropped, not refused.
    assert.deepEqual(validateLeavePayPolicyInput({ ...SEEDED, legal_allow_12m_if_better: 'yes' }), { value: { ...SEEDED } });
    assert.deepEqual(validateLeavePayPolicyInput({ ...SEEDED, fixed_rate_default: -1 }), { error: 'invalid_leave_pay_fixed_rate_default' });
  });

  it('still accepts a fixed-rate default written by another client', () => {
    assert.equal(validateLeavePayPolicyInput({ ...SEEDED, default_method: 'fixed_rate', fixed_rate_default: 25000 }).value.default_method, 'fixed_rate');
  });
});

describe('the "חופשה" dialog: two steps, one save', () => {
  const LEGAL_ENTITLEMENT = { mode: 'legal', fixed_days_by_year: [12, 12] };
  const entitlementDraft = (mode, rows = ['12', '12']) => ({ mode, rows });
  const payDraft = (method, lookbackMonths = '3') => ({ method, lookbackMonths });

  it('starts step 1 on "כמות קבועה" when the organisation never chose, and keeps a saved choice', () => {
    assert.equal(buildEntitlementStepDraft(null, false).mode, 'fixed');
    assert.equal(buildEntitlementStepDraft(null, false).rows.length, 14, 'the table is still prefilled');
    assert.equal(buildEntitlementStepDraft({ mode: 'fixed', fixed_days_by_year: [10] }, true).mode, 'fixed');
    assert.equal(buildEntitlementStepDraft(null, true).mode, 'fixed', 'a version with no readable mode is the default');
    assert.equal(buildEntitlementStepDraft({ mode: 'legal' }, true).mode, 'legal');
  });

  it('asks for step 1 before anything else, then checks the table and the months', () => {
    assert.equal(validateLeaveSettingsDraft({ entitlementDraft: entitlementDraft(''), payDraft: payDraft('legal') }), 'יש לבחור כמה ימי חופשה מגיעים בשנה.');
    assert.equal(validateLeaveSettingsDraft({ entitlementDraft: entitlementDraft('legal'), payDraft: payDraft('legal') }), '');
    assert.match(validateLeaveSettingsDraft({ entitlementDraft: entitlementDraft('fixed', ['']), payDraft: payDraft('legal') }), /בכל שורה/);
    assert.match(validateLeaveSettingsDraft({ entitlementDraft: entitlementDraft('legal'), payDraft: payDraft('legal', '13') }), /בין 1 ל-12/);
  });

  it('saves a version only of the keys that changed', () => {
    const unchangedEntitlement = { baseline: LEGAL_ENTITLEMENT, draft: entitlementDraft('legal'), hasVersionOnDate: true };
    const unchangedPay = { baseline: SEEDED, draft: payDraft('legal') };
    assert.deepEqual(buildLeaveSettingsVersions({ entitlement: unchangedEntitlement, pay: unchangedPay }), []);

    const onlyPay = buildLeaveSettingsVersions({ entitlement: unchangedEntitlement, pay: { baseline: SEEDED, draft: payDraft('avg_hourly_x_avg_day_hours', '6') } });
    assert.deepEqual(onlyPay.map((entry) => entry.key), ['leave_pay_policy']);
    assert.equal(onlyPay[0].value.default_method, 'avg_hourly_x_avg_day_hours');
    assert.equal(onlyPay[0].value.lookback_months, 6);

    const both = buildLeaveSettingsVersions({
      entitlement: { baseline: LEGAL_ENTITLEMENT, draft: entitlementDraft('fixed', ['10', '14']), hasVersionOnDate: true },
      pay: { baseline: SEEDED, draft: payDraft('avg_hourly_x_avg_day_hours') },
    });
    assert.deepEqual(both.map((entry) => entry.key), ['leave_entitlement_policy', 'leave_pay_policy']);
    assert.deepEqual(both[0].value, { mode: 'fixed', fixed_days_by_year: [10, 14] });
  });

  it('keeps a first choice of step 1 even when it matches what the system already did', () => {
    assert.equal(isEntitlementStepChanged({ baseline: null, draft: entitlementDraft('legal'), hasVersionOnDate: false }), true);
    assert.equal(isEntitlementStepChanged({ baseline: null, draft: entitlementDraft(''), hasVersionOnDate: false }), false);
    assert.equal(isEntitlementStepChanged({ baseline: LEGAL_ENTITLEMENT, draft: entitlementDraft('legal'), hasVersionOnDate: true }), false);
  });

  it('describes a stored pay version for the shared history', () => {
    assert.equal(describeLeavePayVersion({ settings_value: SEEDED }), 'ממוצע מומלץ', '"ממוצע מומלץ" does not use the months');
    assert.equal(describeLeavePayVersion({ settings_value: { ...SEEDED, default_method: 'avg_hourly_x_avg_day_hours', lookback_months: 6 } }), 'ממוצע היסטורי · 6 חודשים');
  });
});
