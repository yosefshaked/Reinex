/* eslint-env node */
/**
 * import-commit-chunk — POST /api/import-workspaces/:id/commit/chunk
 *
 * Atomically commits a batch of import_candidates to the live tables.
 * Delegates all logic to the commit_import_chunk PL/pgSQL RPC which
 * runs as a single transaction (all-or-rollback).
 *
 * Body: { candidate_ids: string[], org_id: string }
 * Returns: { committed: number, workspace_id: string, results: [...] }
 *
 * Guards:
 *   - admin or office role only
 *   - workspace must belong to the org
 *   - workspace must not already be fully committed
 *   - max 50 candidates per call
 */
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
import { respondTrackedError } from '../_shared/error-events.js';

const MAX_CANDIDATES_PER_CALL = 50;

function normalizeUuid(value) {
  const normalized = normalizeString(value);
  if (!normalized) return '';
  return UUID_PATTERN.test(normalized) ? normalized : '';
}

export default async function importCommitChunk(context, req) {
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
    context.log?.error?.('import-commit-chunk: auth failed', { message: err?.message });
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

  let role;
  try {
    role = await ensureMembership(supabase, orgId, userId);
  } catch (err) {
    context.log?.error?.('import-commit-chunk: membership check failed', { message: err?.message });
    return respond(context, 500, { message: 'failed_to_verify_membership' });
  }
  if (!role) return respond(context, 403, { message: 'forbidden' });
  if (!isAdminOrOffice(role)) return respond(context, 403, { message: 'forbidden' });

  const workspaceId = normalizeUuid(req.params?.workspaceId);
  if (!workspaceId) {
    return respond(context, 400, { message: 'workspace_id_required' });
  }

  const rawIds = body?.candidate_ids;
  if (!Array.isArray(rawIds) || rawIds.length === 0) {
    return respond(context, 400, { message: 'candidate_ids_required' });
  }
  if (rawIds.length > MAX_CANDIDATES_PER_CALL) {
    return respond(context, 400, {
      message: 'too_many_candidates',
      max: MAX_CANDIDATES_PER_CALL,
    });
  }

  const candidateIds = rawIds
    .map(id => normalizeUuid(String(id ?? '')))
    .filter(Boolean);

  if (candidateIds.length === 0) {
    return respond(context, 400, { message: 'no_valid_candidate_ids' });
  }

  // Verify workspace belongs to this org
  const { data: workspace, error: wsError } = await withOrgScope(supabase, 'import_workspaces', orgId)
    .select('id, status')
    .eq('id', workspaceId)
    .maybeSingle();
  if (wsError) {
    context.log?.error?.('import-commit-chunk: workspace lookup failed', { message: wsError.message });
    return respond(context, 500, { message: 'failed_to_load_workspace' });
  }
  if (!workspace) {
    return respond(context, 404, { message: 'workspace_not_found' });
  }

  // Guard: re-committing a fully-committed workspace is a no-op conflict
  if (workspace.status === 'committed') {
    return respond(context, 409, { message: 'workspace_already_committed' });
  }

  // Delegate to the atomic PL/pgSQL RPC
  const { data: rpcResult, error: rpcError } = await supabase.rpc('commit_import_chunk', {
    p_workspace_id:  workspaceId,
    p_org_id:        orgId,
    p_candidate_ids: candidateIds,
  });

  if (rpcError) {
    const msg = rpcError.message ?? '';
    if (msg.includes('candidate_not_ready')) {
      return respond(context, 409, { message: 'candidate_not_ready' });
    }
    if (msg.includes('candidate_has_blockers')) {
      return respond(context, 409, { message: 'candidate_has_blockers' });
    }
    if (msg.includes('inactive_student_missing_identity')) {
      return respond(context, 422, { message: 'inactive_student_missing_identity' });
    }
    if (msg.includes('inactive_student_missing_name')) {
      return respond(context, 422, { message: 'inactive_student_missing_name' });
    }
    if (msg.includes('linked_profile_not_found')) {
      return respond(context, 422, { message: 'linked_profile_not_found' });
    }
    if (msg.includes('guardian_link_student_not_found')) {
      return respond(context, 422, { message: 'guardian_link_student_not_found' });
    }
    if (msg.includes('guardian_link_guardian_not_found')) {
      return respond(context, 422, { message: 'guardian_link_guardian_not_found' });
    }
    if (msg.includes('student_note_student_not_found')) {
      return respond(context, 422, { message: 'student_note_student_not_found' });
    }
    context.log?.error?.('import-commit-chunk: rpc failed', { message: rpcError.message });
    return respondTrackedError(context, req, supabase, {
      status: 500,
      message: 'The database transaction encountered an error while committing this chunk. The operation has been rolled back safely.',
      orgId,
      userId,
      error: rpcError,
      metadata: {
        endpoint: 'import-commit-chunk',
        workspaceId,
        candidateCount: candidateIds.length,
      },
    });
  }

  return respond(context, 200, rpcResult);
}
