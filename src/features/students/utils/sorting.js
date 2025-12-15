import { normalizeDay } from './schedule.js';

/**
 * Parse time string to minutes since midnight for comparison
 * @param {string|null} timeStr - Time string in HH:MM or HH:MM:SS format
 * @returns {number} - Minutes since midnight, or Infinity if invalid
 */
function parseTimeToMinutes(timeStr) {
  if (!timeStr) return Infinity;
  
  try {
    const parts = String(timeStr).split(':');
    if (parts.length < 2) return Infinity;
    
    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10);
    
    if (isNaN(hours) || isNaN(minutes)) return Infinity;
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return Infinity;
    
    return hours * 60 + minutes;
  } catch {
    return Infinity;
  }
}

/**
 * Compare two students by name using Hebrew locale
 * @param {Object} a - First student
 * @param {Object} b - Second student
 * @returns {number} - Comparison result (-1, 0, 1)
 */
function compareStudentNames(a, b) {
  const nameA = String(a?.name || '').toLowerCase();
  const nameB = String(b?.name || '').toLowerCase();
  return nameA.localeCompare(nameB, 'he');
}

/**
 * Compare two instructor names handling null cases
 * Returns comparison result or null if both are empty
 * @param {string} nameA - First instructor name
 * @param {string} nameB - Second instructor name
 * @returns {number|null} - Comparison result or null
 */
function compareInstructorNames(nameA, nameB) {
  // Empty instructor names go to end
  if (!nameA && nameB) return 1;
  if (nameA && !nameB) return -1;
  if (nameA && nameB) {
    return nameA.localeCompare(nameB, 'he');
  }
  return null; // Both empty
}

/**
 * Compare function for sorting students by:
 * 1. Day of week (1-7, nulls last)
 * 2. Hour within day (earliest first, nulls last)
 * 3. Instructor name (alphabetically, nulls last)
 * 4. Student name (alphabetically)
 * 
 * @param {Object} a - First student
 * @param {Object} b - Second student
 * @param {Map<string, Object>} instructorMap - Map of instructor IDs to instructor objects
 * @returns {number} - Comparison result (-1, 0, 1)
 */
export function compareStudentsBySchedule(a, b, instructorMap = new Map()) {
  // 1. Compare by day of week
  const dayA = normalizeDay(a?.default_day_of_week);
  const dayB = normalizeDay(b?.default_day_of_week);
  
  // Nulls go to the end
  if (dayA === null && dayB !== null) return 1;
  if (dayA !== null && dayB === null) return -1;
  if (dayA !== null && dayB !== null && dayA !== dayB) {
    return dayA - dayB;
  }
  
  // 2. Compare by hour (within same day)
  const timeA = parseTimeToMinutes(a?.default_session_time);
  const timeB = parseTimeToMinutes(b?.default_session_time);
  
  if (timeA !== timeB) {
    return timeA - timeB;
  }
  
  // 3. Compare by instructor name (for admins)
  const instructorA = instructorMap.get(a?.assigned_instructor_id);
  const instructorB = instructorMap.get(b?.assigned_instructor_id);
  
  const instructorNameA = instructorA?.name || '';
  const instructorNameB = instructorB?.name || '';
  
  const instructorCompare = compareInstructorNames(instructorNameA, instructorNameB);
  if (instructorCompare !== null && instructorCompare !== 0) {
    return instructorCompare;
  }
  
  // 4. Finally, compare by student name
  return compareStudentNames(a, b);
}

/**
 * Sort an array of students by schedule priority
 * @param {Array} students - Array of student objects
 * @param {Map<string, Object>} instructorMap - Map of instructor IDs to instructor objects
 * @returns {Array} - Sorted array of students
 */
export function sortStudentsBySchedule(students, instructorMap = new Map()) {
  if (!Array.isArray(students)) return [];
  
  return [...students].sort((a, b) => compareStudentsBySchedule(a, b, instructorMap));
}

/**
 * Sorting options for student tables
 */
export const STUDENT_SORT_OPTIONS = Object.freeze({
  SCHEDULE: 'schedule', // day → hour → instructor → name
  NAME: 'name',
  INSTRUCTOR: 'instructor', // day → instructor → hour → name
});

/**
 * Get a comparator function for a specific sort option
 * @param {string} sortBy - One of STUDENT_SORT_OPTIONS
 * @param {Map<string, Object>} instructorMap - Map of instructor IDs to instructor objects
 * @returns {Function} - Comparator function
 */
export function getStudentComparator(sortBy, instructorMap = new Map()) {
  switch (sortBy) {
    case STUDENT_SORT_OPTIONS.NAME:
      return compareStudentNames;
    
    case STUDENT_SORT_OPTIONS.INSTRUCTOR:
      return (a, b) => {
        // 1. Compare by day of week
        const dayA = normalizeDay(a?.default_day_of_week);
        const dayB = normalizeDay(b?.default_day_of_week);
        
        if (dayA === null && dayB !== null) return 1;
        if (dayA !== null && dayB === null) return -1;
        if (dayA !== null && dayB !== null && dayA !== dayB) {
          return dayA - dayB;
        }
        
        // 2. Compare by instructor name
        const instructorA = instructorMap.get(a?.assigned_instructor_id);
        const instructorB = instructorMap.get(b?.assigned_instructor_id);
        
        const instructorNameA = instructorA?.name || '';
        const instructorNameB = instructorB?.name || '';
        
        const instructorCompare = compareInstructorNames(instructorNameA, instructorNameB);
        if (instructorCompare !== null && instructorCompare !== 0) {
          return instructorCompare;
        }
        
        // 3. Compare by hour (within same day and instructor)
        const timeA = parseTimeToMinutes(a?.default_session_time);
        const timeB = parseTimeToMinutes(b?.default_session_time);
        
        if (timeA !== timeB) {
          return timeA - timeB;
        }
        
        // 4. Finally, sort by student name
        return compareStudentNames(a, b);
      };
    
    case STUDENT_SORT_OPTIONS.SCHEDULE:
    default:
      return (a, b) => compareStudentsBySchedule(a, b, instructorMap);
  }
}
