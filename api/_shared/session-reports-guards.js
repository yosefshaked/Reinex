/* eslint-env node */
// Shared guard for Session Reports edge cases E1/E2/E3 (see
// implementations/session-reports/implementation-plan.md — "Anchoring edge cases",
// LOCKED policy: E1/E2 block the transition/cancellation/delete while a
// non-legacy report exists for the affected participant(s)).
//
// Cheap, indexed lookup: form_submissions has a partial unique index on
// lesson_participant_id (WHERE lesson_participant_id IS NOT NULL AND is_legacy = false),
// and a supporting (org_id, lesson_participant_id) index — this is a single
// indexed IN() query, safe to call on every write site guarded below.
import { withOrgScope } from './org-bff.js';

/**
 * Returns the lesson_participant_ids (subset of participantIds) that have a
 * non-legacy session report on file. Empty array = no blocking reports.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} client
 * @param {string} orgId
 * @param {string[]} participantIds
 * @returns {Promise<string[]>}
 */
export async function findBlockingReportParticipantIds(client, orgId, participantIds) {
  const ids = Array.from(new Set((participantIds || []).filter(Boolean)));
  if (!ids.length) return [];

  const { data, error } = await withOrgScope(client, 'form_submissions', orgId)
    .select('lesson_participant_id')
    .in('lesson_participant_id', ids)
    .eq('is_legacy', false);

  if (error) {
    throw error;
  }

  return Array.from(new Set((data || []).map((row) => row.lesson_participant_id).filter(Boolean)));
}

/**
 * Convenience boolean wrapper.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} client
 * @param {string} orgId
 * @param {string[]} participantIds
 * @returns {Promise<boolean>}
 */
export async function hasBlockingReportForParticipants(client, orgId, participantIds) {
  const blocking = await findBlockingReportParticipantIds(client, orgId, participantIds);
  return blocking.length > 0;
}
