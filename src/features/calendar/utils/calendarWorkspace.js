import { addLocalDays, getWeekStartDate, parseLocalDateString, toLocalDateString } from './localDate.js';
import { dayTokenForJsDay } from '@/lib/day-of-week.js';
import { getAvailabilityWindowsForDay, hasConfiguredAvailability } from '@/lib/instructor-availability.js';

export function buildCalendarViewDates(currentDate, viewMode) {
  const baseDate = parseLocalDateString(currentDate || '');
  if (!baseDate) {
    return [];
  }

  if (viewMode === 'week') {
    const weekStart = getWeekStartDate(baseDate);
    return Array.from({ length: 7 }, (_, index) => {
      const date = addLocalDays(weekStart, index);
      return {
        dateString: toLocalDateString(date),
        dayToken: dayTokenForJsDay(date?.getDay?.()),
      };
    }).filter((entry) => entry.dateString && entry.dayToken);
  }

  return [{
    dateString: currentDate,
    dayToken: dayTokenForJsDay(baseDate.getDay()),
  }].filter((entry) => entry.dateString && entry.dayToken);
}

export function getVisibleCalendarInstructors({ instructors, instances, currentDate, viewMode }) {
  const viewDates = buildCalendarViewDates(currentDate, viewMode);
  const dayTokens = viewDates.map((entry) => entry.dayToken).filter(Boolean);
  const instanceInstructorIds = new Set(
    (Array.isArray(instances) ? instances : [])
      .map((instance) => String(instance?.instructor_employee_id || ''))
      .filter(Boolean),
  );

  return (Array.isArray(instructors) ? instructors : []).filter((instructor) => {
    const capabilities = Array.isArray(instructor?.service_capabilities) ? instructor.service_capabilities : [];
    const hasAvailabilityInView = capabilities.some((capability) =>
      dayTokens.some((dayToken) => getAvailabilityWindowsForDay(capability?.availability_windows, dayToken).length > 0),
    );
    const hasEventsInView = instanceInstructorIds.has(String(instructor?.id || ''));
    return hasAvailabilityInView || hasEventsInView;
  });
}

export function buildCalendarWorkspaceSummary({ currentDate, viewMode, instances, instructors }) {
  const viewDates = buildCalendarViewDates(currentDate, viewMode);
  const dayTokens = viewDates.map((entry) => entry.dayToken).filter(Boolean);
  const visibleInstructors = getVisibleCalendarInstructors({ instructors, instances, currentDate, viewMode });
  const visibleInstructorIds = new Set(visibleInstructors.map((instructor) => String(instructor.id)));
  const allInstructors = Array.isArray(instructors) ? instructors : [];
  const visibleInstances = (Array.isArray(instances) ? instances : []).filter((instance) =>
    visibleInstructorIds.has(String(instance?.instructor_employee_id || '')),
  );

  const exceptionLessons = visibleInstances.filter((instance) => Boolean(instance?.metadata?.scheduling_override));
  const undocumentedCompleted = visibleInstances.filter((instance) =>
    instance?.status === 'completed' && instance?.documentation_status === 'undocumented',
  );
  const attentionLessons = visibleInstances
    .map((instance) => {
      const hasException = Boolean(instance?.metadata?.scheduling_override);
      const needsDocumentation = instance?.status === 'completed' && instance?.documentation_status === 'undocumented';
      if (!hasException && !needsDocumentation) {
        return null;
      }

      return {
        id: instance.id,
        instance,
        hasException,
        needsDocumentation,
      };
    })
    .filter(Boolean);
  const scopedAvailabilityInstructors = visibleInstructors.length > 0
    ? visibleInstructors
    : allInstructors.filter((instructor) => {
        const capabilities = Array.isArray(instructor?.service_capabilities) ? instructor.service_capabilities : [];
        return capabilities.some((capability) => !hasConfiguredAvailability(capability?.availability_windows))
          && capabilities.some((capability) => dayTokens.some((dayToken) => getAvailabilityWindowsForDay(capability?.availability_windows, dayToken).length === 0));
      });
  const availabilityIssues = scopedAvailabilityInstructors
    .map((instructor) => {
      const capabilities = Array.isArray(instructor?.service_capabilities) ? instructor.service_capabilities : [];
      const missingAvailabilityCapabilities = capabilities.filter((capability) => !hasConfiguredAvailability(capability?.availability_windows));
      if (!missingAvailabilityCapabilities.length) {
        return null;
      }

      return {
        instructorId: instructor.id,
        instructorName: instructor.full_name || instructor.email || 'מדריך/ה',
        missingCount: missingAvailabilityCapabilities.length,
        blocksVisibility: !visibleInstructorIds.has(String(instructor.id)),
        focusServiceId: missingAvailabilityCapabilities[0]?.service_id || '',
        missingServiceIds: missingAvailabilityCapabilities.map((capability) => capability.service_id).filter(Boolean),
      };
    })
    .filter(Boolean);
  const scheduledCount = visibleInstances.filter((instance) => instance?.status === 'scheduled').length;

  return {
    visibleInstructors,
    visibleInstances,
    scheduledCount,
    exceptionLessons,
    undocumentedCompleted,
    attentionLessons,
    availabilityIssues,
    attentionCount: attentionLessons.length + availabilityIssues.length,
  };
}
