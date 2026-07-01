/* eslint-env node */
// GET /api/import-workspaces/{workspaceId}/rows-status?sourceReference=...
import { resolveBearerAuthorization } from '../_shared/http.js';
import {
  UUID_PATTERN,
  createSingleClient,
  ensureMembership,
  isAdminOrOffice,
  normalizeString,
  readEnv,
  resolveOrgId,
  respond,
  withOrgScope,
} from '../_shared/org-bff.js';
import { attachErrorTracking, respondTracked } from '../_shared/error-events.js';

function normalizeUuid(value) {
  const normalized = normalizeString(value);
  return UUID_PATTERN.test(normalized) ? normalized : '';
}

function respondRowsStatusError(context, status, message, error, metadata = {}) {
  return respondTracked(context, status, { message }, undefined, { error, metadata });
}

export default async function importWorkspacesRowsStatus(context, req) {
  const env = readEnv(context);
  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) return respond(context, 401, { message: 'missing_bearer' });

  const supabase = createSingleClient(env);
  let authResult;
  try {
    authResult = await supabase.auth.getUser(authorization.token);
  } catch {
    return respond(context, 401, { message: 'invalid_or_expired_token' });
  }
  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid_or_expired_token' });
  }
  const userId = authResult.data.user.id;
  const orgId = resolveOrgId(req, {});
  if (!orgId) return respond(context, 400, { message: 'invalid_org_id' });

  const workspaceId = normalizeUuid(req.params?.workspaceId);
  const sourceReference = normalizeString(req.query?.sourceReference);
  if (!workspaceId) return respond(context, 400, { message: 'workspace_id_required' });
  if (!sourceReference) return respond(context, 400, { message: 'source_reference_required' });

  attachErrorTracking(context, req, supabase, {
    orgId,
    userId,
    metadata: { endpoint: 'import-workspaces-rows-status', workspaceId, sourceReference },
  });

  let role;
  try {
    role = await ensureMembership(supabase, orgId, userId);
  } catch (error) {
    return respondRowsStatusError(context, 500, 'failed_to_verify_membership', error, {
      action: 'verify_membership',
    });
  }
  if (!role || !isAdminOrOffice(role)) return respond(context, 403, { message: 'forbidden' });

  const { data: workspace, error: workspaceError } = await withOrgScope(supabase, 'import_workspaces', orgId)
    .select('id')
    .eq('id', workspaceId)
    .maybeSingle();
  if (workspaceError) {
    return respondRowsStatusError(context, 500, 'failed_to_load_workspace', workspaceError, {
      action: 'load_workspace',
    });
  }
  if (!workspace) return respond(context, 404, { message: 'workspace_not_found' });

  const { count, error: countError } = await withOrgScope(supabase, 'import_rows', orgId)
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .eq('source_reference', sourceReference);
  if (countError) {
    return respondRowsStatusError(context, 500, 'failed_to_count_import_rows', countError, {
      action: 'count_import_rows',
    });
  }

  return respond(context, 200, {
    source_reference: sourceReference,
    ingested_rows: Number(count || 0),
  });
}
