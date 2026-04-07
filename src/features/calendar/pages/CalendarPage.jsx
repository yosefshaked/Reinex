import { useState, useEffect, useRef, useCallback } from 'react';
import PageLayout from '@/components/ui/PageLayout';
import { Button } from '@/components/ui/button';
import { Plus, LayoutTemplate, Wand2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { CalendarHeader } from '../components/CalendarHeader/CalendarHeader';
import { LessonInstanceDialog } from '../components/LessonInstanceDialog';
import { AddLessonDialog } from '../components/AddLessonDialog';
import { ManualGenerationDialog } from '../components/ManualGenerationDialog';
import { useCalendarInstances, useCalendarInstructors } from '../hooks/useCalendar';
import ReinexFullCalendar from '../components/ReinexFullCalendar';
import { addLocalDays, getTodayLocalDateString, getWeekStartDate, parseLocalDateString, toLocalDateString } from '../utils/localDate.js';

const CALENDAR_DATE_KEY = 'reinex_calendar_date';
const CALENDAR_VIEW_KEY = 'reinex_calendar_view'; // 'day' or 'week'

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
    // Get saved view mode or default to 'day'
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem(CALENDAR_VIEW_KEY) || 'day';
    }
    return 'day';
  });

  const navigate = useNavigate();
  const [selectedInstance, setSelectedInstance] = useState(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showGenerationDialog, setShowGenerationDialog] = useState(false);
  const [pendingSlotSelection, setPendingSlotSelection] = useState(null);

  // Save date to sessionStorage whenever it changes
  useEffect(() => {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem(CALENDAR_DATE_KEY, currentDate);
    }
  }, [currentDate]);

  // Save view mode to sessionStorage whenever it changes
  useEffect(() => {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem(CALENDAR_VIEW_KEY, viewMode);
    }
  }, [viewMode]);

  const setCurrentDate = (newDate) => {
    const normalizedDate = typeof newDate === 'string'
      ? newDate
      : toLocalDateString(newDate);
    if (parseLocalDateString(normalizedDate || '')) {
      setCurrentDateState(normalizedDate);
    }
  };

  const setViewMode = (mode) => {
    setViewModeState(mode);
  };

  const handleCalendarNavigate = useCallback((action) => {
    const calendarNavigation = calendarNavigationRef.current;
    if (calendarNavigation && typeof calendarNavigation[action] === 'function') {
      calendarNavigation[action]();
      return;
    }

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
  }, [currentDate, viewMode]);

  const dateForQuery = viewMode === 'week'
    ? toLocalDateString(getWeekStartDate(currentDate))
    : currentDate;

  const { instructors, isLoading: instructorsLoading, error: instructorsError } = useCalendarInstructors();
  const { instances, isLoading: instancesLoading, error: instancesError, refetch: refetchInstances } = useCalendarInstances(dateForQuery, viewMode);
  const isCalendarLoading = instructorsLoading || instancesLoading;

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
  }, [instances, instancesLoading, selectedInstance?.id]);

  const handleInstanceClick = (instance) => {
    setSelectedInstance(instance);
  };

  const handleCloseDialog = () => {
    setSelectedInstance(null);
  };

  const handleAddSuccess = () => {
    refetchInstances();
    setPendingSlotSelection(null);
  };

  const handleUpdateSuccess = () => {
    refetchInstances();
  };

  const handleRescheduleSuccess = () => {
    // Refresh instances after successful reschedule
    refetchInstances();
    // Close any open detail dialog
    setSelectedInstance(null);
  };

  const handleGenerationApplied = () => {
    refetchInstances();
  };

  const handleSlotSelect = (selection) => {
    setPendingSlotSelection(selection);
    setShowAddDialog(true);
  };

  return (
    <PageLayout title="לוח זמנים">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CalendarHeader currentDate={currentDate} onDateChange={setCurrentDate} onNavigate={handleCalendarNavigate} viewMode={viewMode} />
            <div className="flex items-center gap-1 border-s border-gray-300 ps-4">
              <Button 
                variant={viewMode === 'day' ? 'default' : 'outline'} 
                size="sm"
                onClick={() => setViewMode('day')}
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
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setShowGenerationDialog(true)} className="gap-2">
              <Wand2 className="h-4 w-4" />
              יצירה מתבניות
            </Button>
            <Button variant="outline" onClick={() => navigate('/calendar/templates')} className="gap-2">
              <LayoutTemplate className="h-4 w-4" />
              תבניות
            </Button>
            <Button onClick={() => setShowAddDialog(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              שיעור חדש
            </Button>
          </div>
        </div>

        {/* Error State */}
        {(instructorsError || instancesError) && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-800">
            שגיאה בטעינת הנתונים: {instructorsError || instancesError}
          </div>
        )}

        {!instructorsError && !instancesError && (
          <ReinexFullCalendar
            currentDate={currentDate}
            viewMode={viewMode}
            instances={instances}
            instructors={instructors}
            isLoading={isCalendarLoading}
            calendarNavigationRef={calendarNavigationRef}
            onDateChange={setCurrentDate}
            onViewModeChange={setViewMode}
            onSlotSelect={handleSlotSelect}
            onEventClick={handleInstanceClick}
            onEventRescheduled={handleRescheduleSuccess}
          />
        )}
      </div>

      {/* Instance Details Dialog */}
      <LessonInstanceDialog
        instance={selectedInstance}
        open={!!selectedInstance}
        onClose={handleCloseDialog}
        onUpdate={handleUpdateSuccess}
      />

      {/* Add Lesson Dialog */}
      <AddLessonDialog
        open={showAddDialog}
        onClose={() => {
          setShowAddDialog(false);
          setPendingSlotSelection(null);
        }}
        onSuccess={handleAddSuccess}
        defaultDate={currentDate}
        defaultSelection={pendingSlotSelection}
      />

      <ManualGenerationDialog
        open={showGenerationDialog}
        onClose={() => setShowGenerationDialog(false)}
        defaultDate={currentDate}
        onApplied={handleGenerationApplied}
      />
    </PageLayout>
  );
}
