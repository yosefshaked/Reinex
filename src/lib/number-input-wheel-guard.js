/**
 * Scrolling the page with the mouse wheel must never change a number.
 *
 * Browsers step a focused <input type="number"> when the wheel turns over it, so an office user who
 * types a value and then scrolls down silently changes it — a rate, a capacity, minutes worked.
 * One listener for the whole app: when the wheel turns over the focused number field, the field
 * loses focus, the value stays, and the page scrolls as the user meant. Typing and the arrow keys
 * still work as before.
 */
export function shouldReleaseNumberInput(event, activeElement) {
  const target = event?.target;
  return Boolean(
    target
    && target === activeElement
    && target.tagName === 'INPUT'
    && String(target.type).toLowerCase() === 'number',
  );
}

export function installNumberInputWheelGuard(doc = typeof document !== 'undefined' ? document : null) {
  if (!doc || doc.__numberInputWheelGuard) return;
  doc.__numberInputWheelGuard = true;
  doc.addEventListener('wheel', (event) => {
    if (shouldReleaseNumberInput(event, doc.activeElement)) {
      event.target.blur();
    }
  }, { passive: true });
}
