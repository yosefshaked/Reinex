import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BALANCE_REASONS, OFFERED_BALANCE_EVENT_TYPES, readBalanceReason } from '../api/_shared/leave-balance-reason.js';
import {
  BALANCE_ACTIONS,
  BALANCE_REASON_OPTIONS,
  balanceFormError,
  balanceQuantityError,
  buildBalanceEventBody,
  defaultBalanceDate,
  describeBalanceEvent,
  emptyBalanceForm,
} from '../src/components/settings/employee-management/attendance-month-grid.js';

describe('a manual leave-balance change needs a reason', () => {
  it('offers carry-over and add-or-remove only', () => {
    assert.deepEqual([...OFFERED_BALANCE_EVENT_TYPES], ['carryover', 'adjustment']);
    assert.deepEqual(BALANCE_ACTIONS.map((action) => action.value), ['carryover', 'adjustment']);
    assert.deepEqual(BALANCE_ACTIONS.map((action) => action.label), ['העברה מהשנה הקודמת', 'הוספה או הורדה']);
  });

  it('the server and the screen agree on the four reasons', () => {
    assert.deepEqual(BALANCE_REASON_OPTIONS.map((option) => option.label), Object.values(BALANCE_REASONS));
    assert.deepEqual(BALANCE_REASON_OPTIONS.map((option) => option.label), ['מעבר מהמערכת הקודמת', 'סוכם עם העובד/ת', 'תיקון טעות', 'אחר']);
  });

  it('the server refuses a missing or unknown reason, and "other" without text', () => {
    assert.equal(readBalanceReason({}).error, 'missing_balance_reason');
    assert.equal(readBalanceReason({ reason: 'whatever' }).error, 'missing_balance_reason');
    assert.equal(readBalanceReason({ reason: 'other', notes: '   ' }).error, 'missing_balance_reason_text');
    assert.deepEqual(readBalanceReason({ reason: 'other', notes: ' הסכם ' }), { reason: 'other', notes: 'הסכם' });
    assert.deepEqual(readBalanceReason({ reason: 'previous_system' }), { reason: 'previous_system', notes: null });
  });

  it('the form blocks a zero amount, a negative carry-over, a missing reason and an empty "other"', () => {
    const form = { ...emptyBalanceForm(), quantityDays: '2', reason: 'agreed_with_employee' };
    assert.equal(balanceFormError(form), '');
    assert.notEqual(balanceFormError({ ...form, quantityDays: '' }), '');
    assert.notEqual(balanceFormError({ ...form, quantityDays: '0' }), '');
    assert.notEqual(balanceFormError({ ...form, quantityDays: '-1' }), '');
    assert.equal(balanceFormError({ ...form, eventType: 'adjustment', quantityDays: '-1' }), '');
    assert.notEqual(balanceFormError({ ...form, reason: '' }), '');
    assert.notEqual(balanceFormError({ ...form, reason: 'other', notes: '' }), '');
    assert.equal(balanceFormError({ ...form, reason: 'other', notes: 'x' }), '');
  });

  it('the request carries the reason and its text', () => {
    const body = buildBalanceEventBody(
      { ...emptyBalanceForm(), eventType: 'adjustment', quantityDays: '-1.5', reason: 'other', notes: ' סיכום בעל פה ' },
      { orgId: 'o', employeeId: 'e', effectiveDate: '2026-01-01' },
    );
    assert.equal(body.event_type, 'adjustment');
    assert.equal(body.quantity_days, -1.5);
    assert.equal(body.reason, 'other');
    assert.equal(body.notes, 'סיכום בעל פה');
  });

  it('the history shows the reason, who and when; an older row without a reason stays readable', () => {
    const line = describeBalanceEvent({
      event_type: 'adjustment', quantity_days: -2, effective_date: '2026-03-01', created_at: '2026-03-02T08:00:00Z',
      created_by_name: 'דנה כהן', notes: 'סיכום בעל פה', metadata: { reason: 'other' },
    });
    assert.equal(line.title, '2026-03-01 · הוספה או הורדה · -2');
    assert.equal(line.reason, 'אחר: סיכום בעל פה');
    assert.equal(line.who, 'דנה כהן · 2026-03-02');
    const old = describeBalanceEvent({ event_type: 'allocation', quantity_days: 3, effective_date: '2026-01-01', notes: 'ישן', metadata: {} });
    assert.equal(old.title, '2026-01-01 · הקצאה · +3');
    assert.equal(old.reason, 'ישן');
    const picked = describeBalanceEvent({ event_type: 'carryover', quantity_days: 4, effective_date: '2026-01-01', metadata: { reason: 'previous_system' } });
    assert.equal(picked.reason, 'מעבר מהמערכת הקודמת');
  });
});

describe('the reason shown under the number of days', () => {
  it('a negative carry-over and a zero add-or-remove say why, and point to the other action', () => {
    const form = { ...emptyBalanceForm(), reason: 'previous_system' };
    assert.equal(balanceQuantityError({ ...form, quantityDays: '' }), '');
    assert.equal(balanceQuantityError({ ...form, quantityDays: '2' }), '');
    assert.equal(
      balanceQuantityError({ ...form, quantityDays: '-1' }),
      'העברה מהשנה הקודמת היא רק מספר חיובי. להורדת ימים בחרו "הוספה או הורדה".',
    );
    assert.equal(balanceFormError({ ...form, quantityDays: '-1' }), balanceQuantityError({ ...form, quantityDays: '-1' }));
    assert.match(balanceQuantityError({ ...form, eventType: 'adjustment', quantityDays: '0' }), /לא יכולה להיות 0/);
    assert.equal(balanceQuantityError({ ...form, eventType: 'adjustment', quantityDays: '-1' }), '');
  });
});

describe('the default date of a balance change', () => {
  it('is today when today is in the year shown, otherwise 1 January of that year', () => {
    assert.equal(defaultBalanceDate(2026, '2026-11-18'), '2026-11-18');
    assert.equal(defaultBalanceDate(2025, '2026-11-18'), '2025-01-01');
    assert.equal(defaultBalanceDate(2026, ''), '2026-01-01');
  });
});
