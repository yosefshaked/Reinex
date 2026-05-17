import { normalizeString, withOrgScope } from './org-bff.js';

/**
 * Returns all student IDs visible to a given instructor via their active templates.
 * Covers both single-student templates (lesson_templates.student_id) and
 * multi-student group templates (lesson_template_participants).
 *
 * @param {object} tenantClient - Supabase client (RLS-scoped tenant client, or admin client)
 * @param {string} instructorEmployeeId - The instructor's employee record ID
 * @param {{ orgId?: string }} [options] - Pass orgId when using an admin/control client that bypasses RLS
 */
export async function fetchStudentIdsByInstructor(tenantClient, instructorEmployeeId, { orgId } = {}) {
  if (!instructorEmployeeId) {
    return { studentIds: [], error: null };
  }

  const scope = (table) => orgId
    ? withOrgScope(tenantClient, table, orgId)
    : tenantClient.from(table);

  // Step 1: find all active template IDs (and direct student_id) for this instructor
  const { data: templates, error } = await scope('lesson_templates')
    .select('id, student_id')
    .eq('instructor_employee_id', instructorEmployeeId)
    .eq('is_active', true);

  if (error) {
    return { studentIds: [], error };
  }

  const directStudentIds = (templates || []).map((r) => normalizeString(r.student_id)).filter(Boolean);
  const templateIds = (templates || []).map((r) => r.id).filter(Boolean);

  // Step 2: collect students linked via lesson_template_participants (group templates)
  let participantStudentIds = [];
  if (templateIds.length > 0) {
    const { data: participants, error: participantError } = await scope('lesson_template_participants')
      .select('student_id')
      .in('template_id', templateIds);

    if (participantError) {
      return { studentIds: [], error: participantError };
    }

    participantStudentIds = (participants || []).map((r) => normalizeString(r.student_id)).filter(Boolean);
  }

  const studentIds = Array.from(new Set([...directStudentIds, ...participantStudentIds]));
  return { studentIds, error: null };
}
