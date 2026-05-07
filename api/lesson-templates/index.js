/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import { logAuditEvent, AUDIT_ACTIONS, AUDIT_CATEGORIES } from '../_shared/audit-log.js';
import { logTenantAuditEvent, TENANT_AUDIT_RETENTION } from '../_shared/tenant-audit.js';
import { normalizeDayToken, daySortValue } from '../_shared/day-of-week.js';
import { hasConfiguredAvailability, isWithinAvailabilityWindows, timeToMinutes } from '../_shared/instructor-availability.js';
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
import { ensureStudentForClientProfile } from '../_shared/client-profiles.js';
import { ceilClockTimeToGrid } from '../_shared/time-grid.js';

function normalizeUuid(value) {
  const normalized = normalizeString(value);
  if (!normalized) return '';
  return UUID_PATTERN.test(normalized) ? normalized : '';
}

function normalizeDayOfWeek(value) {
  return normalizeDayToken(value);
}

function compareTemplatesByDayAndTime(left, right) {
  const dayDiff = daySortValue(left?.day_of_week) - daySortValue(right?.day_of_week);
  if (dayDiff !== 0) {
    return dayDiff;
  }

  return String(left?.time_of_day || '').localeCompare(String(right?.time_of_day || ''));
}

function normalizeTime(value) {
  return ceilClockTimeToGrid(value);
}

function isIsoDate(value) {
  if (!value) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value).trim());
}

function normalizeDateForCompare(dateValue, fallback) {
  const normalized = normalizeString(dateValue);
  return normalized || fallback;
}

function rangesOverlap(startA, endA, startB, endB) {
  const normalizedStartA = normalizeDateForCompare(startA, '0001-01-01');
  const normalizedEndA = normalizeDateForCompare(endA, '9999-12-31');
  const normalizedStartB = normalizeDateForCompare(startB, '0001-01-01');
  const normalizedEndB = normalizeDateForCompare(endB, '9999-12-31');

  return normalizedStartA <= normalizedEndB && normalizedStartB <= normalizedEndA;
}

function timeRangesOverlap(startA, durationA, startB, durationB) {
  const startMinutesA = timeToMinutes(startA);
  const startMinutesB = timeToMinutes(startB);
  const safeDurationA = Number(durationA) || 0;
  const safeDurationB = Number(durationB) || 0;
  if (startMinutesA == null || startMinutesB == null || safeDurationA <= 0 || safeDurationB <= 0) {
    return false;
  }

  return startMinutesA < startMinutesB + safeDurationB && startMinutesB < startMinutesA + safeDurationA;
}

async function findExactTemplateConflict(client, orgId, {
  studentId,
  instructorEmployeeId,
  dayOfWeek,
  timeOfDay,
  validFrom,
  validUntil,
  excludeTemplateId = null,
}) {
  let query = withOrgScope(client, 'lesson_templates', orgId)
    .select('id, valid_from, valid_until')
    .eq('student_id', studentId)
    .eq('instructor_employee_id', instructorEmployeeId)
    .eq('day_of_week', dayOfWeek)
    .eq('time_of_day', timeOfDay)
    .eq('is_active', true);

  if (excludeTemplateId) {
    query = query.neq('id', excludeTemplateId);
  }

  const { data, error } = await query;
  if (error) {
    return { conflict: null, error };
  }

  const overlappingTemplate = (data || []).find((existing) =>
    rangesOverlap(existing.valid_from, existing.valid_until, validFrom, validUntil),
  );

  return { conflict: overlappingTemplate || null, error: null };
}

async function findInstructorSlotConflict(client, orgId, {
  instructorEmployeeId,
  serviceId,
  dayOfWeek,
  timeOfDay,
  durationMinutes,
  validFrom,
  validUntil,
  excludeTemplateId = null,
}) {
  let query = withOrgScope(client, 'lesson_templates', orgId)
    .select('id, service_id, time_of_day, duration_minutes, valid_from, valid_until')
    .eq('instructor_employee_id', instructorEmployeeId)
    .eq('day_of_week', dayOfWeek)
    .eq('is_active', true);

  if (excludeTemplateId) {
    query = query.neq('id', excludeTemplateId);
  }

  const { data, error } = await query;
  if (error) {
    return { conflict: null, error };
  }

  const overlappingTemplates = (data || []).filter((template) => (
    rangesOverlap(template.valid_from, template.valid_until, validFrom, validUntil)
    && timeRangesOverlap(template.time_of_day, template.duration_minutes, timeOfDay, durationMinutes)
  ));

  if (overlappingTemplates.length === 0) {
    return { conflict: null, error: null };
  }

  const sameGroupTemplates = overlappingTemplates.filter((template) => (
    template.service_id === serviceId
    && normalizeTime(template.time_of_day) === normalizeTime(timeOfDay)
    && Number(template.duration_minutes) === Number(durationMinutes)
  ));

  if (sameGroupTemplates.length !== overlappingTemplates.length) {
    return {
      conflict: {
        code: 'instructor_template_time_conflict',
        templates: overlappingTemplates,
      },
      error: null,
    };
  }

  const { data: capability, error: capabilityError } = await withOrgScope(client, 'instructor_service_capabilities', orgId)
    .select('max_students')
    .eq('employee_id', instructorEmployeeId)
    .eq('service_id', serviceId)
    .maybeSingle();

  if (capabilityError) {
    return { conflict: null, error: capabilityError };
  }

  const maxStudents = Number(capability?.max_students) || 1;
  if (sameGroupTemplates.length >= maxStudents) {
    return {
      conflict: {
        code: 'template_group_capacity_exceeded',
        templates: sameGroupTemplates,
        maxStudents,
      },
      error: null,
    };
  }

  return { conflict: null, error: null };
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
    fields.push('student:students(id, client_profile_id, client_profile:client_profiles(id, first_name, middle_name, last_name))');
  }
  return fields.join(',');
}

function normalizeTemplateStudent(student) {
  if (!student || typeof student !== 'object') {
    return student;
  }

  const profile = student.client_profile || null;
  return {
    id: student.id,
    client_profile_id: student.client_profile_id || profile?.id || null,
    first_name: profile?.first_name || '',
    middle_name: profile?.middle_name || null,
    last_name: profile?.last_name || '',
  };
}

function normalizeTemplateRecord(template) {
  if (!template || typeof template !== 'object') {
    return template;
  }

  return {
    ...template,
    student: normalizeTemplateStudent(template.student),
  };
}

function isDuplicateTemplateConstraintError(error) {
  const code = normalizeString(error?.code);
  if (code === '23P01' || code === '23505') {
    return true;
  }

  const text = [error?.message, error?.details, error?.hint]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return text.includes('lesson_templates_active_overlap') || text.includes('duplicate_template_conflict');
}

function computeSafeDeactivationUntil(existingTemplate, today) {
  let safeValidUntil = today;

  if (existingTemplate?.valid_until && existingTemplate.valid_until < safeValidUntil) {
    safeValidUntil = existingTemplate.valid_until;
  }

  if (existingTemplate?.valid_from && safeValidUntil < existingTemplate.valid_from) {
    safeValidUntil = existingTemplate.valid_from;
  }

  return safeValidUntil;
}

async function resolveInstructorEmployeeIdsForUser(client, orgId, userId) {
  const { data, error } = await withOrgScope(client, 'Employees', orgId)
    .select('id')
    .eq('user_id', userId);

  if (error) {
    return { ids: [], error };
  }

  return {
    ids: Array.isArray(data) ? data.map((row) => normalizeUuid(row?.id)).filter(Boolean) : [],
    error: null,
  };
}

async function loadServiceForTemplate(client, orgId, serviceId, { requireActive = false } = {}) {
  if (!serviceId) {
    return { service: null, error: null };
  }

  let query = withOrgScope(client, 'Services', orgId)
    .select('id, duration_minutes, is_active')
    .eq('id', serviceId);

  if (requireActive) {
    query = query.eq('is_active', true);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw error;
  }

  return { service: data || null, error: null };
}

function resolveServiceDurationMinutes(service) {
  const durationMinutes = Number(service?.duration_minutes);
  return Number.isFinite(durationMinutes) && durationMinutes > 0
    ? Math.round(durationMinutes)
    : 0;
}

async function validateInstructorServiceAvailability(client, orgId, {
  instructorEmployeeId,
  serviceId,
  dayOfWeek,
  timeOfDay,
  durationMinutes,
}) {
  const { data, error } = await withOrgScope(client, 'instructor_service_capabilities', orgId)
    .select('employee_id, service_id, availability_windows')
    .eq('employee_id', instructorEmployeeId)
    .eq('service_id', serviceId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    return { ok: false, code: 'missing_instructor_service_capability' };
  }

  if (!hasConfiguredAvailability(data.availability_windows)) {
    return { ok: false, code: 'missing_instructor_service_availability' };
  }

  if (!isWithinAvailabilityWindows({
    availabilityWindows: data.availability_windows,
    day: dayOfWeek,
    startTime: timeOfDay,
    durationMinutes,
  })) {
    return { ok: false, code: 'outside_instructor_service_availability' };
  }

  return { ok: true, code: null };
}

async function writeTenantAudit(context, client, params) {
  try {
    await logTenantAuditEvent(client, params);
  } catch (auditError) {
    context.log?.warn?.('lesson-templates failed to write tenant audit event', {
      message: auditError?.message,
      eventType: params?.eventType,
      resourceType: params?.resourceType,
      resourceId: params?.resourceId,
    });
  }
}

async function rollbackCreatedTemplate(context, client, orgId, templateId, details = {}) {
  const rollbackResult = await withOrgScope(client, 'lesson_templates', orgId)
    .delete()
    .eq('id', templateId);

  if (rollbackResult.error) {
    context.log?.error?.('lesson-templates failed to rollback created template', {
      message: rollbackResult.error.message,
      templateId,
      ...details,
    });
    return { ok: false, error: rollbackResult.error };
  }

  return { ok: true, error: null };
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
  const userEmail = normalizeString(authResult.data.user.email) || `missing-email-${userId}`;
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

      let query = withOrgScope(supabase, 'lesson_templates', orgId)
        .select(buildTemplateSelect({ includeStudent: true }));

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

      const rows = (Array.isArray(data) ? [...data] : []).map(normalizeTemplateRecord);
      rows.sort(compareTemplatesByDayAndTime);

      return respond(context, 200, rows);
    }

    // Mode 2: Student-scoped (existing behavior — student detail page)
    if (!isAdmin) {
      const {
        ids: instructorEmployeeIds,
        error: instructorLookupError,
      } = await resolveInstructorEmployeeIdsForUser(supabase, orgId, userId);

      if (instructorLookupError) {
        context.log?.error?.('lesson-templates failed to resolve instructor mapping', {
          message: instructorLookupError.message,
          userId,
        });
        return respond(context, 500, { message: 'failed_to_load_lesson_templates' });
      }

      if (instructorEmployeeIds.length === 0) {
        return respond(context, 403, { message: 'student_not_assigned_to_user' });
      }

      const { data: assignmentRows, error: assignmentError } = await withOrgScope(supabase, 'lesson_templates', orgId)
        .select('id')
        .eq('student_id', studentId)
        .in('instructor_employee_id', instructorEmployeeIds)
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

    const { data, error } = await withOrgScope(supabase, 'lesson_templates', orgId)
      .select(buildTemplateSelect())
      .eq('student_id', studentId)
      .order('is_active', { ascending: false })
      .order('valid_from', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) {
      context.log?.error?.('lesson-templates failed to load templates', { message: error.message, studentId });
      return respond(context, 500, { message: 'failed_to_load_lesson_templates' });
    }

    return respond(context, 200, (Array.isArray(data) ? data : []).map(normalizeTemplateRecord));
  }

  if (!isAdmin) {
    return respond(context, 403, { message: 'forbidden' });
  }

  if (method === 'POST') {
    const studentId = normalizeUuid(body?.student_id || body?.studentId);
    const clientProfileIdFromBody = normalizeUuid(body?.client_profile_id || body?.clientProfileId);
    const instructorEmployeeId = normalizeUuid(body?.instructor_employee_id || body?.instructorEmployeeId);
    const serviceId = normalizeUuid(body?.service_id || body?.serviceId);
    const waitingListEntryId = normalizeUuid(body?.waiting_list_entry_id || body?.waitingListEntryId);
    const dayOfWeek = normalizeDayOfWeek(body?.day_of_week ?? body?.dayOfWeek);
    const timeOfDay = normalizeTime(body?.time_of_day || body?.timeOfDay);
    const validFrom = normalizeString(body?.valid_from || body?.validFrom);
    const validUntil = normalizeString(body?.valid_until || body?.validUntil);

    if (!studentId && !clientProfileIdFromBody && !waitingListEntryId) {
      return respond(context, 400, { message: 'invalid_student_id' });
    }

    if (!instructorEmployeeId) {
      return respond(context, 400, { message: 'invalid_instructor_id' });
    }

    if (!serviceId) {
      return respond(context, 400, { message: 'invalid_service_id' });
    }

    let selectedService = null;
    try {
      const serviceLookup = await loadServiceForTemplate(supabase, orgId, serviceId, { requireActive: true });
      selectedService = serviceLookup.service;
      if (!selectedService) {
        return respond(context, 400, { message: 'invalid_service_id' });
      }
    } catch (serviceLookupError) {
      context.log?.error?.('lesson-templates failed to validate service on create', {
        message: serviceLookupError.message,
        serviceId,
      });
      return respond(context, 500, { message: 'failed_to_create_lesson_template' });
    }

    const durationMinutes = resolveServiceDurationMinutes(selectedService);

    if (dayOfWeek === null) {
      return respond(context, 400, { message: 'invalid_day_of_week' });
    }

    if (!timeOfDay) {
      return respond(context, 400, { message: 'invalid_time_of_day' });
    }

    if (durationMinutes <= 0) {
      return respond(context, 400, { message: 'invalid_service_duration' });
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

    try {
      const availabilityResult = await validateInstructorServiceAvailability(supabase, orgId, {
        instructorEmployeeId,
        serviceId,
        dayOfWeek,
        timeOfDay,
        durationMinutes,
      });
      if (!availabilityResult.ok) {
        return respond(context, 409, { message: availabilityResult.code });
      }
    } catch (availabilityError) {
      context.log?.error?.('lesson-templates failed to validate instructor service availability on create', {
        message: availabilityError.message,
        instructorEmployeeId,
        serviceId,
      });
      return respond(context, 500, { message: 'failed_to_create_lesson_template' });
    }

    let waitingListEntry = null;
    let clientProfileBeforeMatch = null;
    let studentCreated = false;
    let effectiveStudentId = studentId;
    let resolvedClientProfileId = clientProfileIdFromBody;
    if (waitingListEntryId) {
      const { data: waitingListData, error: waitingListError } = await withOrgScope(supabase, 'waiting_list_entries', orgId)
        .select('id, client_profile_id, student_id, desired_service_id, status, metadata')
        .eq('id', waitingListEntryId)
        .maybeSingle();

      if (waitingListError) {
        context.log?.error?.('lesson-templates failed to load waiting-list entry for create', {
          message: waitingListError.message,
          waitingListEntryId,
        });
        return respond(context, 500, { message: 'failed_to_create_lesson_template' });
      }

      if (!waitingListData) {
        return respond(context, 404, { message: 'waiting_list_entry_not_found' });
      }

      if (!['new', 'open'].includes(normalizeString(waitingListData.status).toLowerCase())) {
        return respond(context, 409, { message: 'waiting_list_entry_not_open' });
      }

      if (effectiveStudentId && waitingListData.student_id && waitingListData.student_id !== effectiveStudentId) {
        return respond(context, 400, { message: 'waiting_list_student_mismatch' });
      }

      if (waitingListData.desired_service_id !== serviceId) {
        return respond(context, 400, { message: 'waiting_list_service_mismatch' });
      }

      waitingListEntry = waitingListData;
      resolvedClientProfileId = waitingListData.client_profile_id || resolvedClientProfileId;

      if (resolvedClientProfileId) {
        const { data: clientProfileData, error: clientProfileError } = await withOrgScope(supabase, 'client_profiles', orgId)
          .select('id, first_name, middle_name, last_name, is_active, onboarding_status, metadata')
          .eq('id', resolvedClientProfileId)
          .maybeSingle();
        if (clientProfileError) {
          context.log?.error?.('lesson-templates failed to load client profile for waiting-list match', {
            message: clientProfileError.message,
            waitingListEntryId,
            clientProfileId: resolvedClientProfileId,
          });
          return respond(context, 500, { message: 'failed_to_create_lesson_template' });
        }
        clientProfileBeforeMatch = clientProfileData;
      }

      if (!effectiveStudentId && resolvedClientProfileId) {
        try {
          const ensuredStudent = await ensureStudentForClientProfile(supabase, resolvedClientProfileId);
          if (ensuredStudent.error || !ensuredStudent.student?.id) {
            return respond(context, 500, { message: 'failed_to_activate_student_from_waiting_list' });
          }
          effectiveStudentId = ensuredStudent.student.id;
          studentCreated = ensuredStudent.created === true;
        } catch (studentEnsureError) {
          context.log?.error?.('lesson-templates failed to convert client profile to student during waiting-list match', {
            message: studentEnsureError?.message,
            waitingListEntryId,
            clientProfileId: resolvedClientProfileId,
          });
          return respond(context, 500, { message: 'failed_to_activate_student_from_waiting_list' });
        }
      }

      const { data: studentData, error: studentError } = await withOrgScope(supabase, 'students', orgId)
        .select('id, client_profile_id')
        .eq('id', effectiveStudentId)
        .maybeSingle();

      if (studentError) {
        context.log?.error?.('lesson-templates failed to load student for waiting-list match', {
          message: studentError.message,
          studentId: effectiveStudentId,
          waitingListEntryId,
        });
        return respond(context, 500, { message: 'failed_to_create_lesson_template' });
      }

      if (!studentData) {
        return respond(context, 400, { message: 'invalid_student_id' });
      }

    } else if (!effectiveStudentId && resolvedClientProfileId) {
      try {
        const ensuredStudent = await ensureStudentForClientProfile(supabase, resolvedClientProfileId);
        if (ensuredStudent.error || !ensuredStudent.student?.id) {
          return respond(context, 500, { message: 'failed_to_create_lesson_template' });
        }
        effectiveStudentId = ensuredStudent.student.id;
        studentCreated = ensuredStudent.created === true;
      } catch (studentEnsureError) {
        context.log?.error?.('lesson-templates failed to ensure student overlay from client profile on create', {
          message: studentEnsureError?.message,
          clientProfileId: resolvedClientProfileId,
        });
        return respond(context, 500, { message: 'failed_to_create_lesson_template' });
      }
    }

    const { conflict, error: conflictCheckError } = await findExactTemplateConflict(supabase, orgId, {
      studentId: effectiveStudentId,
      instructorEmployeeId,
      dayOfWeek,
      timeOfDay,
      validFrom,
      validUntil,
    });

    if (conflictCheckError) {
      context.log?.error?.('lesson-templates failed to check duplicate conflict', {
        message: conflictCheckError.message,
        studentId: effectiveStudentId,
      });
      return respond(context, 500, { message: 'failed_to_create_lesson_template' });
    }

    if (conflict) {
      return respond(context, 409, {
        message: 'duplicate_template_conflict',
        conflicting_template_id: conflict.id,
      });
    }

    const { conflict: instructorSlotConflict, error: instructorSlotConflictError } = await findInstructorSlotConflict(supabase, orgId, {
      instructorEmployeeId,
      serviceId,
      dayOfWeek,
      timeOfDay,
      durationMinutes,
      validFrom,
      validUntil,
    });

    if (instructorSlotConflictError) {
      context.log?.error?.('lesson-templates failed to check instructor slot conflict on create', {
        message: instructorSlotConflictError.message,
        instructorEmployeeId,
        serviceId,
      });
      return respond(context, 500, { message: 'failed_to_create_lesson_template' });
    }

    if (instructorSlotConflict) {
      return respond(context, 409, {
        message: instructorSlotConflict.code,
        conflicting_template_ids: (instructorSlotConflict.templates || []).map((template) => template.id).filter(Boolean),
        max_students: instructorSlotConflict.maxStudents || null,
      });
    }

    const { data, error } = await withOrgScope(supabase, 'lesson_templates', orgId)
      .insert({
        student_id: effectiveStudentId,
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
      if (isDuplicateTemplateConstraintError(error)) {
        return respond(context, 409, {
          message: 'duplicate_template_conflict',
        });
      }

      context.log?.error?.('lesson-templates failed to create template', { message: error.message, studentId: effectiveStudentId });
      return respond(context, 500, { message: 'failed_to_create_lesson_template' });
    }

    let studentAfterActivation = null;
    let studentReactivated = false;

    if (waitingListEntry && clientProfileBeforeMatch?.is_active === false) {
      const activationTimestamp = new Date().toISOString();
      const activationMetadata = clientProfileBeforeMatch?.metadata && typeof clientProfileBeforeMatch.metadata === 'object'
        ? clientProfileBeforeMatch.metadata
        : {};
      const activationPayload = {
        is_active: true,
        metadata: {
          ...activationMetadata,
          reactivated_from_waiting_list_entry_id: waitingListEntry.id,
          reactivated_from_template_id: data.id,
          reactivated_at: activationTimestamp,
          reactivated_by_user_id: userId,
        },
      };

      if (normalizeString(clientProfileBeforeMatch.onboarding_status) === 'pending_forms') {
        activationPayload.onboarding_status = 'approved';
      }

      const { data: activatedStudent, error: activationError } = await withOrgScope(supabase, 'client_profiles', orgId)
        .update(activationPayload)
        .eq('id', resolvedClientProfileId)
        .select('id, first_name, middle_name, last_name, is_active, onboarding_status, metadata')
        .single();

      if (activationError) {
        context.log?.error?.('lesson-templates failed to activate student during waiting-list match', {
          message: activationError.message,
          waitingListEntryId: waitingListEntry.id,
          templateId: data.id,
          clientProfileId: resolvedClientProfileId,
        });

        const rollbackTemplateResult = await rollbackCreatedTemplate(context, supabase, orgId, data.id, {
          waitingListEntryId: waitingListEntry.id,
          clientProfileId: resolvedClientProfileId,
          reason: 'student_activation_failed',
        });

        return respond(
          context,
          500,
          { message: rollbackTemplateResult.ok ? 'failed_to_activate_student_from_waiting_list' : 'failed_to_finalize_waiting_list_match' },
        );
      }

      studentAfterActivation = activatedStudent;
      studentReactivated = true;
    }

    if (waitingListEntry) {
      const matchTimestamp = new Date().toISOString();
      const existingMetadata = waitingListEntry?.metadata && typeof waitingListEntry.metadata === 'object'
        ? waitingListEntry.metadata
        : {};
      const nextMetadata = {
        ...existingMetadata,
        matched_template_id: data.id,
        matched_at: matchTimestamp,
        matched_by_user_id: userId,
      };

      const { data: matchedEntry, error: waitingListUpdateError } = await withOrgScope(supabase, 'waiting_list_entries', orgId)
        .update({
          status: 'matched',
          metadata: nextMetadata,
        })
        .eq('id', waitingListEntry.id)
        .select('id, student_id, desired_service_id, status, metadata')
        .single();

      if (waitingListUpdateError) {
        context.log?.error?.('lesson-templates failed to mark waiting-list entry as matched', {
          message: waitingListUpdateError.message,
          waitingListEntryId: waitingListEntry.id,
          templateId: data.id,
        });

        const rollbackTemplateResult = await rollbackCreatedTemplate(context, supabase, orgId, data.id, {
          waitingListEntryId: waitingListEntry.id,
          studentId: effectiveStudentId,
          reason: 'waiting_list_update_failed',
        });
        let rollbackStudentOk = true;

        if (studentReactivated && clientProfileBeforeMatch) {
          const { error: rollbackStudentError } = await withOrgScope(supabase, 'client_profiles', orgId)
            .update({
              is_active: clientProfileBeforeMatch?.is_active,
              onboarding_status: clientProfileBeforeMatch?.onboarding_status,
              metadata: clientProfileBeforeMatch?.metadata || null,
            })
            .eq('id', resolvedClientProfileId);

          if (rollbackStudentError) {
            rollbackStudentOk = false;
            context.log?.error?.('lesson-templates failed to rollback student activation after waiting-list update failure', {
              message: rollbackStudentError.message,
              waitingListEntryId: waitingListEntry.id,
              templateId: data.id,
              clientProfileId: resolvedClientProfileId,
            });
          }
        }

        return respond(
          context,
          500,
          { message: rollbackTemplateResult.ok && rollbackStudentOk ? 'failed_to_link_waiting_list_entry' : 'failed_to_finalize_waiting_list_match' },
        );
      }

      if (studentReactivated && studentAfterActivation) {
        await writeTenantAudit(context, supabase, {
          actorUserId: userId,
          eventType: 'student.reactivated_from_waiting_list_match',
          retentionCategory: TENANT_AUDIT_RETENTION.STANDARD,
          resourceType: 'client_profile',
          resourceId: studentAfterActivation.id,
          beforeState: clientProfileBeforeMatch,
          afterState: studentAfterActivation,
          details: {
            origin: 'api/lesson-templates',
            waiting_list_entry_id: waitingListEntry.id,
            lesson_template_id: data.id,
          },
        });
      }

      await writeTenantAudit(context, supabase, {
        actorUserId: userId,
        eventType: 'waiting_list.entry.matched',
        retentionCategory: TENANT_AUDIT_RETENTION.STANDARD,
        resourceType: 'waiting_list_entry',
        resourceId: matchedEntry.id,
        beforeState: waitingListEntry,
        afterState: matchedEntry,
        details: {
          origin: 'api/lesson-templates',
          lesson_template_id: data.id,
        },
      });
    }

    try {
      await logAuditEvent(supabase, {
        orgId,
        userId,
        userEmail,
        userRole: role,
        actionType: AUDIT_ACTIONS.TEMPLATE_CREATED,
        actionCategory: AUDIT_CATEGORIES.CALENDAR,
        resourceType: 'lesson_template',
        resourceId: data.id,
        details: {
          student_id: data.student_id,
          instructor_employee_id: data.instructor_employee_id,
          service_id: data.service_id,
          day_of_week: data.day_of_week,
          time_of_day: data.time_of_day,
          valid_from: data.valid_from,
          valid_until: data.valid_until,
          duration_minutes: data.duration_minutes,
          waiting_list_entry_id: waitingListEntryId || null,
        },
      });
    } catch (auditError) {
      context.log?.error?.('lesson-templates failed to write audit event (create)', {
        message: auditError?.message,
        templateId: data?.id,
      });
    }

    return respond(context, 201, {
      ...normalizeTemplateRecord(data),
      waiting_list_match: waitingListEntry
        ? {
            waiting_list_entry_id: waitingListEntry.id,
            student_created: studentCreated,
            student_reactivated: studentReactivated,
          }
        : null,
    });
  }

  if (method === 'PUT') {
    const templateId = normalizeUuid(
      context?.bindingData?.templateId || body?.template_id || body?.templateId,
    );
    if (!templateId) {
      return respond(context, 400, { message: 'invalid_template_id' });
    }

    const { data: existingTemplate, error: existingTemplateError } = await withOrgScope(supabase, 'lesson_templates', orgId)
      .select('id, student_id, instructor_employee_id, service_id, day_of_week, time_of_day, duration_minutes, valid_from, valid_until, is_active')
      .eq('id', templateId)
      .maybeSingle();

    if (existingTemplateError) {
      context.log?.error?.('lesson-templates failed to load existing template for update', {
        message: existingTemplateError.message,
        templateId,
      });
      return respond(context, 500, { message: 'failed_to_update_lesson_template' });
    }

    if (!existingTemplate) {
      return respond(context, 404, { message: 'lesson_template_not_found' });
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
      const serviceId = normalizeUuid(body?.service_id || body?.serviceId);
      if (!serviceId) {
        return respond(context, 400, { message: 'invalid_service_id' });
      }

      try {
        const serviceLookup = await loadServiceForTemplate(supabase, orgId, serviceId, { requireActive: true });
        if (!serviceLookup.service) {
          return respond(context, 400, { message: 'invalid_service_id' });
        }
      } catch (serviceLookupError) {
        context.log?.error?.('lesson-templates failed to validate service on update', {
          message: serviceLookupError.message,
          serviceId,
          templateId,
        });
        return respond(context, 500, { message: 'failed_to_update_lesson_template' });
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

    const effectiveServiceId = updates.service_id ?? existingTemplate.service_id;
    let effectiveService = null;
    try {
      const serviceLookup = await loadServiceForTemplate(supabase, orgId, effectiveServiceId, {
        requireActive: Object.prototype.hasOwnProperty.call(updates, 'service_id'),
      });
      effectiveService = serviceLookup.service;
      if (!effectiveService) {
        return respond(context, 400, { message: 'invalid_service_id' });
      }
    } catch (serviceLookupError) {
      context.log?.error?.('lesson-templates failed to load effective service on update', {
        message: serviceLookupError.message,
        serviceId: effectiveServiceId,
        templateId,
      });
      return respond(context, 500, { message: 'failed_to_update_lesson_template' });
    }

    const effectiveDurationMinutes = resolveServiceDurationMinutes(effectiveService);
    if (effectiveDurationMinutes <= 0) {
      return respond(context, 400, { message: 'invalid_service_duration' });
    }
    if (Number(existingTemplate.duration_minutes) !== effectiveDurationMinutes) {
      updates.duration_minutes = effectiveDurationMinutes;
    }

    const nextTemplateState = {
      student_id: updates.student_id ?? existingTemplate.student_id,
      instructor_employee_id: updates.instructor_employee_id ?? existingTemplate.instructor_employee_id,
      service_id: effectiveServiceId,
      duration_minutes: effectiveDurationMinutes,
      day_of_week: updates.day_of_week ?? existingTemplate.day_of_week,
      time_of_day: updates.time_of_day ?? existingTemplate.time_of_day,
      valid_from: updates.valid_from ?? existingTemplate.valid_from,
      valid_until: Object.prototype.hasOwnProperty.call(updates, 'valid_until')
        ? updates.valid_until
        : existingTemplate.valid_until,
      is_active: Object.prototype.hasOwnProperty.call(updates, 'is_active')
        ? updates.is_active
        : existingTemplate.is_active,
    };

    if (nextTemplateState.valid_until && nextTemplateState.valid_until < nextTemplateState.valid_from) {
      return respond(context, 400, { message: 'invalid_valid_until' });
    }

    try {
      const availabilityResult = await validateInstructorServiceAvailability(supabase, orgId, {
        instructorEmployeeId: nextTemplateState.instructor_employee_id,
        serviceId: nextTemplateState.service_id,
        dayOfWeek: nextTemplateState.day_of_week,
        timeOfDay: nextTemplateState.time_of_day,
        durationMinutes: nextTemplateState.duration_minutes,
      });
      if (!availabilityResult.ok) {
        return respond(context, 409, { message: availabilityResult.code });
      }
    } catch (availabilityError) {
      context.log?.error?.('lesson-templates failed to validate instructor service availability on update', {
        message: availabilityError.message,
        templateId,
      });
      return respond(context, 500, { message: 'failed_to_update_lesson_template' });
    }

    const isReactivating = !existingTemplate.is_active && nextTemplateState.is_active;
    if (isReactivating) {
      const hasValidFromUpdate = Object.prototype.hasOwnProperty.call(updates, 'valid_from');
      const hasValidUntilUpdate = Object.prototype.hasOwnProperty.call(updates, 'valid_until');
      const rangeChanged = (
        (hasValidFromUpdate && updates.valid_from !== existingTemplate.valid_from)
        || (hasValidUntilUpdate && updates.valid_until !== existingTemplate.valid_until)
      );

      // Prevent accidental re-activation with stale dates.
      if (!hasValidFromUpdate || !rangeChanged) {
        return respond(context, 400, { message: 'reactivation_requires_new_valid_range' });
      }
    }

    if (nextTemplateState.is_active) {
      const { conflict, error: conflictCheckError } = await findExactTemplateConflict(supabase, orgId, {
        studentId: nextTemplateState.student_id,
        instructorEmployeeId: nextTemplateState.instructor_employee_id,
        dayOfWeek: nextTemplateState.day_of_week,
        timeOfDay: nextTemplateState.time_of_day,
        validFrom: nextTemplateState.valid_from,
        validUntil: nextTemplateState.valid_until,
        excludeTemplateId: templateId,
      });

      if (conflictCheckError) {
        context.log?.error?.('lesson-templates failed to check duplicate conflict on update', {
          message: conflictCheckError.message,
          templateId,
        });
        return respond(context, 500, { message: 'failed_to_update_lesson_template' });
      }

      if (conflict) {
        return respond(context, 409, {
          message: 'duplicate_template_conflict',
          conflicting_template_id: conflict.id,
        });
      }

      const { conflict: instructorSlotConflict, error: instructorSlotConflictError } = await findInstructorSlotConflict(supabase, orgId, {
        instructorEmployeeId: nextTemplateState.instructor_employee_id,
        serviceId: nextTemplateState.service_id,
        dayOfWeek: nextTemplateState.day_of_week,
        timeOfDay: nextTemplateState.time_of_day,
        durationMinutes: nextTemplateState.duration_minutes,
        validFrom: nextTemplateState.valid_from,
        validUntil: nextTemplateState.valid_until,
        excludeTemplateId: templateId,
      });

      if (instructorSlotConflictError) {
        context.log?.error?.('lesson-templates failed to check instructor slot conflict on update', {
          message: instructorSlotConflictError.message,
          templateId,
        });
        return respond(context, 500, { message: 'failed_to_update_lesson_template' });
      }

      if (instructorSlotConflict) {
        return respond(context, 409, {
          message: instructorSlotConflict.code,
          conflicting_template_ids: (instructorSlotConflict.templates || []).map((template) => template.id).filter(Boolean),
          max_students: instructorSlotConflict.maxStudents || null,
        });
      }
    }

    updates.updated_at = new Date().toISOString();

    const { data, error } = await withOrgScope(supabase, 'lesson_templates', orgId)
      .update(updates)
      .eq('id', templateId)
      .select(buildTemplateSelect())
      .maybeSingle();

    if (error) {
      if (isDuplicateTemplateConstraintError(error)) {
        return respond(context, 409, {
          message: 'duplicate_template_conflict',
        });
      }

      context.log?.error?.('lesson-templates failed to update template', { message: error.message, templateId });
      return respond(context, 500, { message: 'failed_to_update_lesson_template' });
    }

    if (!data) {
      return respond(context, 404, { message: 'lesson_template_not_found' });
    }

    const actionType = !existingTemplate.is_active && data.is_active
      ? AUDIT_ACTIONS.TEMPLATE_REACTIVATED
      : existingTemplate.is_active && !data.is_active
        ? AUDIT_ACTIONS.TEMPLATE_DEACTIVATED
        : AUDIT_ACTIONS.TEMPLATE_UPDATED;

    try {
      await logAuditEvent(supabase, {
        orgId,
        userId,
        userEmail,
        userRole: role,
        actionType,
        actionCategory: AUDIT_CATEGORIES.CALENDAR,
        resourceType: 'lesson_template',
        resourceId: data.id,
        details: {
          before: {
            student_id: existingTemplate.student_id,
            instructor_employee_id: existingTemplate.instructor_employee_id,
            day_of_week: existingTemplate.day_of_week,
            time_of_day: existingTemplate.time_of_day,
            valid_from: existingTemplate.valid_from,
            valid_until: existingTemplate.valid_until,
            is_active: existingTemplate.is_active,
          },
          updates,
          after: {
            student_id: data.student_id,
            instructor_employee_id: data.instructor_employee_id,
            day_of_week: data.day_of_week,
            time_of_day: data.time_of_day,
            valid_from: data.valid_from,
            valid_until: data.valid_until,
            is_active: data.is_active,
          },
        },
      });
    } catch (auditError) {
      context.log?.error?.('lesson-templates failed to write audit event (update)', {
        message: auditError?.message,
        templateId: data?.id,
      });
    }

    return respond(context, 200, normalizeTemplateRecord(data));
  }

  if (method === 'DELETE') {
    const templateId = normalizeUuid(
      context?.bindingData?.templateId || body?.template_id || body?.templateId,
    );
    if (!templateId) {
      return respond(context, 400, { message: 'invalid_template_id' });
    }

    const today = new Date().toISOString().split('T')[0];

    const { data: existingTemplate, error: loadTemplateError } = await withOrgScope(supabase, 'lesson_templates', orgId)
      .select('id, student_id, instructor_employee_id, day_of_week, time_of_day, valid_from, valid_until, is_active')
      .eq('id', templateId)
      .maybeSingle();

    if (loadTemplateError) {
      context.log?.error?.('lesson-templates failed to load template for deactivation', {
        message: loadTemplateError.message,
        templateId,
      });
      return respond(context, 500, { message: 'failed_to_deactivate_lesson_template' });
    }

    if (!existingTemplate) {
      return respond(context, 404, { message: 'lesson_template_not_found' });
    }

    const safeValidUntil = computeSafeDeactivationUntil(existingTemplate, today);

    const { data, error } = await withOrgScope(supabase, 'lesson_templates', orgId)
      .update({ is_active: false, valid_until: safeValidUntil, updated_at: new Date().toISOString() })
      .eq('id', templateId)
      .select('id, student_id, instructor_employee_id, day_of_week, time_of_day, valid_from, valid_until, is_active')
      .maybeSingle();

    if (error) {
      context.log?.error?.('lesson-templates failed to deactivate template', { message: error.message, templateId });
      return respond(context, 500, { message: 'failed_to_deactivate_lesson_template' });
    }

    if (!data) {
      return respond(context, 500, { message: 'failed_to_deactivate_lesson_template' });
    }

    try {
      await logAuditEvent(supabase, {
        orgId,
        userId,
        userEmail,
        userRole: role,
        actionType: AUDIT_ACTIONS.TEMPLATE_DEACTIVATED,
        actionCategory: AUDIT_CATEGORIES.CALENDAR,
        resourceType: 'lesson_template',
        resourceId: data.id,
        details: {
          before: {
            valid_from: existingTemplate.valid_from,
            valid_until: existingTemplate.valid_until,
            is_active: existingTemplate.is_active,
          },
          after: {
            valid_from: data.valid_from,
            valid_until: data.valid_until,
            is_active: data.is_active,
          },
          deactivated_on: today,
        },
      });
    } catch (auditError) {
      context.log?.error?.('lesson-templates failed to write audit event (deactivate)', {
        message: auditError?.message,
        templateId: data?.id,
      });
    }

    return respond(context, 200, { message: 'template_deactivated', id: data.id });
  }

  return respond(context, 405, { message: 'method_not_allowed' });
}
