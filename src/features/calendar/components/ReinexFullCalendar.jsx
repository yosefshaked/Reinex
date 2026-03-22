import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import interactionPlugin from '@fullcalendar/interaction';
import timeGridPlugin from '@fullcalendar/timegrid';
import resourceTimeGridPlugin from '@fullcalendar/resource-timegrid';
import heLocale from '@fullcalendar/core/locales/he';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { authenticatedFetch } from '@/lib/api-client.js';
import { useOrg } from '@/org/OrgContext.jsx';
import { useRuntimeConfig } from '@/runtime/RuntimeConfigContext.jsx';
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
import { formatTimeDisplay, getInstanceStatusIcon } from '../utils/timeGrid';
import { mapInstancesToEvents, mapInstructorsToResources } from '../utils/fullcalendar-adapter.js';
import './reinex-fullcalendar.css';

function toLocalDateString(dateObj) {
  if (!(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) return null;
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function resolveCalendarView(viewMode) {
  return viewMode === 'week' ? 'timeGridWeek' : 'resourceTimeGridDay';
}

function resolveSchedulerLicenseKey(runtimeConfig) {
  return (
    runtimeConfig?.fullcalendarSchedulerLicenseKey
    || runtimeConfig?.FULLCALENDAR_SCHEDULER_LICENSE_KEY
    || import.meta.env.VITE_FULLCALENDAR_SCHEDULER_LICENSE_KEY
    || undefined
  );
}

function buildEventGradient(color) {
  const baseColor = typeof color === 'string' && color.trim() ? color.trim() : '#4F46E5';
  return `linear-gradient(135deg, ${baseColor} 0%, ${baseColor}dd 100%)`;
}

function getEventDensityClass(durationMinutes) {
  if (durationMinutes <= 20) return 'reinex-calendar-event--xs';
  if (durationMinutes <= 30) return 'reinex-calendar-event--compact';
  if (durationMinutes <= 45) return 'reinex-calendar-event--mid';
  return '';
}

function EventContent({ arg }) {
  const instance = arg.event.extendedProps?.instance;
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

  if (!instance) {
    return <div className="reinex-calendar-event">פריט חסר</div>;
  }

  const firstStudentName = instance.participants?.[0]?.student?.full_name || 'ללא תלמיד';
  const additionalCount = Math.max(0, (instance.participants?.length || 1) - 1);
  const statusInfo = getInstanceStatusIcon(instance.status, instance.documentation_status);
  const durationMinutes = Number(instance.duration_minutes) || 0;
  const densityClass = getEventDensityClass(durationMinutes);
  const isVeryNarrow = contentWidth != null && contentWidth < 115;
  const isNarrow = contentWidth != null && contentWidth < 175;
  const isStudentOnlySummary = durationMinutes <= 20 || isVeryNarrow;
  const isInlineSummary = !isStudentOnlySummary && (durationMinutes <= 30 || isNarrow);
  const studentLabel = `${firstStudentName}${additionalCount > 0 ? ` +${additionalCount}` : ''}`;
  const serviceLabel = instance.service?.service_name || 'שיעור';

  return (
    <div
      ref={rootRef}
      className={`reinex-calendar-event ${densityClass} ${isInlineSummary ? 'reinex-calendar-event--inline' : ''} ${isStudentOnlySummary ? 'reinex-calendar-event--student-only' : ''}`.trim()}
      style={{ background: buildEventGradient(instance.service?.color) }}
      title={`${instance.service?.service_name || 'שיעור'} • ${firstStudentName}`}
    >
      {isStudentOnlySummary ? (
        <div className="reinex-calendar-event__inline">
          <span className="reinex-calendar-event__status" aria-label={statusInfo.label} title={statusInfo.label}>
            {statusInfo.icon}
          </span>
          <span className="reinex-calendar-event__inline-main">
            <span className="reinex-calendar-event__student">{studentLabel}</span>
          </span>
        </div>
      ) : isInlineSummary ? (
        <div className="reinex-calendar-event__inline">
          <span className="reinex-calendar-event__status" aria-label={statusInfo.label} title={statusInfo.label}>
            {statusInfo.icon}
          </span>
          <span className="reinex-calendar-event__inline-main">
            <span className="reinex-calendar-event__student">{studentLabel}</span>
            <span className="reinex-calendar-event__separator">•</span>
            <span className="reinex-calendar-event__service">{serviceLabel}</span>
          </span>
        </div>
      ) : (
        <>
      <div className="reinex-calendar-event__top">
        <span className="reinex-calendar-event__service">
          {serviceLabel}
        </span>
        <span className="reinex-calendar-event__status" aria-label={statusInfo.label} title={statusInfo.label}>
          {statusInfo.icon}
        </span>
      </div>

      <div className="reinex-calendar-event__student">{studentLabel}</div>

      <div className="reinex-calendar-event__meta">
        <span className="reinex-calendar-event__time">{arg.timeText || formatTimeDisplay(instance.datetime_start)}</span>
        {instance.documentation_status === 'undocumented' && instance.status === 'completed' ? (
          <span className="reinex-calendar-event__badge">לא תועד</span>
        ) : null}
      </div>
        </>
      )}
    </div>
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
  onDateChange,
  onViewModeChange,
  onSlotSelect,
  onEventClick,
  onEventRescheduled,
}) {
  const calendarRef = useRef(null);
  const isProgrammaticMoveRef = useRef(false);
  const runtimeConfig = useRuntimeConfig();
  const { activeOrgId } = useOrg();
  const [updatingEventId, setUpdatingEventId] = useState(null);
  const [pendingDropInfo, setPendingDropInfo] = useState(null);

  const mappedEvents = useMemo(() => mapInstancesToEvents(instances), [instances]);
  const mappedResources = useMemo(() => mapInstructorsToResources(instructors), [instructors]);
  const schedulerLicenseKey = useMemo(() => resolveSchedulerLicenseKey(runtimeConfig), [runtimeConfig]);
  const fullCalendarView = resolveCalendarView(viewMode);

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

    isProgrammaticMoveRef.current = true;

    if (api.view.type !== fullCalendarView) {
      api.changeView(fullCalendarView, currentDate);
    } else {
      api.gotoDate(currentDate);
    }

    const releaseTimer = window.setTimeout(() => {
      isProgrammaticMoveRef.current = false;
    }, 50);

    return () => {
      window.clearTimeout(releaseTimer);
      isProgrammaticMoveRef.current = false;
    };
  }, [currentDate, fullCalendarView]);

  const handleDatesSet = useCallback((info) => {
    const nextViewMode = info.view.type === 'timeGridWeek' ? 'week' : 'day';
    if (nextViewMode !== viewMode) {
      onViewModeChange?.(nextViewMode);
    }

    if (typeof onDateChange === 'function' && nextViewMode === 'day') {
      const activeDate = info.view.currentStart || info.start;
      const nextDate = toLocalDateString(activeDate);
      if (!isProgrammaticMoveRef.current && nextDate && nextDate !== currentDate) {
        onDateChange(nextDate);
      }
    }
  }, [currentDate, onDateChange, onViewModeChange, viewMode]);

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

    setPendingDropInfo(info);
  }, [activeOrgId]);

  const clearPendingDrop = useCallback(() => {
    setPendingDropInfo(null);
  }, []);

  const confirmPendingDrop = useCallback(async () => {
    if (!pendingDropInfo) {
      return;
    }

    const instance = pendingDropInfo.event.extendedProps?.instance;
    const nextStart = pendingDropInfo.event.start;
    const nextResourceId = pendingDropInfo.newResource?.id
      || pendingDropInfo.event.getResources?.()?.[0]?.id
      || instance?.instructor_employee_id;

    if (!activeOrgId || !instance?.id || !nextStart || !nextResourceId) {
      pendingDropInfo.revert();
      clearPendingDrop();
      toast.error('לא ניתן לעדכן את השיעור כרגע.');
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
        pendingDropInfo.revert();
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
        },
      });

      toast.success('השיעור עודכן.');
      clearPendingDrop();
      onEventRescheduled?.();
    } catch (error) {
      pendingDropInfo.revert();
      toast.error(error?.message || 'העברת השיעור נכשלה.');
      clearPendingDrop();
    } finally {
      setUpdatingEventId(null);
    }
  }, [activeOrgId, clearPendingDrop, onEventRescheduled, pendingDropInfo]);

  const cancelPendingDrop = useCallback(() => {
    pendingDropInfo?.revert?.();
    clearPendingDrop();
  }, [clearPendingDrop, pendingDropInfo]);

  if (!mappedResources.length && !isLoading) {
    return (
      <div className="reinex-fullcalendar-empty">
        אין מדריכים להצגה
      </div>
    );
  }

  return (
    <div className="reinex-fullcalendar-shell">
      {(isLoading || updatingEventId) ? (
        <div className="reinex-fullcalendar-loading">
          <Loader2 className="h-8 w-8 animate-spin text-gray-500" />
        </div>
      ) : null}

      <div className="reinex-fullcalendar">
        <FullCalendar
          ref={calendarRef}
          plugins={[resourceTimeGridPlugin, timeGridPlugin, interactionPlugin]}
          initialView={fullCalendarView}
          initialDate={currentDate}
          schedulerLicenseKey={schedulerLicenseKey || 'GPL-v3'}
          locale={heLocale}
          direction="rtl"
          headerToolbar={false}
          resources={mappedResources}
          events={mappedEvents}
          editable
          eventStartEditable
          eventDurationEditable={false}
          eventResourceEditable
          selectable
          selectMirror
          select={handleDateSelect}
          allDaySlot={false}
          slotEventOverlap={false}
          eventMinHeight={12}
          eventShortHeight={18}
          nowIndicator
          slotMinTime="06:00:00"
          slotMaxTime="22:00:00"
          height="auto"
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
            timeGridWeek: {
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
            <AlertDialogTitle>האם להעביר את השיעור למועד זה?</AlertDialogTitle>
            <AlertDialogDescription>
              הפעולה תעדכן את מועד השיעור ותבדוק התנגשויות לפני השמירה.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={cancelPendingDrop}>ביטול</AlertDialogCancel>
            <AlertDialogAction onClick={confirmPendingDrop}>אישור</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
