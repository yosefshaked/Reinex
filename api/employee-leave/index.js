/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
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

const MAX_BODY_BYTES = 32 * 1024;

function computeRecordedBalances(entries) {
  const ordered = [...entries].sort((left, right) => {
    const leftTime = new Date(left.effective_date || left.created_at).getTime();
    const rightTime = new Date(right.effective_date || right.created_at).getTime();
    return rightTime - leftTime;
  });

  const balances = new Map();
  ordered.forEach((entry) => {
    if (!entry.leave_type || balances.has(entry.leave_type)) return;
    balances.set(entry.leave_type, {
      leave_type: entry.leave_type,
      recorded_balance: entry.balance,
      effective_date: entry.effective_date,
      source: 'LeaveBalances',
    });
  });

  return Array.from(balances.values());
}

export default async function (context, req) {
  const method = String(req.method || 'GET').toUpperCase();
  if (method !== 'GET') {
    return respond(context, 405, { message: 'method not allowed' });
  }

  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);

  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('employee-leave missing Supabase admin credentials');
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    context.log?.warn?.('employee-leave missing bearer token');
    return respond(context, 401, { message: 'missing bearer' });
  }

  const supabase = createSupabaseAdminClient(adminConfig);

  let authResult;
  try {
    authResult = await supabase.auth.getUser(authorization.token);
  } catch (error) {
    context.log?.error?.('employee-leave failed to validate token', { message: error?.message });
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  const userId = authResult.data.user.id;
  const body = parseJsonBodyWithLimit(req, MAX_BODY_BYTES, { mode: 'observe', context, endpoint: 'employee-leave' });
  const orgId = resolveOrgId(req, body);

  if (!orgId) {
    return respond(context, 400, { message: 'invalid org id' });
  }

  let role;
  try {
    role = await ensureMembership(supabase, orgId, userId);
  } catch (membershipError) {
    context.log?.error?.('employee-leave failed to verify membership', {
      message: membershipError?.message,
      orgId,
      userId,
    });
    return respond(context, 500, { message: 'failed_to_verify_membership' });
  }

  if (!role) {
    return respond(context, 403, { message: 'forbidden' });
  }

  const isAdmin = isAdminRole(role);
  const { client: tenantClient, error: tenantError } = await resolveTenantClient(context, supabase, env, orgId);
  if (tenantError) {
    return respond(context, tenantError.status, tenantError.body);
  }

  const employeeIdParam = normalizeString(req?.query?.employee_id || body?.employee_id);
  let employeeQuery = tenantClient
    .from('Employees')
    .select('id, user_id, annual_leave_days, leave_pay_method, leave_fixed_day_rate')
    .limit(1);

  if (employeeIdParam) {
    employeeQuery = employeeQuery.eq('id', employeeIdParam);
  } else if (!isAdmin) {
    employeeQuery = employeeQuery.eq('user_id', userId);
  } else {
    return respond(context, 400, { message: 'missing employee_id' });
  }

  const { data: employees, error: employeeError } = await employeeQuery;
  if (employeeError) {
    context.log?.error?.('employee-leave failed to load employee', { message: employeeError.message });
    return respond(context, 500, { message: 'failed_to_load_employee' });
  }

  const employee = Array.isArray(employees) ? employees[0] : null;
  if (!employee) {
    return respond(context, 404, { message: 'employee_not_found' });
  }

  if (!isAdmin && employee.user_id !== userId) {
    return respond(context, 403, { message: 'forbidden' });
  }

  let entries = [];
  let ledgerStatus = 'unavailable';

  const { data: leaveEntries, error: leaveError } = await tenantClient
    .from('LeaveBalances')
    .select('id, created_at, leave_type, balance, effective_date, notes, work_session_id, metadata')
    .eq('employee_id', employee.id)
    .order('effective_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(120);

  if (leaveError) {
    if (leaveError.code !== '42P01' && leaveError.code !== '42703') {
      context.log?.error?.('employee-leave failed to load leave ledger', { message: leaveError.message, code: leaveError.code });
      return respond(context, 500, { message: 'failed_to_load_leave_ledger' });
    }
  } else if (Array.isArray(leaveEntries) && leaveEntries.length > 0) {
    entries = leaveEntries;
    ledgerStatus = 'legacy';
  }

  return respond(context, 200, {
    employee_id: employee.id,
    policy_source: 'Employees',
    policy: {
      annual_leave_days: employee.annual_leave_days ?? null,
      leave_pay_method: employee.leave_pay_method || null,
      leave_fixed_day_rate: employee.leave_fixed_day_rate ?? null,
    },
    ledger_status: ledgerStatus,
    entry_count: entries.length,
    recorded_balances: entries.length > 0 ? computeRecordedBalances(entries) : [],
    entries,
  });
}
