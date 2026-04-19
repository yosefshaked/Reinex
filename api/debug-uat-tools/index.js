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
  withOrgScope,
} from '../_shared/org-bff.js';
import { parseJsonBodyWithLimit } from '../_shared/validation.js';
import { logTenantAuditEvent, TENANT_AUDIT_RETENTION } from '../_shared/tenant-audit.js';
import { loadFinancePolicies } from '../_shared/employee-finance.js';
import { buildDesiredChargeDescriptors, resolveHmoSplitAmounts } from '../_shared/BillingLedgerService.js';
import { loadHmoAuthorizations, resolveLessonCoverageDecision } from '../_shared/hmo.js';

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

async function lockLessonForPayroll({ client, orgId, lessonInstanceId, userId }) {
  const now = new Date();
  const periodStart = now.toISOString().slice(0, 10);

  const { data: payrollRun, error: payrollRunError } = await withOrgScope(client, 'payroll_runs', orgId)
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

  const { data: lock, error: lockError } = await withOrgScope(client, 'instance_locks', orgId)
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

async function lockLessonForPaidClaim({ client, orgId, lessonInstanceId, userId }) {
  const now = new Date();
  const periodStart = now.toISOString().slice(0, 10);

  const { data: claimBatch, error: claimBatchError } = await withOrgScope(client, 'claim_batches', orgId)
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

  const { data: lock, error: lockError } = await withOrgScope(client, 'instance_locks', orgId)
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

async function inspectHmoChargeContext({
  client,
  orgId,
  lessonInstanceId,
  lessonParticipantId = '',
  targetParticipantStatus = '',
}) {
  const normalizedParticipantId = normalizeString(lessonParticipantId);
  const normalizedTargetParticipantStatus = normalizeString(targetParticipantStatus).toLowerCase();

  const { data: instance, error: instanceError } = await withOrgScope(client, 'lesson_instances', orgId)
    .select('id, datetime_start, service_id, status')
    .eq('id', lessonInstanceId)
    .maybeSingle();

  if (instanceError) {
    throw instanceError;
  }
  if (!instance?.id) {
    return { error: 'lesson_instance_not_found' };
  }

  const { data: participants, error: participantsError } = await withOrgScope(client, 'lesson_participants', orgId)
    .select('id, client_profile_id, student_id, participant_status, metadata')
    .eq('lesson_instance_id', lessonInstanceId)
    .order('id', { ascending: true });

  if (participantsError) {
    throw participantsError;
  }

  const participantRows = Array.isArray(participants) ? participants : [];
  const selectedParticipant = normalizedParticipantId
    ? participantRows.find((row) => row.id === normalizedParticipantId) || null
    : participantRows.find((row) => row.student_id) || participantRows[0] || null;

  if (!selectedParticipant?.id) {
    return {
      instance,
      participants: participantRows,
      selected_participant: null,
      error: 'lesson_participant_not_found',
    };
  }

  const { data: service, error: serviceError } = await withOrgScope(client, 'Services', orgId)
    .select('id, name, default_customer_charge_amount, is_active')
    .eq('id', instance.service_id)
    .maybeSingle();

  if (serviceError) {
    throw serviceError;
  }

  const studentId = normalizeString(selectedParticipant.student_id);
  const coverageDecision = studentId
    ? await resolveLessonCoverageDecision(client, {
      studentId,
      serviceId: instance.service_id,
      lessonDate: instance.datetime_start,
    })
    : null;

  const allActiveAuthorizationsForStudent = studentId
    ? await loadHmoAuthorizations(client, {
      studentId,
      activeOnly: true,
    })
    : [];

  const serviceMatchedActiveAuthorizations = (allActiveAuthorizationsForStudent || [])
    .filter((row) => row.service_id === instance.service_id);

  const effectiveParticipant = normalizedTargetParticipantStatus
    ? {
      ...selectedParticipant,
      participant_status: normalizedTargetParticipantStatus,
    }
    : selectedParticipant;

  const policies = await loadFinancePolicies(client, orgId);
  const chargeDecision = buildDesiredChargeDescriptors({
    participant: effectiveParticipant,
    service,
    coverageDecision,
    policies,
  });
  const splitAmounts = coverageDecision
    ? resolveHmoSplitAmounts({ coverageDecision })
    : null;

  const { data: ledgerRows, error: ledgerError } = await withOrgScope(client, 'ledger_transactions', orgId)
    .select('id, source_type, direction, amount, posted_at, effective_at, student_id, client_profile_id, hmo_provider_id, hmo_authorization_id, service_id, rate_source, reverses_transaction_id, metadata')
    .eq('lesson_participant_id', selectedParticipant.id)
    .order('posted_at', { ascending: true });

  if (ledgerError) {
    throw ledgerError;
  }

  return {
    instance,
    service,
    selected_participant: selectedParticipant,
    effective_participant: effectiveParticipant,
    simulated_target_participant_status: normalizedTargetParticipantStatus || null,
    authorization_resolution: {
      has_student_id: Boolean(studentId),
      all_active_count_for_student: (allActiveAuthorizationsForStudent || []).length,
      service_matched_active_count: serviceMatchedActiveAuthorizations.length,
      active_authorization_id: coverageDecision?.authorization_id || null,
      active_authorization_service_id: coverageDecision?.authorization?.service_id || null,
      active_authorization_provider_track_id: coverageDecision?.authorization?.provider_track_id || null,
      active_authorization_expires_at: coverageDecision?.authorization?.expires_at || null,
      possible_service_mismatch: Boolean(
        studentId
        && !coverageDecision?.authorization_id
        && (allActiveAuthorizationsForStudent || []).length > 0
        && serviceMatchedActiveAuthorizations.length === 0
      ),
    },
    policies: {
      billing_consumption_policy: policies?.billingConsumptionPolicy || null,
    },
    charge_decision: chargeDecision,
    split_amounts: splitAmounts,
    expected_entries: Array.isArray(chargeDecision?.entries) ? chargeDecision.entries : [],
    lesson_participant_ledger_rows: Array.isArray(ledgerRows) ? ledgerRows : [],
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
  let authResult;
  try {
    authResult = await supabase.auth.getUser(authorization.token);
  } catch (authError) {
    context.log?.error?.('debug-uat-tools failed to validate token', { message: authError?.message });
    return respond(context, 401, { message: 'invalid or expired token' });
  }
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

  if (!['lock_lesson', 'inspect_hmo_charge_context'].includes(action)) {
    return respond(context, 400, { message: 'invalid_action' });
  }

  const lessonInstanceId = normalizeString(body?.lesson_instance_id || body?.lessonInstanceId || body?.instance_id || body?.instanceId);
  const lockKind = normalizeString(body?.lock_kind || body?.lockKind).toLowerCase();
  const lessonParticipantId = normalizeString(body?.lesson_participant_id || body?.lessonParticipantId || body?.participant_id || body?.participantId);
  const targetParticipantStatus = normalizeString(body?.target_participant_status || body?.targetParticipantStatus);

  if (!lessonInstanceId) {
    return respond(context, 400, { message: 'missing_lesson_instance_id' });
  }

  if (action === 'lock_lesson' && !['payroll', 'paid_claim'].includes(lockKind)) {
    return respond(context, 400, { message: 'invalid_lock_kind' });
  }

  const { data: instance, error: instanceError } = await withOrgScope(supabase, 'lesson_instances', orgId)
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
    if (action === 'inspect_hmo_charge_context') {
      const inspection = await inspectHmoChargeContext({
        client: supabase,
        orgId,
        lessonInstanceId,
        lessonParticipantId,
        targetParticipantStatus,
      });

      await logAuditEvent(supabase, {
        orgId,
        userId,
        userEmail: authResult.data.user.email || '',
        userRole: role,
        actionType: 'debug_uat.inspect_hmo_charge_context',
        actionCategory: AUDIT_CATEGORIES.CALENDAR,
        resourceType: 'lesson_instance',
        resourceId: lessonInstanceId,
        details: {
          lesson_participant_id: lessonParticipantId || null,
          simulated_target_participant_status: targetParticipantStatus || null,
          selected_participant_id: inspection?.selected_participant?.id || null,
          active_authorization_id: inspection?.authorization_resolution?.active_authorization_id || null,
        },
      });

      return respond(context, 200, {
        message: 'hmo_charge_context_loaded',
        lesson_instance_id: lessonInstanceId,
        lesson_participant_id: lessonParticipantId || null,
        simulated_target_participant_status: targetParticipantStatus || null,
        inspection,
      });
    }

    const result = lockKind === 'payroll'
      ? await lockLessonForPayroll({ client: supabase, orgId, lessonInstanceId, userId })
      : await lockLessonForPaidClaim({ client: supabase, orgId, lessonInstanceId, userId });

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

    await logTenantAuditEvent(supabase, {
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
