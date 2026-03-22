import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import interactionPlugin from '@fullcalendar/interaction';
import resourceTimelinePlugin from '@fullcalendar/resource-timeline';
import heLocale from '@fullcalendar/core/locales/he';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { authenticatedFetch } from '@/lib/api-client.js';
import { useOrg } from '@/org/OrgContext.jsx';
import { useRuntimeConfig } from '@/runtime/RuntimeConfigContext.jsx';
import { formatTimeDisplay, getInstanceStatusIcon } from '../utils/timeGrid';
import { mapInstancesToEvents, mapInstructorsToResources } from '../utils/fullcalendar-adapter.js';
import './reinex-fullcalendar.css';

function resolveCalendarView(viewMode) {
  return viewMode === 'week' ? 'resourceTimelineWeek' : 'resourceTimelineDay';
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

function renderEventContent(arg) {
  const instance = arg.event.extendedProps?.instance;
  if (!instance) {
    return <div className="reinex-calendar-event">פריט חסר</div>;
  }

  const firstStudentName = instance.participants?.[0]?.student?.full_name || 'ללא תלמיד';
  const additionalCount = Math.max(0, (instance.participants?.length || 1) - 1);
  const endDate = new Date(new Date(instance.datetime_start).getTime() + (instance.duration_minutes || 0) * 60000);
  const statusInfo = getInstanceStatusIcon(instance.status, instance.documentation_status);

  return (
    <div
      className="reinex-calendar-event"
      style={{ background: buildEventGradient(instance.service?.color) }}
      title={`${instance.service?.service_name || 'שיעור'} • ${firstStudentName}`}
    >
      <div className="reinex-calendar-event__top">
        <span className="reinex-calendar-event__service">
          {instance.service?.service_name || 'שיעור'}
        </span>
        <span aria-label={statusInfo.label} title={statusInfo.label}>
          {statusInfo.icon}
        </span>
      </div>

      <div className="reinex-calendar-event__student">
        {firstStudentName}
        {additionalCount > 0 ? ` +${additionalCount}` : ''}
      </div>

      <div className="reinex-calendar-event__meta">
        <span className="reinex-calendar-event__time">
          {formatTimeDisplay(instance.datetime_start)} - {formatTimeDisplay(endDate.toISOString())}
        </span>
        {instance.documentation_status === 'undocumented' && instance.status === 'completed' ? (
          <span className="reinex-calendar-event__badge">לא תועד</span>
        ) : null}
      </div>
    </div>
  );
}

export default function ReinexFullCalendar({
  currentDate,
  viewMode,
  instances,
  instructors,
  isLoading = false,
  onDateChange,
  onViewModeChange,
  onEventClick,
  onEventRescheduled,
}) {
  const calendarRef = useRef(null);
  const runtimeConfig = useRuntimeConfig();
  const { activeOrgId } = useOrg();
  const [updatingEventId, setUpdatingEventId] = useState(null);

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

    if (api.view.type !== fullCalendarView) {
      api.changeView(fullCalendarView, currentDate);
      return;
    }

    api.gotoDate(currentDate);
  }, [currentDate, fullCalendarView]);

  const handleDatesSet = useCallback((info) => {
    const nextViewMode = info.view.type === 'resourceTimelineWeek' ? 'week' : 'day';
    if (nextViewMode !== viewMode) {
      onViewModeChange?.(nextViewMode);
    }

    if (typeof onDateChange === 'function' && nextViewMode === 'day') {
      const activeDate = info.view.currentStart || info.start;
      if (activeDate instanceof Date && !Number.isNaN(activeDate.getTime())) {
        const nextDate = activeDate.toISOString().split('T')[0];
        if (nextDate !== currentDate) {
          onDateChange(nextDate);
        }
      }
    }
  }, [currentDate, onDateChange, onViewModeChange, viewMode]);

  const handleEventClick = useCallback((info) => {
    const instance = info.event.extendedProps?.instance;
    if (instance) {
      onEventClick?.(instance);
    }
  }, [onEventClick]);

  const handleEventDrop = useCallback(async (info) => {
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
        info.revert();
        toast.error(firstMessage);
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
      onEventRescheduled?.();
    } catch (error) {
      info.revert();
      toast.error(error?.message || 'העברת השיעור נכשלה.');
    } finally {
      setUpdatingEventId(null);
    }
  }, [activeOrgId, onEventRescheduled]);

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
          plugins={[resourceTimelinePlugin, interactionPlugin]}
          initialView={fullCalendarView}
          initialDate={currentDate}
          schedulerLicenseKey={schedulerLicenseKey}
          locale={heLocale}
          direction="rtl"
          headerToolbar={false}
          resourceAreaHeaderContent="מדריכים"
          resourceAreaWidth="18rem"
          resources={mappedResources}
          events={mappedEvents}
          editable
          eventStartEditable
          eventDurationEditable={false}
          eventResourceEditable
          selectable={false}
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
            resourceTimelineDay: {
              slotDuration: '00:15:00',
              slotLabelInterval: '01:00:00',
              slotMinWidth: 18,
              slotLabelFormat: [
                { hour: '2-digit', minute: '2-digit', hour12: false },
              ],
            },
            resourceTimelineWeek: {
              slotDuration: '01:00:00',
              slotLabelInterval: '06:00:00',
              slotMinWidth: 28,
              slotLabelFormat: [
                { weekday: 'short', day: 'numeric', month: 'numeric' },
                { hour: '2-digit', minute: '2-digit', hour12: false },
              ],
            },
          }}
        />
      </div>
    </div>
  );
}
