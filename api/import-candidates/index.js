/* eslint-env node */
// import-candidates — GET (list with filters) + PATCH (decisions + status)
// GET  /api/import-candidates?workspace_id=:id&entity_type=...&status=...&page=1
// PATCH /api/import-candidates/:candidateId
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
import { attachErrorTracking, respondTracked } from '../_shared/error-events.js';
import {
  validateIsraeliPhone,
  coerceIdentityNumber,
  coerceEmail,
  coerceOptionalText,
  coerceOptionalDate,
  coerceBooleanFlag,
} from '../_shared/student-validation.js';

// Internal (500-level) failures persist an error_events row and return the
// support code; validation/auth/not-found/conflict stay on plain respond().
function respondCandidatesError(context, status, message, error, metadata = {}) {
  return respondTracked(context, status, { message }, undefined, { error, metadata });
}

const PAGE_SIZE = 50;

const ALLOWED_CANDIDATE_STATUSES = new Set([
  'needs_review', 'ready', 'blocked', 'blocked_by_dependency',
  'skipped', 'committed', 'failed',
]);

const PATCH_ALLOWED_CANDIDATE_STATUSES = new Set([
  'needs_review', 'ready', 'skipped', 'blocked',
]);

const ALLOWED_ENTITY_TYPES = new Set([
  'customer', 'guardian', 'guardian_link', 'service',
]);

const VALID_CUSTOMER_TYPES = new Set(['student', 'one_time_customer']);

const EDITABLE_FIELDS_BY_ENTITY = {
  customer: ['first_name', 'last_name', 'identity_number', 'customer_type', 'is_active', 'phone', 'email', 'date_of_birth', 'note_text'],
  guardian: ['guardian_first_name', 'guardian_last_name', 'guardian_phone', 'guardian_email'],
  guardian_link: ['identity_number', 'guardian_phone', 'relationship', 'is_primary'],
  service: ['service_name', 'description'],
};

const REQUIRED_FIELDS_BY_ENTITY = {
  customer: ['first_name', 'last_name', 'identity_number', 'customer_type'],
  guardian: ['guardian_first_name', 'guardian_last_name'],
  guardian_link: ['identity_number', 'guardian_phone'],
  service: ['service_name'],
};

function normalizeUuid(value) {
  const normalized = normalizeString(value);
  if (!normalized) return '';
  return UUID_PATTERN.test(normalized) ? normalized : '';
}

function countBlockingIssues(issues) {
  return (Array.isArray(issues) ? issues : []).filter((issue) => issue?.severity === 'blocker').length;
}

// DB duplicate (duplicate_identity_number) is resolved only by skipping or linking
// to the existing record — never by create_as_new (see decision #4).
function shouldClearDuplicateIdentityIssue(decisionsPatch) {
  const action = normalizeString(decisionsPatch?.action);
  return action === 'skip' || (action === 'link_to_existing' && Boolean(normalizeUuid(decisionsPatch?.linked_id)));
}

// In-file duplicate (same identity twice in this workspace) is resolved by any
// deliberate choice about the row, including create_as_new ("keep this copy").
function shouldClearInFileDuplicateIssue(decisionsPatch) {
  const action = normalizeString(decisionsPatch?.action);
  return action === 'skip'
    || action === 'create_as_new'
    || (action === 'link_to_existing' && Boolean(normalizeUuid(decisionsPatch?.linked_id)));
}

function hasResolvedDuplicateIdentityDecision(decisions) {
  const action = normalizeString(decisions?.action);
  if (action === 'skip') return true;
  return action === 'link_to_existing' && Boolean(normalizeUuid(decisions?.linked_id));
}

function hasResolvedInFileDuplicateDecision(decisions) {
  const action = normalizeString(decisions?.action);
  return action === 'skip'
    || action === 'create_as_new'
    || (action === 'link_to_existing' && Boolean(normalizeUuid(decisions?.linked_id)));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function issue(code, severity, field, extra = {}) {
  return {
    code,
    severity,
    field,
    is_blocking: severity === 'blocker',
    ...extra,
  };
}

function normalizeRelationship(raw) {
  const value = coerceOptionalText(raw).value;
  if (!value) return { value: null, valid: true };
  const normalized = value.trim().toLowerCase();
  const map = {
    אבא: 'father',
    אב: 'father',
    father: 'father',
    אמא: 'mother',
    אם: 'mother',
    mother: 'mother',
    עצמי: 'self',
    self: 'self',
    מטפל: 'caretaker',
    caretaker: 'caretaker',
    אחר: 'other',
    other: 'other',
  };
  if (map[normalized]) return { value: map[normalized], valid: true };
  return { value: 'other', valid: false };
}

function normalizeCandidateDataPatch(entityType, existingData, patch) {
  const editableFields = new Set(EDITABLE_FIELDS_BY_ENTITY[entityType] || []);
  const nextData = { ...(existingData || {}) };
  if (!nextData.identity_number && nextData.student_identity_number) {
    nextData.identity_number = nextData.student_identity_number;
  }
  delete nextData.student_identity_number;
  if (entityType === 'service' && !nextData.service_name && nextData.name) {
    nextData.service_name = nextData.name;
  }
  delete nextData.name;
  delete nextData.dry_run_summary;
  const fieldIssues = [];
  const changedFields = [];

  for (const [field, rawValue] of Object.entries(patch || {})) {
    if (!editableFields.has(field)) continue;

    let normalizedValue = rawValue;
    let valid = true;
    let invalidSeverity = 'warning';

    if (['first_name', 'last_name', 'guardian_first_name', 'guardian_last_name', 'service_name', 'description', 'note_text'].includes(field)) {
      const result = coerceOptionalText(rawValue);
      normalizedValue = result.value;
      valid = result.valid;
    } else if (field === 'identity_number') {
      const result = coerceIdentityNumber(rawValue);
      normalizedValue = result.valid ? result.value : null;
      valid = result.valid;
      invalidSeverity = 'blocker';
    } else if (['phone', 'guardian_phone'].includes(field)) {
      const result = validateIsraeliPhone(rawValue);
      normalizedValue = result.valid ? result.value : null;
      valid = result.valid;
    } else if (['email', 'guardian_email'].includes(field)) {
      const result = coerceEmail(rawValue);
      normalizedValue = result.valid ? result.value : null;
      valid = result.valid;
    } else if (field === 'date_of_birth') {
      const result = coerceOptionalDate(rawValue);
      normalizedValue = result.valid ? result.value : null;
      valid = result.valid;
    } else if (field === 'customer_type') {
      const ct = normalizeString(String(rawValue ?? '')).toLowerCase().replace(/\s+/g, '_');
      if (ct === '') {
        normalizedValue = null; // empty → missing_required_field handles it
        valid = true;
      } else if (VALID_CUSTOMER_TYPES.has(ct)) {
        normalizedValue = ct;
        valid = true;
      } else {
        normalizedValue = null;
        valid = false;
        invalidSeverity = 'blocker';
      }
    } else if (field === 'is_active') {
      const result = coerceBooleanFlag(rawValue, { defaultValue: true, allowUndefined: true });
      normalizedValue = result.value === false ? false : true;
      valid = true;
    } else if (field === 'is_primary') {
      const result = coerceBooleanFlag(rawValue, { defaultValue: null, allowUndefined: true });
      normalizedValue = result.valid ? result.value : null;
      valid = result.valid;
    } else if (field === 'relationship') {
      const result = normalizeRelationship(rawValue);
      normalizedValue = result.value;
      valid = result.valid;
    }

    if (!valid) {
      fieldIssues.push(issue('invalid_field_format', invalidSeverity, field));
    }

    const oldValue = nextData[field] ?? null;
    const newValue = normalizedValue ?? null;
    if (String(oldValue ?? '') !== String(newValue ?? '')) {
      changedFields.push({ field, from: oldValue, to: newValue });
    }
    nextData[field] = newValue;
  }

  return { nextData, fieldIssues, changedFields };
}

function generateStructuralIssues(candidateData, entityType) {
  const requiredFields = REQUIRED_FIELDS_BY_ENTITY[entityType] || [];
  const issues = [];
  for (const field of requiredFields) {
    const value = candidateData?.[field];
    if (value === null || value === undefined || value === '') {
      issues.push(issue('missing_required_field', 'blocker', field));
    }
  }
  const isStudentEntity = entityType === 'customer' && candidateData?.customer_type === 'student';
  if (isStudentEntity && !candidateData?.phone && !candidateData?.email) {
    issues.push(issue('missing_contact_path', 'blocker', 'phone'));
  }
  return issues;
}

async function generateDuplicateIssues(supabase, orgId, candidateData, decisions, { workspaceId, candidateId, entityType } = {}) {
  const issues = [];
  // Only the customer entity creates a client_profile, so it is the only one whose
  // identity_number can be a duplicate. For guardian_link the identity_number is a
  // *reference* to an existing student and must never be flagged. Mirrors the entity
  // gating in import-workspaces-analyze-chunk.
  if (entityType !== 'customer') return issues;

  const identityNumber = normalizeString(candidateData?.identity_number);
  const email = normalizeString(candidateData?.email);

  // DB duplicate — only cleared by skip / link_to_existing.
  if (identityNumber && !hasResolvedDuplicateIdentityDecision(decisions)) {
    const { data, error } = await withOrgScope(supabase, 'client_profiles', orgId)
      .select('id')
      .eq('identity_number', identityNumber)
      .maybeSingle();
    if (error) throw error;
    if (data?.id) {
      issues.push(issue('duplicate_identity_number', 'blocker', 'identity_number', {
        existing_client_profile_id: data.id,
      }));
    }
  }

  // In-file duplicate — also cleared by create_as_new ("keep this copy"). The user
  // picks which copy to keep; commit de-duplicates so only one client is created.
  if (identityNumber && workspaceId && !hasResolvedInFileDuplicateDecision(decisions)) {
    const { data: importCandidates, error: importError } = await withOrgScope(supabase, 'import_candidates', orgId)
      .select('id, candidate_data, status')
      .eq('workspace_id', workspaceId)
      .eq('entity_type', 'customer');
    if (importError) throw importError;
    const hasImportDuplicate = (importCandidates || []).some((candidate) => (
      candidate.id !== candidateId
      && normalizeString(candidate.status) !== 'skipped'
      && normalizeString(candidate.candidate_data?.identity_number) === identityNumber
    ));
    if (hasImportDuplicate) {
      issues.push(issue('duplicate_identity_in_file', 'blocker', 'identity_number'));
    }
  }

  if (email) {
    const { data, error } = await withOrgScope(supabase, 'client_profiles', orgId)
      .select('id')
      .eq('email', email)
      .maybeSingle();
    if (error) throw error;
    if (data?.id) {
      issues.push(issue('duplicate_email', 'warning', 'email', {
        existing_client_profile_id: data.id,
      }));
    }
  }

  return issues;
}

export default async function importCandidates(context, req) {
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
    context.log?.error?.('import-candidates: auth failed', { message: err?.message });
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

  attachErrorTracking(context, req, supabase, {
    orgId,
    userId,
    metadata: { endpoint: 'import-candidates' },
  });

  let role;
  try {
    role = await ensureMembership(supabase, orgId, userId);
  } catch (err) {
    context.log?.error?.('import-candidates: membership check failed', { message: err?.message });
    return respondCandidatesError(context, 500, 'failed_to_verify_membership', err, { action: 'verify_membership' });
  }
  if (!role) {
    return respond(context, 403, { message: 'forbidden' });
  }
  if (!isAdminOrOffice(role)) {
    return respond(context, 403, { message: 'forbidden' });
  }

  const method = req.method?.toUpperCase();

  // ── GET: list candidates with optional filters ──────────────────────────────
  if (method === 'GET') {
    const workspaceId = normalizeUuid(req.query?.workspace_id);
    if (!workspaceId) {
      return respond(context, 400, { message: 'workspace_id_required' });
    }

    const entityType = normalizeString(req.query?.entity_type);
    const status = normalizeString(req.query?.status);
    const sourceReference = normalizeString(req.query?.source_reference);
    const page = Math.max(1, Number.parseInt(req.query?.page || '1', 10));

    const from = (page - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const selectColumns = sourceReference
      ? 'id, entity_type, status, candidate_data, issues, blocking_issues_count, decisions, source_row_id, depends_on_candidate_id, created_at, updated_at, import_rows!inner(source_reference)'
      : 'id, entity_type, status, candidate_data, issues, blocking_issues_count, decisions, source_row_id, depends_on_candidate_id, created_at, updated_at';

    let query = withOrgScope(supabase, 'import_candidates', orgId)
      .select(selectColumns, { count: 'exact' })
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: true })
      .range(from, to);

    if (sourceReference) {
      query = query.eq('import_rows.source_reference', sourceReference);
    }
    if (entityType && ALLOWED_ENTITY_TYPES.has(entityType)) {
      query = query.eq('entity_type', entityType);
    }
    if (status && ALLOWED_CANDIDATE_STATUSES.has(status)) {
      query = query.eq('status', status);
    }

    const { data, error, count } = await query;

    if (error) {
      context.log?.error?.('import-candidates: list failed', { message: error.message });
      return respondCandidatesError(context, 500, 'failed_to_list_candidates', error, { action: 'list' });
    }

    const candidates = (data || []).map((candidate) => {
      if (!candidate.import_rows) return candidate;
      const clean = { ...candidate };
      delete clean.import_rows;
      return clean;
    });

    return respond(context, 200, {
      candidates,
      total: count ?? 0,
      page,
      pageSize: PAGE_SIZE,
    });
  }

  // ── PATCH: update decisions and/or status on a specific candidate ────────────
  if (method === 'PATCH') {
    const candidateId = normalizeUuid(req.params?.candidateId);
    if (!candidateId) {
      return respond(context, 400, { message: 'candidate_id_required' });
    }

    // Fetch existing record first so we can merge decisions and preserve provenance.
    const { data: existing, error: fetchErr } = await withOrgScope(supabase, 'import_candidates', orgId)
      .select('id, workspace_id, source_row_id, entity_type, candidate_data, decisions, status, issues')
      .eq('id', candidateId)
      .single();

    if (fetchErr || !existing) {
      return respond(context, 404, { message: 'candidate_not_found' });
    }

    const updates = {};
    let nextDecisions = existing.decisions && typeof existing.decisions === 'object'
      ? { ...existing.decisions }
      : {};

    // Merge decision patch into existing decisions (non-destructive)
    if (body?.decisions_patch && typeof body.decisions_patch === 'object') {
      nextDecisions = { ...nextDecisions, ...body.decisions_patch };
      updates.decisions = nextDecisions;
      const clearedCodes = new Set();
      if (shouldClearDuplicateIdentityIssue(body.decisions_patch)) clearedCodes.add('duplicate_identity_number');
      if (shouldClearInFileDuplicateIssue(body.decisions_patch)) clearedCodes.add('duplicate_identity_in_file');
      if (clearedCodes.size > 0) {
        const filteredIssues = (Array.isArray(existing.issues) ? existing.issues : [])
          .filter((issue) => !clearedCodes.has(issue?.code));
        updates.issues = filteredIssues;
        updates.blocking_issues_count = countBlockingIssues(filteredIssues);
      }
    }

    if (body?.candidate_data_patch !== undefined) {
      if (!isPlainObject(body.candidate_data_patch)) {
        return respond(context, 400, { message: 'candidate_data_patch_must_be_object' });
      }
      if (existing.status === 'committed') {
        return respond(context, 409, { message: 'candidate_already_committed' });
      }

      const { data: workspace, error: workspaceError } = await withOrgScope(supabase, 'import_workspaces', orgId)
        .select('id, config')
        .eq('id', existing.workspace_id)
        .maybeSingle();
      if (workspaceError || !workspace) {
        context.log?.error?.('import-candidates: workspace fetch for edit failed', { message: workspaceError?.message });
        return respondCandidatesError(context, 500, 'failed_to_load_workspace', workspaceError || new Error('workspace_not_found'), {
          action: 'load_workspace_for_candidate_edit',
          candidateId,
        });
      }

      const { nextData, fieldIssues, changedFields } = normalizeCandidateDataPatch(
        existing.entity_type,
        existing.candidate_data || {},
        body.candidate_data_patch,
      );

      if (changedFields.length > 0) {
        const fieldMap = workspace.config?.mappings?.field_map || {};
        const now = new Date().toISOString();
        const existingChanges = isPlainObject(nextDecisions.field_changes)
          ? { ...nextDecisions.field_changes }
          : {};
        for (const change of changedFields) {
          existingChanges[change.field] = {
            from: change.from,
            to: change.to,
            source_row_id: existing.source_row_id,
            source_column: fieldMap[change.field] || null,
            updated_at: now,
            updated_by: userId,
          };
        }
        nextDecisions = {
          ...nextDecisions,
          field_changes: existingChanges,
        };
      }

      let duplicateIssues = [];
      try {
        duplicateIssues = await generateDuplicateIssues(supabase, orgId, nextData, nextDecisions, {
          workspaceId: existing.workspace_id,
          candidateId: existing.id,
          entityType: existing.entity_type,
        });
      } catch (err) {
        context.log?.error?.('import-candidates: duplicate validation after edit failed', { message: err?.message });
        return respondCandidatesError(context, 500, 'failed_to_validate_candidate_edit', err, {
          action: 'validate_candidate_edit',
          candidateId,
        });
      }

      const nextIssues = [
        ...fieldIssues,
        ...generateStructuralIssues(nextData, existing.entity_type),
        ...duplicateIssues,
      ];
      const blockingCount = countBlockingIssues(nextIssues);
      updates.candidate_data = nextData;
      updates.decisions = nextDecisions;
      updates.issues = nextIssues;
      updates.blocking_issues_count = blockingCount;
      updates.status = blockingCount > 0 ? 'blocked' : 'ready';
    }

    // Status update — validate against allowed values
    if (body?.status) {
      const newStatus = normalizeString(body.status);
      if (existing.status === 'committed') {
        return respond(context, 409, { message: 'candidate_already_committed' });
      }
      if (!PATCH_ALLOWED_CANDIDATE_STATUSES.has(newStatus)) {
        return respond(context, 400, { message: 'status_not_allowed' });
      }
      if (newStatus === 'ready') {
        const effectiveIssues = updates.issues || existing.issues || [];
        if (countBlockingIssues(effectiveIssues) > 0) {
          updates.status = 'blocked';
        } else {
          updates.status = newStatus;
        }
      } else {
        updates.status = newStatus;
      }
    }

    if (Object.keys(updates).length === 0) {
      return respond(context, 400, { message: 'no_updates_provided' });
    }

    updates.updated_at = new Date().toISOString();

    const { data: updated, error: updateErr } = await withOrgScope(supabase, 'import_candidates', orgId)
      .update(updates)
      .eq('id', candidateId)
      .select('id, entity_type, status, candidate_data, issues, blocking_issues_count, decisions, source_row_id, updated_at')
      .single();

    if (updateErr) {
      context.log?.error?.('import-candidates: patch failed', { message: updateErr.message });
      return respondCandidatesError(context, 500, 'failed_to_patch_candidate', updateErr, { action: 'patch', candidateId });
    }

    return respond(context, 200, { candidate: updated });
  }

  return respond(context, 405, { message: 'method_not_allowed' });
}
