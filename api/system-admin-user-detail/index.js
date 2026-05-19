/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import { ensureSystemAdmin, normalizeString, readEnv, respond, parseRequestBody } from '../_shared/org-bff.js';
import { logAuditEvent } from '../_shared/audit-log.js';

/**
 * Fetch active sessions for a user via the Supabase management REST API.
 * The JS SDK admin client does not expose a listSessions method, so we call
 * the REST endpoint directly. Falls back to an empty array on any error.
 */
async function fetchUserSessions(supabaseUrl, serviceRoleKey, userId) {
  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}/sessions`, {
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const body = await res.json();
    // Response may be { sessions: [...] } or a bare array depending on Supabase version.
    return Array.isArray(body) ? body : (Array.isArray(body?.sessions) ? body.sessions : []);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// GET — fetch full user detail: identity, MFA factors, sessions, memberships
// ---------------------------------------------------------------------------
async function handleGet(context, req, supabase, adminConfig) {
  const userId = normalizeString(req?.query?.user_id);
  if (!userId) {
    return respond(context, 400, { message: 'user_id_required' });
  }

  const [userResult, membershipsResult, sessions] = await Promise.allSettled([
    supabase.auth.admin.getUserById(userId),
    supabase
      .from('org_memberships')
      .select('id, org_id, role, is_active, created_at, organizations(id, name, slug)')
      .eq('user_id', userId)
      .order('created_at', { ascending: true }),
    fetchUserSessions(adminConfig.supabaseUrl, adminConfig.serviceRoleKey, userId),
  ]);

  // User lookup — this must succeed.
  const userValue = userResult.status === 'fulfilled' ? userResult.value : null;
  if (!userValue || userValue.error) {
    const msg = userValue?.error?.message || '';
    if (msg.includes('not found') || userValue?.error?.status === 404) {
      return respond(context, 404, { message: 'user_not_found' });
    }
    context.log?.error?.('system-admin-user-detail: getUserById failed', { message: msg });
    return respond(context, 500, { message: 'user_lookup_failed' });
  }

  const user = userValue.data?.user;
  if (!user) {
    return respond(context, 404, { message: 'user_not_found' });
  }

  // MFA factors from the user object returned by getUserById.
  const factors = (Array.isArray(user.factors) ? user.factors : []).map((f) => ({
    id: f.id,
    friendly_name: f.friendly_name || null,
    factor_type: f.factor_type || 'totp',
    status: f.status || 'unverified',
    created_at: f.created_at || null,
    updated_at: f.updated_at || null,
  }));

  // Org memberships with names.
  const membershipsRaw =
    membershipsResult.status === 'fulfilled' && Array.isArray(membershipsResult.value?.data)
      ? membershipsResult.value.data
      : [];
  const memberships = membershipsRaw.map((m) => ({
    id: m.id,
    org_id: m.org_id,
    org_name: m.organizations?.name || m.org_id,
    org_slug: m.organizations?.slug || null,
    role: m.role,
    is_active: m.is_active,
    joined_at: m.created_at,
  }));

  const sessionList = sessions.status === 'fulfilled' ? (sessions.value ?? []) : [];

  // Auth identities — only expose provider + email/phone hint.
  const identities = (user.identities || []).map((id) => ({
    provider: id.provider,
    email: id.identity_data?.email || null,
    phone: id.identity_data?.phone || null,
    created_at: id.created_at || null,
    last_sign_in_at: id.last_sign_in_at || null,
  }));

  return respond(context, 200, {
    user: {
      id: user.id,
      email: user.email || null,
      phone: user.phone || null,
      created_at: user.created_at || null,
      updated_at: user.updated_at || null,
      last_sign_in_at: user.last_sign_in_at || null,
      email_confirmed_at: user.email_confirmed_at || null,
      phone_confirmed_at: user.phone_confirmed_at || null,
      banned_until: user.banned_until || null,
      deleted_at: user.deleted_at || null,
      identities,
    },
    factors,
    sessions: sessionList,
    memberships,
    requested_at: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// POST — actions: force_signout
// ---------------------------------------------------------------------------
async function handlePost(context, req, supabase, admin) {
  const body = await parseRequestBody(req);
  const action = normalizeString(body?.action);

  if (action === 'force_signout') {
    const userId = normalizeString(body?.user_id);
    if (!userId) {
      return respond(context, 400, { message: 'user_id_required' });
    }

    // Look up the user to get their email for the audit log.
    const { data: targetData, error: targetError } = await supabase.auth.admin.getUserById(userId);
    if (targetError || !targetData?.user) {
      return respond(context, 404, { message: 'user_not_found' });
    }
    const targetEmail = targetData.user.email || userId;

    // Sign out all sessions for the target user.
    const { error: signOutError } = await supabase.auth.admin.signOut(userId, 'global');
    if (signOutError) {
      context.log?.error?.('system-admin-user-detail: force_signout failed', {
        message: signOutError.message,
        userId,
      });
      return respond(context, 500, { message: 'force_signout_failed' });
    }

    // Audit log — non-fatal.
    logAuditEvent(supabase, {
      orgId: null,
      userId: admin.userId,
      userEmail: admin.email,
      userRole: 'system_admin',
      actionType: 'system_admin.user_force_signout',
      actionCategory: 'admin_control',
      resourceType: 'auth_user',
      resourceId: userId,
      details: { target_user_id: userId, target_email: targetEmail },
    }).catch(() => {});

    return respond(context, 200, { message: 'signed_out', target_user_id: userId });
  }

  return respond(context, 400, { message: 'unknown_action' });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
export default async function systemAdminUserDetail(context, req) {
  const method = String(req.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'POST') {
    return respond(context, 405, { message: 'method_not_allowed' });
  }

  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);

  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('system-admin-user-detail: missing supabase admin credentials');
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
    if (method === 'GET') return await handleGet(context, req, supabase, adminConfig, admin);
    return await handlePost(context, req, supabase, admin);
  } catch (error) {
    context.log?.error?.('system-admin-user-detail: unexpected error', { message: error?.message });
    return respond(context, 500, { message: 'internal_error' });
  }
}
