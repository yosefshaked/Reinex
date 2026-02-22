/**
 * Generate time slots for calendar grid (15-minute intervals)
 */
export function generateTimeSlots(startHour = 6, endHour = 22) {
  const slots = [];
  for (let hour = startHour; hour < endHour; hour++) {
    for (let minute = 0; minute < 60; minute += 15) {
      const timeString = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
      const totalMinutes = hour * 60 + minute;
      slots.push({ timeString, totalMinutes });
    }
  }
  return slots;
}

/**
 * Get time slot at a specific pixel position in the calendar grid
 * Grid: 24px = 15 minutes, starts at 6am
 * @param {number} pixelY - Y position in pixels relative to grid top
 * @param {number} slotHeightPx - Height of each 15-minute slot in pixels (default 24)
 * @param {number} startHour - Hour when grid starts (default 6)
 * @returns {object} Time slot object { timeString, totalMinutes, slotIndex, pixelTop }
 */
export function getTimeSlotAtPixel(pixelY, slotHeightPx = 24, startHour = 6) {
  const slots = generateTimeSlots(startHour, 22);
  const slotIndex = Math.round(pixelY / slotHeightPx);
  const clampedIndex = Math.max(0, Math.min(slotIndex, slots.length - 1));
  const slot = slots[clampedIndex];
  
  return {
    ...slot,
    slotIndex: clampedIndex,
    pixelTop: clampedIndex * slotHeightPx,
  };
}

/**
 * Convert datetime string to minutes from start of day
 */
export function datetimeToMinutes(datetimeString) {
  const date = new Date(datetimeString);
  return date.getHours() * 60 + date.getMinutes();
}

/**
 * Calculate position and height for instance card in grid
 * Each 15-min slot = 24px height
 */
export function calculateCardPosition(datetimeStart, durationMinutes, gridStartMinutes = 360) {
  const startMinutes = datetimeToMinutes(datetimeStart);
  const topOffset = ((startMinutes - gridStartMinutes) / 15) * 24;
  const height = (durationMinutes / 15) * 24;
  
  return { top: topOffset, height };
}

/**
 * Format time for display (HH:MM)
 */
export function formatTimeDisplay(datetimeString) {
  const date = new Date(datetimeString);
  return date.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/**
 * Format date for display (Hebrew short format)
 */
export function formatDateDisplay(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' });
}

/**
 * Get status icon and color for instance
 */
export function getInstanceStatusIcon(status, documentationStatus) {
  if (status?.startsWith('cancelled')) {
    return { icon: '❌', color: 'text-red-600', label: 'מבוטל' };
  }
  
  if (status === 'completed') {
    if (documentationStatus === 'documented') {
      return { icon: '✅', color: 'text-green-600', label: 'תועד' };
    }
    return { icon: '✅', color: 'text-green-600', label: 'הושלם' };
  }
  
  if (status === 'no_show') {
    return { icon: '🔴', color: 'text-red-600', label: 'לא הגיע' };
  }
  
  if (status === 'requires_attention') {
    return { icon: '🟡', color: 'text-amber-600', label: 'דורש תשומת לב' };
  }
  
  // Default: undocumented
  return { icon: '⚫', color: 'text-gray-600', label: 'ממתין' };
}
