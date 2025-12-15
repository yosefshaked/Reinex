export function normalizeTagIdsForWrite(candidate) {
  if (candidate === null || candidate === undefined) {
    return null;
  }

  if (Array.isArray(candidate)) {
    const normalized = candidate
      .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
      .filter(Boolean);
    return normalized.length ? normalized : null;
  }

  if (typeof candidate === 'string') {
    const trimmed = candidate.trim();
    return trimmed ? [trimmed] : null;
  }

  if (typeof candidate === 'object') {
    const { id } = candidate;
    if (typeof id === 'string') {
      const trimmed = id.trim();
      return trimmed ? [trimmed] : null;
    }
  }

  return null;
}

export function normalizeTagCatalog(candidate) {
  if (!Array.isArray(candidate)) {
    return [];
  }

  const normalized = [];
  const seen = new Set();

  for (const entry of candidate) {
    if (!entry) {
      continue;
    }

    if (typeof entry === 'object') {
      const id = typeof entry.id === 'string' ? entry.id.trim() : '';
      const name = typeof entry.name === 'string' ? entry.name.trim() : '';
      if (id && name && !seen.has(id)) {
        seen.add(id);
        normalized.push({ id, name });
      }
      continue;
    }

    if (typeof entry === 'string') {
      const value = entry.trim();
      if (value && !seen.has(value)) {
        seen.add(value);
        normalized.push({ id: value, name: value });
      }
    }
  }

  return normalized;
}

export function buildTagDisplayList(tagIds, catalog) {
  if (!Array.isArray(tagIds) || tagIds.length === 0) {
    return [];
  }

  const lookup = new Map();
  if (Array.isArray(catalog)) {
    for (const entry of catalog) {
      if (!entry) {
        continue;
      }
      const id = typeof entry.id === 'string' ? entry.id.trim() : '';
      const name = typeof entry.name === 'string' ? entry.name.trim() : '';
      if (id && name && !lookup.has(id)) {
        lookup.set(id, name);
      }
    }
  }

  const resolved = [];
  const seen = new Set();
  for (const raw of tagIds) {
    if (typeof raw !== 'string') {
      continue;
    }
    const trimmed = raw.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    const name = lookup.get(trimmed) || trimmed;
    resolved.push({ id: trimmed, name, missing: !lookup.has(trimmed) });
  }

  return resolved;
}
