/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import { logAuditEvent, AUDIT_ACTIONS, AUDIT_CATEGORIES } from '../_shared/audit-log.js';
import {
  UUID_PATTERN,
  ensureMembership,
  isAdminOrOffice,
  normalizeString,
  parseRequestBody,
  readEnv,
  respond,
  resolveOrgId,
  withOrgScope,
} from '../_shared/org-bff.js';

function normalizeUuid(value) {
  const normalized = normalizeString(value);
  if (!normalized) return '';
  return UUID_PATTERN.test(normalized) ? normalized : '';
}

function isIsoDate(value) {
  if (!value) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value).trim());
}

function normalizeTime(value) {
  if (!value) return '';
  const trimmed = String(value).trim();
  if (!trimmed) return '';

  const match = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return '';

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] ?? 0);

  if (
    !Number.isInteger(hours)
    || !Number.isInteger(minutes)
    || !Number.isInteger(seconds)
    || hours < 0
    || hours > 23
    || minutes < 0
    || minutes > 59
    || seconds < 0
    || seconds > 59
  ) {
    return '';
  }

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function normalizeOverrideType(value) {
  const normalized = normalizeString(value).toLowerCase();
  if (normalized === 'cancel' || normalized === 'modify') {
    return normalized;
  }
  return '';
}

function buildOverrideSelect() {
  return [
    'id',
    'template_id',
    'target_date',
    'override_type',
    'new_instructor_employee_id',
    'new_service_id',
    'new_time_of_day',
    'new_duration_minutes',
    'note',
    'created_by',
    'created_at',
    'template:lesson_templates(id, student_id, instructor_employee_id, service_id, day_of_week, time_of_day, duration_minutes, valid_from, valid_until, is_active)',
    'new_instructor:Employees(id, first_name, middle_name, last_name, email)',
    'new_service:Services(id, name, color, duration_minutes)',
  ].join(',');
}

function isDuplicateOverrideError(error) {
  const code = normalizeString(error?.code);
  if (code === '23505') {
    return true;
  }

  const text = [error?.message, error?.details, error?.hint]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return text.includes('lesson_template_overrides_template_date_uidx');
}

function isDateWithinTemplateRange(targetDate, template) {
  const from = normalizeString(template?.valid_from) || '0001-01-01';
  const until = normalizeString(template?.valid_until) || '9999-12-31';
  return from <= targetDate && targetDate <= until;
}

function hasAnyModifyField(payload) {
  return Boolean(
    payload.new_instructor_employee_id
      || payload.new_service_id
      || payload.new_time_of_day
      || payload.new_duration_minutes,
  );
}

export default async function lessonTemplateOverrides(context, req) {
  const method = String(req.method || 'GET').toUpperCase();

  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);

  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('lesson-template-overrides missing Supabase admin credentials');
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
    context.log?.error?.('lesson-template-overrides failed to validate token', { message: error?.message });
    return respond(context, 401, { message: 'invalid_or_expired_token' });
  }

  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid_or_expired_token' });
  }

  const userId = authResult.data.user.id;
  const userEmail = normalizeString(authResult.data.user.email) || `missing-email-${userId}`;
  const body = parseRequestBody(req);
  const orgId = resolveOrgId(req, body);

  if (!orgId) {
    return respond(context, 400, { message: 'invalid_org_id' });
  }

  let role;
  try {
    role = await ensureMembership(supabase, orgId, userId);
  } catch (membershipError) {
    context.log?.error?.('lesson-template-overrides failed to verify membership', {
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

  if (method === 'GET') {
    const templateId = normalizeUuid(req?.query?.template_id || req?.query?.templateId || body?.template_id || body?.templateId);
    if (!templateId) {
      return respond(context, 400, { message: 'invalid_template_id' });
    }

    const { data, error } = await withOrgScope(supabase, 'lesson_template_overrides', orgId)
      .select(buildOverrideSelect())
      .eq('template_id', templateId)
      .order('target_date', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) {
      context.log?.error?.('lesson-template-overrides failed to list overrides', {
        message: error.message,
        templateId,
      });
      return respond(context, 500, { message: 'failed_to_load_template_overrides' });
    }

    return respond(context, 200, Array.isArray(data) ? data : []);
  }

  if (method === 'POST') {
    const templateId = normalizeUuid(body?.template_id || body?.templateId);
    const targetDate = normalizeString(body?.target_date || body?.targetDate);
    const overrideType = normalizeOverrideType(body?.override_type || body?.overrideType);

    const newInstructorEmployeeId = normalizeUuid(body?.new_instructor_employee_id || body?.newInstructorEmployeeId) || null;
    const newServiceId = normalizeUuid(body?.new_service_id || body?.newServiceId) || null;
    const newTimeOfDay = normalizeTime(body?.new_time_of_day || body?.newTimeOfDay) || null;
    const newDurationMinutesRaw = Object.prototype.hasOwnProperty.call(body, 'new_duration_minutes')
      ? body.new_duration_minutes
      : Object.prototype.hasOwnProperty.call(body, 'newDurationMinutes')
        ? body.newDurationMinutes
        : null;
    const newDurationMinutes = newDurationMinutesRaw === null || newDurationMinutesRaw === undefined || String(newDurationMinutesRaw).trim() === ''
      ? null
      : Number(newDurationMinutesRaw);

    const note = normalizeString(body?.note || body?.notes) || null;

    if (!templateId) {
      return respond(context, 400, { message: 'invalid_template_id' });
    }

    if (!targetDate || !isIsoDate(targetDate)) {
      return respond(context, 400, { message: 'invalid_target_date' });
    }

    if (!overrideType) {
      return respond(context, 400, { message: 'invalid_override_type' });
    }

    if (newDurationMinutes !== null && (!Number.isFinite(newDurationMinutes) || newDurationMinutes <= 0)) {
      return respond(context, 400, { message: 'invalid_new_duration_minutes' });
    }

    const payload = {
      template_id: templateId,
      target_date: targetDate,
      override_type: overrideType,
      new_instructor_employee_id: newInstructorEmployeeId,
      new_service_id: newServiceId,
      new_time_of_day: newTimeOfDay,
      new_duration_minutes: newDurationMinutes,
      note,
      created_by: userId,
    };

    if (overrideType === 'cancel') {
      payload.new_instructor_employee_id = null;
      payload.new_service_id = null;
      payload.new_time_of_day = null;
      payload.new_duration_minutes = null;
    }

    if (overrideType === 'modify' && !hasAnyModifyField(payload)) {
      return respond(context, 400, { message: 'modify_override_requires_fields' });
    }

    const { data: existingTemplate, error: existingTemplateError } = await withOrgScope(supabase, 'lesson_templates', orgId)
      .select('id, valid_from, valid_until')
      .eq('id', templateId)
      .maybeSingle();

    if (existingTemplateError) {
      context.log?.error?.('lesson-template-overrides failed to load template', {
        message: existingTemplateError.message,
        templateId,
      });
      return respond(context, 500, { message: 'failed_to_create_template_override' });
    }

    if (!existingTemplate) {
      return respond(context, 404, { message: 'lesson_template_not_found' });
    }

    if (!isDateWithinTemplateRange(targetDate, existingTemplate)) {
      return respond(context, 400, { message: 'target_date_outside_template_range' });
    }

    const { data, error } = await withOrgScope(supabase, 'lesson_template_overrides', orgId)
      .insert(payload)
      .select(buildOverrideSelect())
      .single();

    if (error) {
      if (isDuplicateOverrideError(error)) {
        return respond(context, 409, { message: 'template_override_already_exists' });
      }

      context.log?.error?.('lesson-template-overrides failed to create override', {
        message: error.message,
        templateId,
      });
      return respond(context, 500, { message: 'failed_to_create_template_override' });
    }

    try {
      await logAuditEvent(supabase, {
        orgId,
        userId,
        userEmail,
        userRole: role,
        actionType: AUDIT_ACTIONS.TEMPLATE_OVERRIDE_CREATED,
        actionCategory: AUDIT_CATEGORIES.CALENDAR,
        resourceType: 'lesson_template_override',
        resourceId: data.id,
        details: {
          template_id: data.template_id,
          target_date: data.target_date,
          override_type: data.override_type,
          new_instructor_employee_id: data.new_instructor_employee_id,
          new_service_id: data.new_service_id,
          new_time_of_day: data.new_time_of_day,
          new_duration_minutes: data.new_duration_minutes,
          note: data.note,
        },
      });
    } catch (auditError) {
      context.log?.error?.('lesson-template-overrides failed to write audit event (create)', {
        message: auditError?.message,
        overrideId: data?.id,
      });
    }

    return respond(context, 201, data);
  }

  if (method === 'DELETE') {
    const overrideId = normalizeUuid(
      context?.bindingData?.overrideId || body?.override_id || body?.overrideId,
    );

    if (!overrideId) {
      return respond(context, 400, { message: 'invalid_override_id' });
    }

    const { data: existingOverride, error: existingOverrideError } = await withOrgScope(supabase, 'lesson_template_overrides', orgId)
      .select('id, template_id, target_date, override_type, new_instructor_employee_id, new_service_id, new_time_of_day, new_duration_minutes, note')
      .eq('id', overrideId)
      .maybeSingle();

    if (existingOverrideError) {
      context.log?.error?.('lesson-template-overrides failed to load override', {
        message: existingOverrideError.message,
        overrideId,
      });
      return respond(context, 500, { message: 'failed_to_delete_template_override' });
    }

    if (!existingOverride) {
      return respond(context, 404, { message: 'template_override_not_found' });
    }

    const { error } = await withOrgScope(supabase, 'lesson_template_overrides', orgId)
      .delete()
      .eq('id', overrideId);

    if (error) {
      context.log?.error?.('lesson-template-overrides failed to delete override', {
        message: error.message,
        overrideId,
      });
      return respond(context, 500, { message: 'failed_to_delete_template_override' });
    }

    try {
      await logAuditEvent(supabase, {
        orgId,
        userId,
        userEmail,
        userRole: role,
        actionType: AUDIT_ACTIONS.TEMPLATE_OVERRIDE_DELETED,
        actionCategory: AUDIT_CATEGORIES.CALENDAR,
        resourceType: 'lesson_template_override',
        resourceId: existingOverride.id,
        details: {
          template_id: existingOverride.template_id,
          target_date: existingOverride.target_date,
          override_type: existingOverride.override_type,
          new_instructor_employee_id: existingOverride.new_instructor_employee_id,
          new_service_id: existingOverride.new_service_id,
          new_time_of_day: existingOverride.new_time_of_day,
          new_duration_minutes: existingOverride.new_duration_minutes,
          note: existingOverride.note,
        },
      });
    } catch (auditError) {
      context.log?.error?.('lesson-template-overrides failed to write audit event (delete)', {
        message: auditError?.message,
        overrideId: existingOverride?.id,
      });
    }

    return respond(context, 200, { message: 'template_override_deleted', id: existingOverride.id });
  }

  return respond(context, 405, { message: 'method_not_allowed' });
}
