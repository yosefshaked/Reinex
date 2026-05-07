import { useEffect, useMemo, useRef } from 'react';
import FullCalendar from '@fullcalendar/react';
import interactionPlugin from '@fullcalendar/interaction';
import resourceTimeGridPlugin from '@fullcalendar/resource-timegrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import heLocale from '@fullcalendar/core/locales/he';
import { Clock, Loader2, User } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DAY_OPTIONS, dayLabel, normalizeDayToken } from '@/lib/day-of-week.js';
import { getAvailabilityWindowsForDay, timeToMinutes } from '@/lib/instructor-availability.js';
import { cn } from '@/lib/utils';
import { ceilClockTimeToGrid } from '@/lib/time-grid.js';
import { toast } from 'sonner';
import '../reinex-fullcalendar.css';
import './template-schedule-calendar.css';

const TEMPLATE_WEEK_START = '2026-01-04';

function addDays(dateString, amount) {
  const date = new Date(`${dateString}T00:00:00`);
  date.setDate(date.getDate() + amount);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const DAY_DATE_BY_TOKEN = Object.freeze(
  Object.fromEntries(DAY_OPTIONS.map((day, index) => [day.value, addDays(TEMPLATE_WEEK_START, index)])),
);

function formatClock(value) {
  const text = ceilClockTimeToGrid(value) || String(value || '').trim();
  const match = /^(\d{1,2}):(\d{2})/.exec(text);
  if (!match) return '00:00';
  return `${String(Number(match[1])).padStart(2, '0')}:${match[2]}`;
}

function formatDateTime(dayToken, timeOfDay) {
  const date = DAY_DATE_BY_TOKEN[normalizeDayToken(dayToken)];
  if (!date) return null;
  return `${date}T${formatClock(timeOfDay)}:00`;
}

function formatDateObjectTime(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '09:00';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function addMinutesLocalDateTime(startDateTime, minutes) {
  const date = new Date(startDateTime);
  if (Number.isNaN(date.getTime())) return null;
  date.setMinutes(date.getMinutes() + (Number(minutes) || 0));
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:00`;
}

function getPersonName(person) {
  if (!person) return '—';
  return person.full_name || [person.first_name, person.middle_name, person.last_name].filter(Boolean).join(' ').trim() || person.email || '—';
}

function getTemplateStudentName(template) {
  return getPersonName(template?.student || template?.client_profile);
}

function getServiceName(template) {
  return template?.service?.name || template?.service?.service_name || 'שירות';
}

function getServiceColor(template) {
  return template?.service?.color || '#64748B';
}

function normalizeClockTime(value) {
  const text = formatClock(value);
  return text === '00:00' && !String(value || '').startsWith('00:00') ? '' : text;
}

function dayTokenToJsDay(token) {
  const normalized = normalizeDayToken(token);
  const option = DAY_OPTIONS.find((day) => day.value === normalized);
  return Number.isInteger(option?.jsDay) ? option.jsDay : null;
}

function buildBusinessHours(serviceCapabilities) {
  const seen = new Set();
  const businessHours = [];
  for (const capability of serviceCapabilities || []) {
    for (const window of capability?.availability_windows || []) {
      const day = dayTokenToJsDay(window?.day);
      const startTime = normalizeClockTime(window?.start);
      const endTime = normalizeClockTime(window?.end);
      if (day == null || !startTime || !endTime) continue;
      const key = `${day}|${startTime}|${endTime}`;
      if (seen.has(key)) continue;
      seen.add(key);
      businessHours.push({ daysOfWeek: [day], startTime, endTime });
    }
  }
  return businessHours;
}

function formatCalendarBound(minutes) {
  const safe = Math.max(0, Math.min(24 * 60, Number(minutes) || 0));
  const hours = Math.floor(safe / 60);
  const mins = safe % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:00`;
}

function buildBounds({ templates, instructors, viewMode, selectedDay }) {
  const days = viewMode === 'day' ? [selectedDay] : DAY_OPTIONS.map((day) => day.value);
  const bounds = [];

  for (const instructor of instructors || []) {
    for (const capability of instructor?.service_capabilities || []) {
      for (const day of days) {
        for (const window of getAvailabilityWindowsForDay(capability?.availability_windows, day)) {
          const start = timeToMinutes(window.start);
          const end = timeToMinutes(window.end);
          if (start != null) bounds.push(start);
          if (end != null) bounds.push(end);
        }
      }
    }
  }

  for (const template of templates || []) {
    const day = normalizeDayToken(template?.day_of_week);
    if (!days.includes(day)) continue;
    const start = timeToMinutes(template?.time_of_day);
    const end = start == null ? null : start + (Number(template?.duration_minutes) || 0);
    if (start != null) bounds.push(start);
    if (end != null) bounds.push(end);
  }

  if (!bounds.length) {
    return { slotMinTime: '08:00:00', slotMaxTime: '18:00:00' };
  }

  const min = Math.max(0, Math.floor(Math.min(...bounds) / 15) * 15 - 30);
  const max = Math.min(24 * 60, Math.ceil(Math.max(...bounds) / 15) * 15 + 30);
  return {
    slotMinTime: formatCalendarBound(min),
    slotMaxTime: formatCalendarBound(Math.max(min + 60, max)),
  };
}

function buildResources(instructors) {
  return (instructors || [])
    .filter((instructor) => instructor?.id)
    .map((instructor) => ({
      id: String(instructor.id),
      title: getPersonName(instructor),
      businessHours: buildBusinessHours(instructor.service_capabilities),
      extendedProps: { instructor },
    }));
}

function buildTemplateEvents({ templates, showInactive, waitingListTemplateMatches }) {
  return (templates || [])
    .filter((template) => template?.id && template?.instructor_employee_id)
    .filter((template) => showInactive || template.is_active !== false)
    .map((template) => {
      const day = normalizeDayToken(template.day_of_week);
      const start = formatDateTime(day, template.time_of_day);
      if (!start) return null;
      const duration = Number(template.duration_minutes) || 60;
      const end = addMinutesLocalDateTime(start, duration);
      const bucket = waitingListTemplateMatches?.[template.id] || null;
      return {
        id: `template-${template.id}`,
        start,
        end,
        resourceId: String(template.instructor_employee_id),
        title: getServiceName(template),
        classNames: ['reinex-template-event', template.is_active === false ? 'reinex-template-event--inactive' : ''],
        extendedProps: {
          kind: 'template',
          template,
          matchBucket: bucket,
          waitingCount: Number(bucket?.count) || 0,
        },
      };
    })
    .filter(Boolean);
}

function buildClearSpaceEvents(candidates) {
  const grouped = new Map();
  for (const candidate of candidates || []) {
    if (candidate?.mode !== 'clear_space') continue;
    const day = normalizeDayToken(candidate.day_of_week);
    const key = `${candidate.instructor_id}|${day}|${candidate.time_of_day}|${candidate.duration_minutes}`;
    const existing = grouped.get(key) || {
      candidate,
      candidates: [],
    };
    existing.candidates.push(candidate);
    grouped.set(key, existing);
  }

  return Array.from(grouped.values()).map((bucket) => {
    const candidate = bucket.candidate;
    const start = formatDateTime(candidate.day_of_week, candidate.time_of_day);
    if (!start) return null;
    const duration = Number(candidate.duration_minutes) || 60;
    const end = addMinutesLocalDateTime(start, duration);
    return {
      id: `clear-space-${candidate.instructor_id}-${candidate.day_of_week}-${candidate.time_of_day}-${duration}`,
      start,
      end,
      resourceId: String(candidate.instructor_id),
      title: 'חלון פנוי',
      classNames: ['reinex-template-clear-space-event'],
      extendedProps: {
        kind: 'clear_space_match',
        matchBucket: {
          count: bucket.candidates.length,
          candidates: bucket.candidates,
        },
        waitingCount: bucket.candidates.length,
        candidate,
      },
    };
  }).filter(Boolean);
}

function TemplateEventContent({ event }) {
  const { kind, previewKind, template, waitingCount } = event.extendedProps || {};
  if (kind === 'service_drop' || previewKind === 'service_drop') {
    return (
      <div className="reinex-template-clear-space-card">
        <div className="reinex-template-clear-space-card__title">{event.title || 'שירות'}</div>
        <div className="reinex-template-clear-space-card__meta">גרירה ליצירת תבנית</div>
      </div>
    );
  }

  if (kind === 'clear_space_match') {
    return (
      <div className="reinex-template-clear-space-card">
        <div className="reinex-template-clear-space-card__title">חלון פנוי לשיבוץ נפרד</div>
        <div className="reinex-template-clear-space-card__meta">{waitingCount} ממתינים</div>
      </div>
    );
  }

  const serviceColor = getServiceColor(template);
  return (
    <div
      className={cn('reinex-template-event-card', template?.is_active === false && 'reinex-template-event-card--inactive')}
      style={{ '--reinex-template-accent': serviceColor }}
    >
      <div className="reinex-template-event-card__top">
        <div className="reinex-template-event-card__title">
          <User className="h-3 w-3 shrink-0" />
          <span>{getTemplateStudentName(template)}</span>
        </div>
        {waitingCount > 0 ? (
          <Badge className="reinex-template-event-card__badge">{waitingCount} ממתינים</Badge>
        ) : null}
      </div>
      <div className="reinex-template-event-card__service">{getServiceName(template)}</div>
      <div className="reinex-template-event-card__time">
        <Clock className="h-3 w-3" />
        {formatClock(template?.time_of_day)} · {Number(template?.duration_minutes) || 0} דק׳
      </div>
    </div>
  );
}

export function TemplateScheduleCalendar({
  templates,
  instructors,
  showInactive,
  viewMode,
  selectedDay,
  showWaitingListMatches,
  waitingListTemplateMatches,
  waitingListCandidates,
  isLoading = false,
  onTemplateClick,
  onSlotClick,
  onExternalServiceDrop,
  onWaitingListMatchClick,
}) {
  const calendarRef = useRef(null);
  const resources = useMemo(() => buildResources(instructors), [instructors]);
  const bounds = useMemo(
    () => buildBounds({ templates, instructors, viewMode, selectedDay }),
    [instructors, selectedDay, templates, viewMode],
  );
  const events = useMemo(() => {
    const templateEvents = buildTemplateEvents({
      templates,
      showInactive,
      waitingListTemplateMatches: showWaitingListMatches ? waitingListTemplateMatches : {},
    });
    if (!showWaitingListMatches) {
      return templateEvents;
    }
    return [
      ...templateEvents,
      ...buildClearSpaceEvents(waitingListCandidates),
    ];
  }, [showInactive, showWaitingListMatches, templates, waitingListCandidates, waitingListTemplateMatches]);
  const initialDate = viewMode === 'day' ? DAY_DATE_BY_TOKEN[selectedDay] || TEMPLATE_WEEK_START : TEMPLATE_WEEK_START;
  const initialView = viewMode === 'day' ? 'resourceTimeGridDay' : 'resourceTimeGridWeek';

  function handleExternalDrop(dropInfo) {
    const startDate = dropInfo?.date instanceof Date ? dropInfo.date : null;
    const resourceId = dropInfo?.resource?.id || null;
    const draggedEl = dropInfo?.draggedEl;
    const serviceId = draggedEl?.getAttribute?.('data-service-id') || '';
    const durationMinutes = Number(draggedEl?.getAttribute?.('data-service-duration-minutes')) || 0;
    const dayOfWeek = normalizeDayToken(startDate?.getDay?.());
    const timeOfDay = ceilClockTimeToGrid(formatDateObjectTime(startDate));

    if (!serviceId || !resourceId || !dayOfWeek || !timeOfDay || durationMinutes <= 0) {
      toast.error('אי אפשר לפתוח יצירת תבנית מהשירות שנגרר.');
      return;
    }

    onExternalServiceDrop?.({
      serviceId,
      resourceId: String(resourceId),
      dayOfWeek,
      timeOfDay,
      durationMinutes,
    });
  }

  useEffect(() => {
    const api = calendarRef.current?.getApi?.();
    if (!api) return;
    api.changeView(initialView, initialDate);
  }, [initialDate, initialView]);

  return (
    <div className="reinex-fullcalendar-shell reinex-template-calendar-shell">
      {isLoading ? (
        <div className="reinex-fullcalendar-loading">
          <Loader2 className="h-8 w-8 animate-spin text-gray-500" />
        </div>
      ) : null}

      <div className="reinex-fullcalendar reinex-template-calendar">
        <FullCalendar
          ref={calendarRef}
          plugins={[resourceTimeGridPlugin, timeGridPlugin, interactionPlugin]}
          schedulerLicenseKey="GPL-My-Project-Is-Open-Source"
          initialView={initialView}
          initialDate={initialDate}
          locale={heLocale}
          direction="rtl"
          businessHours
          firstDay={0}
          datesAboveResources={viewMode === 'week'}
          headerToolbar={false}
          resources={resources}
          events={events}
          selectable
          selectMirror
          editable={false}
          droppable
          dropAccept=".calendar-service-drag-item"
          allDaySlot={false}
          slotEventOverlap={false}
          eventMinHeight={22}
          eventShortHeight={26}
          slotMinTime={bounds.slotMinTime}
          slotMaxTime={bounds.slotMaxTime}
          height="100%"
          resourceOrder="title"
          drop={handleExternalDrop}
          eventClick={(info) => {
            const kind = info.event.extendedProps?.kind;
            if (kind === 'clear_space_match') {
              onWaitingListMatchClick?.({
                mode: 'clear_space',
                bucket: info.event.extendedProps.matchBucket,
                template: null,
                instructor: info.event.getResources?.()?.[0]?.extendedProps?.instructor || null,
                dayOfWeek: normalizeDayToken(info.event.start?.getDay?.()),
              });
              return;
            }

            const bucket = info.event.extendedProps?.matchBucket;
            if (showWaitingListMatches && Number(bucket?.count) > 0 && info.jsEvent?.target?.closest?.('.reinex-template-event-card__badge')) {
              onWaitingListMatchClick?.({
                mode: 'capacity',
                bucket,
                template: info.event.extendedProps.template,
                instructor: info.event.getResources?.()?.[0]?.extendedProps?.instructor || null,
                dayOfWeek: normalizeDayToken(info.event.start?.getDay?.()),
              });
              return;
            }

            onTemplateClick?.(info.event.extendedProps?.template);
          }}
          select={(selection) => {
            const day = normalizeDayToken(selection.start?.getDay?.());
            const instructor = selection.resource?.extendedProps?.instructor || null;
            if (!day || !instructor) return;
            onSlotClick?.(instructor, day, formatDateObjectTime(selection.start));
            selection.view.calendar.unselect();
          }}
          eventContent={(arg) => <TemplateEventContent event={arg.event} />}
          dayHeaderContent={(arg) => dayLabel(arg.date?.getDay?.()) || arg.text}
          views={{
            resourceTimeGridDay: {
              slotDuration: '00:15:00',
              slotLabelInterval: '01:00:00',
              slotLabelFormat: [{ hour: '2-digit', minute: '2-digit', hour12: false }],
              dayHeaderFormat: { weekday: 'long' },
            },
            resourceTimeGridWeek: {
              slotDuration: '00:15:00',
              slotLabelInterval: '01:00:00',
              slotLabelFormat: [{ hour: '2-digit', minute: '2-digit', hour12: false }],
              dayHeaderFormat: { weekday: 'short' },
            },
          }}
        />
      </div>
    </div>
  );
}
