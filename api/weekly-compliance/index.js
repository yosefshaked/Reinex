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
  resolveTenantClient,
} from '../_shared/org-bff.js';
import { ensureInstructorColors, resolveInstructorColor } from '../_shared/instructor-colors.js';

const DAY_LABELS = Object.freeze([
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
]);

const GRID_INTERVAL_MINUTES = 30;
const DEFAULT_SESSION_DURATION_MINUTES = 30;
const UNASSIGNED_COLOR = '#6B7280';
const UNASSIGNED_LABEL = 'לא משויך';

function startOfUtcDay(dateLike) {
  const date = dateLike instanceof Date ? dateLike : new Date(dateLike);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function startOfUtcWeek(dateLike) {
  const dayStart = startOfUtcDay(dateLike);
  const dayOfWeek = dayStart.getUTCDay();
  const start = new Date(dayStart);
  start.setUTCDate(start.getUTCDate() - dayOfWeek);
  return start;
}

function addDaysUtc(dateLike, days) {
  const date = new Date(dateLike);
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function formatUtcDate(dateLike) {
  const date = new Date(dateLike);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeDateString(value) {
  const raw = normalizeString(value);
  if (!raw) {
    return '';
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }
  if (raw.length >= 10) {
    return raw.slice(0, 10);
  }
  return '';
}

function parseWeekStart(value) {
  if (!value || typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return null;
  }
  try {
    const parsed = new Date(`${trimmed}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }
    return startOfUtcWeek(parsed);
  } catch {
    return null;
  }
}

function parseTimeToMinutes(value) {
  if (!value) {
    return null;
  }
  const raw = String(value).trim();
  if (!raw) {
    return null;
  }
  const match = raw.match(/^(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) {
    return null;
  }
  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  const seconds = match[3] ? Number.parseInt(match[3], 10) : 0;
  if (Number.isNaN(hours) || Number.isNaN(minutes) || Number.isNaN(seconds)) {
    return null;
  }
  return hours * 60 + minutes + Math.floor(seconds / 60);
}

function minutesToTimeString(totalMinutes) {
  const minutes = Math.max(0, Number(totalMinutes) || 0);
  const hoursPart = Math.floor(minutes / 60);
  const minutesPart = minutes % 60;
  return `${String(hoursPart).padStart(2, '0')}:${String(minutesPart).padStart(2, '0')}`;
}

function alignToInterval(value, interval) {
  if (!Number.isFinite(value)) {
    return null;
  }
  const size = Math.max(1, Number(interval) || GRID_INTERVAL_MINUTES);
  return {
    floor: Math.floor(value / size) * size,
    ceil: Math.ceil(value / size) * size,
  };
}

function buildTimeWindow(earliestMinutes, latestMinutes) {
  if (!Number.isFinite(earliestMinutes) || !Number.isFinite(latestMinutes)) {
    return null;
  }

  const alignedStart = alignToInterval(Math.max(0, earliestMinutes), GRID_INTERVAL_MINUTES)?.floor;
  const alignedEnd = alignToInterval(Math.min(24 * 60, latestMinutes + GRID_INTERVAL_MINUTES), GRID_INTERVAL_MINUTES)?.ceil;

  const roundedStart = Number.isFinite(alignedStart) ? alignedStart : 0;
  let roundedEnd = Number.isFinite(alignedEnd) ? alignedEnd : roundedStart + GRID_INTERVAL_MINUTES;
  roundedEnd = Math.min(24 * 60, Math.max(roundedStart + GRID_INTERVAL_MINUTES, roundedEnd));

  if (roundedEnd <= roundedStart) {
    roundedEnd = Math.min(24 * 60, roundedStart + GRID_INTERVAL_MINUTES);
  }

  return {
    start: minutesToTimeString(roundedStart),
    end: minutesToTimeString(roundedEnd),
    startMinutes: roundedStart,
    endMinutes: roundedEnd,
    intervalMinutes: GRID_INTERVAL_MINUTES,
  };
}

function determineStatus(hasRecord, isoDate, todayIso) {
  if (!isoDate || !todayIso) {
    return hasRecord ? 'complete' : 'upcoming';
  }
  if (isoDate <= todayIso) {
    return hasRecord ? 'complete' : 'missing';
  }
  return hasRecord ? 'complete' : 'upcoming';
}

export default async function (context, req) {
  const method = String(req.method || 'GET').toUpperCase();
  if (method !== 'GET') {
    return respond(context, 405, { message: 'method_not_allowed' }, { Allow: 'GET' });
  }

  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);

  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('weekly-compliance missing Supabase admin credentials');
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    context.log?.warn?.('weekly-compliance missing bearer token');
    return respond(context, 401, { message: 'missing bearer' });
  }

  const supabase = createSupabaseAdminClient(adminConfig, {
    global: { headers: { 'Cache-Control': 'no-store' } },
  });

  let authResult;
  try {
    authResult = await supabase.auth.getUser(authorization.token);
  } catch (error) {
    context.log?.error?.('weekly-compliance failed to validate token', { message: error?.message });
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  const userId = authResult.data.user.id;
  const orgId = resolveOrgId(req, null);

  if (!orgId) {
    return respond(context, 400, { message: 'invalid org id' });
  }

  let role;
  try {
    role = await ensureMembership(supabase, orgId, userId);
  } catch (membershipError) {
    context.log?.error?.('weekly-compliance failed to verify membership', {
      message: membershipError?.message,
      orgId,
      userId,
    });
    return respond(context, 500, { message: 'failed_to_verify_membership' });
  }

  if (!role) {
    return respond(context, 403, { message: 'forbidden' });
  }

  const { client: tenantClient, error: tenantError } = await resolveTenantClient(context, supabase, env, orgId);
  if (tenantError) {
    return respond(context, tenantError.status, tenantError.body);
  }

  const weekStartQuery = normalizeString(req?.query?.week_start || req?.query?.weekStart);
  const requestedWeekStart = parseWeekStart(weekStartQuery);
  const today = startOfUtcDay(new Date());
  const weekStart = requestedWeekStart || startOfUtcWeek(today);
  const weekEnd = addDaysUtc(weekStart, 6);
  const todayIso = formatUtcDate(today);

  const colorsResult = await ensureInstructorColors(tenantClient, {
    context,
    columns: 'id, name, metadata, is_active',
  });

  if (colorsResult?.error) {
    context.log?.error?.('weekly-compliance failed to ensure instructor colors', {
      message: colorsResult.error.message,
    });
    return respond(context, 500, { message: 'failed_to_prepare_instructors' });
  }

  const instructors = Array.isArray(colorsResult?.data) ? colorsResult.data : [];
  const instructorMap = new Map();
  for (const instructor of instructors) {
    const id = normalizeString(instructor?.id);
    const name = normalizeString(instructor?.name) || instructor?.name || '';
    const color = resolveInstructorColor(instructor?.metadata);
    if (id && color) {
      instructorMap.set(id, {
        id,
        name: name || id,
        color,
        isActive: instructor?.is_active !== false,
      });
    }
  }

  let studentQuery = tenantClient
    .from('Students')
    .select('id, name, assigned_instructor_id, default_day_of_week, default_session_time, is_active');

  studentQuery = studentQuery.eq('is_active', true);

  // Filter by instructor: non-admins see only their students, admins can filter by specific instructor
  const instructorIdFilter = normalizeString(req.query?.instructor_id);
  if (!isAdminRole(role)) {
    studentQuery = studentQuery.eq('assigned_instructor_id', userId);
  } else if (instructorIdFilter) {
    studentQuery = studentQuery.eq('assigned_instructor_id', instructorIdFilter);
  }

  const { data: studentRows, error: studentError } = await studentQuery;

  if (studentError) {
    context.log?.error?.('weekly-compliance failed to load students', { message: studentError.message });
    return respond(context, 500, { message: 'failed_to_load_students' });
  }

  const students = Array.isArray(studentRows) ? studentRows : [];
  const relevantStudents = students.filter(student => {
    const dayOfWeek = Number.parseInt(student?.default_day_of_week, 10);
    const timeMinutes = parseTimeToMinutes(student?.default_session_time);
    return Number.isInteger(dayOfWeek) && dayOfWeek >= 1 && dayOfWeek <= 7 && timeMinutes !== null;
  });

  const studentIdSet = new Set();
  for (const student of relevantStudents) {
    const id = normalizeString(student.id);
    if (id) {
      studentIdSet.add(id);
    }
  }
  const studentIds = Array.from(studentIdSet);

  const recordsByKey = new Map();
  if (studentIds.length) {
    let recordQuery = tenantClient
      .from('SessionRecords')
      .select('id, student_id, date')
      .gte('date', formatUtcDate(weekStart))
      .lte('date', formatUtcDate(weekEnd))
      .eq('deleted', false);

    recordQuery = recordQuery.in('student_id', studentIds);

    const { data: recordRows, error: recordError } = await recordQuery;
    if (recordError) {
      context.log?.error?.('weekly-compliance failed to load session records', { message: recordError.message });
      return respond(context, 500, { message: 'failed_to_load_sessions' });
    }

    if (Array.isArray(recordRows)) {
      for (const record of recordRows) {
        const recordStudentId = normalizeString(record?.student_id);
        const recordDate = normalizeDateString(record?.date);
        const key = recordStudentId && recordDate ? `${recordStudentId}|${recordDate}` : null;
        if (key && !recordsByKey.has(key)) {
          recordsByKey.set(key, record?.id || true);
        }
      }
    }
  }

  const usedInstructorIds = new Set();
  let earliestMinutes = Number.POSITIVE_INFINITY;
  let latestMinutes = Number.NEGATIVE_INFINITY;

  const days = DAY_LABELS.map((label, index) => {
    const date = addDaysUtc(weekStart, index);
    const isoDate = formatUtcDate(date);
    const sessions = [];

    for (const student of relevantStudents) {
      const studentDay = Number.parseInt(student.default_day_of_week, 10);
      if (studentDay !== index + 1) {
        continue;
      }

      const timeMinutes = parseTimeToMinutes(student.default_session_time);
      if (timeMinutes === null) {
        continue;
      }

      const key = `${normalizeString(student.id)}|${isoDate}`;
      const hasRecord = recordsByKey.has(key);
      const status = determineStatus(hasRecord, isoDate, todayIso);

      const instructorId = normalizeString(student.assigned_instructor_id);
      const instructor = instructorId ? instructorMap.get(instructorId) : null;
      if (instructor) {
        usedInstructorIds.add(instructor.id);
      }

      const color = instructor?.color || UNASSIGNED_COLOR;
      const instructorName = instructor?.name || UNASSIGNED_LABEL;

      sessions.push({
        studentId: normalizeString(student.id),
        studentName: student?.name || '',
        instructorId: instructor?.id || null,
        instructorName,
        instructorColor: color,
        instructorIsActive: instructor?.isActive !== false,
        time: minutesToTimeString(timeMinutes),
        timeMinutes,
        status,
        hasRecord,
        recordId: hasRecord ? recordsByKey.get(key) || null : null,
        durationMinutes: DEFAULT_SESSION_DURATION_MINUTES,
      });

      if (timeMinutes < earliestMinutes) {
        earliestMinutes = timeMinutes;
      }
      if (timeMinutes > latestMinutes) {
        latestMinutes = timeMinutes;
      }
    }

    sessions.sort((a, b) => {
      if (a.timeMinutes !== b.timeMinutes) {
        return a.timeMinutes - b.timeMinutes;
      }
      return a.studentName.localeCompare(b.studentName || '', 'he');
    });

    return {
      date: isoDate,
      label,
      dayOfWeek: index + 1,
      sessions,
    };
  });

  const legend = [];
  for (const instructorId of usedInstructorIds) {
    const instructor = instructorMap.get(instructorId);
    if (instructor) {
      legend.push({
        id: instructor.id,
        name: instructor.name,
        color: instructor.color,
        isActive: instructor.isActive,
      });
    }
  }

  const includesUnassigned = days.some(day => day.sessions.some(session => !session.instructorId));
  if (includesUnassigned) {
    legend.push({
      id: 'unassigned',
      name: UNASSIGNED_LABEL,
      color: UNASSIGNED_COLOR,
      isActive: true,
    });
  }

  legend.sort((a, b) => a.name.localeCompare(b.name, 'he'));

  const timeWindow = Number.isFinite(earliestMinutes) && Number.isFinite(latestMinutes)
    ? buildTimeWindow(earliestMinutes, latestMinutes)
    : null;

  return respond(context, 200, {
    weekStart: formatUtcDate(weekStart),
    weekEnd: formatUtcDate(weekEnd),
    today: todayIso,
    scope: isAdminRole(role) ? 'organization' : 'instructor',
    intervalMinutes: GRID_INTERVAL_MINUTES,
    sessionDurationMinutes: DEFAULT_SESSION_DURATION_MINUTES,
    timeWindow,
    legend,
    days,
  });
}
