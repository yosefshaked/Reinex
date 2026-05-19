/* eslint-env node */
import { normalizeString } from './org-bff.js';
import {
  getAvailabilityWindowsForDay,
  hasConfiguredAvailability,
  isWithinAvailabilityWindows,
  timeToMinutes,
} from './instructor-availability.js';
import { daySortValue, normalizeDayToken } from './day-of-week.js';
import {
  ceilClockTimeToGrid,
  ceilMinutesToGrid,
  normalizePreferredTimesToGrid,
  parseClockTimeToMinutes,
} from './time-grid.js';

export const WAITING_LIST_MATCH_MODES = new Set(['capacity', 'clear_space']);
export const GRID_STEP_MINUTES = 15;
export const MAX_WAITING_LIST_MATCH_CANDIDATES = 12;

const DAY_LABELS = Object.freeze({
  sunday: 'ראשון',
  monday: 'שני',
  tuesday: 'שלישי',
  wednesday: 'רביעי',
  thursday: 'חמישי',
  friday: 'שישי',
  saturday: 'שבת',
});

export function normalizeMatchMode(value, fallback = 'capacity') {
  const normalized = normalizeString(value).toLowerCase();
  return WAITING_LIST_MATCH_MODES.has(normalized) ? normalized : fallback;
}

export function parseIsoDateInTimezone(date = new Date(), timeZone = 'Asia/Jerusalem') {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

export function buildWaitingListEntrySelect() {
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
    'student:students(id, client_profile_id)',
    'client_profile:client_profiles(id, first_name, middle_name, last_name, identity_number, phone, email)',
    'service:Services(id, name, duration_minutes)',
  ].join(',');
}

export function formatWaitingListMatchTime(totalMinutes) {
  const safeMinutes = Math.max(0, Number(totalMinutes) || 0);
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function formatWaitingListMatchDay(dayOfWeek) {
  return DAY_LABELS[normalizeDayToken(dayOfWeek)] || '—';
}

export function formatWaitingListPersonName(person) {
  if (!person) return '—';
  return [person.first_name, person.middle_name, person.last_name].filter(Boolean).join(' ').trim() || '—';
}

export function isTemplateValidOn(template, dateKey) {
  const validFrom = normalizeString(template?.valid_from) || '0001-01-01';
  const validUntil = normalizeString(template?.valid_until) || '9999-12-31';
  return validFrom <= dateKey && dateKey <= validUntil;
}

export function getWaitingDays(createdAt, now = new Date()) {
  const created = new Date(createdAt || 0).getTime();
  const current = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(created) || created <= 0 || !Number.isFinite(current)) {
    return 0;
  }
  return Math.max(0, Math.floor((current - created) / 86400000));
}

function resolveEntryPerson(entry) {
  return entry?.client_profile || entry?.student || null;
}

function buildPreferredRangesMap(preferredTimes) {
  const map = new Map();
  const normalizedPreferredTimes = normalizePreferredTimesToGrid(preferredTimes) || [];
  normalizedPreferredTimes.forEach((entry) => {
    const day = normalizeDayToken(entry?.day);
    if (!day) return;
    const normalizedRanges = (Array.isArray(entry?.ranges) ? entry.ranges : [])
      .map((range) => ({
        start: parseClockTimeToMinutes(range?.start),
        end: parseClockTimeToMinutes(range?.end, { allowEndOfDay: true }),
      }))
      .filter((range) => range.start != null && range.end != null && range.end > range.start);
    if (normalizedRanges.length) {
      map.set(day, normalizedRanges);
    }
  });
  return map;
}

export function getPreferenceMatch(entry, dayOfWeek, startMinutes, durationMinutes) {
  const preferredDays = Array.isArray(entry?.preferred_days)
    ? entry.preferred_days.map((day) => normalizeDayToken(day)).filter(Boolean)
    : [];
  const preferredRangesMap = buildPreferredRangesMap(entry?.preferred_times);
  const endMinutes = startMinutes + durationMinutes;
  const normalizedDay = normalizeDayToken(dayOfWeek);
  const dayRanges = preferredRangesMap.get(normalizedDay) || [];

  if (dayRanges.some((range) => startMinutes >= range.start && endMinutes <= range.end)) {
    return 'exact';
  }

  if (preferredDays.includes(normalizedDay) || dayRanges.length > 0) {
    return 'day_only';
  }

  return 'none';
}

function hasTimePreferenceForDay(entry, dayOfWeek) {
  const normalizedDay = normalizeDayToken(dayOfWeek);
  if (!normalizedDay) return false;
  return (buildPreferredRangesMap(entry?.preferred_times).get(normalizedDay) || []).length > 0;
}

export function preferenceWeight(matchType) {
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

export function compareWaitingListSuggestions(left, right) {
  if ((right?.score || 0) !== (left?.score || 0)) {
    return (right?.score || 0) - (left?.score || 0);
  }
  if (Number(right?.priority_flag) !== Number(left?.priority_flag)) {
    return Number(right?.priority_flag) - Number(left?.priority_flag);
  }
  if ((right?.wait_days || 0) !== (left?.wait_days || 0)) {
    return (right?.wait_days || 0) - (left?.wait_days || 0);
  }
  if ((right?.available_seats || 0) !== (left?.available_seats || 0)) {
    return (right?.available_seats || 0) - (left?.available_seats || 0);
  }
  const dayDiff = daySortValue(left?.day_of_week) - daySortValue(right?.day_of_week);
  if (dayDiff !== 0) {
    return dayDiff;
  }
  return String(left?.time_of_day || '').localeCompare(String(right?.time_of_day || ''));
}

function buildCandidateBase({ entry, mode, score, matchType, instructor, instructorId, serviceId, dayOfWeek, startMinutes, durationMinutes, now }) {
  const person = resolveEntryPerson(entry);
  const waitDays = getWaitingDays(entry.created_at, now);
  return {
    mode,
    score: score + (entry.priority_flag ? 25 : 0) + Math.min(waitDays, 30),
    preference_match: matchType,
    priority_flag: Boolean(entry.priority_flag),
    wait_days: waitDays,
    entry_id: entry.id,
    waiting_list_entry_id: entry.id,
    client_profile_id: entry.client_profile_id || '',
    student_id: entry.student_id || '',
    student_name: formatWaitingListPersonName(person),
    service_id: serviceId,
    service_name: entry.service?.name || '—',
    instructor_id: instructorId,
    instructor_name: formatWaitingListPersonName(instructor),
    day_of_week: normalizeDayToken(dayOfWeek),
    day_label: formatWaitingListMatchDay(dayOfWeek),
    time_of_day: formatWaitingListMatchTime(startMinutes),
    duration_minutes: durationMinutes,
  };
}

function buildCapacitySuggestionsForEntry({ entry, capabilityMap, instructorMap, validTemplates, now = new Date() }) {
  const groupedTemplates = new Map();

  validTemplates.forEach((template) => {
    const key = [
      template.instructor_employee_id,
      template.service_id,
      template.day_of_week,
      ceilClockTimeToGrid(template.time_of_day),
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
    const capability = capabilityMap.get(`${anchor.instructor_employee_id}|${anchor.service_id}`);
    if (!capability) continue;
    if (!hasConfiguredAvailability(capability.availability_windows)) continue;

    const maxStudents = Number(capability.max_students) || 1;
    const currentStudents = templates.length;
    const availableSeats = maxStudents - currentStudents;
    if (availableSeats <= 0) continue;
    if (entry.student_id && templates.some((template) => template.student_id === entry.student_id)) continue;

    const roundedStartTime = ceilClockTimeToGrid(anchor.time_of_day);
    const startMinutes = timeToMinutes(roundedStartTime);
    const durationMinutes = Number(anchor.duration_minutes) || Number(entry?.service?.duration_minutes) || 60;
    if (startMinutes == null) continue;
    if (!isWithinAvailabilityWindows({
      availabilityWindows: capability.availability_windows,
      day: anchor.day_of_week,
      startTime: roundedStartTime,
      durationMinutes,
    })) {
      continue;
    }

    const matchType = getPreferenceMatch(entry, anchor.day_of_week, startMinutes, durationMinutes);
    if (hasTimePreferenceForDay(entry, anchor.day_of_week) && matchType !== 'exact') {
      continue;
    }

    const instructor = instructorMap.get(anchor.instructor_employee_id);
    const base = buildCandidateBase({
      entry,
      mode: 'capacity',
      score: preferenceWeight(matchType) + 30 + Math.min(availableSeats, 5),
      matchType,
      instructor,
      instructorId: anchor.instructor_employee_id,
      serviceId: anchor.service_id,
      dayOfWeek: anchor.day_of_week,
      startMinutes,
      durationMinutes,
      now,
    });

    suggestions.push({
      ...base,
      available_seats: availableSeats,
      current_students: currentStudents,
      capacity: maxStudents,
      source_template_id: anchor.id,
      source_template_ids: templates.map((template) => template.id).filter(Boolean),
      match_reason: `${buildReasonPrefix(matchType)}. בתבנית הקיימת יש כרגע ${currentStudents} מתוך ${maxStudents} תלמידים, ונשארו ${availableSeats} מקומות פנויים.`,
    });
  }

  return suggestions;
}

function buildCandidateWindows(dayOfWeek, entry, availabilityWindows) {
  const preferredRangesMap = buildPreferredRangesMap(entry?.preferred_times);
  const normalizedDay = normalizeDayToken(dayOfWeek);
  const explicitRanges = preferredRangesMap.get(normalizedDay);
  if (explicitRanges?.length) {
    const serviceWindows = getAvailabilityWindowsForDay(availabilityWindows, normalizedDay)
      .map((window) => ({
        start: ceilMinutesToGrid(timeToMinutes(window.start)),
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
        start: ceilMinutesToGrid(timeToMinutes(window.start)),
        end: timeToMinutes(window.end),
    }))
    .filter((window) => window.start != null && window.end != null && window.end > window.start);
}

function buildClearSpaceSuggestionsForEntry({ entry, capabilityMap, instructorMap, templatesByInstructorDay, now = new Date() }) {
  const suggestions = [];
  const preferredDays = Array.isArray(entry?.preferred_days)
    ? entry.preferred_days.map((day) => normalizeDayToken(day)).filter(Boolean)
    : [];

  for (const [key, capability] of capabilityMap.entries()) {
    const [instructorId, serviceId] = key.split('|');
    if (serviceId !== entry.desired_service_id) continue;
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
    const durationMinutes = Number(entry?.service?.duration_minutes) || Number(capability.duration_minutes) || 60;

    for (const dayOfWeek of candidateDays) {
      const existingTemplates = templatesByInstructorDay.get(`${instructorId}|${dayOfWeek}`) || [];
      const windows = buildCandidateWindows(dayOfWeek, entry, capability.availability_windows);

      windows.forEach((window) => {
        for (let start = window.start; start + durationMinutes <= window.end; start += GRID_STEP_MINUTES) {
          const end = start + durationMinutes;
          const hasConflict = existingTemplates.some((template) => {
            const templateStart = timeToMinutes(template.time_of_day);
            if (templateStart == null) return false;
            const templateEnd = templateStart + (Number(template.duration_minutes) || 0);
            return start < templateEnd && end > templateStart;
          });

          if (hasConflict) {
            continue;
          }

          const matchType = getPreferenceMatch(entry, dayOfWeek, start, durationMinutes);
          const base = buildCandidateBase({
            entry,
            mode: 'clear_space',
            score: preferenceWeight(matchType),
            matchType,
            instructor,
            instructorId,
            serviceId: entry.desired_service_id,
            dayOfWeek,
            startMinutes: start,
            durationMinutes,
            now,
          });

          suggestions.push({
            ...base,
            available_seats: 1,
            current_students: 0,
            capacity: Number(capability.max_students) || 1,
            source_template_id: null,
            source_template_ids: [],
            match_reason: `${buildReasonPrefix(matchType)}. נמצא חלון פנוי בלוח התבניות של ${formatWaitingListPersonName(instructor)} בתוך חלון הזמינות שהוגדר לשירות.`,
          });
        }
      });
    }
  }

  return suggestions;
}

export function buildTemplatesByInstructorDay(validTemplates) {
  const templatesByInstructorDay = new Map();
  validTemplates.forEach((template) => {
    const key = `${template.instructor_employee_id}|${normalizeDayToken(template.day_of_week)}`;
    if (!templatesByInstructorDay.has(key)) {
      templatesByInstructorDay.set(key, []);
    }
    templatesByInstructorDay.get(key).push(template);
  });
  return templatesByInstructorDay;
}

export function buildCapabilityMap(capabilityRows, serviceDurationMap = new Map()) {
  return new Map(
    (capabilityRows || []).map((row) => [
      `${row.employee_id}|${row.service_id}`,
      {
        service_id: row.service_id,
        max_students: Number(row.max_students) || 1,
        duration_minutes: Number(serviceDurationMap.get(row.service_id)) || 60,
        availability_windows: Array.isArray(row.availability_windows) ? row.availability_windows : [],
      },
    ]),
  );
}

export function buildInstructorMap(instructorRows) {
  return new Map((instructorRows || []).map((row) => [row.id, { ...row }]));
}

export function buildSuggestionsForEntry({
  entry,
  mode,
  capabilityMap,
  instructorMap,
  validTemplates,
  templatesByInstructorDay,
  now = new Date(),
}) {
  if (!entry || !['new', 'open'].includes(normalizeString(entry.status).toLowerCase())) {
    return [];
  }

  if (mode === 'clear_space') {
    return buildClearSpaceSuggestionsForEntry({
      entry,
      capabilityMap,
      instructorMap,
      templatesByInstructorDay,
      now,
    }).sort(compareWaitingListSuggestions);
  }

  return buildCapacitySuggestionsForEntry({
    entry,
    capabilityMap,
    instructorMap,
    validTemplates: (validTemplates || []).filter((template) => template.service_id === entry.desired_service_id),
    now,
  }).sort(compareWaitingListSuggestions);
}

export function buildLiveWaitingListMatches({
  entries,
  mode,
  capabilityMap,
  instructorMap,
  validTemplates,
  templatesByInstructorDay,
  now = new Date(),
}) {
  const templateMatches = {};
  const cellMatches = {};
  const allCandidates = [];
  const matchableEntryIds = new Set();
  const priorityEntryIds = new Set();
  const serviceMap = new Map();
  let oldestWaitDays = 0;

  for (const entry of entries || []) {
    const suggestions = buildSuggestionsForEntry({
      entry,
      mode,
      capabilityMap,
      instructorMap,
      validTemplates,
      templatesByInstructorDay,
      now,
    });
    if (!suggestions.length) continue;

    matchableEntryIds.add(entry.id);
    if (entry.priority_flag) {
      priorityEntryIds.add(entry.id);
    }
    oldestWaitDays = Math.max(oldestWaitDays, getWaitingDays(entry.created_at, now));
    const serviceId = entry.desired_service_id || '';
    if (serviceId) {
      const service = serviceMap.get(serviceId) || {
        service_id: serviceId,
        service_name: entry.service?.name || '—',
        count: 0,
      };
      service.count += 1;
      serviceMap.set(serviceId, service);
    }

    for (const candidate of suggestions.slice(0, MAX_WAITING_LIST_MATCH_CANDIDATES)) {
      allCandidates.push(candidate);
      if (mode === 'capacity') {
        const templateIds = candidate.source_template_ids?.length
          ? candidate.source_template_ids
          : [candidate.source_template_id].filter(Boolean);
        for (const templateId of templateIds) {
          if (!templateMatches[templateId]) {
            templateMatches[templateId] = { count: 0, candidates: [] };
          }
          templateMatches[templateId].count += 1;
          templateMatches[templateId].candidates.push(candidate);
        }
      } else {
        const cellKey = `${candidate.instructor_id}|${candidate.day_of_week}`;
        if (!cellMatches[cellKey]) {
          cellMatches[cellKey] = { count: 0, candidates: [] };
        }
        cellMatches[cellKey].count += 1;
        cellMatches[cellKey].candidates.push(candidate);
      }
    }
  }

  for (const bucket of [...Object.values(templateMatches), ...Object.values(cellMatches)]) {
    bucket.candidates.sort(compareWaitingListSuggestions);
    bucket.candidates = bucket.candidates.slice(0, MAX_WAITING_LIST_MATCH_CANDIDATES);
  }

  allCandidates.sort(compareWaitingListSuggestions);

  return {
    mode,
    summary: {
      matchable_entries: matchableEntryIds.size,
      priority_entries: priorityEntryIds.size,
      oldest_wait_days: oldestWaitDays,
      services: Array.from(serviceMap.values()).sort((left, right) => right.count - left.count).slice(0, 6),
    },
    template_matches: templateMatches,
    cell_matches: cellMatches,
    candidates: allCandidates.slice(0, MAX_WAITING_LIST_MATCH_CANDIDATES),
  };
}
