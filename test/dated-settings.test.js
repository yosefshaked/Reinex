// Dated settings (api/_shared/dated-settings.js): the registry, the "as of a date" resolver, the
// finance policies built on it, and the warnings a settings screen shows before saving a version.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DATED_SETTING_KEYS,
  SINCE_THE_BEGINNING,
  isDatedSettingKey,
  listSettingVersions,
  resolveSettingOnDate,
  validateSettingEffectiveDate,
} from '../api/_shared/dated-settings.js';
import {
  DEFAULT_INSTRUCTOR_EARNINGS_POLICY,
  DEFAULT_LEAVE_PAY_POLICY,
  buildFinancePolicies,
  financePoliciesOnDate,
  loadFinancePolicies,
  loadSettingsMap,
  validateInstructorEarningsPolicyInput,
} from '../api/_shared/employee-finance.js';
import {
  SINCE_THE_BEGINNING as SCREEN_SINCE_THE_BEGINNING,
  buildDatedSettingWarnings,
  versionFromLabel,
  versionInForce,
} from '../src/features/settings/lib/dated-setting.js';

const version = (key, effectiveDate, value, createdAt = '2026-01-01T00:00:00Z') => ({
  key, effective_date: effectiveDate, settings_value: value, created_at: createdAt,
});

const ROWS = [
  version('instructor_earnings_policy', '2000-01-01', { no_show: true }),
  version('instructor_earnings_policy', '2026-12-01', { no_show: false }),
  version('leave_pay_policy', '2026-06-01', { default_method: 'legal' }),
];

describe('the registry of dated settings', () => {
  it('names every setting that affects pay, and only those', () => {
    assert.deepEqual([...DATED_SETTING_KEYS].sort(), ['instructor_earnings_policy', 'leave_entitlement_policy', 'leave_pay_policy']);
    assert.equal(isDatedSettingKey('leave_entitlement_policy'), true);
    assert.equal(isDatedSettingKey('leave_pay_policy'), true);
    assert.equal(isDatedSettingKey(' instructor_earnings_policy '), true);
    assert.equal(isDatedSettingKey('billing_consumption_policy'), false, 'student billing is not dated yet');
    assert.equal(isDatedSettingKey('session_form_config'), false);
  });

  it('starts first versions on the same date as rates carried over from before rate history', () => {
    assert.equal(SINCE_THE_BEGINNING, '2000-01-01');
    assert.equal(SCREEN_SINCE_THE_BEGINNING, SINCE_THE_BEGINNING);
  });

  it('a dated setting cannot be read from "Settings"', async () => {
    await assert.rejects(() => loadSettingsMap({}, 'org', ['leave_policy', 'leave_pay_policy']), /dated settings/);
  });
});

describe('the value in force on a date', () => {
  it('is the latest version on or before the date', () => {
    const on = (date) => resolveSettingOnDate(ROWS, 'instructor_earnings_policy', date)?.settings_value.no_show;
    assert.equal(on('2026-11-30'), true);
    assert.equal(on('2026-12-01'), false, 'the version applies from its own date');
    assert.equal(on('2027-03-01'), false);
  });

  it('is nothing before the first version or for another key', () => {
    assert.equal(resolveSettingOnDate(ROWS, 'leave_pay_policy', '2026-05-31'), null);
    assert.equal(resolveSettingOnDate(ROWS, 'billing_consumption_policy', '2026-12-01'), null);
    assert.equal(resolveSettingOnDate(ROWS, 'leave_pay_policy', 'not-a-date'), null);
  });

  it('two versions on one date resolve to the later created', () => {
    const rows = [
      version('leave_pay_policy', '2026-06-01', { lookback_months: 3 }, '2026-06-01T08:00:00Z'),
      version('leave_pay_policy', '2026-06-01', { lookback_months: 6 }, '2026-06-02T08:00:00Z'),
    ];
    assert.equal(resolveSettingOnDate(rows, 'leave_pay_policy', '2026-06-01').settings_value.lookback_months, 6);
  });

  it('lists a key\'s history newest first', () => {
    assert.deepEqual(
      listSettingVersions(ROWS, 'instructor_earnings_policy').map((row) => row.effective_date),
      ['2026-12-01', '2000-01-01'],
    );
  });

  it('a version needs a date', () => {
    assert.deepEqual(validateSettingEffectiveDate(''), { error: 'missing_effective_date' });
    assert.deepEqual(validateSettingEffectiveDate('1.12.2026'), { error: 'invalid_effective_date' });
    assert.deepEqual(validateSettingEffectiveDate('2026-12-01'), { value: '2026-12-01' });
  });
});

describe('finance policies as of a date', () => {
  it('resolves the dated policies per date and keeps the plain ones', () => {
    const policies = buildFinancePolicies({
      asOf: '2026-11-15',
      settingsMap: { billing_consumption_policy: { attended: true, no_show: true } },
      datedRows: ROWS,
    });
    assert.equal(policies.asOfDate, '2026-11-15');
    assert.equal(policies.instructorEarningsPolicy.no_show, true);
    assert.equal(policies.onDate('2026-12-02').instructorEarningsPolicy.no_show, false);
    assert.equal(policies.onDate('2026-12-02').billingConsumptionPolicy.no_show, true);
    assert.equal(financePoliciesOnDate(policies, '2026-12-02').asOfDate, '2026-12-02');
    // A lesson instant resolves by its Israel date: 23:30Z on 30.11 is 1.12 in Israel.
    assert.equal(financePoliciesOnDate(policies, '2026-11-30T23:30:00Z').instructorEarningsPolicy.no_show, false);
  });

  it('falls back to the defaults when a key has no version', () => {
    const policies = buildFinancePolicies({ asOf: '2026-11-15' });
    assert.deepEqual(policies.instructorEarningsPolicy, { ...DEFAULT_INSTRUCTOR_EARNINGS_POLICY });
    assert.deepEqual(policies.leavePayPolicy, { ...DEFAULT_LEAVE_PAY_POLICY });
  });

  it('a plain policies object is the same on every date', () => {
    const plain = { instructorEarningsPolicy: { no_show: true } };
    assert.equal(financePoliciesOnDate(plain, '2026-12-02'), plain);
  });

  it('the loader needs an as-of date: "now" is passed as today, never assumed', async () => {
    await assert.rejects(() => loadFinancePolicies({}, 'org'), /as-of date/);
    await assert.rejects(() => loadFinancePolicies({}, 'org', { asOf: '2026-11-15T10:00:00Z' }), /as-of date/);
  });

  it('checks an earnings policy before it is stored', () => {
    assert.deepEqual(validateInstructorEarningsPolicyInput({ no_show: false }).value, { ...DEFAULT_INSTRUCTOR_EARNINGS_POLICY, no_show: false });
    assert.deepEqual(validateInstructorEarningsPolicyInput({ no_show: 'yes' }), { error: 'invalid_instructor_earnings_policy' });
    assert.deepEqual(validateInstructorEarningsPolicyInput([]), { error: 'invalid_instructor_earnings_policy' });
  });
});

describe('the settings screen pattern', () => {
  const versions = [
    { effective_date: '2026-12-01', settings_value: {} },
    { effective_date: '2000-01-01', settings_value: {} },
  ];

  it('finds the version in force on a date, as the server does', () => {
    assert.equal(versionInForce(versions, '2026-11-30').effective_date, '2000-01-01');
    assert.equal(versionInForce(versions, '2026-12-01').effective_date, '2026-12-01');
    assert.equal(versionInForce([], '2026-12-01'), null);
  });

  it('labels the carried-over first version as "since the beginning"', () => {
    assert.equal(versionFromLabel(versions[1]), 'מאז ההתחלה');
    assert.equal(versionFromLabel(versions[0]), 'מ-01.12.2026');
  });

  it('warns that a back-dated version recomputes pay already shown', () => {
    const today = '2026-12-10';
    assert.deepEqual(buildDatedSettingWarnings({ versions, effectiveDate: today, today }), []);
    const backDated = buildDatedSettingWarnings({ versions, effectiveDate: '2026-11-01', today });
    assert.equal(backDated.length, 2);
    assert.match(backDated[0], /ימים שכבר עברו/);
    assert.match(backDated[1], /לפני ההגדרה הנוכחית \(מ-01.12.2026\)/);
    assert.match(buildDatedSettingWarnings({ versions, effectiveDate: '2026-12-01', today }).at(-1), /השמירה תחליף אותה/);
  });
});
