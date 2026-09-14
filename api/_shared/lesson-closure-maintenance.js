/* eslint-env node */
/**
 * System-admin maintenance job: re-evaluate the stored lesson closure state
 * (lesson_instances.metadata.workflow_state) with the current rules.
 *
 * Stored closure state is recalculated only when a lesson is written to, so a rule change (for example
 * the HMO "pending" fix) leaves already-evaluated lessons stale. This job walks open lessons in keyset
 * pages: `preview` evaluates without writing, `apply` writes only the lessons whose state really changes
 * (each write bumps the lesson version, like any other lesson write).
 */
import { applyLessonClosurePlan, planLessonClosureSync } from './calendar-workflow.js';
import { normalizeString } from './org-bff.js';

export const LESSON_CLOSURE_RESYNC_TOOL = 'lesson_closure_resync';
export const LESSON_CLOSURE_RESYNC_AUDIT_EVENT = 'system_admin.lesson_closure_resync';
export const LESSON_CLOSURE_RESYNC_SCOPES = Object.freeze(['hmo_claim_unresolved', 'open_reasons']);
export const LESSON_CLOSURE_RESYNC_DEFAULT_LIMIT = 25;
export const LESSON_CLOSURE_RESYNC_MAX_LIMIT = 50;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// null = never evaluated (no workflow_state stored), [] = evaluated with nothing open.
function readStoredReasons(metadata) {
  const workflowState = metadata && typeof metadata === 'object' ? metadata.workflow_state : null;
  if (!workflowState || typeof workflowState !== 'object' || Array.isArray(workflowState)) return null;
  return Array.isArray(workflowState.reasons_open) ? workflowState.reasons_open : [];
}

/** Validate a POST body. Returns `{ request }` or `{ error }` with a stable snake_case code. */
export function normalizeLessonClosureResyncRequest(body = {}) {
  const mode = normalizeString(body?.mode).toLowerCase();
  if (mode !== 'preview' && mode !== 'apply') return { error: 'invalid_mode' };

  const scope = normalizeString(body?.scope).toLowerCase() || 'hmo_claim_unresolved';
  if (!LESSON_CLOSURE_RESYNC_SCOPES.includes(scope)) return { error: 'invalid_scope' };

  const orgId = normalizeString(body?.org_id);
  if (orgId && !UUID_PATTERN.test(orgId)) return { error: 'invalid_org_id' };

  const cursor = normalizeString(body?.cursor);
  if (cursor && !UUID_PATTERN.test(cursor)) return { error: 'invalid_cursor' };

  const requestedLimit = Math.trunc(Number(body?.limit));
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(requestedLimit, LESSON_CLOSURE_RESYNC_MAX_LIMIT)
    : LESSON_CLOSURE_RESYNC_DEFAULT_LIMIT;

  return { request: { mode, scope, orgId: orgId || null, cursor: cursor || null, limit } };
}

/**
 * Process one keyset page of open lessons (ordered by id). Returns per-lesson items and
 * `next_cursor` (null when the scan is complete). A failing lesson is reported and does not stop the page.
 */
export async function runLessonClosureResyncBatch(client, request, {
  actorUserId = null,
  plan = planLessonClosureSync,
  apply = applyLessonClosurePlan,
  onLessonError = null,
} = {}) {
  const { mode, scope, orgId, cursor, limit } = request;

  let query = client
    .from('lesson_instances')
    .select('id, org_id, metadata')
    .eq('is_closed', false);
  if (orgId) query = query.eq('org_id', orgId);
  if (scope === 'hmo_claim_unresolved') {
    query = query.contains('metadata', { workflow_state: { reasons_open: ['hmo_claim_unresolved'] } });
  }
  if (cursor) query = query.gt('id', cursor);

  const { data, error } = await query.order('id', { ascending: true }).limit(limit);
  if (error) throw error;

  const rows = Array.isArray(data) ? data : [];
  const items = [];
  for (const row of rows) {
    const storedReasons = readStoredReasons(row?.metadata);
    // Never evaluated, or nothing open: there is no stale state to fix.
    if (!storedReasons || storedReasons.length === 0) continue;

    const base = { lesson_instance_id: row.id, org_id: row.org_id || null, before_reasons: storedReasons };
    try {
      const lessonPlan = await plan(client, row.id, actorUserId);
      if (!lessonPlan) {
        items.push({ ...base, status: 'missing', after_reasons: null, closes: false });
        continue;
      }
      let status = lessonPlan.hasChanged ? 'would_change' : 'unchanged';
      if (mode === 'apply' && lessonPlan.hasChanged) {
        await apply(client, lessonPlan);
        status = 'changed';
      }
      items.push({
        ...base,
        status,
        after_reasons: lessonPlan.result?.reasons_open ?? [],
        closes: lessonPlan.result?.is_closed === true,
      });
    } catch (lessonError) {
      onLessonError?.(row.id, lessonError);
      items.push({ ...base, status: 'error', after_reasons: null, closes: false, error: 'lesson_resync_failed' });
    }
  }

  const countStatus = (status) => items.filter((item) => item.status === status).length;
  return {
    tool: LESSON_CLOSURE_RESYNC_TOOL,
    mode,
    scope,
    org_id: orgId,
    scanned: rows.length,
    items,
    totals: {
      would_change: countStatus('would_change'),
      changed: countStatus('changed'),
      unchanged: countStatus('unchanged'),
      closes: items.filter((item) => item.closes).length,
      failed: countStatus('error') + countStatus('missing'),
    },
    next_cursor: rows.length > 0 && rows.length === limit ? rows[rows.length - 1].id : null,
  };
}
