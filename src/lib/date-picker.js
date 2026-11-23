// A click anywhere in a date field opens the browser's picker, not only on its calendar icon.
// showPicker() throws in some contexts (an iframe, no user gesture), so it is guarded.
export const PICKER_INPUT_TYPES = new Set(['date', 'datetime-local', 'month']);

export function opensPicker(type) {
  return PICKER_INPUT_TYPES.has(type);
}

/** The click handler of a date field: the caller's own onClick first, then the picker. */
export function withPickerOnClick(onClick) {
  return (event) => {
    onClick?.(event);
    const input = event?.currentTarget;
    if (event?.defaultPrevented || !input || input.disabled || input.readOnly) return;
    try {
      input.showPicker?.();
    } catch {
      // The browser refused to open the picker here; the field still works by typing.
    }
  };
}
