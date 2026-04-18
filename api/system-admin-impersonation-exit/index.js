/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { logAuditEvent } from '../_shared/audit-log.js';
import {
  createSupabaseAdminClient,
  readSupabaseAdminConfig,
} from '../_shared/supabase-admin.js';
import { ensureSystemAdmin, normalizeString, parseRequestBody, readEnv, respond } from '../_shared/org-bff.js';

/**
 * POST /api/system-admin-impersonation-exit
 *
 * Body: { session_id: string, reason?: string }
 *
 * Authorization: MUST be the admin's stashed bearer token (not the target
 * user's current token). The client restores the admin session before
 * calling this endpoint.
 *
 * Side effects:
 *   - Marks the impersonation_sessions row as 'ended'
 *   - Writes an audit event
 */

export default async function adminImpersonationExit(context, req) {
  const method = String(req.method || 'GET').toUpperCase();
  if (method !== 'POST') {
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

  let body = {};
  try {
    body = await parseRequestBody(req);
  } catch {
    return respond(context, 400, { message: 'invalid_json_body' });
  }

  const sessionId = normalizeString(body?.session_id);
  const endedReason = normalizeString(body?.reason) || 'admin_exit';

  if (!sessionId) {
    return respond(context, 400, { message: 'session_id_required' });
  }

  // Load the session. Must be active and owned by the same admin.
  let sessionRow;
  try {
    const { data, error } = await supabase
      .from('impersonation_sessions')
      .select('id, admin_user_id, target_user_id, target_email, target_org_id, status, reason')
      .eq('id', sessionId)
      .maybeSingle();
    if (error) {
      if (String(error.code) === '42P01') {
        return respond(context, 501, { message: 'impersonation_table_missing' });
      }
      throw error;
    }
    sessionRow = data;
  } catch (error) {
    context.log?.error?.('system-admin-impersonation-exit: lookup failed', { message: error?.message });
    return respond(context, 500, { message: 'session_lookup_failed' });
  }

  if (!sessionRow) {
    return respond(context, 404, { message: 'session_not_found' });
  }
  if (sessionRow.admin_user_id !== admin.userId) {
    return respond(context, 403, { message: 'session_not_owned_by_admin' });
  }
  if (sessionRow.status !== 'active') {
    // Idempotent: ending an already-ended session is a no-op success.
    return respond(context, 200, { status: 'already_ended', session_id: sessionId });
  }

  try {
    const { error } = await supabase
      .from('impersonation_sessions')
      .update({
        status: 'ended',
        ended_at: new Date().toISOString(),
        ended_reason: endedReason,
        ended_by_user_id: admin.userId,
      })
      .eq('id', sessionId)
      .eq('status', 'active');
    if (error) throw error;
  } catch (error) {
    context.log?.error?.('system-admin-impersonation-exit: update failed', { message: error?.message });
    return respond(context, 500, { message: 'session_update_failed' });
  }

  try {
    await logAuditEvent(supabase, {
      orgId: sessionRow.target_org_id || null,
      userId: admin.userId,
      userEmail: admin.email,
      userRole: 'system_admin',
      actionType: 'system_admin.impersonation_ended',
      actionCategory: 'admin_control',
      resourceType: 'impersonation',
      resourceId: sessionId,
      details: {
        session_id: sessionId,
        target_user_id: sessionRow.target_user_id,
        target_email: sessionRow.target_email,
        ended_reason: endedReason,
      },
      metadata: { source: 'system-admin-impersonation-exit' },
    });
  } catch (err) {
    context.log?.warn?.('system-admin-impersonation-exit: audit failed', { message: err?.message });
  }

  return respond(context, 200, { status: 'ended', session_id: sessionId });
}
