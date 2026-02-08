/**
 * Creates the initial state object for student forms (add/edit).
 * This is the single source of truth for student form structure.
 * Updated for Reinex model: public.students schema.
 * 
 * @param {Object|null|undefined} student - Optional student object to populate the form
 * @returns {Object} Complete form state with all required fields
 */
export function createStudentFormState(student) {
  return {
    // Basic identity
    firstName: student?.first_name || '',
    middleName: student?.middle_name || '',
    lastName: student?.last_name || '',
    identityNumber: student?.identity_number || student?.national_id || '',
    dateOfBirth: student?.date_of_birth || '',
    
    // Instructor assignment (optional for waitlist)
    assignedInstructorId: student?.assigned_instructor_id || '',
    
    // Guardian (optional for independent students)
    guardianId: student?.guardian_id || '',
    guardianRelationship: student?.guardian_relationship || '',
    
    // Contact (phone required if no guardian)
    phone: student?.phone || '',
    email: student?.email || '',
    
    // Reinex-specific fields
    notificationMethod: student?.default_notification_method || 'whatsapp',
    specialRate: student?.special_rate || '',
    medicalFlags: student?.medical_flags || null,
    onboardingStatus: student?.onboarding_status || 'not_started',
    notesInternal: student?.notes_internal || '',
    
    // Status
    isActive: student?.is_active !== false,
    
    // Tags (kept for categorization)
    tagId: Array.isArray(student?.tags) && student.tags.length > 0 ? student.tags[0] : '',
  };
}
