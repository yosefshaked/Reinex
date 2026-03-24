/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import {
  ensureMembership,
  isAdminOrOffice,
  isAdminRole,
  normalizeString,
  readEnv,
  respond,
  resolveOrgId,
  resolveTenantClient,
} from '../_shared/org-bff.js';
import { parseJsonBodyWithLimit } from '../_shared/validation.js';
import { BILLING_SOURCE_TYPES, isYmdDate, syncLessonFinancialArtifacts } from '../_shared/employee-finance.js';

const MAX_BODY_BYTES = 64 * 1024;

function normalizeSourceType(value) {
  const normalized = normalizeString(value).toLowerCase();
  return BILLING_SOURCE_TYPES.has(normalized) ? normalized : '';
}

async function loadParticipant(tenantClient, lessonParticipantId) {
  const { data, error } = await tenantClient
    .from('lesson_participants')
    .select('id, lesson_instance_id, student_id, commitment_id, price_charged')
    .eq('id', lessonParticipantId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data || null;
}

export default async function (context, req) {
  const method = String(req.method || 'GET').toUpperCase();
  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);
  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    return respond(context, 401, { message: 'missing bearer' });
  }

  const supabase = createSupabaseAdminClient(adminConfig);
  const authResult = await supabase.auth.getUser(authorization.token);
  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  const userId = authResult.data.user.id;
  const body = method === 'GET'
    ? {}
    : parseJsonBodyWithLimit(req, MAX_BODY_BYTES, { mode: 'observe', context, endpoint: 'consumption-entries' });
  const orgId = resolveOrgId(req, body);
  if (!orgId) {
    return respond(context, 400, { message: 'invalid org id' });
  }

  let role = null;
  try {
    role = await ensureMembership(supabase, orgId, userId);
  } catch (membershipError) {
    context.log?.error?.('consumption-entries failed to verify membership', { message: membershipError?.message });
    return respond(context, 500, { message: 'failed_to_verify_membership' });
  }
  if (!role) {
    return respond(context, 403, { message: 'forbidden' });
  }

  if (!isAdminOrOffice(role)) {
    return respond(context, 403, { message: 'forbidden' });
  }

  const { client: tenantClient, error: tenantError } = await resolveTenantClient(context, supabase, env, orgId);
  if (tenantError) {
    return respond(context, tenantError.status, tenantError.body);
  }

  if (method === 'GET') {
    let query = tenantClient
      .from('consumption_entries')
      .select('id, lesson_participant_id, student_id, source_type, commitment_id, transfer_ref, amount_charged, effective_date, notes, created_at, metadata')
      .order('effective_date', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false });

    const studentId = normalizeString(req?.query?.student_id);
    const commitmentId = normalizeString(req?.query?.commitment_id);
    const sourceType = normalizeSourceType(req?.query?.source_type);

    if (studentId) {
      query = query.eq('student_id', studentId);
    }
    if (commitmentId) {
      query = query.eq('commitment_id', commitmentId);
    }
    if (sourceType) {
      query = query.eq('source_type', sourceType);
    }

    const { data, error } = await query;
    if (error) {
      context.log?.error?.('consumption-entries failed to load records', { message: error.message });
      return respond(context, 500, { message: 'failed_to_load_consumption_entries' });
    }

    return respond(context, 200, { entries: data || [] });
  }

  if (!isAdminRole(role)) {
    return respond(context, 403, { message: 'forbidden' });
  }

  const action = normalizeString(body?.action).toLowerCase();

  if (method === 'POST' && action === 'assign_participant_commitment') {
    const lessonParticipantId = normalizeString(body?.lesson_participant_id);
    const commitmentId = normalizeString(body?.commitment_id);
    if (!lessonParticipantId || !commitmentId) {
      return respond(context, 400, { message: 'missing_assignment_target' });
    }

    const participant = await loadParticipant(tenantClient, lessonParticipantId);
    if (!participant) {
      return respond(context, 404, { message: 'lesson_participant_not_found' });
    }

    const { data: commitment, error: commitmentError } = await tenantClient
      .from('commitments')
      .select('id, student_id, default_charge_amount')
      .eq('id', commitmentId)
      .maybeSingle();

    if (commitmentError) {
      context.log?.error?.('consumption-entries failed to load commitment', { message: commitmentError.message });
      return respond(context, 500, { message: 'failed_to_load_commitment' });
    }
    if (!commitment) {
      return respond(context, 404, { message: 'commitment_not_found' });
    }
    if (commitment.student_id !== participant.student_id) {
      return respond(context, 409, { message: 'commitment_belongs_to_different_student' });
    }

    const { error: updateError } = await tenantClient
      .from('lesson_participants')
      .update({
        commitment_id: commitment.id,
        price_charged: commitment.default_charge_amount ?? null,
      })
      .eq('id', lessonParticipantId);

    if (updateError) {
      context.log?.error?.('consumption-entries failed to assign commitment', { message: updateError.message });
      return respond(context, 500, { message: 'failed_to_assign_commitment' });
    }

    await syncLessonFinancialArtifacts(tenantClient, participant.lesson_instance_id, userId);
    const refreshed = await loadParticipant(tenantClient, lessonParticipantId);
    return respond(context, 200, { participant: refreshed });
  }

  if (method === 'POST' && action === 'clear_participant_commitment') {
    const lessonParticipantId = normalizeString(body?.lesson_participant_id);
    if (!lessonParticipantId) {
      return respond(context, 400, { message: 'missing_lesson_participant_id' });
    }

    const participant = await loadParticipant(tenantClient, lessonParticipantId);
    if (!participant) {
      return respond(context, 404, { message: 'lesson_participant_not_found' });
    }

    const { error: updateError } = await tenantClient
      .from('lesson_participants')
      .update({
        commitment_id: null,
        price_charged: null,
      })
      .eq('id', lessonParticipantId);

    if (updateError) {
      context.log?.error?.('consumption-entries failed to clear commitment', { message: updateError.message });
      return respond(context, 500, { message: 'failed_to_clear_commitment' });
    }

    await syncLessonFinancialArtifacts(tenantClient, participant.lesson_instance_id, userId);
    const refreshed = await loadParticipant(tenantClient, lessonParticipantId);
    return respond(context, 200, { participant: refreshed });
  }

  if (method === 'POST' || method === 'PUT') {
    const sourceType = normalizeSourceType(body?.source_type);
    const amountCharged = Number(body?.amount_charged);
    const effectiveDate = normalizeString(body?.effective_date);
    if (!sourceType || sourceType === 'lesson') {
      return respond(context, 400, { message: 'invalid_source_type' });
    }
    if (!Number.isFinite(amountCharged)) {
      return respond(context, 400, { message: 'invalid_amount_charged' });
    }
    if (effectiveDate && !isYmdDate(effectiveDate)) {
      return respond(context, 400, { message: 'invalid_effective_date' });
    }

    const payload = {
      lesson_participant_id: null,
      student_id: normalizeString(body?.student_id) || null,
      source_type: sourceType,
      commitment_id: normalizeString(body?.commitment_id) || null,
      transfer_ref: normalizeString(body?.transfer_ref) || null,
      amount_charged: amountCharged,
      effective_date: effectiveDate || null,
      notes: normalizeString(body?.notes) || null,
      metadata: body?.metadata && typeof body.metadata === 'object' ? body.metadata : {},
    };

    if (method === 'POST') {
      payload.created_at = new Date().toISOString();
      const { data, error } = await tenantClient
        .from('consumption_entries')
        .insert(payload)
        .select('id, lesson_participant_id, student_id, source_type, commitment_id, transfer_ref, amount_charged, effective_date, notes, created_at, metadata')
        .single();

      if (error) {
        context.log?.error?.('consumption-entries failed to create record', { message: error.message });
        return respond(context, 500, { message: 'failed_to_create_consumption_entry' });
      }

      return respond(context, 201, data);
    }

    const id = normalizeString(body?.id);
    if (!id) {
      return respond(context, 400, { message: 'missing_consumption_entry_id' });
    }

    const { data, error } = await tenantClient
      .from('consumption_entries')
      .update(payload)
      .eq('id', id)
      .select('id, lesson_participant_id, student_id, source_type, commitment_id, transfer_ref, amount_charged, effective_date, notes, created_at, metadata')
      .maybeSingle();

    if (error) {
      context.log?.error?.('consumption-entries failed to update record', { message: error.message });
      return respond(context, 500, { message: 'failed_to_update_consumption_entry' });
    }
    if (!data) {
      return respond(context, 404, { message: 'consumption_entry_not_found' });
    }

    return respond(context, 200, data);
  }

  if (method === 'DELETE') {
    const id = normalizeString(body?.id);
    if (!id) {
      return respond(context, 400, { message: 'missing_consumption_entry_id' });
    }

    const { data, error } = await tenantClient
      .from('consumption_entries')
      .delete()
      .eq('id', id)
      .select('id')
      .maybeSingle();

    if (error) {
      context.log?.error?.('consumption-entries failed to delete record', { message: error.message });
      return respond(context, 500, { message: 'failed_to_delete_consumption_entry' });
    }
    if (!data) {
      return respond(context, 404, { message: 'consumption_entry_not_found' });
    }

    return respond(context, 200, { id, deleted: true });
  }

  return respond(context, 405, { message: 'method not allowed' });
}
