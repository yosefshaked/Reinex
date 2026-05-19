/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import {
  createSingleClient,
  ensureMembership,
  isAdminRole,
  parseRequestBody,
  readEnv,
  respond,
  resolveOrgId,
} from '../_shared/org-bff.js';
import { logAuditEvent, AUDIT_ACTIONS, AUDIT_CATEGORIES } from '../_shared/audit-log.js';
import { collectLocalExport } from '../_shared/local-export-import.js';

function countTables(manifest) {
  const counts = {};
  for (const [tableName, rows] of Object.entries(manifest?.tables || {})) {
    counts[tableName] = Array.isArray(rows) ? rows.length : 0;
  }
  return counts;
}

export default async function handler(context, req) {
  const env = readEnv(context);
  let supabase;
  try {
    supabase = createSingleClient(env);
  } catch (configError) {
    context.log?.error?.('local-export missing Supabase admin credentials', { message: configError?.message });
    return respond(context, 500, { message: 'server_misconfigured' });
  }
  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    return respond(context, 401, { message: 'missing_bearer' });
  }

  const authResult = await supabase.auth.getUser(authorization.token).catch((authError) => {
    context.log?.error?.('local-export failed to validate token', { message: authError?.message });
    return { error: authError, data: null };
  });
  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid_or_expired_token' });
  }

  const user = authResult.data.user;
  const body = parseRequestBody(req);
  const orgId = resolveOrgId(req, body);
  if (!orgId) {
    return respond(context, 400, { message: 'invalid_org_id' });
  }

  let role;
  try {
    role = await ensureMembership(supabase, orgId, user.id);
  } catch (membershipError) {
    context.log?.error?.('local-export failed to verify membership', {
      message: membershipError?.message,
      orgId,
      userId: user.id,
    });
    return respond(context, 500, { message: 'failed_to_verify_membership' });
  }

  if (!role || !isAdminRole(role)) {
    return respond(context, 403, { message: 'forbidden' });
  }

  await logAuditEvent(supabase, {
    orgId,
    userId: user.id,
    userEmail: user.email,
    userRole: role,
    actionType: AUDIT_ACTIONS.LOCAL_EXPORT_STARTED,
    actionCategory: AUDIT_CATEGORIES.LOCAL_DATA_PORTABILITY,
    resourceType: 'local_export',
    resourceId: orgId,
    details: { status: 'started' },
  });

  try {
    const { manifest, tableErrors } = await collectLocalExport(supabase, orgId);
    const tableCounts = countTables(manifest);

    await logAuditEvent(supabase, {
      orgId,
      userId: user.id,
      userEmail: user.email,
      userRole: role,
      actionType: AUDIT_ACTIONS.LOCAL_EXPORT_COMPLETED,
      actionCategory: AUDIT_CATEGORIES.LOCAL_DATA_PORTABILITY,
      resourceType: 'local_export',
      resourceId: orgId,
      details: {
        status: 'completed',
        table_counts: tableCounts,
        failed_tables: Object.keys(tableErrors),
      },
    });

    return respond(context, 200, {
      export: manifest,
      table_counts: tableCounts,
      table_errors: tableErrors,
    });
  } catch (error) {
    context.log?.error?.('local-export failed', { message: error?.message, orgId });
    await logAuditEvent(supabase, {
      orgId,
      userId: user.id,
      userEmail: user.email,
      userRole: role,
      actionType: AUDIT_ACTIONS.LOCAL_EXPORT_FAILED,
      actionCategory: AUDIT_CATEGORIES.LOCAL_DATA_PORTABILITY,
      resourceType: 'local_export',
      resourceId: orgId,
      details: { status: 'failed', message: error?.message || 'unknown_error' },
    });
    return respond(context, 500, { message: 'local_export_failed' });
  }
}
