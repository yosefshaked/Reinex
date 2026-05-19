// @ts-check
/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import {
  ensureMembership,
  normalizeString,
  readEnv,
  respond,
  resolveOrgId,
  withOrgScope,
} from '../_shared/org-bff.js';
import { parseJsonBodyWithLimit } from '../_shared/validation.js';
import {
  FINANCE_CORRECTION_TYPES,
  canManageEmployeeOps,
  isYmdDate,
  listFinanceCorrections,
} from '../_shared/employee-finance.js';
import { assertAgorot, FINANCE_LIMITS } from '../_shared/currency.js';

const MAX_BODY_BYTES = 48 * 1024;

function normalizeCorrectionType(value) {
  const normalized = normalizeString(value).toLowerCase();
  return FINANCE_CORRECTION_TYPES.has(normalized) ? normalized : '';
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
    return respond(context, 401, { message: 'missing_bearer' });
  }

  const supabase = createSupabaseAdminClient(adminConfig);
  let authResult;
  try {
    authResult = await supabase.auth.getUser(authorization.token);
  } catch (authError) {
    context.log?.error?.('payroll-adjustments failed to validate token', { message: authError?.message });
    return respond(context, 401, { message: 'invalid_or_expired_token' });
  }
  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid_or_expired_token' });
  }

  const userId = authResult.data.user.id;
  const body = method === 'GET'
    ? {}
    : parseJsonBodyWithLimit(req, MAX_BODY_BYTES, { mode: 'observe', context, endpoint: 'payroll-adjustments' });
  const orgId = resolveOrgId(req, body);

  if (!orgId) {
    return respond(context, 400, { message: 'invalid_org_id' });
  }

  let role = null;
  try {
    role = await ensureMembership(supabase, orgId, userId);
  } catch (membershipError) {
    context.log?.error?.('payroll-adjustments failed to verify membership', { message: membershipError?.message });
    return respond(context, 500, { message: 'failed_to_verify_membership' });
  }
  if (!role) {
    return respond(context, 403, { message: 'forbidden' });
  }

  if (!canManageEmployeeOps(role)) {
    return respond(context, 403, { message: 'forbidden' });
  }

  if (method === 'GET') {
    const employeeId = normalizeString(req?.query?.employee_id);
    const startDate = normalizeString(req?.query?.start_date);
    const endDate = normalizeString(req?.query?.end_date);
    const entries = await listFinanceCorrections(supabase, {
      employeeId,
      startDate: isYmdDate(startDate) ? startDate : '',
      endDate: isYmdDate(endDate) ? endDate : '',
    });
    return respond(context, 200, { entries });
  }

  if (method === 'POST' || method === 'PUT') {
    const employeeId = normalizeString(body?.employee_id);
    const correctionType = normalizeCorrectionType(body?.correction_type);
    const effectiveDate = normalizeString(body?.effective_date);
    let amount;
    try {
      amount = assertAgorot(Math.abs(Number(body?.amount)), 'amount');
    } catch (err) {
      return respond(context, 400, { message: err.message });
    }
    if (amount > FINANCE_LIMITS.MAX_ADJUSTMENT_AGOROT) {
      return respond(context, 400, { message: 'adjustment_exceeds_maximum' });
    }
    // Restore sign — payroll adjustments can be negative
    if (Number(body?.amount) < 0) amount = -amount;

    if (!employeeId) {
      return respond(context, 400, { message: 'missing_employee_id' });
    }
    if (!correctionType) {
      return respond(context, 400, { message: 'invalid_correction_type' });
    }
    if (!isYmdDate(effectiveDate)) {
      return respond(context, 400, { message: 'invalid_effective_date' });
    }

    const idempotencyKey = normalizeString(body?.idempotency_key) || null;
    const metadataBase = body?.metadata && typeof body.metadata === 'object' ? body.metadata : {};

    const payload = {
      employee_id: employeeId,
      correction_type: correctionType,
      amount,
      effective_date: effectiveDate,
      notes: normalizeString(body?.notes) || null,
      updated_by: userId,
      updated_at: new Date().toISOString(),
      metadata: idempotencyKey ? { ...metadataBase, idempotency_key: idempotencyKey } : metadataBase,
    };

    if (method === 'POST') {
      // Idempotency: return existing record if the same key was already processed
      if (idempotencyKey) {
        const { data: existing } = await withOrgScope(supabase, 'finance_corrections', orgId)
          .select('id, employee_id, correction_type, amount, effective_date, notes, created_by, updated_by, created_at, updated_at, metadata')
          .filter('metadata->>idempotency_key', 'eq', idempotencyKey)
          .eq('employee_id', employeeId)
          .maybeSingle();
        if (existing) {
          return respond(context, 200, existing);
        }
      }

      payload.created_by = userId;
      payload.created_at = new Date().toISOString();
      const { data, error } = await withOrgScope(supabase, 'finance_corrections', orgId)
        .insert(payload)
        .select('id, employee_id, correction_type, amount, effective_date, notes, created_by, updated_by, created_at, updated_at, metadata')
        .single();

      if (error) {
        context.log?.error?.('payroll-adjustments failed to create correction', { message: error.message });
        return respond(context, 500, { message: 'failed_to_create_adjustment' });
      }

      return respond(context, 201, data);
    }

    const id = normalizeString(body?.id);
    if (!id) {
      return respond(context, 400, { message: 'missing_adjustment_id' });
    }

    const { data, error } = await withOrgScope(supabase, 'finance_corrections', orgId)
      .update(payload)
      .eq('id', id)
      .select('id, employee_id, correction_type, amount, effective_date, notes, created_by, updated_by, created_at, updated_at, metadata')
      .maybeSingle();

    if (error) {
      context.log?.error?.('payroll-adjustments failed to update correction', { message: error.message });
      return respond(context, 500, { message: 'failed_to_update_adjustment' });
    }
    if (!data) {
      return respond(context, 404, { message: 'adjustment_not_found' });
    }

    return respond(context, 200, data);
  }

  if (method === 'DELETE') {
    const id = normalizeString(body?.id);
    if (!id) {
      return respond(context, 400, { message: 'missing_adjustment_id' });
    }

    const { data, error } = await withOrgScope(supabase, 'finance_corrections', orgId)
      .delete()
      .eq('id', id)
      .select('id')
      .maybeSingle();

    if (error) {
      context.log?.error?.('payroll-adjustments failed to delete correction', { message: error.message });
      return respond(context, 500, { message: 'failed_to_delete_adjustment' });
    }
    if (!data) {
      return respond(context, 404, { message: 'adjustment_not_found' });
    }

    return respond(context, 200, { id, deleted: true });
  }

  return respond(context, 405, { message: 'method_not_allowed' });
}
