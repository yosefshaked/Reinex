/* eslint-env node */
// GET /api/import-workspaces/{workspaceId}/upload-url?filename=...&contentType=...
// Returns a pre-signed R2 PUT URL for direct browser-to-storage upload.
// Azure validates membership and role before issuing the URL.
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
} from '../_shared/org-bff.js';
import { getStorageDriver } from '../cross-platform/storage-drivers/index.js';

// Only these MIME types are accepted as import sources.
const ALLOWED_CONTENT_TYPES = new Set([
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel',                                           // .xls
]);

// Pre-signed URL validity — 15 minutes is enough for a direct browser PUT.
const PRESIGNED_TTL_SECONDS = 900;

/**
 * Sanitize a filename so it is safe to embed in an R2 object key.
 * Removes path separators and any character outside the printable ASCII range.
 */
function sanitizeFilename(name) {
  return name
    .replace(/[/\\]/g, '_')
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 200); // hard cap
}

function normalizeUuid(value) {
  const s = normalizeString(value);
  return UUID_PATTERN.test(s) ? s : '';
}

export default async function importWorkspacesUploadUrl(context, req) {
  const env = readEnv(context);

  // ── Auth ─────────────────────────────────────────────────────────────────
  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    return respond(context, 401, { message: 'missing_bearer' });
  }

  const supabase = createSingleClient(env);
  let authResult;
  try {
    authResult = await supabase.auth.getUser(authorization.token);
  } catch (err) {
    context.log?.error?.('import-workspaces-upload-url: auth error', { message: err?.message });
    return respond(context, 401, { message: 'invalid_or_expired_token' });
  }
  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid_or_expired_token' });
  }
  const userId = authResult.data.user.id;

  // ── Org + route params ────────────────────────────────────────────────────
  // resolveOrgId reads x-org-id from headers; no body on a GET.
  const orgId = resolveOrgId(req, {});
  if (!orgId) {
    return respond(context, 400, { message: 'invalid_org_id' });
  }

  const workspaceId = normalizeUuid(req.params?.workspaceId);
  if (!workspaceId) {
    return respond(context, 400, { message: 'workspace_id_required' });
  }

  // ── Membership + role gate ────────────────────────────────────────────────
  let role;
  try {
    role = await ensureMembership(supabase, orgId, userId);
  } catch (err) {
    context.log?.error?.('import-workspaces-upload-url: membership error', { message: err?.message });
    return respond(context, 500, { message: 'failed_to_verify_membership' });
  }
  if (!role) {
    return respond(context, 403, { message: 'forbidden' });
  }
  if (!isAdminOrOffice(role)) {
    return respond(context, 403, { message: 'forbidden' });
  }

  // ── Query param validation ────────────────────────────────────────────────
  const rawFilename = normalizeString(req.query?.filename ?? '');
  const contentType = normalizeString(req.query?.contentType ?? '');

  if (!rawFilename) {
    return respond(context, 400, { message: 'filename_required' });
  }
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    return respond(context, 400, { message: 'unsupported_content_type' });
  }

  // ── Build object key ──────────────────────────────────────────────────────
  // Pattern: imports/{orgId}/{workspaceId}/{timestamp}_{sanitizedFilename}
  // The timestamp prevents collisions on re-uploads of the same file.
  const safeFilename = sanitizeFilename(rawFilename);
  const timestamp = Date.now();
  const objectKey = `imports/${orgId}/${workspaceId}/${timestamp}_${safeFilename}`;

  // ── Generate pre-signed PUT URL via managed R2 ────────────────────────────
  let uploadUrl;
  try {
    const driver = getStorageDriver('managed', null, env);
    uploadUrl = await driver.getUploadUrl(objectKey, contentType, PRESIGNED_TTL_SECONDS);
  } catch (err) {
    context.log?.error?.('import-workspaces-upload-url: presign failed', { message: err?.message });
    return respond(context, 500, { message: 'storage_unavailable' });
  }

  return respond(context, 200, { uploadUrl, objectKey });
}
