import test from 'node:test';
import assert from 'node:assert/strict';
import { roundTo2 } from '../api/_shared/round.js';
import { toShekel, toAgorot } from '../api/_shared/currency.js';

test('roundTo2 rounds non-money values to 2 decimals', () => {
  assert.equal(roundTo2(1.234), 1.23);
  assert.equal(roundTo2(2.5), 2.5);
  assert.equal(roundTo2(1.5 + 0.25), 1.75);
});

test('currency helpers convert agorot and shekel', () => {
  assert.equal(toAgorot(12.34), 1234);
  assert.equal(toShekel(1234), 12.34);
});
