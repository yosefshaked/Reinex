/* eslint-env node */
// Phase 4 — Candidate Analyzer
// Converts staged import_rows into import_candidates (Golden Records).
// Runs in bounded chunks (max 100 rows); frontend drives iteration until complete.
// Re-analyzing the same rows is idempotent via upsert on (workspace_id, source_row_id).
import { resolveBearerAuthorization } from '../_shared/http.js';
import {
  UUID_PATTERN,
  createSingleClient,
  ensureMembership,
  isAdminOrOffice,
  normalizeString,
  parseRequestBody,
  readEnv,
  resolveOrgId,
  respond,
  withOrgScope,
} from '../_shared/org-bff.js';
import {
  validateIsraeliPhone,
  coerceIdentityNumber,
  coerceEmail,
  coerceOptionalText,
} from '../_shared/student-validation.js';
import { attachErrorTracking, respondTracked } from '../_shared/error-events.js';

// Internal (500-level) failures persist an error_events row and return the
// support code; validation/auth/not-found stay on plain respond().
function respondAnalyzeError(context, status, message, error, metadata = {}) {
  return respondTracked(context, status, { message }, undefined, { error, metadata });
}

const MAX_ROWS_PER_ANALYSIS_CHUNK = 100;

// Minimum fields required per entity type.
// blockers → missing field sets status to 'blocked' and increments blocking_issues_count.
// warnings → missing field generates a 'warning' issue only.
const ENTITY_SCHEMA = {
  customer: {
    // identity_number is always required — it is the duplicate blocker regardless of is_active.
    // customer_type (student | one_time_customer) must be explicitly chosen; there is no default.
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

const FIELD_LABELS = {
  first_name: 'שם פרטי',
  last_name: 'שם משפחה',
  identity_number: 'תעודת זהות התלמיד',
  customer_type: 'סוג לקוח',
  is_active: 'פעיל/לא פעיל',
  guardian_first_name: 'שם פרטי של ההורה',
  guardian_last_name: 'שם משפחה של ההורה',
  guardian_phone: 'טלפון הורה',
  guardian_email: 'אימייל הורה',
  phone: 'טלפון',
  email: 'אימייל',
  date_of_birth: 'תאריך לידה',
  service_name: 'שם השירות',
  description: 'תיאור',
  note_text: 'טקסט הערה',
};

function fieldLabel(field) {
  return FIELD_LABELS[field] || field || 'שדה';
}

function issueMessage(issue) {
  const label = fieldLabel(issue?.field);
  switch (issue?.code) {
    case 'missing_required_field':
      return `${label} הוא שדה חובה.`;
    case 'missing_recommended_field':
      return `מומלץ למלא ${label}.`;
    case 'invalid_field_format':
      return `${label} בפורמט לא תקין.`;
    case 'duplicate_identity_number':
      return 'קיימת כבר רשומה במערכת עם אותה תעודת זהות. אי אפשר ליצור שתי רשומות עם אותו מספר; יש לקשר לרשומה הקיימת, לתקן את המספר, או לדלג.';
    case 'duplicate_identity_in_file':
      return 'אותה תעודת זהות מופיעה יותר מפעם אחת בקובץ או במרחב הייבוא. יש לאחד, לתקן או לדלג על הכפילות לפני הייבוא.';
    case 'duplicate_email':
      return 'קיימת כבר רשומה עם אותו אימייל. בדוק/י אם מדובר באותו אדם.';
    case 'missing_contact_path':
      return 'לתלמיד/ה פעיל/ה חייב להיות לפחות טלפון או אימייל כדי שלא תיווצר רשומה בלי דרך יצירת קשר.';
    case 'source_join_not_found':
      return `לא נמצאה רשומה תואמת במקור הנוסף עבור ${label}. בדוק/י את עמודות הקישור שנבחרו.`;
    case 'ambiguous_source_join':
      return `נמצאו כמה רשומות תואמות במקור הנוסף עבור ${label}. ערך הקישור חייב לזהות רשומה אחת בלבד.`;
    case 'note_requires_student':
      return 'הערה פנימית נשמרת רק עבור לקוח/ה מסוג תלמיד/ה.';
    default:
      return issue?.severity === 'blocker'
        ? `${label} חוסם את הייבוא ויש לטפל בו.`
        : `${label} דורש בדיקה.`;
  }
}

function withIssuePresentation(issue) {
  return {
    ...issue,
    is_blocking: issue?.severity === 'blocker',
    message: issue?.message || issueMessage(issue),
  };
}

function normalizeFieldSource(value, anchorSourceReference) {
  if (value && typeof value === 'object') {
    const sourceReference = normalizeString(value.source_reference);
    const column = normalizeString(value.column);
    return sourceReference && column ? { sourceReference, column } : null;
  }
  const column = normalizeString(value);
  return column ? { sourceReference: anchorSourceReference, column } : null;
}

function normalizeJoinValue(value) {
  const normalized = normalizeString(value).toLocaleLowerCase('he-IL').replace(/\s+/g, '');
  const digits = normalized.replace(/\D/g, '');
  return digits.length >= 5 ? digits : normalized;
}

// Apply source-qualified mappings to one anchor row. Cross-source values are
// resolved through explicit join columns; row position is never used.
function applyMappings(rawData, fieldMap, anchorSourceReference, joinColumns, externalRowsBySourceAndKey) {
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

function isValidDateParts(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function toIsoDate(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// Date normalization — handles ISO strings, DD/MM/YYYY, Date objects, and Excel serials.
function normalizeDate(raw) {
  if (raw === null || raw === undefined || raw === '') {
    return { provided: false, valid: true, value: null };
  }
  if (raw instanceof Date) {
    if (isNaN(raw.getTime())) return { provided: true, valid: false, value: null };
    return { provided: true, valid: true, value: raw.toISOString().slice(0, 10) };
  }
  // Excel serial date (number of days since 1900-01-01 with leap-year bug)
  if (typeof raw === 'number') {
    const date = new Date((raw - 25569) * 86400 * 1000);
    return isNaN(date.getTime())
      ? { provided: true, valid: false, value: null }
      : { provided: true, valid: true, value: date.toISOString().slice(0, 10) };
  }
  const str = String(raw).trim();
  if (!str) return { provided: false, valid: true, value: null };
  // DD/MM/YYYY — common format in Israeli spreadsheets
  const ddmmyyyy = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ddmmyyyy) {
    const [, d, m, y] = ddmmyyyy;
    const day = Number(d);
    const month = Number(m);
    const year = Number(y);
    return isValidDateParts(year, month, day)
      ? { provided: true, valid: true, value: toIsoDate(year, month, day) }
      : { provided: true, valid: false, value: null };
  }
  const iso = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    const [, y, m, d] = iso;
    const year = Number(y);
    const month = Number(m);
    const day = Number(d);
    return isValidDateParts(year, month, day)
      ? { provided: true, valid: true, value: toIsoDate(year, month, day) }
      : { provided: true, valid: false, value: null };
  }
  return { provided: true, valid: false, value: null };
}

// Normalize all known candidate fields. Returns { data, fieldIssues } where
// fieldIssues contains per-field format violations (severity: 'blocker').
function normalizeCandidateData(mapped, entityType) {
  const data = { ...mapped };
  const fieldIssues = [];

  // Guardian fields keep their guardian_* names end-to-end (no flattening to
  // first_name/last_name), so a single source row can map a student and a guardian
  // without their columns colliding.
  if (entityType === 'guardian') {
    data.guardian_first_name = coerceOptionalText(data.guardian_first_name).value;
    data.guardian_last_name = coerceOptionalText(data.guardian_last_name).value;
    if (data.guardian_email !== null && data.guardian_email !== undefined) {
      const guardianEmailResult = coerceEmail(data.guardian_email);
      if (!guardianEmailResult.valid) {
        fieldIssues.push({ code: 'invalid_field_format', severity: 'warning', field: 'guardian_email' });
      }
      data.guardian_email = guardianEmailResult.valid ? guardianEmailResult.value : null;
    }
  }

  if (!data.identity_number && data.student_identity_number) {
    data.identity_number = data.student_identity_number;
  }
  delete data.student_identity_number;

  if (entityType === 'service' && !data.service_name && data.name) {
    data.service_name = data.name;
  }
  delete data.name;

  // Names
  const firstName = coerceOptionalText(data.first_name);
  data.first_name = firstName.value;

  const lastName = coerceOptionalText(data.last_name);
  data.last_name = lastName.value;

  // Identity number
  if (data.identity_number !== null && data.identity_number !== undefined) {
    const idResult = coerceIdentityNumber(data.identity_number);
    if (idResult.provided && !idResult.valid) {
      fieldIssues.push({ code: 'invalid_field_format', severity: 'blocker', field: 'identity_number' });
    }
    data.identity_number = idResult.valid ? idResult.value : null;
  }

  // Phone
  if (data.phone !== null && data.phone !== undefined) {
    const phoneResult = validateIsraeliPhone(data.phone);
    if (!phoneResult.valid && data.phone !== '') {
      fieldIssues.push({ code: 'invalid_field_format', severity: 'warning', field: 'phone' });
    }
    data.phone = phoneResult.valid ? phoneResult.value : null;
  }

  if (data.guardian_phone !== null && data.guardian_phone !== undefined) {
    const phoneResult = validateIsraeliPhone(data.guardian_phone);
    if (!phoneResult.valid && data.guardian_phone !== '') {
      fieldIssues.push({ code: 'invalid_field_format', severity: 'warning', field: 'guardian_phone' });
    }
    data.guardian_phone = phoneResult.valid ? phoneResult.value : null;
  }

  // Email
  if (data.email !== null && data.email !== undefined) {
    const emailResult = coerceEmail(data.email);
    if (!emailResult.valid) {
      fieldIssues.push({ code: 'invalid_field_format', severity: 'warning', field: 'email' });
    }
    data.email = emailResult.valid ? emailResult.value : null;
  }

  // Date of birth
  if (data.date_of_birth !== null && data.date_of_birth !== undefined) {
    const dateResult = normalizeDate(data.date_of_birth);
    if (dateResult.provided && !dateResult.valid) {
      fieldIssues.push({ code: 'invalid_field_format', severity: 'warning', field: 'date_of_birth' });
    }
    data.date_of_birth = dateResult.value;
  }

  // Service name coercion
  if (entityType === 'service' && data.service_name !== null && data.service_name !== undefined) {
    const nameResult = coerceOptionalText(data.service_name);
    Object.assign(data, { service_name: nameResult.value });
  }

  if (entityType === 'customer' && data.note_text !== null && data.note_text !== undefined) {
    data.note_text = coerceOptionalText(data.note_text).value;
  }

  // customer_type: must be 'student' or 'one_time_customer' when provided
  const VALID_CUSTOMER_TYPES = new Set(['student', 'one_time_customer']);
  if (entityType === 'customer') {
    const rawCt = data.customer_type;
    if (rawCt !== null && rawCt !== undefined && rawCt !== '') {
      const ct = normalizeString(String(rawCt)).toLowerCase().replace(/\s+/g, '_');
      if (!VALID_CUSTOMER_TYPES.has(ct)) {
        fieldIssues.push({ code: 'invalid_field_format', severity: 'blocker', field: 'customer_type' });
        data.customer_type = null; // null → generateStructuralIssues fires missing_required_field too
      } else {
        data.customer_type = ct;
      }
    } else {
      data.customer_type = null;
    }
  }

  // is_active: boolean with lenient coercion; defaults to true when not provided
  if (entityType === 'customer') {
    const rawActive = data.is_active;
    if (rawActive === null || rawActive === undefined || rawActive === '') {
      data.is_active = true;
    } else if (typeof rawActive === 'boolean') {
      // keep as-is
    } else {
      const str = normalizeString(String(rawActive)).toLowerCase();
      const trueSet = new Set(['true', '1', 'yes', 'כן', 'active', 'פעיל', 'y']);
      const falseSet = new Set(['false', '0', 'no', 'לא', 'inactive', 'לא פעיל', 'n']);
      if (trueSet.has(str)) {
        data.is_active = true;
      } else if (falseSet.has(str)) {
        data.is_active = false;
      } else {
        fieldIssues.push({ code: 'invalid_field_format', severity: 'warning', field: 'is_active' });
        data.is_active = true;
      }
    }
  }

  return { data, fieldIssues };
}

// Generate structural issues (missing required fields, missing recommended fields).
function generateStructuralIssues(candidateData, entityType) {
  const schema = ENTITY_SCHEMA[entityType];
  if (!schema) return [];
  const issues = [];

  for (const field of schema.blockers) {
    const val = candidateData[field];
    if (val === null || val === undefined || val === '') {
      issues.push({ code: 'missing_required_field', severity: 'blocker', field });
    }
  }
  for (const field of schema.warnings) {
    const val = candidateData[field];
    if (val === null || val === undefined || val === '') {
      issues.push({ code: 'missing_recommended_field', severity: 'warning', field });
    }
  }
  const isStudentEntity = entityType === 'customer' && candidateData.customer_type === 'student';
  if (isStudentEntity && !candidateData.phone && !candidateData.email) {
    issues.push({ code: 'missing_contact_path', severity: 'blocker', field: 'phone' });
  }
  return issues;
}

function normalizeUuid(value) {
  const normalized = normalizeString(value);
  if (!normalized) return '';
  return UUID_PATTERN.test(normalized) ? normalized : '';
}

function hasResolvedDuplicateIdentityDecision(decisions) {
  const action = normalizeString(decisions?.action);
  if (action === 'skip') return true;
  return action === 'link_to_existing' && Boolean(normalizeUuid(decisions?.linked_id));
}

// In-file duplicates (same identity twice in the workspace) are resolved by any
// deliberate choice about this row — including create_as_new, which means "keep
// this copy". Whichever copies the user keeps still de-duplicate at commit via
// createOrReuseClientProfile, so a single client_profile is created either way.
function hasResolvedInFileDuplicateDecision(decisions) {
  const action = normalizeString(decisions?.action);
  return action === 'skip'
    || action === 'create_as_new'
    || (action === 'link_to_existing' && Boolean(normalizeUuid(decisions?.linked_id)));
}

export default async function importWorkspacesAnalyzeChunk(context, req) {
  const env = readEnv(context);

  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    return respond(context, 401, { message: 'missing_bearer' });
  }

  const supabase = createSingleClient(env);
  let authResult;
  try {
    authResult = await supabase.auth.getUser(authorization.token);
  } catch (err) {
    context.log?.error?.('import-workspaces-analyze-chunk: auth failed', { message: err?.message });
    return respond(context, 401, { message: 'invalid_or_expired_token' });
  }
  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid_or_expired_token' });
  }
  const userId = authResult.data.user.id;

  const body = parseRequestBody(req);
  const orgId = resolveOrgId(req, body);
  if (!orgId) {
    return respond(context, 400, { message: 'invalid_org_id' });
  }

  const workspaceId = normalizeUuid(req.params?.workspaceId);
  if (!workspaceId) {
    return respond(context, 400, { message: 'workspace_id_required' });
  }

  attachErrorTracking(context, req, supabase, {
    orgId,
    userId,
    metadata: { endpoint: 'import-workspaces-analyze-chunk', workspaceId },
  });

  let role;
  try {
    role = await ensureMembership(supabase, orgId, userId);
  } catch (err) {
    context.log?.error?.('import-workspaces-analyze-chunk: membership check failed', { message: err?.message });
    return respondAnalyzeError(context, 500, 'failed_to_verify_membership', err, { action: 'verify_membership' });
  }
  if (!role) {
    return respond(context, 403, { message: 'forbidden' });
  }
  if (!isAdminOrOffice(role)) {
    return respond(context, 403, { message: 'forbidden' });
  }

  // --- Input validation ---
  const sourceReference = normalizeString(body?.source_reference);
  if (!sourceReference) {
    return respond(context, 400, { message: 'source_reference_required' });
  }

  const rowIndexFrom = Number.parseInt(body?.row_index_from, 10);
  const rowIndexTo = Number.parseInt(body?.row_index_to, 10);

  if (!Number.isInteger(rowIndexFrom) || rowIndexFrom < 0) {
    return respond(context, 400, { message: 'row_index_from_required' });
  }
  if (!Number.isInteger(rowIndexTo) || rowIndexTo < rowIndexFrom) {
    return respond(context, 400, { message: 'row_index_to_must_be_gte_row_index_from' });
  }
  if (rowIndexTo - rowIndexFrom + 1 > MAX_ROWS_PER_ANALYSIS_CHUNK) {
    return respond(context, 400, {
      message: 'chunk_too_large',
      max: MAX_ROWS_PER_ANALYSIS_CHUNK,
    });
  }

  // --- Load workspace config for mappings ---
  const { data: workspace, error: workspaceErr } = await withOrgScope(supabase, 'import_workspaces', orgId)
    .select('id, status, config')
    .eq('id', workspaceId)
    .single();

  if (workspaceErr || !workspace) {
    return respond(context, 404, { message: 'workspace_not_found' });
  }

  const config = workspace.config || {};
  const sourceConfig = (Array.isArray(config.sources) ? config.sources : [])
    .find((source) => normalizeString(source?.sourceReference) === sourceReference);
  const sourceMapping = config.mappings?.by_source?.[sourceReference];
  const configuredEntities = sourceMapping?.entities && typeof sourceMapping.entities === 'object'
    ? Object.entries(sourceMapping.entities)
        .filter(([, mapping]) => mapping?.enabled)
        .map(([entityType, mapping]) => ({ entityType, ...mapping }))
    : [];
  if (configuredEntities.length === 0) {
    const legacyEntityType = normalizeString(sourceMapping?.entity_type || sourceConfig?.entityType || config.entityType)
      || 'customer';
    configuredEntities.push({
      entityType: ['active_student', 'inactive_student'].includes(legacyEntityType) ? 'customer' : legacyEntityType,
      field_map: sourceMapping?.field_map || sourceConfig?.mapping?.field_map || config.mappings?.field_map || {},
      fixed_values: {
        ...(sourceMapping?.fixed_values || {}),
        ...(['active_student', 'inactive_student'].includes(legacyEntityType)
          ? { customer_type: 'student', is_active: legacyEntityType === 'active_student' }
          : {}),
      },
      join_columns: sourceMapping?.join_columns || {},
    });
  }

  for (const mapping of configuredEntities) {
    if (!ENTITY_SCHEMA[mapping.entityType]) {
      return respond(context, 400, { message: 'unsupported_entity_type', entityType: mapping.entityType });
    }
    const externalReferences = Object.values(mapping.field_map || {})
      .map((value) => normalizeFieldSource(value, sourceReference)?.sourceReference)
      .filter((reference) => reference && reference !== sourceReference);
    if (externalReferences.some((externalReference) => (
      !normalizeString(mapping.join_columns?.[sourceReference])
      || !normalizeString(mapping.join_columns?.[externalReference])
    ))) {
      return respond(context, 400, { message: 'cross_source_join_columns_required', entityType: mapping.entityType });
    }
  }

  const externalSourceReferences = [...new Set(configuredEntities.flatMap((mapping) => (
    Object.values(mapping.field_map || {})
      .map((value) => normalizeFieldSource(value, sourceReference)?.sourceReference)
      .filter((reference) => reference && reference !== sourceReference)
  )))];

  // --- Load import rows for this chunk ---
  const { data: rows, error: rowsErr } = await withOrgScope(supabase, 'import_rows', orgId)
    .select('id, row_index, raw_data')
    .eq('workspace_id', workspaceId)
    .eq('source_reference', sourceReference)
    .gte('row_index', rowIndexFrom)
    .lte('row_index', rowIndexTo)
    .order('row_index', { ascending: true });

  if (rowsErr) {
    context.log?.error?.('import-workspaces-analyze-chunk: failed to load rows', { message: rowsErr.message });
    return respondAnalyzeError(context, 500, 'failed_to_load_rows', rowsErr, { action: 'load_rows' });
  }

  if (!rows || rows.length === 0) {
    return respond(context, 200, { analyzed: 0, candidates_created: 0, candidates_updated: 0 });
  }

  const externalRowsBySource = new Map();
  for (const externalReference of externalSourceReferences) {
    const allExternalRows = [];
    for (let from = 0; ; from += 1000) {
      const { data: externalRows, error: externalRowsErr } = await withOrgScope(supabase, 'import_rows', orgId)
        .select('id, source_reference, row_index, raw_data')
        .eq('workspace_id', workspaceId)
        .eq('source_reference', externalReference)
        .order('row_index', { ascending: true })
        .range(from, from + 999);
      if (externalRowsErr) {
        context.log?.error?.('import-workspaces-analyze-chunk: failed to load joined source rows', {
          message: externalRowsErr.message,
        });
        return respondAnalyzeError(context, 500, 'failed_to_load_joined_source_rows', externalRowsErr, {
          action: 'load_joined_source_rows',
          sourceReference: externalReference,
        });
      }
      allExternalRows.push(...(externalRows || []));
      if (!externalRows || externalRows.length < 1000) break;
    }

    externalRowsBySource.set(externalReference, allExternalRows);
  }

  const rowIds = rows.map((row) => row.id);
  const { data: existingCandidates, error: existingCandidatesErr } = await withOrgScope(supabase, 'import_candidates', orgId)
    .select('id, source_row_id, entity_type, decisions, status')
    .eq('workspace_id', workspaceId)
    .in('source_row_id', rowIds);

  if (existingCandidatesErr) {
    context.log?.error?.('import-workspaces-analyze-chunk: failed to load existing decisions', {
      message: existingCandidatesErr.message,
    });
    return respondAnalyzeError(context, 500, 'failed_to_load_existing_decisions', existingCandidatesErr, { action: 'load_existing_decisions' });
  }

  const configuredEntityTypes = new Set(configuredEntities.map((mapping) => mapping.entityType));
  const staleCandidateIds = (existingCandidates || [])
    .filter((candidate) => (
      !configuredEntityTypes.has(candidate.entity_type)
      && !['committed', 'skipped'].includes(normalizeString(candidate.status))
    ))
    .map((candidate) => candidate.id)
    .filter(Boolean);
  if (staleCandidateIds.length > 0) {
    const { error: staleDeleteError } = await withOrgScope(supabase, 'import_candidates', orgId)
      .delete()
      .in('id', staleCandidateIds);
    if (staleDeleteError) {
      return respondAnalyzeError(context, 500, 'failed_to_remove_disabled_candidates', staleDeleteError, {
        action: 'remove_disabled_candidates',
      });
    }
  }

  const existingDecisionsByKey = new Map(
    (existingCandidates || []).map((candidate) => [
      `${candidate.source_row_id}:${candidate.entity_type}`,
      candidate.decisions && typeof candidate.decisions === 'object' ? candidate.decisions : {},
    ]),
  );

  const existingStatusByKey = new Map(
    (existingCandidates || []).map((candidate) => [
      `${candidate.source_row_id}:${candidate.entity_type}`,
      normalizeString(candidate.status),
    ]),
  );
  const preservedStatuses = new Set(['committed', 'skipped']);

  const indexesByEntity = new Map();
  for (const mapping of configuredEntities) {
    const indexes = new Map();
    for (const externalReference of externalSourceReferences) {
      const joinColumn = mapping.join_columns?.[externalReference];
      if (!joinColumn) continue;
      const rowsByKey = new Map();
      for (const externalRow of externalRowsBySource.get(externalReference) || []) {
        const key = normalizeJoinValue(externalRow.raw_data?.[joinColumn]);
        if (!key) continue;
        const matchingRows = rowsByKey.get(key) || [];
        matchingRows.push(externalRow);
        rowsByKey.set(key, matchingRows);
      }
      indexes.set(externalReference, rowsByKey);
    }
    indexesByEntity.set(mapping.entityType, indexes);
  }

  // Every enabled section can emit its own candidate from the same source row.
  const normalized = rows.flatMap((row) => configuredEntities.flatMap((mapping) => {
    const candidateKey = `${row.id}:${mapping.entityType}`;
    if (preservedStatuses.has(existingStatusByKey.get(candidateKey))) return [];
    const { mapped, mergedRowIds, joinIssues } = applyMappings(
      row.raw_data || {},
      mapping.field_map || {},
      sourceReference,
      mapping.join_columns || {},
      indexesByEntity.get(mapping.entityType) || new Map(),
    );
    for (const [field, fixedValue] of Object.entries(mapping.fixed_values || {})) {
      if (mapped[field] === null || mapped[field] === undefined || mapped[field] === '') mapped[field] = fixedValue;
    }
    const { data: candidateData, fieldIssues } = normalizeCandidateData(mapped, mapping.entityType);
    return [{
      rowId: row.id,
      rowIndex: row.row_index,
      entityType: mapping.entityType,
      candidateData,
      fieldIssues: [...fieldIssues, ...joinIssues],
      mergedRowIds,
    }];
  }));
  const candidatesPreserved = (rows.length * configuredEntities.length) - normalized.length;

  // --- Bulk duplicate detection (Performance: single query per field type) ---
  const customerCandidates = normalized.filter((item) => item.entityType === 'customer');
  const identityNumbers = [...new Set(
    customerCandidates.map((n) => n.candidateData.identity_number).filter(Boolean),
  )];
  const identityNumberCounts = customerCandidates.reduce((counts, n) => {
    const identityNumber = n.candidateData.identity_number;
    if (identityNumber) counts.set(identityNumber, (counts.get(identityNumber) || 0) + 1);
    return counts;
  }, new Map());

  const emails = [...new Set(
    customerCandidates.map((n) => n.candidateData.email).filter(Boolean),
  )];

  const currentRowIdSet = new Set(rowIds);

  const [duplicateIdResult, duplicateEmailResult, importIdentityResult] = await Promise.all([
    identityNumbers.length > 0
      ? withOrgScope(supabase, 'client_profiles', orgId)
          .select('id, identity_number')
          .in('identity_number', identityNumbers)
      : Promise.resolve({ data: [], error: null }),
    emails.length > 0
      ? withOrgScope(supabase, 'client_profiles', orgId)
          .select('id, email')
          .in('email', emails)
      : Promise.resolve({ data: [], error: null }),
    identityNumbers.length > 0
      ? withOrgScope(supabase, 'import_candidates', orgId)
          .select('source_row_id, candidate_data, status')
          .eq('workspace_id', workspaceId)
          .eq('entity_type', 'customer')
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (duplicateIdResult.error) {
    context.log?.error?.('import-workspaces-analyze-chunk: duplicate identity lookup failed', {
      message: duplicateIdResult.error.message,
    });
    return respondAnalyzeError(context, 500, 'failed_to_check_duplicate_identity_numbers', duplicateIdResult.error, {
      action: 'check_duplicate_identity_numbers',
    });
  }

  if (duplicateEmailResult.error) {
    context.log?.error?.('import-workspaces-analyze-chunk: duplicate email lookup failed', {
      message: duplicateEmailResult.error.message,
    });
    return respondAnalyzeError(context, 500, 'failed_to_check_duplicate_emails', duplicateEmailResult.error, {
      action: 'check_duplicate_emails',
    });
  }

  if (importIdentityResult.error) {
    context.log?.error?.('import-workspaces-analyze-chunk: import identity lookup failed', {
      message: importIdentityResult.error.message,
    });
    return respondAnalyzeError(context, 500, 'failed_to_check_import_identity_duplicates', importIdentityResult.error, {
      action: 'check_import_identity_duplicates',
    });
  }

  for (const existingCandidate of importIdentityResult.data || []) {
    if (currentRowIdSet.has(existingCandidate.source_row_id)) continue;
    if (normalizeString(existingCandidate.status) === 'skipped') continue;
    const identityNumber = normalizeString(existingCandidate.candidate_data?.identity_number);
    if (identityNumber && identityNumberCounts.has(identityNumber)) {
      identityNumberCounts.set(identityNumber, (identityNumberCounts.get(identityNumber) || 0) + 1);
    }
  }

  // Build lookup maps for O(1) access
  const existingByIdNum = new Map(
    (duplicateIdResult.data || []).map((r) => [r.identity_number, r.id]),
  );
  const existingByEmail = new Map(
    (duplicateEmailResult.data || []).map((r) => [r.email, r.id]),
  );

  // --- Build candidates ---
  const now = new Date().toISOString();
  const candidates = normalized.map(({ rowId, entityType, candidateData, fieldIssues, mergedRowIds }) => {
    const existingDecisions = existingDecisionsByKey.get(`${rowId}:${entityType}`) || {};
    const hasResolvedDuplicateDecision = hasResolvedDuplicateIdentityDecision(existingDecisions);
    const issues = [...fieldIssues, ...generateStructuralIssues(candidateData, entityType)];

    if (entityType === 'customer' && candidateData.note_text && candidateData.customer_type !== 'student') {
      issues.push({ code: 'note_requires_student', severity: 'warning', field: 'note_text' });
    }

    // Duplicate identity number check
    if (entityType === 'customer' && candidateData.identity_number) {
      if ((identityNumberCounts.get(candidateData.identity_number) || 0) > 1
        && !hasResolvedInFileDuplicateDecision(existingDecisions)) {
        issues.push({
          code: 'duplicate_identity_in_file',
          severity: 'blocker',
          field: 'identity_number',
        });
      }
      const existingId = existingByIdNum.get(candidateData.identity_number);
      if (existingId && !hasResolvedDuplicateDecision) {
        issues.push({
          code: 'duplicate_identity_number',
          severity: 'blocker',
          field: 'identity_number',
          existing_client_profile_id: existingId,
        });
      }
    }

    // Duplicate email — warning only (email can be shared between guardian + student)
    if (entityType === 'customer' && candidateData.email) {
      const existingId = existingByEmail.get(candidateData.email);
      if (existingId) {
        issues.push({
          code: 'duplicate_email',
          severity: 'warning',
          field: 'email',
          existing_client_profile_id: existingId,
        });
      }
    }

    const presentedIssues = issues.map(withIssuePresentation);
    const blockingIssuesCount = presentedIssues.filter((i) => i.severity === 'blocker').length;
    const status = blockingIssuesCount > 0 ? 'blocked' : 'ready';

    return {
      org_id: orgId,
      workspace_id: workspaceId,
      source_row_id: rowId,
      entity_type: entityType,
      status,
      candidate_data: candidateData,
      merged_from_row_ids: [rowId, ...mergedRowIds],
      issues: presentedIssues,
      blocking_issues_count: blockingIssuesCount,
      decisions: existingDecisions,
      updated_at: now,
    };
  });

  let upserted = [];
  if (candidates.length > 0) {
    // --- Upsert candidates (idempotent per source row and entity section) ---
    const { data, error: upsertErr } = await withOrgScope(supabase, 'import_candidates', orgId)
      .upsert(candidates, { onConflict: 'workspace_id,source_row_id,entity_type' })
      .select('id');

    if (upsertErr) {
      context.log?.error?.('import-workspaces-analyze-chunk: upsert failed', { message: upsertErr.message });
      return respondAnalyzeError(context, 500, 'failed_to_upsert_candidates', upsertErr, { action: 'upsert_candidates' });
    }
    upserted = data || [];

    if (workspace.status === 'committed') {
      const { error: reopenErr } = await withOrgScope(supabase, 'import_workspaces', orgId)
        .update({ status: 'needs_review', updated_at: now })
        .eq('id', workspaceId);

      if (reopenErr) {
        context.log?.error?.('import-workspaces-analyze-chunk: failed to reopen committed workspace', {
          message: reopenErr.message,
        });
        return respondAnalyzeError(context, 500, 'failed_to_reopen_workspace', reopenErr, { action: 'reopen_workspace' });
      }
    }
  }

  return respond(context, 200, {
    analyzed: rows.length,
    candidates_preserved: candidatesPreserved,
    candidates_created: upserted?.length ?? candidates.length,
    candidates_updated: 0, // Supabase upsert doesn't distinguish create vs update
  });
}

