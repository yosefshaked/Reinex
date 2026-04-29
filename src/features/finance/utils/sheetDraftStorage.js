const STORAGE_KEY_PREFIX = 'reinex_sheet_draft_v1';

function getStorage() {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.sessionStorage;
}

function getStorageKey(key) {
  if (!key) {
    return '';
  }
  return `${STORAGE_KEY_PREFIX}:${key}`;
}

export function readSheetDraft(key) {
  const storage = getStorage();
  const storageKey = getStorageKey(key);
  if (!storage || !storageKey) {
    return null;
  }

  try {
    const raw = storage.getItem(storageKey);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw);
  } catch {
    storage.removeItem(storageKey);
    return null;
  }
}

export function writeSheetDraft(key, value) {
  const storage = getStorage();
  const storageKey = getStorageKey(key);
  if (!storage || !storageKey || value == null) {
    return;
  }

  try {
    storage.setItem(storageKey, JSON.stringify(value));
  } catch {
    // Ignore storage quota and serialization failures for ephemeral drafts.
  }
}

export function clearSheetDraft(key) {
  const storage = getStorage();
  const storageKey = getStorageKey(key);
  if (!storage || !storageKey) {
    return;
  }

  try {
    storage.removeItem(storageKey);
  } catch {
    // Ignore storage cleanup failures for ephemeral drafts.
  }
}
