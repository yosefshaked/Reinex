/* eslint-env node */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { breakTemplateMatchesDate, normalizeBreakTemplateTime } from '../api/_shared/break-template-schedule.js';

// ── breakTemplateMatchesDate ──────────────────────────────────────────────

describe('breakTemplateMatchesDate — guard clauses', () => {
  it('returns false when template is null', () => {
    assert.equal(breakTemplateMatchesDate(null, '2026-06-01'), false);
  });

  it('returns false when date is empty', () => {
    assert.equal(breakTemplateMatchesDate({ day_of_week: 'monday' }, ''), false);
  });

  it('returns false when date is null', () => {
    assert.equal(breakTemplateMatchesDate({ day_of_week: 'monday' }, null), false);
  });
});

describe('breakTemplateMatchesDate — day-of-week matching', () => {
  // 2026-06-01 is a Monday
  it('returns true on the correct weekday', () => {
    assert.equal(breakTemplateMatchesDate({ day_of_week: 'monday' }, '2026-06-01'), true);
  });

  it('returns false on the wrong weekday', () => {
    assert.equal(breakTemplateMatchesDate({ day_of_week: 'sunday' }, '2026-06-01'), false);
  });

  // 2026-06-07 is a Sunday
  it('returns true for sunday template on a Sunday', () => {
    assert.equal(breakTemplateMatchesDate({ day_of_week: 'sunday' }, '2026-06-07'), true);
  });

  // 2026-06-05 is a Friday
  it('returns true for friday template on a Friday', () => {
    assert.equal(breakTemplateMatchesDate({ day_of_week: 'friday' }, '2026-06-05'), true);
  });

  it('returns false when day_of_week is missing', () => {
    assert.equal(breakTemplateMatchesDate({ day_of_week: null }, '2026-06-01'), false);
  });
});

describe('breakTemplateMatchesDate — valid_from boundary', () => {
  const template = { day_of_week: 'monday', valid_from: '2026-06-01' };

  it('returns true on valid_from date itself', () => {
    assert.equal(breakTemplateMatchesDate(template, '2026-06-01'), true);
  });

  it('returns true after valid_from', () => {
    assert.equal(breakTemplateMatchesDate(template, '2026-06-08'), true);
  });

  it('returns false before valid_from', () => {
    assert.equal(breakTemplateMatchesDate(template, '2026-05-25'), false);
  });
});

describe('breakTemplateMatchesDate — valid_until boundary', () => {
  const template = { day_of_week: 'monday', valid_until: '2026-06-08' };

  it('returns true on valid_until date itself', () => {
    assert.equal(breakTemplateMatchesDate(template, '2026-06-08'), true);
  });

  it('returns false after valid_until', () => {
    assert.equal(breakTemplateMatchesDate(template, '2026-06-15'), false);
  });

  it('returns true before valid_until', () => {
    assert.equal(breakTemplateMatchesDate(template, '2026-06-01'), true);
  });
});

describe('breakTemplateMatchesDate — valid_from + valid_until window', () => {
  const template = { day_of_week: 'wednesday', valid_from: '2026-06-03', valid_until: '2026-06-17' };

  // 2026-06-03 is a Wednesday
  it('returns true on the first Wednesday inside the window', () => {
    assert.equal(breakTemplateMatchesDate(template, '2026-06-03'), true);
  });

  // 2026-06-17 is a Wednesday
  it('returns true on the last Wednesday inside the window', () => {
    assert.equal(breakTemplateMatchesDate(template, '2026-06-17'), true);
  });

  // 2026-05-27 is a Wednesday but before valid_from
  it('returns false on a Wednesday before valid_from', () => {
    assert.equal(breakTemplateMatchesDate(template, '2026-05-27'), false);
  });

  // 2026-06-24 is a Wednesday but after valid_until
  it('returns false on a Wednesday after valid_until', () => {
    assert.equal(breakTemplateMatchesDate(template, '2026-06-24'), false);
  });

  // 2026-06-10 is a Wednesday inside the window
  it('returns true for a Wednesday inside the full window', () => {
    assert.equal(breakTemplateMatchesDate(template, '2026-06-10'), true);
  });
});

describe('breakTemplateMatchesDate — null valid_from and valid_until mean unbounded', () => {
  // 2026-06-01 is a Monday
  it('null valid_from does not block past dates', () => {
    const t = { day_of_week: 'monday', valid_from: null };
    assert.equal(breakTemplateMatchesDate(t, '2020-01-06'), true); // 2020-01-06 is a Monday
  });

  it('null valid_until does not block future dates', () => {
    const t = { day_of_week: 'monday', valid_until: null };
    assert.equal(breakTemplateMatchesDate(t, '2030-01-07'), true); // 2030-01-07 is a Monday
  });

  it('both null — matches any correct weekday', () => {
    const t = { day_of_week: 'thursday', valid_from: null, valid_until: null };
    assert.equal(breakTemplateMatchesDate(t, '2026-06-04'), true); // 2026-06-04 is a Thursday
  });
});

// ── normalizeBreakTemplateTime ────────────────────────────────────────────

describe('normalizeBreakTemplateTime — postgres time normalisation', () => {
  it('strips seconds from HH:MM:SS format', () => {
    assert.equal(normalizeBreakTemplateTime('09:30:00'), '09:30');
  });

  it('passes through HH:MM format unchanged', () => {
    assert.equal(normalizeBreakTemplateTime('14:00'), '14:00');
  });

  it('returns empty string for null', () => {
    assert.equal(normalizeBreakTemplateTime(null), '');
  });

  it('returns empty string for undefined', () => {
    assert.equal(normalizeBreakTemplateTime(undefined), '');
  });

  it('returns empty string for empty string', () => {
    assert.equal(normalizeBreakTemplateTime(''), '');
  });

  it('handles midnight correctly', () => {
    assert.equal(normalizeBreakTemplateTime('00:00:00'), '00:00');
  });
});
