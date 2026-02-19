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

const DEFAULT_SERVICE_ID = '00000000-0000-0000-0000-000000000000';

function normalizeUuid(value) {
  const normalized = normalizeString(value);
  if (!normalized) return '';
  return UUID_PATTERN.test(normalized) ? normalized : '';
}

function normalizeDayOfWeek(value) {
  const num = Number(value);
  if (!Number.isInteger(num) || num < 0 || num > 6) {
    return null;
  }
  return num;
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
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    !Number.isInteger(seconds) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59 ||
    seconds < 0 ||
    seconds > 59
  ) {
    return '';
  }

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function isIsoDate(value) {
  if (!value) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value).trim());
}

function buildTemplateSelect({ includeStudent = false } = {}) {
  const fields = [
    'id',
    'student_id',
    'instructor_employee_id',
    'service_id',
    'day_of_week',
    'time_of_day',
    'duration_minutes',
    'valid_from',
    'valid_until',
    'price_override',
    'notes_internal',
    'flags',
    'is_active',
    'created_at',
    'updated_at',
    'metadata',
    'instructor:Employees(id, first_name, middle_name, last_name, email)',
    'service:Services(id, name, duration_minutes, color)',
  ];
  if (includeStudent) {
    fields.push('student:students(id, first_name, middle_name, last_name)');
  }
  return fields.join(',');
}

export default async function lessonTemplates(context, req) {
  const method = String(req.method || 'GET').toUpperCase();

  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);

  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('lesson-templates missing Supabase admin credentials');
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    return respond(context, 401, { message: 'missing bearer' });
  }

  const supabase = createSupabaseAdminClient(adminConfig, {
    global: { headers: { 'Cache-Control': 'no-store' } },
  });

  let authResult;
  try {
    authResult = await supabase.auth.getUser(authorization.token);
  } catch (error) {
    context.log?.error?.('lesson-templates failed to validate token', { message: error?.message });
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
    context.log?.error?.('lesson-templates failed to verify membership', {
      message: membershipError?.message,
      orgId,
      userId,
    });
    return respond(context, 500, { message: 'failed_to_verify_membership' });
  }

  if (!role) {
    return respond(context, 403, { message: 'forbidden' });
  }

  const isAdmin = isAdminOrOffice(role);

  const { client: tenantClient, error: tenantError } = await resolveTenantClient(context, supabase, env, orgId);
  if (tenantError) {
    return respond(context, tenantError.status, tenantError.body);
  }

  if (method === 'GET') {
    const studentId = normalizeUuid(req?.query?.student_id || body?.student_id || body?.studentId);
    const listAll = normalizeString(req?.query?.all) === 'true';

    // Mode 1: List all templates (Template Manager grid view) — admin/office only
    if (listAll || !studentId) {
      if (!isAdmin) {
        return respond(context, 403, { message: 'forbidden' });
      }

      const showInactive = normalizeString(req?.query?.show_inactive) === 'true';
      const instructorId = normalizeUuid(req?.query?.instructor_id);

      let query = tenantClient
        .from('lesson_templates')
        .select(buildTemplateSelect({ includeStudent: true }))
        .order('day_of_week', { ascending: true })
        .order('time_of_day', { ascending: true });

      if (!showInactive) {
        query = query.eq('is_active', true);
      }

      if (instructorId) {
        query = query.eq('instructor_employee_id', instructorId);
      }

      const { data, error } = await query;

      if (error) {
        context.log?.error?.('lesson-templates failed to list all templates', { message: error.message });
        return respond(context, 500, { message: 'failed_to_load_lesson_templates' });
      }

      return respond(context, 200, Array.isArray(data) ? data : []);
    }

    // Mode 2: Student-scoped (existing behavior — student detail page)
    if (!isAdmin) {
      const { data: assignmentRows, error: assignmentError } = await tenantClient
        .from('lesson_templates')
        .select('id')
        .eq('student_id', studentId)
        .eq('instructor_employee_id', userId)
        .eq('is_active', true)
        .limit(1);

      if (assignmentError) {
        context.log?.error?.('lesson-templates failed to check instructor assignment', {
          message: assignmentError.message,
          studentId,
          userId,
        });
        return respond(context, 500, { message: 'failed_to_load_lesson_templates' });
      }

      if (!assignmentRows || assignmentRows.length === 0) {
        return respond(context, 403, { message: 'student_not_assigned_to_user' });
      }
    }

    const { data, error } = await tenantClient
      .from('lesson_templates')
      .select(buildTemplateSelect())
      .eq('student_id', studentId)
      .order('is_active', { ascending: false })
      .order('valid_from', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) {
      context.log?.error?.('lesson-templates failed to load templates', { message: error.message, studentId });
      return respond(context, 500, { message: 'failed_to_load_lesson_templates' });
    }

    return respond(context, 200, Array.isArray(data) ? data : []);
  }

  if (!isAdmin) {
    return respond(context, 403, { message: 'forbidden' });
  }

  if (method === 'POST') {
    const studentId = normalizeUuid(body?.student_id || body?.studentId);
    const instructorEmployeeId = normalizeUuid(body?.instructor_employee_id || body?.instructorEmployeeId);
    const serviceId = normalizeUuid(body?.service_id || body?.serviceId) || DEFAULT_SERVICE_ID;
    const dayOfWeek = normalizeDayOfWeek(body?.day_of_week ?? body?.dayOfWeek);
    const timeOfDay = normalizeTime(body?.time_of_day || body?.timeOfDay);
    const durationMinutes = Number(body?.duration_minutes ?? body?.durationMinutes);
    const validFrom = normalizeString(body?.valid_from || body?.validFrom);
    const validUntil = normalizeString(body?.valid_until || body?.validUntil);

    if (!studentId) {
      return respond(context, 400, { message: 'invalid_student_id' });
    }

    if (!instructorEmployeeId) {
      return respond(context, 400, { message: 'invalid_instructor_id' });
    }

    if (!serviceId) {
      return respond(context, 400, { message: 'invalid_service_id' });
    }

    if (dayOfWeek === null) {
      return respond(context, 400, { message: 'invalid_day_of_week' });
    }

    if (!timeOfDay) {
      return respond(context, 400, { message: 'invalid_time_of_day' });
    }

    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
      return respond(context, 400, { message: 'invalid_duration_minutes' });
    }

    if (!validFrom || !isIsoDate(validFrom)) {
      return respond(context, 400, { message: 'invalid_valid_from' });
    }

    if (validUntil && !isIsoDate(validUntil)) {
      return respond(context, 400, { message: 'invalid_valid_until' });
    }

    if (validUntil && validUntil < validFrom) {
      return respond(context, 400, { message: 'invalid_valid_until' });
    }

    const { error: deactivateError } = await tenantClient
      .from('lesson_templates')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('student_id', studentId)
      .eq('is_active', true);

    if (deactivateError) {
      context.log?.warn?.('lesson-templates failed to deactivate existing templates', {
        message: deactivateError.message,
        studentId,
      });
    }

    const { data, error } = await tenantClient
      .from('lesson_templates')
      .insert({
        student_id: studentId,
        instructor_employee_id: instructorEmployeeId,
        service_id: serviceId,
        day_of_week: dayOfWeek,
        time_of_day: timeOfDay,
        duration_minutes: durationMinutes,
        valid_from: validFrom,
        valid_until: validUntil || null,
        is_active: true,
        updated_at: new Date().toISOString(),
      })
      .select(buildTemplateSelect())
      .single();

    if (error) {
      context.log?.error?.('lesson-templates failed to create template', { message: error.message, studentId });
      return respond(context, 500, { message: 'failed_to_create_lesson_template' });
    }

    return respond(context, 201, data);
  }

  if (method === 'PUT') {
    const templateId = normalizeUuid(
      context?.bindingData?.templateId || body?.template_id || body?.templateId,
    );
    if (!templateId) {
      return respond(context, 400, { message: 'invalid_template_id' });
    }

    const updates = {};

    if (Object.prototype.hasOwnProperty.call(body, 'student_id') || Object.prototype.hasOwnProperty.call(body, 'studentId')) {
      const studentId = normalizeUuid(body?.student_id || body?.studentId);
      if (!studentId) {
        return respond(context, 400, { message: 'invalid_student_id' });
      }
      updates.student_id = studentId;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'instructor_employee_id') || Object.prototype.hasOwnProperty.call(body, 'instructorEmployeeId')) {
      const instructorEmployeeId = normalizeUuid(body?.instructor_employee_id || body?.instructorEmployeeId);
      if (!instructorEmployeeId) {
        return respond(context, 400, { message: 'invalid_instructor_id' });
      }
      updates.instructor_employee_id = instructorEmployeeId;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'service_id') || Object.prototype.hasOwnProperty.call(body, 'serviceId')) {
      const serviceId = normalizeUuid(body?.service_id || body?.serviceId) || DEFAULT_SERVICE_ID;
      if (!serviceId) {
        return respond(context, 400, { message: 'invalid_service_id' });
      }
      updates.service_id = serviceId;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'day_of_week') || Object.prototype.hasOwnProperty.call(body, 'dayOfWeek')) {
      const dayOfWeek = normalizeDayOfWeek(body?.day_of_week ?? body?.dayOfWeek);
      if (dayOfWeek === null) {
        return respond(context, 400, { message: 'invalid_day_of_week' });
      }
      updates.day_of_week = dayOfWeek;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'time_of_day') || Object.prototype.hasOwnProperty.call(body, 'timeOfDay')) {
      const timeOfDay = normalizeTime(body?.time_of_day || body?.timeOfDay);
      if (!timeOfDay) {
        return respond(context, 400, { message: 'invalid_time_of_day' });
      }
      updates.time_of_day = timeOfDay;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'duration_minutes') || Object.prototype.hasOwnProperty.call(body, 'durationMinutes')) {
      const durationMinutes = Number(body?.duration_minutes ?? body?.durationMinutes);
      if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
        return respond(context, 400, { message: 'invalid_duration_minutes' });
      }
      updates.duration_minutes = durationMinutes;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'valid_from') || Object.prototype.hasOwnProperty.call(body, 'validFrom')) {
      const validFrom = normalizeString(body?.valid_from || body?.validFrom);
      if (!validFrom || !isIsoDate(validFrom)) {
        return respond(context, 400, { message: 'invalid_valid_from' });
      }
      updates.valid_from = validFrom;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'valid_until') || Object.prototype.hasOwnProperty.call(body, 'validUntil')) {
      const validUntil = normalizeString(body?.valid_until || body?.validUntil);
      if (validUntil && !isIsoDate(validUntil)) {
        return respond(context, 400, { message: 'invalid_valid_until' });
      }
      updates.valid_until = validUntil || null;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'is_active') || Object.prototype.hasOwnProperty.call(body, 'isActive')) {
      updates.is_active = Boolean(body?.is_active ?? body?.isActive);
    }

    if (Object.keys(updates).length === 0) {
      return respond(context, 400, { message: 'missing_updates' });
    }

    updates.updated_at = new Date().toISOString();

    const { data, error } = await tenantClient
      .from('lesson_templates')
      .update(updates)
      .eq('id', templateId)
      .select(buildTemplateSelect())
      .maybeSingle();

    if (error) {
      context.log?.error?.('lesson-templates failed to update template', { message: error.message, templateId });
      return respond(context, 500, { message: 'failed_to_update_lesson_template' });
    }

    if (!data) {
      return respond(context, 404, { message: 'lesson_template_not_found' });
    }

    return respond(context, 200, data);
  }

  if (method === 'DELETE') {
    const templateId = normalizeUuid(
      context?.bindingData?.templateId || body?.template_id || body?.templateId,
    );
    if (!templateId) {
      return respond(context, 400, { message: 'invalid_template_id' });
    }

    const today = new Date().toISOString().split('T')[0];

    const { data, error } = await tenantClient
      .from('lesson_templates')
      .update({ is_active: false, valid_until: today, updated_at: new Date().toISOString() })
      .eq('id', templateId)
      .select('id, is_active, valid_until')
      .maybeSingle();

    if (error) {
      context.log?.error?.('lesson-templates failed to deactivate template', { message: error.message, templateId });
      return respond(context, 500, { message: 'failed_to_deactivate_lesson_template' });
    }

    if (!data) {
      return respond(context, 404, { message: 'lesson_template_not_found' });
    }

    return respond(context, 200, { message: 'template_deactivated', id: data.id });
  }

  return respond(context, 405, { message: 'method_not_allowed' });
}
