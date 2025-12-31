/* eslint-env node */
import { createHash } from 'node:crypto';

export function sha256Hex(input) {
  const value = typeof input === 'string' ? input : JSON.stringify(input ?? null);
  return createHash('sha256').update(value).digest('hex');
}

export function stableJsonStringify(value) {
  return JSON.stringify(value, (_key, raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return raw;
    }
    const sorted = {};
    for (const key of Object.keys(raw).sort()) {
      sorted[key] = raw[key];
    }
    return sorted;
  });
}
