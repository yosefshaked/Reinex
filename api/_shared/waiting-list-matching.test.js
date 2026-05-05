/* eslint-env node */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCapabilityMap,
  buildInstructorMap,
  buildLiveWaitingListMatches,
  buildTemplatesByInstructorDay,
} from './waiting-list-matching.js';

const NOW = new Date('2026-05-05T10:00:00Z');

function baseEntry(overrides = {}) {
  return {
    id: overrides.id || 'entry-1',
    client_profile_id: 'profile-1',
    student_id: '',
    desired_service_id: 'service-1',
    preferred_days: [1],
    preferred_times: [{ day: 1, ranges: [{ start: '09:00', end: '11:00' }] }],
    priority_flag: false,
    status: 'open',
    created_at: '2026-04-25T10:00:00Z',
    service: { id: 'service-1', name: 'Speech', duration_minutes: 60 },
    client_profile: { first_name: 'Dana', last_name: 'Levi' },
    ...overrides,
  };
}

function buildContext({ templates = [], maxStudents = 2 } = {}) {
  const instructorRows = [{ id: 'inst-1', first_name: 'Noa', last_name: 'Cohen' }];
  const capabilityRows = [{
    employee_id: 'inst-1',
    service_id: 'service-1',
    max_students: maxStudents,
    availability_windows: [{ day: 1, start: '09:00', end: '12:00' }],
  }];
  const serviceDurationMap = new Map([['service-1', 60]]);
  return {
    capabilityMap: buildCapabilityMap(capabilityRows, serviceDurationMap),
    instructorMap: buildInstructorMap(instructorRows),
    validTemplates: templates,
    templatesByInstructorDay: buildTemplatesByInstructorDay(templates),
  };
}

test('capacity mode suggests under-capacity existing templates', () => {
  const context = buildContext({
    templates: [{
      id: 'template-1',
      student_id: 'student-1',
      instructor_employee_id: 'inst-1',
      service_id: 'service-1',
      day_of_week: 1,
      time_of_day: '09:00',
      duration_minutes: 60,
    }],
    maxStudents: 2,
  });

  const result = buildLiveWaitingListMatches({
    entries: [baseEntry()],
    mode: 'capacity',
    now: NOW,
    ...context,
  });

  assert.equal(result.summary.matchable_entries, 1);
  assert.equal(result.template_matches['template-1'].count, 1);
  assert.equal(result.cell_matches['inst-1|1'], undefined);
});

test('capacity mode excludes full templates', () => {
  const context = buildContext({
    templates: [
      {
        id: 'template-1',
        student_id: 'student-1',
        instructor_employee_id: 'inst-1',
        service_id: 'service-1',
        day_of_week: 1,
        time_of_day: '09:00',
        duration_minutes: 60,
      },
      {
        id: 'template-2',
        student_id: 'student-2',
        instructor_employee_id: 'inst-1',
        service_id: 'service-1',
        day_of_week: 1,
        time_of_day: '09:00',
        duration_minutes: 60,
      },
    ],
    maxStudents: 2,
  });

  const result = buildLiveWaitingListMatches({
    entries: [baseEntry()],
    mode: 'capacity',
    now: NOW,
    ...context,
  });

  assert.equal(result.summary.matchable_entries, 0);
  assert.deepEqual(result.template_matches, {});
});

test('capacity mode excludes templates outside explicit preferred hours', () => {
  const context = buildContext({
    templates: [{
      id: 'template-1',
      student_id: 'student-1',
      instructor_employee_id: 'inst-1',
      service_id: 'service-1',
      day_of_week: 1,
      time_of_day: '11:00',
      duration_minutes: 60,
    }],
    maxStudents: 2,
  });

  const result = buildLiveWaitingListMatches({
    entries: [baseEntry({ preferred_times: [{ day: 1, ranges: [{ start: '09:00', end: '10:00' }] }] })],
    mode: 'capacity',
    now: NOW,
    ...context,
  });

  assert.equal(result.summary.matchable_entries, 0);
  assert.deepEqual(result.template_matches, {});
});

test('capacity mode allows day-only entries without explicit hour restrictions', () => {
  const context = buildContext({
    templates: [{
      id: 'template-1',
      student_id: 'student-1',
      instructor_employee_id: 'inst-1',
      service_id: 'service-1',
      day_of_week: 1,
      time_of_day: '11:00',
      duration_minutes: 60,
    }],
    maxStudents: 2,
  });

  const result = buildLiveWaitingListMatches({
    entries: [baseEntry({ preferred_times: [] })],
    mode: 'capacity',
    now: NOW,
    ...context,
  });

  assert.equal(result.summary.matchable_entries, 1);
  assert.equal(result.template_matches['template-1'].count, 1);
});

test('clear-space mode suggests empty availability windows and excludes overlaps', () => {
  const context = buildContext({
    templates: [{
      id: 'template-1',
      student_id: 'student-1',
      instructor_employee_id: 'inst-1',
      service_id: 'service-1',
      day_of_week: 1,
      time_of_day: '09:00',
      duration_minutes: 60,
    }],
    maxStudents: 3,
  });

  const result = buildLiveWaitingListMatches({
    entries: [baseEntry()],
    mode: 'clear_space',
    now: NOW,
    ...context,
  });

  assert.equal(result.summary.matchable_entries, 1);
  assert.ok(result.cell_matches['inst-1|monday'].count > 0);
  assert.equal(
    result.cell_matches['inst-1|monday'].candidates.some((candidate) => candidate.time_of_day === '09:00'),
    false,
  );
});

test('closed and matched entries are excluded', () => {
  const context = buildContext();

  const result = buildLiveWaitingListMatches({
    entries: [baseEntry({ id: 'closed', status: 'closed' }), baseEntry({ id: 'matched', status: 'matched' })],
    mode: 'clear_space',
    now: NOW,
    ...context,
  });

  assert.equal(result.summary.matchable_entries, 0);
  assert.deepEqual(result.cell_matches, {});
});

test('summary counts unique entries, not every possible slot', () => {
  const context = buildContext({
    templates: [],
    maxStudents: 3,
  });

  const result = buildLiveWaitingListMatches({
    entries: [baseEntry()],
    mode: 'clear_space',
    now: NOW,
    ...context,
  });

  assert.ok(result.candidates.length > 1);
  assert.equal(result.summary.matchable_entries, 1);
});
