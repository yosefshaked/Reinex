import test from 'node:test';
import assert from 'node:assert/strict';

import {
  sanitizeAnalyticsUrl,
  sanitizePostHogEvent,
} from './posthog.js';

const STUDENT_ID = '11111111-1111-4111-8111-111111111111';
const FORM_ID = '22222222-2222-4222-8222-222222222222';

test('sanitizePostHogEvent tolerates missing event properties', () => {
  assert.equal(sanitizePostHogEvent(null), null);
  assert.deepEqual(sanitizePostHogEvent({ event: '$pageview' }), { event: '$pageview' });
});

test('sanitizePostHogEvent leaves non-string URL properties unchanged', () => {
  const event = sanitizePostHogEvent({
    event: '$pageview',
    properties: {
      $current_url: 7,
      $pathname: null,
      $referrer: false,
    },
  });

  assert.deepEqual(event.properties, {
    $current_url: 7,
    $pathname: null,
    $referrer: false,
  });
});

test('sanitizeAnalyticsUrl redacts sensitive query params in hash-router URLs', () => {
  const sanitized = sanitizeAnalyticsUrl(
    'https://app.test/#/submit?invite=abc123456789012345&identity_number=123456789&otp=123456&safe=calendar',
  );

  assert.equal(
    sanitized,
    'https://app.test/#/submit?invite=redacted&identity_number=redacted&otp=redacted&safe=calendar',
  );
});

test('sanitizeAnalyticsUrl redacts waiting-list scheduling query params', () => {
  const sanitized = sanitizeAnalyticsUrl(
    'https://app.test/#/calendar/templates?student_name=Test%20Student&service_name=Therapy&time_of_day=09%3A00&duration_minutes=45',
  );

  assert.equal(
    sanitized,
    'https://app.test/#/calendar/templates?student_name=redacted&service_name=redacted&time_of_day=redacted&duration_minutes=redacted',
  );
});

test('sanitizeAnalyticsUrl replaces known route IDs without changing route shape', () => {
  assert.equal(
    sanitizeAnalyticsUrl(`https://app.test/#/students/${STUDENT_ID}/details`),
    'https://app.test/#/students/:id/details',
  );
  assert.equal(
    sanitizeAnalyticsUrl(`https://app.test/#/forms/shared-blocks/${FORM_ID}`),
    'https://app.test/#/forms/shared-blocks/:id',
  );
});

test('sanitizeAnalyticsUrl handles relative and hash-only routes safely', () => {
  assert.equal(
    sanitizeAnalyticsUrl(`/students/${STUDENT_ID}/details?token_hash=secret-token-value`),
    '/students/:id/details?token_hash=redacted',
  );
  assert.equal(
    sanitizeAnalyticsUrl(`#/students/${STUDENT_ID}/details`),
    '#/students/:id/details',
  );
});

test('sanitizePostHogEvent covers PostHog URL property names', () => {
  const event = sanitizePostHogEvent({
    event: '$pageview',
    properties: {
      current_url: `https://app.test/#/students/${STUDENT_ID}`,
      $current_url: 'https://app.test/#/submit?email=user@example.com',
      $pathname: `/students/${STUDENT_ID}`,
      $referrer: `https://app.test/#/forms/${FORM_ID}`,
      unrelated: `https://app.test/#/students/${STUDENT_ID}`,
    },
  });

  assert.equal(event.properties.current_url, 'https://app.test/#/students/:id');
  assert.equal(event.properties.$current_url, 'https://app.test/#/submit?email=redacted');
  assert.equal(event.properties.$pathname, '/students/:id');
  assert.equal(event.properties.$referrer, 'https://app.test/#/forms/:id');
  assert.equal(event.properties.unrelated, `https://app.test/#/students/${STUDENT_ID}`);
});
