import { TimeColumn } from './TimeColumn';
import { InstructorColumn } from './InstructorColumn';

/**
 * CalendarGrid component - main grid layout with time column and instructor columns
 */
export function CalendarGrid({ instructors, instances, onInstanceClick, onRescheduleSuccess }) {
  if (!instructors || instructors.length === 0) {
    return (
      <div className="flex items-center justify-center h-96 text-gray-500">
        אין מדריכים להצגה
      </div>
    );
  }

  return (
    <div className="border border-gray-300 rounded-lg overflow-hidden bg-white">
      <div className="flex flex-row-reverse overflow-x-auto w-full">
        {/* Time column (sticky on right for RTL) */}
        <TimeColumn />

        {/* Instructor columns (scrollable) */}
        <div className="flex flex-1 min-w-0">
          {instructors.map((instructor) => (
            <InstructorColumn
              key={instructor.id}
              instructor={instructor}
              instances={instances}
              onInstanceClick={onInstanceClick}
              instructors={instructors}
              onRescheduleSuccess={onRescheduleSuccess}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
