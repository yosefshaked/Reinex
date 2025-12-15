// Simple singleton tour bus to control a custom React-based tour overlay
// State shape: { isOpen, stepIndex, steps, onClose }

const listeners = new Set();

const state = {
  isOpen: false,
  stepIndex: 0,
  steps: [],
  onClose: null,
};

function safeInvoke(fn, payload, context) {
  if (typeof fn !== 'function') {
    return;
  }
  try {
    fn(payload);
  } catch (error) {
    console.error(`[customTour] Failed to notify ${context}`, error);
  }
}

function notify() {
  const snapshot = { ...state };
  for (const fn of listeners) {
    safeInvoke(fn, snapshot, 'listener');
  }
}

export function subscribe(listener) {
  listeners.add(listener);
  // send current state immediately
  safeInvoke(listener, { ...state }, 'listener');
  return () => listeners.delete(listener);
}

export function openTour(steps, { onClose } = {}) {
  state.steps = Array.isArray(steps) ? steps : [];
  state.stepIndex = 0;
  state.onClose = typeof onClose === 'function' ? onClose : null;
  state.isOpen = state.steps.length > 0;
  notify();
}

export function closeTour(reason = 'close') {
  if (!state.isOpen) return;
  state.isOpen = false;
  notify();
  const cb = state.onClose;
  state.onClose = null;
  if (cb) {
    safeInvoke(cb, { reason }, 'onClose');
  }
}

export function nextStep() {
  if (!state.isOpen) return;
  if (state.stepIndex < state.steps.length - 1) {
    state.stepIndex += 1;
    notify();
  } else {
    closeTour('done');
  }
}

export function prevStep() {
  if (!state.isOpen) return;
  if (state.stepIndex > 0) {
    state.stepIndex -= 1;
    notify();
  }
}

export function getState() {
  return { ...state };
}
