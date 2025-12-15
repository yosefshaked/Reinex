/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import {
  ensureMembership,
  isAdminRole,
  readEnv,
  respond,
  resolveOrgId,
} from '../_shared/org-bff.js';

const COOLDOWN_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

function computeCooldown(history) {
  if (!Array.isArray(history) || history.length === 0) {
    return { active: false, last_backup_at: null, next_allowed_at: null, days_remaining: 0 };
  }

  const last = history
    .filter((e) => e && e.type === 'backup' && e.status === 'completed' && e.timestamp)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];

  if (!last) {
    return { active: false, last_backup_at: null, next_allowed_at: null, days_remaining: 0 };
  }

  const lastAt = new Date(last.timestamp);
  const nextAt = new Date(lastAt.getTime() + COOLDOWN_DAYS * DAY_MS);
  const now = new Date();
  if (now >= nextAt) {
    return { active: false, last_backup_at: lastAt.toISOString(), next_allowed_at: nextAt.toISOString(), days_remaining: 0 };
  }

  const daysRemaining = Math.ceil((nextAt - now) / DAY_MS);
  return {
    active: true,
    last_backup_at: lastAt.toISOString(),
    next_allowed_at: nextAt.toISOString(),
    days_remaining: daysRemaining,
  };
}

export default async function (context, req) {
  context.log?.info?.('backup-status: request received');

  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);
  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('backup-status missing Supabase admin credentials');
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    context.log?.warn?.('backup-status missing bearer token');
    return respond(context, 401, { message: 'missing bearer' });
  }

  const supabase = createSupabaseAdminClient(adminConfig);

  // Validate token
  let authResult;
  try {
    authResult = await supabase.auth.getUser(authorization.token);
  } catch (error) {
    context.log?.error?.('backup-status failed to validate token', { message: error?.message });
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  const userId = authResult.data.user.id;
  const query = req?.query ?? {};
  const body = {};
  const orgId = resolveOrgId({ query }, body);
  if (!orgId) {
    return respond(context, 400, { message: 'invalid org id' });
  }

  // Membership (admin/owner)
  let role;
  try {
    role = await ensureMembership(supabase, orgId, userId);
  } catch (membershipError) {
    context.log?.error?.('backup-status failed to verify membership', {
      message: membershipError?.message,
      orgId,
      userId,
    });
    return respond(context, 500, { message: 'failed_to_verify_membership' });
  }

  if (!role || !isAdminRole(role)) {
    return respond(context, 403, { message: 'forbidden' });
  }

  // Load history and permissions from control DB
  const { data: orgSettings, error } = await supabase
    .from('org_settings')
    .select('permissions, backup_history')
    .eq('org_id', orgId)
    .maybeSingle();

  if (error) {
    context.log?.error?.('backup-status failed to load org settings', { message: error.message });
    return respond(context, 500, { message: 'failed_to_load_settings' });
  }

  const permissions = typeof orgSettings?.permissions === 'string'
    ? JSON.parse(orgSettings.permissions)
    : orgSettings?.permissions || {};

  const history = Array.isArray(orgSettings?.backup_history) ? orgSettings.backup_history : [];
  const cooldown = computeCooldown(history);

  return respond(context, 200, {
    enabled: permissions.backup_local_enabled === true,
    override_enabled: permissions.backup_cooldown_override === true,
    cooldown,
  }, { 'Cache-Control': 'no-store' });
}
