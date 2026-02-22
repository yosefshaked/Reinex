import { generateTimeSlots } from '../../utils/timeGrid';

/**
 * TimeColumn component - displays time labels on the right side (RTL)
 */
export function TimeColumn() {
  const timeSlots = generateTimeSlots(6, 22);
  
  // Show only hour labels (skip 15, 30, 45 minute marks for cleaner look)
  const hourSlots = timeSlots.filter((_, index) => index % 4 === 0);

  return (
    <div className="sticky right-0 bg-white border-l border-gray-300 z-20 flex flex-col" style={{ width: '80px' }}>
      {/* Header spacer */}
      <div className="h-12 border-b border-gray-300 flex items-center justify-center text-sm font-medium px-1">
        שעה
      </div>
      
      {/* Time labels */}
      <div className="relative flex-1" style={{ height: `${timeSlots.length * 24}px` }}>
        {hourSlots.map((slot) => (
          <div
            key={slot.timeString}
            className="absolute w-full text-right text-xs text-gray-500 pr-2 leading-none"
            style={{ 
              top: `${(slot.totalMinutes - 360) / 15 * 24 + 4}px`,
            }}
          >
            {slot.timeString}
          </div>
        ))}
      </div>
    </div>
  );
}
