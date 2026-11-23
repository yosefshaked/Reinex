import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildCapabilitiesPayload } from '../src/lib/instructor-capabilities.js';

const riding = { service_id: 'riding', max_students: 1, availability_windows: [{ day: 'sunday', start: '08:00', end: '12:00' }] };
const group = { service_id: 'group', max_students: 4, availability_windows: [] };
const thursday = [{ day: 'thursday', start: '09:00', end: '13:00' }];

test('editing one service sends every other service back exactly as it was', () => {
  const payload = buildCapabilitiesPayload([riding, group], { serviceId: 'group', maxStudents: 3, availabilityWindows: thursday });
  assert.deepEqual(payload, [
    { service_id: 'riding', max_students: 1, availability_windows: riding.availability_windows },
    { service_id: 'group', max_students: 3, availability_windows: thursday },
  ]);
});

test('scheduling a service the employee was not assigned to assigns it', () => {
  const payload = buildCapabilitiesPayload([riding], { serviceId: 'hippotherapy', maxStudents: 1, availabilityWindows: thursday });
  assert.equal(payload.length, 2, 'the existing service is kept');
  assert.deepEqual(payload[1], { service_id: 'hippotherapy', max_students: 1, availability_windows: thursday });
});

test('an employee with no services yet gets the first one', () => {
  assert.deepEqual(
    buildCapabilitiesPayload(undefined, { serviceId: 'riding', maxStudents: 2, availabilityWindows: [] }),
    [{ service_id: 'riding', max_students: 2, availability_windows: [] }],
  );
});
