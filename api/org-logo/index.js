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
import { logAuditEvent, AUDIT_ACTIONS, AUDIT_CATEGORIES } from '../_shared/audit-log.js';

export default async function (context, req) {
  context.log?.info?.('org-logo: request received', { method: req.method });

  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);
  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('org-logo missing Supabase admin credentials');
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    context.log?.warn?.('org-logo missing bearer token');
    return respond(context, 401, { message: 'missing bearer' });
  }

  const supabase = createSupabaseAdminClient(adminConfig);

  // Validate token
  let authResult;
  try {
    authResult = await supabase.auth.getUser(authorization.token);
  } catch (error) {
    context.log?.error?.('org-logo failed to validate token', { message: error?.message });
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  const userId = authResult.data.user.id;
  
  // For GET, resolve from query. For POST/DELETE, parse body first
  let body = {};
  if (req.method === 'POST' || req.method === 'DELETE') {
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    } catch {
      return respond(context, 400, { message: 'invalid_json' });
    }
  }
  
  const orgId = resolveOrgId(req, body);
  if (!orgId) {
    return respond(context, 400, { message: 'invalid org id' });
  }

  // Membership (admin/owner)
  let role;
  try {
    role = await ensureMembership(supabase, orgId, userId);
  } catch (membershipError) {
    context.log?.error?.('org-logo failed to verify membership', {
      message: membershipError?.message,
      orgId,
      userId,
    });
    return respond(context, 500, { message: 'failed_to_verify_membership' });
  }

  // GET: Anyone in the org can fetch the logo
  if (req.method === 'GET') {
    const { data: orgSettings, error } = await supabase
      .from('org_settings')
      .select('logo_url, permissions')
      .eq('org_id', orgId)
      .maybeSingle();

    if (error) {
      context.log?.error?.('org-logo failed to load logo_url', { message: error.message });
      return respond(context, 500, { message: 'failed_to_load_logo' });
    }

    let permissions = orgSettings?.permissions;
    if (typeof permissions === 'string') {
      try {
        permissions = JSON.parse(permissions);
      } catch {
        permissions = {};
      }
    }
    const enabled = permissions && permissions.logo_enabled === true;

    return respond(context, 200, {
      logo_url: enabled ? (orgSettings?.logo_url || null) : null,
    }, { 'Cache-Control': 'private, max-age=300' });
  }

  // POST/DELETE: Admin/Owner only
  if (!role || !isAdminRole(role)) {
    return respond(context, 403, { message: 'forbidden' });
  }

  // Check permissions
  const { data: orgSettings, error: permError } = await supabase
    .from('org_settings')
    .select('permissions')
    .eq('org_id', orgId)
    .maybeSingle();

  if (permError) {
    context.log?.error?.('org-logo failed to load permissions', { message: permError.message });
    return respond(context, 500, { message: 'failed_to_load_permissions' });
  }

  const permissions = typeof orgSettings?.permissions === 'string'
    ? JSON.parse(orgSettings.permissions)
    : orgSettings?.permissions || {};

  if (permissions.logo_enabled !== true) {
    return respond(context, 403, { message: 'logo_feature_not_enabled' });
  }

  // POST: Upload logo (URL)
  if (req.method === 'POST') {
    const logoUrl = body?.logo_url;
    if (!logoUrl || typeof logoUrl !== 'string') {
      return respond(context, 400, { message: 'missing_logo_url' });
    }

    // Validate URL format
    try {
      new URL(logoUrl);
    } catch {
      return respond(context, 400, { message: 'invalid_logo_url' });
    }

    // Store logo_url in org_settings
    const { error: updateError } = await supabase
      .from('org_settings')
      .update({ logo_url: logoUrl, updated_at: new Date().toISOString() })
      .eq('org_id', orgId);

    if (updateError) {
      context.log?.error?.('org-logo failed to save logo_url', { message: updateError.message });
      return respond(context, 500, { message: 'failed_to_save_logo' });
    }

    // Audit log
    await logAuditEvent(supabase, {
      orgId,
      userId,
      userEmail: authResult.data.user.email,
      userRole: role,
      actionType: AUDIT_ACTIONS.LOGO_UPDATED,
      actionCategory: AUDIT_CATEGORIES.SETTINGS,
      resourceType: 'org_logo',
      resourceId: orgId,
      details: { action: 'upload', logo_url: logoUrl },
    });

    context.log?.info?.('org-logo uploaded successfully', { orgId, userId });
    return respond(context, 200, { logo_url: logoUrl });
  }

  // DELETE: Remove logo
  if (req.method === 'DELETE') {
    const { error: deleteError } = await supabase
      .from('org_settings')
      .update({ logo_url: null, updated_at: new Date().toISOString() })
      .eq('org_id', orgId);

    if (deleteError) {
      context.log?.error?.('org-logo failed to delete logo_url', { message: deleteError.message });
      return respond(context, 500, { message: 'failed_to_delete_logo' });
    }

    // Audit log
    await logAuditEvent(supabase, {
      orgId,
      userId,
      userEmail: authResult.data.user.email,
      userRole: role,
      actionType: AUDIT_ACTIONS.LOGO_UPDATED,
      actionCategory: AUDIT_CATEGORIES.SETTINGS,
      resourceType: 'org_logo',
      resourceId: orgId,
      details: { action: 'delete' },
    });

    context.log?.info?.('org-logo deleted successfully', { orgId, userId });
    return respond(context, 200, { logo_url: null });
  }

  return respond(context, 405, { message: 'method_not_allowed' });
}
