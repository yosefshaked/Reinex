function toSafeNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
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
      extendedProps: {
        instructor,
      },
    }));
}
