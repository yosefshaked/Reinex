/* eslint-env node */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PAY_BASIS,
  buildRateChangeWarnings,
  normalizeRateRow,
  resolveLessonRateOnDate,
  resolveRateOnDate,
  toRateDateKey,
  validateRateInput,
} from './rate-history.js';

const DANA = 'employee-dana';
const OMER = 'employee-omer';
const RIDING = 'service-riding';
const GROUP = 'service-group';

function rate(overrides) {
  return {
    id: overrides.id,
    employee_id: overrides.employee_id ?? DANA,
    service_id: overrides.service_id ?? null,
    pay_basis: overrides.pay_basis,
    rate: overrides.rate,
    effective_date: overrides.effective_date,
    created_at: overrides.created_at ?? '2026-01-01T00:00:00.000Z',
  };
}

const ROWS = [
  rate({ id: 'riding-100', service_id: RIDING, pay_basis: PAY_BASIS.LESSON_HOURLY, rate: 10000, effective_date: '2026-01-01' }),
  rate({ id: 'riding-120', service_id: RIDING, pay_basis: PAY_BASIS.LESSON_HOURLY, rate: 12000, effective_date: '2026-10-01' }),
  rate({ id: 'group-flat', service_id: GROUP, pay_basis: PAY_BASIS.LESSON_FLAT, rate: 9000, effective_date: '2026-01-01' }),
  rate({ id: 'office-hourly', pay_basis: PAY_BASIS.ATTENDANCE_HOURLY, rate: 5000, effective_date: '2026-01-01' }),
  rate({ id: 'omer-riding', employee_id: OMER, service_id: RIDING, pay_basis: PAY_BASIS.LESSON_HOURLY, rate: 11000, effective_date: '2026-01-01' }),
];

test('the rate in effect is the latest row on or before the date, until the next change', () => {
  const lookup = (date) => resolveRateOnDate(ROWS, { employeeId: DANA, payBasis: PAY_BASIS.LESSON_HOURLY, serviceId: RIDING, date })?.id;
  assert.equal(lookup('2025-12-31'), undefined, 'nothing before the first rate');
  assert.equal(lookup('2026-01-01'), 'riding-100');
  assert.equal(lookup('2026-09-30'), 'riding-100', 'a future change does not apply before its date');
  assert.equal(lookup('2026-10-01'), 'riding-120');
  assert.equal(lookup('2027-03-15'), 'riding-120');
});

test('two rates on the same date resolve to the most recently created one', () => {
  const rows = [
    rate({ id: 'first', pay_basis: PAY_BASIS.MONTHLY_SALARY, rate: 700000, effective_date: '2026-05-01', created_at: '2026-04-20T08:00:00.000Z' }),
    rate({ id: 'corrected', pay_basis: PAY_BASIS.MONTHLY_SALARY, rate: 720000, effective_date: '2026-05-01', created_at: '2026-04-20T09:00:00.000Z' }),
  ];
  assert.equal(resolveRateOnDate(rows, { employeeId: DANA, payBasis: PAY_BASIS.MONTHLY_SALARY, date: '2026-06-01' }).id, 'corrected');
});

test('there is no fallback between kinds, services or employees', () => {
  assert.equal(resolveRateOnDate(ROWS, { employeeId: DANA, payBasis: PAY_BASIS.MONTHLY_SALARY, date: '2026-06-01' }), null, 'no salary row');
  assert.equal(resolveRateOnDate(ROWS, { employeeId: DANA, payBasis: PAY_BASIS.ATTENDANCE_HOURLY, date: '2026-06-01' }).id, 'office-hourly');
  assert.equal(resolveRateOnDate(ROWS, { employeeId: DANA, payBasis: PAY_BASIS.LESSON_HOURLY, serviceId: 'service-other', date: '2026-06-01' }), null);
  assert.equal(resolveRateOnDate(ROWS, { employeeId: DANA, payBasis: PAY_BASIS.LESSON_HOURLY, date: '2026-06-01' }), null, 'lesson kinds need a service');
  assert.equal(resolveLessonRateOnDate(ROWS, { employeeId: OMER, serviceId: RIDING, date: '2026-06-01' }).id, 'omer-riding');
});

test('the lesson rate is hourly or flat, whichever lesson row is in effect for the service', () => {
  assert.equal(resolveLessonRateOnDate(ROWS, { employeeId: DANA, serviceId: GROUP, date: '2026-06-01' }).pay_basis, PAY_BASIS.LESSON_FLAT);
  const switched = [
    ...ROWS,
    rate({ id: 'group-hourly', service_id: GROUP, pay_basis: PAY_BASIS.LESSON_HOURLY, rate: 8000, effective_date: '2026-08-01' }),
  ];
  assert.equal(resolveLessonRateOnDate(switched, { employeeId: DANA, serviceId: GROUP, date: '2026-07-31' }).id, 'group-flat');
  assert.equal(resolveLessonRateOnDate(switched, { employeeId: DANA, serviceId: GROUP, date: '2026-08-01' }).id, 'group-hourly');
});

test('lesson timestamps map to their Israel calendar date', () => {
  assert.equal(toRateDateKey('2026-10-01'), '2026-10-01');
  assert.equal(toRateDateKey('2026-09-30T21:30:00.000Z'), '2026-10-01', '00:30 in Israel on 1.10');
  assert.equal(toRateDateKey('2026-10-01T09:00:00.000Z'), '2026-10-01');
  assert.equal(toRateDateKey(null), '');
});

test('a new rate is validated before it is saved', () => {
  const valid = validateRateInput({ employeeId: DANA, payBasis: PAY_BASIS.LESSON_HOURLY, serviceId: RIDING, rate: 12000, effectiveDate: '2026-10-01' });
  assert.deepEqual(valid.value, { employeeId: DANA, payBasis: PAY_BASIS.LESSON_HOURLY, serviceId: RIDING, rate: 12000, effectiveDate: '2026-10-01' });

  const cases = [
    [{ payBasis: PAY_BASIS.MONTHLY_SALARY, rate: 1, effectiveDate: '2026-10-01' }, 'missing_employee_id'],
    [{ employeeId: DANA, payBasis: 'bonus', rate: 1, effectiveDate: '2026-10-01' }, 'invalid_pay_basis'],
    [{ employeeId: DANA, payBasis: PAY_BASIS.LESSON_FLAT, rate: 1, effectiveDate: '2026-10-01' }, 'missing_service_id'],
    [{ employeeId: DANA, payBasis: PAY_BASIS.MONTHLY_SALARY, serviceId: RIDING, rate: 1, effectiveDate: '2026-10-01' }, 'service_not_allowed_for_pay_basis'],
    [{ employeeId: DANA, payBasis: PAY_BASIS.MONTHLY_SALARY, rate: -1, effectiveDate: '2026-10-01' }, 'invalid_rate'],
    [{ employeeId: DANA, payBasis: PAY_BASIS.MONTHLY_SALARY, rate: 10.5, effectiveDate: '2026-10-01' }, 'invalid_rate'],
    [{ employeeId: DANA, payBasis: PAY_BASIS.MONTHLY_SALARY, rate: 1, effectiveDate: '1.10.2026' }, 'invalid_effective_date'],
  ];
  for (const [input, expected] of cases) {
    assert.equal(validateRateInput(input).error, expected, expected);
  }
  assert.equal(validateRateInput({ employeeId: DANA, payBasis: PAY_BASIS.MONTHLY_SALARY, rate: 0, effectiveDate: '2026-10-01' }).value.rate, 0, 'zero is a valid rate');
});

test('saving a rate warns about past dates, earlier dates and an existing rate on that date', () => {
  const today = '2026-09-22';
  const warnFor = (effectiveDate) => buildRateChangeWarnings(
    ROWS,
    { employeeId: DANA, payBasis: PAY_BASIS.LESSON_HOURLY, serviceId: RIDING, effectiveDate },
    today,
  );

  assert.deepEqual(warnFor('2026-11-01').warnings, [], 'a future date is the normal case');
  assert.deepEqual(warnFor('2026-09-01').warnings, ['effective_date_in_past']);
  assert.deepEqual(warnFor('2025-06-01').warnings, ['effective_date_in_past', 'effective_date_before_current_rate']);
  assert.deepEqual(warnFor('2026-01-01').warnings, ['effective_date_in_past', 'rate_exists_on_date']);

  const context = warnFor('2026-11-01');
  assert.equal(context.currentRate.id, 'riding-100', 'the rate in effect today');
  assert.equal(context.nextRate.id, 'riding-120', 'the next scheduled rate');
  assert.equal(context.existingOnDate, null);
  assert.deepEqual(context.history.map((row) => row.id), ['riding-100', 'riding-120']);
});

test('invalid rows and dates are ignored', () => {
  assert.equal(normalizeRateRow({ pay_basis: 'bonus', rate: 1, effective_date: '2026-01-01' }), null);
  assert.equal(normalizeRateRow({ pay_basis: 'monthly_salary', rate: 1, effective_date: 'soon' }), null);
  assert.equal(resolveRateOnDate(ROWS, { employeeId: DANA, payBasis: PAY_BASIS.ATTENDANCE_HOURLY, date: 'not-a-date' }), null);
  assert.equal(resolveRateOnDate(ROWS, { employeeId: DANA, payBasis: 'bonus', date: '2026-06-01' }), null);
});
