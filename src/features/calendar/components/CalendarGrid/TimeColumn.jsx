import { generateTimeSlots } from '../../utils/timeGrid';

/**
 * TimeColumn component - displays time labels on the right side (RTL)
 */
export function TimeColumn() {
  const timeSlots = generateTimeSlots(6, 22);
  
  // Show only hour labels (skip 15, 30, 45 minute marks for cleaner look)
  const hourSlots = timeSlots.filter((_, index) => index % 4 === 0);

  return (
    <div className="sticky right-0 bg-white border-l border-gray-300 z-20" style={{ width: '80px' }}>
      {/* Header spacer */}
      <div className="h-12 border-b border-gray-300 flex items-center justify-center text-sm font-medium">
        שעה
      </div>
      
      {/* Time labels */}
      <div className="relative" style={{ height: `${timeSlots.length * 24}px` }}>
        {hourSlots.map((slot) => (
          <div
            key={slot.timeString}
            className="absolute w-full text-center text-sm text-gray-600 pr-2"
            style={{ 
              top: `${(slot.totalMinutes - 360) / 15 * 24}px`,
              transform: 'translateY(-50%)',
            }}
          >
            {slot.timeString}
          </div>
        ))}
      </div>
    </div>
  );
}
