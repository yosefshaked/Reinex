/* eslint-env node */

// Shallow merge with nested object support for metadata, preserving existing keys.
export function mergeMetadata(base = {}, patch = {}) {
  const result = { ...(base || {}) };
  for (const [key, value] of Object.entries(patch || {})) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = { ...(base?.[key] || {}), ...value };
    } else if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}
