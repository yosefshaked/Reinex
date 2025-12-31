import React, { useMemo } from 'react';
import { cn } from '@/lib/utils';

/**
 * Generate time slots for the calendar (15-minute intervals)
 */
function generateTimeSlots(startHour = 8, endHour = 20) {
  const slots = [];
  for (let hour = startHour; hour <= endHour; hour++) {
    for (let minute = 0; minute < 60; minute += 15) {
      const timeString = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
      slots.push({ hour, minute, timeString });
    }
  }
  return slots;
}

/**
 * Calculate the vertical position and height of a lesson block
 */
function calculateLessonPosition(datetimeStart, durationMinutes, startHour = 8) {
  const lessonDate = new Date(datetimeStart);
  const lessonHour = lessonDate.getHours();
  const lessonMinute = lessonDate.getMinutes();
  
  // Calculate minutes from start of calendar
  const minutesFromStart = (lessonHour - startHour) * 60 + lessonMinute;
  
  // Each hour is 60px, so each minute is 1px
  const PIXELS_PER_MINUTE = 1;
  const top = minutesFromStart * PIXELS_PER_MINUTE;
  const height = durationMinutes * PIXELS_PER_MINUTE;
  
  return { top, height };
}

/**
 * Daily Calendar Component
 * Renders a day view with instructors as columns and lessons as positioned blocks
 */
export default function DailyCalendar({ instructors = [], lessons = [], currentDate }) {
  const timeSlots = useMemo(() => generateTimeSlots(8, 20), []);
  
  // Group lessons by instructor
  const lessonsByInstructor = useMemo(() => {
    const grouped = {};
    instructors.forEach(instructor => {
      grouped[instructor.id] = [];
    });
    
    lessons.forEach(lesson => {
      const instructorId = lesson.instructor_employee_id;
      if (grouped[instructorId]) {
        grouped[instructorId].push(lesson);
      }
    });
    
    return grouped;
  }, [instructors, lessons]);

  if (instructors.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-neutral-500">
        אין מדריכים להצגה
      </div>
    );
  }

  const HOUR_HEIGHT = 60; // pixels per hour
  const SLOT_HEIGHT = 15; // pixels per 15-minute slot

  return (
    <div className="flex flex-col h-full overflow-hidden" dir="rtl">
      {/* Header with instructor names */}
      <div className="flex border-b border-border bg-surface sticky top-0 z-10">
        {/* Time column header */}
        <div className="w-20 flex-shrink-0 border-l border-border p-2 text-sm font-medium text-neutral-700">
          שעה
        </div>
        
        {/* Instructor columns */}
        {instructors.map(instructor => (
          <div
            key={instructor.id}
            className="flex-1 min-w-[120px] border-l border-border p-2 text-center text-sm font-medium text-neutral-700"
          >
            {instructor.full_name || instructor.name || `${instructor.first_name || ''} ${instructor.last_name || ''}`.trim() || instructor.email || instructor.id}
          </div>
        ))}
      </div>

      {/* Calendar grid with scrollable content */}
      <div className="flex-1 overflow-auto">
        <div className="flex relative">
          {/* Time column */}
          <div className="w-20 flex-shrink-0 border-l border-border">
            {timeSlots.map((slot, index) => (
              <div
                key={index}
                className={cn(
                  "border-b border-border px-2 py-1 text-xs text-neutral-600",
                  slot.minute === 0 ? "font-medium" : "text-neutral-400"
                )}
                style={{ height: `${SLOT_HEIGHT}px` }}
              >
                {slot.minute === 0 ? slot.timeString : ''}
              </div>
            ))}
          </div>

          {/* Instructor columns with lessons */}
          {instructors.map(instructor => (
            <div
              key={instructor.id}
              className="flex-1 min-w-[120px] border-l border-border relative"
            >
              {/* Time slot grid lines */}
              {timeSlots.map((slot, index) => (
                <div
                  key={index}
                  className="border-b border-border"
                  style={{ height: `${SLOT_HEIGHT}px` }}
                />
              ))}

              {/* Lessons positioned absolutely */}
              {lessonsByInstructor[instructor.id]?.map((lesson) => {
                const { top, height } = calculateLessonPosition(
                  lesson.datetime_start,
                  lesson.duration_minutes,
                  8
                );

                // Get first participant's student name (if any)
                const firstParticipant = lesson.lesson_participants?.[0];
                const displayText = firstParticipant
                  ? `תלמיד ${firstParticipant.student_id.substring(0, 8)}`
                  : 'שיעור';

                return (
                  <div
                    key={lesson.id}
                    className="absolute left-1 right-1 bg-blue-100 border border-blue-300 rounded px-2 py-1 text-xs overflow-hidden cursor-pointer hover:bg-blue-200 transition-colors"
                    style={{
                      top: `${top}px`,
                      height: `${height}px`,
                    }}
                    title={`${displayText} - ${lesson.status}`}
                  >
                    <div className="font-medium text-blue-900">
                      {displayText}
                    </div>
                    <div className="text-blue-700 text-[10px]">
                      {lesson.duration_minutes} דק'
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
