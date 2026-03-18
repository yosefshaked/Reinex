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
import { logAuditEvent, AUDIT_ACTIONS, AUDIT_CATEGORIES } from '../_shared/audit-log.js';
import { normalizeDayToken, daySortValue } from '../_shared/day-of-week.js';
import {
  coerceBooleanFlag,
  coerceIdentityNumber,
  coerceOptionalText,
  coerceTags,
  coerceEmail,
  validateIsraeliPhone,
  coerceOptionalDate,
  coerceNotificationMethod,
  coerceOptionalNumeric,
  coerceOptionalJsonb,
  coerceOnboardingStatus,
} from '../_shared/student-validation.js';

function extractStudentId(context, req, body) {
  const candidate =
    normalizeString(context?.bindingData?.studentId) ||
    normalizeString(body?.student_id) ||
    normalizeString(body?.studentId);

  if (candidate && UUID_PATTERN.test(candidate)) {
    return candidate;
  }
  return '';
}

async function findStudentByIdentityNumber(tenantClient, identityNumber, { excludeId } = {}) {
  if (!identityNumber) {
    return { data: null, error: null };
  }

  let query = tenantClient
    .from('students')
    .select('id, first_name, last_name, is_active, identity_number')
    .eq('identity_number', identityNumber)
    .limit(1);

  if (excludeId) {
    query = query.neq('id', excludeId);
  }

  const { data, error } = await query.maybeSingle();
  return { data, error };
}

async function fetchStudentIdsByInstructor(tenantClient, instructorEmployeeId) {
  if (!instructorEmployeeId) {
    return { studentIds: [], error: null };
  }

  const { data, error } = await tenantClient
    .from('lesson_templates')
    .select('student_id')
    .eq('instructor_employee_id', instructorEmployeeId)
    .eq('is_active', true);

  if (error) {
    return { studentIds: [], error };
  }

  const studentIds = Array.from(
    new Set((data || []).map((row) => row.student_id).filter(Boolean)),
  );

  return { studentIds, error: null };
}

/**
 * Fetch the primary guardian for a student by joining student_guardians → guardians.
 * Returns { guardian: {...} | null, error }.
 */
async function fetchPrimaryGuardian(tenantClient, studentId) {
  if (!studentId) return { guardian: null, error: null };

  const { data, error } = await tenantClient
    .from('student_guardians')
    .select('guardian_id, relationship, is_primary')
    .eq('student_id', studentId)
    .order('is_primary', { ascending: false })
    .limit(1);

  if (error) return { guardian: null, error };
  if (!data || !data.length) return { guardian: null, error: null };

  const link = data[0];
  const { data: guardianRow, error: guardianError } = await tenantClient
    .from('guardians')
    .select('id, first_name, middle_name, last_name, phone, email')
    .eq('id', link.guardian_id)
    .maybeSingle();

  if (guardianError) return { guardian: null, error: guardianError };
  if (!guardianRow) return { guardian: null, error: null };

  return {
    guardian: {
      id: guardianRow.id,
      first_name: guardianRow.first_name,
      middle_name: guardianRow.middle_name || null,
      last_name: guardianRow.last_name,
      phone: guardianRow.phone || null,
      email: guardianRow.email || null,
      relationship: link.relationship,
      is_primary: link.is_primary ?? true,
    },
    error: null,
  };
}

function parseTimeToMinutes(value) {
  if (!value) {
    return Number.POSITIVE_INFINITY;
  }

  const parts = String(value).split(':');
  if (parts.length < 2) {
    return Number.POSITIVE_INFINITY;
  }

  const hours = Number.parseInt(parts[0], 10);
  const minutes = Number.parseInt(parts[1], 10);

  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) {
    return Number.POSITIVE_INFINITY;
  }

  return (hours * 60) + minutes;
}

function compareNameParts(left, right) {
  const leftName = [left?.first_name, left?.middle_name, left?.last_name]
    .map((value) => normalizeString(value))
    .filter(Boolean)
    .join(' ');
  const rightName = [right?.first_name, right?.middle_name, right?.last_name]
    .map((value) => normalizeString(value))
    .filter(Boolean)
    .join(' ');

  return leftName.localeCompare(rightName, 'he');
}

function compareScheduleEntries(left, right) {
  const safeLeftDay = daySortValue(left?.default_day_of_week);
  const safeRightDay = daySortValue(right?.default_day_of_week);

  if (safeLeftDay !== safeRightDay) {
    return safeLeftDay - safeRightDay;
  }

  const leftTime = parseTimeToMinutes(left?.default_session_time);
  const rightTime = parseTimeToMinutes(right?.default_session_time);

  if (leftTime !== rightTime) {
    return leftTime - rightTime;
  }

  return compareNameParts(left, right);
}

function compareTemplateSchedule(left, right) {
  const dayDiff = daySortValue(left?.day_of_week) - daySortValue(right?.day_of_week);
  if (dayDiff !== 0) {
    return dayDiff;
  }

  return parseTimeToMinutes(left?.time_of_day) - parseTimeToMinutes(right?.time_of_day);
}

function choosePrimarySchedule(currentValue, candidateValue) {
  if (!currentValue) {
    return candidateValue;
  }

  return compareScheduleEntries(candidateValue, currentValue) < 0 ? candidateValue : currentValue;
}

async function fetchPrimarySchedulesByStudentIds(tenantClient, studentIds) {
  if (!Array.isArray(studentIds) || studentIds.length === 0) {
    return { data: new Map(), error: null };
  }

  const { data, error } = await tenantClient
    .from('lesson_templates')
    .select('student_id, day_of_week, time_of_day')
    .in('student_id', studentIds)
    .eq('is_active', true);

  if (error) {
    return { data: new Map(), error };
  }

  const schedules = new Map();
  for (const row of data || []) {
    const studentId = normalizeString(row?.student_id);
    if (!studentId) {
      continue;
    }

    const normalizedDay = normalizeDayToken(row?.day_of_week);
    const candidate = {
      default_day_of_week: normalizedDay,
      default_session_time: row?.time_of_day ?? null,
      active_template_count: 1,
      has_multiple_templates: false,
      templates: [
        {
          day_of_week: normalizedDay,
          time_of_day: row?.time_of_day ?? null,
        },
      ],
    };

    const existing = schedules.get(studentId);
    if (!existing) {
      schedules.set(studentId, candidate);
      continue;
    }

    const mergedCount = (existing.active_template_count || 1) + 1;
    const primary = choosePrimarySchedule(existing, candidate);

    schedules.set(studentId, {
      ...primary,
      active_template_count: mergedCount,
      has_multiple_templates: mergedCount > 1,
      templates: [
        ...(Array.isArray(existing.templates) ? existing.templates : []),
        ...(Array.isArray(candidate.templates) ? candidate.templates : []),
      ],
    });
  }

  return { data: schedules, error: null };
}

function mergeStudentSchedules(students, scheduleMap) {
  return (students || []).map((student) => {
    const derivedSchedule = scheduleMap.get(student.id);

    if (!derivedSchedule) {
      return {
        ...student,
        default_day_of_week: normalizeDayToken(student.default_day_of_week),
        active_template_count: 0,
        has_multiple_templates: false,
        additional_templates: [],
      };
    }

    const allTemplates = Array.isArray(derivedSchedule.templates)
      ? [...derivedSchedule.templates].sort(compareTemplateSchedule)
      : [];
    const primaryTemplateKey = `${derivedSchedule.default_day_of_week || ''}|${derivedSchedule.default_session_time || ''}`;
    let skippedPrimary = false;
    const additionalTemplates = allTemplates.filter((template) => {
      const key = `${template?.day_of_week || ''}|${template?.time_of_day || ''}`;
      if (!skippedPrimary && key === primaryTemplateKey) {
        skippedPrimary = true;
        return false;
      }
      return true;
    });

    return {
      ...student,
      // lesson_templates is the source of truth for schedule in Reinex.
      default_day_of_week: derivedSchedule.default_day_of_week,
      default_session_time: derivedSchedule.default_session_time,
      active_template_count: derivedSchedule.active_template_count || 1,
      has_multiple_templates: Boolean(derivedSchedule.has_multiple_templates),
      additional_templates: additionalTemplates,
    };
  });
}

// Removed splitFullName - users now provide first_name, middle_name, last_name directly

function buildStudentPayload(body) {
  const firstName = normalizeString(body?.first_name ?? body?.firstName);
  const middleName = normalizeString(body?.middle_name ?? body?.middleName);
  const lastName = normalizeString(body?.last_name ?? body?.lastName);

  if (!firstName) {
    return { error: 'missing_first_name' };
  }
  if (!lastName) {
    return { error: 'missing_last_name' };
  }

  // Guardian ID (Optional) - Note: Using many-to-many relationship via student_guardians table
  const guardianId = body?.guardian_id ?? body?.guardianId ?? null;
  const guardianRelationshipRaw = body?.guardian_relationship ?? body?.guardianRelationship ?? null;
  if (guardianId && typeof guardianId !== 'string') {
    return { error: 'invalid_guardian_id' };
  }
  if (guardianId && !UUID_PATTERN.test(guardianId)) {
    return { error: 'invalid_guardian_id' };
  }

  let guardianRelationship = null;
  if (guardianId) {
    if (typeof guardianRelationshipRaw !== 'string') {
      return { error: 'guardian_relationship_required' };
    }
    const trimmed = guardianRelationshipRaw.trim();
    const allowedRelationships = new Set(['father', 'mother', 'self', 'caretaker', 'other']);
    if (!allowedRelationships.has(trimmed)) {
      return { error: 'invalid_guardian_relationship' };
    }
    guardianRelationship = trimmed;
  }

  // Phone validation: required if no guardian
  const phoneResult = validateIsraeliPhone(body?.phone);
  if (!guardianId && !phoneResult.value) {
    return { error: 'phone_required_without_guardian' };
  }
  if (!phoneResult.valid) {
    return { error: 'invalid_phone' };
  }

  const emailResult = coerceEmail(body?.email);
  if (!emailResult.valid) {
    return { error: 'invalid_email' };
  }

  const identityCandidate = body?.identity_number ?? body?.identityNumber ?? body?.national_id ?? body?.nationalId;
  const identityNumberResult = coerceIdentityNumber(identityCandidate);
  if (!identityNumberResult.valid) {
    return { error: 'invalid_identity_number' };
  }
  if (!identityNumberResult.value) {
    return { error: 'missing_identity_number' };
  }

  // New Reinex fields
  const dateOfBirthResult = coerceOptionalDate(body?.date_of_birth ?? body?.dateOfBirth);
  if (!dateOfBirthResult.valid) {
    return { error: 'invalid_date_of_birth' };
  }

  const notificationMethodResult = coerceNotificationMethod(body?.default_notification_method ?? body?.notificationMethod);
  if (!notificationMethodResult.valid) {
    return { error: 'invalid_notification_method' };
  }

  const specialRateResult = coerceOptionalNumeric(body?.special_rate ?? body?.specialRate);
  if (!specialRateResult.valid) {
    return { error: 'invalid_special_rate' };
  }

  const medicalFlagsResult = coerceOptionalJsonb(body?.medical_flags ?? body?.medicalFlags);
  if (!medicalFlagsResult.valid) {
    return { error: 'invalid_medical_flags' };
  }

  const onboardingStatusResult = coerceOnboardingStatus(body?.onboarding_status ?? body?.onboardingStatus);
  if (!onboardingStatusResult.valid) {
    return { error: 'invalid_onboarding_status' };
  }

  const notesInternalResult = coerceOptionalText(body?.notes_internal ?? body?.notesInternal);
  if (!notesInternalResult.valid) {
    return { error: 'invalid_notes_internal' };
  }

  const medicalProviderResult = coerceOptionalText(body?.medical_provider ?? body?.medicalProvider);
  if (!medicalProviderResult.valid) {
    return { error: 'invalid_medical_provider' };
  }

  const tagsResult = coerceTags(body?.tags);
  if (!tagsResult.valid) {
    return { error: 'invalid_tags' };
  }

  const isActiveResult = coerceBooleanFlag(body?.is_active ?? body?.isActive, { defaultValue: true });
  if (!isActiveResult.valid) {
    return { error: 'invalid_is_active' };
  }
  const isActiveValue = isActiveResult.provided ? Boolean(isActiveResult.value) : true;

  return {
    payload: {
      first_name: firstName,
      middle_name: middleName || null,
      last_name: lastName,
      identity_number: identityNumberResult.value,
      date_of_birth: dateOfBirthResult.value,
      phone: phoneResult.value,
      email: emailResult.value,
      medical_provider: medicalProviderResult.value,
      default_notification_method: notificationMethodResult.value,
      special_rate: specialRateResult.value,
      medical_flags: medicalFlagsResult.value,
      tags: tagsResult.value,
      onboarding_status: onboardingStatusResult.value,
      notes_internal: notesInternalResult.value,
      is_active: isActiveValue,
    },
    guardianId: guardianId, // Return separately for student_guardians insertion
    guardianRelationship: guardianRelationship,
  };
}

function buildStudentUpdates(body) {
  const updates = {};
  let hasAny = false;
  let intakeNotes;

  if (Object.prototype.hasOwnProperty.call(body, 'first_name') || Object.prototype.hasOwnProperty.call(body, 'firstName')) {
    const firstName = normalizeString(body.first_name ?? body.firstName);
    if (!firstName) {
      return { error: 'invalid_first_name' };
    }
    updates['first_name'] = firstName;
    hasAny = true;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'middle_name') || Object.prototype.hasOwnProperty.call(body, 'middleName')) {
    const middleName = normalizeString(body.middle_name ?? body.middleName);
    updates['middle_name'] = middleName || null;
    hasAny = true;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'last_name') || Object.prototype.hasOwnProperty.call(body, 'lastName')) {
    const lastName = normalizeString(body.last_name ?? body.lastName);
    if (!lastName) {
      return { error: 'invalid_last_name' };
    }
    updates['last_name'] = lastName;
    hasAny = true;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'contact_name') || Object.prototype.hasOwnProperty.call(body, 'contactName')) {
    // DEPRECATED: contact_name removed in Reinex - use guardians table instead
    void 0; // No logging in helper function - warn in handler if needed
  }

  if (Object.prototype.hasOwnProperty.call(body, 'contact_phone') || Object.prototype.hasOwnProperty.call(body, 'contactPhone')) {
    // DEPRECATED: contact_phone removed in Reinex - use guardians table instead
    void 0; // No logging in helper function - warn in handler if needed
  }

  if (Object.prototype.hasOwnProperty.call(body, 'phone')) {
    const { value, valid } = validateIsraeliPhone(body.phone);
    if (!valid) {
      return { error: 'invalid_phone' };
    }
    updates.phone = value;
    hasAny = true;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'email')) {
    const { value, valid } = coerceEmail(body.email);
    if (!valid) {
      return { error: 'invalid_email' };
    }
    updates.email = value;
    hasAny = true;
  }

  // Date of birth
  if (Object.prototype.hasOwnProperty.call(body, 'date_of_birth') || Object.prototype.hasOwnProperty.call(body, 'dateOfBirth')) {
    const { value, valid } = coerceOptionalDate(
      Object.prototype.hasOwnProperty.call(body, 'date_of_birth') ? body.date_of_birth : body.dateOfBirth
    );
    if (!valid) {
      return { error: 'invalid_date_of_birth' };
    }
    updates.date_of_birth = value;
    hasAny = true;
  }

  // Notification method
  if (Object.prototype.hasOwnProperty.call(body, 'default_notification_method') || Object.prototype.hasOwnProperty.call(body, 'notificationMethod')) {
    const { value, valid } = coerceNotificationMethod(
      Object.prototype.hasOwnProperty.call(body, 'default_notification_method') ? body.default_notification_method : body.notificationMethod
    );
    if (!valid) {
      return { error: 'invalid_notification_method' };
    }
    updates.default_notification_method = value;
    hasAny = true;
  }

  // Special rate
  if (Object.prototype.hasOwnProperty.call(body, 'special_rate') || Object.prototype.hasOwnProperty.call(body, 'specialRate')) {
    const { value, valid } = coerceOptionalNumeric(
      Object.prototype.hasOwnProperty.call(body, 'special_rate') ? body.special_rate : body.specialRate
    );
    if (!valid) {
      return { error: 'invalid_special_rate' };
    }
    updates.special_rate = value;
    hasAny = true;
  }

  // Medical flags
  if (Object.prototype.hasOwnProperty.call(body, 'medical_flags') || Object.prototype.hasOwnProperty.call(body, 'medicalFlags')) {
    const { value, valid } = coerceOptionalJsonb(
      Object.prototype.hasOwnProperty.call(body, 'medical_flags') ? body.medical_flags : body.medicalFlags
    );
    if (!valid) {
      return { error: 'invalid_medical_flags' };
    }
    updates.medical_flags = value;
    hasAny = true;
  }

  // Onboarding status
  if (Object.prototype.hasOwnProperty.call(body, 'onboarding_status') || Object.prototype.hasOwnProperty.call(body, 'onboardingStatus')) {
    const { value, valid } = coerceOnboardingStatus(
      Object.prototype.hasOwnProperty.call(body, 'onboarding_status') ? body.onboarding_status : body.onboardingStatus
    );
    if (!valid) {
      return { error: 'invalid_onboarding_status' };
    }
    updates.onboarding_status = value;
    hasAny = true;
  }

  // Internal notes (replaces old 'notes' field)
  if (Object.prototype.hasOwnProperty.call(body, 'notes_internal') || Object.prototype.hasOwnProperty.call(body, 'notesInternal')) {
    const { value, valid } = coerceOptionalText(
      Object.prototype.hasOwnProperty.call(body, 'notes_internal') ? body.notes_internal : body.notesInternal
    );
    if (!valid) {
      return { error: 'invalid_notes_internal' };
    }
    updates.notes_internal = value;
    hasAny = true;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'medical_provider') || Object.prototype.hasOwnProperty.call(body, 'medicalProvider')) {
    const { value, valid } = coerceOptionalText(
      Object.prototype.hasOwnProperty.call(body, 'medical_provider') ? body.medical_provider : body.medicalProvider
    );
    if (!valid) {
      return { error: 'invalid_medical_provider' };
    }
    updates.medical_provider = value;
    hasAny = true;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'default_service') || Object.prototype.hasOwnProperty.call(body, 'defaultService')) {
    // DEPRECATED: default_service moved to lesson_templates in Reinex
    void 0; // No logging in helper function - warn in handler if needed
  }

  if (Object.prototype.hasOwnProperty.call(body, 'default_day_of_week') || Object.prototype.hasOwnProperty.call(body, 'defaultDayOfWeek')) {
    // DEPRECATED: default_day_of_week moved to lesson_templates in Reinex
    void 0; // No logging in helper function - warn in handler if needed
  }

  if (Object.prototype.hasOwnProperty.call(body, 'default_session_time') || Object.prototype.hasOwnProperty.call(body, 'defaultSessionTime')) {
    // DEPRECATED: default_session_time moved to lesson_templates in Reinex
    void 0; // No logging in helper function - warn in handler if needed
  }

  if (Object.prototype.hasOwnProperty.call(body, 'tags')) {
    const { value, valid } = coerceTags(body.tags);
    if (!valid) {
      return { error: 'invalid_tags' };
    }
    updates.tags = value;
    hasAny = true;
  }

  if (
    Object.prototype.hasOwnProperty.call(body, 'is_active') ||
    Object.prototype.hasOwnProperty.call(body, 'isActive')
  ) {
    const source = Object.prototype.hasOwnProperty.call(body, 'is_active') ? body.is_active : body.isActive;
    const { value, valid } = coerceBooleanFlag(source, { defaultValue: true, allowUndefined: false });
    if (!valid) {
      return { error: 'invalid_is_active' };
    }
    updates.is_active = Boolean(value);
    hasAny = true;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'notes')) {
    const { value, valid } = coerceOptionalText(body.notes);
    if (!valid) {
      return { error: 'invalid_notes' };
    }
    updates.notes = value;
    hasAny = true;
  }

  if (
    Object.prototype.hasOwnProperty.call(body, 'intake_notes') ||
    Object.prototype.hasOwnProperty.call(body, 'intakeNotes')
  ) {
    const { value, valid } = coerceOptionalText(
      Object.prototype.hasOwnProperty.call(body, 'intake_notes') ? body.intake_notes : body.intakeNotes,
    );
    if (!valid) {
      return { error: 'invalid_notes' };
    }
    intakeNotes = value;
    hasAny = true;
  }

  if (
    Object.prototype.hasOwnProperty.call(body, 'identity_number') ||
    Object.prototype.hasOwnProperty.call(body, 'identityNumber') ||
    Object.prototype.hasOwnProperty.call(body, 'national_id') ||
    Object.prototype.hasOwnProperty.call(body, 'nationalId')
  ) {
    const source =
      Object.prototype.hasOwnProperty.call(body, 'identity_number')
        ? body.identity_number
        : Object.prototype.hasOwnProperty.call(body, 'identityNumber')
          ? body.identityNumber
          : Object.prototype.hasOwnProperty.call(body, 'national_id')
            ? body.national_id
            : body.nationalId;

    const { value, valid } = coerceIdentityNumber(source);
    if (!valid) {
      return { error: 'invalid_identity_number' };
    }
    updates.identity_number = value;
    hasAny = true;
  }

  // Guardian fields (stored in student_guardians, not students)
  const guardianProvided =
    Object.prototype.hasOwnProperty.call(body, 'guardian_id') ||
    Object.prototype.hasOwnProperty.call(body, 'guardianId');
  let guardianId;
  let guardianRelationship;

  if (guardianProvided) {
    const rawId = body?.guardian_id ?? body?.guardianId;
    // Explicit null or empty string means "clear guardian"
    if (rawId === null || rawId === '' || rawId === undefined) {
      guardianId = null;
      guardianRelationship = null;
    } else {
      if (typeof rawId !== 'string' || !UUID_PATTERN.test(rawId)) {
        return { error: 'invalid_guardian_id' };
      }
      guardianId = rawId;

      const rawRel = body?.guardian_relationship ?? body?.guardianRelationship;
      if (!rawRel || typeof rawRel !== 'string') {
        return { error: 'guardian_relationship_required' };
      }
      const allowedRelationships = new Set(['father', 'mother', 'self', 'caretaker', 'other']);
      const trimmedRel = rawRel.trim();
      if (!allowedRelationships.has(trimmedRel)) {
        return { error: 'invalid_guardian_relationship' };
      }
      guardianRelationship = trimmedRel;
    }
    hasAny = true;
  }

  if (!hasAny) {
    return { error: 'missing_updates' };
  }

  return { updates, intakeNotes, guardianProvided, guardianId, guardianRelationship };
}

function determineStatusFilter(query, canViewInactive = true) {
  const status = normalizeString(query?.status);
  if (canViewInactive && status === 'inactive') {
    return 'inactive';
  }
  if (canViewInactive && status === 'all') {
    return 'all';
  }
  if (canViewInactive) {
    const includeInactive = query?.include_inactive ?? query?.includeInactive;
    const includeFlag = coerceBooleanFlag(includeInactive, { defaultValue: false, allowUndefined: true });
    if (includeFlag.valid && includeFlag.value) {
      return 'all';
    }
  }
  return 'active';
}

function parsePagination(query) {
  const rawLimit = Number.parseInt(normalizeString(query?.limit) || '', 10);
  const rawOffset = Number.parseInt(normalizeString(query?.offset) || '', 10);

  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 25;
  const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0;

  return { limit, offset };
}

function parseDayFilter(query) {
  const rawDay = normalizeString(
    query?.day ?? query?.day_of_week ?? query?.default_day_of_week,
  );

  if (!rawDay) {
    return null;
  }

  const parsedDay = normalizeDayToken(rawDay);
  if (!parsedDay) {
    return Number.NaN;
  }

  return parsedDay;
}

function parseSortOrder(query) {
  const raw = normalizeString(query?.sort ?? query?.sort_by);
  if (raw === 'name') return 'name';
  return 'schedule'; // default: day → time → name
}

function escapeILikeValue(value) {
  return String(value || '').replace(/[%_,]/g, '');
}

function isPaginationRequested(query) {
  const parsed = coerceBooleanFlag(query?.pagination ?? query?.paginated, {
    defaultValue: false,
    allowUndefined: true,
  });

  return Boolean(parsed.valid && parsed.value);
}

export default async function handler(context, req) {
  const method = String(req.method || 'GET').toUpperCase();
  if (!['GET', 'POST', 'PUT', 'PATCH'].includes(method)) {
    return respond(context, 405, { message: 'method_not_allowed' }, { Allow: 'GET,POST,PUT,PATCH' });
  }

  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);

  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('students-list missing Supabase admin credentials');
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    context.log?.warn?.('students-list missing bearer token');
    return respond(context, 401, { message: 'missing bearer' });
  }

  const supabase = createSupabaseAdminClient(adminConfig);

  let authResult;
  try {
    authResult = await supabase.auth.getUser(authorization.token);
  } catch (error) {
    context.log?.error?.('students-list failed to validate token', { message: error?.message });
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  const userId = authResult.data.user.id;
  const body = method === 'GET' ? parseRequestBody(null) : parseRequestBody(req);
  const orgId = resolveOrgId(req, body);

  if (!orgId) {
    return respond(context, 400, { message: 'invalid org id' });
  }

  let role;
  try {
    role = await ensureMembership(supabase, orgId, userId);
  } catch (membershipError) {
    context.log?.error?.('students-list failed to verify membership', {
      message: membershipError?.message,
      orgId,
      userId,
    });
    return respond(context, 500, { message: 'failed_to_verify_membership' });
  }

  if (!role) {
    return respond(context, 403, { message: 'forbidden' });
  }

  const canManageRoster = isAdminOrOffice(role);

  const { client: tenantClient, error: tenantError } = await resolveTenantClient(context, supabase, env, orgId);
  if (tenantError) {
    return respond(context, tenantError.status, tenantError.body);
  }

  // GET: Fetch students list with role-based filtering
  if (method === 'GET') {
    // ── Single-student GET with guardian join ──
    const singleStudentId = normalizeString(context?.bindingData?.studentId);
    if (singleStudentId && UUID_PATTERN.test(singleStudentId)) {
      // Fetch the single student
      const { data: singleStudent, error: singleError } = await tenantClient
        .from('students')
        .select('*')
        .eq('id', singleStudentId)
        .maybeSingle();

      if (singleError) {
        context.log?.error?.('students-list failed to fetch single student', {
          message: singleError.message,
          studentId: singleStudentId,
        });
        return respond(context, 500, { message: 'failed_to_load_student' });
      }

      if (!singleStudent) {
        return respond(context, 404, { message: 'student_not_found' });
      }

      // Non-admin instructors can only view their own students
      if (!canManageRoster) {
        const { studentIds: instructorStudentIds, error: accessError } =
          await fetchStudentIdsByInstructor(tenantClient, userId);
        if (accessError || !instructorStudentIds.includes(singleStudentId)) {
          return respond(context, 403, { message: 'forbidden' });
        }
      }

      // Join primary guardian
      const { guardian, error: guardianError } = await fetchPrimaryGuardian(
        tenantClient,
        singleStudentId,
      );

      if (guardianError) {
        context.log?.warn?.('students-list failed to load guardian for single student', {
          message: guardianError.message,
          studentId: singleStudentId,
        });
        // Non-fatal: return student without guardian data
      }

      return respond(context, 200, {
        ...singleStudent,
        guardian: guardian || null,
      });
    }

    // ── List GET (existing behaviour) ──
    const paginationRequested = isPaginationRequested(req?.query);
    const { limit, offset } = parsePagination(req?.query);
    const dayFilter = parseDayFilter(req?.query);
    const sortOrder = parseSortOrder(req?.query);
    const searchTerm = normalizeString(req?.query?.search);
    const tagFilter = normalizeString(req?.query?.tag ?? req?.query?.tags);
    const requiresDerivedSchedule = sortOrder === 'schedule' || dayFilter !== null;

    if (Number.isNaN(dayFilter)) {
      return respond(context, 400, { message: 'invalid_day_filter' });
    }

    let instructorsCanViewInactive = true; // Default for admins
    
    // Non-admin users need to check the setting
    if (!canManageRoster) {
      try {
        const { data: settingRow, error: settingError } = await tenantClient
          .from('Settings')
          .select('settings_value')
          .eq('key', 'instructors_can_view_inactive_students')
          .maybeSingle();

        if (!settingError && settingRow && typeof settingRow.settings_value === 'boolean') {
          instructorsCanViewInactive = settingRow.settings_value === true;
        } else {
          instructorsCanViewInactive = false;
        }
      } catch (settingsError) {
        context.log?.warn?.('students-list failed to read inactive visibility setting', {
          message: settingsError?.message,
          orgId,
        });
        instructorsCanViewInactive = false;
      }
    }

    let builder = tenantClient
      .from('students')
      .select('*', paginationRequested ? { count: 'exact' } : undefined);

    if (sortOrder === 'name') {
      builder = builder
        .order('first_name', { ascending: true })
        .order('middle_name', { ascending: true, nullsFirst: false })
        .order('last_name', { ascending: true });
    }

    let instructorFilterId = '';

    // Non-admin users (instructors) can only see their assigned students via lesson_templates
    if (!canManageRoster) {
      instructorFilterId = userId;
    } else {
      // Admins can optionally filter by instructor
      const assignedInstructorId = normalizeString(req?.query?.assigned_instructor_id);
      if (assignedInstructorId) {
        // Validate UUID format to prevent information disclosure
        if (!UUID_PATTERN.test(assignedInstructorId)) {
          return respond(context, 400, { message: 'invalid_instructor_id_format' });
        }
        instructorFilterId = assignedInstructorId;
      }
    }

    if (instructorFilterId) {
      const { studentIds, error: lessonError } = await fetchStudentIdsByInstructor(
        tenantClient,
        instructorFilterId,
      );

      if (lessonError) {
        context.log?.error?.('students-list failed to fetch instructor lesson templates', {
          message: lessonError.message,
          instructorEmployeeId: instructorFilterId,
        });
        return respond(context, 500, { message: 'failed_to_load_students' });
      }

      if (!studentIds.length) {
        if (!paginationRequested) {
          return respond(context, 200, []);
        }

        return respond(context, 200, {
          data: [],
          total: 0,
          page_size: limit,
          page: Math.floor(offset / limit) + 1,
          offset,
          has_more: false,
        });
      }

      builder = builder.in('id', studentIds);
    }

    // Status filter
    const statusFilter = determineStatusFilter(req?.query, instructorsCanViewInactive);
    if (statusFilter === 'active') {
      builder = builder.eq('is_active', true);
    } else if (statusFilter === 'inactive') {
      builder = builder.eq('is_active', false);
    }

    if (searchTerm) {
      const sanitizedSearch = escapeILikeValue(searchTerm);
      builder = builder.or(
        [
          `first_name.ilike.%${sanitizedSearch}%`,
          `middle_name.ilike.%${sanitizedSearch}%`,
          `last_name.ilike.%${sanitizedSearch}%`,
          `identity_number.ilike.%${sanitizedSearch}%`,
          `phone.ilike.%${sanitizedSearch}%`,
          `email.ilike.%${sanitizedSearch}%`,
        ].join(','),
      );
    }

    if (tagFilter) {
      const normalizedTags = tagFilter
        .split(',')
        .map((value) => normalizeString(value))
        .filter(Boolean);

      if (normalizedTags.length) {
        builder = builder.contains('tags', [normalizedTags[0]]);
      }
    }

    if (paginationRequested && !requiresDerivedSchedule) {
      builder = builder.range(offset, offset + limit - 1);
    }

    const { data, error, count } = await builder;

    if (error) {
      context.log?.error?.('students-list failed to fetch roster', { message: error.message });
      return respond(context, 500, { message: 'failed_to_load_students' });
    }

    let normalizedData = Array.isArray(data) ? data : [];

    const studentIds = normalizedData.map((student) => student?.id).filter(Boolean);
    const { data: scheduleMap, error: scheduleError } = await fetchPrimarySchedulesByStudentIds(
      tenantClient,
      studentIds,
    );

    if (scheduleError) {
      context.log?.error?.('students-list failed to load lesson templates for roster schedule', {
        message: scheduleError.message,
      });
      return respond(context, 500, { message: 'failed_to_load_students' });
    }

    normalizedData = mergeStudentSchedules(normalizedData, scheduleMap);

    if (requiresDerivedSchedule) {
      if (dayFilter !== null) {
        normalizedData = normalizedData.filter(
          (student) => normalizeDayToken(student?.default_day_of_week) === dayFilter,
        );
      }

      if (sortOrder === 'schedule') {
        normalizedData.sort(compareScheduleEntries);
      } else {
        normalizedData.sort(compareNameParts);
      }
    }

    if (!paginationRequested) {
      return respond(context, 200, normalizedData);
    }

    const total = requiresDerivedSchedule
      ? normalizedData.length
      : (Number.isFinite(count) ? count : normalizedData.length);
    const pageSize = limit;
    const page = Math.floor(offset / pageSize) + 1;
    const pagedData = requiresDerivedSchedule
      ? normalizedData.slice(offset, offset + limit)
      : normalizedData;
    const hasMore = offset + pagedData.length < total;

    return respond(context, 200, {
      data: pagedData,
      total,
      page_size: pageSize,
      page,
      offset,
      has_more: hasMore,
    });
  }

  // POST and PUT require admin or office role
  if (!canManageRoster) {
    return respond(context, 403, { message: 'forbidden' });
  }

  // POST: Create new student
  if (method === 'POST') {
    const normalized = buildStudentPayload(body);
    if (normalized.error) {
      // Log the actual error code for debugging
      context.log?.warn?.('students-list validation failed', { 
        errorCode: normalized.error,
        body: {
          firstName: body?.firstName,
          lastName: body?.lastName,
          identityNumber: body?.identityNumber,
          defaultDayOfWeek: body?.defaultDayOfWeek,
          defaultSessionTime: body?.defaultSessionTime,
        }
      });
      
      const message =
        normalized.error === 'missing_first_name'
          ? 'missing first name'
          : normalized.error === 'missing_last_name'
            ? 'missing last name'
          : normalized.error === 'missing_name'
            ? 'missing student name'
            : normalized.error === 'missing_identity_number'
              ? 'missing identity number'
              : normalized.error === 'invalid_identity_number'
                ? 'invalid identity number'
                : normalized.error === 'phone_required_without_guardian'
                  ? 'phone required when no guardian is connected'
                  : normalized.error === 'invalid_phone'
                    ? 'invalid phone'
                    : normalized.error === 'invalid_email'
                      ? 'invalid email'
                      : normalized.error === 'invalid_guardian_id'
                        ? 'invalid guardian id'
                          : normalized.error === 'invalid_date_of_birth'
                            ? 'invalid date of birth'
                            : normalized.error === 'invalid_notification_method'
                              ? 'invalid notification method'
                              : normalized.error === 'invalid_special_rate'
                                ? 'invalid special rate'
                                : normalized.error === 'invalid_medical_flags'
                                  ? 'invalid medical flags'
                                  : normalized.error === 'invalid_onboarding_status'
                                    ? 'invalid onboarding status'
                                    : normalized.error === 'invalid_notes_internal'
                                      ? 'invalid internal notes'
                                      : normalized.error === 'invalid_tags'
                                        ? 'invalid tags'
                                        : normalized.error === 'invalid_is_active'
                                          ? 'invalid is_active flag'
                                          : 'invalid payload';
      return respond(context, 400, { message });
    }

    if (normalized.payload.identity_number) {
      const { data: existingByIdentityNumber, error: identityLookupError } = await findStudentByIdentityNumber(
        tenantClient,
        normalized.payload.identity_number,
      );

      if (identityLookupError) {
        context.log?.error?.('students-list failed to check identity number uniqueness', { message: identityLookupError.message });
        return respond(context, 500, { message: 'failed_to_validate_identity_number' });
      }

      if (existingByIdentityNumber) {
        return respond(context, 409, { message: 'duplicate_identity_number', student: existingByIdentityNumber });
      }
    }

    // Build metadata with creator information
    const metadata = {
      created_by: userId,
      created_at: new Date().toISOString(),
      created_role: role,
    };

    const recordToInsert = {
      ...normalized.payload,
      metadata,
    };

    const { data, error } = await tenantClient
      .from('students')
      .insert([recordToInsert])
      .select()
      .single();

    if (error) {
      context.log?.error?.('students-list failed to create student', { message: error.message });
      return respond(context, 500, { message: 'failed_to_create_student' });
    }

    // If guardian provided, create the relationship in student_guardians table
    let guardianLinkAudit = null;
    if (normalized.guardianId) {
      const { error: relationError } = await tenantClient
        .from('student_guardians')
        .insert({
          student_id: data.id,
          guardian_id: normalized.guardianId,
          relationship: normalized.guardianRelationship,
          is_primary: true, // Mark as primary guardian
        });

      if (relationError) {
        context.log?.error?.('students-list failed to create guardian relationship', {
          message: relationError.message,
          studentId: data.id,
          guardianId: normalized.guardianId,
        });
        guardianLinkAudit = {
          requested: true,
          action: 'linked',
          success: false,
          guardian_id: normalized.guardianId,
          relationship: normalized.guardianRelationship,
          error: relationError.message,
        };
        // Student created but guardian relation failed - log but don't fail the request
        // The student can be edited later to add the guardian
      } else {
        guardianLinkAudit = {
          requested: true,
          action: 'linked',
          success: true,
          guardian_id: normalized.guardianId,
          relationship: normalized.guardianRelationship,
        };
      }
    }

    // Audit log: student created
    await logAuditEvent(supabase, {
      orgId,
      userId,
      userEmail: authResult.data.user.email || '',
      userRole: role,
      actionType: AUDIT_ACTIONS.STUDENT_CREATED,
      actionCategory: AUDIT_CATEGORIES.STUDENTS,
      resourceType: 'student',
      resourceId: data.id,
      details: {
        student_name: `${data.first_name} ${data.last_name}`.trim(),
        guardian_link: guardianLinkAudit,
      },
    });

    return respond(context, 201, data);
  }

  // PUT: Update existing student
  if (method === 'PUT') {
  const studentId = extractStudentId(context, req, body);
  if (!studentId) {
    return respond(context, 400, { message: 'invalid student id' });
  }

  const normalizedUpdates = buildStudentUpdates(body);
  if (normalizedUpdates.error) {
    const updateMessage =
      normalizedUpdates.error === 'missing_updates'
        ? 'no updatable fields provided'
        : normalizedUpdates.error === 'invalid_identity_number'
          ? 'invalid identity number'
        : normalizedUpdates.error === 'invalid_phone'
          ? 'invalid phone'
        : normalizedUpdates.error === 'invalid_email'
          ? 'invalid email'
        : normalizedUpdates.error === 'invalid_name'
          ? 'invalid name'
          : normalizedUpdates.error === 'invalid_contact_name'
            ? 'invalid contact name'
            : normalizedUpdates.error === 'invalid_contact_phone'
              ? 'invalid contact phone'
              : normalizedUpdates.error === 'invalid_default_service'
                ? 'invalid default service'
                : normalizedUpdates.error === 'invalid_default_day'
                  ? 'invalid default day of week'
          : normalizedUpdates.error === 'invalid_default_session_time'
            ? 'invalid default session time'
            : normalizedUpdates.error === 'invalid_notes'
              ? 'invalid notes'
              : normalizedUpdates.error === 'invalid_tags'
                ? 'invalid tags'
                : normalizedUpdates.error === 'invalid_is_active'
                  ? 'invalid is_active flag'
                  : normalizedUpdates.error === 'invalid_guardian_id'
                    ? 'invalid guardian id'
                    : normalizedUpdates.error === 'guardian_relationship_required'
                      ? 'guardian relationship is required when linking a guardian'
                      : normalizedUpdates.error === 'invalid_guardian_relationship'
                        ? 'invalid guardian relationship'
                        : 'invalid payload';
    return respond(context, 400, { message: updateMessage });
  }

  // Fetch existing student to compare changes and preserve metadata
  const { data: existingStudent, error: fetchError } = await tenantClient
    .from('students')
    .select('*')
    .eq('id', studentId)
    .maybeSingle();

  if (fetchError) {
    context.log?.error?.('students-list failed to fetch existing student', { message: fetchError.message, studentId });
    return respond(context, 500, { message: 'failed_to_fetch_student' });
  }

  if (!existingStudent) {
    return respond(context, 404, { message: 'student_not_found' });
  }

  if (Object.prototype.hasOwnProperty.call(normalizedUpdates.updates, 'identity_number')) {
    const desiredIdentityNumber = normalizedUpdates.updates.identity_number;

    if (desiredIdentityNumber) {
      const { data: conflict, error: lookupError } = await findStudentByIdentityNumber(tenantClient, desiredIdentityNumber, {
        excludeId: studentId,
      });

      if (lookupError) {
        context.log?.error?.('students-list failed to validate identity number on update', {
          message: lookupError.message,
          studentId,
        });
        return respond(context, 500, { message: 'failed_to_validate_identity_number' });
      }

      if (conflict) {
        return respond(context, 409, { message: 'duplicate_identity_number', student: conflict });
      }
    }
  }

  // Determine which fields actually changed
  const changedFields = [];
  for (const [key, newValue] of Object.entries(normalizedUpdates.updates)) {
    const oldValue = existingStudent[key];
    // Handle null/undefined as equivalent
    const normalizedOld = oldValue === null || oldValue === undefined ? null : oldValue;
    const normalizedNew = newValue === null || newValue === undefined ? null : newValue;
    
    // Deep comparison for objects/arrays, simple comparison for primitives
    if (JSON.stringify(normalizedOld) !== JSON.stringify(normalizedNew)) {
      changedFields.push(key);
    }
  }

  // Build updated metadata preserving existing fields
  const existingMetadata = existingStudent.metadata || {};
  const updatedMetadata = {
    ...existingMetadata,
    updated_by: userId,
    updated_at: new Date().toISOString(),
    updated_role: role,
  };

  const updatesWithMetadata = {
    ...normalizedUpdates.updates,
    metadata: updatedMetadata,
  };

  if (Object.prototype.hasOwnProperty.call(normalizedUpdates, 'intakeNotes')) {
    updatesWithMetadata.metadata = {
      ...updatedMetadata,
      intake_notes: normalizedUpdates.intakeNotes,
      intake_notes_updated_at: new Date().toISOString(),
      intake_notes_updated_by: userId,
    };
  }

  const { data, error } = await tenantClient
    .from('students')
    .update(updatesWithMetadata)
    .eq('id', studentId)
    .select()
    .maybeSingle();

  if (error) {
    context.log?.error?.('students-list failed to update student', { message: error.message, studentId });
    return respond(context, 500, { message: 'failed_to_update_student' });
  }

  if (!data) {
    return respond(context, 404, { message: 'student_not_found' });
  }

  // ── Guardian upsert / delete in student_guardians ──
  let guardianAudit = null;
  if (normalizedUpdates.guardianProvided) {
    guardianAudit = {
      requested: true,
      previous: null,
      next: normalizedUpdates.guardianId
        ? {
            guardian_id: normalizedUpdates.guardianId,
            relationship: normalizedUpdates.guardianRelationship,
          }
        : null,
      action: 'unchanged',
      success: true,
      error: null,
    };

    // First check if a row already exists for this student.
    const { data: existingLink, error: linkLookupError } = await tenantClient
      .from('student_guardians')
      .select('id, guardian_id, relationship')
      .eq('student_id', studentId)
      .order('is_primary', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (linkLookupError) {
      context.log?.warn?.('students-list failed to look up existing guardian link', {
        message: linkLookupError.message,
        studentId,
      });
      guardianAudit.success = false;
      guardianAudit.error = `lookup_failed:${linkLookupError.message}`;
    }

    if (existingLink) {
      guardianAudit.previous = {
        guardian_id: existingLink.guardian_id,
        relationship: existingLink.relationship,
      };
    }

    if (normalizedUpdates.guardianId) {
      if (existingLink) {
        // Update existing link (guardian or relationship may have changed)
        const linkUpdates = {};
        if (existingLink.guardian_id !== normalizedUpdates.guardianId) {
          linkUpdates.guardian_id = normalizedUpdates.guardianId;
        }
        if (existingLink.relationship !== normalizedUpdates.guardianRelationship) {
          linkUpdates.relationship = normalizedUpdates.guardianRelationship;
        }

        if (Object.keys(linkUpdates).length > 0) {
          const { error: linkUpdateError } = await tenantClient
            .from('student_guardians')
            .update(linkUpdates)
            .eq('id', existingLink.id);

          if (linkUpdateError) {
            context.log?.error?.('students-list failed to update guardian link', {
              message: linkUpdateError.message,
              studentId,
              guardianId: normalizedUpdates.guardianId,
            });
            guardianAudit.action = 'update_failed';
            guardianAudit.success = false;
            guardianAudit.error = linkUpdateError.message;
          } else {
            changedFields.push('guardian');
            guardianAudit.action = 'updated';
          }
        }
      } else {
        // Insert new link
        const { error: linkInsertError } = await tenantClient
          .from('student_guardians')
          .insert({
            student_id: studentId,
            guardian_id: normalizedUpdates.guardianId,
            relationship: normalizedUpdates.guardianRelationship,
            is_primary: true,
          });

        if (linkInsertError) {
          context.log?.error?.('students-list failed to create guardian link', {
            message: linkInsertError.message,
            studentId,
            guardianId: normalizedUpdates.guardianId,
          });
          guardianAudit.action = 'insert_failed';
          guardianAudit.success = false;
          guardianAudit.error = linkInsertError.message;
        } else {
          changedFields.push('guardian');
          guardianAudit.action = 'linked';
        }
      }
    } else if (existingLink) {
      // guardianId is null -> clear the guardian link
      const { error: deleteError } = await tenantClient
        .from('student_guardians')
        .delete()
        .eq('student_id', studentId);

      if (deleteError) {
        context.log?.error?.('students-list failed to delete guardian link', {
          message: deleteError.message,
          studentId,
        });
        guardianAudit.action = 'delete_failed';
        guardianAudit.success = false;
        guardianAudit.error = deleteError.message;
      } else {
        changedFields.push('guardian');
        guardianAudit.action = 'cleared';
      }
    }
  }

  // Audit log: student updated
  await logAuditEvent(supabase, {
    orgId,
    userId,
    userEmail: authResult.data.user.email || '',
    userRole: role,
    actionType: AUDIT_ACTIONS.STUDENT_UPDATED,
    actionCategory: AUDIT_CATEGORIES.STUDENTS,
    resourceType: 'student',
    resourceId: studentId,
    details: {
      updated_fields: Array.from(new Set(changedFields)),
      student_name: `${data.first_name} ${data.last_name}`.trim(),
      guardian_change: guardianAudit,
    },
  });

  return respond(context, 200, data);
  }

  // PATCH: Update student status (soft-delete, suspend/activate)
  if (method === 'PATCH') {
  const studentId = extractStudentId(context, req, body);
  if (!studentId) {
    return respond(context, 400, { message: 'invalid student id' });
  }

  // Fetch existing student
  const { data: existingStudent, error: fetchError } = await tenantClient
    .from('students')
    .select('id, first_name, last_name, is_active')
    .eq('id', studentId)
    .maybeSingle();

  if (fetchError) {
    context.log?.error?.('students-list failed to fetch student for PATCH', {
      message: fetchError.message,
      studentId,
    });
    return respond(context, 500, { message: 'failed_to_fetch_student' });
  }

  if (!existingStudent) {
    return respond(context, 404, { message: 'student_not_found' });
  }

  // Extract status change
  const isActiveSource = body?.is_active ?? body?.isActive;
  if (isActiveSource === null || isActiveSource === undefined) {
    return respond(context, 400, { message: 'missing_status_field' });
  }

  const { value: newIsActive, valid } = coerceBooleanFlag(isActiveSource, {
    defaultValue: true,
    allowUndefined: false,
  });

  if (!valid) {
    return respond(context, 400, { message: 'invalid_is_active' });
  }

  const oldIsActive = existingStudent.is_active;

  // No change needed
  if (oldIsActive === newIsActive) {
    return respond(context, 200, existingStudent);
  }

  // Update is_active
  const { data: updated, error: updateError } = await tenantClient
    .from('students')
    .update({
      is_active: newIsActive,
      metadata: {
        ...existingStudent.metadata,
        status_updated_by: userId,
        status_updated_at: new Date().toISOString(),
      },
    })
    .eq('id', studentId)
    .select()
    .maybeSingle();

  if (updateError) {
    context.log?.error?.('students-list failed to update student status', {
      message: updateError.message,
      studentId,
    });
    return respond(context, 500, { message: 'failed_to_update_student' });
  }

  // Audit: status changed
  await logAuditEvent(supabase, {
    orgId,
    userId,
    userEmail: authResult.data.user.email || '',
    userRole: role,
    actionType: AUDIT_ACTIONS.STUDENT_UPDATED,
    actionCategory: AUDIT_CATEGORIES.STUDENTS,
    resourceType: 'student',
    resourceId: studentId,
    details: {
      student_name: `${updated.first_name} ${updated.last_name}`.trim(),
      status_change: oldIsActive ? 'suspended' : 'reactivated',
      status_before: oldIsActive,
      status_after: newIsActive,
    },
  });

  return respond(context, 200, updated);
  }
}
