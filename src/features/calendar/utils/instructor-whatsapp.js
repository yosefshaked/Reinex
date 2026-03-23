function toLocalDateString(dateObj) {
  if (!(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) return null;
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateLabel(dateInput) {
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', year: 'numeric' });
}

function formatWeekdayDateLabel(dateInput) {
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
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

function getWeekStartDate(dateString) {
  const date = new Date(dateString);
  const day = date.getDay();
  date.setDate(date.getDate() - day);
  date.setHours(0, 0, 0, 0);
  return date;
}

function getWeekEndDate(dateString) {
  const weekEnd = getWeekStartDate(dateString);
  weekEnd.setDate(weekEnd.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);
  return weekEnd;
}

function isSendableStatus(status) {
  return status === 'scheduled' || status === 'completed';
}

function getStudentNames(instance) {
  const names = Array.isArray(instance?.participants)
    ? instance.participants
      .map((participant) => participant?.student?.full_name)
      .filter(Boolean)
    : [];

  return names.length ? names.join(', ') : 'ללא תלמיד';
}

function buildLessonLine(instance) {
  const serviceName = instance?.service?.service_name || 'שיעור';
  const endDate = addMinutes(instance?.datetime_start, instance?.duration_minutes);
  const timeRange = `${formatTimeLabel(instance?.datetime_start)}-${formatTimeLabel(endDate)}`;
  return `${timeRange} - ${getStudentNames(instance)} | ${serviceName}`;
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

export function getInstructorWeekLessons(instances, instructorId, dateString) {
  const weekStart = getWeekStartDate(dateString);
  const weekEnd = getWeekEndDate(dateString);

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

export function buildInstructorDayMessage({ instructorName, dateString, lessons }) {
  const lines = [
    `שלום ${instructorName},`,
    `התלמידים שלך ל-${formatWeekdayDateLabel(dateString)}:`,
    '',
    ...lessons.map(buildLessonLine),
    '',
    `סה״כ: ${lessons.length} שיעורים`,
  ];

  return lines.join('\n').trim();
}

export function buildInstructorWeekMessage({ instructorName, dateString, lessons }) {
  const weekStart = getWeekStartDate(dateString);
  const weekEnd = getWeekEndDate(dateString);
  const groupedByDay = new Map();

  lessons.forEach((lesson) => {
    const dayKey = toLocalDateString(new Date(lesson.datetime_start));
    if (!groupedByDay.has(dayKey)) {
      groupedByDay.set(dayKey, []);
    }
    groupedByDay.get(dayKey).push(lesson);
  });

  const dayBlocks = Array.from(groupedByDay.entries()).flatMap(([dayKey, dayLessons], index) => {
    const block = [
      `${formatWeekdayDateLabel(dayKey)}`,
      ...dayLessons.map(buildLessonLine),
    ];

    if (index < groupedByDay.size - 1) {
      block.push('');
    }

    return block;
  });

  const lines = [
    `שלום ${instructorName},`,
    `התלמידים שלך לשבוע ${formatDateLabel(weekStart)} - ${formatDateLabel(weekEnd)}:`,
    '',
    ...dayBlocks,
    '',
    `סה״כ: ${lessons.length} שיעורים`,
  ];

  return lines.join('\n').trim();
}
