/* eslint-env node */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ceilClockTimeToGrid,
  normalizePreferredTimesToGrid,
} from './time-grid.js';

test('ceilClockTimeToGrid rounds up to the next 15 minute interval', () => {
  assert.equal(ceilClockTimeToGrid('15:00'), '15:00');
  assert.equal(ceilClockTimeToGrid('15:01'), '15:15');
  assert.equal(ceilClockTimeToGrid('15:14'), '15:15');
  assert.equal(ceilClockTimeToGrid('15:59'), '16:00');
});

test('normalizePreferredTimesToGrid rounds preferred ranges upward', () => {
  assert.deepEqual(
    normalizePreferredTimesToGrid([{ day: 1, ranges: [{ start: '15:14', end: '18:14' }] }]),
    [{ day: 1, ranges: [{ start: '15:15', end: '18:15' }] }],
  );
});
