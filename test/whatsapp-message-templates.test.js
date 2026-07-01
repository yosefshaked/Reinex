import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildFormAccessWhatsAppMessage,
  buildWaitingListInviteWhatsAppMessage,
} from '../src/lib/whatsapp-message-templates.js';
import { buildInstructorDayMessage } from '../src/features/calendar/utils/instructor-whatsapp.js';

function lesson(id, datetimeStart, durationMinutes, serviceName, studentName) {
  return {
    id,
    datetime_start: datetimeStart,
    duration_minutes: durationMinutes,
    service: { service_name: serviceName },
    participants: [
      {
        student: {
          first_name: studentName,
          last_name: '',
        },
      },
    ],
  };
}

test('form WhatsApp messages append the organization signature at the bottom', () => {
  const message = buildFormAccessWhatsAppMessage({
    formName: 'טופס קבלה',
    submitLink: 'https://app.test/#/submit',
    accessIdentifier: '123456789',
    otp: '123456',
    expiresText: '27.5.2026, 12:00',
    organizationName: 'חוות בדיקה',
  });

  assert.match(message, /^שלום,/);
  assert.match(message, /שם הטופס למילוי: טופס קבלה/);
  assert.match(message, /\n\nנשלח מטעם חוות בדיקה$/);
});

test('waiting-list WhatsApp invite uses the shared service-specific wording and signature', () => {
  const message = buildWaitingListInviteWhatsAppMessage({
    inviteUrl: 'https://app.test/#/waiting-list-intake/token',
    expiresText: 'יום רביעי, 27 במאי, 12:00',
    serviceName: 'רכיבה טיפולית',
    studentName: 'ישראל',
    organizationName: 'חוות בדיקה',
  });

  assert.match(message, /שלום ישראל,/);
  assert.match(message, /טופס ההצטרפות לרשימת ההמתנה/);
  assert.match(message, /נשלח מטעם חוות בדיקה$/);
});

test('instructor day WhatsApp message groups consecutive lessons by service and lets breaks split groups', () => {
  const message = buildInstructorDayMessage({
    instructorName: 'עומר',
    dateString: '2026-05-27',
    lessons: [
      lesson('lesson-1', '2026-05-27T11:30:00.000Z', 30, 'רכיבת סוסים טיפולית', 'ישראל'),
      lesson('lesson-2', '2026-05-27T12:00:00.000Z', 30, 'רכיבת סוסים טיפולית', 'תהל'),
      lesson('lesson-3', '2026-05-27T13:00:00.000Z', 30, 'רכיבת סוסים טיפולית', 'יעל'),
      lesson('lesson-4', '2026-05-27T13:30:00.000Z', 150, 'סדנת עמית', 'אלי'),
    ],
    breaks: [
      {
        id: 'break-1',
        datetime_start: '2026-05-27T12:30:00.000Z',
        duration_minutes: 30,
        break_type: 'break',
      },
    ],
  });

  assert.match(message, /המשתתפים שלך ל-/);
  assert.doesNotMatch(message, /הלקוחות שלך/);
  assert.match(message, /רכיבת סוסים טיפולית:\n14:30-15:00 - ישראל\n15:00-15:30 - תהל\n\n15:30-16:00 - הפסקה\n\nרכיבת סוסים טיפולית:\n16:00-16:30 - יעל\n\nסדנת עמית:\n16:30-19:00 - אלי/);
});
