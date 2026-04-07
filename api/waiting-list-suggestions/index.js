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
import {
  getAvailabilityWindowsForDay,
  hasConfiguredAvailability,
  isWithinAvailabilityWindows,
  timeToMinutes,
} from '../_shared/instructor-availability.js';
import { daySortValue, normalizeDayToken } from '../_shared/day-of-week.js';

const SUGGESTION_MODES = new Set(['capacity', 'empty_slots']);
const DAY_LABELS = Object.freeze({
  sunday: 'ראשון',
  monday: 'שני',
  tuesday: 'שלישי',
  wednesday: 'רביעי',
  thursday: 'חמישי',
  friday: 'שישי',
  saturday: 'שבת',
});
const GRID_STEP_MINUTES = 15;
const MAX_SUGGESTIONS = 18;

function normalizeUuid(value) {
  const normalized = normalizeString(value);
  if (!normalized) return '';
  return UUID_PATTERN.test(normalized) ? normalized : '';
}

function normalizeMode(value) {
  const normalized = normalizeString(value).toLowerCase();
  return SUGGESTION_MODES.has(normalized) ? normalized : '';
}

function parseIsoDateInTimezone(date = new Date(), timeZone = 'Asia/Jerusalem') {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function buildEntrySelect() {
  return [
    'id',
    'client_profile_id',
    'student_id',
    'desired_service_id',
    'preferred_days',
    'preferred_times',
    'priority_flag',
    'status',
    'notes',
    'created_at',
    'metadata',
    'student:students(id, first_name, middle_name, last_name, identity_number, phone, email)',
    'client_profile:client_profiles(id, first_name, middle_name, last_name, identity_number, phone, email)',
    'service:Services(id, name, duration_minutes)',
  ].join(',');
}

function formatTime(totalMinutes) {
  const safeMinutes = Math.max(0, Number(totalMinutes) || 0);
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function formatDay(dayOfWeek) {
  return DAY_LABELS[normalizeDayToken(dayOfWeek)] || '—';
}

function formatPersonName(person) {
  if (!person) return '—';
  return [person.first_name, person.middle_name, person.last_name].filter(Boolean).join(' ').trim() || '—';
}

function isTemplateValidOn(template, dateKey) {
  const validFrom = normalizeString(template?.valid_from) || '0001-01-01';
  const validUntil = normalizeString(template?.valid_until) || '9999-12-31';
  return validFrom <= dateKey && dateKey <= validUntil;
}

function buildPreferredRangesMap(preferredTimes) {
  const map = new Map();
  if (!Array.isArray(preferredTimes)) return map;
  preferredTimes.forEach((entry) => {
    const day = normalizeDayToken(entry?.day);
    if (!day) return;
    const normalizedRanges = (Array.isArray(entry?.ranges) ? entry.ranges : [])
      .map((range) => ({
        start: timeToMinutes(range?.start),
        end: timeToMinutes(range?.end),
      }))
      .filter((range) => range.start != null && range.end != null && range.end > range.start);
    if (normalizedRanges.length) {
      map.set(day, normalizedRanges);
    }
  });
  return map;
}

function getPreferenceMatch(entry, dayOfWeek, startMinutes, durationMinutes) {
  const preferredDays = Array.isArray(entry?.preferred_days)
    ? entry.preferred_days.map((day) => normalizeDayToken(day)).filter(Boolean)
    : [];
  const preferredRangesMap = buildPreferredRangesMap(entry?.preferred_times);
  const endMinutes = startMinutes + durationMinutes;
  const normalizedDay = normalizeDayToken(dayOfWeek);
  const dayRanges = preferredRangesMap.get(normalizedDay) || [];

  if (dayRanges.some((range) => startMinutes < range.end && endMinutes > range.start)) {
    return 'exact';
  }

  if (preferredDays.includes(normalizedDay) || dayRanges.length > 0) {
    return 'day_only';
  }

  return 'none';
}

function preferenceWeight(matchType) {
  switch (matchType) {
    case 'exact':
      return 300;
    case 'day_only':
      return 200;
    default:
      return 100;
  }
}

function buildReasonPrefix(matchType) {
  switch (matchType) {
    case 'exact':
      return 'תואם ליום ולהעדפת השעות של המתעניין/ת';
    case 'day_only':
      return 'תואם ליום ההעדפה של המתעניין/ת';
    default:
      return 'המדריך/ה תומך/ת בשירות המבוקש';
  }
}

function compareSuggestions(left, right) {
  if ((right?.score || 0) !== (left?.score || 0)) {
    return (right?.score || 0) - (left?.score || 0);
  }
  if ((right?.available_seats || 0) !== (left?.available_seats || 0)) {
    return (right?.available_seats || 0) - (left?.available_seats || 0);
  }
  if (Number(right?.priority_flag) !== Number(left?.priority_flag)) {
    return Number(right?.priority_flag) - Number(left?.priority_flag);
  }
  const dayDiff = daySortValue(left?.day_of_week) - daySortValue(right?.day_of_week);
  if (dayDiff !== 0) {
    return dayDiff;
  }
  return String(left?.time_of_day || '').localeCompare(String(right?.time_of_day || ''));
}

function buildCandidateWindows(dayOfWeek, entry, availabilityWindows) {
  const preferredRangesMap = buildPreferredRangesMap(entry?.preferred_times);
  const normalizedDay = normalizeDayToken(dayOfWeek);
  const explicitRanges = preferredRangesMap.get(normalizedDay);
  if (explicitRanges?.length) {
    const serviceWindows = getAvailabilityWindowsForDay(availabilityWindows, normalizedDay)
      .map((window) => ({
        start: timeToMinutes(window.start),
        end: timeToMinutes(window.end),
      }))
      .filter((window) => window.start != null && window.end != null);

    return explicitRanges
      .flatMap((range) => serviceWindows
        .map((window) => ({
          start: Math.max(range.start, window.start),
          end: Math.min(range.end, window.end),
        }))
        .filter((window) => window.end > window.start));
  }
  return getAvailabilityWindowsForDay(availabilityWindows, normalizedDay)
    .map((window) => ({
      start: timeToMinutes(window.start),
      end: timeToMinutes(window.end),
    }))
    .filter((window) => window.start != null && window.end != null && window.end > window.start);
}

function buildCapacitySuggestions({ entry, capabilityMap, instructorMap, validTemplates }) {
  const groupedTemplates = new Map();

  validTemplates.forEach((template) => {
    const key = [
      template.instructor_employee_id,
      template.service_id,
      template.day_of_week,
      normalizeString(template.time_of_day),
      Number(template.duration_minutes) || 0,
    ].join('|');

    if (!groupedTemplates.has(key)) {
      groupedTemplates.set(key, []);
    }
    groupedTemplates.get(key).push(template);
  });

  const suggestions = [];

  for (const templates of groupedTemplates.values()) {
    const anchor = templates[0];
    const capability = capabilityMap.get(anchor.instructor_employee_id);
    if (!capability) continue;
    if (!hasConfiguredAvailability(capability.availability_windows)) continue;

    const maxStudents = Number(capability.max_students) || 1;
    const currentStudents = templates.length;
    const availableSeats = maxStudents - currentStudents;
    if (availableSeats <= 0) continue;
    if (entry.student_id && templates.some((template) => template.student_id === entry.student_id)) continue;

    const startMinutes = timeToMinutes(anchor.time_of_day);
    if (startMinutes == null) continue;
    if (!isWithinAvailabilityWindows({
      availabilityWindows: capability.availability_windows,
      day: anchor.day_of_week,
      startTime: anchor.time_of_day,
      durationMinutes: Number(anchor.duration_minutes) || 0,
    })) {
      continue;
    }

    const matchType = getPreferenceMatch(entry, anchor.day_of_week, startMinutes, Number(anchor.duration_minutes) || 0);
    const instructor = instructorMap.get(anchor.instructor_employee_id);
    const score = preferenceWeight(matchType) + 30 + Math.min(availableSeats, 5);

    suggestions.push({
      mode: 'capacity',
      score,
      priority_flag: Boolean(entry.priority_flag),
      instructor_id: anchor.instructor_employee_id,
      instructor_name: formatPersonName(instructor),
      service_id: anchor.service_id,
      service_name: entry.service?.name || '—',
      day_of_week: normalizeDayToken(anchor.day_of_week),
      day_label: formatDay(anchor.day_of_week),
      time_of_day: formatTime(startMinutes),
      duration_minutes: Number(anchor.duration_minutes) || 0,
      available_seats: availableSeats,
      current_students: currentStudents,
      capacity: maxStudents,
      source_template_id: anchor.id,
      match_reason: `${buildReasonPrefix(matchType)}. בתבנית הקיימת יש כרגע ${currentStudents} מתוך ${maxStudents} תלמידים, ונשארו ${availableSeats} מקומות פנויים.`,
    });
  }

  return suggestions;
}

function buildEmptySlotSuggestions({ entry, capabilityMap, instructorMap, templatesByInstructorDay }) {
  const suggestions = [];
  const preferredDays = Array.isArray(entry?.preferred_days)
    ? entry.preferred_days.map((day) => normalizeDayToken(day)).filter(Boolean)
    : [];

  for (const [instructorId, capability] of capabilityMap.entries()) {
    const instructor = instructorMap.get(instructorId);
    if (!instructor) continue;
    if (!hasConfiguredAvailability(capability.availability_windows)) continue;

    const availabilityDays = Array.from(new Set(
      (capability.availability_windows || [])
        .map((window) => normalizeDayToken(window?.day))
        .filter(Boolean),
    ));
    const candidateDays = preferredDays.length
      ? availabilityDays.filter((day) => preferredDays.includes(day))
      : availabilityDays;

    for (const dayOfWeek of candidateDays) {
      const existingTemplates = templatesByInstructorDay.get(`${instructorId}|${dayOfWeek}`) || [];
      const windows = buildCandidateWindows(dayOfWeek, entry, capability.availability_windows);

      windows.forEach((window) => {
        for (let start = window.start; start + capability.duration_minutes <= window.end; start += GRID_STEP_MINUTES) {
          const end = start + capability.duration_minutes;
          const hasConflict = existingTemplates.some((template) => {
            const templateStart = timeToMinutes(template.time_of_day);
            if (templateStart == null) return false;
            const templateEnd = templateStart + (Number(template.duration_minutes) || 0);
            return start < templateEnd && end > templateStart;
          });

          if (hasConflict) {
            continue;
          }

          const matchType = getPreferenceMatch(entry, dayOfWeek, start, capability.duration_minutes);
          const score = preferenceWeight(matchType);

          suggestions.push({
            mode: 'empty_slots',
            score,
            priority_flag: Boolean(entry.priority_flag),
            instructor_id: instructorId,
            instructor_name: formatPersonName(instructor),
            service_id: entry.desired_service_id,
            service_name: entry.service?.name || '—',
            day_of_week: dayOfWeek,
            day_label: formatDay(dayOfWeek),
            time_of_day: formatTime(start),
            duration_minutes: capability.duration_minutes,
            available_seats: 1,
            current_students: 0,
            capacity: Number(capability.max_students) || 1,
            source_template_id: null,
            match_reason: `${buildReasonPrefix(matchType)}. נמצא חלון פנוי בלוח התבניות של ${formatPersonName(instructor)} בתוך חלון הזמינות שהוגדר לשירות.`,
          });
        }
      });
    }
  }

  return suggestions;
}

export default async function waitingListSuggestions(context, req) {
  if (String(req.method || 'GET').toUpperCase() !== 'GET') {
    return respond(context, 405, { message: 'method_not_allowed' }, { Allow: 'GET' });
  }

  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);

  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('waiting-list-suggestions missing Supabase admin credentials');
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
    context.log?.error?.('waiting-list-suggestions failed to validate token', { message: error?.message });
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  const userId = authResult.data.user.id;
  const body = parseRequestBody(req);
  const orgId = resolveOrgId(req, body);
  const entryId = normalizeUuid(req?.query?.entry_id || body?.entry_id || body?.entryId);
  const mode = normalizeMode(req?.query?.mode || body?.mode) || 'capacity';

  if (!orgId) {
    return respond(context, 400, { message: 'invalid org id' });
  }

  if (!entryId) {
    return respond(context, 400, { message: 'invalid_entry_id' });
  }

  let role;
  try {
    role = await ensureMembership(supabase, orgId, userId);
  } catch (membershipError) {
    context.log?.error?.('waiting-list-suggestions failed to verify membership', {
      message: membershipError?.message,
      orgId,
      userId,
    });
    return respond(context, 500, { message: 'failed_to_verify_membership' });
  }

  if (!role || !isAdminOrOffice(role)) {
    return respond(context, 403, { message: 'forbidden' });
  }

  const { client: tenantClient, error: tenantError } = await resolveTenantClient(context, supabase, env, orgId);
  if (tenantError) {
    return respond(context, tenantError.status, tenantError.body);
  }

  const { data: entry, error: entryError } = await tenantClient
    .from('waiting_list_entries')
    .select(buildEntrySelect())
    .eq('id', entryId)
    .maybeSingle();

  if (entryError) {
    context.log?.error?.('waiting-list-suggestions failed to load entry', { message: entryError.message, entryId });
    return respond(context, 500, { message: 'failed_to_load_waiting_list_entry' });
  }

  if (!entry) {
    return respond(context, 404, { message: 'waiting_list_entry_not_found' });
  }

  if (!entry.desired_service_id) {
    return respond(context, 400, { message: 'waiting_list_entry_missing_service' });
  }

  const today = parseIsoDateInTimezone();

  const { data: instructorRows, error: instructorError } = await tenantClient
    .from('Employees')
    .select('id, first_name, middle_name, last_name, is_active')
    .eq('is_active', true);

  if (instructorError) {
    context.log?.error?.('waiting-list-suggestions failed to load instructors', { message: instructorError.message });
    return respond(context, 500, { message: 'failed_to_load_instructors' });
  }

  const instructorIds = Array.isArray(instructorRows) ? instructorRows.map((row) => row.id).filter(Boolean) : [];
  if (!instructorIds.length) {
    return respond(context, 200, {
      mode,
      entry_id: entry.id,
      suggestions: [],
      blocking_reason: 'missing_service_capability',
      fix_availability_targets: [],
    });
  }

  const [
    capabilityResult,
    templateResult,
  ] = await Promise.all([
    tenantClient
      .from('instructor_service_capabilities')
      .select('employee_id, service_id, max_students, availability_windows')
      .eq('service_id', entry.desired_service_id)
      .in('employee_id', instructorIds),
    tenantClient
      .from('lesson_templates')
      .select('id, student_id, instructor_employee_id, service_id, day_of_week, time_of_day, duration_minutes, valid_from, valid_until, is_active')
      .eq('is_active', true)
      .in('instructor_employee_id', instructorIds),
  ]);

  if (capabilityResult.error) {
    context.log?.error?.('waiting-list-suggestions failed to load service capabilities', { message: capabilityResult.error.message });
    return respond(context, 500, { message: 'failed_to_load_instructor_capabilities' });
  }

  if (templateResult.error) {
    context.log?.error?.('waiting-list-suggestions failed to load lesson templates', { message: templateResult.error.message });
    return respond(context, 500, { message: 'failed_to_load_lesson_templates' });
  }

  const instructorMap = new Map(
    (instructorRows || []).map((row) => [row.id, { ...row }]),
  );
  const capabilityMap = new Map(
    (capabilityResult.data || []).map((row) => [
      row.employee_id,
      {
        max_students: Number(row.max_students) || 1,
        duration_minutes: Number(entry?.service?.duration_minutes) || 60,
        availability_windows: Array.isArray(row.availability_windows) ? row.availability_windows : [],
      },
    ]),
  );

  const validTemplates = (templateResult.data || []).filter((template) => isTemplateValidOn(template, today));
  const templatesByInstructorDay = new Map();
  validTemplates.forEach((template) => {
    const key = `${template.instructor_employee_id}|${template.day_of_week}`;
    if (!templatesByInstructorDay.has(key)) {
      templatesByInstructorDay.set(key, []);
    }
    templatesByInstructorDay.get(key).push(template);
  });

  let suggestions = [];
  if (mode === 'capacity') {
    suggestions = buildCapacitySuggestions({
      entry,
      capabilityMap,
      instructorMap,
      validTemplates: validTemplates.filter((template) => template.service_id === entry.desired_service_id),
    });
  } else {
    suggestions = buildEmptySlotSuggestions({
      entry,
      capabilityMap,
      instructorMap,
      templatesByInstructorDay,
    });
  }

  suggestions.sort(compareSuggestions);
  const incompleteTargets = (capabilityResult.data || [])
    .filter((row) => !hasConfiguredAvailability(row.availability_windows))
    .map((row) => ({
      instructor_id: row.employee_id,
      instructor_name: formatPersonName(instructorMap.get(row.employee_id)),
      service_id: row.service_id,
      entry_id: entry.id,
      origin: 'waiting_list',
      fix_type: 'missing_service_availability',
    }));
  const missingCapabilityTargets = (capabilityResult.data || []).length === 0
    ? (instructorRows || []).map((row) => ({
        instructor_id: row.id,
        instructor_name: formatPersonName(instructorMap.get(row.id)),
        service_id: entry.desired_service_id,
        entry_id: entry.id,
        origin: 'waiting_list',
        fix_type: 'missing_service_capability',
      }))
    : [];
  const hasConfiguredCapability = (capabilityResult.data || []).some((row) => hasConfiguredAvailability(row.availability_windows));
  const blockingReason = suggestions.length > 0
    ? null
    : incompleteTargets.length > 0
      ? 'missing_service_availability'
      : hasConfiguredCapability
        ? 'no_matching_slots'
        : 'missing_service_capability';

  return respond(context, 200, {
    mode,
    entry_id: entry.id,
    suggestions: suggestions.slice(0, MAX_SUGGESTIONS),
    blocking_reason: blockingReason,
    fix_availability_targets: suggestions.length === 0
      ? (blockingReason === 'missing_service_capability' ? missingCapabilityTargets : incompleteTargets)
      : [],
  });
}
