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
import {
  ENTITY_SCHEMA,
  applyMappings,
  buildEnabledEntityMappings,
  getExternalSourceReferences,
  normalizeJoinValue,
} from '../_shared/import-mapping.js';

// Internal (500-level) failures persist an error_events row and return the
// support code; validation/auth/not-found stay on plain respond().
function respondAnalyzeError(context, status, message, error, metadata = {}) {
  return respondTracked(context, status, { message }, undefined, { error, metadata });
}

const MAX_ROWS_PER_ANALYSIS_CHUNK = 100;

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
  const duplicateName = normalizeString(issue?.duplicate_name);
  const duplicateNames = Array.isArray(issue?.duplicate_names)
    ? issue.duplicate_names.map(normalizeString).filter(Boolean)
    : [];
  const duplicateText = duplicateName
    ? ` (${duplicateName})`
    : duplicateNames.length > 0
      ? ` (${duplicateNames.join(', ')})`
      : '';
  switch (issue?.code) {
    case 'missing_required_field':
      return `${label} הוא שדה חובה.`;
    case 'missing_recommended_field':
      return `מומלץ למלא ${label}.`;
    case 'invalid_field_format':
      return `${label} בפורמט לא תקין.`;
    case 'duplicate_identity_number':
      return `קיימת כבר רשומה במערכת עם אותה תעודת זהות${duplicateText}. אי אפשר ליצור שתי רשומות עם אותו מספר; יש לקשר לרשומה הקיימת, לתקן את המספר, או לדלג.`;
    case 'duplicate_identity_in_file':
      return `אותה תעודת זהות מופיעה יותר מפעם אחת בקובץ או במרחב הייבוא${duplicateText}. יש לאחד, לתקן או לדלג על הכפילות לפני הייבוא.`;
    case 'duplicate_email':
      return 'קיימת כבר רשומה עם אותו אימייל. בדוק/י אם מדובר באותו אדם.';
    case 'missing_contact_path':
      return 'לתלמיד/ה חייב להיות טלפון תקין בתלמיד/ה או באפוטרופוס מקושר.';
    case 'source_join_not_found':
      return `לא נמצאה רשומה תואמת במקור הנוסף עבור ${label}. בדוק/י את עמודות הקישור שנבחרו.`;
    case 'ambiguous_source_join':
      return `נמצאו כמה רשומות תואמות במקור הנוסף עבור ${label}. ערך הקישור חייב לזהות רשומה אחת בלבד.`;
    case 'cross_source_join_columns_required':
      return `צריך לבחור עמודות חיבור בין הקבצים עבור ${label}.`;
    case 'guardian_primary_contact_required':
      return 'נמצאו כמה אנשי קשר לאותו תלמיד — יש לבחור איש קשר ראשי אחד.';
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
        fieldIssues.push({ code: 'invalid_field_format', severity: 'blocker', field: 'guardian_email' });
      }
      data.guardian_email = guardianEmailResult.valid ? guardianEmailResult.value : data.guardian_email;
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

  // Identity number — kept raw when invalid (a blocker, so it can't commit until
  // fixed) so the bad value is visible and editable in review.
  if (data.identity_number !== null && data.identity_number !== undefined) {
    const idResult = coerceIdentityNumber(data.identity_number);
    if (idResult.provided && !idResult.valid) {
      fieldIssues.push({ code: 'invalid_field_format', severity: 'blocker', field: 'identity_number' });
    }
    data.identity_number = idResult.valid ? idResult.value : data.identity_number;
  }

  // For format-validated fields we KEEP the raw value when it fails validation
  // (normalizing only when valid), so a bad value stays visible and editable in
  // review instead of silently vanishing. The warning/blocker still fires, and the
  // commit engine re-cleans optional fields before writing to the live tables.

  // Phone
  if (data.phone !== null && data.phone !== undefined) {
    const phoneResult = validateIsraeliPhone(data.phone);
    if (!phoneResult.valid && data.phone !== '') {
      fieldIssues.push({ code: 'invalid_field_format', severity: 'blocker', field: 'phone' });
    }
    data.phone = phoneResult.valid ? phoneResult.value : data.phone;
  }

  if (data.guardian_phone !== null && data.guardian_phone !== undefined) {
    const phoneResult = validateIsraeliPhone(data.guardian_phone);
    if (!phoneResult.valid && data.guardian_phone !== '') {
      fieldIssues.push({ code: 'invalid_field_format', severity: 'blocker', field: 'guardian_phone' });
    }
    data.guardian_phone = phoneResult.valid ? phoneResult.value : data.guardian_phone;
  }

  // Email
  if (data.email !== null && data.email !== undefined) {
    const emailResult = coerceEmail(data.email);
    if (!emailResult.valid) {
      fieldIssues.push({ code: 'invalid_field_format', severity: 'blocker', field: 'email' });
    }
    data.email = emailResult.valid ? emailResult.value : data.email;
  }

  // Date of birth
  if (data.date_of_birth !== null && data.date_of_birth !== undefined) {
    const dateResult = normalizeDate(data.date_of_birth);
    if (dateResult.provided && !dateResult.valid) {
      fieldIssues.push({ code: 'invalid_field_format', severity: 'blocker', field: 'date_of_birth' });
    }
    data.date_of_birth = dateResult.valid ? dateResult.value : data.date_of_birth;
  }

  // Service name coercion
  if (entityType === 'service' && data.service_name !== null && data.service_name !== undefined) {
    const nameResult = coerceOptionalText(data.service_name);
    Object.assign(data, { service_name: nameResult.value });
  }

  if (entityType === 'customer' && data.note_text !== null && data.note_text !== undefined) {
    data.note_text = coerceOptionalText(data.note_text).value;
  }

  if (entityType === 'guardian_link') {
    if (data.relationship !== null && data.relationship !== undefined) {
      data.relationship = coerceOptionalText(data.relationship).value;
    }
    const rawPrimary = data.is_primary;
    if (rawPrimary === null || rawPrimary === undefined || rawPrimary === '') {
      data.is_primary = null;
    } else if (typeof rawPrimary === 'boolean') {
      data.is_primary = rawPrimary;
    } else {
      const str = normalizeString(String(rawPrimary)).toLowerCase();
      const trueSet = new Set(['true', '1', 'yes', 'כן', 'primary', 'ראשי', 'y']);
      const falseSet = new Set(['false', '0', 'no', 'לא', 'לא ראשי', 'n']);
      if (trueSet.has(str)) {
        data.is_primary = true;
      } else if (falseSet.has(str)) {
        data.is_primary = false;
      } else {
        fieldIssues.push({ code: 'invalid_field_format', severity: 'blocker', field: 'is_primary' });
        data.is_primary = null;
      }
    }
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
        fieldIssues.push({ code: 'invalid_field_format', severity: 'blocker', field: 'is_active' });
        data.is_active = true;
      }
    }
  }

  return { data, fieldIssues };
}

// Generate structural issues (missing required fields, missing recommended fields).
function hasValidPhone(value) {
  return Boolean(validateIsraeliPhone(value).value);
}

function compactName(parts) {
  return (parts || []).map(normalizeString).filter(Boolean).join(' ');
}

function candidateDisplayName(candidateData) {
  return compactName([candidateData?.first_name, candidateData?.last_name])
    || compactName([candidateData?.guardian_first_name, candidateData?.guardian_last_name])
    || normalizeString(candidateData?.name)
    || '';
}

function buildGuardianPhoneContext(normalizedCandidates) {
  const rowsWithGuardianPhone = new Set();
  const identitiesWithGuardianPhone = new Set();

  for (const item of normalizedCandidates || []) {
    if (!hasValidPhone(item?.candidateData?.guardian_phone)) continue;
    if (item.rowId) rowsWithGuardianPhone.add(item.rowId);

    const identityNumber = normalizeString(item?.candidateData?.identity_number);
    if (identityNumber) identitiesWithGuardianPhone.add(identityNumber);
  }

  return { rowsWithGuardianPhone, identitiesWithGuardianPhone };
}

function isTruthyPrimary(value) {
  if (value === true) return true;
  const normalized = normalizeString(value).toLowerCase();
  return ['true', '1', 'yes', 'כן', 'y'].includes(normalized);
}

function buildGuardianPrimaryIssueContext(currentCandidates, existingCandidates = []) {
  const groups = new Map();
  const add = (candidate) => {
    if (!candidate || normalizeString(candidate.status) === 'skipped') return;
    const identityNumber = normalizeString(candidate.candidateData?.identity_number || candidate.candidate_data?.identity_number);
    if (!identityNumber) return;
    const items = groups.get(identityNumber) || [];
    items.push({
      rowId: candidate.rowId || candidate.source_row_id || '',
      isPrimary: isTruthyPrimary(candidate.candidateData?.is_primary ?? candidate.candidate_data?.is_primary),
    });
    groups.set(identityNumber, items);
  };

  currentCandidates
    .filter((candidate) => candidate.entityType === 'guardian_link')
    .forEach(add);
  existingCandidates.forEach(add);

  const identitiesNeedingPrimary = new Set();
  for (const [identityNumber, items] of groups.entries()) {
    if (items.length < 2) continue;
    const primaryCount = items.filter((item) => item.isPrimary).length;
    if (primaryCount !== 1) identitiesNeedingPrimary.add(identityNumber);
  }
  return identitiesNeedingPrimary;
}

function hasRelatedGuardianPhone(candidateData, rowId, guardianPhoneContext) {
  if (!guardianPhoneContext) return false;
  if (rowId && guardianPhoneContext.rowsWithGuardianPhone?.has(rowId)) return true;

  const identityNumber = normalizeString(candidateData?.identity_number);
  return Boolean(identityNumber && guardianPhoneContext.identitiesWithGuardianPhone?.has(identityNumber));
}

function generateStructuralIssues(candidateData, entityType, options = {}) {
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
  if (isStudentEntity) {
    // Require a valid phone on the student profile or a related guardian path.
    // Guardians and students are separate candidates, so this checks sibling
    // guardian/guardian_link rows by source row and student identity.
    const hasStudentPhone = hasValidPhone(candidateData.phone);
    const hasGuardianPhone = hasRelatedGuardianPhone(candidateData, options.rowId, options.guardianPhoneContext);
    if (!hasStudentPhone && !hasGuardianPhone) {
      issues.push({ code: 'missing_contact_path', severity: 'blocker', field: 'phone' });
    }
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
  const joinColumns = config.mappings?.join || {};
  const configuredEntities = buildEnabledEntityMappings(config.mappings || {})
    .filter((mapping) => mapping.anchorSourceReference === sourceReference);
  if (configuredEntities.length === 0) {
    return respond(context, 400, { message: 'no_enabled_entities_for_source' });
  }

  for (const mapping of configuredEntities) {
    if (!ENTITY_SCHEMA[mapping.entityType]) {
      return respond(context, 400, { message: 'unsupported_entity_type', entityType: mapping.entityType });
    }
    const externalReferences = getExternalSourceReferences(mapping, sourceReference);
    if (externalReferences.some((externalReference) => (
      !normalizeString(joinColumns?.[sourceReference])
      || !normalizeString(joinColumns?.[externalReference])
    ))) {
      return respond(context, 400, { message: 'cross_source_join_columns_required', entityType: mapping.entityType });
    }
  }

  const externalSourceReferences = [...new Set(configuredEntities.flatMap((mapping) => (
    getExternalSourceReferences(mapping, sourceReference)
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
      const joinColumn = joinColumns?.[externalReference];
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
    const { mapped, mergedRowIds, joinIssues, join } = applyMappings(
      row.raw_data || {},
      mapping.field_map || {},
      sourceReference,
      joinColumns,
      indexesByEntity.get(mapping.entityType) || new Map(),
    );
    for (const [field, fixedValue] of Object.entries(mapping.fixed_values || {})) {
      if (mapped[field] === null || mapped[field] === undefined || mapped[field] === '') mapped[field] = fixedValue;
    }
    const { data: candidateData, fieldIssues } = normalizeCandidateData(mapped, mapping.entityType);
    if (join && Object.keys(join.values || {}).length > 0) {
      candidateData.__import = {
        ...(candidateData.__import || {}),
        join,
      };
    }
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
  const identityDuplicateNames = customerCandidates.reduce((namesByIdentity, n) => {
    const identityNumber = normalizeString(n.candidateData.identity_number);
    if (!identityNumber) return namesByIdentity;
    const names = namesByIdentity.get(identityNumber) || [];
    names.push({
      rowId: n.rowId,
      name: candidateDisplayName(n.candidateData),
    });
    namesByIdentity.set(identityNumber, names);
    return namesByIdentity;
  }, new Map());

  const emails = [...new Set(
    customerCandidates.map((n) => n.candidateData.email).filter(Boolean),
  )];

  const currentRowIdSet = new Set(rowIds);

  const [duplicateIdResult, duplicateEmailResult, importIdentityResult] = await Promise.all([
    identityNumbers.length > 0
      ? withOrgScope(supabase, 'client_profiles', orgId)
          .select('id, identity_number, first_name, middle_name, last_name')
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

  let existingGuardianLinksForPrimary = [];
  if (normalized.some((item) => item.entityType === 'guardian_link')) {
    const currentRowIdSetForPrimary = new Set(rowIds);
    const { data: existingGuardianLinks, error: guardianPrimaryError } = await withOrgScope(supabase, 'import_candidates', orgId)
      .select('source_row_id, candidate_data, status')
      .eq('workspace_id', workspaceId)
      .eq('entity_type', 'guardian_link');
    if (guardianPrimaryError) {
      context.log?.error?.('import-workspaces-analyze-chunk: guardian primary lookup failed', {
        message: guardianPrimaryError.message,
      });
      return respondAnalyzeError(context, 500, 'failed_to_check_guardian_primary_contacts', guardianPrimaryError, {
        action: 'check_guardian_primary_contacts',
      });
    }
    existingGuardianLinksForPrimary = (existingGuardianLinks || [])
      .filter((candidate) => !currentRowIdSetForPrimary.has(candidate.source_row_id));
  }
  const identitiesNeedingPrimary = buildGuardianPrimaryIssueContext(normalized, existingGuardianLinksForPrimary);

  for (const existingCandidate of importIdentityResult.data || []) {
    if (currentRowIdSet.has(existingCandidate.source_row_id)) continue;
    if (normalizeString(existingCandidate.status) === 'skipped') continue;
    const identityNumber = normalizeString(existingCandidate.candidate_data?.identity_number);
    if (identityNumber && identityNumberCounts.has(identityNumber)) {
      identityNumberCounts.set(identityNumber, (identityNumberCounts.get(identityNumber) || 0) + 1);
      const names = identityDuplicateNames.get(identityNumber) || [];
      names.push({
        rowId: existingCandidate.source_row_id,
        name: candidateDisplayName(existingCandidate.candidate_data),
      });
      identityDuplicateNames.set(identityNumber, names);
    }
  }

  // Build lookup maps for O(1) access
  const existingByIdNum = new Map(
    (duplicateIdResult.data || []).map((r) => [r.identity_number, {
      id: r.id,
      name: compactName([r.first_name, r.middle_name, r.last_name]),
    }]),
  );
  const existingByEmail = new Map(
    (duplicateEmailResult.data || []).map((r) => [r.email, r.id]),
  );

  // --- Build candidates ---
  const now = new Date().toISOString();
  const guardianPhoneContext = buildGuardianPhoneContext(normalized);

  const candidates = normalized.map(({ rowId, entityType, candidateData, fieldIssues, mergedRowIds }) => {
    const existingDecisions = existingDecisionsByKey.get(`${rowId}:${entityType}`) || {};
    const hasResolvedDuplicateDecision = hasResolvedDuplicateIdentityDecision(existingDecisions);
    const issues = [
      ...fieldIssues,
      ...generateStructuralIssues(candidateData, entityType, { rowId, guardianPhoneContext }),
    ];

    // A required field that is present but invalid must block (not merely warn):
    // we keep the raw value for editing, but an unusable required value can't commit.
    const requiredFields = new Set(ENTITY_SCHEMA[entityType]?.blockers || []);
    for (const iss of issues) {
      if (iss.code === 'invalid_field_format' && requiredFields.has(iss.field)) iss.severity = 'blocker';
    }

    if (entityType === 'customer' && candidateData.note_text && candidateData.customer_type !== 'student') {
      issues.push({ code: 'note_requires_student', severity: 'warning', field: 'note_text' });
    }

    if (
      entityType === 'guardian_link'
      && identitiesNeedingPrimary.has(normalizeString(candidateData.identity_number))
    ) {
      issues.push({
        code: 'guardian_primary_contact_required',
        severity: 'blocker',
        field: 'is_primary',
      });
    }

    // Duplicate identity number check
    if (entityType === 'customer' && candidateData.identity_number) {
      if ((identityNumberCounts.get(candidateData.identity_number) || 0) > 1
        && !hasResolvedInFileDuplicateDecision(existingDecisions)) {
        const duplicateNames = (identityDuplicateNames.get(candidateData.identity_number) || [])
          .filter((item) => item.rowId !== rowId)
          .map((item) => item.name)
          .filter(Boolean);
        issues.push({
          code: 'duplicate_identity_in_file',
          severity: 'blocker',
          field: 'identity_number',
          duplicate_names: [...new Set(duplicateNames)],
        });
      }
      const existingIdentity = existingByIdNum.get(candidateData.identity_number);
      if (existingIdentity?.id && !hasResolvedDuplicateDecision) {
        issues.push({
          code: 'duplicate_identity_number',
          severity: 'blocker',
          field: 'identity_number',
          existing_client_profile_id: existingIdentity.id,
          duplicate_name: existingIdentity.name,
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

