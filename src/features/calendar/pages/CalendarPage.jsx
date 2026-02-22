import { useState, useEffect } from 'react';
import PageLayout from '@/components/ui/PageLayout';
import { Button } from '@/components/ui/button';
import { Plus, LayoutTemplate, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { CalendarHeader } from '../components/CalendarHeader/CalendarHeader';
import { CalendarGrid } from '../components/CalendarGrid/CalendarGrid';
import { WeekCalendarGrid } from '../components/CalendarGrid/WeekCalendarGrid';
import { LessonInstanceDialog } from '../components/LessonInstanceDialog';
import { AddLessonDialog } from '../components/AddLessonDialog';
import { useCalendarInstances, useCalendarInstructors } from '../hooks/useCalendar';

const CALENDAR_DATE_KEY = 'reinex_calendar_date';
const CALENDAR_VIEW_KEY = 'reinex_calendar_view'; // 'day' or 'week'

export default function CalendarPage() {
  const [currentDate, setCurrentDateState] = useState(() => {
    // Try to get saved date from sessionStorage, fall back to today
    if (typeof window !== 'undefined') {
      const saved = sessionStorage.getItem(CALENDAR_DATE_KEY);
      return saved || new Date().toISOString().split('T')[0];
    }
    return new Date().toISOString().split('T')[0];
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
    setCurrentDateState(newDate);
  };

  const setViewMode = (mode) => {
    setViewModeState(mode);
  };

  // For week view, get date range
  const getWeekStartDate = (dateString) => {
    const date = new Date(dateString);
    const day = date.getDay();
    // Sunday is 0, we want Monday as start (day 1)
    const diff = date.getDate() - day + (day === 0 ? -6 : 1);
    const weekStart = new Date(date.setDate(diff));
    return weekStart.toISOString().split('T')[0];
  };

  const dateForQuery = viewMode === 'week' ? getWeekStartDate(currentDate) : currentDate;

  const { instructors, isLoading: instructorsLoading, error: instructorsError } = useCalendarInstructors();
  const { instances, isLoading: instancesLoading, error: instancesError, refetch: refetchInstances } = useCalendarInstances(dateForQuery, viewMode);

  const handleInstanceClick = (instance) => {
    setSelectedInstance(instance);
  };

  const handleCloseDialog = () => {
    setSelectedInstance(null);
  };

  const handleAddSuccess = () => {
    refetchInstances();
  };

  const handleUpdateSuccess = () => {
    refetchInstances();
    setSelectedInstance(null);
  };

  const handleRescheduleSuccess = () => {
    // Refresh instances after successful reschedule
    refetchInstances();
    // Close any open detail dialog
    setSelectedInstance(null);
  };

  return (
    <PageLayout title="לוח זמנים">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CalendarHeader currentDate={currentDate} onDateChange={setCurrentDate} viewMode={viewMode} />
            <div className="flex items-center gap-1 border-l border-gray-300 pl-4">
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

        {/* Loading State */}
        {(instructorsLoading || instancesLoading) && (
          <div className="flex items-center justify-center h-96">
            <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
          </div>
        )}

        {/* Error State */}
        {(instructorsError || instancesError) && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-800">
            שגיאה בטעינת הנתונים: {instructorsError || instancesError}
          </div>
        )}

        {/* Calendar Grid */}
        {!instructorsLoading && !instancesLoading && !instructorsError && !instancesError && (
          viewMode === 'week' ? (
            <WeekCalendarGrid
              instructors={instructors}
              instances={instances}
              onInstanceClick={handleInstanceClick}
              onRescheduleSuccess={handleRescheduleSuccess}
              weekStartDate={dateForQuery}
            />
          ) : (
            <CalendarGrid
              instructors={instructors}
              instances={instances}
              onInstanceClick={handleInstanceClick}
              onRescheduleSuccess={handleRescheduleSuccess}
            />
          )
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
        onClose={() => setShowAddDialog(false)}
        onSuccess={handleAddSuccess}
        defaultDate={currentDate}
      />
    </PageLayout>
  );
}
