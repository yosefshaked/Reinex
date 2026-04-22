/* eslint-env node */
/**
 * system-admin-store — generic CRUD store for admin-console modules.
 *
 * Replaces per-browser localStorage for Incidents, Knowledge Base,
 * Future Ideas, and Compliance Requests so all system admins share
 * the same data regardless of browser or machine.
 *
 * GET    ?module=<name>                           → list all records
 * POST   { module, record_id, data }              → upsert by record_id
 * DELETE ?module=<name>&record_id=<id>            → delete one record
 *
 * Returns 501 if the admin_data table doesn't exist yet (setup-sql.js
 * not yet re-run), so the frontend can gracefully fall back to localStorage.
 */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import { ensureSystemAdmin, normalizeString, readEnv, respond, parseRequestBody } from '../_shared/org-bff.js';

const ALLOWED_MODULES = new Set(['incidents', 'knowledge_base', 'future_ideas', 'compliance']);

function isTableMissingError(error) {
  if (!error) return false;
  const msg = String(error.message || error.details || '').toLowerCase();
  return (
    msg.includes('relation') && msg.includes('does not exist') ||
    msg.includes('admin_data') ||
    String(error.code || '') === '42P01'
  );
}

// ---------------------------------------------------------------------------
// GET — list all records for a module
// ---------------------------------------------------------------------------
async function handleGet(context, req, supabase, admin) {
  const module = normalizeString(req?.query?.module);
  if (!module || !ALLOWED_MODULES.has(module)) {
    return respond(context, 400, { message: 'invalid_module' });
  }

  const { data, error } = await supabase
    .from('admin_data')
    .select('id, record_id, data, created_by, created_at, updated_at')
    .eq('module', module)
    .order('created_at', { ascending: false });

  if (error) {
    if (isTableMissingError(error)) {
      return respond(context, 501, { message: 'table_not_found', hint: 'Re-run setup-sql.js to create the admin_data table.' });
    }
    context.log?.error?.('system-admin-store GET: query failed', { message: error.message, module });
    return respond(context, 500, { message: 'query_failed' });
  }

  // Return the `data` JSONB blob directly — it contains the full record as
  // stored by the frontend (identical shape to the old localStorage records).
  const records = (data || []).map((row) => ({
    ...(row.data || {}),
    id: row.record_id, // ensure id field matches the record_id
    _meta: { db_id: row.id, created_by: row.created_by, created_at: row.created_at, updated_at: row.updated_at },
  }));

  return respond(context, 200, {
    module,
    records,
    count: records.length,
    requested_at: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// POST — upsert a record (insert or replace by module + record_id)
// ---------------------------------------------------------------------------
async function handlePost(context, req, supabase, admin) {
  const body = await parseRequestBody(req);

  const module = normalizeString(body?.module);
  if (!module || !ALLOWED_MODULES.has(module)) {
    return respond(context, 400, { message: 'invalid_module' });
  }

  const recordId = normalizeString(body?.record_id);
  if (!recordId) {
    return respond(context, 400, { message: 'record_id_required' });
  }

  const data = body?.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return respond(context, 400, { message: 'data_must_be_object' });
  }

  const { data: result, error } = await supabase
    .from('admin_data')
    .upsert(
      {
        module,
        record_id: recordId,
        data,
        created_by: admin.userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'module,record_id', ignoreDuplicates: false },
    )
    .select('id, record_id, created_at, updated_at')
    .single();

  if (error) {
    if (isTableMissingError(error)) {
      return respond(context, 501, { message: 'table_not_found' });
    }
    context.log?.error?.('system-admin-store POST: upsert failed', { message: error.message, module, recordId });
    return respond(context, 500, { message: 'upsert_failed' });
  }

  return respond(context, 200, {
    record: { db_id: result.id, record_id: result.record_id, created_at: result.created_at, updated_at: result.updated_at },
  });
}

// ---------------------------------------------------------------------------
// DELETE — remove a record
// ---------------------------------------------------------------------------
async function handleDelete(context, req, supabase) {
  const module = normalizeString(req?.query?.module);
  if (!module || !ALLOWED_MODULES.has(module)) {
    return respond(context, 400, { message: 'invalid_module' });
  }

  const recordId = normalizeString(req?.query?.record_id);
  if (!recordId) {
    return respond(context, 400, { message: 'record_id_required' });
  }

  const { error } = await supabase
    .from('admin_data')
    .delete()
    .eq('module', module)
    .eq('record_id', recordId);

  if (error) {
    if (isTableMissingError(error)) {
      return respond(context, 501, { message: 'table_not_found' });
    }
    context.log?.error?.('system-admin-store DELETE: failed', { message: error.message, module, recordId });
    return respond(context, 500, { message: 'delete_failed' });
  }

  return respond(context, 200, { deleted: true, record_id: recordId });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
export default async function systemAdminStore(context, req) {
  const method = String(req.method || 'GET').toUpperCase();
  if (!['GET', 'POST', 'DELETE'].includes(method)) {
    return respond(context, 405, { message: 'method_not_allowed' });
  }

  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);

  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    return respond(context, 401, { message: 'missing_bearer_token' });
  }

  const supabase = createSupabaseAdminClient(adminConfig);

  let admin;
  try {
    admin = await ensureSystemAdmin(req, supabase, authorization, { context });
  } catch (error) {
    return respond(context, error?.statusCode || 403, { message: error?.message || 'forbidden' });
  }

  try {
    if (method === 'GET') return await handleGet(context, req, supabase, admin);
    if (method === 'POST') return await handlePost(context, req, supabase, admin);
    return await handleDelete(context, req, supabase);
  } catch (error) {
    context.log?.error?.('system-admin-store: unexpected error', { message: error?.message });
    return respond(context, 500, { message: 'internal_error' });
  }
}
