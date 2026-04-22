/* eslint-env node */
/**
 * system-admin-email-log — read-only view of the email_log table.
 *
 * GET ?limit=50&offset=0&email_type=<type>&status=<status>&search=<q>
 *   → { emails: [...], total, limit, offset }
 *
 * Returns 501 if the email_log table doesn't exist yet (setup-sql.js
 * not yet re-run against this environment).
 */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import { ensureSystemAdmin, normalizeString, readEnv, respond } from '../_shared/org-bff.js';

const ALLOWED_TYPES = new Set([
  'invitation_existing_user',
  'invitation_auth_invite',
  'password_reset',
  'form_submission',
  'waiting_list',
]);

function isTableMissingError(error) {
  if (!error) return false;
  const msg = String(error.message || error.details || '').toLowerCase();
  return (
    (msg.includes('relation') && msg.includes('does not exist')) ||
    msg.includes('email_log') ||
    String(error.code || '') === '42P01'
  );
}

async function handleGet(context, req, supabase) {
  const rawLimit = Number.parseInt(req?.query?.limit ?? '50', 10);
  const rawOffset = Number.parseInt(req?.query?.offset ?? '0', 10);
  const limit = Math.min(Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 50), 200);
  const offset = Math.max(0, Number.isFinite(rawOffset) ? rawOffset : 0);

  const emailType = normalizeString(req?.query?.email_type);
  const status = normalizeString(req?.query?.status);
  const search = normalizeString(req?.query?.search);

  let query = supabase
    .from('email_log')
    .select('id, email_type, to_email, subject, status, error_message, org_id, actor_user_id, metadata, sent_at', { count: 'exact' })
    .order('sent_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (emailType && ALLOWED_TYPES.has(emailType)) {
    query = query.eq('email_type', emailType);
  }

  if (status === 'sent' || status === 'failed') {
    query = query.eq('status', status);
  }

  if (search) {
    query = query.ilike('to_email', `%${search}%`);
  }

  const { data, error, count } = await query;

  if (error) {
    if (isTableMissingError(error)) {
      return respond(context, 501, {
        message: 'table_not_found',
        hint: 'Re-run setup-sql.js to create the email_log table.',
      });
    }
    context.log?.error?.('system-admin-email-log GET: query failed', { message: error.message });
    return respond(context, 500, { message: 'query_failed' });
  }

  return respond(context, 200, {
    emails: data || [],
    total: count ?? 0,
    limit,
    offset,
    requested_at: new Date().toISOString(),
  });
}

export default async function systemAdminEmailLog(context, req) {
  const method = String(req.method || 'GET').toUpperCase();
  if (method !== 'GET') {
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

  try {
    await ensureSystemAdmin(req, supabase, authorization, { context });
  } catch (error) {
    return respond(context, error?.statusCode || 403, { message: error?.message || 'forbidden' });
  }

  try {
    return await handleGet(context, req, supabase);
  } catch (error) {
    context.log?.error?.('system-admin-email-log: unexpected error', { message: error?.message });
    return respond(context, 500, { message: 'internal_error' });
  }
}
