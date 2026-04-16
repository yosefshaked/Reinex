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
  countWorkingDaysInRange,
  endOfMonthKey,
  fetchApprovedLeaveDays,
  fetchAttendanceRecords,
  isYmdDate,
  listFinanceCorrections,
  loadFinancePolicies,
  loadInstructorProfilesMap,
  resolveEmployeeRecord,
  resolveEmployeeWorkingDays,
  resolveLeaveDayValue,
  startOfMonthKey,
  toDateKey,
} from '../_shared/employee-finance.js';
import { coerceAgorot } from '../_shared/currency.js';

function shiftMonths(dateKey, deltaMonths) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + deltaMonths);
  return date.toISOString().slice(0, 10);
}

function roundCurrency(value) {
  return coerceAgorot(value);
}

function getPayrollModel(employee) {
  const explicit = normalizeString(employee?.payroll_model).toLowerCase();
  if (explicit) {
    return explicit;
  }
  return normalizeString(employee?.employee_type).toLowerCase() === 'instructor' ? 'lesson_based' : 'hourly';
}

async function fetchLessonEarningHistory(client, orgId, employeeId) {
  const { data: earnings, error } = await withOrgScope(client, 'lesson_earnings', orgId)
    .select('id, employee_id, lesson_instance_id, rate_used, payout_amount, created_at, metadata')
    .eq('employee_id', employeeId);

  if (error) {
    if (error.code === '42P01') {
      return [];
    }
    throw error;
  }

  const lessonInstanceIds = Array.from(new Set((earnings || []).map((row) => row.lesson_instance_id).filter(Boolean)));
  if (lessonInstanceIds.length === 0) {
    return [];
  }

  const { data: instances, error: instanceError } = await withOrgScope(client, 'lesson_instances', orgId)
    .select('id, datetime_start, duration_minutes')
    .in('id', lessonInstanceIds);

  if (instanceError) {
    throw instanceError;
  }

  const instanceMap = new Map((instances || []).map((row) => [row.id, row]));
  return (earnings || []).map((row) => {
    const instance = instanceMap.get(row.lesson_instance_id) || null;
    return {
      ...row,
      lesson_date: instance?.datetime_start ? toDateKey(instance.datetime_start) : toDateKey(row?.metadata?.lesson_date || row.created_at),
      duration_minutes: instance?.duration_minutes || 0,
    };
  });
}

function buildDisplayName(employee) {
  return [employee?.first_name, employee?.last_name].filter(Boolean).join(' ').trim() || employee?.employee_id || employee?.id;
}

function filterByDateRange(rows, startDate, endDate, field) {
  return (rows || []).filter((row) => {
    const dateKey = toDateKey(row?.[field]);
    return Boolean(dateKey) && dateKey >= startDate && dateKey <= endDate;
  });
}

function collectWorkingDates(startDate, endDate, workingDays) {
  const dates = [];
  let cursor = startDate;
  const workingDaySet = new Set(Array.isArray(workingDays) ? workingDays : []);
  while (cursor <= endDate) {
    const dayOfWeek = new Date(`${cursor}T00:00:00Z`).getUTCDay();
    if (workingDaySet.has(dayOfWeek)) {
      dates.push(cursor);
    }
    const next = new Date(`${cursor}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    cursor = next.toISOString().slice(0, 10);
  }
  return dates;
}

async function buildEmployeePayrollPreview(client, orgId, employee, profile, startDate, endDate, policies) {
  const historyStart = shiftMonths(startDate, -12);
  const payrollModel = getPayrollModel(employee);
  const [attendanceHistory, leaveDays, corrections, lessonEarnings] = await Promise.all([
    fetchAttendanceRecords(client, { employeeId: employee.id, startDate: historyStart, endDate }),
    fetchApprovedLeaveDays(client, { employeeId: employee.id, startDate, endDate }),
    listFinanceCorrections(client, { employeeId: employee.id, startDate, endDate }),
    fetchLessonEarningHistory(client, orgId, employee.id),
  ]);

  const attendanceInPeriod = filterByDateRange(attendanceHistory, startDate, endDate, 'attendance_date');
  const lessonEarningsInPeriod = filterByDateRange(lessonEarnings, startDate, endDate, 'lesson_date');

  const leaveAmounts = [];
  for (const leaveDay of leaveDays) {
    const leaveValue = resolveLeaveDayValue({
      employee,
      profile,
      targetDate: leaveDay.leave_date,
      lessonEarnings,
      attendanceRecords: attendanceHistory,
      leavePayPolicy: policies.leavePayPolicy,
    });
    leaveAmounts.push({
      ...leaveDay,
      amount: roundCurrency(leaveValue * Number(leaveDay.pay_fraction || 0)),
    });
  }

  const paidLeaveTotal = roundCurrency(leaveAmounts.reduce((sum, row) => sum + row.amount, 0));
  const correctionTotal = roundCurrency((corrections || []).reduce((sum, row) => sum + coerceAgorot(row.amount), 0));

  let baseAmount = 0;
  let attendanceAmount = 0;
  let lessonAmount = 0;
  let monthlySalaryAmount = 0;

  if (payrollModel === 'lesson_based') {
    lessonAmount = roundCurrency((lessonEarningsInPeriod || []).reduce((sum, row) => sum + coerceAgorot(row.payout_amount), 0));
    baseAmount = lessonAmount;
  } else if (payrollModel === 'hourly') {
    attendanceAmount = roundCurrency((attendanceInPeriod || []).reduce((sum, row) => {
      const rate = coerceAgorot(employee?.current_rate);
      if (!Number.isFinite(rate) || rate <= 0) {
        return sum;
      }
      const workedMinutes = Number(row?.worked_minutes || 0);
      return sum + ((workedMinutes / 60) * rate);
    }, 0));
    baseAmount = attendanceAmount;
  } else if (payrollModel === 'monthly_salary') {
    const workingDates = collectWorkingDates(startDate, endDate, resolveEmployeeWorkingDays(employee, profile));
    const leaveMap = new Map((leaveAmounts || []).map((row) => [row.leave_date, row]));
    monthlySalaryAmount = roundCurrency(workingDates.reduce((sum, dateKey) => {
      const monthStart = startOfMonthKey(dateKey);
      const monthEnd = endOfMonthKey(dateKey);
      const monthWorkingDays = Math.max(1, countWorkingDaysInRange(resolveEmployeeWorkingDays(employee, profile), monthStart, monthEnd));
      const dailyRate = coerceAgorot(employee?.monthly_salary_amount) / monthWorkingDays;
      const leaveDay = leaveMap.get(dateKey);
      if (leaveDay) {
        return sum + (dailyRate * Number(leaveDay.pay_fraction || 0));
      }
      return sum + dailyRate;
    }, 0));
    baseAmount = monthlySalaryAmount;
  }

  const totalAmount = roundCurrency(baseAmount + (payrollModel === 'monthly_salary' ? 0 : paidLeaveTotal) + correctionTotal);
  const leaveBreakdown = {
    employee_paid_days: leaveDays.filter((row) => row.leave_type === 'employee_paid').length,
    system_paid_days: leaveDays.filter((row) => row.leave_type === 'system_paid').length,
    unpaid_days: leaveDays.filter((row) => row.leave_type === 'unpaid').length,
    half_days: leaveDays.filter((row) => row.leave_type === 'half_day').length,
    paid_leave_total: payrollModel === 'monthly_salary'
      ? roundCurrency(leaveAmounts.reduce((sum, row) => sum + row.amount, 0))
      : paidLeaveTotal,
  };

  return {
    employee_id: employee.id,
    employee_name: buildDisplayName(employee),
    employee_type: employee.employee_type || null,
    payroll_model: payrollModel,
    period_start: startDate,
    period_end: endDate,
    base_amount: roundCurrency(baseAmount),
    attendance_amount: roundCurrency(attendanceAmount),
    lesson_amount: roundCurrency(lessonAmount),
    monthly_salary_amount: roundCurrency(monthlySalaryAmount),
    paid_leave_amount: payrollModel === 'monthly_salary' ? 0 : paidLeaveTotal,
    correction_amount: correctionTotal,
    total_amount: totalAmount,
    leave_breakdown: leaveBreakdown,
    corrections,
  };
}

export default async function (context, req) {
  const method = String(req.method || 'GET').toUpperCase();
  if (method !== 'GET') {
    return respond(context, 405, { message: 'method not allowed' });
  }

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
    context.log?.error?.('payroll failed to validate token', { message: authError?.message });
    return respond(context, 401, { message: 'invalid or expired token' });
  }
  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  const userId = authResult.data.user.id;
  const orgId = resolveOrgId(req, {});
  if (!orgId) {
    return respond(context, 400, { message: 'invalid org id' });
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
  const policies = await loadFinancePolicies(supabase);

  let employees = [];
  if (canManageAll) {
    let query = withOrgScope(supabase, 'Employees', orgId)
      .select('id, user_id, first_name, last_name, employee_id, employee_type, payroll_model, current_rate, monthly_salary_amount, start_date, annual_leave_days, leave_pay_method, leave_fixed_day_rate, working_days')
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

  const profilesMap = await loadInstructorProfilesMap(supabase, employees.map((row) => row.id));
  const previews = [];
  for (const employee of employees) {
    const preview = await buildEmployeePayrollPreview(
      supabase,
      orgId,
      employee,
      profilesMap.get(employee.id) || null,
      resolvedStart,
      resolvedEnd,
      policies,
    );
    previews.push(preview);
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
    period_end: resolvedEnd,
    employees: previews,
    totals,
  });
}
