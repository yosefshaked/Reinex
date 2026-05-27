/* eslint-env node */
// Phase 3 — Row Ingestion
// Accepts chunked frontend-parsed rows and upserts them into import_rows.
// Idempotent: (workspace_id, source_reference, row_index) is the natural key.
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

// Hard cap enforced at the API boundary: keeps each request well within the
// 30-second Azure SWA timeout and prevents client-side misconfiguration.
const MAX_ROWS_PER_CHUNK = 500;

function normalizeUuid(value) {
  const normalized = normalizeString(value);
  if (!normalized) return '';
  return UUID_PATTERN.test(normalized) ? normalized : '';
}

/**
 * Invariant #4 defence: scrub any empty strings that survived the worker pass.
 * Only operates on the top-level keys of a flat object (raw_data is always flat).
 */
function scrubRawData(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
  const out = {};
  for (const key of Object.keys(obj)) {
    const v = obj[key];
    out[key] = (v === '' || v === undefined) ? null : v;
  }
  return out;
}

export default async function importWorkspacesRowsBulk(context, req) {
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
    context.log?.error?.('import-workspaces-rows-bulk: auth failed', { message: err?.message });
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

  const workspaceId = normalizeUuid(req.params?.workspaceId);
  if (!workspaceId) {
    return respond(context, 400, { message: 'workspace_id_required' });
  }

  let role;
  try {
    role = await ensureMembership(supabase, orgId, userId);
  } catch (err) {
    context.log?.error?.('import-workspaces-rows-bulk: membership check failed', { message: err?.message });
    return respond(context, 500, { message: 'failed_to_verify_membership' });
  }
  if (!role) {
    return respond(context, 403, { message: 'forbidden' });
  }
  if (!isAdminOrOffice(role)) {
    return respond(context, 403, { message: 'forbidden' });
  }

  // ── Payload validation ────────────────────────────────────────────────────

  const sourceReference = normalizeString(body?.source_reference);
  if (!sourceReference) {
    return respond(context, 400, { message: 'source_reference_required' });
  }

  const rows = body?.rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    return respond(context, 400, { message: 'rows_required' });
  }
  if (rows.length > MAX_ROWS_PER_CHUNK) {
    return respond(context, 400, {
      message: 'chunk_too_large',
      max: MAX_ROWS_PER_CHUNK,
      received: rows.length,
    });
  }

  // Validate that every row carries a non-negative integer row_index and an
  // object raw_data. Stop at the first invalid row so the frontend can report
  // the exact position.
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (
      !r ||
      typeof r !== 'object' ||
      typeof r.row_index !== 'number' ||
      !Number.isInteger(r.row_index) ||
      r.row_index < 0
    ) {
      return respond(context, 400, { message: 'invalid_row_index', index: i });
    }
    if (!r.raw_data || typeof r.raw_data !== 'object' || Array.isArray(r.raw_data)) {
      return respond(context, 400, { message: 'invalid_raw_data', index: i });
    }
  }

  // ── Upsert ────────────────────────────────────────────────────────────────

  const records = rows.map((r) => ({
    org_id: orgId,
    workspace_id: workspaceId,
    source_reference: sourceReference,
    row_index: r.row_index,
    raw_data: scrubRawData(r.raw_data),
  }));

  const { error: upsertError } = await withOrgScope(supabase, 'import_rows', orgId)
    .upsert(records, { onConflict: 'workspace_id,source_reference,row_index' });

  if (upsertError) {
    context.log?.error?.('import-workspaces-rows-bulk: upsert failed', { message: upsertError.message });
    return respond(context, 500, { message: 'row_upsert_failed' });
  }

  return respond(context, 200, { inserted: records.length });
}
