/* eslint-env node */

const DEFAULT_COLOR_BANK = Object.freeze([
  '#2563eb',
  '#dc2626',
  '#16a34a',
  '#7c3aed',
  '#f97316',
  '#0891b2',
  '#facc15',
  '#ec4899',
  '#0f172a',
  '#f59e0b',
  '#10b981',
  '#6366f1',
  '#14b8a6',
  '#be123c',
  '#3730a3',
  '#b45309',
  '#047857',
  '#a855f7',
  '#ef4444',
  '#1d4ed8',
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function* generateCombinations(colors, length, startIndex = 0, prefix = []) {
  if (prefix.length === length) {
    yield prefix.map(index => colors[index]);
    return;
  }

  for (let index = startIndex; index < colors.length; index += 1) {
    const nextPrefix = prefix.concat(index);
    yield* generateCombinations(colors, length, index + 1, nextPrefix);
  }
}

function* createIdentifierGenerator(colorBank = DEFAULT_COLOR_BANK) {
  const bank = Array.isArray(colorBank) ? colorBank.filter(Boolean) : [];
  if (!bank.length) {
    return;
  }

  let size = 1;
  while (true) {
    for (const combination of generateCombinations(bank, size)) {
      if (!combination.length) {
        continue;
      }

      if (combination.length === 1) {
        yield combination[0];
      } else {
        yield combination.join(',');
      }
    }
    size += 1;
  }
}

function normalizeColorIdentifier(identifier) {
  if (!identifier || typeof identifier !== 'string') {
    return '';
  }
  return identifier.trim();
}

function resolveNextIdentifier(used, generator) {
  let step = generator.next();
  while (!step.done) {
    const candidate = normalizeColorIdentifier(step.value);
    if (candidate && !used.has(candidate)) {
      return candidate;
    }
    step = generator.next();
  }
  return '';
}

export const INSTRUCTOR_COLOR_BANK = DEFAULT_COLOR_BANK;

export async function ensureInstructorColors(tenantClient, { context, columns = 'id, metadata' } = {}) {
  const selectColumns = typeof columns === 'string' && columns.trim() ? columns : 'id, metadata';

  let query = tenantClient
    .from('Instructors')
    .select(selectColumns);

  // The Instructors table does not guarantee a created_at column across tenants. When
  // ordering by a non-existent column Supabase responds with HTTP 400, which surfaces as
  // `failed_to_prepare_instructors` in the weekly compliance endpoint. Prefer deterministic
  // ordering by `name` when it is part of the requested projection and always fall back to
  // the primary key to keep color assignments stable without triggering schema errors.
  if (selectColumns.includes('name')) {
    query = query.order('name', { ascending: true, nullsFirst: false });
  }

  query = query.order('id', { ascending: true, nullsFirst: false });

  const { data, error } = await query;

  if (error) {
    context?.log?.error?.('ensureInstructorColors failed to fetch instructors', { message: error.message });
    return { error };
  }

  const instructors = Array.isArray(data) ? data : [];
  const used = new Set();
  const generator = createIdentifierGenerator();
  const updates = [];

  for (const instructor of instructors) {
    const metadata = isPlainObject(instructor?.metadata) ? instructor.metadata : {};
    const identifier = normalizeColorIdentifier(metadata.instructor_color);

    if (identifier && !used.has(identifier)) {
      used.add(identifier);
      continue;
    }

    if (identifier && used.has(identifier)) {
      // Duplicate encountered; mark for reassignment.
      delete metadata.instructor_color;
    }

    updates.push({ instructor, metadata });
  }

  for (const entry of updates) {
    const nextIdentifier = resolveNextIdentifier(used, generator);
    if (!nextIdentifier) {
      context?.log?.error?.('ensureInstructorColors exhausted identifier space');
      break;
    }

    entry.metadata.instructor_color = nextIdentifier;
    used.add(nextIdentifier);
  }

  if (updates.length) {
    for (const { instructor, metadata } of updates) {
      const { error: updateError } = await tenantClient
        .from('Instructors')
        .update({ metadata })
        .eq('id', instructor.id);

      if (updateError) {
        context?.log?.error?.('ensureInstructorColors failed to persist metadata', { message: updateError.message, id: instructor.id });
        return { error: updateError };
      }

      instructor.metadata = metadata;
    }
  }

  return { data: instructors };
}

export function resolveInstructorColor(metadata) {
  if (!isPlainObject(metadata)) {
    return '';
  }
  return normalizeColorIdentifier(metadata.instructor_color);
}

export function parseColorIdentifier(identifier) {
  const normalized = normalizeColorIdentifier(identifier);
  if (!normalized) {
    return [];
  }
  return normalized.split(',').map(token => token.trim()).filter(Boolean);
}
