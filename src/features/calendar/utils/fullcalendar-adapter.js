function toSafeNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeClockTime(value) {
  const text = typeof value === 'string' ? value.trim() : String(value || '').trim();
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(text);
  if (!match) return '';
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return '';
  }
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function dayTokenToJsDay(value) {
  switch (String(value || '').trim().toLowerCase()) {
    case 'sunday':
      return 0;
    case 'monday':
      return 1;
    case 'tuesday':
      return 2;
    case 'wednesday':
      return 3;
    case 'thursday':
      return 4;
    case 'friday':
      return 5;
    case 'saturday':
      return 6;
    default:
      return null;
  }
}

function buildResourceBusinessHours(serviceCapabilities) {
  if (!Array.isArray(serviceCapabilities)) {
    return [];
  }

  const seen = new Set();
  const businessHours = [];

  for (const capability of serviceCapabilities) {
    const windows = Array.isArray(capability?.availability_windows) ? capability.availability_windows : [];
    for (const window of windows) {
      const day = dayTokenToJsDay(window?.day);
      const startTime = normalizeClockTime(window?.start);
      const endTime = normalizeClockTime(window?.end);
      if (day == null || !startTime || !endTime) {
        continue;
      }

      const key = `${day}|${startTime}|${endTime}`;
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      businessHours.push({
        daysOfWeek: [day],
        startTime,
        endTime,
      });
    }
  }

  return businessHours;
}

export function calculateEventEnd(datetimeStart, durationMinutes) {
  const start = new Date(datetimeStart);
  if (Number.isNaN(start.getTime())) {
    return null;
  }

  const durationMs = Math.max(0, toSafeNumber(durationMinutes)) * 60 * 1000;
  return new Date(start.getTime() + durationMs).toISOString();
}

export function mapInstancesToEvents(instances) {
  if (!Array.isArray(instances)) {
    return [];
  }

  return instances
    .filter((instance) => instance?.id && instance?.datetime_start && instance?.instructor_employee_id)
    .map((instance) => {
      const firstStudent = instance.participants?.[0]?.student?.full_name || 'ללא תלמיד';
      const serviceName = instance.service?.service_name || 'שיעור';

      return {
        id: String(instance.id),
        title: `${serviceName} · ${firstStudent}`,
        start: instance.datetime_start,
        end: calculateEventEnd(instance.datetime_start, instance.duration_minutes),
        resourceId: String(instance.instructor_employee_id),
        extendedProps: {
          instance,
          service: instance.service || null,
          participants: Array.isArray(instance.participants) ? instance.participants : [],
          instructor: instance.instructor || null,
          status: instance.status || null,
          documentation_status: instance.documentation_status || null,
        },
      };
    });
}

export function mapInstructorsToResources(instructors) {
  if (!Array.isArray(instructors)) {
    return [];
  }

  return instructors
    .filter((instructor) => instructor?.id)
    .map((instructor) => ({
      id: String(instructor.id),
      title: instructor.full_name || instructor.email || 'ללא שם',
      businessHours: buildResourceBusinessHours(instructor.service_capabilities),
      extendedProps: {
        instructor,
      },
    }));
}
