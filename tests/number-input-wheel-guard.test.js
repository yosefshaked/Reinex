import assert from 'node:assert/strict';
import { test } from 'node:test';

import { shouldReleaseNumberInput } from '../src/lib/number-input-wheel-guard.js';

const numberField = { tagName: 'INPUT', type: 'number' };

test('the wheel over the focused number field releases it, so scrolling cannot change the value', () => {
  assert.equal(shouldReleaseNumberInput({ target: numberField }, numberField), true);
});

test('everything else scrolls untouched', () => {
  assert.equal(shouldReleaseNumberInput({ target: numberField }, null), false, 'not focused: the browser does not step it');
  assert.equal(shouldReleaseNumberInput({ target: { tagName: 'INPUT', type: 'text' } }, { tagName: 'INPUT', type: 'text' }), false);
  assert.equal(shouldReleaseNumberInput({ target: { tagName: 'DIV' } }, numberField), false, 'wheel elsewhere on the page');
});
