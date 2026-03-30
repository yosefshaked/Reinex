import { normalizeString } from './org-bff.js';

export async function fetchStudentIdsByInstructor(tenantClient, instructorEmployeeId) {
  if (!instructorEmployeeId) {
    return { studentIds: [], error: null };
  }

  const { data, error } = await tenantClient
    .from('lesson_templates')
    .select('student_id')
    .eq('instructor_employee_id', instructorEmployeeId)
    .eq('is_active', true);

  if (error) {
    return { studentIds: [], error };
  }

  const studentIds = Array.from(
    new Set((data || []).map((row) => normalizeString(row?.student_id)).filter(Boolean)),
  );

  return { studentIds, error: null };
}
