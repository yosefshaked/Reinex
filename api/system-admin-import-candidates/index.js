/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import {
  UUID_PATTERN,
  normalizeString,
  parseRequestBody,
  readEnv,
  respond,
  ensureSystemAdmin,
} from '../_shared/org-bff.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import { respondTrackedError } from '../_shared/error-events.js';

const MAX_CANDIDATES_TO_LIST = 500;
const MAX_SELECTED_DELETE = 500;

function normalizeUuid(value) {
  const normalized = normalizeString(value);
  return UUID_PATTERN.test(normalized) ? normalized : '';
}

function normalizeUuidList(values) {
  if (!Array.isArray(values)) return [];
  return Array.from(new Set(values.map(normalizeUuid).filter(Boolean)));
}

function summarizeCandidate(candidate, workspaceById, rowById) {
  const data = candidate.candidate_data || {};
  const displayName = [
    data.first_name,
    data.last_name,
  ].filter(Boolean).join(' ') || data.name || data.note_text?.slice?.(0, 60) || '—';
  const sourceRow = candidate.source_row_id ? rowById[candidate.source_row_id] : null;

  return {
    id: candidate.id,
    workspace_id: candidate.workspace_id,
    workspace_name: workspaceById[candidate.workspace_id]?.name || candidate.workspace_id,
    entity_type: candidate.entity_type,
    status: candidate.status,
    display_name: displayName,
    blocking_issues_count: Number(candidate.blocking_issues_count || 0),
    source_reference: sourceRow?.source_reference || null,
    row_index: Number.isInteger(sourceRow?.row_index) ? sourceRow.row_index : null,
    created_at: candidate.created_at,
    updated_at: candidate.updated_at,
  };
}

async function loadCandidates(supabase, orgId) {
  const { data: candidates, error: candidatesError, count } = await supabase
    .from('import_candidates')
    .select('id, workspace_id, source_row_id, entity_type, status, candidate_data, blocking_issues_count, created_at, updated_at', { count: 'exact' })
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(MAX_CANDIDATES_TO_LIST);

  if (candidatesError) {
    throw candidatesError;
  }

  const workspaceIds = Array.from(new Set((candidates || []).map((row) => row.workspace_id).filter(Boolean)));
  const sourceRowIds = Array.from(new Set((candidates || []).map((row) => row.source_row_id).filter(Boolean)));

  const [workspacesResult, rowsResult] = await Promise.all([
    workspaceIds.length > 0
      ? supabase
          .from('import_workspaces')
          .select('id, name')
          .eq('org_id', orgId)
          .in('id', workspaceIds)
      : Promise.resolve({ data: [], error: null }),
    sourceRowIds.length > 0
      ? supabase
          .from('import_rows')
          .select('id, source_reference, row_index')
          .eq('org_id', orgId)
          .in('id', sourceRowIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (workspacesResult.error || rowsResult.error) {
    throw workspacesResult.error || rowsResult.error;
  }

  const workspaceById = Object.fromEntries((workspacesResult.data || []).map((row) => [row.id, row]));
  const rowById = Object.fromEntries((rowsResult.data || []).map((row) => [row.id, row]));

  return {
    candidates: (candidates || []).map((candidate) => summarizeCandidate(candidate, workspaceById, rowById)),
    total: count ?? 0,
    limit: MAX_CANDIDATES_TO_LIST,
  };
}

async function writeCleanupAudit(supabase, { admin, orgId, mode, requestedIds, deletedCount, reason }) {
  const { error } = await supabase.from('audit_log').insert({
    org_id: orgId,
    actor_user_id: admin.userId,
    actor_email: admin.email || null,
    actor_role: 'system_admin',
    event_type: 'system_admin.import_candidates_deleted',
    action_category: 'data_cleanup',
    retention_category: 'critical',
    resource_type: 'import_candidates',
    resource_id: orgId,
    details: {
      mode,
      requested_candidate_count: requestedIds.length,
      deleted_count: deletedCount,
      reason,
    },
  });
  if (error) {
    throw error;
  }
}

export default async function systemAdminImportCandidates(context, req) {
  const method = String(req.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'POST') {
    return respond(context, 405, { message: 'method_not_allowed' });
  }

  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);
  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('system-admin-import-candidates: missing Supabase admin credentials');
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    return respond(context, 401, { message: 'missing_bearer_token' });
  }

  const supabase = createSupabaseAdminClient(adminConfig);

  let admin = null;
  try {
    admin = await ensureSystemAdmin(req, supabase, authorization, { context });
  } catch (error) {
    return respond(context, error?.statusCode || 403, { message: error?.message || 'forbidden' });
  }

  const body = method === 'POST' ? parseRequestBody(req) : {};
  const orgId = normalizeUuid(method === 'GET' ? req.query?.org_id : body?.org_id);
  if (!orgId) {
    return respond(context, 400, { message: 'invalid_org_id' });
  }

  if (method === 'GET') {
    try {
      const payload = await loadCandidates(supabase, orgId);
      return respond(context, 200, {
        org_id: orgId,
        ...payload,
        requested_at: new Date().toISOString(),
      });
    } catch (error) {
      context.log?.error?.('system-admin-import-candidates: list failed', {
        message: error?.message,
        orgId,
        userId: admin.userId,
      });
      return respondTrackedError(context, req, supabase, {
        status: 500,
        message: 'failed_to_list_import_candidates',
        userId: admin.userId,
        error,
        metadata: { org_id: orgId, action: 'list_import_candidates' },
      });
    }
  }

  const mode = normalizeString(body?.mode).toLowerCase();
  const reason = normalizeString(body?.reason);
  if (mode !== 'all' && mode !== 'selected') {
    return respond(context, 400, { message: 'invalid_cleanup_mode' });
  }
  if (reason.length < 3) {
    return respond(context, 400, { message: 'reason_required' });
  }

  const candidateIds = mode === 'selected' ? normalizeUuidList(body?.candidate_ids) : [];
  if (mode === 'selected' && candidateIds.length === 0) {
    return respond(context, 400, { message: 'candidate_ids_required' });
  }
  if (candidateIds.length > MAX_SELECTED_DELETE) {
    return respond(context, 400, { message: 'too_many_candidates', max: MAX_SELECTED_DELETE });
  }

  try {
    let deleteQuery = supabase
      .from('import_candidates')
      .delete({ count: 'exact' })
      .eq('org_id', orgId);

    if (mode === 'selected') {
      deleteQuery = deleteQuery.in('id', candidateIds);
    }

    const { data: deletedRows, error: deleteError, count } = await deleteQuery.select('id');
    if (deleteError) {
      throw deleteError;
    }

    const deletedCount = count ?? deletedRows?.length ?? 0;
    await writeCleanupAudit(supabase, {
      admin,
      orgId,
      mode,
      requestedIds: candidateIds,
      deletedCount,
      reason,
    });

    return respond(context, 200, {
      org_id: orgId,
      mode,
      deleted_count: deletedCount,
      deleted_candidate_ids: (deletedRows || []).map((row) => row.id),
    });
  } catch (error) {
    context.log?.error?.('system-admin-import-candidates: delete failed', {
      message: error?.message,
      orgId,
      mode,
      selectedCount: candidateIds.length,
      userId: admin.userId,
    });
    return respondTrackedError(context, req, supabase, {
      status: 500,
      message: 'failed_to_delete_import_candidates',
      userId: admin.userId,
      error,
      metadata: {
        org_id: orgId,
        mode,
        selected_count: candidateIds.length,
        action: 'delete_import_candidates',
      },
    });
  }
}
