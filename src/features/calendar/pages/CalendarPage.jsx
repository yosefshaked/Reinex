import { useState } from 'react';
import PageLayout from '@/components/ui/PageLayout';
import { CalendarHeader } from '../components/CalendarHeader/CalendarHeader';
import { CalendarGrid } from '../components/CalendarGrid/CalendarGrid';
import { LessonInstanceDialog } from '../components/LessonInstanceDialog';
import { useCalendarInstances, useCalendarInstructors } from '../hooks/useCalendar';
import { Loader2 } from 'lucide-react';

/**
 * CalendarPage - main calendar view showing daily schedule
 */
export default function CalendarPage() {
  const [currentDate, setCurrentDate] = useState(new Date().toISOString().split('T')[0]);
  const [selectedInstance, setSelectedInstance] = useState(null);

  const { instructors, isLoading: instructorsLoading, error: instructorsError } = useCalendarInstructors();
  const { instances, isLoading: instancesLoading, error: instancesError } = useCalendarInstances(currentDate);

  const handleInstanceClick = (instance) => {
    setSelectedInstance(instance);
  };

  const handleCloseDialog = () => {
    setSelectedInstance(null);
  };

  return (
    <PageLayout title="לוח זמנים">
      <div className="space-y-4">
        <CalendarHeader currentDate={currentDate} onDateChange={setCurrentDate} />

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
      />
    </PageLayout>
  );
}
