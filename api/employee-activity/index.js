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
  withOrgScope,
} from '../_shared/org-bff.js';
import { parseJsonBodyWithLimit } from '../_shared/validation.js';

const DEFAULT_LIMIT = 120;
const MAX_LIMIT = 250;

const ACTION_TITLES = {
  'calendar.instance_created': 'נוצר שיעור לעובד',
  'calendar.instance_updated': 'עודכן שיעור',
  'calendar.instance_cancelled': 'שיעור בוטל',
  'instructor.updated': 'כרטיס העובד עודכן',
  'instructor.created': 'נוצר כרטיס עובד',
  'member.invited': 'נשלחה הזמנה למשתמש',
  'member.linked_to_employee': 'חבר ארגון שויך לעובד',
  'file.uploaded': 'הועלה מסמך',
  'document.updated': 'עודכן מסמך',
  'file.deleted': 'נמחק מסמך',
};

function normalizeLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_LIMIT;
  }
  return Math.min(Math.floor(parsed), MAX_LIMIT);
}

function getActor(entry) {
  const email = normalizeString(entry?.actor_email);
  if (!email) {
    return 'מערכת';
  }
  return email;
}

function isRelevantEntry(entry, employeeId) {
  const details = entry?.details && typeof entry.details === 'object' ? entry.details : {};
  const resourceType = normalizeString(entry?.resource_type).toLowerCase();
  const resourceId = normalizeString(entry?.resource_id);
  const actionCategory = normalizeString(entry?.action_category).toLowerCase();

  if (resourceType === 'instructor' && resourceId === employeeId) {
    return true;
  }

  if (actionCategory === 'calendar' && normalizeString(details?.instructor_employee_id) === employeeId) {
    return true;
  }

  if (actionCategory === 'files'
    && normalizeString(details?.entity_type).toLowerCase() === 'instructor'
    && normalizeString(details?.entity_id) === employeeId) {
    return true;
  }

  if (actionCategory === 'membership') {
    return normalizeString(details?.employee_id) === employeeId
      || normalizeString(details?.link_to_employee_id) === employeeId
      || resourceId === employeeId;
  }

  return false;
}

function mapFamily(entry) {
  const actionCategory = normalizeString(entry?.action_category).toLowerCase();
  if (actionCategory === 'calendar') return 'operational';
  if (actionCategory === 'files') return 'documents';
  return 'system';
}

function buildSubtitle(entry) {
  const details = entry?.details && typeof entry.details === 'object' ? entry.details : {};
  const actionType = normalizeString(entry?.event_type).toLowerCase();

  if (actionType === 'calendar.instance_created' || actionType === 'calendar.instance_updated' || actionType === 'calendar.instance_cancelled') {
    const dateTime = normalizeString(details?.datetime_start);
    return [normalizeString(details?.action_label_he), dateTime].filter(Boolean).join(' • ');
  }

  if (actionType === 'member.invited') {
    return [normalizeString(details?.employee_name), normalizeString(details?.invited_email)].filter(Boolean).join(' • ');
  }

  if (actionType === 'member.linked_to_employee') {
    return [normalizeString(details?.employee_name), normalizeString(details?.member_email || details?.member_name)].filter(Boolean).join(' • ');
  }

  if (actionType === 'file.uploaded' || actionType === 'document.updated' || actionType === 'file.deleted') {
    return normalizeString(details?.file_name) || 'מסמך עובד';
  }

  if (actionType === 'instructor.updated') {
    const fields = Array.isArray(details?.updated_fields) ? details.updated_fields : [];
    return fields.length > 0 ? `שדות: ${fields.join(', ')}` : normalizeString(details?.instructor_name);
  }

  return normalizeString(details?.action_label_he) || normalizeString(details?.instructor_name) || '';
}

export default async function (context, req) {
  const method = String(req.method || 'GET').toUpperCase();
  if (method !== 'GET') {
    return respond(context, 405, { message: 'method_not_allowed' });
  }

  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);
  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('employee-activity missing Supabase admin credentials');
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    return respond(context, 401, { message: 'missing_bearer' });
  }

  const supabase = createSupabaseAdminClient(adminConfig, {
    global: { headers: { 'Cache-Control': 'no-store' } },
  });

  let authResult;
  try {
    authResult = await supabase.auth.getUser(authorization.token);
  } catch (error) {
    context.log?.error?.('employee-activity failed to validate token', { message: error?.message });
    return respond(context, 401, { message: 'invalid_or_expired_token' });
  }

  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid_or_expired_token' });
  }

  const userId = authResult.data.user.id;
  const body = parseJsonBodyWithLimit(req, 48 * 1024, { mode: 'observe', context, endpoint: 'employee-activity' });
  const orgId = resolveOrgId(req, body);
  if (!orgId) {
    return respond(context, 400, { message: 'invalid_org_id' });
  }

  let role;
  try {
    role = await ensureMembership(supabase, orgId, userId);
  } catch (membershipError) {
    context.log?.error?.('employee-activity failed to verify membership', {
      message: membershipError?.message,
      orgId,
      userId,
    });
    return respond(context, 500, { message: 'failed_to_verify_membership' });
  }

  if (!role) {
    return respond(context, 403, { message: 'forbidden' });
  }

  const employeeId = normalizeString(req?.query?.employee_id || body?.employee_id);
  if (!employeeId) {
    return respond(context, 400, { message: 'missing_employee_id' });
  }

  const { data: employee, error: employeeError } = await withOrgScope(supabase, 'Employees', orgId)
    .select('id, user_id, first_name, last_name')
    .eq('id', employeeId)
    .maybeSingle();

  if (employeeError) {
    context.log?.error?.('employee-activity failed to load employee', { message: employeeError.message, employeeId });
    return respond(context, 500, { message: 'failed_to_load_employee' });
  }
  if (!employee) {
    return respond(context, 404, { message: 'employee_not_found' });
  }

  if (!isAdminRole(role) && employee.user_id !== userId) {
    return respond(context, 403, { message: 'forbidden' });
  }

  const limit = normalizeLimit(req?.query?.limit || body?.limit);
  const { data: auditRows, error: auditError } = await supabase
    .from('audit_log')
    .select('id, actor_email, actor_role, event_type, action_category, resource_type, resource_id, details, created_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(limit * 4);

  if (auditError) {
    context.log?.error?.('employee-activity failed to query audit log', { message: auditError.message, employeeId });
    return respond(context, 500, { message: 'failed_to_load_activity' });
  }

  const items = (auditRows || [])
    .filter((entry) => isRelevantEntry(entry, employeeId))
    .slice(0, limit)
    .map((entry) => ({
      id: entry.id,
      event_family: mapFamily(entry),
      event_type: entry.event_type,
      occurred_at: entry.created_at,
      title: ACTION_TITLES[entry.event_type] || entry.event_type,
      subtitle: buildSubtitle(entry),
      actor: getActor(entry),
      metadata: {
        action_category: entry.action_category,
        resource_type: entry.resource_type,
        resource_id: entry.resource_id,
        details: entry.details || {},
      },
    }));

  return respond(context, 200, {
    employee: {
      id: employee.id,
      name: `${employee.first_name || ''} ${employee.last_name || ''}`.trim(),
    },
    items,
  });
}
