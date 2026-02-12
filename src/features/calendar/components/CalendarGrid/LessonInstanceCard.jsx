import { calculateCardPosition, formatTimeDisplay, getInstanceStatusIcon } from '../../utils/timeGrid';

/**
 * LessonInstanceCard component - displays a single lesson instance in the calendar
 */
export function LessonInstanceCard({ instance, onClick }) {
  const { top, height } = calculateCardPosition(instance.datetime_start, instance.duration_minutes);
  const statusInfo = getInstanceStatusIcon(instance.status, instance.documentation_status);
  
  // Get service color or default
  const bgColor = instance.service?.color || '#6B7280'; // gray-500 default
  
  // Get student names
  const studentNames = (instance.participants || [])
    .map(p => p.student?.first_name || 'לא ידוע')
    .join(', ');
  
  const firstStudentName = instance.participants?.[0]?.student?.first_name || 'לא ידוע';
  const additionalCount = (instance.participants?.length || 1) - 1;
  
  // Format time range
  const startTime = formatTimeDisplay(instance.datetime_start);
  const endDate = new Date(new Date(instance.datetime_start).getTime() + instance.duration_minutes * 60000);
  const endTime = formatTimeDisplay(endDate.toISOString());

  return (
    <div
      className="absolute w-full px-1 cursor-pointer transition-transform hover:scale-105 hover:z-30"
      style={{ 
        top: `${top}px`,
        height: `${height}px`,
      }}
      onClick={() => onClick?.(instance)}
    >
      <div
        className="h-full rounded-lg shadow-md border border-white/20 p-2 overflow-hidden flex flex-col"
        style={{ backgroundColor: bgColor }}
      >
        {/* Status Icon */}
        <div className="flex items-start justify-between mb-1">
          <span className="text-white font-medium text-sm truncate">
            {instance.service?.service_name || 'שירות'}
          </span>
          <span className={`text-lg ${statusInfo.color}`} title={statusInfo.label}>
            {statusInfo.icon}
          </span>
        </div>
        
        {/* Student names */}
        <div className="text-white text-sm truncate">
          {firstStudentName}
          {additionalCount > 0 && <span className="font-bold"> +{additionalCount}</span>}
        </div>
        
        {/* Time range */}
        <div className="text-white/90 text-xs mt-auto">
          {startTime} - {endTime}
        </div>
        
        {/* Documentation status badge */}
        {instance.documentation_status === 'undocumented' && instance.status === 'completed' && (
          <div className="mt-1">
            <span className="inline-block bg-amber-500 text-white text-xs px-1.5 py-0.5 rounded">
              לא תועד
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
