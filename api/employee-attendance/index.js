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
  ATTENDANCE_STATUSES,
  assertNoLeaveForAttendance,
  canManageEmployeeOps,
  fetchApprovedLeaveDays,
  fetchAttendanceRecords,
  endOfMonthKey,
  isYmdDate,
  resolveEmployeeRecord,
  startOfMonthKey,
  toDateKey,
} from '../_shared/employee-finance.js';

const MAX_BODY_BYTES = 64 * 1024;

function normalizeWorkedMinutes(value) {
  if (value === undefined) {
    return { provided: false, valid: true, value: null };
  }
  if (value === null || value === '') {
    return { provided: true, valid: true, value: null };
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return { provided: true, valid: false, value: null };
  }
  return { provided: true, valid: true, value: Math.round(parsed) };
}

function normalizeAttendanceStatus(value) {
  const normalized = normalizeString(value).toLowerCase();
  return ATTENDANCE_STATUSES.has(normalized) ? normalized : '';
}

export default async function (context, req) {
  const method = String(req.method || 'GET').toUpperCase();
  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);

  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('employee-attendance missing Supabase admin credentials');
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
  } catch (error) {
    context.log?.error?.('employee-attendance failed to validate token', { message: error?.message });
    return respond(context, 401, { message: 'invalid_or_expired_token' });
  }

  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid_or_expired_token' });
  }

  const userId = authResult.data.user.id;
  const body = method === 'GET'
    ? {}
    : parseJsonBodyWithLimit(req, MAX_BODY_BYTES, { mode: 'observe', context, endpoint: 'employee-attendance' });
  const orgId = resolveOrgId(req, body);

  if (!orgId) {
    return respond(context, 400, { message: 'invalid_org_id' });
  }

  let role;
  try {
    role = await ensureMembership(supabase, orgId, userId);
  } catch (membershipError) {
    context.log?.error?.('employee-attendance failed to verify membership', {
      message: membershipError?.message,
      orgId,
      userId,
    });
    return respond(context, 500, { message: 'failed_to_verify_membership' });
  }

  if (!role) {
    return respond(context, 403, { message: 'forbidden' });
  }



  const canManageAll = canManageEmployeeOps(role);

  if (method === 'GET') {
    const employeeId = normalizeString(req?.query?.employee_id);
    const startDate = normalizeString(req?.query?.start_date);
    const endDate = normalizeString(req?.query?.end_date);
    const defaultMonthDate = toDateKey(new Date());
    const resolvedStart = isYmdDate(startDate) ? startDate : startOfMonthKey(defaultMonthDate);
    const resolvedEnd = isYmdDate(endDate) ? endDate : endOfMonthKey(resolvedStart);

    const employeeResult = await resolveEmployeeRecord(supabase, {
      employeeId,
      userId,
      canManageAll,
    });

    if (employeeResult.error) {
      if (employeeResult.error === 'missing_employee_id') return respond(context, 400, { message: 'missing_employee_id' });
      if (employeeResult.error === 'employee_not_found') return respond(context, 404, { message: 'employee_not_found' });
      if (employeeResult.error === 'forbidden') return respond(context, 403, { message: 'forbidden' });
      context.log?.error?.('employee-attendance failed to resolve employee', { employeeId, message: employeeResult.error.message });
      return respond(context, 500, { message: 'failed_to_load_employee' });
    }

    const employee = employeeResult.employee;
    const [records, leaveDays] = await Promise.all([
      fetchAttendanceRecords(supabase, { employeeId: employee.id, startDate: resolvedStart, endDate: resolvedEnd }),
      fetchApprovedLeaveDays(supabase, { employeeId: employee.id, startDate: resolvedStart, endDate: resolvedEnd }),
    ]);

    return respond(context, 200, {
      employee_id: employee.id,
      start_date: resolvedStart,
      end_date: resolvedEnd,
      records,
      leave_days: leaveDays,
    });
  }

  if (!canManageAll) {
    return respond(context, 403, { message: 'forbidden' });
  }

  if (method === 'POST' || method === 'PUT') {
    const employeeId = normalizeString(body?.employee_id);
    const attendanceDate = normalizeString(body?.attendance_date);
    const status = normalizeAttendanceStatus(body?.status);
    const notes = normalizeString(body?.notes) || null;
    const workedMinutesResult = normalizeWorkedMinutes(body?.worked_minutes);

    if (!employeeId) {
      return respond(context, 400, { message: 'missing_employee_id' });
    }
    if (!isYmdDate(attendanceDate)) {
      return respond(context, 400, { message: 'invalid_attendance_date' });
    }
    if (!status) {
      return respond(context, 400, { message: 'invalid_status' });
    }
    if (!workedMinutesResult.valid) {
      return respond(context, 400, { message: 'invalid_worked_minutes' });
    }

    const conflict = await assertNoLeaveForAttendance(supabase, {
      employeeId,
      date: attendanceDate,
      excludeEntryId: '',
    });

    if (conflict) {
      return respond(context, 409, conflict);
    }

    const payload = {
      employee_id: employeeId,
      attendance_date: attendanceDate,
      status,
      worked_minutes: workedMinutesResult.value,
      notes,
      source_type: normalizeString(body?.source_type).toLowerCase() || 'manual',
      updated_by: userId,
      updated_at: new Date().toISOString(),
    };

    if (method === 'POST') {
      payload.created_by = userId;
      payload.created_at = new Date().toISOString();
      const { data, error } = await withOrgScope(supabase, 'employee_attendance_records', orgId)
        .insert(payload)
        .select('id, employee_id, attendance_date, status, worked_minutes, notes, source_type, created_by, updated_by, created_at, updated_at, metadata')
        .single();

      if (error) {
        if (error.code === '23505') {
          return respond(context, 409, { message: 'attendance_record_exists' });
        }
        context.log?.error?.('employee-attendance failed to create record', { message: error.message });
        return respond(context, 500, { message: 'failed_to_create_attendance_record' });
      }

      return respond(context, 201, data);
    }

    const recordId = normalizeString(body?.id);
    let query = withOrgScope(supabase, 'employee_attendance_records', orgId)
      .update(payload)
      .eq('employee_id', employeeId)
      .eq('attendance_date', attendanceDate);

    if (recordId) {
      query = query.eq('id', recordId);
    }

    const { data, error } = await query
      .select('id, employee_id, attendance_date, status, worked_minutes, notes, source_type, created_by, updated_by, created_at, updated_at, metadata')
      .maybeSingle();

    if (error) {
      context.log?.error?.('employee-attendance failed to update record', { message: error.message });
      return respond(context, 500, { message: 'failed_to_update_attendance_record' });
    }
    if (!data) {
      return respond(context, 404, { message: 'attendance_record_not_found' });
    }

    return respond(context, 200, data);
  }

  if (method === 'DELETE') {
    const recordId = normalizeString(body?.id);
    const employeeId = normalizeString(body?.employee_id);
    const attendanceDate = normalizeString(body?.attendance_date);

    if (!recordId && !(employeeId && isYmdDate(attendanceDate))) {
      return respond(context, 400, { message: 'missing_delete_target' });
    }

    let query = withOrgScope(supabase, 'employee_attendance_records', orgId).delete();
    if (recordId) {
      query = query.eq('id', recordId);
    } else {
      query = query.eq('employee_id', employeeId).eq('attendance_date', attendanceDate);
    }

    const { data, error } = await query.select('id').maybeSingle();
    if (error) {
      context.log?.error?.('employee-attendance failed to delete record', { message: error.message });
      return respond(context, 500, { message: 'failed_to_delete_attendance_record' });
    }
    if (!data) {
      return respond(context, 404, { message: 'attendance_record_not_found' });
    }

    return respond(context, 200, { id: data.id, deleted: true });
  }

  return respond(context, 405, { message: 'method_not_allowed' });
}
