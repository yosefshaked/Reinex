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
import { attachErrorTracking, respondTrackedError } from '../_shared/error-events.js';

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
  const env = readEnv();
  const config = readSupabaseAdminConfig(env);
  const client = createSupabaseAdminClient(config);
  attachErrorTracking(context, req, client, { metadata: { endpoint: 'instructor-breaks' } });

  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    return respond(context, 401, { message: 'missing_bearer' });
  }

  const authResult = await client.auth.getUser(authorization.token);
  if (authResult.error || !authResult.data?.user) {
    return respond(context, 401, { message: 'invalid_or_expired_token' });
  }
  const user = authResult.data.user;

  const orgId = resolveOrgId(req);
  if (!orgId) {
    return respond(context, 400, { message: 'missing_org_id' });
  }

  attachErrorTracking(context, req, client, { orgId, userId: user.id, metadata: { endpoint: 'instructor-breaks' } });

  const membership = await ensureMembership(client, orgId, user.id);
  if (!membership) {
    return respond(context, 403, { message: 'forbidden' });
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
      return respond(context, 400, { message: 'start_date_and_end_date_required' });
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
      return respondTrackedError(context, req, client, {
        status: 500,
        message: 'failed_to_list_instructor_breaks',
        orgId,
        userId: user.id,
        error,
        metadata: { operation: 'list' },
      });
    }

    return respond(context, 200, data);
  }

  // ---------------------------------------------------------------
  // POST — create a break (admin/owner only)
  // ---------------------------------------------------------------
  if (method === 'POST') {
    if (!['admin', 'owner'].includes(membership)) {
      return respond(context, 403, { message: 'forbidden' });
    }

    const body = await parseRequestBody(req);
    const instructorEmployeeId = normalizeString(body?.instructor_employee_id || '');
    const datetimeStart = normalizeString(body?.datetime_start || '');
    const durationMinutes = Number(body?.duration_minutes);
    const breakType = normalizeBreakType(body?.break_type);
    const note = normalizeString(body?.note || '') || null;

    if (!UUID_PATTERN.test(instructorEmployeeId)) {
      return respond(context, 400, { message: 'invalid_instructor_employee_id' });
    }
    if (!datetimeStart) {
      return respond(context, 400, { message: 'datetime_start_required' });
    }
    if (!Number.isFinite(durationMinutes) || durationMinutes < 1 || durationMinutes > 720) {
      return respond(context, 400, { message: 'invalid_duration_minutes' });
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
      return respondTrackedError(context, req, client, {
        status: 500,
        message: 'failed_to_create_instructor_break',
        orgId,
        userId: user.id,
        error,
        metadata: { operation: 'create' },
      });
    }

    return respond(context, 201, data);
  }

  // ---------------------------------------------------------------
  // PUT — update a break (admin/owner only)
  // ---------------------------------------------------------------
  if (method === 'PUT') {
    if (!['admin', 'owner'].includes(membership)) {
      return respond(context, 403, { message: 'forbidden' });
    }

    const body = await parseRequestBody(req);
    const breakId = normalizeString(body?.id || req.params?.id || '');

    if (!UUID_PATTERN.test(breakId)) {
      return respond(context, 400, { message: 'invalid_break_id' });
    }

    const updates = {};
    if (body?.datetime_start != null) {
      const datetimeStart = normalizeString(body.datetime_start);
      if (!datetimeStart) return respond(context, 400, { message: 'datetime_start_required' });
      updates.datetime_start = datetimeStart;
    }
    if (body?.duration_minutes != null) {
      const durationMinutes = Number(body.duration_minutes);
      if (!Number.isFinite(durationMinutes) || durationMinutes < 1 || durationMinutes > 720) {
        return respond(context, 400, { message: 'invalid_duration_minutes' });
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
      return respond(context, 400, { message: 'no_fields_to_update' });
    }

    updates.updated_at = new Date().toISOString();

    const { data, error } = await withOrgScope(client, 'instructor_breaks', orgId)
      .update(updates)
      .eq('id', breakId)
      .select('id, instructor_employee_id, datetime_start, duration_minutes, break_type, note, created_by, created_at, updated_at, metadata')
      .single();

    if (error) {
      return respondTrackedError(context, req, client, {
        status: 500,
        message: 'failed_to_update_instructor_break',
        orgId,
        userId: user.id,
        error,
        metadata: { operation: 'update', breakId },
      });
    }
    if (!data) {
      return respond(context, 404, { message: 'break_not_found' });
    }

    return respond(context, 200, data);
  }

  // ---------------------------------------------------------------
  // DELETE — hard delete a break (admin/owner only)
  // ---------------------------------------------------------------
  if (method === 'DELETE') {
    if (!['admin', 'owner'].includes(membership)) {
      return respond(context, 403, { message: 'forbidden' });
    }

    const breakId = normalizeString(req.query?.id || req.params?.id || '');
    if (!UUID_PATTERN.test(breakId)) {
      return respond(context, 400, { message: 'invalid_break_id' });
    }

    const { error } = await withOrgScope(client, 'instructor_breaks', orgId)
      .delete()
      .eq('id', breakId);

    if (error) {
      return respondTrackedError(context, req, client, {
        status: 500,
        message: 'failed_to_delete_instructor_break',
        orgId,
        userId: user.id,
        error,
        metadata: { operation: 'delete', breakId },
      });
    }

    return respond(context, 204, null);
  }

  return respond(context, 405, { message: 'method_not_allowed' });
}
