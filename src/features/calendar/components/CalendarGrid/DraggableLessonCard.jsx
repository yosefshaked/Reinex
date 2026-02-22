import { useState, useRef, useEffect } from 'react';
import { GripVertical } from 'lucide-react';
import { calculateCardPosition, formatTimeDisplay, getInstanceStatusIcon, getTimeSlotAtPixel } from '../../utils/timeGrid';
import { ResizeConfirmationDialog } from '../ResizeConfirmationDialog';
import { authenticatedFetch } from '@/lib/api-client';
import { useOrg } from '@/org/OrgContext';

/**
 * DraggableLessonCard - lesson card with drag-to-reschedule functionality
 * Supports vertical dragging (time) and horizontal dragging (instructor)
 */
export function DraggableLessonCard({ 
  instance, 
  onClick, 
  instructors = [],
  onRescheduleSuccess 
}) {
  const { activeOrgId } = useOrg();
  const [isDragging, setIsDragging] = useState(false);
  const [previewPosition, setPreviewPosition] = useState(null);
  const [targetTimeSlot, setTargetTimeSlot] = useState(null);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [pendingReschedule, setPendingReschedule] = useState(null);
  const [isRescheduleLoading, setIsRescheduleLoading] = useState(false);
  const [conflictWarnings, setConflictWarnings] = useState([]);
  const cardRef = useRef(null);
  const dragRef = useRef(null);

  const { top, height } = calculateCardPosition(instance.datetime_start, instance.duration_minutes);
  const statusInfo = getInstanceStatusIcon(instance.status, instance.documentation_status);
  const bgColor = instance.service?.color || '#6B7280';

  const firstStudentName = instance.participants?.[0]?.student?.full_name || 'לא ידוע';
  const additionalCount = (instance.participants?.length || 1) - 1;

  const startTime = formatTimeDisplay(instance.datetime_start);
  const endDate = new Date(new Date(instance.datetime_start).getTime() + instance.duration_minutes * 60000);
  const endTime = formatTimeDisplay(endDate.toISOString());

  const handleDragStart = (e) => {
    // Only start drag from the handle
    if (!dragRef.current?.contains(e.target)) return;
    
    e.preventDefault();
    setIsDragging(true);
  };

  // Helper: Check if position/instructor actually changed
  const hasPositionChanged = (newDateTime, newInstructor) => {
    const originalTime = new Date(instance.datetime_start);
    const timeChanged = newDateTime.getTime() !== originalTime.getTime();
    const instructorChanged = newInstructor?.id !== instance.instructor_employee_id;
    return timeChanged || instructorChanged;
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e) => {
      const cardRect = cardRef.current?.parentElement?.getBoundingClientRect();
      if (!cardRect) return;

      const newOffsetX = e.clientX - cardRect.left;
      const newOffsetY = e.clientY - cardRect.top;

      // Find the target time slot at this Y position
      const slot = getTimeSlotAtPixel(newOffsetY);
      setTargetTimeSlot(slot);

      setPreviewPosition({
        y: slot.pixelTop,
        x: newOffsetX,
      });
    };

    const handleMouseUp = async () => {
      setIsDragging(false);
      setTargetTimeSlot(null);
      setPreviewPosition(null);

      if (!targetTimeSlot || !previewPosition) {
        return;
      }

      // Use the target time slot to create the new datetime
      const newHour = Math.floor(targetTimeSlot.totalMinutes / 60);
      const newMinute = targetTimeSlot.totalMinutes % 60;
      
      const newDateTime = new Date(instance.datetime_start);
      newDateTime.setHours(newHour);
      newDateTime.setMinutes(newMinute);
      newDateTime.setSeconds(0);

      // Calculate new instructor from X position (simplified - assumes uniform column widths)
      const parentWidth = cardRef.current?.parentElement?.parentElement?.clientWidth || 0;
      const columnWidth = parentWidth / (instructors.length + 1); // +1 for time column
      const columnIndex = Math.round(previewPosition.x / columnWidth) - 1;
      const newInstructor = instructors[Math.max(0, Math.min(columnIndex, instructors.length - 1))];

      // Cancel if dragged back to original position
      if (!hasPositionChanged(newDateTime, newInstructor)) {
        return;
      }

      // Check for conflicts
      try {
        const response = await authenticatedFetch('calendar/conflicts/check', {
          method: 'POST',
          body: {
            org_id: activeOrgId,
            datetime_start: newDateTime.toISOString(),
            duration_minutes: instance.duration_minutes,
            instructor_employee_id: newInstructor?.id || instance.instructor_employee_id,
            student_ids: instance.participants?.map(p => p.student_id) || [],
            service_id: instance.service_id,
            exclude_instance_id: instance.id,
          },
        });

        setConflictWarnings(response.conflicts || []);
      } catch (err) {
        console.error('Error checking conflicts:', err);
      }

      setPendingReschedule({
        newDateTime,
        newInstructor: newInstructor || instance.instructor,
      });
      setShowConfirmDialog(true);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDragging, targetTimeSlot, top, height, instance, instructors, activeOrgId]);

  const handleConfirmReschedule = async () => {
    if (!pendingReschedule || !activeOrgId) return;

    setIsRescheduleLoading(true);
    try {
      await authenticatedFetch('calendar/instances', {
        method: 'PUT',
        body: {
          org_id: activeOrgId,
          id: instance.id,
          datetime_start: pendingReschedule.newDateTime.toISOString(),
          instructor_employee_id: pendingReschedule.newInstructor.id,
          duration_minutes: instance.duration_minutes,
          status: instance.status,
        },
      });

      onRescheduleSuccess?.();
      setShowConfirmDialog(false);
      setPendingReschedule(null);
    } catch (err) {
      console.error('Error rescheduling:', err);
      alert(`שגיאה בהעברת השיעור: ${err.message}`);
    } finally {
      setIsRescheduleLoading(false);
    }
  };

  return (
    <>
      {/* Visual time slot indicator during drag */}
      {isDragging && targetTimeSlot && (
        <div
          className="absolute w-full border-2 border-gray-900 bg-gray-900/5 pointer-events-none z-40"
          style={{
            top: `${targetTimeSlot.pixelTop}px`,
            height: '24px',
          }}
          title={`Będzie przydzielone na ${targetTimeSlot.timeString}`}
        />
      )}

      <div
        ref={cardRef}
        className="absolute w-full px-1 transition-transform hover:z-50"
        style={{ 
          top: `${top}px`,
          height: `${height}px`,
          opacity: isDragging ? 0.7 : 1,
          cursor: isDragging ? 'grabbing' : 'pointer',
        }}
        onClick={() => !isDragging && onClick?.(instance)}
      >
        <div
          className="h-full rounded-lg shadow-md border border-white/20 overflow-visible flex hover:shadow-2xl hover:border-white/50 transition-shadow"
          style={{ backgroundColor: bgColor }}
        >
          {/* Two-column layout: Grip handle (right in RTL) | Info area (left in RTL) */}
          
          {/* Grip Handle Column - spans full height, vertically centered */}
          <div
            ref={dragRef}
            className="flex items-center justify-center border-l border-white/20 px-1 flex-shrink-0 cursor-grab active:cursor-grabbing"
            onMouseDown={handleDragStart}
            title="גרור כדי להעביר שיעור"
          >
            <GripVertical className="h-4 w-4 text-white/60 hover:text-white" />
          </div>

          {/* Info Column - rows of information */}
          <div className="flex-1 flex flex-col p-1.5 min-w-0">
            {/* Row 1: Service name + status icon (status stays on physical left) */}
            <div className="flex items-center gap-1">
              <span className="text-white font-medium text-sm truncate flex-1">
                {instance.service?.service_name || 'שירות'}
              </span>
              <span className={`text-lg flex-shrink-0 ${statusInfo.color}`} title={statusInfo.label}>
                {statusInfo.icon}
              </span>
            </div>
            
            {/* Row 2: Student names */}
            <div className="text-white text-sm truncate">
              {firstStudentName}
              {additionalCount > 0 && <span className="font-bold"> +{additionalCount}</span>}
            </div>
            
            {/* Row 3: Time range */}
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
      </div>

      {/* Preview ghost card while dragging */}
      {isDragging && previewPosition && (
        <div
          className="absolute w-full px-1 pointer-events-none"
          style={{ 
            top: `${previewPosition.y}px`,
            height: `${height}px`,
            opacity: 0.4,
          }}
        >
          <div
            className="h-full rounded-lg shadow-md border-2 border-white/40"
            style={{ backgroundColor: bgColor }}
          />
        </div>
      )}

      {/* Confirmation Dialog */}
      <ResizeConfirmationDialog
        open={showConfirmDialog}
        instance={instance}
        pendingReschedule={pendingReschedule}
        conflictWarnings={conflictWarnings}
        isLoading={isRescheduleLoading}
        onConfirm={handleConfirmReschedule}
        onCancel={() => {
          setShowConfirmDialog(false);
          setPendingReschedule(null);
          setConflictWarnings([]);
        }}
      />
    </>
  );
}
