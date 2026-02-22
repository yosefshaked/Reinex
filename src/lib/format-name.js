/**
 * Shared name formatting utilities for students, instructors, and other entities
 */

/**
 * Formats full name from a person object with first_name, middle_name, last_name fields
 * @param {Object} person - Person object with name fields
 * @returns {string} Formatted full name or fallback
 */
export function formatPersonName(person) {
  if (!person) return 'ללא שם';
  
  const first = person?.first_name || '';
  const middle = person?.middle_name || '';
  const last = person?.last_name || '';
  
  return formatName(first, middle, last);
}

/**
 * Formats full name from individual components
 * @param {string} firstName - First name
 * @param {string} middleName - Middle name (optional)
 * @param {string} lastName - Last name
 * @returns {string} Formatted full name or fallback
 */
export function formatName(firstName, middleName, lastName) {
  const parts = [
    firstName?.trim(),
    middleName?.trim(),
    lastName?.trim(),
  ].filter(Boolean);
  
  return parts.length > 0 ? parts.join(' ') : 'ללא שם';
}

// Convenient aliases for domain-specific usage
export const formatStudentName = formatPersonName;
export const formatInstructorName = formatPersonName;
