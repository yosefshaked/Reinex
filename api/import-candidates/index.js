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
  'active_student', 'inactive_student', 'guardian',
  'guardian_link', 'service', 'student_note',
]);

function normalizeUuid(value) {
  const normalized = normalizeString(value);
  if (!normalized) return '';
  return UUID_PATTERN.test(normalized) ? normalized : '';
}

function countBlockingIssues(issues) {
  return (Array.isArray(issues) ? issues : []).filter((issue) => issue?.severity === 'blocker').length;
}

function shouldClearDuplicateIdentityIssue(decisionsPatch) {
  const action = normalizeString(decisionsPatch?.action);
  return action === 'create_as_new' || action === 'link_to_existing';
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
    const page = Math.max(1, Number.parseInt(req.query?.page || '1', 10));

    const from = (page - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let query = withOrgScope(supabase, 'import_candidates', orgId)
      .select('id, entity_type, status, candidate_data, issues, blocking_issues_count, decisions, source_row_id, depends_on_candidate_id, created_at, updated_at', { count: 'exact' })
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: true })
      .range(from, to);

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

    return respond(context, 200, {
      candidates: data || [],
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

    // Fetch existing record first so we can merge decisions
    const { data: existing, error: fetchErr } = await withOrgScope(supabase, 'import_candidates', orgId)
      .select('id, decisions, status, issues')
      .eq('id', candidateId)
      .single();

    if (fetchErr || !existing) {
      return respond(context, 404, { message: 'candidate_not_found' });
    }

    const updates = {};

    // Merge decision patch into existing decisions (non-destructive)
    if (body?.decisions_patch && typeof body.decisions_patch === 'object') {
      updates.decisions = { ...(existing.decisions || {}), ...body.decisions_patch };
      if (shouldClearDuplicateIdentityIssue(body.decisions_patch)) {
        const filteredIssues = (Array.isArray(existing.issues) ? existing.issues : [])
          .filter((issue) => issue?.code !== 'duplicate_identity_number');
        updates.issues = filteredIssues;
        updates.blocking_issues_count = countBlockingIssues(filteredIssues);
      }
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
      updates.status = newStatus;
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
