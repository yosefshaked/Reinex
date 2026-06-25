export const ENTITY_FIELD_ORDER = {
  customer: ['first_name', 'last_name', 'identity_number', 'customer_type', 'is_active', 'phone', 'email', 'date_of_birth', 'note_text'],
  guardian: ['guardian_first_name', 'guardian_last_name', 'guardian_phone', 'guardian_email'],
  guardian_link: ['identity_number', 'guardian_phone', 'relationship', 'is_primary'],
  service: ['service_name', 'description'],
};

export const ENTITY_GRAIN_FIELDS = {
  customer: ['identity_number', 'first_name'],
  guardian: ['guardian_first_name', 'guardian_phone'],
  guardian_link: ['guardian_phone', 'identity_number'],
  service: ['service_name'],
};

export function normalizeFieldSource(value) {
  if (!value || typeof value !== 'object') return null;
  const sourceReference = String(value.source_reference || value.sourceReference || '').trim();
  const column = String(value.column || '').trim();
  return sourceReference && column ? { sourceReference, column } : null;
}

export function inferEntityAnchorSource(entityType, mapping = {}) {
  const fieldMap = mapping?.field_map || {};
  for (const field of ENTITY_GRAIN_FIELDS[entityType] || []) {
    const source = normalizeFieldSource(fieldMap[field]);
    if (source?.sourceReference) return source.sourceReference;
  }

  const counts = new Map();
  const firstFieldIndexBySource = new Map();
  (ENTITY_FIELD_ORDER[entityType] || Object.keys(fieldMap)).forEach((field, index) => {
    const source = normalizeFieldSource(fieldMap[field]);
    if (!source?.sourceReference) return;
    counts.set(source.sourceReference, (counts.get(source.sourceReference) || 0) + 1);
    if (!firstFieldIndexBySource.has(source.sourceReference)) {
      firstFieldIndexBySource.set(source.sourceReference, index);
    }
  });

  let selected = '';
  for (const [sourceReference, count] of counts.entries()) {
    const selectedCount = counts.get(selected) || 0;
    if (
      !selected
      || count > selectedCount
      || (
        count === selectedCount
        && (firstFieldIndexBySource.get(sourceReference) ?? Number.MAX_SAFE_INTEGER)
          < (firstFieldIndexBySource.get(selected) ?? Number.MAX_SAFE_INTEGER)
      )
    ) {
      selected = sourceReference;
    }
  }
  return selected;
}

export function getEntityMappedSources(mapping = {}) {
  return [...new Set(Object.values(mapping.field_map || {})
    .map((fieldSource) => normalizeFieldSource(fieldSource)?.sourceReference)
    .filter(Boolean))];
}
