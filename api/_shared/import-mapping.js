/* eslint-env node */
import { normalizeString } from './org-bff.js';

export const ENTITY_SCHEMA = {
  customer: {
    blockers: ['first_name', 'last_name', 'identity_number', 'customer_type'],
    warnings: ['phone', 'email', 'date_of_birth'],
  },
  guardian: {
    blockers: ['guardian_first_name', 'guardian_last_name'],
    warnings: ['guardian_phone', 'guardian_email'],
  },
  guardian_link: {
    blockers: ['identity_number', 'guardian_phone'],
    warnings: [],
  },
  service: {
    blockers: ['service_name'],
    warnings: ['description'],
  },
};

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

export function normalizeFieldSource(value, fallbackSourceReference = '') {
  if (value && typeof value === 'object') {
    const sourceReference = normalizeString(value.source_reference || value.sourceReference);
    const column = normalizeString(value.column);
    return sourceReference && column ? { sourceReference, column } : null;
  }
  const column = normalizeString(value);
  return column && fallbackSourceReference ? { sourceReference: fallbackSourceReference, column } : null;
}

export function normalizeJoinValue(value) {
  const normalized = normalizeString(value).toLocaleLowerCase('he-IL').replace(/\s+/g, '');
  const digits = normalized.replace(/\D/g, '');
  return digits.length >= 5 ? digits : normalized;
}

export function inferEntityAnchorSource(entityType, mapping = {}) {
  const fieldMap = mapping?.field_map || {};
  const grainFields = ENTITY_GRAIN_FIELDS[entityType] || [];
  for (const field of grainFields) {
    const source = normalizeFieldSource(fieldMap[field]);
    if (source?.sourceReference) return source.sourceReference;
  }

  const counts = new Map();
  const firstFieldIndexBySource = new Map();
  const fieldOrder = ENTITY_FIELD_ORDER[entityType] || Object.keys(fieldMap);
  fieldOrder.forEach((field, index) => {
    const source = normalizeFieldSource(fieldMap[field]);
    if (!source?.sourceReference) return;
    counts.set(source.sourceReference, (counts.get(source.sourceReference) || 0) + 1);
    if (!firstFieldIndexBySource.has(source.sourceReference)) {
      firstFieldIndexBySource.set(source.sourceReference, index);
    }
  });

  let selected = '';
  for (const [sourceReference, count] of counts.entries()) {
    if (!selected) {
      selected = sourceReference;
      continue;
    }
    const selectedCount = counts.get(selected) || 0;
    if (
      count > selectedCount
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

export function buildEnabledEntityMappings(mappings = {}) {
  const entities = mappings?.entities && typeof mappings.entities === 'object' ? mappings.entities : {};
  return Object.entries(entities)
    .filter(([, mapping]) => mapping?.enabled)
    .map(([entityType, mapping]) => ({
      entityType,
      ...mapping,
      anchorSourceReference: inferEntityAnchorSource(entityType, mapping),
    }));
}

export function getMappedSourceReferencesForEntity(mapping = {}, anchorSourceReference = '') {
  return [...new Set(Object.values(mapping.field_map || {})
    .map((value) => normalizeFieldSource(value, anchorSourceReference)?.sourceReference)
    .filter(Boolean))];
}

export function getExternalSourceReferences(mapping = {}, anchorSourceReference = '') {
  return getMappedSourceReferencesForEntity(mapping, anchorSourceReference)
    .filter((sourceReference) => sourceReference !== anchorSourceReference);
}

export function applyMappings(rawData, fieldMap, anchorSourceReference, joinColumns, externalRowsBySourceAndKey) {
  const out = {};
  const mergedRowIds = [];
  const joinIssues = [];

  for (const [canonicalField, configuredSource] of Object.entries(fieldMap || {})) {
    const source = normalizeFieldSource(configuredSource, anchorSourceReference);
    if (!source) continue;
    if (source.sourceReference === anchorSourceReference) {
      out[canonicalField] = rawData[source.column] ?? null;
      continue;
    }

    const anchorJoinColumn = normalizeString(joinColumns?.[anchorSourceReference]);
    const externalJoinColumn = normalizeString(joinColumns?.[source.sourceReference]);
    if (!anchorJoinColumn || !externalJoinColumn) {
      out[canonicalField] = null;
      joinIssues.push({
        code: 'cross_source_join_columns_required',
        severity: 'blocker',
        field: canonicalField,
        source_reference: source.sourceReference,
      });
      continue;
    }

    const anchorJoinValue = normalizeJoinValue(rawData[anchorJoinColumn]);
    const matches = externalRowsBySourceAndKey.get(source.sourceReference)?.get(anchorJoinValue) || [];
    if (matches.length === 1) {
      out[canonicalField] = matches[0].raw_data?.[source.column] ?? null;
      mergedRowIds.push(matches[0].id);
    } else {
      out[canonicalField] = null;
      joinIssues.push({
        code: matches.length > 1 ? 'ambiguous_source_join' : 'source_join_not_found',
        severity: 'blocker',
        field: canonicalField,
        source_reference: source.sourceReference,
      });
    }
  }
  return { mapped: out, mergedRowIds: [...new Set(mergedRowIds)], joinIssues };
}
