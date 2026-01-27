/**
 * Formats a student's full name from separate name components
 * @param {Object} student - Student object with name fields
 * @param {string} student.first_name - First name
 * @param {string} student.middle_name - Middle name (optional)
 * @param {string} student.last_name - Last name
 * @returns {string} Formatted full name
 */
export function formatStudentName(student) {
  if (!student) return '';
  
  const parts = [
    student.first_name,
    student.middle_name,
    student.last_name
  ].filter(part => part && part.trim());
  
  return parts.join(' ').trim() || 'ללא שם';
}

/**
 * Formats a student's full name from individual components
 * @param {string} firstName - First name
 * @param {string} middleName - Middle name (optional)
 * @param {string} lastName - Last name
 * @returns {string} Formatted full name
 */
export function formatName(firstName, middleName, lastName) {
  const parts = [firstName, middleName, lastName].filter(part => part && part.trim());
  return parts.join(' ').trim() || 'ללא שם';
}
