/* eslint-env node */
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

const ALLOWED_STATUSES = new Set([
  'draft',
  'profiling',
  'mapping',
  'analyzing',
  'needs_review',
  'ready_to_commit',
  'partially_committed',
  'committed',
  'archived',
  'cancelled',
]);

function normalizeUuid(value) {
  const normalized = normalizeString(value);
  if (!normalized) return '';
  return UUID_PATTERN.test(normalized) ? normalized : '';
}

export default async function importWorkspaces(context, req) {
  const method = String(req.method || 'GET').toUpperCase();
  const env = readEnv(context);

  // ── Auth ──────────────────────────────────────────────────────────────────
  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    return respond(context, 401, { message: 'missing_bearer' });
  }

  const supabase = createSingleClient(env);
  let authResult;
  try {
    authResult = await supabase.auth.getUser(authorization.token);
  } catch (err) {
    context.log?.error?.('import-workspaces: auth failed', { message: err?.message });
    return respond(context, 401, { message: 'invalid_or_expired_token' });
  }
  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid_or_expired_token' });
  }
  const userId = authResult.data.user.id;

  // ── Org & membership ──────────────────────────────────────────────────────
  const body = method === 'GET' ? {} : parseRequestBody(req);
  const orgId = resolveOrgId(req, body);
  if (!orgId) {
    return respond(context, 400, { message: 'invalid_org_id' });
  }

  let role;
  try {
    role = await ensureMembership(supabase, orgId, userId);
  } catch (err) {
    context.log?.error?.('import-workspaces: membership check failed', { message: err?.message });
    return respond(context, 500, { message: 'failed_to_verify_membership' });
  }
  if (!role) {
    return respond(context, 403, { message: 'forbidden' });
  }
  if (!isAdminOrOffice(role)) {
    return respond(context, 403, { message: 'forbidden' });
  }

  const workspaceId = normalizeUuid(req.params?.workspaceId);

  // ── GET /api/import-workspaces — list ─────────────────────────────────────
  if (method === 'GET' && !workspaceId) {
    const statusFilter = normalizeString(req?.query?.status);
    let query = withOrgScope(supabase, 'import_workspaces', orgId)
      .select('id, name, status, created_at, updated_at')
      .order('updated_at', { ascending: false });
    if (statusFilter && ALLOWED_STATUSES.has(statusFilter)) {
      query = query.eq('status', statusFilter);
    }
    const { data, error } = await query;
    if (error) {
      context.log?.error?.('import-workspaces: list failed', { message: error.message });
      return respond(context, 500, { message: 'failed_to_list_workspaces' });
    }
    return respond(context, 200, { workspaces: data ?? [] });
  }

  // ── POST /api/import-workspaces — create ──────────────────────────────────
  if (method === 'POST' && !workspaceId) {
    const name = normalizeString(body?.name);
    if (!name) {
      return respond(context, 400, { message: 'name_required' });
    }
    const { data, error } = await withOrgScope(supabase, 'import_workspaces', orgId)
      .insert({ name, status: 'draft', config: {} })
      .select()
      .single();
    if (error) {
      context.log?.error?.('import-workspaces: create failed', { message: error.message });
      return respond(context, 500, { message: 'failed_to_create_workspace' });
    }
    return respond(context, 201, { workspace: data });
  }

  // All routes below require a workspaceId
  if (!workspaceId) {
    return respond(context, 400, { message: 'workspace_id_required' });
  }

  // ── GET /api/import-workspaces/:id — get one ──────────────────────────────
  if (method === 'GET') {
    const { data, error } = await withOrgScope(supabase, 'import_workspaces', orgId)
      .select('*')
      .eq('id', workspaceId)
      .maybeSingle();
    if (error) {
      context.log?.error?.('import-workspaces: get failed', { message: error.message });
      return respond(context, 500, { message: 'failed_to_get_workspace' });
    }
    if (!data) {
      return respond(context, 404, { message: 'workspace_not_found' });
    }
    return respond(context, 200, { workspace: data });
  }

  // ── PATCH /api/import-workspaces/:id — update ─────────────────────────────
  if (method === 'PATCH') {
    const { name, status, config: configPatch } = body;

    // Validate each provided field
    const normalizedName = name !== undefined ? normalizeString(name) : undefined;
    if (normalizedName !== undefined && !normalizedName) {
      return respond(context, 400, { message: 'name_cannot_be_empty' });
    }
    const normalizedStatus = status !== undefined ? normalizeString(status) : undefined;
    if (normalizedStatus !== undefined && !ALLOWED_STATUSES.has(normalizedStatus)) {
      return respond(context, 400, { message: 'invalid_status' });
    }
    if (
      configPatch !== undefined &&
      (typeof configPatch !== 'object' || Array.isArray(configPatch) || configPatch === null)
    ) {
      return respond(context, 400, { message: 'config_must_be_object' });
    }

    const hasConfig = configPatch !== undefined;
    const scalarPatch = {};
    if (normalizedName !== undefined) scalarPatch['name'] = normalizedName;
    if (normalizedStatus !== undefined) scalarPatch.status = normalizedStatus;
    const hasScalars = Object.keys(scalarPatch).length > 0;

    if (!hasConfig && !hasScalars) {
      return respond(context, 400, { message: 'no_fields_to_update' });
    }

    // Atomic config shallow-merge via RPC (prevents JSONB overwrite race condition)
    if (hasConfig) {
      const { error: rpcError } = await supabase.rpc('patch_import_workspace_config', {
        p_workspace_id: workspaceId,
        p_org_id: orgId,
        p_config_patch: configPatch,
      });
      if (rpcError) {
        if (rpcError.message?.includes('workspace_not_found')) {
          return respond(context, 404, { message: 'workspace_not_found' });
        }
        context.log?.error?.('import-workspaces: config patch rpc failed', { message: rpcError.message });
        return respond(context, 500, { message: 'failed_to_patch_config' });
      }
    }

    // Scalar field update (name, status) — no concurrency concern for text fields
    if (hasScalars) {
      scalarPatch.updated_at = new Date().toISOString();
      const { error: updateError } = await withOrgScope(supabase, 'import_workspaces', orgId)
        .update(scalarPatch)
        .eq('id', workspaceId);
      if (updateError) {
        context.log?.error?.('import-workspaces: scalar update failed', { message: updateError.message });
        return respond(context, 500, { message: 'failed_to_update_workspace' });
      }
    }

    // Return the full updated workspace
    const { data, error: fetchError } = await withOrgScope(supabase, 'import_workspaces', orgId)
      .select('*')
      .eq('id', workspaceId)
      .maybeSingle();
    if (fetchError) {
      context.log?.error?.('import-workspaces: post-patch fetch failed', { message: fetchError.message });
      return respond(context, 500, { message: 'failed_to_fetch_workspace' });
    }
    if (!data) {
      return respond(context, 404, { message: 'workspace_not_found' });
    }
    return respond(context, 200, { workspace: data });
  }

  return respond(context, 405, { message: 'method_not_allowed' });
}
