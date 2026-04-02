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
import { fetchCommitmentsWithBalances, fetchLessonPendingBillingQueue, isYmdDate } from '../_shared/employee-finance.js';

const MAX_BODY_BYTES = 48 * 1024;
const COMMITMENT_TYPES = new Set(['package', 'subscription', 'hmo', 'manual_credit']);

function normalizeCommitmentType(value) {
  const normalized = normalizeString(value).toLowerCase();
  return COMMITMENT_TYPES.has(normalized) ? normalized : '';
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
  let authResult;
  try {
    authResult = await supabase.auth.getUser(authorization.token);
  } catch (authError) {
    context.log?.error?.('commitments failed to validate token', { message: authError?.message });
    return respond(context, 401, { message: 'invalid or expired token' });
  }
  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  const userId = authResult.data.user.id;
  const body = method === 'GET'
    ? {}
    : parseJsonBodyWithLimit(req, MAX_BODY_BYTES, { mode: 'observe', context, endpoint: 'commitments' });
  const orgId = resolveOrgId(req, body);
  if (!orgId) {
    return respond(context, 400, { message: 'invalid org id' });
  }

  let role = null;
  try {
    role = await ensureMembership(supabase, orgId, userId);
  } catch (membershipError) {
    context.log?.error?.('commitments failed to verify membership', { message: membershipError?.message });
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
    const serviceId = normalizeString(req?.query?.service_id);
    const startDate = normalizeString(req?.query?.start_date);
    const endDate = normalizeString(req?.query?.end_date);
    const [commitments, billingQueue] = await Promise.all([
      fetchCommitmentsWithBalances(tenantClient, { studentId, serviceId }),
      fetchLessonPendingBillingQueue(tenantClient, {
        studentId,
        startDate: isYmdDate(startDate) ? startDate : '',
        endDate: isYmdDate(endDate) ? endDate : '',
      }),
    ]);

    return respond(context, 200, { commitments, billing_queue: billingQueue });
  }

  if (!isAdminRole(role)) {
    return respond(context, 403, { message: 'forbidden' });
  }

  if (method === 'POST' || method === 'PUT') {
    const studentId = normalizeString(body?.student_id);
    const serviceId = normalizeString(body?.service_id);
    const commitmentType = normalizeCommitmentType(body?.commitment_type) || 'package';
    const totalAmount = Number(body?.total_amount);
    const defaultChargeAmount = body?.default_charge_amount === null || body?.default_charge_amount === ''
      ? null
      : Number(body?.default_charge_amount);

    if (!studentId) {
      return respond(context, 400, { message: 'missing_student_id' });
    }
    if (!serviceId) {
      return respond(context, 400, { message: 'missing_service_id' });
    }
    if (!Number.isFinite(totalAmount) || totalAmount < 0) {
      return respond(context, 400, { message: 'invalid_total_amount' });
    }
    if (defaultChargeAmount !== null && (!Number.isFinite(defaultChargeAmount) || defaultChargeAmount < 0)) {
      return respond(context, 400, { message: 'invalid_default_charge_amount' });
    }

    const payload = {
      student_id: studentId,
      service_id: serviceId,
      commitment_type: commitmentType,
      total_amount: totalAmount,
      default_charge_amount: defaultChargeAmount,
      transfer_ref: normalizeString(body?.transfer_ref) || null,
      notes: normalizeString(body?.notes) || null,
      is_active: body?.is_active !== undefined ? Boolean(body.is_active) : true,
      updated_at: new Date().toISOString(),
      expires_at: normalizeString(body?.expires_at) || null,
      metadata: body?.metadata && typeof body.metadata === 'object' ? body.metadata : {},
    };

    if (method === 'POST') {
      payload.created_at = new Date().toISOString();
      const { data, error } = await tenantClient
        .from('commitments')
        .insert(payload)
        .select('*')
        .single();

      if (error) {
        context.log?.error?.('commitments failed to create record', { message: error.message });
        return respond(context, 500, { message: 'failed_to_create_commitment' });
      }

      if (data && totalAmount > 0) {
        const creditPayload = {
          student_id: data.student_id,
          commitment_id: data.id,
          transaction_type: 'CREDIT',
          usage_type: data.commitment_type === 'hmo' ? 'hmo_authorization_added' : 'commitment_creation',
          amount: totalAmount,
          source_ref: null,
          notes: null,
          created_at: data.created_at,
          updated_at: data.created_at,
          metadata: { commitment_type: data.commitment_type },
        };
        const { error: creditError } = await tenantClient
          .from('ledger_transactions')
          .insert(creditPayload);

        if (creditError) {
          context.log?.error?.('commitments failed to create initial CREDIT ledger entry', { message: creditError.message });
          const { error: rollbackError } = await tenantClient
            .from('commitments')
            .delete()
            .eq('id', data.id);

          if (rollbackError) {
            context.log?.error?.('commitments failed to rollback commitment after initial CREDIT ledger failure', {
              message: rollbackError.message,
              commitmentId: data.id,
            });
          }

          return respond(context, 500, { message: 'failed_to_create_ledger_entry' });
        }
      }

      return respond(context, 201, data);
    }

    const id = normalizeString(body?.id);
    if (!id) {
      return respond(context, 400, { message: 'missing_commitment_id' });
    }

    const { data: existingCommitment, error: existingCommitmentError } = await tenantClient
      .from('commitments')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (existingCommitmentError) {
      context.log?.error?.('commitments failed to load record before update', { message: existingCommitmentError.message });
      return respond(context, 500, { message: 'failed_to_load_commitment' });
    }
    if (!existingCommitment) {
      return respond(context, 404, { message: 'commitment_not_found' });
    }

    const { data, error } = await tenantClient
      .from('commitments')
      .update(payload)
      .eq('id', id)
      .select('*')
      .maybeSingle();

    if (error) {
      context.log?.error?.('commitments failed to update record', { message: error.message });
      return respond(context, 500, { message: 'failed_to_update_commitment' });
    }
    if (!data) {
      return respond(context, 404, { message: 'commitment_not_found' });
    }

    if (existingCommitment && Number.isFinite(totalAmount)) {
      const oldTotal = Number(existingCommitment.total_amount || 0);
      const delta = totalAmount - oldTotal;
      if (delta !== 0) {
        const deltaPayload = {
          student_id: data.student_id,
          commitment_id: data.id,
          transaction_type: delta > 0 ? 'CREDIT' : 'DEBIT',
          usage_type: delta > 0 ? 'manual_topup' : 'manual_adjustment',
          amount: Math.abs(delta),
          source_ref: null,
          notes: 'Commitment total_amount updated',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          metadata: { commitment_update: true, old_total: oldTotal, new_total: totalAmount },
        };
        const { error: deltaError } = await tenantClient
          .from('ledger_transactions')
          .insert(deltaPayload);

        if (deltaError) {
          context.log?.error?.('commitments failed to record total_amount delta in ledger', { message: deltaError.message });
          const rollbackPayload = {
            student_id: existingCommitment.student_id,
            service_id: existingCommitment.service_id,
            commitment_type: existingCommitment.commitment_type,
            total_amount: existingCommitment.total_amount,
            default_charge_amount: existingCommitment.default_charge_amount,
            transfer_ref: existingCommitment.transfer_ref,
            notes: existingCommitment.notes,
            is_active: existingCommitment.is_active,
            updated_at: existingCommitment.updated_at,
            expires_at: existingCommitment.expires_at,
            metadata: existingCommitment.metadata ?? null,
          };

          const { error: rollbackError } = await tenantClient
            .from('commitments')
            .update(rollbackPayload)
            .eq('id', id);

          if (rollbackError) {
            context.log?.error?.('commitments failed to rollback commitment after ledger delta failure', {
              message: rollbackError.message,
              commitmentId: id,
            });
          }

          return respond(context, 500, { message: 'failed_to_record_ledger_delta' });
        }
      }
    }

    return respond(context, 200, data);
  }

  if (method === 'DELETE') {
    const id = normalizeString(body?.id);
    if (!id) {
      return respond(context, 400, { message: 'missing_commitment_id' });
    }

    const { data: commitment, error: commitmentError } = await tenantClient
      .from('commitments')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (commitmentError) {
      context.log?.error?.('commitments failed to load record before delete', { message: commitmentError.message });
      return respond(context, 500, { message: 'failed_to_load_commitment' });
    }
    if (!commitment) {
      return respond(context, 404, { message: 'commitment_not_found' });
    }
    if (commitment.commitment_type === 'hmo') {
      return respond(context, 409, { message: 'hmo_commitments_managed_via_authorizations' });
    }

    const { data: usageRows, error: usageError } = await tenantClient
      .from('ledger_transactions')
      .select('id')
      .eq('commitment_id', id)
      .eq('transaction_type', 'DEBIT')
      .limit(1);

    if (usageError && usageError.code !== '42P01') {
      context.log?.error?.('commitments failed to verify usage rows', { message: usageError.message });
      return respond(context, 500, { message: 'failed_to_verify_commitment_usage' });
    }

    if ((usageRows || []).length > 0) {
      return respond(context, 409, { message: 'commitment_has_ledger_transactions' });
    }

    const { data, error } = await tenantClient
      .from('commitments')
      .delete()
      .eq('id', id)
      .select('id')
      .maybeSingle();

    if (error) {
      context.log?.error?.('commitments failed to delete record', { message: error.message });
      return respond(context, 500, { message: 'failed_to_delete_commitment' });
    }
    if (!data) {
      return respond(context, 404, { message: 'commitment_not_found' });
    }

    return respond(context, 200, { id, deleted: true });
  }

  return respond(context, 405, { message: 'method not allowed' });
}
