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
import { analyzeLocalExport, applyLocalImport } from '../_shared/local-export-import.js';

function getExportPayload(body) {
  return body?.export || body?.local_export || body?.payload || null;
}

function countTotal(counts) {
  return Object.values(counts || {}).reduce((sum, value) => sum + (Number(value) || 0), 0);
}

export default async function handler(context, req) {
  const env = readEnv(context);
  let supabase;
  try {
    supabase = createSingleClient(env);
  } catch (configError) {
    context.log?.error?.('local-import missing Supabase admin credentials', { message: configError?.message });
    return respond(context, 500, { message: 'server_misconfigured' });
  }
  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    return respond(context, 401, { message: 'missing bearer token' });
  }

  const authResult = await supabase.auth.getUser(authorization.token).catch((authError) => {
    context.log?.error?.('local-import failed to validate token', { message: authError?.message });
    return { error: authError, data: null };
  });
  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  const user = authResult.data.user;
  const body = parseRequestBody(req);
  const orgId = resolveOrgId(req, body);
  if (!orgId) {
    return respond(context, 400, { message: 'invalid org id' });
  }

  let role;
  try {
    role = await ensureMembership(supabase, orgId, user.id);
  } catch (membershipError) {
    context.log?.error?.('local-import failed to verify membership', {
      message: membershipError?.message,
      orgId,
      userId: user.id,
    });
    return respond(context, 500, { message: 'failed_to_verify_membership' });
  }

  if (!role || !isAdminRole(role)) {
    return respond(context, 403, { message: 'forbidden' });
  }

  const localExport = getExportPayload(body);
  const mode = body?.mode === 'apply' ? 'apply' : 'analyze';
  const analysis = analyzeLocalExport(localExport);

  if (!analysis.valid) {
    await logAuditEvent(supabase, {
      orgId,
      userId: user.id,
      userEmail: user.email,
      userRole: role,
      actionType: AUDIT_ACTIONS.LOCAL_IMPORT_FAILED,
      actionCategory: AUDIT_CATEGORIES.LOCAL_DATA_PORTABILITY,
      resourceType: 'local_import',
      resourceId: orgId,
      details: { status: 'failed', mode, message: analysis.message },
    });
    return respond(context, 400, { message: analysis.message });
  }

  if (mode === 'analyze') {
    await logAuditEvent(supabase, {
      orgId,
      userId: user.id,
      userEmail: user.email,
      userRole: role,
      actionType: AUDIT_ACTIONS.LOCAL_IMPORT_ANALYZED,
      actionCategory: AUDIT_CATEGORIES.LOCAL_DATA_PORTABILITY,
      resourceType: 'local_import',
      resourceId: orgId,
      details: {
        status: 'analyzed',
        source_org_id: analysis.source_org_id,
        importable_counts: analysis.importable_counts,
        export_only_counts: analysis.export_only_counts,
      },
    });

    return respond(context, 200, {
      mode: 'analyze',
      target_org_id: orgId,
      analysis,
    });
  }

  if (body?.confirm !== true) {
    return respond(context, 400, { message: 'explicit_confirmation_required' });
  }

  try {
    const result = await applyLocalImport(supabase, localExport, orgId, user.id);
    await logAuditEvent(supabase, {
      orgId,
      userId: user.id,
      userEmail: user.email,
      userRole: role,
      actionType: result.success ? AUDIT_ACTIONS.LOCAL_IMPORT_APPLIED : AUDIT_ACTIONS.LOCAL_IMPORT_FAILED,
      actionCategory: AUDIT_CATEGORIES.LOCAL_DATA_PORTABILITY,
      resourceType: 'local_import',
      resourceId: orgId,
      details: {
        status: result.success ? 'applied' : 'partial_or_failed',
        source_org_id: analysis.source_org_id,
        inserted_counts: result.inserted,
        failed_tables: Object.keys(result.errors || {}),
        total_inserted: countTotal(result.inserted),
      },
    });

    const status = result.success ? 200 : 207;
    return respond(context, status, {
      mode: 'apply',
      target_org_id: orgId,
      result,
    });
  } catch (error) {
    context.log?.error?.('local-import apply failed', { message: error?.message, orgId });
    await logAuditEvent(supabase, {
      orgId,
      userId: user.id,
      userEmail: user.email,
      userRole: role,
      actionType: AUDIT_ACTIONS.LOCAL_IMPORT_FAILED,
      actionCategory: AUDIT_CATEGORIES.LOCAL_DATA_PORTABILITY,
      resourceType: 'local_import',
      resourceId: orgId,
      details: { status: 'failed', mode: 'apply', message: error?.message || 'unknown_error' },
    });
    return respond(context, 500, { message: 'local_import_failed' });
  }
}
