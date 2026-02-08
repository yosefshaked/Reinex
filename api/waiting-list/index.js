/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import {
  UUID_PATTERN,
  ensureMembership,
  isAdminOrOffice,
  normalizeString,
  parseRequestBody,
  readEnv,
  respond,
  resolveOrgId,
  resolveTenantClient,
} from '../_shared/org-bff.js';

const STATUS_OPTIONS = new Set(['open', 'matched', 'closed', 'all']);

function normalizeUuid(value) {
  const normalized = normalizeString(value);
  if (!normalized) return '';
  return UUID_PATTERN.test(normalized) ? normalized : '';
}

function normalizeStatus(value, { allowAll = false } = {}) {
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) return '';
  if (normalized === 'canceled' || normalized === 'cancelled' || normalized === 'cancel') {
    return 'closed';
  }
  if (allowAll && normalized === 'all') {
    return 'all';
  }
  return STATUS_OPTIONS.has(normalized) && normalized !== 'all' ? normalized : '';
}

function normalizePreferredDays(value) {
  if (!Array.isArray(value)) {
    return null;
  }
  const unique = new Set();
  value.forEach((entry) => {
    const day = Number(entry);
    if (Number.isInteger(day) && day >= 0 && day <= 6) {
      unique.add(day);
    }
  });
  if (!unique.size) {
    return null;
  }
  return Array.from(unique).sort((a, b) => a - b);
}

function normalizeBoolean(value, defaultValue = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  }
  if (typeof value === 'number') {
    return value === 1;
  }
  return defaultValue;
}

function buildWaitingListSelect() {
  return [
    'id',
    'student_id',
    'desired_service_id',
    'preferred_days',
    'priority_flag',
    'notes',
    'status',
    'created_at',
    'student:students(id, first_name, middle_name, last_name, identity_number)',
    'service:Services(id, name)',
  ].join(',');
}

export default async function waitingList(context, req) {
  const method = String(req.method || 'GET').toUpperCase();
  if (!['GET', 'POST', 'PUT'].includes(method)) {
    return respond(context, 405, { message: 'method_not_allowed' }, { Allow: 'GET,POST,PUT' });
  }

  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);

  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('waiting-list missing Supabase admin credentials');
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
  } catch (error) {
    context.log?.error?.('waiting-list failed to validate token', { message: error?.message });
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  const userId = authResult.data.user.id;
  const body = parseRequestBody(req);
  const orgId = resolveOrgId(req, body);

  if (!orgId) {
    return respond(context, 400, { message: 'invalid org id' });
  }

  let role;
  try {
    role = await ensureMembership(supabase, orgId, userId);
  } catch (membershipError) {
    context.log?.error?.('waiting-list failed to verify membership', {
      message: membershipError?.message,
      orgId,
      userId,
    });
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
    const rawStatus = req?.query?.status ?? body?.status ?? 'open';
    const statusFilter = normalizeStatus(rawStatus, { allowAll: true }) || 'open';

    if (!statusFilter) {
      return respond(context, 400, { message: 'invalid_status_filter' });
    }

    let builder = tenantClient
      .from('waiting_list_entries')
      .select(buildWaitingListSelect())
      .order('priority_flag', { ascending: false })
      .order('created_at', { ascending: false });

    if (statusFilter !== 'all') {
      builder = builder.eq('status', statusFilter);
    }

    const { data, error } = await builder;
    if (error) {
      context.log?.error?.('waiting-list failed to fetch entries', { message: error.message });
      return respond(context, 500, { message: 'failed_to_load_waiting_list' });
    }

    return respond(context, 200, Array.isArray(data) ? data : []);
  }

  if (method === 'POST') {
    const studentId = normalizeUuid(body?.student_id || body?.studentId);
    const serviceId = normalizeUuid(body?.desired_service_id || body?.desiredServiceId || body?.service_id || body?.serviceId);
    const preferredDays = normalizePreferredDays(body?.preferred_days ?? body?.preferredDays);
    const priorityFlag = normalizeBoolean(body?.priority_flag ?? body?.priorityFlag ?? body?.priority, false);
    const notes = normalizeString(body?.notes) || null;
    const rawStatus = normalizeString(body?.status);
    const status = rawStatus ? normalizeStatus(rawStatus) : 'open';

    if (!studentId) {
      return respond(context, 400, { message: 'invalid_student_id' });
    }

    if (!serviceId) {
      return respond(context, 400, { message: 'invalid_service_id' });
    }

    if (!status) {
      return respond(context, 400, { message: 'invalid_status' });
    }

    const payload = {
      student_id: studentId,
      desired_service_id: serviceId,
      preferred_days: preferredDays,
      priority_flag: priorityFlag,
      notes,
      status,
    };

    const { data, error } = await tenantClient
      .from('waiting_list_entries')
      .insert(payload)
      .select(buildWaitingListSelect())
      .single();

    if (error) {
      context.log?.error?.('waiting-list failed to create entry', { message: error.message });
      return respond(context, 500, { message: 'failed_to_create_waiting_list' });
    }

    return respond(context, 200, data);
  }

  const entryId = normalizeUuid(req?.params?.entryId || body?.id || body?.entry_id || body?.entryId);
  if (!entryId) {
    return respond(context, 400, { message: 'invalid_entry_id' });
  }

  const updates = {};

  if ('student_id' in body || 'studentId' in body) {
    const studentId = normalizeUuid(body?.student_id || body?.studentId);
    if (!studentId) {
      return respond(context, 400, { message: 'invalid_student_id' });
    }
    updates.student_id = studentId;
  }

  if ('desired_service_id' in body || 'desiredServiceId' in body || 'service_id' in body || 'serviceId' in body) {
    const serviceId = normalizeUuid(body?.desired_service_id || body?.desiredServiceId || body?.service_id || body?.serviceId);
    if (!serviceId) {
      return respond(context, 400, { message: 'invalid_service_id' });
    }
    updates.desired_service_id = serviceId;
  }

  if ('preferred_days' in body || 'preferredDays' in body) {
    const preferredDays = normalizePreferredDays(body?.preferred_days ?? body?.preferredDays);
    updates.preferred_days = preferredDays;
  }

  if ('priority_flag' in body || 'priorityFlag' in body || 'priority' in body) {
    updates.priority_flag = normalizeBoolean(body?.priority_flag ?? body?.priorityFlag ?? body?.priority, false);
  }

  if ('notes' in body) {
    updates.notes = normalizeString(body?.notes) || null;
  }

  if ('status' in body) {
    const status = normalizeStatus(body?.status);
    if (!status) {
      return respond(context, 400, { message: 'invalid_status' });
    }
    updates.status = status;
  }

  if (Object.keys(updates).length === 0) {
    return respond(context, 400, { message: 'missing_updates' });
  }

  const { data, error } = await tenantClient
    .from('waiting_list_entries')
    .update(updates)
    .eq('id', entryId)
    .select(buildWaitingListSelect())
    .single();

  if (error) {
    context.log?.error?.('waiting-list failed to update entry', { message: error.message });
    return respond(context, 500, { message: 'failed_to_update_waiting_list' });
  }

  return respond(context, 200, data);
}
