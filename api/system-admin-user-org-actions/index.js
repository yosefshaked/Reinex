/* eslint-env node */
import { randomUUID } from 'node:crypto';
import { resolveBearerAuthorization } from '../_shared/http.js';
import { logAuditEvent } from '../_shared/audit-log.js';
import {
  createSupabaseAdminClient,
  parseRequestBody,
  readSupabaseAdminConfig,
} from '../_shared/supabase-admin.js';
import { ensureSystemAdmin, normalizeString, readEnv, respond } from '../_shared/org-bff.js';

const ALLOWED_ACTIONS = new Set(['org_suspend', 'org_reactivate', 'impersonation_request']);

function normalizeAction(value) {
  return normalizeString(value).toLowerCase();
}

function buildRequestPayload(actionType, orgId, admin, reason, targetUserEmail) {
  return {
    request_id: randomUUID(),
    action_type: actionType,
    org_id: orgId,
    requested_by: {
      user_id: admin.userId,
      email: admin.email,
    },
    reason,
    target_user_email: targetUserEmail,
    status: 'pending_review',
    created_at: new Date().toISOString(),
  };
}

function buildRegistryRecord(requestPayload) {
  return {
    permission_key: `system.request.${requestPayload.request_id}`,
    display_name_en: `System Request ${requestPayload.action_type}`,
    display_name_he: `System Request ${requestPayload.action_type}`,
    description_en: `Requested ${requestPayload.action_type} for org ${requestPayload.org_id}`,
    description_he: `Requested ${requestPayload.action_type} for org ${requestPayload.org_id}`,
    description: `System admin request: ${requestPayload.action_type}`,
    default_value: requestPayload,
    category: 'system_admin_requests',
    requires_approval: true,
  };
}

export default async function systemAdminUserOrgActions(context, req) {
  const method = String(req.method || 'GET').toUpperCase();
  if (method !== 'POST') {
    return respond(context, 405, { message: 'method_not_allowed' });
  }

  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);

  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('system-admin-user-org-actions: missing Supabase admin credentials');
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

  const actionType = normalizeAction(body?.action_type);
  const orgId = normalizeString(body?.org_id);
  const reason = normalizeString(body?.reason);
  const targetUserEmail = normalizeString(body?.target_user_email).toLowerCase();

  if (!ALLOWED_ACTIONS.has(actionType)) {
    return respond(context, 400, {
      message: 'invalid_action_type',
      allowed: Array.from(ALLOWED_ACTIONS),
    });
  }

  if (!orgId) {
    return respond(context, 400, { message: 'org_id_required' });
  }

  if (actionType === 'impersonation_request' && !targetUserEmail) {
    return respond(context, 400, { message: 'target_user_email_required' });
  }

  const requestPayload = buildRequestPayload(actionType, orgId, admin, reason, targetUserEmail);
  const record = buildRegistryRecord(requestPayload);

  try {
    const registryResult = await supabase
      .from('permission_registry')
      .upsert(record, { onConflict: 'permission_key' })
      .select('permission_key, updated_at')
      .single();

    if (registryResult.error) {
      throw registryResult.error;
    }

    await logAuditEvent(supabase, {
      orgId,
      userId: admin.userId,
      userEmail: admin.email,
      userRole: 'system_admin',
      actionType: `system_admin.${actionType}`,
      actionCategory: 'admin_control',
      resourceType: actionType === 'impersonation_request' ? 'impersonation' : 'organization',
      resourceId: orgId,
      details: {
        request_id: requestPayload.request_id,
        reason,
        target_user_email: targetUserEmail || null,
      },
      metadata: {
        source: 'system-admin-user-org-actions',
      },
    });

    return respond(context, 200, {
      status: 'queued',
      request: requestPayload,
      registry_record: registryResult.data,
      requested_at: new Date().toISOString(),
    });
  } catch (error) {
    context.log?.error?.('system-admin-user-org-actions: failed', {
      message: error?.message,
      code: error?.code,
      userId: admin.userId,
      actionType,
      orgId,
    });
    return respond(context, 500, { message: 'failed_to_queue_system_admin_action' });
  }
}
