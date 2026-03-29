/* eslint-env node */
import { Buffer } from 'node:buffer';
import { createHash, timingSafeEqual } from 'node:crypto';
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import { logAuditEvent, AUDIT_CATEGORIES } from '../_shared/audit-log.js';
import {
  ensureMembership,
  isAdminRole,
  normalizeString,
  readEnv,
  respond,
  resolveOrgId,
  resolveTenantClient,
} from '../_shared/org-bff.js';
import { parseJsonBodyWithLimit } from '../_shared/validation.js';
import { logTenantAuditEvent, TENANT_AUDIT_RETENTION } from '../_shared/tenant-audit.js';

const MAX_BODY_BYTES = 48 * 1024;

function readAdminToolPassword(env) {
  return normalizeString(env?.ADMIN_TOOL_PASSWORD);
}

function isFeatureEnabled(env) {
  return Boolean(readAdminToolPassword(env));
}

function safePasswordEquals(candidate, expected) {
  if (!expected) {
    return false;
  }

  const left = createHash('sha256').update(String(candidate || ''), 'utf8').digest();
  const right = createHash('sha256').update(String(expected), 'utf8').digest();
  return timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

async function lockLessonForPayroll({ tenantClient, lessonInstanceId, userId }) {
  const now = new Date();
  const periodStart = now.toISOString().slice(0, 10);

  const { data: payrollRun, error: payrollRunError } = await tenantClient
    .from('payroll_runs')
    .insert({
      period_start: periodStart,
      period_end: periodStart,
      status: 'finalized',
      finalized_at: now.toISOString(),
      finalized_by: userId,
      metadata: {
        debug_uat_tool: true,
      },
    })
    .select('id, status, finalized_at')
    .single();

  if (payrollRunError) {
    throw payrollRunError;
  }

  const { data: lock, error: lockError } = await tenantClient
    .from('instance_locks')
    .insert({
      lesson_instance_id: lessonInstanceId,
      lock_source_type: 'payroll_run',
      lock_source_id: payrollRun.id,
      lock_reason: 'debug_uat_payroll_lock',
      created_by: userId,
      metadata: {
        debug_uat_tool: true,
      },
    })
    .select('id, lesson_instance_id, lock_source_type, lock_source_id, lock_reason, created_at')
    .single();

  if (lockError) {
    throw lockError;
  }

  return {
    lock,
    source: payrollRun,
  };
}

async function lockLessonForPaidClaim({ tenantClient, lessonInstanceId, userId }) {
  const now = new Date();
  const periodStart = now.toISOString().slice(0, 10);

  const { data: claimBatch, error: claimBatchError } = await tenantClient
    .from('claim_batches')
    .insert({
      batch_type: 'manual',
      period_start: periodStart,
      period_end: periodStart,
      status: 'paid',
      submitted_at: now.toISOString(),
      submitted_by: userId,
      paid_at: now.toISOString(),
      paid_by: userId,
      metadata: {
        debug_uat_tool: true,
      },
    })
    .select('id, status, paid_at')
    .single();

  if (claimBatchError) {
    throw claimBatchError;
  }

  const { data: lock, error: lockError } = await tenantClient
    .from('instance_locks')
    .insert({
      lesson_instance_id: lessonInstanceId,
      lock_source_type: 'claim_batch',
      lock_source_id: claimBatch.id,
      lock_reason: 'debug_uat_paid_claim_lock',
      created_by: userId,
      metadata: {
        debug_uat_tool: true,
        claim_status: 'paid',
      },
    })
    .select('id, lesson_instance_id, lock_source_type, lock_source_id, lock_reason, created_at')
    .single();

  if (lockError) {
    throw lockError;
  }

  return {
    lock,
    source: claimBatch,
  };
}

export default async function debugUatTools(context, req) {
  const method = String(req.method || 'GET').toUpperCase();
  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);

  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    return respond(context, 401, { message: 'missing bearer' });
  }

  const supabase = createSupabaseAdminClient(adminConfig);
  const authResult = await supabase.auth.getUser(authorization.token);
  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  const userId = authResult.data.user.id;
  const body = method === 'GET'
    ? {}
    : parseJsonBodyWithLimit(req, MAX_BODY_BYTES, { mode: 'observe', context, endpoint: 'debug-uat-tools' });
  const orgId = resolveOrgId(req, body);

  if (!orgId) {
    return respond(context, 400, { message: 'invalid org id' });
  }

  let role = null;
  try {
    role = await ensureMembership(supabase, orgId, userId);
  } catch (membershipError) {
    context.log?.error?.('debug-uat-tools failed to verify membership', { message: membershipError?.message });
    return respond(context, 500, { message: 'failed_to_verify_membership' });
  }

  if (!role || !isAdminRole(role)) {
    return respond(context, 403, { message: 'forbidden' });
  }

  if (method === 'GET') {
    return respond(context, 200, {
      enabled: isFeatureEnabled(env),
    });
  }

  if (method !== 'POST') {
    return respond(context, 405, { message: 'method not allowed' });
  }

  const action = normalizeString(body?.action).toLowerCase();
  const adminToolPassword = readAdminToolPassword(env);

  if (!adminToolPassword) {
    return respond(context, 404, { message: 'feature_disabled' });
  }

  const providedPassword = normalizeString(body?.password);

  if (!safePasswordEquals(providedPassword, adminToolPassword)) {
    return respond(context, 401, { message: 'invalid_password' });
  }

  if (action === 'authenticate') {
    return respond(context, 200, { authenticated: true });
  }

  if (action !== 'lock_lesson') {
    return respond(context, 400, { message: 'invalid_action' });
  }

  const lessonInstanceId = normalizeString(body?.lesson_instance_id || body?.lessonInstanceId || body?.instance_id || body?.instanceId);
  const lockKind = normalizeString(body?.lock_kind || body?.lockKind).toLowerCase();

  if (!lessonInstanceId) {
    return respond(context, 400, { message: 'missing_lesson_instance_id' });
  }

  if (!['payroll', 'paid_claim'].includes(lockKind)) {
    return respond(context, 400, { message: 'invalid_lock_kind' });
  }

  const { client: tenantClient, error: tenantError } = await resolveTenantClient(context, supabase, env, orgId);
  if (tenantError) {
    return respond(context, tenantError.status, tenantError.body);
  }

  const { data: instance, error: instanceError } = await tenantClient
    .from('lesson_instances')
    .select('id')
    .eq('id', lessonInstanceId)
    .maybeSingle();

  if (instanceError) {
    context.log?.error?.('debug-uat-tools failed to load lesson instance', { message: instanceError.message, lessonInstanceId });
    return respond(context, 500, { message: 'failed_to_load_lesson_instance' });
  }

  if (!instance) {
    return respond(context, 404, { message: 'lesson_instance_not_found' });
  }

  try {
    const result = lockKind === 'payroll'
      ? await lockLessonForPayroll({ tenantClient, lessonInstanceId, userId })
      : await lockLessonForPaidClaim({ tenantClient, lessonInstanceId, userId });

    await logAuditEvent(supabase, {
      orgId,
      userId,
      userEmail: authResult.data.user.email || '',
      userRole: role,
      actionType: `debug_uat.lock_${lockKind}`,
      actionCategory: AUDIT_CATEGORIES.CALENDAR,
      resourceType: 'lesson_instance',
      resourceId: lessonInstanceId,
      details: {
        lock_id: result.lock.id,
        lock_source_type: result.lock.lock_source_type,
        lock_source_id: result.lock.lock_source_id,
      },
    });

    await logTenantAuditEvent(tenantClient, {
      actorUserId: userId,
      eventType: 'calendar.instance.lock_created_debug_uat',
      retentionCategory: TENANT_AUDIT_RETENTION.DIAGNOSTIC,
      resourceType: 'lesson_instance',
      resourceId: lessonInstanceId,
      afterState: result.lock,
      details: {
        lock_kind: lockKind,
        source_id: result.source?.id || null,
      },
    });

    return respond(context, 201, {
      message: 'lock_created',
      lock_kind: lockKind,
      lesson_instance_id: lessonInstanceId,
      lock: result.lock,
      source: result.source,
    });
  } catch (error) {
    context.log?.error?.('debug-uat-tools failed to create lock', {
      message: error?.message,
      lessonInstanceId,
      lockKind,
    });
    return respond(context, 500, { message: 'failed_to_create_lock' });
  }
}