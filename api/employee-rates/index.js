/* eslint-env node */
/**
 * Employee pay rates (RateHistory): the dated rates pay is calculated from.
 *
 * GET  ?org_id&employee_id            -> { rates, today }
 * POST { org_id, employee_id, pay_basis, service_id?, rate, effective_date, notes?, replace_existing?, apply_pay_fields? }
 *
 * A rate is never edited in place: saving adds a row "from this date on". Saving on a date that already
 * has a rate of that kind is refused unless `replace_existing` is true. While the legacy rate fields
 * still exist, a rate that is in effect today is mirrored back to them so the older screens agree.
 */
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
import { canManageEmployeeOps } from '../_shared/employee-finance.js';
import { attachErrorTracking, respondTracked } from '../_shared/error-events.js';
import {
  PAY_BASIS,
  buildRateChangeWarnings,
  loadRateHistoryRows,
  resolveEmployeePayFields,
  toRateDateKey,
  validateRateInput,
} from '../_shared/rate-history.js';

const MAX_BODY_BYTES = 16 * 1024;

const LEGACY_EMPLOYEE_COLUMN_BY_BASIS = Object.freeze({
  [PAY_BASIS.ATTENDANCE_HOURLY]: 'current_rate',
  [PAY_BASIS.MONTHLY_SALARY]: 'monthly_salary_amount',
  [PAY_BASIS.LEAVE_DAY]: 'leave_fixed_day_rate',
});

function respondRatesError(context, status, message, error, metadata = {}) {
  return respondTracked(context, status, { message }, undefined, { error, metadata });
}

function todayDateKey() {
  return toRateDateKey(new Date().toISOString());
}

/**
 * Keep the legacy rate fields showing the rate that is in effect today, so the employee card and the
 * capability list agree with RateHistory until those screens are retired. Never fails the request.
 */
async function mirrorRateToLegacyColumn(client, orgId, { employeeId, payBasis, serviceId, rate, effectiveDate }, context) {
  if (effectiveDate > todayDateKey()) return;

  try {
    if (payBasis === PAY_BASIS.LESSON_HOURLY) {
      await withOrgScope(client, 'instructor_service_capabilities', orgId)
        .update({ base_rate: rate })
        .eq('employee_id', employeeId)
        .eq('service_id', serviceId);
      return;
    }
    if (payBasis === PAY_BASIS.LESSON_FLAT) {
      // base_rate can only express an hourly number, so a per-session rate clears it rather than
      // leaving a stale figure behind for the screens that still read it.
      await withOrgScope(client, 'instructor_service_capabilities', orgId)
        .update({ base_rate: null })
        .eq('employee_id', employeeId)
        .eq('service_id', serviceId);
      return;
    }
    const column = LEGACY_EMPLOYEE_COLUMN_BY_BASIS[payBasis];
    if (column) {
      await withOrgScope(client, 'Employees', orgId)
        .update({ [column]: rate })
        .eq('id', employeeId);
    }
  } catch (mirrorError) {
    context.log?.warn?.('employee-rates failed to mirror the rate to the legacy column', {
      message: mirrorError?.message,
      employeeId,
      payBasis,
    });
  }
}

export default async function employeeRates(context, req) {
  const method = String(req.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'POST') {
    return respond(context, 405, { message: 'method_not_allowed' });
  }

  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);
  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('employee-rates missing Supabase admin credentials');
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
    context.log?.error?.('employee-rates failed to validate token', { message: authError?.message });
    return respond(context, 401, { message: 'invalid_or_expired_token' });
  }
  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid_or_expired_token' });
  }

  const userId = authResult.data.user.id;
  const body = method === 'GET'
    ? {}
    : parseJsonBodyWithLimit(req, MAX_BODY_BYTES, { mode: 'observe', context, endpoint: 'employee-rates' });
  const orgId = resolveOrgId(req, body);
  if (!orgId) {
    return respond(context, 400, { message: 'invalid_org_id' });
  }

  attachErrorTracking(context, req, supabase, { orgId, userId, metadata: { endpoint: 'employee-rates' } });

  let role = null;
  try {
    role = await ensureMembership(supabase, orgId, userId);
  } catch (membershipError) {
    context.log?.error?.('employee-rates failed to verify membership', { message: membershipError?.message });
    return respondRatesError(context, 500, 'failed_to_verify_membership', membershipError, { action: 'verify_membership' });
  }
  if (!role || !canManageEmployeeOps(role)) {
    return respond(context, 403, { message: 'forbidden' });
  }

  const employeeId = normalizeString(method === 'GET' ? req?.query?.employee_id : body?.employee_id);
  if (!employeeId) {
    return respond(context, 400, { message: 'missing_employee_id' });
  }

  if (method === 'GET') {
    try {
      const rates = await loadRateHistoryRows(supabase, orgId, { employeeIds: [employeeId] });
      return respond(context, 200, { rates, today: todayDateKey() });
    } catch (loadError) {
      context.log?.error?.('employee-rates failed to load rates', { message: loadError?.message, employeeId });
      return respondRatesError(context, 500, 'failed_to_load_rates', loadError, { action: 'load_rates', employee_id: employeeId });
    }
  }

  const { value: input, error: inputError } = validateRateInput({
    employeeId,
    payBasis: body?.pay_basis,
    serviceId: body?.service_id,
    rate: body?.rate,
    effectiveDate: body?.effective_date,
  });
  if (inputError) {
    return respond(context, 400, { message: inputError });
  }

  try {
    const { data: employee, error: employeeError } = await withOrgScope(supabase, 'Employees', orgId)
      .select('id, payroll_model, leave_pay_method')
      .eq('id', input.employeeId)
      .maybeSingle();
    if (employeeError) throw employeeError;
    if (!employee) {
      return respond(context, 404, { message: 'employee_not_found' });
    }

    if (input.serviceId) {
      const { data: service, error: serviceError } = await withOrgScope(supabase, 'Services', orgId)
        .select('id')
        .eq('id', input.serviceId)
        .maybeSingle();
      if (serviceError) throw serviceError;
      if (!service) {
        return respond(context, 404, { message: 'service_not_found' });
      }
    }

    const existingRows = await loadRateHistoryRows(supabase, orgId, { employeeIds: [input.employeeId] });
    const { warnings, existingOnDate } = buildRateChangeWarnings(existingRows, input, todayDateKey());

    if (existingOnDate && body?.replace_existing !== true) {
      return respond(context, 409, {
        message: 'rate_exists_on_date',
        existing_rate: existingOnDate,
        warnings,
      });
    }

    const notes = normalizeString(body?.notes) || null;
    const payload = {
      employee_id: input.employeeId,
      service_id: input.serviceId,
      pay_basis: input.payBasis,
      rate: input.rate,
      effective_date: input.effectiveDate,
      notes,
      created_by: userId,
      metadata: { source: 'employee-rates' },
    };

    let saved = null;
    if (existingOnDate) {
      const { data, error } = await withOrgScope(supabase, 'RateHistory', orgId)
        .update({ rate: payload.rate, notes, created_by: userId, metadata: { source: 'employee-rates', replaced_at: new Date().toISOString() } })
        .eq('id', existingOnDate.id)
        .select('id, employee_id, service_id, pay_basis, rate, effective_date, created_at, notes, metadata')
        .single();
      if (error) throw error;
      saved = data;
    } else {
      const { data, error } = await withOrgScope(supabase, 'RateHistory', orgId)
        .insert(payload)
        .select('id, employee_id, service_id, pay_basis, rate, effective_date, created_at, notes, metadata')
        .single();
      if (error) throw error;
      saved = data;
    }

    await mirrorRateToLegacyColumn(supabase, orgId, input, context);

    // A rate of a kind the employee's pay model doesn't cover pays nothing, so the office can apply
    // the matching setting with the rate instead of hunting for it in the employee card.
    const payFields = resolveEmployeePayFields(input.payBasis, employee);
    let appliedPayFields = null;
    if (payFields && body?.apply_pay_fields === true) {
      const { error: payFieldsError } = await withOrgScope(supabase, 'Employees', orgId)
        .update(payFields)
        .eq('id', input.employeeId);
      if (payFieldsError) throw payFieldsError;
      appliedPayFields = payFields;
    }

    return respond(context, 200, {
      rate: saved,
      warnings,
      today: todayDateKey(),
      pay_fields_required: payFields,
      pay_fields_applied: appliedPayFields,
    });
  } catch (saveError) {
    context.log?.error?.('employee-rates failed to save the rate', { message: saveError?.message, employeeId });
    return respondRatesError(context, 500, 'failed_to_save_rate', saveError, {
      action: 'save_rate',
      employee_id: employeeId,
      pay_basis: input.payBasis,
    });
  }
}
