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
const VALID_DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function normalizeString(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function normalizeBreakType(value) {
  const normalized = normalizeString(value).toLowerCase();
  return VALID_BREAK_TYPES.includes(normalized) ? normalized : 'break';
}

function normalizeTimeHms(value) {
  const raw = normalizeString(value);
  if (!raw) return '';
  // Accept HH:MM or HH:MM:SS
  if (/^\d{2}:\d{2}(:\d{2})?$/.test(raw)) return raw;
  return '';
}

export default async function instructorBreakTemplatesHandler(context, req) {
  const env = readEnv();
  const config = readSupabaseAdminConfig(env);
  const client = createSupabaseAdminClient(config);
  attachErrorTracking(context, req, client, { metadata: { endpoint: 'instructor-break-templates' } });

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

  attachErrorTracking(context, req, client, {
    orgId,
    userId: user.id,
    metadata: { endpoint: 'instructor-break-templates' },
  });

  const membership = await ensureMembership(client, orgId, user.id);
  if (!membership) {
    return respond(context, 403, { message: 'forbidden' });
  }

  const method = req.method?.toUpperCase();

  // ---------------------------------------------------------------
  // GET — list break templates for the org
  // ---------------------------------------------------------------
  if (method === 'GET') {
    const instructorId = normalizeString(req.query?.instructor_employee_id || '');
    const showInactive = req.query?.show_inactive === 'true';

    let query = withOrgScope(client, 'instructor_break_templates', orgId)
      .select(
        'id, instructor_employee_id, day_of_week, time_of_day, duration_minutes, break_type, note, valid_from, valid_until, is_active, created_by, created_at, updated_at, metadata'
      )
      .order('day_of_week', { ascending: true })
      .order('time_of_day', { ascending: true });

    if (!showInactive) {
      query = query.eq('is_active', true);
    }

    if (instructorId && UUID_PATTERN.test(instructorId)) {
      query = query.eq('instructor_employee_id', instructorId);
    }

    const { data, error } = await query;
    if (error) {
      return respondTrackedError(context, req, client, {
        status: 500,
        message: 'failed_to_list_break_templates',
        orgId,
        userId: user.id,
        error,
        metadata: { operation: 'list' },
      });
    }

    return respond(context, 200, data);
  }

  // ---------------------------------------------------------------
  // POST — create a break template (admin/owner only)
  // ---------------------------------------------------------------
  if (method === 'POST') {
    if (!['admin', 'owner'].includes(membership)) {
      return respond(context, 403, { message: 'forbidden' });
    }

    const body = await parseRequestBody(req);
    const instructorEmployeeId = normalizeString(body?.instructor_employee_id || '');
    const dayOfWeek = normalizeString(body?.day_of_week || '').toLowerCase();
    const timeOfDay = normalizeTimeHms(body?.time_of_day);
    const durationMinutes = Number(body?.duration_minutes);
    const breakType = normalizeBreakType(body?.break_type);
    const note = normalizeString(body?.note || '') || null;
    const validFrom = normalizeString(body?.valid_from || '') || null;
    const validUntil = normalizeString(body?.valid_until || '') || null;

    if (!UUID_PATTERN.test(instructorEmployeeId)) {
      return respond(context, 400, { message: 'invalid_instructor_employee_id' });
    }
    if (!VALID_DAYS.includes(dayOfWeek)) {
      return respond(context, 400, { message: 'invalid_day_of_week' });
    }
    if (!timeOfDay) {
      return respond(context, 400, { message: 'time_of_day_required' });
    }
    if (!Number.isFinite(durationMinutes) || durationMinutes < 1 || durationMinutes > 720) {
      return respond(context, 400, { message: 'invalid_duration_minutes' });
    }

    const { data, error } = await withOrgScope(client, 'instructor_break_templates', orgId)
      .insert({
        org_id: orgId,
        instructor_employee_id: instructorEmployeeId,
        day_of_week: dayOfWeek,
        time_of_day: timeOfDay,
        duration_minutes: durationMinutes,
        break_type: breakType,
        note,
        valid_from: validFrom || null,
        valid_until: validUntil || null,
        is_active: true,
        created_by: user.id,
      })
      .select(
        'id, instructor_employee_id, day_of_week, time_of_day, duration_minutes, break_type, note, valid_from, valid_until, is_active, created_by, created_at, updated_at, metadata'
      )
      .single();

    if (error) {
      return respondTrackedError(context, req, client, {
        status: 500,
        message: 'failed_to_create_break_template',
        orgId,
        userId: user.id,
        error,
        metadata: { operation: 'create' },
      });
    }

    return respond(context, 201, data);
  }

  // ---------------------------------------------------------------
  // PUT — update a break template (admin/owner only)
  // ---------------------------------------------------------------
  if (method === 'PUT') {
    if (!['admin', 'owner'].includes(membership)) {
      return respond(context, 403, { message: 'forbidden' });
    }

    const body = await parseRequestBody(req);
    const templateId = normalizeString(body?.id || req.params?.id || '');

    if (!UUID_PATTERN.test(templateId)) {
      return respond(context, 400, { message: 'invalid_template_id' });
    }

    const updates = {};
    if (body?.day_of_week != null) {
      const dayOfWeek = normalizeString(body.day_of_week).toLowerCase();
      if (!VALID_DAYS.includes(dayOfWeek)) return respond(context, 400, { message: 'invalid_day_of_week' });
      updates.day_of_week = dayOfWeek;
    }
    if (body?.time_of_day != null) {
      const timeOfDay = normalizeTimeHms(body.time_of_day);
      if (!timeOfDay) return respond(context, 400, { message: 'time_of_day_required' });
      updates.time_of_day = timeOfDay;
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
    if ('valid_from' in body) {
      updates.valid_from = normalizeString(body.valid_from || '') || null;
    }
    if ('valid_until' in body) {
      updates.valid_until = normalizeString(body.valid_until || '') || null;
    }
    if (body?.is_active != null) {
      updates.is_active = Boolean(body.is_active);
    }
    if (body?.metadata != null && typeof body.metadata === 'object' && !Array.isArray(body.metadata)) {
      updates.metadata = body.metadata;
    }

    if (Object.keys(updates).length === 0) {
      return respond(context, 400, { message: 'no_fields_to_update' });
    }

    updates.updated_at = new Date().toISOString();

    const { data, error } = await withOrgScope(client, 'instructor_break_templates', orgId)
      .update(updates)
      .eq('id', templateId)
      .select(
        'id, instructor_employee_id, day_of_week, time_of_day, duration_minutes, break_type, note, valid_from, valid_until, is_active, created_by, created_at, updated_at, metadata'
      )
      .single();

    if (error) {
      return respondTrackedError(context, req, client, {
        status: 500,
        message: 'failed_to_update_break_template',
        orgId,
        userId: user.id,
        error,
        metadata: { operation: 'update', templateId },
      });
    }
    if (!data) {
      return respond(context, 404, { message: 'break_template_not_found' });
    }

    return respond(context, 200, data);
  }

  // ---------------------------------------------------------------
  // DELETE — soft-deactivate (admin/owner only)
  // ---------------------------------------------------------------
  if (method === 'DELETE') {
    if (!['admin', 'owner'].includes(membership)) {
      return respond(context, 403, { message: 'forbidden' });
    }

    const templateId = normalizeString(req.query?.id || req.params?.id || '');
    if (!UUID_PATTERN.test(templateId)) {
      return respond(context, 400, { message: 'invalid_template_id' });
    }

    const { error } = await withOrgScope(client, 'instructor_break_templates', orgId)
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', templateId);

    if (error) {
      return respondTrackedError(context, req, client, {
        status: 500,
        message: 'failed_to_delete_break_template',
        orgId,
        userId: user.id,
        error,
        metadata: { operation: 'delete', templateId },
      });
    }

    return respond(context, 204, null);
  }

  return respond(context, 405, { message: 'method_not_allowed' });
}
