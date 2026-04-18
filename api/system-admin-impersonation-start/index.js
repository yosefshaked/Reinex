/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { logAuditEvent } from '../_shared/audit-log.js';
import {
  createSupabaseAdminClient,
  readSupabaseAdminConfig,
} from '../_shared/supabase-admin.js';
import { ensureSystemAdmin, normalizeString, parseRequestBody, readEnv, respond } from '../_shared/org-bff.js';

/**
 * POST /api/system-admin-impersonation-start
 *
 * Body: { target_email: string, reason: string, duration_minutes?: number,
 *         target_org_id?: string }
 *
 * Response: { session_id, hashed_token, target_user_id, target_email,
 *             target_name, target_org_id, target_org_name, expires_at }
 *
 * Client uses `hashed_token` with `supabase.auth.verifyOtp({ token_hash, type: 'magiclink' })`
 * to swap the browser session to the target user.
 */

const DEFAULT_DURATION_MINUTES = 30;
const MAX_DURATION_MINUTES = 240;

function resolveDurationMinutes(raw) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_DURATION_MINUTES;
  return Math.min(Math.round(parsed), MAX_DURATION_MINUTES);
}

function extractForensicContext(req) {
  const headers = req?.headers || {};
  const ipRaw = headers['x-forwarded-for'] || headers['x-real-ip'] || '';
  const ip = typeof ipRaw === 'string' ? ipRaw.split(',')[0].trim() : null;
  const userAgent = typeof headers['user-agent'] === 'string' ? headers['user-agent'] : null;
  return { ip: ip || null, userAgent };
}

async function lookupTargetUser(supabase, email) {
  // 1. Resolve the auth user. admin.listUsers supports `email` filter but is not
  //    exposed uniformly; using a direct users lookup via RPC-compatible path.
  //    Fallback: fetch profiles by email, then get auth user by id.
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, full_name, email')
    .ilike('email', email)
    .maybeSingle();

  if (profileError) {
    throw Object.assign(new Error('target_lookup_failed'), { statusCode: 500, cause: profileError });
  }

  if (!profile) {
    return null;
  }

  return {
    id: profile.id,
    email: profile.email || email,
    full_name: profile.full_name || null,
  };
}

async function lookupOrg(supabase, orgId) {
  if (!orgId) return null;
  const { data } = await supabase
    .from('organizations')
    .select('id, name')
    .eq('id', orgId)
    .maybeSingle();
  return data || null;
}

export default async function adminImpersonationStart(context, req) {
  const method = String(req.method || 'GET').toUpperCase();
  if (method !== 'POST') {
    return respond(context, 405, { message: 'method_not_allowed' });
  }

  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);

  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('system-admin-impersonation-start: missing supabase admin credentials');
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

  const targetEmail = normalizeString(body?.target_email).toLowerCase();
  const reason = normalizeString(body?.reason);
  const targetOrgId = normalizeString(body?.target_org_id);
  const durationMinutes = resolveDurationMinutes(body?.duration_minutes);

  if (!targetEmail) {
    return respond(context, 400, { message: 'target_email_required' });
  }
  if (reason.length < 3) {
    return respond(context, 400, { message: 'reason_required', min_length: 3 });
  }
  if (targetEmail.toLowerCase() === String(admin.email || '').toLowerCase()) {
    return respond(context, 400, { message: 'cannot_impersonate_self' });
  }

  // Resolve target profile + optional org.
  let targetUser;
  try {
    targetUser = await lookupTargetUser(supabase, targetEmail);
  } catch (error) {
    context.log?.error?.('system-admin-impersonation-start: lookup failed', { message: error?.message });
    return respond(context, 500, { message: 'target_lookup_failed' });
  }

  if (!targetUser) {
    return respond(context, 404, { message: 'target_user_not_found' });
  }

  const org = await lookupOrg(supabase, targetOrgId).catch(() => null);

  // Generate a magic-link hashed_token the client will redeem locally via verifyOtp.
  let linkData;
  try {
    const result = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email: targetUser.email,
    });
    if (result.error) throw result.error;
    linkData = result.data;
  } catch (error) {
    context.log?.error?.('system-admin-impersonation-start: generateLink failed', { message: error?.message });
    return respond(context, 500, { message: 'generate_link_failed' });
  }

  const hashedToken = linkData?.properties?.hashed_token;
  if (!hashedToken) {
    return respond(context, 500, { message: 'generate_link_missing_token' });
  }

  const expiresAt = new Date(Date.now() + durationMinutes * 60 * 1000).toISOString();
  const { ip, userAgent } = extractForensicContext(req);

  // Record the session. If the impersonation_sessions table is missing we
  // surface a clear error (501) rather than silently failing — the SSOT
  // setup script at src/lib/setup-sql.js must be applied against the DB.
  let sessionRow;
  try {
    const { data, error } = await supabase
      .from('impersonation_sessions')
      .insert({
        admin_user_id: admin.userId,
        admin_email: admin.email,
        target_user_id: targetUser.id,
        target_email: targetUser.email,
        target_org_id: org?.id || null,
        target_org_name: org?.name || null,
        reason,
        status: 'active',
        expires_at: expiresAt,
        ip,
        user_agent: userAgent,
      })
      .select('id, started_at, expires_at')
      .single();

    if (error) {
      if (String(error.code) === '42P01') {
        return respond(context, 501, {
          message: 'impersonation_table_missing',
          hint: 'Run the SSOT setup script at src/lib/setup-sql.js against your database',
        });
      }
      throw error;
    }
    sessionRow = data;
  } catch (error) {
    context.log?.error?.('system-admin-impersonation-start: session insert failed', { message: error?.message });
    return respond(context, 500, { message: 'session_insert_failed' });
  }

  // Audit the start. Failure of audit does not fail the request — but we do
  // capture the audit event id on the session row so every session is
  // correlatable to a single audit entry.
  try {
    await logAuditEvent(supabase, {
      orgId: org?.id || null,
      userId: admin.userId,
      userEmail: admin.email,
      userRole: 'system_admin',
      actionType: 'system_admin.impersonation_started',
      actionCategory: 'admin_control',
      resourceType: 'impersonation',
      resourceId: sessionRow.id,
      details: {
        session_id: sessionRow.id,
        target_user_id: targetUser.id,
        target_email: targetUser.email,
        target_org_id: org?.id || null,
        reason,
        duration_minutes: durationMinutes,
      },
      metadata: { source: 'system-admin-impersonation-start', ip, user_agent: userAgent },
    });
  } catch (err) {
    context.log?.warn?.('system-admin-impersonation-start: audit log failed', { message: err?.message });
  }

  return respond(context, 200, {
    session_id: sessionRow.id,
    hashed_token: hashedToken,
    target_user_id: targetUser.id,
    target_email: targetUser.email,
    target_name: targetUser.full_name,
    target_org_id: org?.id || null,
    target_org_name: org?.name || null,
    started_at: sessionRow.started_at,
    expires_at: sessionRow.expires_at,
  });
}
