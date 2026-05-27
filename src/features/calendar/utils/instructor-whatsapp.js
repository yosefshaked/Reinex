import { getWeekStartDate, parseLocalDateString, toLocalDateString } from './localDate.js';
import { getParticipantDisplayNames } from './participantDisplay.js';

function formatDateLabel(dateInput) {
  const date = typeof dateInput === 'string' ? parseLocalDateString(dateInput) : dateInput;
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', year: 'numeric' });
}

function formatWeekdayDateLabel(dateInput) {
  const date = typeof dateInput === 'string' ? parseLocalDateString(dateInput) : dateInput;
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('he-IL', { weekday: 'short', day: 'numeric', month: 'numeric' });
}

function formatTimeLabel(dateInput) {
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function addMinutes(dateInput, durationMinutes) {
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const duration = Number(durationMinutes) || 0;
  return new Date(date.getTime() + duration * 60 * 1000);
}

function getWeekEndDate(dateString) {
  const weekEnd = getWeekStartDate(dateString);
  if (!(weekEnd instanceof Date) || Number.isNaN(weekEnd.getTime())) {
    return null;
  }
  weekEnd.setDate(weekEnd.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);
  return weekEnd;
}

function isSendableStatus(status) {
  return status === 'scheduled' || status === 'completed';
}

function getStudentNames(instance) {
  return getParticipantDisplayNames(instance?.participants, 'ללא לקוח/ה').join(', ');
}

function buildLessonLine(instance) {
  const serviceName = instance?.service?.service_name || 'שיעור';
  const endDate = addMinutes(instance?.datetime_start, instance?.duration_minutes);
  const timeRange = `${formatTimeLabel(instance?.datetime_start)}-${formatTimeLabel(endDate)}`;
  return `${timeRange} - ${getStudentNames(instance)} | ${serviceName}`;
}

const BREAK_TYPE_LABELS = {
  break: 'הפסקה',
  meeting: 'פגישה',
  unavailable: 'לא זמין',
  personal: 'אישי',
};

function buildBreakLine(breakItem) {
  const endDate = addMinutes(breakItem?.datetime_start, breakItem?.duration_minutes);
  const timeRange = `${formatTimeLabel(breakItem?.datetime_start)}-${formatTimeLabel(endDate)}`;
  const label = BREAK_TYPE_LABELS[breakItem?.break_type] || 'הפסקה';
  const note = breakItem?.note ? ` (${breakItem.note})` : '';
  return `${timeRange} - ${label}${note}`;
}

export function normalizeWhatsAppPhone(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const digits = raw.replace(/[^\d+]/g, '');
  const withoutPlus = digits.startsWith('+') ? digits.slice(1) : digits;

  if (withoutPlus.startsWith('972')) {
    return withoutPlus;
  }

  if (withoutPlus.startsWith('0')) {
    return `972${withoutPlus.slice(1)}`;
  }

  return withoutPlus;
}

export function buildWhatsAppLink(phone, message) {
  const normalizedPhone = normalizeWhatsAppPhone(phone);
  if (!normalizedPhone) return '';
  return `https://wa.me/${normalizedPhone}?text=${encodeURIComponent(message || '')}`;
}

export function getInstructorDayLessons(instances, instructorId, dateString) {
  return (Array.isArray(instances) ? instances : [])
    .filter((instance) => (
      instance?.instructor_employee_id === instructorId &&
      isSendableStatus(instance?.status) &&
      toLocalDateString(new Date(instance?.datetime_start)) === dateString
    ))
    .sort((left, right) => new Date(left.datetime_start).getTime() - new Date(right.datetime_start).getTime());
}

export function getInstructorDayBreaks(breaks, instructorId, dateString) {
  return (Array.isArray(breaks) ? breaks : [])
    .filter((breakItem) => (
      breakItem?.instructor_employee_id === instructorId &&
      toLocalDateString(new Date(breakItem?.datetime_start)) === dateString
    ))
    .sort((left, right) => new Date(left.datetime_start).getTime() - new Date(right.datetime_start).getTime());
}

export function getInstructorWeekLessons(instances, instructorId, dateString) {
  const weekStart = getWeekStartDate(dateString);
  const weekEnd = getWeekEndDate(dateString);
  if (!(weekStart instanceof Date) || Number.isNaN(weekStart.getTime()) || !(weekEnd instanceof Date) || Number.isNaN(weekEnd.getTime())) {
    return [];
  }

  return (Array.isArray(instances) ? instances : [])
    .filter((instance) => {
      if (instance?.instructor_employee_id !== instructorId || !isSendableStatus(instance?.status)) {
        return false;
      }
      const lessonDate = new Date(instance?.datetime_start);
      return lessonDate >= weekStart && lessonDate <= weekEnd;
    })
    .sort((left, right) => new Date(left.datetime_start).getTime() - new Date(right.datetime_start).getTime());
}

export function getInstructorWeekBreaks(breaks, instructorId, dateString) {
  const weekStart = getWeekStartDate(dateString);
  const weekEnd = getWeekEndDate(dateString);
  if (!(weekStart instanceof Date) || Number.isNaN(weekStart.getTime()) || !(weekEnd instanceof Date) || Number.isNaN(weekEnd.getTime())) {
    return [];
  }

  return (Array.isArray(breaks) ? breaks : [])
    .filter((breakItem) => {
      if (breakItem?.instructor_employee_id !== instructorId) return false;
      const breakDate = new Date(breakItem?.datetime_start);
      return breakDate >= weekStart && breakDate <= weekEnd;
    })
    .sort((left, right) => new Date(left.datetime_start).getTime() - new Date(right.datetime_start).getTime());
}

export function buildInstructorDayMessage({ instructorName, dateString, lessons, breaks = [] }) {
  const sortedItems = [
    ...lessons.map((item) => ({ type: 'lesson', datetime_start: item.datetime_start, item })),
    ...breaks.map((item) => ({ type: 'break', datetime_start: item.datetime_start, item })),
  ].sort((left, right) => new Date(left.datetime_start).getTime() - new Date(right.datetime_start).getTime());

  const lines = [
    `שלום ${instructorName},`,
    `הלקוחות שלך ל-${formatWeekdayDateLabel(dateString)}:`,
    '',
    ...sortedItems.map(({ type, item }) => (type === 'break' ? buildBreakLine(item) : buildLessonLine(item))),
    '',
    `סה״כ: ${lessons.length} שיעורים${breaks.length > 0 ? `, ${breaks.length} הפסקות` : ''}`,
  ];

  return lines.join('\n').trim();
}

export function buildInstructorWeekMessage({ instructorName, dateString, lessons, breaks = [] }) {
  const weekStart = getWeekStartDate(dateString);
  const weekEnd = getWeekEndDate(dateString);
  if (!(weekStart instanceof Date) || Number.isNaN(weekStart.getTime()) || !(weekEnd instanceof Date) || Number.isNaN(weekEnd.getTime())) {
    return '';
  }
  const groupedByDay = new Map();

  const allItems = [
    ...lessons.map((item) => ({ type: 'lesson', datetime_start: item.datetime_start, item })),
    ...breaks.map((item) => ({ type: 'break', datetime_start: item.datetime_start, item })),
  ].sort((left, right) => new Date(left.datetime_start).getTime() - new Date(right.datetime_start).getTime());

  allItems.forEach(({ type, datetime_start, item }) => {
    const dayKey = toLocalDateString(new Date(datetime_start));
    if (!groupedByDay.has(dayKey)) {
      groupedByDay.set(dayKey, []);
    }
    groupedByDay.get(dayKey).push({ type, item });
  });

  const dayBlocks = Array.from(groupedByDay.entries()).flatMap(([dayKey, dayItems], index) => {
    const block = [
      `${formatWeekdayDateLabel(dayKey)}`,
      ...dayItems.map(({ type, item }) => (type === 'break' ? buildBreakLine(item) : buildLessonLine(item))),
    ];

    if (index < groupedByDay.size - 1) {
      block.push('');
    }

    return block;
  });

  const lines = [
    `שלום ${instructorName},`,
    `הלקוחות שלך לשבוע ${formatDateLabel(weekStart)} - ${formatDateLabel(weekEnd)}:`,
    '',
    ...dayBlocks,
    '',
    `סה״כ: ${lessons.length} שיעורים${breaks.length > 0 ? `, ${breaks.length} הפסקות` : ''}`,
  ];

  return lines.join('\n').trim();
}
