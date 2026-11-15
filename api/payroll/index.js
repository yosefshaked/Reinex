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
import {
  canManageEmployeeOps,
  endOfMonthKey,
  isYmdDate,
  loadFinancePolicies,
  resolveEmployeeRecord,
  startOfMonthKey,
  toDateKey,
} from '../_shared/employee-finance.js';
import { coerceAgorot } from '../_shared/currency.js';
import { computeEmployeePay } from '../_shared/pay-calculation.js';
import { loadRateHistoryRows } from '../_shared/rate-history.js';

function roundCurrency(value) {
  return coerceAgorot(value);
}

export default async function (context, req) {
  const method = String(req.method || 'GET').toUpperCase();
  if (method !== 'GET') {
    return respond(context, 405, { message: 'method_not_allowed' });
  }

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
    context.log?.error?.('payroll failed to validate token', { message: authError?.message });
    return respond(context, 401, { message: 'invalid_or_expired_token' });
  }
  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid_or_expired_token' });
  }

  const userId = authResult.data.user.id;
  const orgId = resolveOrgId(req, {});
  if (!orgId) {
    return respond(context, 400, { message: 'invalid_org_id' });
  }

  let role = null;
  try {
    role = await ensureMembership(supabase, orgId, userId);
  } catch (membershipError) {
    context.log?.error?.('payroll failed to verify membership', { message: membershipError?.message });
    return respond(context, 500, { message: 'failed_to_verify_membership' });
  }
  if (!role) {
    return respond(context, 403, { message: 'forbidden' });
  }

  const canManageAll = canManageEmployeeOps(role);
  const employeeId = normalizeString(req?.query?.employee_id);
  const startDate = normalizeString(req?.query?.start_date);
  const endDate = normalizeString(req?.query?.end_date);
  const defaultDate = toDateKey(new Date());
  const resolvedStart = isYmdDate(startDate) ? startDate : startOfMonthKey(defaultDate);
  const resolvedEnd = isYmdDate(endDate) ? endDate : endOfMonthKey(resolvedStart);
  const policies = await loadFinancePolicies(supabase, orgId);

  let employees = [];
  if (canManageAll) {
    let query = withOrgScope(supabase, 'Employees', orgId)
      .select('id, user_id, first_name, last_name, employee_id, employee_type, start_date, annual_leave_days, leave_pay_method, working_days')
      .eq('is_active', true)
      .order('first_name', { ascending: true });

    if (employeeId) {
      query = query.eq('id', employeeId);
    }

    const { data, error } = await query;
    if (error) {
      context.log?.error?.('payroll failed to load employees', { message: error.message });
      return respond(context, 500, { message: 'failed_to_load_employees' });
    }
    employees = data || [];
  } else {
    const employeeResult = await resolveEmployeeRecord(supabase, {
      employeeId,
      userId,
      canManageAll,
    });

    if (employeeResult.error) {
      if (employeeResult.error === 'employee_not_found') return respond(context, 404, { message: 'employee_not_found' });
      return respond(context, 403, { message: 'forbidden' });
    }
    employees = [employeeResult.employee];
  }

  const rateRows = await loadRateHistoryRows(supabase, orgId, {
    employeeIds: employees.map((row) => row.id),
  });
  const includeDetails = ['1', 'true'].includes(normalizeString(req?.query?.details).toLowerCase());
  const now = new Date();
  const previews = [];
  try {
    for (const employee of employees) {
      const pay = await computeEmployeePay(supabase, orgId, {
        employee,
        startDate: resolvedStart,
        endDate: resolvedEnd,
        policies,
        rateRows,
        now,
        includeDetails,
      });
      previews.push(pay);
    }
  } catch (payError) {
    context.log?.error?.('payroll failed to compute pay', { message: payError?.message });
    return respond(context, 500, { message: 'failed_to_compute_pay' });
  }

  const totals = previews.reduce((acc, row) => ({
    base_amount: roundCurrency(acc.base_amount + row.base_amount),
    paid_leave_amount: roundCurrency(acc.paid_leave_amount + row.paid_leave_amount),
    correction_amount: roundCurrency(acc.correction_amount + row.correction_amount),
    total_amount: roundCurrency(acc.total_amount + row.total_amount),
  }), {
    base_amount: 0,
    paid_leave_amount: 0,
    correction_amount: 0,
    total_amount: 0,
  });

  return respond(context, 200, {
    period_start: resolvedStart,
    leave_pay_policy: policies.leavePayPolicy,
    period_end: resolvedEnd,
    employees: previews,
    totals,
  });
}
