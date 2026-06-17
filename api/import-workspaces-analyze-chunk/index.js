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
  active_student: {
    blockers: ['first_name', 'last_name'],
    warnings: ['phone', 'email', 'date_of_birth'],
  },
  inactive_student: {
    // Invariant: inactive_student archive requires name + identity_number
    blockers: ['first_name', 'last_name', 'identity_number'],
    warnings: ['phone', 'email', 'date_of_birth'],
  },
  guardian: {
    blockers: ['first_name', 'last_name'],
    warnings: ['phone', 'email'],
  },
  guardian_link: {
    blockers: ['student_identity_number', 'guardian_phone'],
    warnings: [],
  },
  service: {
    blockers: ['name'],
    warnings: ['description'],
  },
  student_note: {
    blockers: ['note_text', 'student_identity_number'],
    warnings: [],
  },
};

// Apply the user-configured field mapping (sourceColumn → canonicalField) to a raw row.
function applyMappings(rawData, fieldMap) {
  const out = {};
  for (const [canonicalField, sourceColumn] of Object.entries(fieldMap || {})) {
    out[canonicalField] = rawData[sourceColumn] ?? null;
  }
  return out;
}

// Date normalization — handles ISO strings, DD/MM/YYYY, and Excel serials.
function normalizeDate(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  // Excel serial date (number of days since 1900-01-01 with leap-year bug)
  if (typeof raw === 'number') {
    const date = new Date((raw - 25569) * 86400 * 1000);
    return isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
  }
  const str = String(raw).trim();
  if (!str) return null;
  // DD/MM/YYYY — common format in Israeli spreadsheets
  const ddmmyyyy = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ddmmyyyy) {
    const [, d, m, y] = ddmmyyyy;
    const date = new Date(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`);
    return isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
  }
  const parsed = new Date(str);
  return isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

// Normalize all known candidate fields. Returns { data, fieldIssues } where
// fieldIssues contains per-field format violations (severity: 'blocker').
function normalizeCandidateData(mapped, entityType) {
  const data = { ...mapped };
  const fieldIssues = [];

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
    data.date_of_birth = normalizeDate(data.date_of_birth);
  }

  // Service name coercion
  if (entityType === 'service' && data.name !== null && data.name !== undefined) {
    const nameResult = coerceOptionalText(data.name);
    Object.assign(data, { name: nameResult.value });
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
  return issues;
}

function normalizeUuid(value) {
  const normalized = normalizeString(value);
  if (!normalized) return '';
  return UUID_PATTERN.test(normalized) ? normalized : '';
}

function hasResolvedDuplicateIdentityDecision(decisions) {
  const action = normalizeString(decisions?.action);
  if (action === 'create_as_new' || action === 'skip') return true;
  return action === 'link_to_existing' && Boolean(normalizeUuid(decisions?.linked_id));
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
  const entityType = normalizeString(config.entityType) || 'active_student';
  const fieldMap = config.mappings?.field_map || {};

  if (!ENTITY_SCHEMA[entityType]) {
    return respond(context, 400, { message: 'unsupported_entity_type', entityType });
  }

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

  const rowIds = rows.map((row) => row.id);
  const { data: existingCandidates, error: existingCandidatesErr } = await withOrgScope(supabase, 'import_candidates', orgId)
    .select('source_row_id, decisions, status')
    .eq('workspace_id', workspaceId)
    .in('source_row_id', rowIds);

  if (existingCandidatesErr) {
    context.log?.error?.('import-workspaces-analyze-chunk: failed to load existing decisions', {
      message: existingCandidatesErr.message,
    });
    return respondAnalyzeError(context, 500, 'failed_to_load_existing_decisions', existingCandidatesErr, { action: 'load_existing_decisions' });
  }

  const existingDecisionsByRowId = new Map(
    (existingCandidates || []).map((candidate) => [
      candidate.source_row_id,
      candidate.decisions && typeof candidate.decisions === 'object' ? candidate.decisions : {},
    ]),
  );

  const existingStatusByRowId = new Map(
    (existingCandidates || []).map((candidate) => [
      candidate.source_row_id,
      normalizeString(candidate.status),
    ]),
  );
  const preservedStatuses = new Set(['committed', 'skipped']);

  // --- Apply mappings + normalize all rows ---
  const normalized = rows
    .filter((row) => !preservedStatuses.has(existingStatusByRowId.get(row.id)))
    .map((row) => {
    const mapped = applyMappings(row.raw_data || {}, fieldMap);
    const { data: candidateData, fieldIssues } = normalizeCandidateData(mapped, entityType);
    return { rowId: row.id, rowIndex: row.row_index, candidateData, fieldIssues };
  });
  const candidatesPreserved = rows.length - normalized.length;

  // --- Bulk duplicate detection (Performance: single query per field type) ---
  const identityNumbers = [...new Set(
    normalized.map((n) => n.candidateData.identity_number).filter(Boolean),
  )];

  const emails = [...new Set(
    normalized.map((n) => n.candidateData.email).filter(Boolean),
  )];

  const [duplicateIdResult, duplicateEmailResult] = await Promise.all([
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
  ]);

  // Build lookup maps for O(1) access
  const existingByIdNum = new Map(
    (duplicateIdResult.data || []).map((r) => [r.identity_number, r.id]),
  );
  const existingByEmail = new Map(
    (duplicateEmailResult.data || []).map((r) => [r.email, r.id]),
  );

  // --- Build candidates ---
  const now = new Date().toISOString();
  const candidates = normalized.map(({ rowId, candidateData, fieldIssues }) => {
    const existingDecisions = existingDecisionsByRowId.get(rowId) || {};
    const hasResolvedDuplicateDecision = hasResolvedDuplicateIdentityDecision(existingDecisions);
    const issues = [...fieldIssues, ...generateStructuralIssues(candidateData, entityType)];

    // Duplicate identity number check
    if (candidateData.identity_number) {
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
    if (candidateData.email) {
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

    const blockingIssuesCount = issues.filter((i) => i.severity === 'blocker').length;
    const status = blockingIssuesCount > 0 ? 'blocked' : 'ready';

    return {
      org_id: orgId,
      workspace_id: workspaceId,
      source_row_id: rowId,
      entity_type: entityType,
      status,
      candidate_data: candidateData,
      merged_from_row_ids: [rowId],
      issues,
      blocking_issues_count: blockingIssuesCount,
      decisions: existingDecisions,
      updated_at: now,
    };
  });

  let upserted = [];
  if (candidates.length > 0) {
    // --- Upsert candidates (idempotent via workspace_id, source_row_id) ---
    const { data, error: upsertErr } = await withOrgScope(supabase, 'import_candidates', orgId)
      .upsert(candidates, { onConflict: 'workspace_id,source_row_id' })
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

