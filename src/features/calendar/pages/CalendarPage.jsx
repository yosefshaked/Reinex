import { useState, useEffect } from 'react';
import PageLayout from '@/components/ui/PageLayout';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { CalendarHeader } from '../components/CalendarHeader/CalendarHeader';
import { CalendarGrid } from '../components/CalendarGrid/CalendarGrid';
import { LessonInstanceDialog } from '../components/LessonInstanceDialog';
import { AddLessonDialog } from '../components/AddLessonDialog';
import { useCalendarInstances, useCalendarInstructors } from '../hooks/useCalendar';
import { Loader2 } from 'lucide-react';

const CALENDAR_DATE_KEY = 'reinex_calendar_date';

/**
 * CalendarPage - main calendar view showing daily schedule
 */
export default function CalendarPage() {
  const [currentDate, setCurrentDateState] = useState(() => {
    // Try to get saved date from sessionStorage, fall back to today
    if (typeof window !== 'undefined') {
      const saved = sessionStorage.getItem(CALENDAR_DATE_KEY);
      return saved || new Date().toISOString().split('T')[0];
    }
    return new Date().toISOString().split('T')[0];
  });

  const [selectedInstance, setSelectedInstance] = useState(null);
  const [showAddDialog, setShowAddDialog] = useState(false);

  // Save date to sessionStorage whenever it changes
  useEffect(() => {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem(CALENDAR_DATE_KEY, currentDate);
    }
  }, [currentDate]);

  const setCurrentDate = (newDate) => {
    setCurrentDateState(newDate);
  };

  const { instructors, isLoading: instructorsLoading, error: instructorsError } = useCalendarInstructors();
  const { instances, isLoading: instancesLoading, error: instancesError, refetch: refetchInstances } = useCalendarInstances(currentDate);

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

  return (
    <PageLayout title="לוח זמנים">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <CalendarHeader currentDate={currentDate} onDateChange={setCurrentDate} />
          <Button onClick={() => setShowAddDialog(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            שיעור חדש
          </Button>
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
          <CalendarGrid
            instructors={instructors}
            instances={instances}
            onInstanceClick={handleInstanceClick}
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
        onClose={() => setShowAddDialog(false)}
        onSuccess={handleAddSuccess}
        defaultDate={currentDate}
      />
    </PageLayout>
  );
}
