// Annual leave entitlement (api/_shared/leave-entitlement.js): the legal tables, seniority, the
// 200 / 240 rule, rounding, gross -> net, the Kol Zchut worked examples, the 75-day threshold, the
// organisation's fixed table, a manual number, and which version of the org setting decides a year.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_FIXED_DAYS_BY_YEAR,
  LEGAL_GROSS_DAYS_BY_YEAR,
  LEGAL_NET_DAYS_5_DAY_WEEK,
  LEGAL_NET_DAYS_6_DAY_WEEK,
  computeLeaveEntitlement,
  daysWorkedRange,
  entitlementPolicyDateForYear,
  grossToNet,
  daysToNextLeaveDay,
  legalShareOfYear,
  legalYearEntitlement,
  manualLeaveDays,
  needsDaysWorked,
  normalizeLeaveEntitlementPolicy,
  seniorityYearIn,
  tableValue,
  validateLeaveEntitlementPolicyInput,
  workWeekDays,
} from '../api/_shared/leave-entitlement.js';
import * as frontendModule from '../src/lib/leave-entitlement.js';
import { buildFinancePolicies, computeLeaveSummary } from '../api/_shared/employee-finance.js';
import { collectWorkedDates } from '../api/_shared/pay-calculation.js';
import {
  ENTITLEMENT_DEFAULT_OPTIONS,
  buildEntitlementDraft,
  buildEntitlementPayload,
  describeEntitlementVersion,
  isEntitlementDraftChanged,
  seniorityRowLabel,
  validateEntitlementDraft,
} from '../src/features/finance/lib/leave-entitlement-settings.js';
import {
  buildEmployeeLeaveBody,
  buildEntitlementChoiceBody,
  describeEmployeeLeavePayChoice,
  employeeLeaveSummaryText,
  entitlementManualReason,
  leaveEntitlementExplanation,
} from '../src/components/settings/employee-management/attendance-month-grid.js';
import { buildDatedSettingWarnings } from '../src/features/settings/lib/dated-setting.js';

const LEGAL = { mode: 'legal' };
const FIVE_DAYS = [0, 1, 2, 3, 4];
const SIX_DAYS = [0, 1, 2, 3, 4, 5];

// An employee who started on `start` with the given work week; no manual number.
const employee = (start, workingDays = null, annual = null) => ({ start_date: start, working_days: workingDays, annual_leave_days: annual });

// A past year, so the figure is final (not "so far").
const legalPast = ({ start, year, daysWorked, workingDays = FIVE_DAYS, paidSickDays = 0 }) => computeLeaveEntitlement({
  employee: employee(start, workingDays),
  policy: LEGAL,
  year,
  today: '2026-11-16',
  daysWorked,
  paidSickDays,
});

describe('the legal tables (Kol Zchut, fetched 2026-11-16)', () => {
  it('gross days by seniority year: 16 for years 1-5, 18, 21, then one more a year up to 28', () => {
    assert.deepEqual([...LEGAL_GROSS_DAYS_BY_YEAR], [16, 16, 16, 16, 16, 18, 21, 22, 23, 24, 25, 26, 27, 28]);
    assert.equal(tableValue(LEGAL_GROSS_DAYS_BY_YEAR, 14), 28);
    assert.equal(tableValue(LEGAL_GROSS_DAYS_BY_YEAR, 30), 28, 'the last row is "and onwards"');
    assert.equal(tableValue(LEGAL_GROSS_DAYS_BY_YEAR, 0), null);
  });

  it('net working days on a 5-day and a 6-day week, year by year', () => {
    assert.deepEqual([...LEGAL_NET_DAYS_5_DAY_WEEK], [12, 12, 12, 12, 12, 14, 15, 16, 17, 18, 19, 20, 20, 20]);
    assert.deepEqual([...LEGAL_NET_DAYS_6_DAY_WEEK], [14, 14, 14, 14, 14, 16, 18, 19, 20, 21, 22, 23, 24, 24]);
  });

  it('every net figure is the gross figure converted by the one gross -> net rule', () => {
    LEGAL_GROSS_DAYS_BY_YEAR.forEach((gross, index) => {
      assert.equal(grossToNet(gross, 5), LEGAL_NET_DAYS_5_DAY_WEEK[index], `5-day, year ${index + 1}`);
      assert.equal(grossToNet(gross, 6), LEGAL_NET_DAYS_6_DAY_WEEK[index], `6-day, year ${index + 1}`);
    });
  });

  it('the fixed table offered by default is the 5-day net table', () => {
    assert.deepEqual([...DEFAULT_FIXED_DAYS_BY_YEAR], [...LEGAL_NET_DAYS_5_DAY_WEEK]);
  });

  it('the frontend re-export is the same module', () => {
    assert.equal(frontendModule.computeLeaveEntitlement, computeLeaveEntitlement);
  });
});

describe('gross -> net: W x full weeks + leftover days up to W', () => {
  it('reproduces the Kol Zchut examples on a 5-day week (17->13, 16->12, 8->6, 7->5)', () => {
    assert.equal(grossToNet(17, 5), 13);
    assert.equal(grossToNet(16, 5), 12);
    assert.equal(grossToNet(8, 5), 6);
    assert.equal(grossToNet(7, 5), 5);
  });

  it('reproduces the Kol Zchut examples on a 6-day week (7->6, 9->8, 28->24)', () => {
    assert.equal(grossToNet(7, 6), 6);
    assert.equal(grossToNet(9, 6), 8);
    assert.equal(grossToNet(28, 6), 24);
  });

  it('leftover days beyond the work week are rest days', () => {
    assert.equal(grossToNet(6, 5), 5);
    assert.equal(grossToNet(13, 5), 10);
    assert.equal(grossToNet(0, 5), 0);
  });
});

describe('seniority and work week', () => {
  it('counts calendar years touched', () => {
    assert.equal(seniorityYearIn('2025-12-31', 2025), 1);
    assert.equal(seniorityYearIn('2025-12-31', 2026), 2);
    assert.equal(seniorityYearIn('2012-06-01', 2017), 6);
    assert.equal(seniorityYearIn('2027-01-01', 2026), null);
    assert.equal(seniorityYearIn('', 2026), null);
  });

  it('exactly six defined days is a 6-day week; anything else, none included, is a 5-day week', () => {
    assert.equal(workWeekDays(SIX_DAYS), 6);
    assert.equal(workWeekDays({ days: SIX_DAYS }), 6);
    assert.equal(workWeekDays(FIVE_DAYS), 5);
    assert.equal(workWeekDays([0, 1, 2]), 5);
    assert.equal(workWeekDays(null), 5);
    assert.equal(workWeekDays([0, 1, 2, 3, 4, 5, 6]), 5);
  });

  it('full-year legal entitlement by seniority and work week', () => {
    assert.deepEqual(legalYearEntitlement(8, 5), { gross: 22, net: 16 });
    assert.deepEqual(legalYearEntitlement(14, 6), { gross: 28, net: 24 });
  });
});

describe('the law: Kol Zchut worked examples', () => {
  it('(a) 5-day week, year 8, whole year, 150 days: 150/200 x 16 net = 12', () => {
    const result = legalPast({ start: '2010-01-01', year: 2017, daysWorked: 150 });
    assert.equal(result.seniority_year, 8);
    assert.equal(result.threshold_days, 200);
    assert.equal(result.gross_earned, 16.5);
    assert.equal(result.days, 12);
  });

  it('(b) 5-day week, started July 2017 (part year): 120/240 x 12 = 6 net; 110 days -> 5.5 net', () => {
    const at120 = legalPast({ start: '2017-07-02', year: 2017, daysWorked: 120 });
    assert.equal(at120.employed_whole_year, false);
    assert.equal(at120.threshold_days, 240);
    assert.equal(at120.gross_earned, 8);
    assert.equal(at120.days, 6);
    const at110 = legalPast({ start: '2017-07-02', year: 2017, daysWorked: 110 });
    assert.equal(at110.gross_earned, 7.33);
    assert.equal(at110.days, 5.5);
  });

  it('(c) 6-day week, year 6, whole year, 85 days: 85/200 x 16 net = 6.8', () => {
    const result = legalPast({ start: '2012-03-01', year: 2017, daysWorked: 85, workingDays: SIX_DAYS });
    assert.equal(result.seniority_year, 6);
    assert.equal(result.work_week_days, 6);
    assert.equal(result.gross_earned, 7.65);
    assert.equal(result.days, 6.8);
  });

  it('(d) 6-day week, year 10, left in May (part year), 90 days: 90/240 x 21 net = 7.88', () => {
    // The system has no end date, so a year the employee left in cannot be expressed on an employee;
    // the rule itself is checked through the share of the year.
    const share = legalShareOfYear({ seniorityYear: 10, weekDays: 6, employedWholeYear: false, daysCounted: 90 });
    assert.equal(share.threshold_days, 240);
    assert.equal(share.gross_full, 24);
    assert.equal(share.gross_earned, 9);
    assert.equal(share.net, 7.88);
    // The same employee without an end date is a whole-year employee: 90/200 x 21 net = 9.45.
    const result = computeLeaveEntitlement({
      employee: employee('2008-01-01', SIX_DAYS), policy: LEGAL, year: 2017, today: '2026-11-16', daysWorked: 90,
    });
    assert.equal(result.seniority_year, 10);
    assert.equal(result.days, 9.45);
  });

  it('(e) 170 days worked + 30 paid sick days = 200: the full entitlement', () => {
    const result = legalPast({ start: '2020-01-01', year: 2025, daysWorked: 170, paidSickDays: 30 });
    assert.equal(result.reached_full, true);
    assert.equal(result.days, 14, 'year 6 on a 5-day week');
    assert.equal(legalPast({ start: '2020-01-01', year: 2025, daysWorked: 170 }).reached_full, false);
  });

  it('200 days on a whole year and 240 on a part year are full', () => {
    assert.equal(legalPast({ start: '2020-01-01', year: 2024, daysWorked: 200 }).days, 12);
    assert.equal(legalPast({ start: '2024-03-01', year: 2024, daysWorked: 239 }).reached_full, false);
    assert.equal(legalPast({ start: '2024-03-01', year: 2024, daysWorked: 240 }).days, 12);
  });

  it('the current year is computed from the days worked so far and says it is in progress', () => {
    const result = computeLeaveEntitlement({
      employee: employee('2025-02-01', FIVE_DAYS), policy: LEGAL, year: 2026, today: '2026-11-16', daysWorked: 96,
    });
    assert.equal(result.in_progress, true);
    assert.equal(result.seniority_year, 2);
    assert.equal(result.full_year_days, 12);
    // 12 days a year x 96 / 200 = 5.76, not rounded down.
    assert.equal(result.days, 5.76);
  });
});

describe('when the system does not compute', () => {
  it('before 75 days of employment it asks for a manual number', () => {
    const result = computeLeaveEntitlement({ employee: employee('2026-09-10'), policy: LEGAL, year: 2026, today: '2026-11-16', daysWorked: 40 });
    assert.equal(result.status, 'manual_needed');
    assert.equal(result.reason, 'before_75_days');
    assert.equal(result.days, null);
    assert.match(entitlementManualReason(result), /עדיין לא עברו 75 ימי העסקה/);
  });

  it('day 75 of employment is covered', () => {
    // 2026-09-02 .. 2026-11-15 is 75 days inclusive.
    assert.equal(computeLeaveEntitlement({ employee: employee('2026-09-02'), policy: LEGAL, year: 2026, today: '2026-11-15', daysWorked: 50 }).status, 'ok');
    assert.equal(computeLeaveEntitlement({ employee: employee('2026-09-03'), policy: LEGAL, year: 2026, today: '2026-11-15', daysWorked: 50 }).status, 'manual_needed');
  });

  it('without a start date it asks for a manual number (law and fixed table alike)', () => {
    for (const policy of [LEGAL, { mode: 'fixed' }]) {
      const result = computeLeaveEntitlement({ employee: employee(null), policy, year: 2026, today: '2026-11-16' });
      assert.equal(result.status, 'manual_needed');
      assert.equal(result.reason, 'no_start_date');
    }
  });

  it('a year before the employee started has no leave', () => {
    const result = computeLeaveEntitlement({ employee: employee('2026-03-01'), policy: LEGAL, year: 2025, today: '2026-11-16' });
    assert.equal(result.status, 'not_employed');
    assert.equal(result.days, 0);
  });

  it('only the law needs the days worked, and only when it can compute', () => {
    const base = { year: 2026, today: '2026-11-16' };
    assert.equal(needsDaysWorked({ ...base, employee: employee('2020-01-01'), policy: LEGAL }), true);
    assert.equal(needsDaysWorked({ ...base, employee: employee('2020-01-01'), policy: { mode: 'fixed' } }), false);
    assert.equal(needsDaysWorked({ ...base, employee: employee('2020-01-01', null, 10), policy: LEGAL }), false);
    assert.equal(needsDaysWorked({ ...base, employee: employee('2026-10-01'), policy: LEGAL }), false);
    assert.equal(needsDaysWorked({ ...base, employee: employee('2020-01-01'), policy: null }), false, 'no saved version means the fixed table, which needs no days worked');
    assert.equal(needsDaysWorked({ ...base, employee: employee(null), policy: null }), false);
  });

  it('days worked are counted from 1 January (or the start date) to today, or to 31 December of a past year', () => {
    assert.deepEqual(daysWorkedRange({ employee: employee('2020-01-01'), year: 2026, today: '2026-11-16' }), { startDate: '2026-01-01', endDate: '2026-11-16' });
    assert.deepEqual(daysWorkedRange({ employee: employee('2025-07-01'), year: 2025, today: '2026-11-16' }), { startDate: '2025-07-01', endDate: '2025-12-31' });
  });
});

describe('the fixed table and a manual number', () => {
  it('the fixed table gives the row of the seniority year, the last row onwards', () => {
    const policy = { mode: 'fixed', fixed_days_by_year: [10, 12, 15] };
    const at = (start) => computeLeaveEntitlement({ employee: employee(start), policy, year: 2026, today: '2026-11-16' });
    assert.equal(at('2026-01-01').days, 10);
    assert.equal(at('2025-05-01').days, 12);
    assert.equal(at('2010-05-01').days, 15);
    assert.equal(at('2010-05-01').source, 'fixed');
  });

  it('the fixed table and a manual number are pro-rated by calendar days in the year the employee started', () => {
    const fixed = computeLeaveEntitlement({ employee: employee('2026-07-02'), policy: { mode: 'fixed', fixed_days_by_year: [12] }, year: 2026, today: '2026-11-16' });
    // 2026-07-02 .. 2026-12-31 = 183 of 365 days.
    assert.equal(fixed.prorated, true);
    assert.equal(fixed.days, Number(((12 * 183) / 365).toFixed(3)));
    const manual = computeLeaveEntitlement({ employee: employee('2026-07-02', null, 20), policy: LEGAL, year: 2026, today: '2026-11-16' });
    assert.equal(manual.source, 'manual');
    assert.equal(manual.full_year_days, 20);
    assert.equal(manual.days, Number(((20 * 183) / 365).toFixed(3)));
  });

  it('a manual number wins over the organisation default and needs no start date or 75 days', () => {
    const result = computeLeaveEntitlement({ employee: employee(null, null, 18), policy: { mode: 'fixed' }, year: 2026, today: '2026-11-16' });
    assert.equal(result.status, 'ok');
    assert.equal(result.days, 18);
    assert.equal(manualLeaveDays({ annual_leave_days: null }), null);
    assert.equal(manualLeaveDays({ annual_leave_days: '0' }), 0);
  });
});

describe('the organisation setting', () => {
  it('reads anything unreadable as the fixed table, the default', () => {
    assert.deepEqual(normalizeLeaveEntitlementPolicy(null), { mode: 'fixed', fixed_days_by_year: [...DEFAULT_FIXED_DAYS_BY_YEAR] });
    assert.equal(normalizeLeaveEntitlementPolicy('nope').mode, 'fixed');
    assert.equal(normalizeLeaveEntitlementPolicy({ mode: 'legal' }).mode, 'legal', 'a saved "legal" version keeps the law');
    assert.equal(normalizeLeaveEntitlementPolicy('{"mode":"fixed","fixed_days_by_year":[9]}').mode, 'fixed');
  });

  it('validates what the settings API stores', () => {
    assert.deepEqual(validateLeaveEntitlementPolicyInput({ mode: 'fixed', fixed_days_by_year: [12, '14', 15.5] }).value, { mode: 'fixed', fixed_days_by_year: [12, 14, 15.5] });
    assert.equal(validateLeaveEntitlementPolicyInput({ mode: 'legal' }).value.mode, 'legal');
    assert.equal(validateLeaveEntitlementPolicyInput({ mode: 'other' }).error, 'invalid_leave_entitlement_mode');
    assert.equal(validateLeaveEntitlementPolicyInput({ mode: 'fixed', fixed_days_by_year: [] }).error, 'invalid_leave_entitlement_table');
    assert.equal(validateLeaveEntitlementPolicyInput({ mode: 'fixed', fixed_days_by_year: [12.3] }).error, 'invalid_leave_entitlement_table');
    assert.equal(validateLeaveEntitlementPolicyInput({ mode: 'fixed', fixed_days_by_year: [-1] }).error, 'invalid_leave_entitlement_table');
    assert.equal(validateLeaveEntitlementPolicyInput({ mode: 'fixed', fixed_days_by_year: [''] }).error, 'invalid_leave_entitlement_table');
    assert.equal(validateLeaveEntitlementPolicyInput('nope').error, 'invalid_leave_entitlement_policy');
  });

  it('a year follows the version in force on its 31 December, or today for the current year', () => {
    assert.equal(entitlementPolicyDateForYear(2025, '2026-11-16'), '2025-12-31');
    assert.equal(entitlementPolicyDateForYear(2026, '2026-11-16'), '2026-11-16');
    assert.equal(entitlementPolicyDateForYear(2027, '2026-11-16'), '2026-11-16');
  });

  it('the finance policies resolve that version through the one dated-settings resolver', () => {
    const rows = [
      { key: 'leave_entitlement_policy', effective_date: '2025-07-01', settings_value: { mode: 'fixed', fixed_days_by_year: [9] } },
      { key: 'leave_entitlement_policy', effective_date: '2026-12-01', settings_value: { mode: 'legal' } },
    ];
    const policies = buildFinancePolicies({ datedRows: rows, asOf: '2026-11-16' });
    // 2024: no version yet -> the default, the fixed table.
    assert.equal(policies.onDate(entitlementPolicyDateForYear(2024, '2026-11-16')).leaveEntitlementPolicy.mode, 'fixed');
    // 2025: the version from 1 July 2025 decides the whole year.
    const in2025 = policies.onDate(entitlementPolicyDateForYear(2025, '2026-11-16'));
    assert.equal(in2025.leaveEntitlementPolicy.mode, 'fixed');
    assert.equal(in2025.leaveEntitlementPolicyEffectiveDate, '2025-07-01');
    // 2026 (current year): the version in force today, not the future one from December.
    assert.equal(policies.onDate(entitlementPolicyDateForYear(2026, '2026-11-16')).leaveEntitlementPolicy.mode, 'fixed');
  });
});

describe('days worked and the balance', () => {
  it('a day with a counted lesson or with office minutes counts once', () => {
    const lessons = [
      { counted: true, lesson_date: '2026-03-01', duration_minutes: 45, lesson_instance_id: 'a' },
      { counted: true, lesson_date: '2026-03-01', duration_minutes: 45, lesson_instance_id: 'b' },
      { counted: false, lesson_date: '2026-03-02', duration_minutes: 45, lesson_instance_id: 'c' },
    ];
    const attendanceRecords = [
      { attendance_date: '2026-03-01', other_minutes: 60 },
      { attendance_date: '2026-03-03', other_minutes: 30 },
      { attendance_date: '2026-03-04', other_minutes: 0 },
    ];
    assert.deepEqual(collectWorkedDates({ lessons, attendanceRecords }), ['2026-03-01', '2026-03-03']);
    // Paid leave (including half a day and the older half_day type) counts, once per date; unpaid does not.
    const leaveDays = [
      { leave_date: '2026-03-01', leave_type: 'employee_paid', day_portion: 'full_day' },
      { leave_date: '2026-03-05', leave_type: 'system_paid', day_portion: 'full_day' },
      { leave_date: '2026-03-06', leave_type: 'employee_paid', day_portion: 'first_half' },
      { leave_date: '2026-03-07', leave_type: 'half_day', day_portion: 'first_half' },
      { leave_date: '2026-03-08', leave_type: 'unpaid', day_portion: 'full_day' },
    ];
    assert.deepEqual(
      collectWorkedDates({ lessons, attendanceRecords, leaveDays }),
      ['2026-03-01', '2026-03-03', '2026-03-05', '2026-03-06', '2026-03-07'],
    );
  });

  it('nothing caps a carry-over: an old leave_policy cap is ignored', () => {
    const summary = computeLeaveSummary({
      entitlement: { days: 12 },
      year: 2026,
      leavePolicy: { carryover_enabled: true, carryover_cap_days: 2 },
      balanceEvents: [{ event_type: 'carryover', quantity_days: 8, effective_date: '2026-01-01' }],
    });
    assert.equal(summary.remaining, 20);
    assert.equal(summary.available, 20);
  });

  it('the balance takes the entitlement as its quota and adds the manual movements', () => {
    const summary = computeLeaveSummary({
      entitlement: { days: 12 },
      year: 2026,
      balanceEvents: [
        { event_type: 'carryover', quantity_days: 3, effective_date: '2026-01-01' },
        { event_type: 'usage', quantity_days: -2, effective_date: '2026-04-01' },
        { event_type: 'adjustment', quantity_days: -1, effective_date: '2026-05-01' },
        { event_type: 'allocation', quantity_days: 5, effective_date: '2025-05-01' },
      ],
    });
    assert.equal(summary.quota, 12);
    assert.equal(summary.used, 2);
    assert.equal(summary.remaining, 12);
    assert.equal(summary.available, 14);
    assert.equal(computeLeaveSummary({ entitlement: { days: null }, year: 2026 }).quota, 0);
  });
});

describe('the settings dialog and the employee choice', () => {
  it('builds, checks and compares the draft of the organisation default', () => {
    const draft = buildEntitlementDraft(null);
    assert.equal(draft.mode, 'fixed');
    assert.equal(draft.rows.length, 14);
    assert.equal(isEntitlementDraftChanged(null, draft), false);
    const legal = { ...draft, mode: 'legal' };
    assert.equal(isEntitlementDraftChanged(null, legal), true);
    assert.equal(validateEntitlementDraft(draft), '');
    assert.deepEqual(ENTITLEMENT_DEFAULT_OPTIONS.map((option) => option.value), ['fixed', 'legal'], '"כמות קבועה" is listed first');
    assert.equal(ENTITLEMENT_DEFAULT_OPTIONS[0].label, 'כמות קבועה');
    assert.equal(ENTITLEMENT_DEFAULT_OPTIONS[1].label, 'מומלץ: לפי ותק וימי עבודה');
    assert.deepEqual(buildEntitlementPayload({ mode: 'fixed', rows: ['10', '12'] }), { mode: 'fixed', fixed_days_by_year: [10, 12] });
    assert.notEqual(validateEntitlementDraft({ mode: 'fixed', rows: ['10', ''] }), '');
    assert.equal(isEntitlementDraftChanged({ mode: 'fixed', fixed_days_by_year: [10, 12] }, { mode: 'fixed', rows: ['10', '12'] }), false);
    assert.equal(isEntitlementDraftChanged({ mode: 'fixed', fixed_days_by_year: [10, 12] }, { mode: 'fixed', rows: ['10', '13'] }), true);
  });

  it('labels the rows and the history', () => {
    assert.equal(seniorityRowLabel(0, 14), 'שנה 1');
    assert.equal(seniorityRowLabel(13, 14), 'שנה 14 ואילך');
    assert.equal(describeEntitlementVersion({ settings_value: { mode: 'legal' } }), 'מומלץ: לפי ותק וימי עבודה');
    assert.equal(describeEntitlementVersion({ settings_value: { mode: 'fixed', fixed_days_by_year: [12, 20] } }), 'כמות קבועה · 12–20 ימים');
  });

  it('the past-date warning of this setting speaks of years, not of pay', () => {
    const [warning] = buildDatedSettingWarnings({ versions: [], effectiveDate: '2026-01-01', today: '2026-11-16', pastDateWarning: 'X' });
    assert.equal(warning, 'X');
  });

  it('the employee choice saves null for the organisation default or a half-day number', () => {
    const ids = { orgId: 'o', employeeId: 'e' };
    assert.deepEqual(buildEntitlementChoiceBody({ choice: 'default' }, ids), { org_id: 'o', instructor_id: 'e', annual_leave_days: null });
    assert.deepEqual(buildEntitlementChoiceBody({ choice: 'manual', manualDays: '14.5' }, ids), { org_id: 'o', instructor_id: 'e', annual_leave_days: 14.5 });
    assert.equal(buildEntitlementChoiceBody({ choice: 'manual', manualDays: '' }, ids), null);
    assert.equal(buildEntitlementChoiceBody({ choice: 'manual', manualDays: '14.3' }, ids), null);
  });

  it('the "חופשה" row sends only the fields that change, both in one body', () => {
    const ids = { orgId: 'o', employeeId: 'e' };
    const stored = { annual_leave_days: null, leave_pay_method: null };
    assert.deepEqual(buildEmployeeLeaveBody({ daysChoice: 'default', manualDays: '', payMethod: '' }, ids, stored), { body: { org_id: 'o', instructor_id: 'e' }, changed: false });
    assert.deepEqual(
      buildEmployeeLeaveBody({ daysChoice: 'manual', manualDays: '9', payMethod: 'fixed_rate' }, ids, stored),
      { body: { org_id: 'o', instructor_id: 'e', annual_leave_days: 9, leave_pay_method: 'fixed_rate' }, changed: true },
    );
    assert.deepEqual(
      buildEmployeeLeaveBody({ daysChoice: 'manual', manualDays: '9', payMethod: '' }, ids, { annual_leave_days: 9, leave_pay_method: 'legal' }),
      { body: { org_id: 'o', instructor_id: 'e', leave_pay_method: null }, changed: true },
    );
    assert.deepEqual(
      buildEmployeeLeaveBody({ daysChoice: 'default', manualDays: '9', payMethod: 'legal' }, ids, { annual_leave_days: 9, leave_pay_method: 'legal' }),
      { body: { org_id: 'o', instructor_id: 'e', annual_leave_days: null }, changed: true },
    );
    assert.equal(buildEmployeeLeaveBody({ daysChoice: 'manual', manualDays: '400', payMethod: '' }, ids, stored), null);
  });

  it('the "חופשה" row reads first as one short line', () => {
    const orgPolicy = { default_method: 'legal', lookback_months: 3 };
    assert.equal(employeeLeaveSummaryText({ annual_leave_days: null, leave_pay_method: null }, orgPolicy), 'ימים: לפי ברירת המחדל · תשלום: לפי ברירת המחדל (ממוצע מומלץ)');
    assert.equal(employeeLeaveSummaryText({ annual_leave_days: 14.5, leave_pay_method: 'fixed_rate' }, orgPolicy), 'ימים: 14.5 בשנה · תשלום: ערך קבוע ליום');
    assert.equal(
      employeeLeaveSummaryText({ annual_leave_days: null, leave_pay_method: null }, { ...orgPolicy, default_method: 'avg_hourly_x_avg_day_hours' }),
      'ימים: לפי ברירת המחדל · תשלום: לפי ברירת המחדל (ממוצע היסטורי)',
    );
  });

  it('step 2 explains each choice with the organisation months', () => {
    const orgPolicy = { default_method: 'legal', lookback_months: 6 };
    assert.equal(describeEmployeeLeavePayChoice('', orgPolicy), 'כמו שאר העובדים בארגון. כרגע: "ממוצע מומלץ".');
    assert.equal(describeEmployeeLeavePayChoice('legal', orgPolicy), 'השכר של 3 החודשים האחרונים (או 3 החודשים המלאים ביותר בשנה האחרונה), לפי ימים קלנדריים.');
    // An old stored 12-month flag changes nothing.
    assert.equal(describeEmployeeLeavePayChoice('', { ...orgPolicy, legal_allow_12m_if_better: false }), 'כמו שאר העובדים בארגון. כרגע: "ממוצע מומלץ".');
    assert.match(describeEmployeeLeavePayChoice('avg_hourly_x_avg_day_hours', orgPolicy), /ב-6 החודשים האחרונים בלבד/);
    assert.match(describeEmployeeLeavePayChoice('fixed_rate', orgPolicy), /סכום קבוע/);
  });
});

describe('"הסבר מלא"', () => {
  it('explains the law in plain sentences from the real figures', () => {
    const result = computeLeaveEntitlement({ employee: employee('2025-02-01'), policy: LEGAL, year: 2026, today: '2026-11-16', daysWorked: 96 });
    const sentences = leaveEntitlementExplanation(result, { name: 'דנה' });
    assert.equal(sentences[0], 'דנה בשנת העבודה השנייה. בשנה מלאה מגיעים 12 ימי חופשה.');
    assert.equal(sentences[1], 'השנה נרשמו עד עכשיו 96 ימי עבודה. שנה מלאה היא 200 ימי עבודה, ולכן מגיעים כרגע 5.76 ימי חופשה.');
    assert.ok(sentences.includes('המספר יגדל ככל שיירשמו עוד ימי עבודה.'));
    assert.ok(sentences.includes('אפשר להוסיף או להוריד ימים לעובד/ת בכל רגע דרך "שינוי יתרה" כאן למעלה.'));
    assert.match(sentences.at(-1), /נחשב יום עבודה שלם, וגם יום חופשה בתשלום \(גם חצי יום\) נחשב יום עבודה; ימי החופשה מחושבים עד שתי ספרות אחרי הנקודה; לפי טבלת שבוע עבודה של 5 ימים/);
    assert.ok(sentences.every((sentence) => !sentence.includes('÷')), 'no formulas');
    assert.ok(sentences.every((sentence) => !/[„”“]/.test(sentence)), 'straight quotes only');
    assert.ok(sentences.every((sentence) => !/חוק/.test(sentence)), 'no legal wording');
  });

  it('explains the fixed table and a manual number', () => {
    const fixed = computeLeaveEntitlement({ employee: employee('2025-02-01'), policy: { mode: 'fixed', fixed_days_by_year: [10, 13] }, year: 2026, today: '2026-11-16' });
    assert.equal(leaveEntitlementExplanation(fixed)[0], 'לפי ההגדרה של הארגון: 13 ימים בשנת הוותק ה-2.');
    const manual = computeLeaveEntitlement({ employee: employee('2025-02-01', null, 20), policy: LEGAL, year: 2026, today: '2026-11-16' });
    assert.equal(leaveEntitlementExplanation(manual)[0], 'נקבע ידנית לעובד/ת: 20 ימי חופשה בשנה.');
    assert.equal(leaveEntitlementExplanation(manual).length, 2, 'no legal assumptions for a manual number');
  });
});

describe('days to the next leave day', () => {
  // Year 1 on a 5-day week: 12 days a year, 200 days for the whole year, so a worked day earns
  // 12 / 200 = 0.06 of a leave day.
  const base = { seniorityYear: 1, weekDays: 5, employedWholeYear: true };

  it('counts down to the next whole number: 0.36 (6 days) -> 11 more, 1.02 is reached at 17 days', () => {
    assert.equal(legalShareOfYear({ ...base, daysCounted: 6 }).net, 0.36);
    assert.equal(legalShareOfYear({ ...base, daysCounted: 17 }).net, 1.02);
    assert.equal(daysToNextLeaveDay({ ...base, daysCounted: 0 }), 17);
    assert.equal(daysToNextLeaveDay({ ...base, daysCounted: 3 }), 14);
    assert.equal(daysToNextLeaveDay({ ...base, daysCounted: 6 }), 11);
    assert.equal(daysToNextLeaveDay({ ...base, daysCounted: 16 }), 1);
  });

  it('past a whole number the target is the next one: 17 days (1.02) -> 2 is at 34 days', () => {
    assert.equal(legalShareOfYear({ ...base, daysCounted: 34 }).net, 2.04);
    assert.equal(daysToNextLeaveDay({ ...base, daysCounted: 17 }), 17);
    assert.equal(daysToNextLeaveDay({ ...base, daysCounted: 30 }), 4);
  });

  it('stops at the full year when that comes first', () => {
    assert.equal(legalShareOfYear({ ...base, daysCounted: 195 }).net, 11.7);
    assert.equal(daysToNextLeaveDay({ ...base, daysCounted: 195 }), 5);
    assert.equal(daysToNextLeaveDay({ ...base, daysCounted: 199 }), 1);
    assert.equal(daysToNextLeaveDay({ ...base, daysCounted: 200 }), null);
    assert.equal(daysToNextLeaveDay({ ...base, employedWholeYear: false, daysCounted: 239 }), 1);
  });

  it('seniority year 7 (15 days a year): 0 days worked -> 14 (14 x 15 / 200 = 1.05); 1 day worked -> 13 more', () => {
    const year7 = { seniorityYear: 7, weekDays: 5, employedWholeYear: true };
    assert.equal(daysToNextLeaveDay({ ...year7, daysCounted: 0 }), 14);
    assert.equal(daysToNextLeaveDay({ ...year7, daysCounted: 1 }), 13);
  });

  it('is returned with the entitlement only while the year is growing', () => {
    const growing = computeLeaveEntitlement({ employee: employee('2020-01-01'), policy: LEGAL, year: 2026, today: '2026-11-16', daysWorked: 30 });
    assert.equal(growing.days_to_next_leave_day, daysToNextLeaveDay({ seniorityYear: 7, weekDays: 5, employedWholeYear: true, daysCounted: 30 }));
    assert.ok(growing.days_to_next_leave_day > 0);
    const full = computeLeaveEntitlement({ employee: employee('2020-01-01'), policy: LEGAL, year: 2026, today: '2026-11-16', daysWorked: 200 });
    assert.equal(full.days_to_next_leave_day, null);
    const past = computeLeaveEntitlement({ employee: employee('2020-01-01'), policy: LEGAL, year: 2024, today: '2026-11-16', daysWorked: 30 });
    assert.equal(past.days_to_next_leave_day, null);
    const manual = computeLeaveEntitlement({ employee: employee('2020-01-01', null, 20), policy: LEGAL, year: 2026, today: '2026-11-16' });
    assert.equal(manual.days_to_next_leave_day, undefined);
  });
});

describe('days are kept to 2 decimals, not rounded down', () => {
  it('3 of 200 days of a 12-day year is 0.18, 15 days is 0.9, and the full year gives the whole table value', () => {
    assert.equal(legalShareOfYear({ seniorityYear: 1, weekDays: 5, employedWholeYear: true, daysCounted: 3 }).net, 0.18);
    assert.equal(legalShareOfYear({ seniorityYear: 1, weekDays: 5, employedWholeYear: true, daysCounted: 15 }).net, 0.9);
    assert.equal(legalShareOfYear({ seniorityYear: 1, weekDays: 5, employedWholeYear: true, daysCounted: 200 }).net, 12);
  });
});
