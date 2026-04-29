import { addLocalDays, getWeekStartDate, parseLocalDateString, toLocalDateString } from './localDate.js';
import { dayTokenForJsDay } from '@/lib/day-of-week.js';
import { getAvailabilityWindowsForDay, hasConfiguredAvailability } from '@/lib/instructor-availability.js';

const RESOLVED_PARTICIPANT_STATUSES = new Set(['attended', 'no_show', 'cancelled_student', 'cancelled_clinic']);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function getWorkflowState(instance) {
  return instance?.metadata?.workflow_state && typeof instance.metadata.workflow_state === 'object'
    ? instance.metadata.workflow_state
    : null;
}

function getWorkflowReasons(instance) {
  return asArray(getWorkflowState(instance)?.reasons_open).map((reason) => String(reason || '').trim()).filter(Boolean);
}

function hasScheduledParticipants(instance) {
  return asArray(instance?.participants).some((participant) => (
    String(participant?.participant_status || '').trim().toLowerCase() === 'scheduled'
  ));
}

function hasReminderPending(instance) {
  return asArray(instance?.participants).some((participant) => (
    participant?.reminder_sent === true
    && participant?.reminder_seen !== true
    && String(participant?.participant_status || '').trim().toLowerCase() === 'scheduled'
  ));
}

function hasResolvedAttendance(instance) {
  const participants = asArray(instance?.participants);
  return participants.length > 0 && participants.every((participant) => (
    RESOLVED_PARTICIPANT_STATUSES.has(String(participant?.participant_status || '').trim().toLowerCase())
  ));
}

function isPastOrStarted(instance, now = new Date()) {
  const start = new Date(instance?.datetime_start);
  if (Number.isNaN(start.getTime())) {
    return false;
  }
  return start.getTime() <= now.getTime();
}

export function getLessonOpenActions(instance, now = new Date()) {
  if (!instance?.id) {
    return [];
  }

  const actions = [];
  const workflowReasons = getWorkflowReasons(instance);
  const status = String(instance?.status || '').trim().toLowerCase();
  const hasException = Boolean(instance?.metadata?.scheduling_override);
  const needsDocumentation = status === 'completed' && instance?.documentation_status === 'undocumented';
  const attendanceOpen = hasScheduledParticipants(instance) && (status === 'completed' || isPastOrStarted(instance, now));

  if (attendanceOpen) {
    actions.push({
      id: 'attendance',
      label: 'סימון נוכחות',
      description: 'יש משתתפים שעדיין במצב מתוכנן.',
      tone: 'warn',
    });
  }

  if (hasReminderPending(instance)) {
    actions.push({
      id: 'reminders',
      label: 'אישורי הגעה',
      description: 'נשלחו תזכורות ועדיין חסרים אישורים.',
      tone: 'default',
    });
  }

  if (needsDocumentation) {
    actions.push({
      id: 'documentation',
      label: 'תיעוד חסר',
      description: 'השיעור הושלם ועדיין ממתין לתיעוד.',
      tone: 'warn',
    });
  }

  if (workflowReasons.includes('student_billing_unresolved')) {
    actions.push({
      id: 'billing',
      label: 'חיוב פתוח',
      description: 'יש חיוב תלמידים שעדיין לא נסגר.',
      tone: 'warn',
    });
  }

  if (workflowReasons.includes('instructor_compensation_unresolved')) {
    actions.push({
      id: 'payroll',
      label: 'שכר מדריך פתוח',
      description: 'שכר המדריך עדיין לא נסגר דרך הרצת שכר.',
      tone: 'warn',
    });
  }

  if (workflowReasons.includes('hmo_claim_unresolved')) {
    actions.push({
      id: 'hmo',
      label: 'תביעת גורם מממן',
      description: 'יש תביעת גורם מממן שעדיין דורשת טיפול.',
      tone: 'warn',
    });
  }

  if (hasException) {
    actions.push({
      id: 'exception',
      label: 'חריגה חד-פעמית',
      description: instance.metadata.scheduling_override?.reason || 'השיעור נשמר מחוץ לכללי השיבוץ הרגילים.',
      tone: 'default',
    });
  }

  if (actions.length === 0 && hasResolvedAttendance(instance) && instance?.is_closed !== true) {
    actions.push({
      id: 'closure',
      label: 'בדיקת סגירה',
      description: 'הנוכחות הוכרעה, אך השיעור עדיין פתוח תפעולית.',
      tone: 'default',
    });
  }

  return actions;
}

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
  const now = new Date();
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
  const attendanceOpen = visibleInstances.filter((instance) => (
    hasScheduledParticipants(instance) && (String(instance?.status || '').trim().toLowerCase() === 'completed' || isPastOrStarted(instance, now))
  ));
  const reminderPending = visibleInstances.filter(hasReminderPending);
  const billingOpen = visibleInstances.filter((instance) => getWorkflowReasons(instance).includes('student_billing_unresolved'));
  const payrollOpen = visibleInstances.filter((instance) => getWorkflowReasons(instance).includes('instructor_compensation_unresolved'));
  const hmoOpen = visibleInstances.filter((instance) => getWorkflowReasons(instance).includes('hmo_claim_unresolved'));
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
  const attentionQueues = [
    {
      id: 'attendance',
      label: 'נוכחות פתוחה',
      description: 'שיעורים שהתחילו או הושלמו ועדיין יש בהם משתתפים ללא הכרעה.',
      count: attendanceOpen.length,
      items: attendanceOpen.map((instance) => ({ id: instance.id, instance })),
      tone: 'warn',
    },
    {
      id: 'documentation',
      label: 'תיעוד חסר',
      description: 'שיעורים שהושלמו ועדיין ממתינים לתיעוד.',
      count: undocumentedCompleted.length,
      items: undocumentedCompleted.map((instance) => ({ id: instance.id, instance })),
      tone: 'warn',
    },
    {
      id: 'exceptions',
      label: 'חריגות שיבוץ',
      description: 'שיעורים שנשמרו כחריגה חד-פעמית.',
      count: exceptionLessons.length,
      items: exceptionLessons.map((instance) => ({ id: instance.id, instance })),
      tone: 'default',
    },
    {
      id: 'reminders',
      label: 'אישורי הגעה',
      description: 'תזכורות שנשלחו ועדיין ממתינות לאישור.',
      count: reminderPending.length,
      items: reminderPending.map((instance) => ({ id: instance.id, instance })),
      tone: 'default',
    },
    {
      id: 'finance',
      label: 'חיוב / שכר / גורם מממן',
      description: 'שיעורים עם חסימות סגירה פיננסיות או תביעות פתוחות.',
      count: new Set([...billingOpen, ...payrollOpen, ...hmoOpen].map((instance) => instance.id)).size,
      items: [...new Map([...billingOpen, ...payrollOpen, ...hmoOpen].map((instance) => [instance.id, { id: instance.id, instance }])).values()],
      tone: 'warn',
    },
    {
      id: 'availability',
      label: 'הגדרת זמינות',
      description: 'מדריכים או שירותים שחסרה להם זמינות ולכן קשה לשבץ אותם.',
      count: availabilityIssues.length,
      items: availabilityIssues.map((issue) => ({ id: issue.instructorId, availabilityIssue: issue })),
      tone: 'warn',
    },
  ].filter((queue) => queue.count > 0);
  const activeCapabilities = allInstructors.flatMap((instructor) => asArray(instructor?.service_capabilities));
  const hasAvailabilityInSelectedRange = activeCapabilities.some((capability) => (
    dayTokens.some((dayToken) => getAvailabilityWindowsForDay(capability?.availability_windows, dayToken).length > 0)
  ));
  const emptyState = (() => {
    if (visibleInstructors.length > 0) {
      return null;
    }

    const blockingAvailabilityIssue = availabilityIssues.find((issue) => issue.blocksVisibility) || availabilityIssues[0] || null;
    if (allInstructors.length === 0) {
      return {
        kind: 'no_instructors',
        title: 'אין מדריכים להצגה בלוח',
        description: 'כדי להתחיל לשבץ שיעורים, צריך ליצור מדריכים פעילים ולהגדיר להם שירותים וזמינות.',
        primaryAction: 'employees',
        primaryLabel: 'פתח צוות',
        secondaryAction: 'create_lesson',
        secondaryLabel: 'שיעור חדש',
      };
    }

    if (activeCapabilities.length === 0) {
      return {
        kind: 'missing_capabilities',
        title: 'המדריכים קיימים, אבל חסרות יכולות שירות',
        description: 'הלוח מציג מדריכים לפי שירותים וזמינות. הגדירו לכל מדריך אילו שירותים הוא יכול להעביר.',
        primaryAction: 'employees',
        primaryLabel: 'הגדר יכולות שירות',
        secondaryAction: 'services',
        secondaryLabel: 'פתח שירותים',
      };
    }

    if (blockingAvailabilityIssue) {
      return {
        kind: 'missing_availability',
        title: 'אין זמינות מוגדרת לטווח שנבחר',
        description: 'קיימים מדריכים ושירותים, אבל אין חלונות זמינות שמתאימים ליום או לשבוע הזה.',
        primaryAction: 'fix_availability',
        primaryLabel: 'תקן זמינות',
        secondaryAction: 'create_lesson',
        secondaryLabel: 'שיעור חריג',
        availabilityIssue: blockingAvailabilityIssue,
      };
    }

    if (!hasAvailabilityInSelectedRange) {
      return {
        kind: 'no_availability_in_range',
        title: 'אין חלונות זמינות בטווח שנבחר',
        description: 'הוגדרו יכולות שירות, אבל אין זמינות שמתאימה ליום או לשבוע הזה. בדקו את חלונות הזמינות של המדריכים.',
        primaryAction: 'employees',
        primaryLabel: 'פתח זמינות מדריכים',
        secondaryAction: 'create_lesson',
        secondaryLabel: 'שיעור חריג',
      };
    }

    return {
      kind: 'empty_schedule',
      title: 'אין שיעורים בטווח הזה',
      description: 'הזמינות קיימת, אבל עדיין לא שובצו שיעורים ליום או לשבוע שנבחר.',
      primaryAction: 'create_lesson',
      primaryLabel: 'שיעור חדש',
      secondaryAction: 'templates',
      secondaryLabel: 'יצירה מתבניות',
    };
  })();

  return {
    visibleInstructors,
    visibleInstances,
    scheduledCount,
    exceptionLessons,
    undocumentedCompleted,
    attendanceOpen,
    reminderPending,
    billingOpen,
    payrollOpen,
    hmoOpen,
    attentionLessons,
    availabilityIssues,
    attentionQueues,
    emptyState,
    attentionCount: attentionQueues.reduce((sum, queue) => sum + queue.count, 0),
  };
}
