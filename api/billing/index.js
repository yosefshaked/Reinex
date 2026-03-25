/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import {
  ensureMembership,
  isAdminOrOffice,
  isAdminRole,
  normalizeString,
  readEnv,
  respond,
  resolveOrgId,
  resolveTenantClient,
} from '../_shared/org-bff.js';
import { parseJsonBodyWithLimit } from '../_shared/validation.js';
import {
  assignLessonParticipantCommitment,
  clearLessonParticipantCommitment,
  createCommitmentTransfer,
  fetchBillingSnapshot,
  reconcileStudentBilling,
} from '../_shared/student-billing.js';

const MAX_BODY_BYTES = 96 * 1024;

function currentMonthRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const toKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return {
    startDate: toKey(start),
    endDate: toKey(end),
  };
}

function mapBillingActionError(errorCode) {
  switch (errorCode) {
    case 'lesson_participant_not_found':
    case 'commitment_not_found':
    case 'source_commitment_not_found':
      return { status: 404, body: { message: errorCode } };
    case 'missing_student_id':
    case 'missing_target_student_id':
    case 'missing_target_service_id':
    case 'invalid_transfer_amount':
    case 'invalid_target_default_charge_amount':
      return { status: 400, body: { message: errorCode } };
    case 'commitment_belongs_to_different_student':
    case 'commitment_service_mismatch':
    case 'commitment_inactive':
    case 'commitment_expired':
    case 'transfer_amount_exceeds_remaining_balance':
      return { status: 409, body: { message: errorCode } };
    default:
      return { status: 400, body: { message: errorCode || 'invalid_billing_action' } };
  }
}

export default async function (context, req) {
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
    : parseJsonBodyWithLimit(req, MAX_BODY_BYTES, { mode: 'observe', context, endpoint: 'billing' });
  const orgId = resolveOrgId(req, body);
  if (!orgId) {
    return respond(context, 400, { message: 'invalid org id' });
  }

  let role = null;
  try {
    role = await ensureMembership(supabase, orgId, userId);
  } catch (membershipError) {
    context.log?.error?.('billing failed to verify membership', { message: membershipError?.message });
    return respond(context, 500, { message: 'failed_to_verify_membership' });
  }
  if (!role) {
    return respond(context, 403, { message: 'forbidden' });
  }

  if (!isAdminOrOffice(role)) {
    return respond(context, 403, { message: 'forbidden' });
  }

  const { client: tenantClient, error: tenantError } = await resolveTenantClient(context, supabase, env, orgId);
  if (tenantError) {
    return respond(context, tenantError.status, tenantError.body);
  }

  if (method === 'GET') {
    const studentId = normalizeString(req?.query?.student_id);
    let startDate = normalizeString(req?.query?.start_date);
    let endDate = normalizeString(req?.query?.end_date);

    if (!studentId && !startDate && !endDate) {
      const currentRange = currentMonthRange();
      startDate = currentRange.startDate;
      endDate = currentRange.endDate;
    }

    const snapshot = await fetchBillingSnapshot(tenantClient, {
      studentId,
      startDate,
      endDate,
    });

    return respond(context, 200, snapshot);
  }

  if (!isAdminRole(role)) {
    return respond(context, 403, { message: 'forbidden' });
  }

  const action = normalizeString(body?.action).toLowerCase();

  if (method === 'POST' && action === 'assign_lesson_commitment') {
    const result = await assignLessonParticipantCommitment(tenantClient, {
      lessonParticipantId: normalizeString(body?.lesson_participant_id),
      commitmentId: normalizeString(body?.commitment_id),
      actorUserId: userId,
    });

    if (result?.error) {
      const mapped = mapBillingActionError(result.error);
      return respond(context, mapped.status, mapped.body);
    }

    return respond(context, 200, result);
  }

  if (method === 'POST' && action === 'clear_lesson_commitment') {
    const result = await clearLessonParticipantCommitment(tenantClient, {
      lessonParticipantId: normalizeString(body?.lesson_participant_id),
      actorUserId: userId,
    });

    if (result?.error) {
      const mapped = mapBillingActionError(result.error);
      return respond(context, mapped.status, mapped.body);
    }

    return respond(context, 200, result);
  }

  if (method === 'POST' && action === 'transfer_commitment_balance') {
    const result = await createCommitmentTransfer(tenantClient, {
      sourceCommitmentId: normalizeString(body?.source_commitment_id),
      amount: body?.amount,
      targetStudentId: normalizeString(body?.target_student_id),
      targetServiceId: normalizeString(body?.target_service_id),
      targetCommitmentType: normalizeString(body?.target_commitment_type),
      targetDefaultChargeAmount: body?.target_default_charge_amount,
      expiresAt: normalizeString(body?.expires_at),
      notes: normalizeString(body?.notes),
      actorUserId: userId,
    });

    if (result?.error) {
      const mapped = mapBillingActionError(result.error);
      return respond(context, mapped.status, mapped.body);
    }

    return respond(context, 201, result);
  }

  if (method === 'POST' && action === 'reconcile_student_billing') {
    const result = await reconcileStudentBilling(tenantClient, {
      studentId: normalizeString(body?.student_id),
      startDate: normalizeString(body?.start_date),
      endDate: normalizeString(body?.end_date),
      actorUserId: userId,
    });

    if (result?.error) {
      const mapped = mapBillingActionError(result.error);
      return respond(context, mapped.status, mapped.body);
    }

    return respond(context, 200, result);
  }

  return respond(context, 405, { message: 'method not allowed' });
}
