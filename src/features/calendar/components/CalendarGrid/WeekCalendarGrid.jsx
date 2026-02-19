import { TimeColumn } from './TimeColumn';
import { WeekInstructorColumn } from './WeekInstructorColumn';
import { generateTimeSlots } from '../../utils/timeGrid';

/**
 * WeekCalendarGrid component - displays week view with 7 columns (one per day)
 */
export function WeekCalendarGrid({ 
  instructors, 
  instances, 
  onInstanceClick, 
  onRescheduleSuccess,
  weekStartDate 
}) {
  if (!instructors || instructors.length === 0) {
    return (
      <div className="flex items-center justify-center h-96 text-gray-500">
        אין מדריכים להצגה
      </div>
    );
  }

  const timeSlots = generateTimeSlots(6, 22);

  // Generate 7 days starting from weekStartDate
  const daysOfWeek = [];
  const startDate = new Date(weekStartDate);
  for (let i = 0; i < 7; i++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + i);
    daysOfWeek.push(date.toISOString().split('T')[0]);
  }

  const formatDayHeader = (dateString) => {
    const date = new Date(dateString);
    const dayName = date.toLocaleDateString('he-IL', { weekday: 'short' });
    const dayNum = date.getDate();
    return `${dayName}\n${dayNum}`;
  };

  return (
    <div className="border border-gray-300 rounded-lg bg-white">
      <div className="flex flex-row-reverse overflow-x-auto w-full">
        {/* Time column (sticky on right for RTL) */}
        <TimeColumn />

        {/* Week columns (one per day) */}
        <div className="flex flex-1 min-w-0">
          {daysOfWeek.map((dateString) => (
            <div key={dateString} className="flex-1 min-w-[120px] border-l border-gray-300 overflow-visible">
              {/* Day header */}
              <div className="h-12 border-b border-gray-300 flex items-center justify-center px-2 bg-gray-50 text-xs font-semibold text-center whitespace-pre-line">
                {formatDayHeader(dateString)}
              </div>

              {/* Time grid for this day */}
              <div className="relative bg-white overflow-visible px-2 pb-8 pt-2" style={{ height: `${timeSlots.length * 24}px` }}>
                {/* Grid lines */}
                {timeSlots.map((slot, index) => (
                  <div
                    key={slot.timeString}
                    className={`absolute w-full ${index % 4 === 0 ? 'border-t border-gray-300' : 'border-t border-gray-200'}`}
                    style={{ top: `${index * 24}px` }}
                  />
                ))}

                {/* Lesson cards for all instructors on this day */}
                {instructors.map((instructor) => {
                  const instructorDayInstances = instances.filter(
                    i => i.instructor_employee_id === instructor.id && 
                         i.datetime_start?.split('T')[0] === dateString
                  );

                  return (
                    <div key={`${dateString}-${instructor.id}`} className="absolute inset-0">
                      {instructorDayInstances.map((instance) => (
                        <WeekInstructorColumn
                          key={instance.id}
                          instance={instance}
                          onClick={() => onInstanceClick(instance)}
                          instructors={instructors}
                          onRescheduleSuccess={onRescheduleSuccess}
                          dateString={dateString}
                          instructor={instructor}
                        />
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
