import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge.jsx';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Plus, LayoutTemplate, Wand2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { DateNavigator } from '../components/CalendarHeader/DateNavigator.jsx';
import { LessonInstanceDialog } from '../components/LessonInstanceDialog';
import { AddLessonDialog } from '../components/AddLessonDialog';
import { ManualGenerationDialog } from '../components/ManualGenerationDialog';
import { useCalendarInstances, useCalendarInstructors } from '../hooks/useCalendar';
import ReinexFullCalendar from '../components/ReinexFullCalendar';
import CalendarWorkspaceDock from '../components/CalendarWorkspaceDock.jsx';
import InstructorWhatsAppDialog from '../components/InstructorWhatsAppDialog.jsx';
import EditServiceCapabilitiesDialog from '@/components/settings/employee-management/EditServiceCapabilitiesDialog.jsx';
import { useOrg } from '@/org/OrgContext.jsx';
import { useAuth } from '@/auth/AuthContext.jsx';
import { buildCalendarWorkspaceSummary } from '../utils/calendarWorkspace.js';
import {
  buildInstructorDayMessage,
  buildInstructorWeekMessage,
  getInstructorDayLessons,
  getInstructorWeekLessons,
} from '../utils/instructor-whatsapp.js';
import { addLocalDays, getTodayLocalDateString, getWeekStartDate, parseLocalDateString, toLocalDateString } from '../utils/localDate.js';
import { clearGenerationReview, readGenerationReview } from '../utils/generationReviewStorage.js';
import { toast } from 'sonner';

const CALENDAR_DATE_KEY = 'reinex_calendar_date';
const CALENDAR_VIEW_KEY = 'reinex_calendar_view';
const CALENDAR_LAST_DAY_KEY = 'reinex_calendar_last_day';

export default function CalendarPage() {
  const calendarNavigationRef = useRef(null);
  const [currentDate, setCurrentDateState] = useState(() => {
    const fallbackDate = getTodayLocalDateString();
    if (typeof window !== 'undefined') {
      const saved = sessionStorage.getItem(CALENDAR_DATE_KEY);
      return parseLocalDateString(saved || '') ? saved : fallbackDate;
    }
    return fallbackDate;
  });
  const [viewMode, setViewModeState] = useState(() => {
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem(CALENDAR_VIEW_KEY) || 'day';
    }
    return 'day';
  });

  const navigate = useNavigate();
  const { activeOrgId } = useOrg();
  const { session } = useAuth();
  const [selectedInstance, setSelectedInstance] = useState(null);
  const [showInstanceDialog, setShowInstanceDialog] = useState(false);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showGenerationDialog, setShowGenerationDialog] = useState(false);
  const [savedGenerationReview, setSavedGenerationReview] = useState(null);
  const [pendingSlotSelection, setPendingSlotSelection] = useState(null);
  const [pendingServiceId, setPendingServiceId] = useState('');
  const [whatsAppCompose, setWhatsAppCompose] = useState(null);
  const [availabilityFixIssue, setAvailabilityFixIssue] = useState(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem(CALENDAR_DATE_KEY, currentDate);
    }
  }, [currentDate]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem(CALENDAR_VIEW_KEY, viewMode);
    }
  }, [viewMode]);

  const refreshGenerationReview = useCallback(() => {
    if (!activeOrgId) {
      setSavedGenerationReview(null);
      return;
    }
    setSavedGenerationReview(readGenerationReview(activeOrgId));
  }, [activeOrgId]);

  useEffect(() => {
    refreshGenerationReview();
  }, [refreshGenerationReview]);

  const setCurrentDate = useCallback((newDate) => {
    const normalizedDate = typeof newDate === 'string'
      ? newDate
      : toLocalDateString(newDate);
    if (parseLocalDateString(normalizedDate || '')) {
      setCurrentDateState((current) => (current === normalizedDate ? current : normalizedDate));
    }
  }, []);

  const setViewMode = useCallback((mode) => {
    setViewModeState((current) => (current === mode ? current : mode));
  }, []);

  useEffect(() => {
    if (viewMode === 'day' && typeof window !== 'undefined') {
      sessionStorage.setItem(CALENDAR_LAST_DAY_KEY, currentDate);
    }
  }, [currentDate, viewMode]);

  const handleSwitchToDay = useCallback(() => {
    if (viewMode === 'week') {
      const weekStart = toLocalDateString(getWeekStartDate(currentDate));
      const weekEnd = toLocalDateString(addLocalDays(weekStart, 6));
      const lastDay = typeof window !== 'undefined' ? sessionStorage.getItem(CALENDAR_LAST_DAY_KEY) : null;
      if (lastDay && weekStart && weekEnd && lastDay >= weekStart && lastDay <= weekEnd) {
        setCurrentDate(lastDay);
      } else {
        const today = getTodayLocalDateString();
        if (weekStart && weekEnd && today >= weekStart && today <= weekEnd) {
          setCurrentDate(today);
        }
        // else: keep currentDate as-is (week start = first day of week)
      }
    }
    setViewMode('day');
  }, [currentDate, viewMode, setCurrentDate, setViewMode]);

  const handleCalendarNavigate = useCallback((action) => {
    if (action === 'today') {
      setCurrentDate(getTodayLocalDateString());
      return;
    }

    const days = viewMode === 'week' ? 7 : 1;
    if (action === 'next') {
      const nextDate = addLocalDays(currentDate, days);
      if (nextDate) {
        setCurrentDate(nextDate);
      }
      return;
    }

    if (action === 'prev') {
      const prevDate = addLocalDays(currentDate, -days);
      if (prevDate) {
        setCurrentDate(prevDate);
      }
    }
  }, [currentDate, viewMode, setCurrentDate]);

  const dateForQuery = viewMode === 'week'
    ? toLocalDateString(getWeekStartDate(currentDate))
    : currentDate;

  const {
    instructors,
    isLoading: instructorsLoading,
    error: instructorsError,
    refetch: refetchInstructors,
  } = useCalendarInstructors();
  const { instances, isLoading: instancesLoading, error: instancesError, refetch: refetchInstances } = useCalendarInstances(dateForQuery, viewMode);
  const isCalendarLoading = instructorsLoading || instancesLoading;

  const workspaceSummary = useMemo(
    () => buildCalendarWorkspaceSummary({ currentDate, viewMode, instances, instructors }),
    [currentDate, instructors, instances, viewMode],
  );

  useEffect(() => {
    if (!selectedInstance?.id || !Array.isArray(instances) || instancesLoading) {
      return;
    }

    const refreshedSelectedInstance = instances.find((instance) => instance.id === selectedInstance.id);
    if (refreshedSelectedInstance) {
      setSelectedInstance(refreshedSelectedInstance);
      return;
    }

    setSelectedInstance(null);
    setShowInstanceDialog(false);
  }, [instances, instancesLoading, selectedInstance?.id]);

  const clearSelections = useCallback(() => {
    setPendingSlotSelection(null);
    setPendingServiceId('');
    setSelectedInstance(null);
    setShowInstanceDialog(false);
  }, []);

  useEffect(() => {
    setPendingSlotSelection(null);
    setPendingServiceId('');
    setSelectedInstance(null);
    setShowInstanceDialog(false);
  }, [currentDate, viewMode]);

  const handleInstanceClick = (instance) => {
    setPendingSlotSelection(null);
    setSelectedInstance(instance);
    setShowInstanceDialog(true);
  };

  const handleCloseDialog = () => {
    setShowInstanceDialog(false);
  };

  const handleOpenSelectedLesson = useCallback(() => {
    if (selectedInstance) {
      setShowInstanceDialog(true);
    }
  }, [selectedInstance]);

  const handleOpenCreateLesson = useCallback(() => {
    setPendingServiceId('');
    setShowAddDialog(true);
  }, []);

  const handleOpenBlankCreateLesson = useCallback(() => {
    setPendingSlotSelection(null);
    setPendingServiceId('');
    setShowAddDialog(true);
  }, []);

  const handleAddSuccess = () => {
    refetchInstances();
    setPendingSlotSelection(null);
    setPendingServiceId('');
  };

  const handleUpdateSuccess = () => {
    refetchInstances();
  };

  const handleRescheduleSuccess = () => {
    refetchInstances();
  };

  const handleGenerationApplied = () => {
    refetchInstances();
    refreshGenerationReview();
  };

  const handleDismissGenerationReview = useCallback(() => {
    if (!activeOrgId) {
      return;
    }
    clearGenerationReview(activeOrgId);
    setSavedGenerationReview(null);
  }, [activeOrgId]);

  const handleSlotSelect = (selection) => {
    setSelectedInstance(null);
    setShowInstanceDialog(false);
    setPendingServiceId('');
    setPendingSlotSelection(selection);
  };

  const handleExternalServiceDrop = useCallback(({ serviceId, start, end, resourceId }) => {
    if (!serviceId || !(start instanceof Date) || Number.isNaN(start.getTime()) || !(end instanceof Date) || Number.isNaN(end.getTime()) || !resourceId) {
      toast.error('לא ניתן לפתוח יצירה מהגרירה הזאת.');
      return;
    }

    setSelectedInstance(null);
    setShowInstanceDialog(false);
    setPendingServiceId(String(serviceId));
    setPendingSlotSelection({
      start,
      end,
      resourceId: String(resourceId),
      startStr: start.toISOString(),
      endStr: end.toISOString(),
    });
    setShowAddDialog(true);
  }, []);

  const selectedSlotSummary = useMemo(() => {
    if (!pendingSlotSelection?.start || !pendingSlotSelection?.end) {
      return null;
    }

    const instructor = instructors.find((entry) => String(entry.id) === String(pendingSlotSelection.resourceId || ''));
    return {
      ...pendingSlotSelection,
      startDateString: toLocalDateString(pendingSlotSelection.start),
      instructorName: instructor?.full_name || 'מדריך/ה',
    };
  }, [instructors, pendingSlotSelection]);
  const availabilityFixInstructor = useMemo(
    () => instructors.find((instructor) => String(instructor.id) === String(availabilityFixIssue?.instructorId || '')) || null,
    [availabilityFixIssue?.instructorId, instructors],
  );

  const openInstructorWhatsApp = useCallback((instructorOverride = null) => {
    const normalizedInstructorOverride = instructorOverride && typeof instructorOverride === 'object' && 'id' in instructorOverride
      ? instructorOverride
      : null;

    const sourceInstructor = normalizedInstructorOverride
      || selectedInstance?.instructor
      || instructors.find((instructor) => String(instructor.id) === String(selectedInstance?.instructor_employee_id || ''))
      || null;

    if (!sourceInstructor?.id) {
      toast.error('לא נבחר מדריך/ה לשליחת סיכום.');
      return;
    }

    const mode = viewMode === 'week' ? 'week' : 'day';
    const lessons = mode === 'week'
      ? getInstructorWeekLessons(instances, sourceInstructor.id, currentDate)
      : getInstructorDayLessons(instances, sourceInstructor.id, currentDate);

    if (!lessons.length) {
      toast.error(mode === 'week' ? 'אין שיעורים מתוכננים או שהושלמו למדריך זה השבוע.' : 'אין שיעורים מתוכננים או שהושלמו למדריך זה ביום זה.');
      return;
    }

    const message = mode === 'week'
      ? buildInstructorWeekMessage({ instructorName: sourceInstructor.full_name || 'מדריך', dateString: currentDate, lessons })
      : buildInstructorDayMessage({ instructorName: sourceInstructor.full_name || 'מדריך', dateString: currentDate, lessons });

    setWhatsAppCompose({
      mode,
      title: mode === 'week' ? `שליחת סיכום שבועי ל-${sourceInstructor.full_name}` : `שליחת סיכום יומי ל-${sourceInstructor.full_name}`,
      description: sourceInstructor.phone
        ? 'ההודעה מוכנה לשליחה. ניתן לערוך לפני פתיחה ב-WhatsApp.'
        : 'למדריך אין מספר טלפון שמור. יש להזין מספר טלפון כדי להמשיך.',
      phone: sourceInstructor.phone || '',
      message,
    });
  }, [currentDate, instructors, instances, selectedInstance, viewMode]);
  const handleFixAvailabilityIssue = useCallback((issue) => {
    if (!issue?.instructorId || !issue?.focusServiceId) {
      toast.error('לא נמצא שירות מתאים לתיקון הזמינות.');
      return;
    }

    setAvailabilityFixIssue(issue);
  }, []);
  const handleAvailabilityFixSaved = useCallback(() => {
    setAvailabilityFixIssue(null);
    refetchInstructors();
  }, [refetchInstructors]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Compact top bar: page title + action buttons + date navigator + view toggle */}
      <div className="flex-shrink-0 border-b border-slate-100 bg-background px-4 py-3">
        <div className="mx-auto" style={{ maxWidth: "min(1680px, calc(100vw - 1.5rem))" }}>
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="shrink-0 text-lg font-semibold text-neutral-900">לוח זמנים</h1>
              <Button onClick={handleOpenBlankCreateLesson} className="gap-2">
                <Plus className="h-4 w-4" />
                שיעור חדש
              </Button>
              <Button variant="outline" onClick={() => setShowGenerationDialog(true)} className="gap-2">
                <Wand2 className="h-4 w-4" />
                יצירה מתבניות
              </Button>
              <Button variant="outline" onClick={() => navigate('/calendar/templates')} className="gap-2">
                <LayoutTemplate className="h-4 w-4" />
                תבניות
              </Button>
            </div>

            <div className="flex justify-center xl:flex-1">
              <DateNavigator currentDate={currentDate} onDateChange={setCurrentDate} onNavigate={handleCalendarNavigate} viewMode={viewMode} />
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                variant={viewMode === 'day' ? 'default' : 'outline'}
                size="sm"
                onClick={handleSwitchToDay}
              >
                יום
              </Button>
              <Button
                variant={viewMode === 'week' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setViewMode('week')}
              >
                שבוע
              </Button>
              <Badge variant="outline" className="rounded-full border-slate-200 bg-slate-50 text-slate-700">
                דורש תשומת לב: {workspaceSummary.attentionCount}
              </Badge>
            </div>
          </div>
        </div>
      </div>

      {/* Error banner (rare) */}
      {(instructorsError || instancesError) ? (
        <div className="mx-4 mt-3 flex-shrink-0 rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">
          שגיאה בטעינת הנתונים: {instructorsError || instancesError}
        </div>
      ) : null}

      {savedGenerationReview?.issues?.length > 0 ? (
        <div className="mx-4 mt-3 flex-shrink-0">
          <Alert className="border-amber-300 bg-amber-50 text-amber-950">
            <AlertTitle className="flex items-center gap-2">
              קיימת רשימת טיפול ליצירה מתבניות
              <Badge variant="outline">{savedGenerationReview.issues.length} פריטים</Badge>
            </AlertTitle>
            <AlertDescription className="flex flex-wrap items-center gap-2">
              <span>
                הרשימה נשמרה כדי שתוכלו לצאת לתקן תלמידים או תבניות ולחזור בדיוק לאותה סקירה.
              </span>
              <Button size="sm" variant="outline" onClick={() => setShowGenerationDialog(true)}>
                פתח סקירה
              </Button>
              <Button size="sm" variant="ghost" onClick={handleDismissGenerationReview}>
                נקה רשימה
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      ) : null}

      {/* Calendar workspace — fills remaining viewport height */}
      {!instructorsError && !instancesError ? (
        <div className="min-h-0 flex-1 overflow-hidden px-4 pb-4 pt-3">
          <div className="mx-auto h-full" style={{ maxWidth: "min(1680px, calc(100vw - 1.5rem))" }}>
            <div className="grid h-full gap-4 xl:grid-cols-[22rem_minmax(0,1fr)]">
              {/* Dock — independently scrollable */}
              <div className="min-h-0 overflow-y-auto xl:pe-1">
                <CalendarWorkspaceDock
                  currentDate={currentDate}
                  viewMode={viewMode}
                  summary={workspaceSummary}
                  selectedInstance={selectedInstance}
                  selectedSlot={selectedSlotSummary}
                  onClearSelection={clearSelections}
                  onOpenCreateLesson={handleOpenCreateLesson}
                  onOpenSelectedLesson={handleOpenSelectedLesson}
                  onOpenInstructorWhatsApp={openInstructorWhatsApp}
                  onFixAvailabilityIssue={handleFixAvailabilityIssue}
                />
              </div>

              {/* Calendar card — fills remaining height */}
              <div className="flex min-h-0 flex-col rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                <ReinexFullCalendar
                  currentDate={currentDate}
                  viewMode={viewMode}
                  instances={instances}
                  instructors={instructors}
                  isLoading={isCalendarLoading}
                  calendarNavigationRef={calendarNavigationRef}
                  selectedSlot={pendingSlotSelection}
                  onDateChange={setCurrentDate}
                  onSlotSelect={handleSlotSelect}
                  onEventClick={handleInstanceClick}
                  onEventRescheduled={handleRescheduleSuccess}
                  onExternalServiceDrop={handleExternalServiceDrop}
                  onOpenInstructorWhatsApp={openInstructorWhatsApp}
                />
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <LessonInstanceDialog
        instance={selectedInstance}
        open={showInstanceDialog && !!selectedInstance}
        onClose={handleCloseDialog}
        onUpdate={handleUpdateSuccess}
      />

      <AddLessonDialog
        open={showAddDialog}
        onClose={() => {
          setShowAddDialog(false);
          setPendingServiceId('');
        }}
        onSuccess={handleAddSuccess}
        defaultDate={currentDate}
        defaultSelection={pendingSlotSelection}
        defaultServiceId={pendingServiceId}
      />

      <ManualGenerationDialog
        open={showGenerationDialog}
        onClose={() => setShowGenerationDialog(false)}
        defaultDate={currentDate}
        onApplied={handleGenerationApplied}
        onReviewStateChange={setSavedGenerationReview}
      />

      <InstructorWhatsAppDialog
        open={!!whatsAppCompose}
        onOpenChange={(open) => {
          if (!open) {
            setWhatsAppCompose(null);
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

      <EditServiceCapabilitiesDialog
        open={!!availabilityFixIssue && !!availabilityFixInstructor}
        onOpenChange={(open) => {
          if (!open) {
            setAvailabilityFixIssue(null);
          }
        }}
        instructor={availabilityFixInstructor}
        orgId={activeOrgId}
        session={session}
        onSaved={handleAvailabilityFixSaved}
        focusServiceId={availabilityFixIssue?.focusServiceId || ''}
        introMessage={availabilityFixIssue?.blocksVisibility
          ? 'למדריך/ה אין חלונות זמינות מוגדרים לשירות זה, ולכן הוא/היא לא מופיעים כרגע בלוח.'
          : 'לשירות זה חסרה זמינות מוגדרת. אפשר לעדכן כאן ולהמשיך לעבוד בלוח.'}
      />
    </div>
  );
}
