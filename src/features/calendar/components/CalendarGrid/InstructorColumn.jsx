import { generateTimeSlots } from '../../utils/timeGrid';
import { LessonInstanceCard } from './LessonInstanceCard';

/**
 * InstructorColumn component - displays one instructor's schedule
 */
export function InstructorColumn({ instructor, instances, onInstanceClick }) {
  const timeSlots = generateTimeSlots(6, 22);
  
  // Filter instances for this instructor
  const instructorInstances = instances.filter(
    i => i.instructor_employee_id === instructor.id
  );

  return (
    <div className="flex-1 min-w-[200px] border-l border-gray-300">
      {/* Instructor header */}
      <div className="h-12 border-b border-gray-300 flex items-center justify-center px-2 bg-gray-50">
        <div className="text-center">
          <div className="text-sm font-medium truncate">
            {instructor.full_name}
          </div>
          {instructor.metadata?.color && (
            <div 
              className="w-3 h-3 rounded-full mx-auto mt-1"
              style={{ backgroundColor: instructor.metadata.color }}
              title="צבע מדריך"
            />
          )}
        </div>
      </div>
      
      {/* Time grid with instances */}
      <div className="relative bg-white" style={{ height: `${timeSlots.length * 24}px` }}>
        {/* Grid lines (every 15 minutes) */}
        {timeSlots.map((slot, index) => (
          <div
            key={slot.timeString}
            className={`absolute w-full ${index % 4 === 0 ? 'border-t border-gray-300' : 'border-t border-gray-200'}`}
            style={{ top: `${index * 24}px` }}
          />
        ))}
        
        {/* Lesson instance cards */}
        {instructorInstances.map(instance => (
          <LessonInstanceCard
            key={instance.id}
            instance={instance}
            onClick={onInstanceClick}
          />
        ))}
      </div>
    </div>
  );
}
