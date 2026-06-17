/* eslint-env node */
// GET /api/import-workspaces/{workspaceId}/upload-status
// Checks whether the optional temporary R2 backup object still exists.
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
import { getStorageDriver } from '../cross-platform/storage-drivers/index.js';
import { attachErrorTracking, respondTracked } from '../_shared/error-events.js';

function respondUploadStatusError(context, status, message, error, metadata = {}) {
  return respondTracked(context, status, { message }, undefined, { error, metadata });
}

function normalizeUuid(value) {
  const normalized = normalizeString(value);
  return UUID_PATTERN.test(normalized) ? normalized : '';
}

function addDaysIso(value, days) {
  const base = value ? new Date(value) : null;
  if (!base || Number.isNaN(base.getTime())) return null;
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

export default async function importWorkspacesUploadStatus(context, req) {
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
    context.log?.error?.('import-workspaces-upload-status: auth error', { message: err?.message });
    return respond(context, 401, { message: 'invalid_or_expired_token' });
  }
  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid_or_expired_token' });
  }
  const userId = authResult.data.user.id;

  const orgId = resolveOrgId(req, {});
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
    metadata: { endpoint: 'import-workspaces-upload-status', workspaceId },
  });

  let role;
  try {
    role = await ensureMembership(supabase, orgId, userId);
  } catch (err) {
    context.log?.error?.('import-workspaces-upload-status: membership error', { message: err?.message });
    return respondUploadStatusError(context, 500, 'failed_to_verify_membership', err, { action: 'verify_membership' });
  }
  if (!role) {
    return respond(context, 403, { message: 'forbidden' });
  }
  if (!isAdminOrOffice(role)) {
    return respond(context, 403, { message: 'forbidden' });
  }

  const { data: workspace, error: workspaceError } = await withOrgScope(supabase, 'import_workspaces', orgId)
    .select('id, config')
    .eq('id', workspaceId)
    .maybeSingle();

  if (workspaceError) {
    context.log?.error?.('import-workspaces-upload-status: workspace lookup failed', { message: workspaceError.message });
    return respondUploadStatusError(context, 500, 'failed_to_load_workspace', workspaceError, { action: 'load_workspace' });
  }
  if (!workspace) {
    return respond(context, 404, { message: 'workspace_not_found' });
  }

  const config = workspace.config || {};
  const objectKey = normalizeString(config.objectKey);
  const uploadedAt = normalizeString(config.uploadedAt);
  const backupExpiresAt = normalizeString(config.backupExpiresAt) || addDaysIso(uploadedAt, 30);

  if (!objectKey) {
    return respond(context, 200, {
      status: 'not_uploaded',
      object_key: null,
      file_name: config.fileName || null,
      uploaded_at: uploadedAt || null,
      backup_expires_at: backupExpiresAt || null,
    });
  }

  try {
    const driver = getStorageDriver('managed', null, env);
    const result = await driver.exists(objectKey);
    return respond(context, 200, {
      status: result.exists ? 'available' : 'missing_or_expired',
      object_key: objectKey,
      file_name: config.fileName || null,
      uploaded_at: uploadedAt || null,
      backup_expires_at: backupExpiresAt || null,
      size: result.size ?? null,
      last_modified: result.lastModified ?? null,
    });
  } catch (err) {
    context.log?.error?.('import-workspaces-upload-status: storage check failed', {
      message: err?.message,
      workspaceId,
      objectKey,
    });
    return respondUploadStatusError(context, 500, 'failed_to_check_upload_status', err, {
      action: 'check_r2_object',
      workspaceId,
    });
  }
}
