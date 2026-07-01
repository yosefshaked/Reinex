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
import { attachErrorTracking, respondTracked } from '../_shared/error-events.js';
import { getStorageDriver } from '../cross-platform/storage-drivers/index.js';

// Statuses where live data has already been written — these workspaces keep their
// staging + audit trail and cannot be deleted.
const COMMITTED_STATUSES = new Set(['committed', 'partially_committed']);

// Every temporary backup object the workspace owns across its sources.
function collectWorkspaceObjectKeys(config = {}) {
  const keys = new Set();
  const add = (key) => { const k = normalizeString(key); if (k) keys.add(k); };
  add(config.objectKey);
  for (const file of Array.isArray(config.files) ? config.files : []) add(file?.objectKey);
  for (const source of Array.isArray(config.sources) ? config.sources : []) add(source?.file?.objectKey);
  return [...keys];
}

// Wraps respondTracked so internal (500-level) failures persist an error_events
// row and return the support code to the user. Validation/auth/not-found stay
// on plain respond() — they are expected and user-actionable.
function respondWorkspacesError(context, status, message, error, metadata = {}) {
  return respondTracked(context, status, { message }, undefined, { error, metadata });
}

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

function buildDefaultWorkspaceConfig() {
  return {
    files: [],
    sheets: [],
    sheetProfiles: [],
    mappings: {
      entities: {},
      join: {},
      fixed_values: {},
      enum_dictionaries: {},
      ignored_columns: [],
    },
    normalization: {
      date_locale: 'he-IL',
      encoding_override: null,
      phone_cleanup: true,
      identity_cleanup: true,
    },
    operationProgress: {
      currentChunk: null,
      totalChunks: null,
      uploadedRows: 0,
      analyzedRows: 0,
      dryRunCandidates: 0,
      committedCandidates: 0,
      lastError: null,
      resumableCursor: null,
    },
    importPolicy: {
      rowChunkSize: 500,
      candidateChunkSize: 100,
      activeInactiveLanes: true,
      inactiveArchiveRules: {
        require_identity_number: true,
        require_name: true,
        require_conflicts_resolved: true,
      },
    },
    r2: {
      objects: [],
      retentionDays: 30,
    },
  };
}

function normalizeUuid(value) {
  const normalized = normalizeString(value);
  if (!normalized) return '';
  return UUID_PATTERN.test(normalized) ? normalized : '';
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function mergePlainObjects(base, patch) {
  const output = { ...base };
  for (const [key, value] of Object.entries(patch || {})) {
    if (isPlainObject(value) && isPlainObject(output[key])) {
      output[key] = mergePlainObjects(output[key], value);
    } else {
      output[key] = value;
    }
  }
  return output;
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

  attachErrorTracking(context, req, supabase, {
    orgId,
    userId,
    metadata: { endpoint: 'import-workspaces' },
  });

  let role;
  try {
    role = await ensureMembership(supabase, orgId, userId);
  } catch (err) {
    context.log?.error?.('import-workspaces: membership check failed', { message: err?.message });
    return respondWorkspacesError(context, 500, 'failed_to_verify_membership', err, { action: 'verify_membership' });
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
      return respondWorkspacesError(context, 500, 'failed_to_list_workspaces', error, { action: 'list' });
    }
    return respond(context, 200, { workspaces: data ?? [] });
  }

  // ── POST /api/import-workspaces — create ──────────────────────────────────
  if (method === 'POST' && !workspaceId) {
    const name = normalizeString(body?.name);
    if (!name) {
      return respond(context, 400, { message: 'name_required' });
    }
    const normalizedStatus = body?.status !== undefined ? normalizeString(body.status) : 'draft';
    if (!ALLOWED_STATUSES.has(normalizedStatus)) {
      return respond(context, 400, { message: 'invalid_status' });
    }
    if (
      body?.config !== undefined &&
      !isPlainObject(body.config)
    ) {
      return respond(context, 400, { message: 'config_must_be_object' });
    }
    const config = mergePlainObjects(buildDefaultWorkspaceConfig(), body?.config || {});
    const { data, error } = await withOrgScope(supabase, 'import_workspaces', orgId)
      .insert({ name, status: normalizedStatus, config })
      .select()
      .single();
    if (error) {
      context.log?.error?.('import-workspaces: create failed', { message: error.message });
      return respondWorkspacesError(context, 500, 'failed_to_create_workspace', error, { action: 'create' });
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
      return respondWorkspacesError(context, 500, 'failed_to_get_workspace', error, { action: 'get' });
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
      !isPlainObject(configPatch)
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
        return respondWorkspacesError(context, 500, 'failed_to_patch_config', rpcError, { action: 'patch_config', workspaceId });
      }
    }

    // Scalar field update (name, status) — no concurrency concern for text fields
    if (hasScalars) {
      scalarPatch.updated_at = new Date().toISOString();
      const { data: scalarUpdated, error: updateError } = await withOrgScope(supabase, 'import_workspaces', orgId)
        .update(scalarPatch)
        .eq('id', workspaceId)
        .select('id')
        .maybeSingle();
      if (updateError) {
        context.log?.error?.('import-workspaces: scalar update failed', { message: updateError.message });
        return respondWorkspacesError(context, 500, 'failed_to_update_workspace', updateError, { action: 'update_scalar', workspaceId });
      }
      if (!scalarUpdated) {
        return respond(context, 404, { message: 'workspace_not_found' });
      }
    }

    // Return the full updated workspace
    const { data, error: fetchError } = await withOrgScope(supabase, 'import_workspaces', orgId)
      .select('*')
      .eq('id', workspaceId)
      .maybeSingle();
    if (fetchError) {
      context.log?.error?.('import-workspaces: post-patch fetch failed', { message: fetchError.message });
      return respondWorkspacesError(context, 500, 'failed_to_fetch_workspace', fetchError, { action: 'post_patch_fetch', workspaceId });
    }
    if (!data) {
      return respond(context, 404, { message: 'workspace_not_found' });
    }
    return respond(context, 200, { workspace: data });
  }

  // ── DELETE /api/import-workspaces/:id — remove workspace + all import data ──
  if (method === 'DELETE') {
    const { data: workspace, error: loadError } = await withOrgScope(supabase, 'import_workspaces', orgId)
      .select('id, status, config')
      .eq('id', workspaceId)
      .maybeSingle();
    if (loadError) {
      context.log?.error?.('import-workspaces: delete load failed', { message: loadError.message });
      return respondWorkspacesError(context, 500, 'failed_to_load_workspace', loadError, { action: 'load_for_delete', workspaceId });
    }
    if (!workspace) {
      return respond(context, 404, { message: 'workspace_not_found' });
    }
    // Only un-committed workspaces can be deleted: once data has gone live we keep
    // the staging + audit trail so the import stays traceable.
    if (COMMITTED_STATUSES.has(normalizeString(workspace.status))) {
      return respond(context, 409, { message: 'cannot_delete_committed_workspace', status: workspace.status });
    }
    // A *partial* commit leaves the workspace status at 'needs_review' (nothing sets
    // 'partially_committed' today), so the status check above isn't enough. Refuse if
    // ANY candidate already went live — deleting would drop the commit ledger for
    // records that now exist in the live tables. (See tracking issue: derive
    // workspace status from candidate state instead of a stored column.)
    const { count: committedCount, error: committedCountError } = await withOrgScope(supabase, 'import_candidates', orgId)
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('status', 'committed');
    if (committedCountError) {
      context.log?.error?.('import-workspaces: committed-candidate check failed', { message: committedCountError.message });
      return respondWorkspacesError(context, 500, 'failed_to_load_workspace', committedCountError, { action: 'check_committed_candidates', workspaceId });
    }
    if ((committedCount ?? 0) > 0) {
      return respond(context, 409, { message: 'cannot_delete_committed_workspace', committed_candidates: committedCount });
    }

    // Best-effort removal of the temporary backup file(s). A storage failure must
    // not block the DB cleanup — the objects also expire on their own TTL.
    const objectKeys = collectWorkspaceObjectKeys(workspace.config || {});
    let filesDeleted = 0;
    const fileErrors = [];
    if (objectKeys.length > 0) {
      let driver = null;
      try {
        driver = getStorageDriver('managed', null, env);
      } catch (err) {
        context.log?.error?.('import-workspaces: storage init for delete failed', { message: err?.message });
      }
      if (driver) {
        for (const key of objectKeys) {
          try {
            await driver.delete(key);
            filesDeleted += 1;
          } catch (err) {
            fileErrors.push(key);
            context.log?.error?.('import-workspaces: backup delete failed', { objectKey: key, message: err?.message });
          }
        }
      }
    }

    // Delete the workspace row. FK ON DELETE CASCADE removes import_rows,
    // import_candidates and import_commit_ledger automatically. Live tables are
    // untouched — no foreign key points from live data into the import tables.
    const { error: deleteError } = await withOrgScope(supabase, 'import_workspaces', orgId)
      .delete()
      .eq('id', workspaceId);
    if (deleteError) {
      context.log?.error?.('import-workspaces: delete failed', { message: deleteError.message });
      return respondWorkspacesError(context, 500, 'failed_to_delete_workspace', deleteError, { action: 'delete', workspaceId });
    }

    return respond(context, 200, {
      deleted: true,
      workspace_id: workspaceId,
      files_deleted: filesDeleted,
      files_failed: fileErrors.length,
    });
  }

  return respond(context, 405, { message: 'method_not_allowed' });
}
