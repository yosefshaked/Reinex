// Hebrew business copy that a server helper builds into a whole 4xx body (docs/project-rules/20,
// "Showing an error"; docs/project-rules/30): the helper marks it where the wording is written, and
// the real body, sent through `respond` and read back as the browser reads it, reaches every display
// path with its business detail. Unmarked text (a catch, a provider, a DB) still gets the default.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { respond } from '../api/_shared/org-bff.js';
import { USER_MESSAGE_KIND, withUserMessage } from '../api/_shared/user-message.js';
import { checkRequestedLessonStart, LESSON_TIME_SKIPPED_CODE } from '../api/_shared/clock-change-rules.js';
import { checkInstructorRateForLesson, checkTemplateInstructorRate } from '../api/_shared/employee-finance.js';
import { DEFAULT_ORG_TIME_ZONE } from '../api/_shared/local-time.js';
import { PAY_BASIS } from '../api/_shared/rate-history.js';
import {
  INVALID_VERIFY_MESSAGE,
  OTP_INVALID_OR_EXPIRED_MESSAGE,
  VERIFY_LOCKDOWN_MESSAGE,
  invalidVerifyBody,
  otpInvalidOrExpiredBody,
  verifyLockdownBody,
} from '../api/form-submissions/verify-responses.js';
import { readMissingLessonRate, resolveMutationError } from '../src/features/calendar/utils/lessonDialogModel.js';
import {
  USER_MESSAGE_KIND as FRONTEND_USER_MESSAGE_KIND,
  createSupportAwareApiError,
  describeError,
  formatErrorDetailsForCopy,
} from '../src/lib/error-support.js';

const ORG = '11111111-1111-4111-8111-111111111111';
// The org's default zone, where the clock skips 02:00 to 03:00 on 27.3.2026.
const ZONE = DEFAULT_ORG_TIME_ZONE;
const SAVE_FALLBACK = 'שמירת השיעור נכשלה.';

/** What the browser gets: the body as `respond` serialises it, parsed, as an API error. */
function throughTheWire(status, body) {
  const context = {};
  respond(context, status, body);
  const parsed = JSON.parse(context.res.body);
  return { parsed, error: createSupportAwareApiError(parsed, context.res.status) };
}

/** Every place a user reads this error, and the copy for support, must carry the same text. */
function assertShownEverywhere(error, expected) {
  assert.equal(error.message, expected, 'the plain error text (template hooks, toasts)');
  assert.equal(resolveMutationError(error, SAVE_FALLBACK), expected, 'the lesson dialogs');
  const details = describeError(error, { fallback: SAVE_FALLBACK });
  assert.equal(details.message, expected, 'ErrorDetails / toast.apiError');
  assert.equal(details.specific, true);
  assert.ok(formatErrorDetailsForCopy(details).startsWith(`פרטי שגיאה לתמיכה\nהודעה: ${expected}\n`), 'the copy for support');
}

function createFakeClient(tables) {
  function builder(table) {
    const filters = [];
    const api = {
      select() { return api; },
      eq(column, value) { filters.push((row) => row[column] === value); return api; },
      in(column, values) { filters.push((row) => values.includes(row[column])); return api; },
      order() { return api; },
      range() { return api; },
      maybeSingle() {
        const row = (tables[table] || []).find((candidate) => filters.every((filter) => filter(candidate))) || null;
        return Promise.resolve({ data: row, error: null });
      },
      then(resolve, reject) {
        const rows = (tables[table] || []).filter((row) => filters.every((filter) => filter(row)));
        return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      },
    };
    return api;
  }
  return { from: builder };
}

function rateTables(rates = []) {
  return {
    Employees: [{ id: 'noa', org_id: ORG, first_name: 'נועה', last_name: 'לוי' }],
    Services: [{ id: 'riding', org_id: ORG, name: 'רכיבה' }],
    RateHistory: rates.map((row) => ({ org_id: ORG, employee_id: 'noa', service_id: 'riding', ...row })),
  };
}

describe('the marker is one contract between the API and the frontend', () => {
  it('the server helper sets exactly what the frontend reads', () => {
    assert.equal(USER_MESSAGE_KIND, FRONTEND_USER_MESSAGE_KIND);
    assert.equal(withUserMessage({ message: 'x' }).message_kind, FRONTEND_USER_MESSAGE_KIND);
  });
});

describe('a lesson start in the hour the clock skips (spring forward)', () => {
  const request = { start_local_date: '2026-03-27', start_local_time: '02:30' };

  it('the helper marks its own wording', () => {
    const body = checkRequestedLessonStart(request, ZONE);
    assert.equal(body.code, LESSON_TIME_SKIPPED_CODE);
    assert.equal(body.message_kind, USER_MESSAGE_KIND);
  });

  it('the user reads between which hours the clock jumps, on every screen and in the copy', () => {
    const body = checkRequestedLessonStart(request, ZONE);
    const { parsed, error } = throughTheWire(422, body);
    assert.equal(parsed.message_kind, USER_MESSAGE_KIND, 'the marker survives serialisation');
    assert.match(parsed.message, /02:00/);
    assert.match(parsed.message, /03:00/);
    assertShownEverywhere(error, parsed.message);
    assert.deepEqual(parsed.clock_change, { date: '2026-03-27', kind: 'skipped', start_time: '02:00', end_time: '03:00' });
  });

  it('without the marker (an older server) the hours are not trusted and the user gets the default', () => {
    const unmarked = { ...checkRequestedLessonStart(request, ZONE) };
    delete unmarked.message_kind;
    const { error } = throughTheWire(422, unmarked);
    assert.equal(describeError(error, { fallback: SAVE_FALLBACK }).message, `${SAVE_FALLBACK} (${LESSON_TIME_SKIPPED_CODE})`);
  });
});

describe('an instructor without a rate for the lesson date', () => {
  const params = { orgId: ORG, instructorEmployeeId: 'noa', serviceId: 'riding', lessonDate: '2026-10-06T08:00:00Z' };

  it('no rate at all: the instruction, the path and the lesson date reach every screen', async () => {
    const result = await checkInstructorRateForLesson(createFakeClient(rateTables()), params);
    assert.equal(result.status, 422);
    assert.equal(result.body.message_kind, USER_MESSAGE_KIND, 'the helper marks its own wording');
    const { parsed, error } = throughTheWire(result.status, result.body);
    assert.match(parsed.message, /06\.10\.2026/, 'the lesson date');
    assert.match(parsed.message, /עובדים ← נועה לוי ← פיננסים ← הוספת תעריף/, 'where to add the rate');
    assertShownEverywhere(error, parsed.message);
    assert.deepEqual(readMissingLessonRate(error), {
      instructorEmployeeId: 'noa',
      serviceId: 'riding',
      rateDate: '2026-10-06',
      message: parsed.message,
    });
  });

  it('a rate that starts after the lesson: both dates and the fix are kept', async () => {
    const rates = [{ id: 'noa-later', pay_basis: PAY_BASIS.LESSON_HOURLY, rate: 9000, effective_date: '2026-11-01' }];
    const result = await checkInstructorRateForLesson(createFakeClient(rateTables(rates)), params);
    const { parsed, error } = throughTheWire(result.status, result.body);
    assert.equal(parsed.next_rate_date, '2026-11-01');
    assert.match(parsed.message, /רק מ-01\.11\.2026/);
    assert.match(parsed.message, /ב-06\.10\.2026/);
    assert.match(parsed.message, /← עדכון תעריף\.$/);
    assertShownEverywhere(error, parsed.message);
    assert.equal(readMissingLessonRate(error).message, parsed.message);
  });

  it('a recurring template uses the same marked body', async () => {
    const result = await checkTemplateInstructorRate(createFakeClient(rateTables()), ORG, {
      instructorEmployeeId: 'noa', serviceId: 'riding', validFrom: '2026-12-01', today: '2026-11-26',
    });
    assert.equal(result.body.message_kind, USER_MESSAGE_KIND);
    assert.match(result.body.message, /01\.12\.2026/);
  });

  it('a failed lookup (the catch path) is never marked', async () => {
    const brokenClient = { from() { throw new Error('relation "RateHistory" does not exist'); } };
    const result = await checkInstructorRateForLesson(brokenClient, params, { log: { error() {} } });
    assert.equal(result.status, 500);
    assert.equal(result.body.message_kind, undefined);
  });
});

describe('a failed public-form verification', () => {
  const cases = [
    ['the id or code does not match', 401, invalidVerifyBody, INVALID_VERIFY_MESSAGE, 'מזהה או קוד אימות שגויים'],
    ['the one-time code is wrong or expired', 401, otpInvalidOrExpiredBody, OTP_INVALID_OR_EXPIRED_MESSAGE, 'קוד האימות שגוי או שפג תוקפו'],
    ['too many failures (lockdown)', 429, verifyLockdownBody, VERIFY_LOCKDOWN_MESSAGE,
      'מטעמי אבטחה, כל הקישורים הפעילים עבור תלמיד זה בוטלו עקב יותר מדי נסיונות כושלים. יש ליצור קשר עם המרפאה לקבלת קוד חדש.'],
  ];

  for (const [name, status, build, constant, wording] of cases) {
    it(`${name}: the response keeps its wording and carries the marker`, () => {
      assert.equal(constant, wording, 'the wording is unchanged');
      const { parsed, error } = throughTheWire(status, build());
      assert.deepEqual(parsed, { message: wording, message_kind: USER_MESSAGE_KIND });
      assert.equal(describeError(error).message, wording);
    });
  }

  it('the endpoint sends every verification failure through these bodies, never the bare message', () => {
    const source = readFileSync(new URL('../api/form-submissions/index.js', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /_MESSAGE\s*\}/, 'no { message: <constant> } body is left');
    assert.equal(source.match(/respond\(context, 401, invalidVerifyBody\(\)\)/g)?.length, 9);
    assert.equal(source.match(/respond\(context, 401, otpInvalidOrExpiredBody\(\)\)/g)?.length, 1);
    assert.equal(source.match(/respond\(context, 429, verifyLockdownBody\(\)\)/g)?.length, 5);
  });
});

describe('the regression: technical text mixed with Hebrew is still not shown', () => {
  it('a 422 with DB text and Hebrew, unmarked, gets the default on screen and in the copy', () => {
    const { error } = throughTheWire(422, { message: 'DB detail: דוגמה פנימית' });
    const details = describeError(error, { fallback: SAVE_FALLBACK });
    assert.equal(details.message, `${SAVE_FALLBACK} (HTTP 422)`);
    assert.ok(!formatErrorDetailsForCopy(details).includes('DB detail'));
    assert.ok(!resolveMutationError(error, SAVE_FALLBACK).includes('DB detail'));
  });

  it('the rate code with forwarded DB text, unmarked, keeps the code but not the text', () => {
    const { error } = throughTheWire(422, {
      code: 'instructor_rate_not_configured',
      instructor_employee_id: 'noa',
      service_id: 'riding',
      rate_date: '2026-10-06',
      message: 'DB detail: דוגמה פנימית',
    });
    assert.equal(describeError(error, { fallback: SAVE_FALLBACK }).message, `${SAVE_FALLBACK} (instructor_rate_not_configured)`);
    const missing = readMissingLessonRate(error);
    assert.equal(missing.message, 'למדריך/ה אין תעריף על השירות הזה בתאריך הזה.');
    assert.ok(!error.message.includes('DB detail'));
  });
});
