/* eslint-env node */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLessonHistoryEvents,
  collectLessonHistoryReferenceIds,
  LESSON_HISTORY_EVENT_LIMIT,
} from './lesson-history.js';

const LESSON_ID = '11111111-1111-4111-8111-111111111111';
const YAEL = '22222222-2222-4222-8222-222222222222';
const ITAI = '33333333-3333-4333-8333-333333333333';
const ADMIN_USER = '44444444-4444-4444-8444-444444444444';
const OFFICE_USER = '55555555-5555-4555-8555-555555555555';

const PARTICIPANTS = [
  { id: YAEL, participant_status: 'scheduled', client_profile: { first_name: 'יעל', last_name: 'מזרחי' } },
  { id: ITAI, participant_status: 'scheduled', client_profile: { first_name: 'איתי', last_name: 'ברק' } },
];

const INSTANCE = {
  id: LESSON_ID,
  datetime_start: '2026-09-14T07:00:00.000Z',
  duration_minutes: 45,
  instructor_employee_id: 'emp-1',
  service_id: 'svc-1',
  status: 'scheduled',
  created_source: 'weekly_generation',
  created_at: '2026-09-01T06:00:00.000Z',
  created_by: ADMIN_USER,
};

const ACTOR_NAMES = { [ADMIN_USER]: 'דנה כהן' };

function participantRow(overrides) {
  return {
    id: overrides.id,
    event_type: overrides.event_type,
    action_category: overrides.action_category ?? null,
    resource_type: 'lesson_participant',
    resource_id: overrides.resource_id ?? YAEL,
    actor_user_id: 'actor_user_id' in overrides ? overrides.actor_user_id : ADMIN_USER,
    actor_email: overrides.actor_email ?? null,
    actor_role: overrides.actor_role ?? null,
    before_state: overrides.before_state ?? null,
    after_state: overrides.after_state ?? null,
    details: overrides.details ?? null,
    created_at: overrides.created_at ?? '2026-09-14T08:00:00.000Z',
  };
}

function lessonRow(overrides) {
  return {
    ...participantRow(overrides),
    resource_type: 'lesson_instance',
    resource_id: LESSON_ID,
  };
}

function build(extra = {}) {
  return buildLessonHistoryEvents({
    instance: INSTANCE,
    participants: PARTICIPANTS,
    actorNamesByUserId: ACTOR_NAMES,
    ...extra,
  });
}

function assertNoRawCodes(event) {
  assert.doesNotMatch(event.text, /[a-z]+\.[a-z_]+|[0-9a-f]{8}-[0-9a-f]{4}/i, `raw code leaked into text: ${event.text}`);
  assert.doesNotMatch(event.text, /[„”]/, 'history text must use straight quotes');
}

test('attendance to attended maps to attendance with participant name and status change', () => {
  const [event] = build({
    auditRows: [participantRow({
      id: 'a1',
      event_type: 'calendar.lesson_participant.attendance_updated',
      before_state: { id: YAEL, participant_status: 'scheduled' },
      after_state: { id: YAEL, participant_status: 'attended' },
    })],
  }).filter((entry) => entry.type !== 'create');

  assert.equal(event.type, 'attendance');
  assert.equal(event.participant_id, YAEL);
  assert.equal(event.participant_name, 'יעל מזרחי');
  assert.equal(event.text, 'יעל מזרחי סומן/ה כנוכח/ת');
  assert.equal(event.actor, 'דנה כהן');
  assert.deepEqual(event.changes, [{ label: 'סטטוס השתתפות', before: 'מתוכנן', after: 'נכח/ה' }]);
  assertNoRawCodes(event);
});

test('non-arrival statuses map to absence with Hebrew labels and straight quotes', () => {
  const statuses = {
    no_show: { text: 'יעל מזרחי סומן/ה כלא הגיע/ה', label: 'לא הגיע/ה' },
    cancelled_student: { text: 'נרשם ביטול ע"י הלקוח עבור יעל מזרחי', label: 'ביטול ע"י הלקוח' },
    cancelled_clinic: { text: 'נרשם ביטול ע"י המכון עבור יעל מזרחי', label: 'ביטול ע"י המכון' },
  };

  for (const [status, expected] of Object.entries(statuses)) {
    const [event] = build({
      auditRows: [participantRow({
        id: `a-${status}`,
        event_type: 'calendar.lesson_participant.attendance_updated',
        before_state: { participant_status: 'scheduled' },
        after_state: { participant_status: status },
      })],
    }).filter((entry) => entry.type !== 'create');

    assert.equal(event.type, 'absence', status);
    assert.equal(event.text, expected.text);
    assert.equal(event.changes[0].after, expected.label);
    assertNoRawCodes(event);
  }
});

test('restore to scheduled maps to status and merges the duplicate transition rows', () => {
  const events = build({
    auditRows: [
      participantRow({
        id: 'a-att',
        event_type: 'calendar.lesson_participant.attendance_updated',
        before_state: { participant_status: 'no_show' },
        after_state: { participant_status: 'scheduled' },
        created_at: '2026-09-14T09:00:00.000Z',
      }),
      participantRow({
        id: 'a-restore',
        event_type: 'calendar.lesson_participant.restored_to_scheduled',
        before_state: { participant_status: 'no_show' },
        after_state: { participant_status: 'scheduled' },
        created_at: '2026-09-14T09:00:01.000Z',
      }),
    ],
  }).filter((entry) => entry.type !== 'create');

  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'status');
  assert.equal(events[0].text, 'ההשתתפות של יעל מזרחי הוחזרה למצב מתוכנן');
  assert.deepEqual(events[0].changes, [{ label: 'סטטוס השתתפות', before: 'לא הגיע/ה', after: 'מתוכנן' }]);
});

test('reminder sent and confirmed map to reminder', () => {
  const events = build({
    auditRows: [
      participantRow({
        id: 'r1',
        event_type: 'calendar.lesson_participant.reminder_updated',
        resource_id: ITAI,
        before_state: { reminder_sent: false, reminder_seen: false },
        after_state: { reminder_sent: true, reminder_seen: false },
        created_at: '2026-09-13T10:00:00.000Z',
      }),
      participantRow({
        id: 'r2',
        event_type: 'calendar.lesson_participant.reminder_updated',
        resource_id: ITAI,
        before_state: { reminder_sent: true, reminder_seen: false },
        after_state: { reminder_sent: true, reminder_seen: true },
        created_at: '2026-09-13T12:00:00.000Z',
      }),
    ],
  }).filter((entry) => entry.type === 'reminder');

  assert.deepEqual(events.map((event) => event.text), [
    'איתי ברק אישר/ה את התזכורת',
    'נשלחה תזכורת לאיתי ברק',
  ]);
  assert.ok(events.every((event) => event.participant_name === 'איתי ברק'));
});

test('participant added maps to participant', () => {
  const [event] = build({
    auditRows: [participantRow({
      id: 'p1',
      event_type: 'calendar.lesson_participant.added',
      resource_id: ITAI,
      after_state: { participant_status: 'scheduled' },
    })],
  }).filter((entry) => entry.type !== 'create');

  assert.equal(event.type, 'participant');
  assert.equal(event.text, 'איתי ברק נוסף/ה לשיעור');
});

test('lesson reschedule maps to edit with before/after changes and merges control + tenant rows', () => {
  const events = build({
    instructorNamesById: { 'emp-1': 'רונית לוי', 'emp-2': 'משה פרץ' },
    auditRows: [
      lessonRow({
        id: 'u-control',
        event_type: 'calendar.instance_updated',
        action_category: 'calendar',
        actor_email: 'office@example.com',
        actor_user_id: OFFICE_USER,
        details: { previous_status: 'scheduled', updated_fields: ['datetime_start', 'instructor_employee_id'] },
        created_at: '2026-09-10T10:00:00.000Z',
      }),
      lessonRow({
        id: 'u-tenant',
        event_type: 'calendar.instance.updated',
        actor_user_id: OFFICE_USER,
        before_state: { ...INSTANCE },
        after_state: { ...INSTANCE, datetime_start: '2026-09-15T08:30:00.000Z', instructor_employee_id: 'emp-2' },
        created_at: '2026-09-10T10:00:00.400Z',
      }),
    ],
  }).filter((entry) => entry.type !== 'create');

  assert.equal(events.length, 1);
  const [event] = events;
  assert.equal(event.type, 'edit');
  assert.equal(event.text, 'פרטי השיעור עודכנו');
  assert.equal(event.actor, 'office@example.com', 'falls back to the email when no name resolves');
  assert.deepEqual(event.changes, [
    { label: 'מועד', before: '14/09/2026 10:00', after: '15/09/2026 11:30' },
    { label: 'מדריך/ה', before: 'רונית לוי', after: 'משה פרץ' },
  ]);
});

test('single-field edits get a specific headline', () => {
  const [event] = build({
    auditRows: [lessonRow({
      id: 'u1',
      event_type: 'calendar.lesson_instance.updated',
      before_state: { ...INSTANCE },
      after_state: { ...INSTANCE, datetime_start: '2026-09-14T09:00:00.000Z' },
    })],
  }).filter((entry) => entry.type !== 'create');

  assert.equal(event.text, 'מועד השיעור עודכן');
  assert.equal(event.changes.length, 1);
});

test('lesson cancel and complete map to status', () => {
  const events = build({
    auditRows: [
      lessonRow({
        id: 'c-control',
        event_type: 'calendar.instance_cancelled',
        action_category: 'calendar',
        actor_email: 'admin@example.com',
        details: { previous_status: 'scheduled', status: 'cancelled' },
        created_at: '2026-09-12T10:00:00.000Z',
      }),
      lessonRow({
        id: 'c-tenant',
        event_type: 'calendar.instance.updated',
        before_state: { ...INSTANCE },
        after_state: { ...INSTANCE, status: 'cancelled' },
        created_at: '2026-09-12T10:00:00.200Z',
      }),
      lessonRow({
        id: 'done',
        event_type: 'calendar.lesson_instance.updated',
        before_state: { ...INSTANCE, status: 'cancelled' },
        after_state: { ...INSTANCE, status: 'completed' },
        created_at: '2026-09-14T10:00:00.000Z',
      }),
    ],
  }).filter((entry) => entry.type === 'status');

  assert.deepEqual(events.map((event) => event.text), ['השיעור הושלם', 'השיעור בוטל']);
  assert.equal(events[1].actor, 'דנה כהן');
});

test('cascaded participant cancellation carries an explanatory note', () => {
  const [event] = build({
    auditRows: [participantRow({
      id: 'cascade',
      event_type: 'calendar.lesson_participant.cancelled_by_instance',
      before_state: { participant_status: 'scheduled' },
      after_state: { participant_status: 'cancelled_clinic' },
    })],
  }).filter((entry) => entry.type !== 'create');

  assert.equal(event.type, 'absence');
  assert.equal(event.note, 'בעקבות ביטול השיעור');
});

test('create rows merge into one create event and suppress the synthetic entry', () => {
  const events = build({
    auditRows: [
      lessonRow({
        id: 'cr1',
        event_type: 'calendar.instance_created',
        action_category: 'calendar',
        details: { scheduling_override_reason: 'בקשת הורה' },
        created_at: '2026-09-01T06:00:00.000Z',
      }),
      lessonRow({ id: 'cr2', event_type: 'calendar.instance.created', created_at: '2026-09-01T06:00:00.300Z' }),
    ],
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'create');
  assert.equal(events[0].text, 'השיעור נוצר');
  assert.equal(events[0].note, 'סיבת החריגה: בקשת הורה');
});

test('lessons without a create audit row get a synthetic create entry from the lesson row', () => {
  const events = build();
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'create');
  assert.equal(events[0].id, `lesson-created:${LESSON_ID}`);
  assert.equal(events[0].occurred_at, '2026-09-01T06:00:00.000Z');
  assert.equal(events[0].actor, 'דנה כהן');
  assert.equal(events[0].note, 'נוצר ביצירה שבועית מתבניות');
});

test('corrections map to correction with reason note, patch diff and deduped audit echo', () => {
  const events = build({
    serviceNamesById: { 'svc-1': 'ריפוי בעיסוק', 'svc-2': 'קלינאות תקשורת' },
    corrections: [{
      id: 'corr-1',
      status: 'applied',
      reason_text: 'השירות נרשם בטעות',
      instance_patch: { service_id: 'svc-2' },
      participant_patches: [{ participant_id: YAEL, participant_status: 'attended' }],
      created_by: ADMIN_USER,
      created_at: '2026-09-20T10:00:00.000Z',
    }],
    auditRows: [
      lessonRow({
        id: 'echo-control',
        event_type: 'locked_correction.applied',
        action_category: 'calendar',
        details: { correction_id: 'corr-1' },
        created_at: '2026-09-20T10:00:01.000Z',
      }),
      lessonRow({
        id: 'echo-tenant',
        event_type: 'calendar.instance.corrected',
        after_state: { id: 'corr-1' },
        created_at: '2026-09-20T10:00:01.100Z',
      }),
    ],
  }).filter((entry) => entry.type === 'correction');

  assert.equal(events.length, 1);
  assert.equal(events[0].text, 'בוצע תיקון לשיעור');
  assert.equal(events[0].note, 'השירות נרשם בטעות');
  assert.equal(events[0].actor, 'דנה כהן');
  assert.deepEqual(events[0].changes, [
    { label: 'שירות', before: 'ריפוי בעיסוק', after: 'קלינאות תקשורת' },
    { label: 'סטטוס יעל מזרחי', before: 'מתוכנן', after: 'נכח/ה' },
  ]);
});

test('unknown events fall back to other with generic Hebrew text', () => {
  const events = build({
    auditRows: [
      lessonRow({ id: 'x1', event_type: 'calendar.instance.something_new', created_at: '2026-09-14T11:00:00.000Z' }),
      participantRow({ id: 'x2', event_type: 'calendar.lesson_participant.mystery', created_at: '2026-09-14T12:00:00.000Z' }),
      participantRow({
        id: 'x3',
        event_type: 'calendar.lesson_participant.attendance_updated',
        resource_id: '66666666-6666-4666-8666-666666666666',
        before_state: { participant_status: 'scheduled' },
        after_state: { participant_status: 'scheduled' },
        created_at: '2026-09-14T13:00:00.000Z',
      }),
    ],
  }).filter((entry) => entry.type !== 'create');

  assert.deepEqual(events.map((event) => event.type), ['other', 'other', 'other']);
  assert.deepEqual(events.map((event) => event.text), [
    'פרטי ההשתתפות של משתתף/ת עודכנו',
    'בוצעה פעולה עבור יעל מזרחי',
    'בוצעה פעולה בשיעור',
  ]);
  assert.equal(events[0].participant_name, null, 'unresolved participants have a null name');
  events.forEach(assertNoRawCodes);
});

test('actor resolution prefers name, then email, then null; system rows are labelled', () => {
  const events = build({
    actorEmailsByUserId: { [OFFICE_USER]: 'office@example.com' },
    auditRows: [
      participantRow({ id: 'n1', event_type: 'calendar.lesson_participant.added', created_at: '2026-09-14T08:00:00.000Z' }),
      participantRow({ id: 'n2', event_type: 'calendar.lesson_participant.added', actor_user_id: OFFICE_USER, created_at: '2026-09-14T08:01:00.000Z' }),
      participantRow({ id: 'n3', event_type: 'calendar.lesson_participant.added', actor_user_id: null, created_at: '2026-09-14T08:02:00.000Z' }),
      participantRow({ id: 'n4', event_type: 'calendar.lesson_participant.added', actor_user_id: null, actor_role: 'system', created_at: '2026-09-14T08:03:00.000Z' }),
    ],
  }).filter((entry) => entry.type === 'participant');

  assert.deepEqual(events.map((event) => event.actor), ['מערכת', null, 'office@example.com', 'דנה כהן']);
});

test('events are newest first, capped, and use the response contract shape', () => {
  const auditRows = Array.from({ length: LESSON_HISTORY_EVENT_LIMIT + 5 }, (_, index) => participantRow({
    id: `bulk-${index}`,
    event_type: 'calendar.lesson_participant.added',
    created_at: new Date(Date.UTC(2026, 8, 14, 8, index)).toISOString(),
  }));
  const events = build({ auditRows });

  assert.equal(events.length, LESSON_HISTORY_EVENT_LIMIT);
  assert.equal(events[0].id, `audit:bulk-${LESSON_HISTORY_EVENT_LIMIT + 4}`);
  for (let index = 1; index < events.length; index += 1) {
    assert.ok(events[index - 1].occurred_at >= events[index].occurred_at);
  }
  assert.deepEqual(Object.keys(events[0]).sort(), [
    'actor', 'changes', 'id', 'note', 'occurred_at', 'participant_id', 'participant_name', 'text', 'type',
  ]);
  assert.deepEqual(events[0].changes, []);
});

test('debug tooling rows are excluded', () => {
  const events = build({
    auditRows: [lessonRow({ id: 'dbg', event_type: 'debug_uat.lock_payroll_run', action_category: 'calendar' })],
  });
  assert.deepEqual(events.map((event) => event.type), ['create']);
});

test('collectLessonHistoryReferenceIds gathers instructor and service ids', () => {
  const ids = collectLessonHistoryReferenceIds({
    auditRows: [{ before_state: { instructor_employee_id: 'emp-1', service_id: 'svc-1' }, after_state: { instructor_employee_id: 'emp-2' } }],
    corrections: [{ instance_patch: { service_id: 'svc-2' } }],
  });
  assert.deepEqual(ids.instructorIds.sort(), ['emp-1', 'emp-2']);
  assert.deepEqual(ids.serviceIds.sort(), ['svc-1', 'svc-2']);
});
