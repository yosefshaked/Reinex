/* eslint-env node */
/**
 * Storage Grace Period API
 * 
 * Starts the grace period for an organization's storage.
 * Calculates deletion date based on permission_registry.storage_grace_period_days.
 * 
 * POST /api/storage-start-grace-period
 */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import {
  ensureMembership,
  isAdminRole,
  parseRequestBody,
  readEnv,
  respond,
  resolveOrgId,
} from '../_shared/org-bff.js';
import { AUDIT_ACTIONS, AUDIT_CATEGORIES } from '../_shared/audit-log.js';

export default async function (context, req) {
  context.log('storage-start-grace-period: function started');

  if (req.method !== 'POST') {
    return respond(context, 405, { message: 'method_not_allowed' });
  }

  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);
  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log.error('storage-start-grace-period missing Supabase admin credentials');
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    return respond(context, 401, { message: 'missing_bearer' });
  }

  const supabase = createSupabaseAdminClient(adminConfig);

  // Validate token
  let authResult;
  try {
    authResult = await supabase.auth.getUser(authorization.token);
  } catch (error) {
    context.log.error('storage-start-grace-period failed to validate token', { message: error?.message });
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

  // Verify membership and admin role
  let role;
  try {
    role = await ensureMembership(supabase, orgId, userId);
  } catch (membershipError) {
    context.log.error('storage-start-grace-period failed to verify membership', {
      message: membershipError?.message,
      orgId,
      userId,
    });
    return respond(context, 500, { message: 'failed_to_verify_membership' });
  }

  if (!role) {
    return respond(context, 403, { message: 'not_a_member' });
  }

  if (!isAdminRole(role)) {
    return respond(context, 403, { message: 'admin_or_owner_required' });
  }

  // Get grace period days from permission_registry
  const { data: registryEntry, error: registryError } = await supabase
    .from('permission_registry')
    .select('default_value')
    .eq('permission_key', 'storage_grace_period_days')
    .maybeSingle();

  if (registryError) {
    context.log.error('Failed to fetch grace period from registry', {
      message: registryError.message,
    });
    return respond(context, 500, { message: 'failed_to_fetch_grace_period' });
  }

  // Extract number from JSONB (stored as "30" in quotes)
  const gracePeriodDays = registryEntry?.default_value 
    ? parseInt(registryEntry.default_value, 10) 
    : 30;

  if (isNaN(gracePeriodDays) || gracePeriodDays < 1) {
    context.log.error('Invalid grace period value', { value: registryEntry?.default_value });
    return respond(context, 500, { message: 'invalid_grace_period_configuration' });
  }

  // Calculate grace period end date
  const graceEndsAt = new Date();
  graceEndsAt.setDate(graceEndsAt.getDate() + gracePeriodDays);

  // Get current org settings
  const { data: orgSettings, error: fetchError } = await supabase
    .from('org_settings')
    .select('storage_profile, permissions')
    .eq('org_id', orgId)
    .maybeSingle();

  if (fetchError) {
    context.log.error('Failed to fetch org settings', { message: fetchError.message });
    return respond(context, 500, { message: 'failed_to_fetch_org_settings' });
  }

  if (!orgSettings?.storage_profile?.mode) {
    return respond(context, 400, { message: 'no_storage_configured' });
  }

  // Only allow grace period for managed storage
  if (orgSettings.storage_profile.mode !== 'managed') {
    return respond(context, 400, { message: 'grace_period_only_for_managed_storage' });
  }

  // Update org settings to enter grace period
  const updatedPermissions = {
    ...(orgSettings.permissions || {}),
    storage_access_level: 'read_only_grace',
  };

  const { error: updateError } = await supabase
    .from('org_settings')
    .update({
      permissions: updatedPermissions,
      storage_grace_ends_at: graceEndsAt.toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('org_id', orgId);

  if (updateError) {
    context.log.error('Failed to start grace period', {
      message: updateError.message,
      orgId,
    });
    return respond(context, 500, { message: 'failed_to_start_grace_period' });
  }

  context.log('Grace period started successfully', {
    orgId,
    gracePeriodDays,
    graceEndsAt: graceEndsAt.toISOString(),
  });

  // Log audit event
  try {
    await supabase.rpc('log_audit_event', {
      p_org_id: orgId,
      p_user_id: userId,
      p_user_email: authResult.data.user.email,
      p_user_role: role,
      p_action_type: AUDIT_ACTIONS.STORAGE_GRACE_STARTED,
      p_action_category: AUDIT_CATEGORIES.STORAGE,
      p_resource_type: 'storage_profile',
      p_resource_id: orgId,
      p_details: {
        grace_period_days: gracePeriodDays,
        grace_ends_at: graceEndsAt.toISOString(),
        storage_mode: orgSettings.storage_profile.mode,
      },
    });
  } catch (auditError) {
    context.log.error('Failed to log audit event', { message: auditError.message });
  }

  return respond(context, 200, {
    message: 'grace_period_started',
    grace_period_days: gracePeriodDays,
    grace_ends_at: graceEndsAt.toISOString(),
  });
}
