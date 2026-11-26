import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { opensPicker, withPickerOnClick } from '../src/lib/date-picker.js';

describe('a click in a date field opens the picker', () => {
  it('applies to date, datetime-local and month fields only', () => {
    for (const type of ['date', 'datetime-local', 'month']) assert.equal(opensPicker(type), true, type);
    for (const type of ['text', 'number', 'time', undefined]) assert.equal(opensPicker(type), false, String(type));
  });

  it('calls showPicker and keeps the caller\'s onClick', () => {
    let picked = 0;
    let clicked = 0;
    const handler = withPickerOnClick(() => { clicked += 1; });
    handler({ defaultPrevented: false, currentTarget: { showPicker: () => { picked += 1; } } });
    assert.deepEqual([picked, clicked], [1, 1]);
  });

  it('does nothing for disabled or read-only fields, and never throws', () => {
    let picked = 0;
    const handler = withPickerOnClick();
    handler({ currentTarget: { disabled: true, showPicker: () => { picked += 1; } } });
    handler({ currentTarget: { readOnly: true, showPicker: () => { picked += 1; } } });
    assert.equal(picked, 0);
    assert.doesNotThrow(() => handler({ currentTarget: { showPicker: () => { throw new Error('NotAllowedError'); } } }));
    assert.doesNotThrow(() => handler({ currentTarget: {} }));
  });
});
