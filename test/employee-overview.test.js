import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { availabilityFacts, employmentScopeText, workingDaysText } from '../src/components/settings/employee-management/employee-overview.js';

describe('the availability facts of the employee overview', () => {
  it('lists the working days in week order, from an array or { days }', () => {
    assert.equal(workingDaysText([3, 0, 1]), 'ראשון, שני, רביעי');
    assert.equal(workingDaysText({ days: [2, 2, 4] }), 'שלישי, חמישי');
    assert.equal(workingDaysText([]), '');
    assert.equal(workingDaysText(null), '');
  });

  it('names the employment scope, keeps an unknown one as typed, and is empty when not set', () => {
    assert.equal(employmentScopeText('hourly'), 'שעתי');
    assert.equal(employmentScopeText('global'), 'גלובלי');
    assert.equal(employmentScopeText('משרה חלקית'), 'משרה חלקית');
    assert.equal(employmentScopeText(null), '');
    assert.equal(employmentScopeText('  '), '');
  });

  it('shows only what is set: both, one, or nothing', () => {
    assert.deepEqual(availabilityFacts({ working_days: [0, 1], employment_scope: 'hourly' }).map((fact) => [fact.label, fact.value]), [
      ['ימי עבודה', 'ראשון, שני'],
      ['היקף העסקה', 'שעתי'],
    ]);
    assert.deepEqual(availabilityFacts({ working_days: [], employment_scope: 'hourly' }).map((fact) => fact.key), ['employment_scope']);
    assert.deepEqual(availabilityFacts({ working_days: [5] }).map((fact) => fact.key), ['working_days']);
    assert.deepEqual(availabilityFacts({ working_days: null, employment_scope: null }), []);
    assert.deepEqual(availabilityFacts(null), []);
  });
});
