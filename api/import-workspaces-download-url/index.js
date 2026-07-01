/* eslint-env node */
// GET /api/import-workspaces/{workspaceId}/download-url?objectKey=...
// Returns a pre-signed R2 GET URL so the browser can re-fetch a previously
// uploaded import file and re-parse it locally (recovery after a refresh, when
// the in-memory parsed rows are gone). Only object keys that belong to the
// workspace's own config can be requested — never an arbitrary key.
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

function respondDownloadUrlError(context, status, message, error, metadata = {}) {
  return respondTracked(context, status, { message }, undefined, { error, metadata });
}

// Short-lived: the browser fetches the file immediately after receiving the URL.
const PRESIGNED_TTL_SECONDS = 300;

function normalizeUuid(value) {
  const s = normalizeString(value);
  return UUID_PATTERN.test(s) ? s : '';
}

// Collect every object key the workspace legitimately owns, mapped to its filename.
function collectKnownObjects(config = {}) {
  const byKey = new Map();
  const add = (key, fileName) => {
    const normalized = normalizeString(key);
    if (normalized && !byKey.has(normalized)) byKey.set(normalized, normalizeString(fileName) || null);
  };
  add(config.objectKey, config.fileName);
  for (const file of Array.isArray(config.files) ? config.files : []) {
    add(file?.objectKey, file?.fileName);
  }
  for (const source of Array.isArray(config.sources) ? config.sources : []) {
    add(source?.file?.objectKey, source?.file?.fileName || source?.label);
  }
  return byKey;
}

export default async function importWorkspacesDownloadUrl(context, req) {
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
    context.log?.error?.('import-workspaces-download-url: auth error', { message: err?.message });
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
    metadata: { endpoint: 'import-workspaces-download-url', workspaceId },
  });

  let role;
  try {
    role = await ensureMembership(supabase, orgId, userId);
  } catch (err) {
    context.log?.error?.('import-workspaces-download-url: membership error', { message: err?.message });
    return respondDownloadUrlError(context, 500, 'failed_to_verify_membership', err, { action: 'verify_membership' });
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
    context.log?.error?.('import-workspaces-download-url: workspace lookup failed', { message: workspaceError.message });
    return respondDownloadUrlError(context, 500, 'failed_to_load_workspace', workspaceError, { action: 'load_workspace' });
  }
  if (!workspace) {
    return respond(context, 404, { message: 'workspace_not_found' });
  }

  const config = workspace.config || {};
  const knownObjects = collectKnownObjects(config);

  // Default to the workspace's primary backup when no key is supplied.
  const requestedKey = normalizeString(req.query?.objectKey) || normalizeString(config.objectKey);
  if (!requestedKey) {
    return respond(context, 404, { message: 'no_backup_available' });
  }
  if (!knownObjects.has(requestedKey)) {
    return respond(context, 403, { message: 'object_not_in_workspace' });
  }

  let driver;
  try {
    driver = getStorageDriver('managed', null, env);
  } catch (err) {
    return respondDownloadUrlError(context, 500, 'storage_unavailable', err, { action: 'init_storage' });
  }

  // Confirm the object still exists before presigning so callers can fall back
  // to a re-upload prompt instead of getting a URL that 404s.
  try {
    const existence = await driver.exists(requestedKey);
    if (!existence.exists) {
      return respond(context, 404, { message: 'backup_missing_or_expired', object_key: requestedKey });
    }
  } catch (err) {
    context.log?.error?.('import-workspaces-download-url: existence check failed', { message: err?.message });
    return respondDownloadUrlError(context, 500, 'failed_to_check_backup', err, { action: 'check_backup', objectKey: requestedKey });
  }

  let downloadUrl;
  try {
    const fileName = knownObjects.get(requestedKey) || 'import-file';
    // Use 'attachment' (not 'inline') so the driver always returns a *presigned*
    // URL on the R2 storage domain (*.r2.cloudflarestorage.com), which the app CSP
    // connect-src allows. The 'inline' path would return the public custom-domain
    // URL (documents.thepcrunners.com), which CSP blocks — and which a private
    // backup object would not serve anyway. The browser fetch()es the body, so the
    // attachment Content-Disposition has no effect on recovery.
    downloadUrl = await driver.getDownloadUrl(requestedKey, PRESIGNED_TTL_SECONDS, fileName, 'attachment');
  } catch (err) {
    context.log?.error?.('import-workspaces-download-url: presign failed', { message: err?.message });
    return respondDownloadUrlError(context, 500, 'storage_unavailable', err, { action: 'presign_download_url' });
  }

  return respond(context, 200, {
    downloadUrl,
    objectKey: requestedKey,
    fileName: knownObjects.get(requestedKey) || null,
  });
}
