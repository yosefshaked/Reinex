import { DraggableLessonCard } from './DraggableLessonCard';
import { calculateCardPosition } from '../../utils/timeGrid';

/**
 * WeekInstructorColumn - renders a single lesson card in week view
 * Positions multiple lessons from different instructors on the same day column
 */
export function WeekInstructorColumn({
  instance,
  onClick,
  instructors = [],
  onRescheduleSuccess,
  instructor,
}) {
  const { top, height } = calculateCardPosition(instance.datetime_start, instance.duration_minutes);

  // Calculate instructor offset for horizontal positioning (multiple instructors on same day)
  const instructorIndex = instructors.findIndex(i => i.id === instructor.id);
  const instructorCount = instructors.length;
  const columnWidth = (100 / instructorCount);
  const leftOffset = instructorIndex * columnWidth;

  return (
    <div
      style={{
        position: 'absolute',
        top: `${top}px`,
        height: `${height}px`,
        left: `${leftOffset}%`,
        width: `${columnWidth}%`,
        paddingRight: '2px',
      }}
    >
      <DraggableLessonCard
        instance={instance}
        onClick={onClick}
        instructors={instructors}
        onRescheduleSuccess={onRescheduleSuccess}
        isWeekView
      />
    </div>
  );
}
