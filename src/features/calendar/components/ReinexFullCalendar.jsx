import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import interactionPlugin from '@fullcalendar/interaction';
import timeGridPlugin from '@fullcalendar/timegrid';
import resourceTimeGridPlugin from '@fullcalendar/resource-timegrid';
import heLocale from '@fullcalendar/core/locales/he';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { authenticatedFetch } from '@/lib/api-client.js';
import { Button } from '@/components/ui/button.jsx';
import { Label } from '@/components/ui/label.jsx';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useOrg } from '@/org/OrgContext.jsx';
import { useRuntimeConfig } from '@/runtime/RuntimeConfigContext.jsx';
import { dayTokenForJsDay } from '@/lib/day-of-week.js';
import {
  getAvailabilityWindowsForDay,
  hasConfiguredAvailability,
  isWithinAvailabilityWindows,
  timeToMinutes,
} from '@/lib/instructor-availability.js';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog.jsx';
import { Textarea } from '@/components/ui/textarea.jsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select.jsx';
import { formatTimeDisplay, getInstanceStatusIcon } from '../utils/timeGrid';
import { mapInstancesToEvents, mapInstructorsToResources } from '../utils/fullcalendar-adapter.js';
import {
  buildSchedulingOverrideReasonDetails,
  hasValidSchedulingOverrideReason,
  resolveSchedulingOverrideFormState,
  SCHEDULING_OVERRIDE_REASON_OPTIONS,
} from '../utils/schedulingOverride.js';
import { getParticipantDisplayName } from '../utils/participantDisplay.js';
import { addLocalDays, CALENDAR_WEEK_START, getWeekStartDate, parseLocalDateString, toLocalDateString as toCalendarLocalDateString } from '../utils/localDate.js';
import './reinex-fullcalendar.css';

function toLocalDateString(dateObj) {
  if (!(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) return null;
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function resolveViewDates(currentDate, viewMode) {
  const baseDate = parseLocalDateString(currentDate || '');
  if (!baseDate) {
    return [];
  }

  if (viewMode === 'week') {
    const weekStart = getWeekStartDate(baseDate, CALENDAR_WEEK_START);
    return Array.from({ length: 7 }, (_, index) => {
      const date = addLocalDays(weekStart, index);
      const dateString = toCalendarLocalDateString(date);
      return {
        dateString,
        dayToken: dayTokenForJsDay(date?.getDay?.()),
      };
    }).filter((entry) => entry.dateString && entry.dayToken);
  }

  return [{
    dateString: currentDate,
    dayToken: dayTokenForJsDay(baseDate.getDay()),
  }].filter((entry) => entry.dateString && entry.dayToken);
}

function formatCalendarTime(minutes) {
  const clamped = Math.max(0, Math.min(24 * 60, Number(minutes) || 0));
  const hours = Math.floor(clamped / 60);
  const mins = clamped % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:00`;
}

function getDateTimeLocalMinutes(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return null;
  }
  return (date.getHours() * 60) + date.getMinutes();
}

function getLocalStartTime(date) {
  const minutes = getDateTimeLocalMinutes(date);
  if (minutes == null) return '';
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

function formatPreviewValue(field, value) {
  if (value == null || value === '') {
    return '—';
  }

  if (field === 'datetime_start') {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleString('he-IL', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
    }
  }

  if (field === 'duration_minutes') {
    return `${value} דקות`;
  }

  return String(value);
}

function getPreviewImpactClass(severity) {
  if (severity === 'blocking') {
    return 'border-red-200 bg-red-50 text-red-950';
  }
  if (severity === 'warning') {
    return 'border-amber-200 bg-amber-50 text-amber-950';
  }
  return 'border-slate-200 bg-slate-50 text-slate-800';
}

function buildSchedulingOverrideMetadata(baseMetadata, {
  enabled,
  selectedReasonCode,
  customReason,
}) {
  const nextMetadata = baseMetadata && typeof baseMetadata === 'object' && !Array.isArray(baseMetadata)
    ? { ...baseMetadata }
    : {};

  if (!enabled) {
    delete nextMetadata.scheduling_override;
    return nextMetadata;
  }

  const { reasonCode, reason } = buildSchedulingOverrideReasonDetails(selectedReasonCode, customReason);
  const existingOverride = nextMetadata.scheduling_override && typeof nextMetadata.scheduling_override === 'object'
    ? nextMetadata.scheduling_override
    : {};

  nextMetadata.scheduling_override = {
    type: 'one_time_exception',
    reason,
    reason_code: reasonCode,
    created_by_ui: true,
    created_at: existingOverride.created_at || new Date().toISOString(),
  };

  return nextMetadata;
}

function resolveCalendarAvailabilityState({ instructorMap, instructorId, serviceId, startDate, durationMinutes }) {
  const targetInstructor = instructorMap.get(String(instructorId || ''));
  const targetCapability = (targetInstructor?.service_capabilities || []).find(
    (capability) => String(capability.service_id) === String(serviceId || ''),
  );

  if (!targetCapability) {
    return {
      status: 'missing_capability',
      message: 'למדריך/ה שנבחר/ה אין יכולת שירות פעילה עבור השיעור הזה.',
    };
  }

  if (!hasConfiguredAvailability(targetCapability.availability_windows)) {
    return {
      status: 'missing_availability',
      message: 'לשירות הזה אין זמינות מוגדרת אצל המדריך/ה שנבחר/ה.',
    };
  }

  const targetDay = dayTokenForJsDay(startDate?.getDay?.());
  const targetStartTime = getLocalStartTime(startDate);
  if (!targetDay || !targetStartTime || !isWithinAvailabilityWindows({
    availabilityWindows: targetCapability.availability_windows,
    day: targetDay,
    startTime: targetStartTime,
    durationMinutes,
  })) {
    return {
      status: 'outside_availability',
      message: 'המועד שנבחר נמצא מחוץ לחלונות הזמינות של השירות אצל המדריך/ה.',
    };
  }

  return {
    status: 'within_availability',
    message: '',
  };
}

function buildAvailabilityPresentationContext({ currentDate, viewMode, instructors, instances }) {
  const viewDates = resolveViewDates(currentDate, viewMode);
  const dayTokens = viewDates.map((entry) => entry.dayToken).filter(Boolean);
  const instructorsArray = Array.isArray(instructors) ? instructors : [];
  const instancesArray = Array.isArray(instances) ? instances : [];
  const eventInstructorIds = new Set(instancesArray.map((instance) => String(instance?.instructor_employee_id || '')).filter(Boolean));
  const visibleInstructors = [];
  const boundMinutes = [];

  for (const instructor of instructorsArray) {
    if (!instructor?.id) continue;

    const capabilities = Array.isArray(instructor.service_capabilities) ? instructor.service_capabilities : [];
    const relevantWindows = capabilities.flatMap((capability) => {
      if (!hasConfiguredAvailability(capability?.availability_windows)) {
        return [];
      }

      return dayTokens.flatMap((dayToken) => getAvailabilityWindowsForDay(capability.availability_windows, dayToken));
    });

    const hasAvailabilityInView = relevantWindows.length > 0;
    const hasEventsInView = eventInstructorIds.has(String(instructor.id));
    if (!hasAvailabilityInView && !hasEventsInView) {
      continue;
    }

    visibleInstructors.push(instructor);

    for (const window of relevantWindows) {
      const startMinutes = timeToMinutes(window.start);
      const endMinutes = timeToMinutes(window.end);
      if (startMinutes == null || endMinutes == null) continue;

      boundMinutes.push(startMinutes, endMinutes);
    }
  }

  for (const instance of instancesArray) {
    const start = new Date(instance?.datetime_start);
    if (Number.isNaN(start.getTime())) continue;
    const startMinutes = getDateTimeLocalMinutes(start);
    const endMinutes = startMinutes == null ? null : startMinutes + (Number(instance?.duration_minutes) || 0);
    if (startMinutes != null) boundMinutes.push(startMinutes);
    if (endMinutes != null) boundMinutes.push(endMinutes);
  }

  if (visibleInstructors.length === 0) {
    return {
      visibleInstructors: [],
      slotMinTime: '08:00:00',
      slotMaxTime: '18:00:00',
    };
  }

  if (boundMinutes.length === 0) {
    return {
      visibleInstructors,
      slotMinTime: '08:00:00',
      slotMaxTime: '18:00:00',
    };
  }

  const minMinutes = Math.max(0, Math.floor(Math.min(...boundMinutes) / 15) * 15 - 30);
  const maxMinutes = Math.min(24 * 60, Math.ceil(Math.max(...boundMinutes) / 15) * 15 + 30);

  return {
    visibleInstructors,
    slotMinTime: formatCalendarTime(minMinutes),
    slotMaxTime: formatCalendarTime(Math.max(minMinutes + 60, maxMinutes)),
  };
}

function resolveCalendarView(viewMode) {
  return viewMode === 'week' ? 'resourceTimeGridWeek' : 'resourceTimeGridDay';
}

function resolveVisibleCalendarDate(info, nextViewMode) {
  const rangeStart = info.start instanceof Date ? info.start : null;
  if (rangeStart && !Number.isNaN(rangeStart.getTime())) {
    return rangeStart;
  }

  if (nextViewMode === 'week' && info.view?.currentStart instanceof Date && !Number.isNaN(info.view.currentStart.getTime())) {
    return info.view.currentStart;
  }

  return null;
}

function resolveSchedulerLicenseKey(runtimeConfig) {
  return (
    runtimeConfig?.fullcalendarSchedulerLicenseKey
    || runtimeConfig?.FULLCALENDAR_SCHEDULER_LICENSE_KEY
    || import.meta.env.VITE_FULLCALENDAR_SCHEDULER_LICENSE_KEY
    || undefined
  );
}

function expandHexColor(hexColor) {
  const normalized = String(hexColor || '').trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(normalized)) {
    return normalized.split('').map((char) => `${char}${char}`).join('');
  }
  if (/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return normalized;
  }
  return '';
}

function hexToRgb(hexColor, fallbackHex = '#CBD5E1') {
  const expanded = expandHexColor(hexColor) || expandHexColor(fallbackHex);
  if (!expanded) {
    return { red: 203, green: 213, blue: 225 };
  }

  return {
    red: Number.parseInt(expanded.slice(0, 2), 16),
    green: Number.parseInt(expanded.slice(2, 4), 16),
    blue: Number.parseInt(expanded.slice(4, 6), 16),
  };
}

function rgbToHsl({ red, green, blue }) {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;

  if (max === min) {
    return {
      hue: 0,
      saturation: 0,
      lightness: lightness * 100,
    };
  }

  const delta = max - min;
  const saturation = lightness > 0.5
    ? delta / (2 - max - min)
    : delta / (max + min);

  let hue;
  switch (max) {
    case r:
      hue = ((g - b) / delta) + (g < b ? 6 : 0);
      break;
    case g:
      hue = ((b - r) / delta) + 2;
      break;
    default:
      hue = ((r - g) / delta) + 4;
      break;
  }

  return {
    hue: hue * 60,
    saturation: saturation * 100,
    lightness: lightness * 100,
  };
}

function buildSoftSolidTone(hexColor) {
  const hsl = rgbToHsl(hexToRgb(hexColor));
  const hue = Math.round(hsl.hue);
  const saturation = Math.max(18, Math.min(42, Math.round(hsl.saturation * 0.55)));
  const backgroundLightness = 95;
  const borderLightness = 85;

  return {
    backgroundColor: `hsl(${hue} ${saturation}% ${backgroundLightness}%)`,
    borderColor: `hsl(${hue} ${saturation}% ${borderLightness}%)`,
  };
}

function normalizeWorkflowState(instance) {
  const workflowState = String(instance?.metadata?.workflow_state || '').trim().toLowerCase();
  if (workflowState) {
    return workflowState;
  }
  return 'scheduled';
}

function getEventWorkflowStyles(instance) {
  const workflowState = normalizeWorkflowState(instance);
  const tone = buildSoftSolidTone(instance?.service?.color);

  if (workflowState === 'closed' || workflowState === 'completed') {
    return {
      workflowState,
      backgroundColor: tone.backgroundColor,
      borderColor: tone.borderColor,
      stripColor: 'rgb(16 185 129)',
      icon: '✅',
      iconClassName: 'reinex-calendar-event__status--closed',
      iconLabel: 'נסגר',
    };
  }

  if (workflowState === 'needs_attention') {
    return {
      workflowState,
      backgroundColor: tone.backgroundColor,
      borderColor: tone.borderColor,
      stripColor: 'rgb(245 158 11)',
      icon: '⚠️',
      iconClassName: 'reinex-calendar-event__status--attention',
      iconLabel: 'דורש תשומת לב',
    };
  }

  if (workflowState === 'in_progress') {
    return {
      workflowState,
      backgroundColor: tone.backgroundColor,
      borderColor: tone.borderColor,
      stripColor: 'rgb(59 130 246)',
      icon: '🔵',
      iconClassName: 'reinex-calendar-event__status--progress',
      iconLabel: 'בתהליך',
    };
  }

  return {
    workflowState,
    backgroundColor: tone.backgroundColor,
    borderColor: tone.borderColor,
    stripColor: 'rgb(203 213 225)',
    icon: null,
    iconClassName: 'reinex-calendar-event__status--scheduled',
    iconLabel: 'מתוזמן',
  };
}

function WhatsAppIcon({ className = 'h-3.5 w-3.5' }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="currentColor">
      <path d="M19.05 4.94A9.87 9.87 0 0 0 12.03 2C6.56 2 2.11 6.45 2.1 11.92c0 1.75.46 3.46 1.32 4.97L2 22l5.25-1.38a9.88 9.88 0 0 0 4.77 1.22h.01c5.47 0 9.92-4.45 9.92-9.92a9.84 9.84 0 0 0-2.9-6.98Zm-7.02 15.23h-.01a8.2 8.2 0 0 1-4.18-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.18 8.18 0 0 1-1.26-4.38c0-4.52 3.68-8.2 8.21-8.2 2.19 0 4.24.85 5.79 2.4a8.14 8.14 0 0 1 2.4 5.8c0 4.52-3.68 8.21-8.16 8.21Zm4.5-6.15c-.25-.12-1.47-.72-1.7-.8-.23-.09-.4-.12-.57.12-.17.25-.65.8-.8.97-.15.17-.3.19-.55.07-.25-.12-1.04-.38-1.98-1.21-.73-.65-1.23-1.45-1.38-1.7-.14-.24-.01-.38.11-.5.11-.11.25-.3.37-.45.12-.15.16-.25.25-.42.08-.17.04-.32-.02-.45-.06-.12-.57-1.37-.78-1.88-.21-.5-.42-.43-.57-.44-.15-.01-.32-.01-.5-.01a.96.96 0 0 0-.68.32c-.23.25-.88.86-.88 2.09 0 1.22.9 2.41 1.02 2.57.12.17 1.76 2.69 4.26 3.77.59.26 1.06.41 1.42.52.6.19 1.15.16 1.58.1.48-.07 1.47-.6 1.68-1.18.21-.58.21-1.07.14-1.18-.06-.11-.23-.17-.48-.29Z" />
    </svg>
  );
}

function getEventDensityClass(durationMinutes) {
  if (durationMinutes <= 20) return 'reinex-calendar-event--xs';
  if (durationMinutes <= 30) return 'reinex-calendar-event--compact';
  if (durationMinutes <= 45) return 'reinex-calendar-event--mid';
  return '';
}

function EventContent({ arg }) {
  const instance = arg.event.extendedProps?.instance;
  const previewKind = arg.event.extendedProps?.previewKind;
  const rootRef = useRef(null);
  const [contentWidth, setContentWidth] = useState(null);

  useEffect(() => {
    if (!rootRef.current || typeof ResizeObserver === 'undefined') {
      return undefined;
    }

    const element = rootRef.current;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      const nextWidth = entry?.contentRect?.width;
      setContentWidth((currentWidth) => {
        const roundedCurrent = currentWidth == null ? null : Math.round(currentWidth);
        const roundedNext = nextWidth == null ? null : Math.round(nextWidth);
        return roundedCurrent === roundedNext ? currentWidth : nextWidth;
      });
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  if (previewKind === 'service_drop') {
    const previewTitle = arg.event.title || 'שירות';
    const previewDurationMinutes = Number(arg.event.extendedProps?.serviceDurationMinutes) || 0;
    const previewColor = arg.event.extendedProps?.serviceColor || '#2563eb';

    return (
      <div
        ref={rootRef}
        className="reinex-calendar-external-preview-card"
        style={{ '--reinex-preview-accent': previewColor }}
        title={`${previewTitle}${previewDurationMinutes > 0 ? ` • ${previewDurationMinutes} דקות` : ''}`}
      >
        <div className="reinex-calendar-external-preview-card__title">{previewTitle}</div>
        <div className="reinex-calendar-external-preview-card__meta">
          גרירה לשיבוץ
          {previewDurationMinutes > 0 ? ` • ${previewDurationMinutes} דקות` : ''}
        </div>
      </div>
    );
  }

  if (!instance) {
    return <div className="reinex-calendar-event">פריט חסר</div>;
  }

  const firstStudentName = getParticipantDisplayName(instance.participants?.[0], 'ללא לקוח/ה');
  const additionalCount = Math.max(0, (instance.participants?.length || 1) - 1);
  const statusInfo = getInstanceStatusIcon(instance.status, instance.documentation_status);
  const workflowStyles = getEventWorkflowStyles(instance);
  const durationMinutes = Number(instance.duration_minutes) || 0;
  const densityClass = getEventDensityClass(durationMinutes);
  const isVeryNarrow = contentWidth != null && contentWidth < 115;
  const isNarrow = contentWidth != null && contentWidth < 175;
  const isStudentOnlySummary = durationMinutes <= 20 || isVeryNarrow;
  const isInlineSummary = !isStudentOnlySummary && (durationMinutes <= 30 || isNarrow);
  const studentLabel = `${firstStudentName}${additionalCount > 0 ? ` +${additionalCount}` : ''}`;
  const serviceLabel = instance.service?.service_name || 'שיעור';
  const participants = Array.isArray(instance.participants) ? instance.participants : [];
  const remindersTotal = participants.length;
  const remindersSent = participants.filter((participant) => participant?.reminder_sent).length;
  const remindersAccepted = participants.filter((participant) => participant?.reminder_seen).length;
  const remindersDeclined = participants.filter((participant) => participant?.participant_status === 'cancelled_student').length;
  const remindersUnsent = Math.max(0, remindersTotal - remindersSent);
  const remindersPendingApproval = Math.max(0, remindersSent - remindersAccepted - remindersDeclined);
  const showApprovalPhase = remindersTotal > 0 && remindersSent >= remindersTotal;
  const reminderBadgeLabel = showApprovalPhase
    ? `✅ ${remindersAccepted}/${remindersTotal}`
    : `🔔 ${remindersSent}/${remindersTotal}`;
  const reminderA11yLabel = `סטטוס תזכורות: נשלח ${remindersSent}/${remindersTotal}, אישרו ${remindersAccepted}/${remindersTotal}, לא מגיעים ${remindersDeclined}, ממתינים ${remindersPendingApproval}, לא נשלח ${remindersUnsent}`;

  const reminderBadge = remindersTotal > 0 ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="reinex-calendar-event__badge reinex-calendar-event__reminder-badge"
          tabIndex={0}
          aria-label={reminderA11yLabel}
        >
          <span className="reinex-calendar-event__reminder-main">{reminderBadgeLabel}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" align="end" className="reinex-calendar-event__tooltip-content" sideOffset={6}>
        <div className="reinex-calendar-event__tooltip-title">סטטוס תזכורות</div>
        <div className="reinex-calendar-event__tooltip-row">
          <span>נשלח</span>
          <strong>{remindersSent}/{remindersTotal}</strong>
        </div>
        <div className="reinex-calendar-event__tooltip-row">
          <span>אישרו הגעה</span>
          <strong>{remindersAccepted}/{remindersTotal}</strong>
        </div>
        <div className="reinex-calendar-event__tooltip-row">
          <span>לא מגיעים</span>
          <strong>{remindersDeclined}</strong>
        </div>
        <div className="reinex-calendar-event__tooltip-row">
          <span>ממתינים</span>
          <strong>{remindersPendingApproval}</strong>
        </div>
        <div className="reinex-calendar-event__tooltip-row">
          <span>לא נשלח</span>
          <strong>{remindersUnsent}</strong>
        </div>
      </TooltipContent>
    </Tooltip>
  ) : null;
  const displayStatusIcon = workflowStyles.icon || statusInfo.icon;
  const displayStatusLabel = workflowStyles.icon ? workflowStyles.iconLabel : statusInfo.label;

  return (
    <TooltipProvider delayDuration={120}>
      <div
        ref={rootRef}
        className={`reinex-calendar-event ${densityClass} ${isInlineSummary ? 'reinex-calendar-event--inline' : ''} ${isStudentOnlySummary ? 'reinex-calendar-event--student-only' : ''}`.trim()}
        style={{
          backgroundColor: workflowStyles.backgroundColor,
          borderColor: workflowStyles.borderColor,
        }}
        title={`${instance.service?.service_name || 'שיעור'} • ${firstStudentName}`}
      >
      <span
        aria-hidden="true"
        className="reinex-calendar-event__workflow-strip"
        style={{ backgroundColor: workflowStyles.stripColor }}
      />
      {isStudentOnlySummary ? (
        <div className="reinex-calendar-event__inline">
          <span
            className={`reinex-calendar-event__status ${workflowStyles.iconClassName}`.trim()}
            aria-label={displayStatusLabel}
            title={displayStatusLabel}
          >
            {displayStatusIcon}
          </span>
          <span className="reinex-calendar-event__inline-main">
            <span className="reinex-calendar-event__student">{studentLabel}</span>
          </span>
          {reminderBadge}
        </div>
      ) : isInlineSummary ? (
        <div className="reinex-calendar-event__inline">
          <span
            className={`reinex-calendar-event__status ${workflowStyles.iconClassName}`.trim()}
            aria-label={displayStatusLabel}
            title={displayStatusLabel}
          >
            {displayStatusIcon}
          </span>
          <span className="reinex-calendar-event__inline-main">
            <span className="reinex-calendar-event__student">{studentLabel}</span>
            <span className="reinex-calendar-event__separator">•</span>
            <span className="reinex-calendar-event__service">{serviceLabel}</span>
          </span>
          {reminderBadge}
        </div>
      ) : (
        <>
      <div className="reinex-calendar-event__top">
        <span className="reinex-calendar-event__service">
          {serviceLabel}
        </span>
        <span
          className={`reinex-calendar-event__status ${workflowStyles.iconClassName}`.trim()}
          aria-label={displayStatusLabel}
          title={displayStatusLabel}
        >
          {displayStatusIcon}
        </span>
      </div>

      <div className="reinex-calendar-event__student">{studentLabel}</div>

      <div className="reinex-calendar-event__meta">
        <span className="reinex-calendar-event__time">{arg.timeText || formatTimeDisplay(instance.datetime_start)}</span>
        <span className="reinex-calendar-event__badges">
          {reminderBadge}
          {instance.documentation_status === 'undocumented' && instance.status === 'completed' ? (
            <span className="reinex-calendar-event__badge">לא תועד</span>
          ) : null}
        </span>
      </div>
        </>
      )}
      </div>
    </TooltipProvider>
  );
}

function renderEventContent(arg) {
  return <EventContent arg={arg} />;
}

export default function ReinexFullCalendar({
  currentDate,
  viewMode,
  instances,
  instructors,
  isLoading = false,
  calendarNavigationRef,
  selectedSlot,
  onSlotSelect,
  onEventClick,
  onDateChange,
  onEventRescheduled,
  onExternalServiceDrop,
  onOpenInstructorWhatsApp,
  emptyState = null,
  onEmptyStateAction,
}) {
  const calendarRef = useRef(null);
  const pendingCalendarSyncRef = useRef(null);
  const initialCalendarDateRef = useRef(currentDate);
  const runtimeConfig = useRuntimeConfig();
  const { activeOrgId } = useOrg();
  const [updatingEventId, setUpdatingEventId] = useState(null);
  const [pendingDropInfo, setPendingDropInfo] = useState(null);

  const availabilityPresentation = useMemo(
    () => buildAvailabilityPresentationContext({ currentDate, viewMode, instructors, instances }),
    [currentDate, instructors, instances, viewMode],
  );
  const instructorMap = useMemo(
    () => new Map((instructors || []).map((instructor) => [String(instructor.id), instructor])),
    [instructors],
  );
  const mappedEvents = useMemo(
    () => {
      const baseEvents = mapInstancesToEvents(instances);
      if (!(selectedSlot?.start instanceof Date) || !(selectedSlot?.end instanceof Date) || !selectedSlot?.resourceId) {
        return baseEvents;
      }

      return [
        ...baseEvents,
        {
          id: 'pending-calendar-selection',
          start: selectedSlot.start,
          end: selectedSlot.end,
          resourceId: String(selectedSlot.resourceId),
          display: 'background',
          classNames: ['reinex-calendar-selection'],
        },
      ];
    },
    [instances, selectedSlot],
  );
  const mappedResources = useMemo(
    () => mapInstructorsToResources(availabilityPresentation.visibleInstructors),
    [availabilityPresentation.visibleInstructors],
  );
  const hasVisibleResources = mappedResources.length > 0;
  const schedulerLicenseKey = useMemo(() => resolveSchedulerLicenseKey(runtimeConfig), [runtimeConfig]);
  const fullCalendarView = resolveCalendarView(viewMode);
  const initialCalendarViewRef = useRef(fullCalendarView);
  const pendingDropConfirmDisabled = useMemo(() => {
    if (!pendingDropInfo) return false;
    if (pendingDropInfo.previewLoading) return true;
    if (pendingDropInfo.previewError) return true;
    if (pendingDropInfo.preview?.can_apply === false) return true;
    if (pendingDropInfo.availabilityState?.status === 'outside_availability' && !pendingDropInfo.useSchedulingOverride) {
      return true;
    }
    if (pendingDropInfo.useSchedulingOverride && !hasValidSchedulingOverrideReason(pendingDropInfo.selectedReasonCode, pendingDropInfo.customReason)) {
      return true;
    }
    return false;
  }, [pendingDropInfo]);

  useEffect(() => {
    if (!pendingDropInfo) {
      return undefined;
    }

    const dropInfo = pendingDropInfo.rawInfo;
    const instance = dropInfo?.event.extendedProps?.instance;
    const nextStart = dropInfo?.event.start;
    const nextResourceId = dropInfo?.newResource?.id
      || dropInfo?.event.getResources?.()?.[0]?.id
      || instance?.instructor_employee_id;

    if (!activeOrgId || !instance?.id || !nextStart || !nextResourceId) {
      return undefined;
    }

    if (
      pendingDropInfo.availabilityState?.status === 'outside_availability'
      && !hasValidSchedulingOverrideReason(pendingDropInfo.selectedReasonCode, pendingDropInfo.customReason)
    ) {
      if (!pendingDropInfo.preview && !pendingDropInfo.previewError && !pendingDropInfo.previewLoading && !pendingDropInfo.previewRequestKey) {
        return undefined;
      }
      setPendingDropInfo((current) => (
        current?.rawInfo === dropInfo
          ? { ...current, preview: null, previewError: '', previewLoading: false, previewRequestKey: '' }
          : current
      ));
      return undefined;
    }

    const metadata = buildSchedulingOverrideMetadata(instance.metadata, {
      enabled: pendingDropInfo.useSchedulingOverride,
      selectedReasonCode: pendingDropInfo.selectedReasonCode,
      customReason: pendingDropInfo.customReason,
    });
    const requestKey = JSON.stringify({
      id: instance.id,
      start: nextStart.toISOString(),
      instructor: nextResourceId,
      metadata,
    });

    if (pendingDropInfo.previewRequestKey === requestKey && (pendingDropInfo.preview || pendingDropInfo.previewLoading || pendingDropInfo.previewError)) {
      return undefined;
    }

    let cancelled = false;
    setPendingDropInfo((current) => (
      current?.rawInfo === dropInfo
        ? { ...current, preview: null, previewError: '', previewLoading: true, previewRequestKey: requestKey }
        : current
    ));

    async function fetchPreview() {
      try {
        const payload = await authenticatedFetch('calendar/instances', {
          method: 'PUT',
          body: {
            action: 'preview-update-instance',
            org_id: activeOrgId,
            id: instance.id,
            datetime_start: nextStart.toISOString(),
            instructor_employee_id: nextResourceId,
            duration_minutes: instance.duration_minutes,
            service_id: instance.service_id,
            status: instance.status,
            metadata,
            expected_version: instance.version,
          },
        });

        if (cancelled) return;
        setPendingDropInfo((current) => (
          current?.rawInfo === dropInfo
            ? { ...current, preview: payload?.preview || null, previewError: '', previewLoading: false, previewRequestKey: requestKey }
            : current
        ));
      } catch (error) {
        if (cancelled) return;
        setPendingDropInfo((current) => (
          current?.rawInfo === dropInfo
            ? { ...current, preview: null, previewError: error?.message || 'לא ניתן היה לבנות תצוגה מקדימה להעברה.', previewLoading: false, previewRequestKey: requestKey }
            : current
        ));
      }
    }

    void fetchPreview();
    return () => {
      cancelled = true;
    };
  }, [
    activeOrgId,
    pendingDropInfo,
  ]);

  const navigateCalendarWithoutApi = useCallback((action) => {
    if (typeof onDateChange !== 'function') {
      return;
    }

    if (action === 'today') {
      onDateChange(toCalendarLocalDateString(new Date()));
      return;
    }

    const days = viewMode === 'week' ? 7 : 1;
    if (action === 'next') {
      const nextDate = addLocalDays(currentDate, days);
      if (nextDate) {
        onDateChange(nextDate);
      }
      return;
    }

    if (action === 'prev') {
      const prevDate = addLocalDays(currentDate, -days);
      if (prevDate) {
        onDateChange(prevDate);
      }
      return;
    }

    if (typeof action === 'string' && action) {
      onDateChange(action);
    }
  }, [currentDate, onDateChange, viewMode]);

  useEffect(() => {
    if (!calendarNavigationRef) {
      return undefined;
    }

    calendarNavigationRef.current = {
      next() {
        navigateCalendarWithoutApi('next');
      },
      prev() {
        navigateCalendarWithoutApi('prev');
      },
      today() {
        navigateCalendarWithoutApi('today');
      },
      gotoDate(date) {
        if (!date) return;
        navigateCalendarWithoutApi(date);
      },
    };

    return () => {
      if (calendarNavigationRef.current) {
        calendarNavigationRef.current = null;
      }
    };
  }, [calendarNavigationRef, navigateCalendarWithoutApi]);

  useEffect(() => {
    if (!schedulerLicenseKey) {
      console.warn('FullCalendar scheduler license key is missing. Set VITE_FULLCALENDAR_SCHEDULER_LICENSE_KEY or provide it via runtime config.');
    }
  }, [schedulerLicenseKey]);

  useEffect(() => {
    const api = calendarRef.current?.getApi?.();
    if (!api) {
      return;
    }

    const activeCalendarDate = toLocalDateString(api.getDate?.());
    if (api.view.type === fullCalendarView && activeCalendarDate === currentDate) {
      pendingCalendarSyncRef.current = null;
      return;
    }

    pendingCalendarSyncRef.current = {
      date: currentDate,
      view: fullCalendarView,
    };

    if (api.view.type !== fullCalendarView) {
      api.changeView(fullCalendarView, currentDate);
    } else {
      api.gotoDate(currentDate);
    }
  }, [currentDate, fullCalendarView, viewMode]);

  useEffect(() => {
    if (!hasVisibleResources) {
      return;
    }

    const api = calendarRef.current?.getApi?.();
    api?.updateSize?.();
  }, [hasVisibleResources, currentDate, viewMode]);

  const handleDatesSet = useCallback((info) => {
    const nextViewMode = info.view.type === 'resourceTimeGridWeek' ? 'week' : 'day';
    const activeDate = resolveVisibleCalendarDate(info, nextViewMode);
    const nextDate = toLocalDateString(activeDate);
    const pendingSync = pendingCalendarSyncRef.current;
    const isControlledSync = Boolean(
      pendingSync
      && pendingSync.view === info.view.type
      && nextDate
      && pendingSync.date === nextDate,
    );

    if (isControlledSync) {
      pendingCalendarSyncRef.current = null;
      return;
    }

    // The parent owns calendar date/view state. FullCalendar can emit datesSet
    // while settling internal renders; do not let that stale signal drive fetches.
    if (nextViewMode === viewMode && nextDate === currentDate) {
      pendingCalendarSyncRef.current = null;
    }
  }, [currentDate, viewMode]);

  const handleEventClick = useCallback((info) => {
    const instance = info.event.extendedProps?.instance;
    if (instance) {
      onEventClick?.(instance);
    }
  }, [onEventClick]);

  const handleDateSelect = useCallback((selectInfo) => {
    const startDate = selectInfo.start instanceof Date ? selectInfo.start : null;
    const endDate = selectInfo.end instanceof Date ? selectInfo.end : null;

    onSlotSelect?.({
      startStr: selectInfo.startStr,
      endStr: selectInfo.endStr,
      resourceId: selectInfo.resource?.id || null,
      start: startDate,
      end: endDate,
    });

    selectInfo.view.calendar.unselect();
  }, [onSlotSelect]);

  const handleSelectAllow = useCallback((selectInfo) => {
    const startDate = selectInfo.start instanceof Date ? selectInfo.start : null;
    const endDate = selectInfo.end instanceof Date ? selectInfo.end : null;
    if (!selectInfo.resource?.id || !startDate || !endDate) {
      return false;
    }

    const durationMinutes = Math.max(15, Math.round((endDate.getTime() - startDate.getTime()) / 60000));
    return durationMinutes > 0;
  }, []);

  const handleEventDrop = useCallback((info) => {
    const instance = info.event.extendedProps?.instance;
    const nextStart = info.event.start;
    const nextResourceId = info.newResource?.id
      || info.event.getResources?.()?.[0]?.id
      || instance?.instructor_employee_id;

    if (!activeOrgId || !instance?.id || !nextStart || !nextResourceId) {
      info.revert();
      toast.error('לא ניתן לעדכן את השיעור כרגע.');
      return;
    }

    const availabilityState = resolveCalendarAvailabilityState({
      instructorMap,
      instructorId: nextResourceId,
      serviceId: instance.service_id,
      startDate: nextStart,
      durationMinutes: Number(instance.duration_minutes) || 0,
    });

    if (availabilityState.status === 'missing_capability' || availabilityState.status === 'missing_availability') {
      info.revert();
      toast.error(availabilityState.message);
      return;
    }

    const overrideState = resolveSchedulingOverrideFormState(instance?.metadata?.scheduling_override);
    setPendingDropInfo({
      rawInfo: info,
      availabilityState,
      useSchedulingOverride: availabilityState.status === 'outside_availability',
      selectedReasonCode: overrideState.selectedReasonCode || '',
      customReason: overrideState.customReason || '',
    });
  }, [activeOrgId, instructorMap]);

  const clearPendingDrop = useCallback(() => {
    setPendingDropInfo(null);
  }, []);

  const confirmPendingDrop = useCallback(async () => {
    if (!pendingDropInfo) {
      return;
    }

    const dropInfo = pendingDropInfo.rawInfo;
    const instance = dropInfo?.event.extendedProps?.instance;
    const nextStart = dropInfo?.event.start;
    const nextResourceId = dropInfo?.newResource?.id
      || dropInfo?.event.getResources?.()?.[0]?.id
      || instance?.instructor_employee_id;

    if (!activeOrgId || !instance?.id || !nextStart || !nextResourceId) {
      dropInfo?.revert?.();
      clearPendingDrop();
      toast.error('לא ניתן לעדכן את השיעור כרגע.');
      return;
    }

    if (pendingDropInfo.availabilityState?.status === 'outside_availability' && !pendingDropInfo.useSchedulingOverride) {
      toast.error('כדי לשמור שיעור מחוץ לזמינות יש לסמן אותו כחריגה חד-פעמית.');
      return;
    }

    if (pendingDropInfo.useSchedulingOverride && !hasValidSchedulingOverrideReason(pendingDropInfo.selectedReasonCode, pendingDropInfo.customReason)) {
      toast.error('יש למלא סיבת חריגה לפני שמירת השיבוץ החריג.');
      return;
    }

    if (pendingDropInfo.previewLoading) {
      toast.error('התצוגה המקדימה עדיין נטענת.');
      return;
    }

    if (pendingDropInfo.previewError || pendingDropInfo.preview?.can_apply === false) {
      toast.error(pendingDropInfo.previewError || 'התצוגה המקדימה חסמה את ההעברה.');
      return;
    }

    setUpdatingEventId(instance.id);
    try {
      const conflictResponse = await authenticatedFetch('calendar/conflicts/check', {
        method: 'POST',
        body: {
          org_id: activeOrgId,
          datetime_start: nextStart.toISOString(),
          duration_minutes: instance.duration_minutes,
          instructor_employee_id: nextResourceId,
          student_ids: (instance.participants || []).map((participant) => participant.student_id).filter(Boolean),
          service_id: instance.service_id,
          exclude_instance_id: instance.id,
        },
      });

      if (conflictResponse?.has_conflicts || (conflictResponse?.conflicts || []).length > 0) {
        const firstMessage = conflictResponse?.conflicts?.[0]?.message || 'נמצאה התנגשות. השיעור לא הועבר.';
        dropInfo.revert();
        toast.error(firstMessage);
        clearPendingDrop();
        return;
      }

      await authenticatedFetch('calendar/instances', {
        method: 'PUT',
        body: {
          org_id: activeOrgId,
          id: instance.id,
          datetime_start: nextStart.toISOString(),
          instructor_employee_id: nextResourceId,
          duration_minutes: instance.duration_minutes,
          status: instance.status,
          metadata: buildSchedulingOverrideMetadata(instance.metadata, {
            enabled: pendingDropInfo.useSchedulingOverride,
            selectedReasonCode: pendingDropInfo.selectedReasonCode,
            customReason: pendingDropInfo.customReason,
          }),
        },
      });

      toast.success(
        pendingDropInfo.useSchedulingOverride
          ? 'השיעור עודכן ונשמר כחריגה חד-פעמית.'
          : 'השיעור עודכן.',
      );
      clearPendingDrop();
      onEventRescheduled?.();
    } catch (error) {
      dropInfo.revert();
      toast.error(error?.message || 'העברת השיעור נכשלה.');
      clearPendingDrop();
    } finally {
      setUpdatingEventId(null);
    }
  }, [activeOrgId, clearPendingDrop, onEventRescheduled, pendingDropInfo]);

  const cancelPendingDrop = useCallback(() => {
    pendingDropInfo?.rawInfo?.revert?.();
    clearPendingDrop();
  }, [clearPendingDrop, pendingDropInfo]);

  const handleExternalDrop = useCallback((dropInfo) => {
    const startDate = dropInfo?.date instanceof Date ? dropInfo.date : null;
    const resourceId = dropInfo?.resource?.id || null;
    const draggedEl = dropInfo?.draggedEl;
    const serviceId = draggedEl?.getAttribute?.('data-service-id') || '';
    const durationMinutes = Number(draggedEl?.getAttribute?.('data-service-duration-minutes')) || 0;

    if (!serviceId || !resourceId || !startDate || Number.isNaN(startDate.getTime()) || durationMinutes <= 0) {
      toast.error('אי אפשר ליצור שיעור מהשירות שנגרר.');
      return;
    }

    onExternalServiceDrop?.({
      serviceId,
      resourceId: String(resourceId),
      start: startDate,
      end: new Date(startDate.getTime() + (durationMinutes * 60000)),
    });
  }, [onExternalServiceDrop]);

  const handleResourceLabelContent = useCallback((arg) => {
    const instructor = arg.resource?.extendedProps?.instructor;
    if (!instructor) {
      return <span>{arg.resource?.title || 'מדריך'}</span>;
    }

    return (
      <div className="reinex-resource-label">
        <span className="reinex-resource-label__name">{instructor.full_name}</span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="reinex-resource-label__button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onOpenInstructorWhatsApp?.(instructor);
          }}
        >
          <WhatsAppIcon className="h-3.5 w-3.5" />
          וואטסאפ
        </Button>
      </div>
    );
  }, [onOpenInstructorWhatsApp]);

  const formatPendingDropPreviewValue = useCallback((field, value) => {
    if (field === 'instructor_employee_id') {
      return instructorMap.get(String(value || ''))?.full_name || formatPreviewValue(field, value);
    }

    if (field === 'service_id') {
      const instance = pendingDropInfo?.rawInfo?.event?.extendedProps?.instance;
      if (String(instance?.service_id || '') === String(value || '')) {
        return instance?.service?.service_name || formatPreviewValue(field, value);
      }
    }

    if (field === 'status') {
      if (value === 'scheduled') return 'מתוכנן';
      if (value === 'completed') return 'הושלם';
      if (value === 'cancelled') return 'בוטל';
    }

    return formatPreviewValue(field, value);
  }, [instructorMap, pendingDropInfo?.rawInfo]);

  return (
    <div className="reinex-fullcalendar-shell">
      {(isLoading || updatingEventId) ? (
        <div className="reinex-fullcalendar-loading">
          <Loader2 className="h-8 w-8 animate-spin text-gray-500" />
        </div>
      ) : null}

      {!hasVisibleResources && !isLoading ? (
        <div className="reinex-fullcalendar-empty">
          <div className="reinex-fullcalendar-empty__content">
            <div className="reinex-fullcalendar-empty__title">
              {emptyState?.title || 'אין מדריכים זמינים או שיעורים קיימים בטווח שנבחר'}
            </div>
            <div className="reinex-fullcalendar-empty__description">
              {emptyState?.description || 'בדקו שהוגדרו מדריכים, שירותים וחלונות זמינות לטווח הנוכחי.'}
            </div>
            {(emptyState?.primaryAction || emptyState?.secondaryAction) ? (
              <div className="reinex-fullcalendar-empty__actions">
                {emptyState?.primaryAction ? (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => onEmptyStateAction?.(emptyState.primaryAction, emptyState)}
                  >
                    {emptyState.primaryLabel || 'המשך'}
                  </Button>
                ) : null}
                {emptyState?.secondaryAction ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => onEmptyStateAction?.(emptyState.secondaryAction, emptyState)}
                  >
                    {emptyState.secondaryLabel || 'אפשרות נוספת'}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className={`reinex-fullcalendar ${hasVisibleResources ? '' : 'reinex-fullcalendar--collapsed'}`.trim()}>
        <FullCalendar
          ref={calendarRef}
          plugins={[resourceTimeGridPlugin, timeGridPlugin, interactionPlugin]}
          initialView={initialCalendarViewRef.current}
          initialDate={initialCalendarDateRef.current}
          schedulerLicenseKey={schedulerLicenseKey || 'GPL-My-Project-Is-Open-Source'}
          locale={heLocale}
          direction="rtl"
          businessHours
          firstDay={CALENDAR_WEEK_START}
          datesAboveResources={viewMode === 'week'}
          headerToolbar={false}
          resources={mappedResources}
          resourceLabelContent={handleResourceLabelContent}
          events={mappedEvents}
          editable
          eventStartEditable
          eventDurationEditable={false}
          eventResourceEditable
          droppable
          dropAccept=".calendar-service-drag-item"
          selectable
          selectMirror
          selectAllow={handleSelectAllow}
          select={handleDateSelect}
          drop={handleExternalDrop}
          allDaySlot={false}
          slotEventOverlap={false}
          eventMinHeight={12}
          eventShortHeight={18}
          nowIndicator
          slotMinTime={availabilityPresentation.slotMinTime}
          slotMaxTime={availabilityPresentation.slotMaxTime}
          height="100%"
          resourceOrder="title"
          eventClick={handleEventClick}
          eventDrop={handleEventDrop}
          datesSet={handleDatesSet}
          eventContent={renderEventContent}
          views={{
            resourceTimeGridDay: {
              slotDuration: '00:15:00',
              slotLabelInterval: '01:00:00',
              slotLabelFormat: [
                { hour: '2-digit', minute: '2-digit', hour12: false },
              ],
              dayHeaderFormat: { weekday: 'long', day: 'numeric', month: 'numeric' },
            },
            resourceTimeGridWeek: {
              slotDuration: '00:15:00',
              slotLabelInterval: '01:00:00',
              slotLabelFormat: [
                { hour: '2-digit', minute: '2-digit', hour12: false },
              ],
              dayHeaderFormat: { weekday: 'short', day: 'numeric', month: 'numeric' },
            },
          }}
        />
      </div>

      <AlertDialog open={!!pendingDropInfo} onOpenChange={(open) => { if (!open) cancelPendingDrop(); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingDropInfo?.availabilityState?.status === 'outside_availability'
                ? 'המועד מחוץ לזמינות המדריך/ה'
                : 'האם להעביר את השיעור למועד זה?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDropInfo?.availabilityState?.status === 'outside_availability'
                ? 'אפשר עדיין לשמור את ההעברה כחריגה חד-פעמית. יש לציין סיבה כדי שהחריגה תהיה ברורה למשתמשים ולמעקב.'
                : 'הפעולה תעדכן את מועד השיעור ותבדוק התנגשויות לפני השמירה.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {pendingDropInfo?.availabilityState?.status === 'outside_availability' ? (
            <div className="space-y-3">
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                {pendingDropInfo.availabilityState.message}
              </div>
              <div className="space-y-2">
                <Label htmlFor="pending-drop-override-reason-code">סיבת חריגה *</Label>
                <Select
                  value={pendingDropInfo.selectedReasonCode || ''}
                  onValueChange={(value) => setPendingDropInfo((current) => (
                    current
                      ? { ...current, useSchedulingOverride: true, selectedReasonCode: value }
                      : current
                  ))}
                >
                  <SelectTrigger id="pending-drop-override-reason-code">
                    <SelectValue placeholder="בחרו סיבה" />
                  </SelectTrigger>
                  <SelectContent>
                    {SCHEDULING_OVERRIDE_REASON_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {pendingDropInfo.selectedReasonCode === 'custom' ? (
                  <Textarea
                    id="pending-drop-override-custom-reason"
                    rows={3}
                    value={pendingDropInfo.customReason || ''}
                    onChange={(event) => setPendingDropInfo((current) => (
                      current
                        ? { ...current, useSchedulingOverride: true, customReason: event.target.value }
                        : current
                    ))}
                    placeholder="כתבו סיבה מותאמת אישית רק אם היא לא קיימת ברשימה."
                  />
                ) : null}
              </div>
            </div>
          ) : null}
          {pendingDropInfo?.availabilityState?.status === 'within_availability' && pendingDropInfo?.rawInfo?.event?.extendedProps?.instance?.metadata?.scheduling_override?.reason ? (
            <div className="space-y-3">
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                השיעור מסומן כרגע כחריגה חד-פעמית. אם תאשרו את ההעברה הזאת, סימון החריגה יוסר כי המועד החדש כבר נמצא בתוך חלונות הזמינות.
              </div>
            </div>
          ) : null}
          <div className="space-y-3">
            {pendingDropInfo?.previewLoading ? (
              <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                <Loader2 className="h-4 w-4 animate-spin" />
                בונה תצוגה מקדימה מהשרת...
              </div>
            ) : null}

            {pendingDropInfo?.previewError ? (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-950">
                {pendingDropInfo.previewError}
              </div>
            ) : null}

            {pendingDropInfo?.preview ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-3">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">תצוגה מקדימה</div>
                    <div className="text-xs text-slate-500">הנתונים נבדקו מול מצב השרת הנוכחי.</div>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-xs font-medium ${pendingDropInfo.preview.can_apply ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>
                    {pendingDropInfo.preview.can_apply ? 'ניתן לשמור' : 'חסום'}
                  </span>
                </div>

                {(pendingDropInfo.preview.changes || []).length > 0 ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {pendingDropInfo.preview.changes.map((change) => (
                      <div key={change.field} className="rounded-xl border border-slate-200 bg-slate-50 p-2 text-xs">
                        <div className="font-semibold text-slate-800">{change.label}</div>
                        <div className="mt-1 grid gap-1 text-slate-600">
                          <div>לפני: {formatPendingDropPreviewValue(change.field, change.before)}</div>
                          <div>אחרי: {formatPendingDropPreviewValue(change.field, change.after)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-2 text-sm text-slate-700">
                    לא זוהו שינויים בשדות השיבוץ.
                  </div>
                )}

                {(pendingDropInfo.preview.impacts || []).length > 0 ? (
                  <div className="mt-3 space-y-2">
                    {(pendingDropInfo.preview.impacts || []).map((impact, index) => (
                      <div key={`${impact.type || 'impact'}-${index}`} className={`rounded-xl border px-3 py-2 text-sm ${getPreviewImpactClass(impact.severity)}`}>
                        <div className="font-semibold">{impact.label || 'השפעה'}</div>
                        <div className="mt-0.5 text-xs opacity-85">{impact.message}</div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={cancelPendingDrop}>ביטול</AlertDialogCancel>
            <AlertDialogAction onClick={confirmPendingDrop} disabled={pendingDropConfirmDisabled}>אישור</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
