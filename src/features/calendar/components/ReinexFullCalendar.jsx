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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
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
import {
  buildInstructorDayMessage,
  buildInstructorWeekMessage,
  getInstructorDayLessons,
  getInstructorWeekLessons,
} from '../utils/instructor-whatsapp.js';
import { CALENDAR_WEEK_START } from '../utils/localDate.js';
import InstructorWhatsAppDialog from './InstructorWhatsAppDialog.jsx';
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

  return (
    <TooltipProvider delayDuration={120}>
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
          {reminderBadge}
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
          {reminderBadge}
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
  const [whatsAppCompose, setWhatsAppCompose] = useState(null);

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

  const closeWhatsAppCompose = useCallback(() => {
    setWhatsAppCompose(null);
  }, []);

  const openInstructorWhatsApp = useCallback((instructor, mode) => {
    if (!instructor?.id) {
      return;
    }

    const lessons = mode === 'week'
      ? getInstructorWeekLessons(instances, instructor.id, currentDate)
      : getInstructorDayLessons(instances, instructor.id, currentDate);

    if (!lessons.length) {
      toast.error(mode === 'week' ? 'אין שיעורים מתוכננים או שהושלמו למדריך זה השבוע.' : 'אין שיעורים מתוכננים או שהושלמו למדריך זה ביום זה.');
      return;
    }

    const message = mode === 'week'
      ? buildInstructorWeekMessage({ instructorName: instructor.full_name || 'מדריך', dateString: currentDate, lessons })
      : buildInstructorDayMessage({ instructorName: instructor.full_name || 'מדריך', dateString: currentDate, lessons });

    setWhatsAppCompose({
      mode,
      title: mode === 'week' ? `שליחת סיכום שבועי ל-${instructor.full_name}` : `שליחת סיכום יומי ל-${instructor.full_name}`,
      description: instructor.phone
        ? 'ההודעה מוכנה לשליחה. ניתן לערוך לפני פתיחה ב-WhatsApp.'
        : 'למדריך אין מספר טלפון שמור. יש להזין מספר טלפון כדי להמשיך.',
      phone: instructor.phone || '',
      message,
    });
  }, [currentDate, instances]);

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
            openInstructorWhatsApp(instructor, 'day');
          }}
        >
          <WhatsAppIcon className="h-3.5 w-3.5" />
          וואטסאפ
        </Button>
      </div>
    );
  }, [openInstructorWhatsApp]);

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

      {viewMode === 'week' ? (
        <div className="reinex-fullcalendar-week-actions">
          {instructors.map((instructor) => (
            <Button
              key={instructor.id}
              type="button"
              variant="outline"
              size="sm"
              className="reinex-fullcalendar-week-actions__button"
              onClick={() => openInstructorWhatsApp(instructor, 'week')}
            >
              <WhatsAppIcon className="h-3.5 w-3.5" />
              {instructor.full_name}
            </Button>
          ))}
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
          firstDay={CALENDAR_WEEK_START}
          headerToolbar={false}
          resources={mappedResources}
          resourceLabelContent={handleResourceLabelContent}
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

      <InstructorWhatsAppDialog
        open={!!whatsAppCompose}
        onOpenChange={(open) => {
          if (!open) {
            closeWhatsAppCompose();
          }
        }}
        mode={whatsAppCompose?.mode || 'day'}
        title={whatsAppCompose?.title || ''}
        description={whatsAppCompose?.description || ''}
        phone={whatsAppCompose?.phone || ''}
        onPhoneChange={(value) => setWhatsAppCompose((current) => (current ? { ...current, phone: value } : current))}
        message={whatsAppCompose?.message || ''}
        onMessageChange={(value) => setWhatsAppCompose((current) => (current ? { ...current, message: value } : current))}
      />
    </div>
  );
}
