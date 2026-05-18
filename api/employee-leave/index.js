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
  HALF_DAY_PARTS,
  LEAVE_DURATION_MODES,
  LEAVE_ENTRY_STATUSES,
  LEAVE_TYPES,
  assertNoOperationalConflictsForLeave,
  buildLeaveDayRows,
  canManageEmployeeOps,
  computeLeaveSummary,
  deleteLeaveArtifacts,
  fetchApprovedLeaveDays,
  isYmdDate,
  loadFinancePolicies,
  resolveEmployeeRecord,
  toDateKey,
  upsertLeaveBalanceUsage,
} from '../_shared/employee-finance.js';
import { attachErrorTracking, respondTracked } from '../_shared/error-events.js';

const MAX_BODY_BYTES = 64 * 1024;
const MUTABLE_BALANCE_EVENT_TYPES = new Set(['allocation', 'carryover', 'adjustment', 'reversal', 'correction']);

async function respondTrackedLeaveError(context, status, message, error, metadata = {}) {
  return respondTracked(context, status, { message }, undefined, {
    error,
    metadata,
    orgId: metadata.orgId || null,
    userId: metadata.userId || metadata.actorUserId || null,
  });
}

function normalizeLeaveType(value) {
  const normalized = normalizeString(value).toLowerCase();
  return LEAVE_TYPES.has(normalized) ? normalized : '';
}

function normalizeDurationMode(value, leaveType) {
  if (leaveType === 'half_day') {
    return 'half_day';
  }
  const normalized = normalizeString(value).toLowerCase();
  return LEAVE_DURATION_MODES.has(normalized) ? normalized : 'full_day';
}

function normalizeEntryStatus(value) {
  const normalized = normalizeString(value).toLowerCase();
  return LEAVE_ENTRY_STATUSES.has(normalized) ? normalized : 'approved';
}

function normalizeHalfDayPart(value) {
  const normalized = normalizeString(value).toLowerCase();
  return HALF_DAY_PARTS.has(normalized) ? normalized : '';
}

function isBalanceEventRequest(body) {
  return normalizeString(body?.entity_type).toLowerCase() === 'balance_event';
}

function normalizeBalanceEventType(value) {
  const normalized = normalizeString(value).toLowerCase();
  return MUTABLE_BALANCE_EVENT_TYPES.has(normalized) ? normalized : '';
}

function computeRecordedBalances(summary) {
  return [{
    leave_type: 'employee_paid',
    recorded_balance: summary.remaining,
    effective_date: toDateKey(new Date()),
    source: 'employee_leave_balance_events',
  }];
}

async function fetchLeaveEntry(client, orgId, leaveEntryId) {
  const { data, error } = await withOrgScope(client, 'employee_leave_entries', orgId)
    .select('id, employee_id, leave_type, status, duration_mode, half_day_part, start_date, end_date, reason, notes, source_type, approved_by, created_by, updated_by, created_at, updated_at, metadata')
    .eq('id', leaveEntryId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data || null;
}

async function fetchBalanceEvents(client, orgId, employeeId) {
  const { data, error } = await withOrgScope(client, 'employee_leave_balance_events', orgId)
    .select('id, employee_id, leave_entry_id, leave_day_id, event_type, leave_type, quantity_days, effective_date, notes, created_by, created_at, metadata')
    .eq('employee_id', employeeId)
    .order('effective_date', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) {
    if (error.code === '42P01') {
      return [];
    }
    throw error;
  }

  return data || [];
}

async function fetchBalanceEvent(client, orgId, balanceEventId) {
  const { data, error } = await withOrgScope(client, 'employee_leave_balance_events', orgId)
    .select('id, employee_id, leave_entry_id, leave_day_id, event_type, leave_type, quantity_days, effective_date, notes, created_by, created_at, metadata')
    .eq('id', balanceEventId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data || null;
}

function isManualBalanceEvent(event) {
  if (!event) {
    return false;
  }

  return !event.leave_entry_id
    && !event.leave_day_id
    && normalizeString(event.event_type).toLowerCase() !== 'usage';
}

async function fetchLeaveEntriesForEmployee(client, orgId, employeeId, { startDate = '', endDate = '' } = {}) {
  let query = withOrgScope(client, 'employee_leave_entries', orgId)
    .select('id, employee_id, leave_type, status, duration_mode, half_day_part, start_date, end_date, reason, notes, source_type, approved_by, created_by, updated_by, created_at, updated_at, metadata')
    .eq('employee_id', employeeId)
    .order('start_date', { ascending: false })
    .order('created_at', { ascending: false });

  if (startDate) {
    query = query.gte('end_date', startDate);
  }
  if (endDate) {
    query = query.lte('start_date', endDate);
  }

  const { data, error } = await query;
  if (error) {
    if (error.code === '42P01') {
      return [];
    }
    throw error;
  }
  return data || [];
}

export default async function (context, req) {
  const method = String(req.method || 'GET').toUpperCase();
  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);

  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('employee-leave missing Supabase admin credentials');
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
    context.log?.error?.('employee-leave failed to validate token', { message: error?.message });
    return respond(context, 401, { message: 'invalid_or_expired_token' });
  }

  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid_or_expired_token' });
  }

  const userId = authResult.data.user.id;
  const body = method === 'GET'
    ? {}
    : parseJsonBodyWithLimit(req, MAX_BODY_BYTES, { mode: 'observe', context, endpoint: 'employee-leave' });
  const orgId = resolveOrgId(req, body);

  if (!orgId) {
    return respond(context, 400, { message: 'invalid_org_id' });
  }

  attachErrorTracking(context, req, supabase, {
    orgId,
    userId,
    metadata: { endpoint: 'employee-leave' },
  });

  let role;
  try {
    role = await ensureMembership(supabase, orgId, userId);
  } catch (membershipError) {
    context.log?.error?.('employee-leave failed to verify membership', {
      message: membershipError?.message,
      orgId,
      userId,
    });
    return respondTrackedLeaveError(context, 500, 'failed_to_verify_membership', membershipError, {
      action: 'ensure_membership',
      orgId,
      userId,
    });
  }

  if (!role) {
    return respond(context, 403, { message: 'forbidden' });
  }

  const canManageAll = canManageEmployeeOps(role);

  try {
    if (method === 'GET') {
      return await handleGet(context, req, supabase, orgId, userId, canManageAll);
    }

    if (!canManageAll) {
      return respond(context, 403, { message: 'forbidden' });
    }

    if (method === 'POST' || method === 'PUT') {
      if (isBalanceEventRequest(body)) {
        return await handleBalanceEventUpsert(context, supabase, orgId, body, userId, method);
      }
      return await handleUpsert(context, supabase, orgId, body, userId, method);
    }

    if (method === 'DELETE') {
      if (isBalanceEventRequest(body)) {
        return await handleBalanceEventDelete(context, supabase, orgId, body, userId);
      }
      return await handleDelete(context, supabase, orgId, body, userId);
    }

    return respond(context, 405, { message: 'method_not_allowed' });
  } catch (unhandledError) {
    context.log?.error?.('employee-leave unhandled endpoint failure', {
      method,
      orgId,
      userId,
      message: unhandledError?.message,
    });
    if (!context.res) {
      return respondTrackedLeaveError(context, 500, 'internal_error', unhandledError, {
        action: 'unhandled_endpoint_failure',
        method,
        orgId,
        userId,
      });
    }
    return undefined;
  }
}

async function handleGet(context, req, client, orgId, userId, canManageAll) {
  const employeeIdParam = normalizeString(req?.query?.employee_id);
  const startDate = normalizeString(req?.query?.start_date);
  const endDate = normalizeString(req?.query?.end_date);
  const employeeResult = await resolveEmployeeRecord(client, {
    employeeId: employeeIdParam,
    userId,
    canManageAll,
  });

  if (employeeResult.error) {
    if (employeeResult.error === 'missing_employee_id') return respond(context, 400, { message: 'missing_employee_id' });
    if (employeeResult.error === 'employee_not_found') return respond(context, 404, { message: 'employee_not_found' });
    if (employeeResult.error === 'forbidden') return respond(context, 403, { message: 'forbidden' });
    context.log?.error?.('employee-leave failed to resolve employee', { employeeIdParam, message: employeeResult.error.message });
    return respondTrackedLeaveError(context, 500, 'failed_to_load_employee', employeeResult.error, {
      action: 'resolve_employee_record',
      orgId,
      userId,
      employeeIdParam,
    });
  }

  const employee = employeeResult.employee;

  let policies, balanceEvents, leaveEntries, leaveDays;
  try {
    policies = await loadFinancePolicies(client, orgId);
    [balanceEvents, leaveEntries, leaveDays] = await Promise.all([
      fetchBalanceEvents(client, orgId, employee.id),
      fetchLeaveEntriesForEmployee(client, orgId, employee.id, {
        startDate: isYmdDate(startDate) ? startDate : '',
        endDate: isYmdDate(endDate) ? endDate : '',
      }),
      fetchApprovedLeaveDays(client, {
        employeeId: employee.id,
        startDate: isYmdDate(startDate) ? startDate : `${new Date().getFullYear()}-01-01`,
        endDate: isYmdDate(endDate) ? endDate : `${new Date().getFullYear()}-12-31`,
      }),
    ]);
  } catch (error) {
    context.log?.error?.('employee-leave GET failed to load data', { employeeId: employee.id, message: error?.message, code: error?.code });
    return respondTrackedLeaveError(context, 500, 'failed_to_load_leave_data', error, {
      action: 'load_leave_data',
      orgId,
      userId,
      employeeId: employee.id,
      startDate,
      endDate,
    });
  }

  const summary = computeLeaveSummary({
    employee,
    balanceEvents,
    targetDate: endDate || new Date(),
    leavePolicy: policies.leavePolicy,
  });

  return respond(context, 200, {
    employee_id: employee.id,
    policy_source: 'Employees',
    policy: {
      annual_leave_days: employee.annual_leave_days ?? null,
      leave_pay_method: employee.leave_pay_method || null,
      leave_fixed_day_rate: employee.leave_fixed_day_rate ?? null,
    },
    ledger_status: balanceEvents.length > 0 ? 'employee_leave_balance_events' : 'unavailable',
    entry_count: balanceEvents.length,
    recorded_balances: computeRecordedBalances(summary),
    entries: balanceEvents,
    balance_events: balanceEvents,
    leave_entries: leaveEntries,
    leave_days: leaveDays,
    summary,
    leave_policy: policies.leavePolicy,
    leave_pay_policy: policies.leavePayPolicy,
  });
}

async function handleUpsert(context, client, orgId, body, userId, method) {
  const leaveType = normalizeLeaveType(body?.leave_type);
  const employeeId = normalizeString(body?.employee_id);
  const startDate = normalizeString(body?.start_date);
  const endDate = normalizeString(body?.end_date || body?.start_date);
  const durationMode = normalizeDurationMode(body?.duration_mode, leaveType);
  const halfDayPart = normalizeHalfDayPart(body?.half_day_part);
  const reason = normalizeString(body?.reason) || null;
  const notes = normalizeString(body?.notes) || null;
  const status = normalizeEntryStatus(body?.status);

  if (!employeeId) {
    return respond(context, 400, { message: 'missing_employee_id' });
  }
  if (!leaveType) {
    return respond(context, 400, { message: 'invalid_leave_type' });
  }
  if (!isYmdDate(startDate) || !isYmdDate(endDate) || startDate > endDate) {
    return respond(context, 400, { message: 'invalid_date_range' });
  }
  if (durationMode === 'half_day' && startDate !== endDate) {
    return respond(context, 400, { message: 'half_day_requires_single_date' });
  }
  if (durationMode === 'half_day' && !halfDayPart) {
    return respond(context, 400, { message: 'missing_half_day_part' });
  }

  let existingEntry = null;
  if (method === 'PUT') {
    const leaveEntryId = normalizeString(body?.id);
    if (!leaveEntryId) {
      return respond(context, 400, { message: 'missing_leave_entry_id' });
    }

    existingEntry = await fetchLeaveEntry(client, orgId, leaveEntryId);
    if (!existingEntry) {
      return respond(context, 404, { message: 'leave_entry_not_found' });
    }
  }

  const overlappingLeaveDays = await fetchApprovedLeaveDays(client, {
    employeeId,
    startDate,
    endDate,
    excludeEntryId: existingEntry?.id || '',
  });

  if (overlappingLeaveDays.length > 0) {
    return respond(context, 409, {
      code: 'leave_conflict',
      message: 'leave_conflicts_with_existing_leave',
      leave_days: overlappingLeaveDays,
    });
  }

  const operationalConflict = await assertNoOperationalConflictsForLeave(client, {
    employeeId,
    startDate,
    endDate,
    excludeEntryId: existingEntry?.id || '',
  });

  if (operationalConflict) {
    return respond(context, 409, operationalConflict);
  }

  const payload = {
    employee_id: employeeId,
    leave_type: leaveType,
    status,
    duration_mode: durationMode,
    half_day_part: durationMode === 'half_day' ? halfDayPart : null,
    start_date: startDate,
    end_date: endDate,
    reason,
    notes,
    source_type: normalizeString(body?.source_type).toLowerCase() || 'admin_manual',
    approved_by: userId,
    updated_by: userId,
    updated_at: new Date().toISOString(),
    metadata: body?.metadata && typeof body.metadata === 'object' ? body.metadata : {},
  };

  let leaveEntryId = existingEntry?.id || '';
  try {
    if (!existingEntry) {
      payload.created_by = userId;
      payload.created_at = new Date().toISOString();
      const { data, error } = await withOrgScope(client, 'employee_leave_entries', orgId)
        .insert(payload)
        .select('id')
        .single();

      if (error) {
        throw error;
      }
      leaveEntryId = data.id;
    } else {
      const { error } = await withOrgScope(client, 'employee_leave_entries', orgId)
        .update(payload)
        .eq('id', leaveEntryId);

      if (error) {
        throw error;
      }

      await deleteLeaveArtifacts(client, orgId, leaveEntryId);
    }

    if (status === 'approved') {
      const leaveDaysPayload = buildLeaveDayRows({
        employeeId,
        leaveEntryId,
        leaveType,
        startDate,
        endDate,
        durationMode,
        halfDayPart,
      });

      const { data: leaveDays, error: leaveDaysError } = await withOrgScope(client, 'employee_leave_days', orgId)
        .insert(leaveDaysPayload)
        .select('id, leave_entry_id, employee_id, leave_date, day_portion, leave_type, balance_days_delta, pay_fraction, metadata');

      if (leaveDaysError) {
        throw leaveDaysError;
      }

      await upsertLeaveBalanceUsage(client, leaveDays || [], {
        orgId,
        leaveEntryId,
        employeeId,
        leaveType,
        notes,
        createdBy: userId,
      });
    }
  } catch (error) {
    context.log?.error?.('employee-leave failed to persist leave entry', {
      message: error.message,
      code: error.code,
    });

    if (!existingEntry && leaveEntryId) {
      await withOrgScope(client, 'employee_leave_entries', orgId).delete().eq('id', leaveEntryId);
    }
    return respondTrackedLeaveError(context, 500, 'failed_to_save_leave_entry', error, {
      action: existingEntry ? 'update_leave_entry' : 'create_leave_entry',
      orgId,
      userId,
      employeeId,
      leaveEntryId: leaveEntryId || null,
      table: 'employee_leave_entries',
      operation: existingEntry ? 'update' : 'insert',
      cleanupAttempted: Boolean(!existingEntry && leaveEntryId),
    });
  }

  const savedEntry = await fetchLeaveEntry(client, orgId, leaveEntryId);
  return respond(context, existingEntry ? 200 : 201, savedEntry);
}

async function handleDelete(context, client, orgId, body, userId) {
  const leaveEntryId = normalizeString(body?.id);
  if (!leaveEntryId) {
    return respond(context, 400, { message: 'missing_leave_entry_id' });
  }

  const existingEntry = await fetchLeaveEntry(client, orgId, leaveEntryId);
  if (!existingEntry) {
    return respond(context, 404, { message: 'leave_entry_not_found' });
  }

  try {
    await deleteLeaveArtifacts(client, orgId, leaveEntryId);
    const { data, error } = await withOrgScope(client, 'employee_leave_entries', orgId)
      .update({
        status: 'cancelled',
        updated_by: userId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', leaveEntryId)
      .select('id, employee_id, leave_type, status, duration_mode, half_day_part, start_date, end_date, reason, notes, source_type, approved_by, created_by, updated_by, created_at, updated_at, metadata')
      .single();

    if (error) {
      throw error;
    }

    return respond(context, 200, data);
  } catch (error) {
    context.log?.error?.('employee-leave failed to cancel leave entry', { message: error.message });
    return respondTrackedLeaveError(context, 500, 'failed_to_cancel_leave_entry', error, {
      action: 'cancel_leave_entry',
      orgId,
      userId,
      leaveEntryId,
      table: 'employee_leave_entries',
      operation: 'update',
    });
  }
}


async function handleBalanceEventUpsert(context, client, orgId, body, userId, method) {
  const employeeId = normalizeString(body?.employee_id);
  const eventType = normalizeBalanceEventType(body?.event_type);
  const effectiveDate = normalizeString(body?.effective_date);
  const notes = normalizeString(body?.notes) || null;
  const quantityDays = Number(body?.quantity_days);
  const leaveType = normalizeLeaveType(body?.leave_type) || 'employee_paid';

  if (!employeeId) {
    return respond(context, 400, { message: 'missing_employee_id' });
  }
  if (!eventType) {
    return respond(context, 400, { message: 'invalid_balance_event_type' });
  }
  if (!isYmdDate(effectiveDate)) {
    return respond(context, 400, { message: 'invalid_effective_date' });
  }
  if (!Number.isFinite(quantityDays) || quantityDays === 0) {
    return respond(context, 400, { message: 'invalid_quantity_days' });
  }
  if ((eventType === 'allocation' || eventType === 'carryover') && quantityDays < 0) {
    return respond(context, 400, { message: 'balance_event_requires_positive_quantity' });
  }

  let existingEvent = null;
  if (method === 'PUT') {
    const balanceEventId = normalizeString(body?.id);
    if (!balanceEventId) {
      return respond(context, 400, { message: 'missing_balance_event_id' });
    }

    existingEvent = await fetchBalanceEvent(client, orgId, balanceEventId);
    if (!existingEvent) {
      return respond(context, 404, { message: 'balance_event_not_found' });
    }
    if (!isManualBalanceEvent(existingEvent)) {
      return respond(context, 409, { message: 'generated_balance_event_is_immutable' });
    }
  }

  const payload = {
    employee_id: employeeId,
    leave_entry_id: null,
    leave_day_id: null,
    event_type: eventType,
    leave_type: leaveType,
    quantity_days: quantityDays,
    effective_date: effectiveDate,
    notes,
    metadata: body?.metadata && typeof body.metadata === 'object'
      ? body.metadata
      : {},
  };

  try {
    if (!existingEvent) {
      payload.created_by = userId;
      payload.created_at = new Date().toISOString();
      const { data, error } = await withOrgScope(client, 'employee_leave_balance_events', orgId)
        .insert(payload)
        .select('id, employee_id, leave_entry_id, leave_day_id, event_type, leave_type, quantity_days, effective_date, notes, created_by, created_at, metadata')
        .single();

      if (error) {
        throw error;
      }

      return respond(context, 201, data);
    }

    const { data, error } = await withOrgScope(client, 'employee_leave_balance_events', orgId)
      .update(payload)
      .eq('id', existingEvent.id)
      .select('id, employee_id, leave_entry_id, leave_day_id, event_type, leave_type, quantity_days, effective_date, notes, created_by, created_at, metadata')
      .maybeSingle();

    if (error) {
      throw error;
    }
    if (!data) {
      return respond(context, 404, { message: 'balance_event_not_found' });
    }

    return respond(context, 200, data);
  } catch (error) {
    context.log?.error?.('employee-leave failed to persist balance event', {
      message: error.message,
      code: error.code,
    });
    return respondTrackedLeaveError(context, 500, 'failed_to_save_balance_event', error, {
      action: existingEvent ? 'update_balance_event' : 'create_balance_event',
      orgId,
      userId,
      employeeId,
      balanceEventId: existingEvent?.id || body?.id || null,
      table: 'employee_leave_balance_events',
      operation: existingEvent ? 'update' : 'insert',
    });
  }
}

async function handleBalanceEventDelete(context, client, orgId, body, userId) {
  const balanceEventId = normalizeString(body?.id);
  if (!balanceEventId) {
    return respond(context, 400, { message: 'missing_balance_event_id' });
  }

  const existingEvent = await fetchBalanceEvent(client, orgId, balanceEventId);
  if (!existingEvent) {
    return respond(context, 404, { message: 'balance_event_not_found' });
  }
  if (!isManualBalanceEvent(existingEvent)) {
    return respond(context, 409, { message: 'generated_balance_event_is_immutable' });
  }

  try {
    const { data, error } = await withOrgScope(client, 'employee_leave_balance_events', orgId)
      .delete()
      .eq('id', balanceEventId)
      .select('id')
      .maybeSingle();

    if (error) {
      throw error;
    }
    if (!data) {
      return respond(context, 404, { message: 'balance_event_not_found' });
    }

    return respond(context, 200, { id: balanceEventId, deleted: true });
  } catch (error) {
    context.log?.error?.('employee-leave failed to delete balance event', {
      message: error.message,
      code: error.code,
    });
    return respondTrackedLeaveError(context, 500, 'failed_to_delete_balance_event', error, {
      action: 'delete_balance_event',
      orgId,
      userId,
      balanceEventId,
      table: 'employee_leave_balance_events',
      operation: 'delete',
    });
  }
}
