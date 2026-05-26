/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import {
  UUID_PATTERN,
  ensureMembership,
  parseRequestBody,
  readEnv,
  respond,
  resolveOrgId,
  withOrgScope,
} from '../_shared/org-bff.js';
import { attachErrorTracking, respondTracked, respondTrackedError } from '../_shared/error-events.js';

const VALID_BREAK_TYPES = ['break', 'meeting', 'unavailable', 'personal'];

function normalizeString(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function normalizeBreakType(value) {
  const normalized = normalizeString(value).toLowerCase();
  return VALID_BREAK_TYPES.includes(normalized) ? normalized : 'break';
}

export default async function instructorBreaksHandler(context, req) {
  attachErrorTracking(context);

  const env = readEnv();
  const config = readSupabaseAdminConfig(env);
  const client = createSupabaseAdminClient(config);

  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    return respondTracked(context, 401, { error: 'Unauthorized' });
  }

  const authResult = await client.auth.getUser(authorization.token);
  if (authResult.error || !authResult.data?.user) {
    return respondTracked(context, 401, { error: 'Unauthorized' });
  }
  const user = authResult.data.user;

  const orgId = resolveOrgId(req);
  if (!orgId) {
    return respondTracked(context, 400, { error: 'Missing org_id' });
  }

  const membership = await ensureMembership(client, orgId, user.id);
  if (!membership) {
    return respondTracked(context, 403, { error: 'Forbidden' });
  }

  const method = req.method?.toUpperCase();

  // ---------------------------------------------------------------
  // GET — list breaks for a date range
  // ---------------------------------------------------------------
  if (method === 'GET') {
    const startDate = normalizeString(req.query?.start_date || '');
    const endDate = normalizeString(req.query?.end_date || '');
    const instructorId = normalizeString(req.query?.instructor_employee_id || '');

    if (!startDate || !endDate) {
      return respondTracked(context, 400, { error: 'start_date and end_date are required' });
    }

    let query = withOrgScope(client, 'instructor_breaks', orgId)
      .select('id, instructor_employee_id, datetime_start, duration_minutes, break_type, note, created_by, created_at, updated_at, metadata')
      .gte('datetime_start', `${startDate}T00:00:00.000Z`)
      .lt('datetime_start', `${endDate}T23:59:59.999Z`)
      .order('datetime_start', { ascending: true });

    if (instructorId && UUID_PATTERN.test(instructorId)) {
      query = query.eq('instructor_employee_id', instructorId);
    }

    const { data, error } = await query;
    if (error) {
      return respondTrackedError(context, error, 'instructor_breaks.get');
    }

    return respondTracked(context, 200, data);
  }

  // ---------------------------------------------------------------
  // POST — create a break (admin/owner only)
  // ---------------------------------------------------------------
  if (method === 'POST') {
    if (!['admin', 'owner'].includes(membership)) {
      return respondTracked(context, 403, { error: 'Only admins can create breaks' });
    }

    const body = await parseRequestBody(req);
    const instructorEmployeeId = normalizeString(body?.instructor_employee_id || '');
    const datetimeStart = normalizeString(body?.datetime_start || '');
    const durationMinutes = Number(body?.duration_minutes);
    const breakType = normalizeBreakType(body?.break_type);
    const note = normalizeString(body?.note || '') || null;

    if (!UUID_PATTERN.test(instructorEmployeeId)) {
      return respondTracked(context, 400, { error: 'instructor_employee_id is required' });
    }
    if (!datetimeStart) {
      return respondTracked(context, 400, { error: 'datetime_start is required' });
    }
    if (!Number.isFinite(durationMinutes) || durationMinutes < 1 || durationMinutes > 720) {
      return respondTracked(context, 400, { error: 'duration_minutes must be between 1 and 720' });
    }

    const { data, error } = await withOrgScope(client, 'instructor_breaks', orgId)
      .insert({
        org_id: orgId,
        instructor_employee_id: instructorEmployeeId,
        datetime_start: datetimeStart,
        duration_minutes: durationMinutes,
        break_type: breakType,
        note,
        created_by: user.id,
      })
      .select('id, instructor_employee_id, datetime_start, duration_minutes, break_type, note, created_by, created_at, updated_at, metadata')
      .single();

    if (error) {
      return respondTrackedError(context, error, 'instructor_breaks.post');
    }

    return respondTracked(context, 201, data);
  }

  // ---------------------------------------------------------------
  // PUT — update a break (admin/owner only)
  // ---------------------------------------------------------------
  if (method === 'PUT') {
    if (!['admin', 'owner'].includes(membership)) {
      return respondTracked(context, 403, { error: 'Only admins can update breaks' });
    }

    const body = await parseRequestBody(req);
    const breakId = normalizeString(body?.id || req.params?.id || '');

    if (!UUID_PATTERN.test(breakId)) {
      return respondTracked(context, 400, { error: 'id is required' });
    }

    const updates = {};
    if (body?.datetime_start != null) {
      const datetimeStart = normalizeString(body.datetime_start);
      if (!datetimeStart) return respondTracked(context, 400, { error: 'datetime_start cannot be empty' });
      updates.datetime_start = datetimeStart;
    }
    if (body?.duration_minutes != null) {
      const durationMinutes = Number(body.duration_minutes);
      if (!Number.isFinite(durationMinutes) || durationMinutes < 1 || durationMinutes > 720) {
        return respondTracked(context, 400, { error: 'duration_minutes must be between 1 and 720' });
      }
      updates.duration_minutes = durationMinutes;
    }
    if (body?.break_type != null) {
      updates.break_type = normalizeBreakType(body.break_type);
    }
    if ('note' in body) {
      updates.note = normalizeString(body.note || '') || null;
    }
    if (body?.metadata != null && typeof body.metadata === 'object' && !Array.isArray(body.metadata)) {
      updates.metadata = body.metadata;
    }

    if (Object.keys(updates).length === 0) {
      return respondTracked(context, 400, { error: 'No fields to update' });
    }

    updates.updated_at = new Date().toISOString();

    const { data, error } = await withOrgScope(client, 'instructor_breaks', orgId)
      .update(updates)
      .eq('id', breakId)
      .select('id, instructor_employee_id, datetime_start, duration_minutes, break_type, note, created_by, created_at, updated_at, metadata')
      .single();

    if (error) {
      return respondTrackedError(context, error, 'instructor_breaks.put');
    }
    if (!data) {
      return respondTracked(context, 404, { error: 'Break not found' });
    }

    return respondTracked(context, 200, data);
  }

  // ---------------------------------------------------------------
  // DELETE — hard delete a break (admin/owner only)
  // ---------------------------------------------------------------
  if (method === 'DELETE') {
    if (!['admin', 'owner'].includes(membership)) {
      return respondTracked(context, 403, { error: 'Only admins can delete breaks' });
    }

    const breakId = normalizeString(req.query?.id || req.params?.id || '');
    if (!UUID_PATTERN.test(breakId)) {
      return respondTracked(context, 400, { error: 'id is required' });
    }

    const { error } = await withOrgScope(client, 'instructor_breaks', orgId)
      .delete()
      .eq('id', breakId);

    if (error) {
      return respondTrackedError(context, error, 'instructor_breaks.delete');
    }

    return respond(context, 204, null);
  }

  return respondTracked(context, 405, { error: 'Method not allowed' });
}
