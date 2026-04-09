// @ts-check
/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import {
  ensureMembership,
  isAdminOrOffice,
  isAdminRole,
  normalizeNullableId,
  normalizeString,
  readEnv,
  respond,
  resolveOrgId,
  resolveTenantClient,
} from '../_shared/org-bff.js';
import { parseJsonBodyWithLimit } from '../_shared/validation.js';
import { isYmdDate } from '../_shared/employee-finance.js';
import { assertAgorot, FINANCE_LIMITS } from '../_shared/currency.js';
import {
  assignLessonParticipantCommitment,
  clearLessonParticipantCommitment,
} from '../_shared/student-billing.js';

const MAX_BODY_BYTES = 64 * 1024;

const VALID_CREDIT_TYPES = new Set(['manual_topup', 'commitment_creation', 'transfer_received', 'hmo_authorization_added']);
const VALID_DEBIT_TYPES = new Set(['standard', 'double', 'cross_service', 'manual_adjustment']);
const MANUAL_ENTRY_TYPES = new Set(['manual_topup', 'manual_adjustment']);

function normalizeInvoiceLink(value) {
  const trimmedValue = normalizeString(value);
  if (!trimmedValue) {
    return { value: null, error: null };
  }

  const candidate = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmedValue)
    ? trimmedValue
    : `https://${trimmedValue}`;

  try {
    const parsed = new URL(candidate);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { value: null, error: 'invalid_invoice_link' };
    }
    return { value: parsed.toString(), error: null };
  } catch {
    return { value: null, error: 'invalid_invoice_link' };
  }
}

async function resolveLinkedStudentForClientProfile(tenantClient, clientProfileId) {
  const normalizedClientProfileId = normalizeString(clientProfileId);
  if (!normalizedClientProfileId) {
    return null;
  }

  const { data, error } = await tenantClient
    .from('students')
    .select('id')
    .eq('client_profile_id', normalizedClientProfileId)
    .limit(1)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') {
    throw error;
  }

  return data?.id || null;
}

function resolveTransactionFields(body) {
  const direction = normalizeString(body?.direction).toLowerCase();
  const usageType = normalizeString(body?.usage_type).toLowerCase();

  if (direction === 'credit' || VALID_CREDIT_TYPES.has(usageType)) {
    return {
      transaction_type: 'CREDIT',
      usage_type: VALID_CREDIT_TYPES.has(usageType) ? usageType : 'manual_topup',
    };
  }

  return {
    transaction_type: 'DEBIT',
    usage_type: VALID_DEBIT_TYPES.has(usageType) ? usageType : 'manual_adjustment',
  };
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
  let authResult;
  try {
    authResult = await supabase.auth.getUser(authorization.token);
  } catch (authError) {
    context.log?.error?.('consumption-entries failed to validate token', { message: authError?.message });
    return respond(context, 401, { message: 'invalid or expired token' });
  }
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
      .from('ledger_transactions')
      .select('id, client_profile_id, student_id, commitment_id, transaction_type, usage_type, amount, source_ref, invoice_id, invoice_link, notes, created_at, updated_at, metadata')
      .order('created_at', { ascending: false });

    const studentId = normalizeString(req?.query?.student_id);
    const clientProfileId = normalizeString(req?.query?.client_profile_id || req?.query?.clientProfileId);
    const commitmentId = normalizeString(req?.query?.commitment_id);
    const transactionType = normalizeString(req?.query?.transaction_type).toUpperCase();
    const usageType = normalizeString(req?.query?.usage_type).toLowerCase();

    if (studentId) {
      query = query.eq('student_id', studentId);
    }
    if (clientProfileId) {
      query = query.eq('client_profile_id', clientProfileId);
    }
    if (commitmentId) {
      query = query.eq('commitment_id', commitmentId);
    }
    if (transactionType === 'CREDIT' || transactionType === 'DEBIT') {
      query = query.eq('transaction_type', transactionType);
    }
    if (usageType) {
      query = query.eq('usage_type', usageType);
    }

    const { data, error } = await query;
    if (error) {
      context.log?.error?.('ledger-transactions failed to load records', { message: error.message });
      return respond(context, 500, { message: 'failed_to_load_ledger_transactions' });
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

    const result = await assignLessonParticipantCommitment(tenantClient, {
      lessonParticipantId,
      commitmentId,
      actorUserId: userId,
    });

    if (result?.error === 'lesson_participant_not_found' || result?.error === 'commitment_not_found') {
      return respond(context, 404, { message: result.error });
    }
    if (result?.error) {
      return respond(context, 409, { message: result.error });
    }

    return respond(context, 200, result);
  }

  if (method === 'POST' && action === 'clear_participant_commitment') {
    const lessonParticipantId = normalizeString(body?.lesson_participant_id);
    if (!lessonParticipantId) {
      return respond(context, 400, { message: 'missing_lesson_participant_id' });
    }

    const result = await clearLessonParticipantCommitment(tenantClient, {
      lessonParticipantId,
      actorUserId: userId,
    });

    if (result?.error === 'lesson_participant_not_found') {
      return respond(context, 404, { message: result.error });
    }
    if (result?.error) {
      return respond(context, 409, { message: result.error });
    }

    return respond(context, 200, result);
  }

  if ((method === 'POST' || method === 'PUT') && action === 'update_invoice_fields') {
    const id = normalizeString(body?.id);
    if (!id) {
      return respond(context, 400, { message: 'missing_ledger_transaction_id' });
    }

    const invoiceId = normalizeString(body?.invoice_id ?? body?.invoiceId) || null;
    const { value: invoiceLink, error: invoiceLinkError } = normalizeInvoiceLink(body?.invoice_link ?? body?.invoiceLink);
    if (invoiceLinkError) {
      return respond(context, 400, { message: invoiceLinkError });
    }

    const { data, error } = await tenantClient
      .from('ledger_transactions')
      .update({
        invoice_id: invoiceId,
        invoice_link: invoiceLink,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('id, client_profile_id, student_id, commitment_id, transaction_type, usage_type, amount, source_ref, invoice_id, invoice_link, notes, created_at, updated_at, metadata')
      .maybeSingle();

    if (error) {
      context.log?.error?.('ledger-transactions failed to update invoice fields', { message: error.message });
      return respond(context, 500, { message: 'failed_to_update_ledger_transaction' });
    }
    if (!data) {
      return respond(context, 404, { message: 'ledger_transaction_not_found' });
    }

    return respond(context, 200, data);
  }

  if (method === 'POST' || method === 'PUT') {
    const txFields = resolveTransactionFields(body);
    let amount;
    try {
      amount = assertAgorot(Math.abs(Number(body?.amount ?? body?.amount_charged)), 'amount');
    } catch (err) {
      return respond(context, 400, { message: err.message });
    }
    if (amount > FINANCE_LIMITS.MAX_CHARGE_AMOUNT_AGOROT) {
      return respond(context, 400, { message: 'amount_exceeds_maximum' });
    }
    const effectiveDate = normalizeString(body?.effective_date);
    const notes = normalizeString(body?.notes);
    const commitmentId = normalizeString(body?.commitment_id);
    let clientProfileId = normalizeNullableId(body?.client_profile_id ?? body?.clientProfileId) || null;
    let studentId = normalizeNullableId(body?.student_id) || null;
    const invoiceId = normalizeString(body?.invoice_id ?? body?.invoiceId) || null;
    const { value: invoiceLink, error: invoiceLinkError } = normalizeInvoiceLink(body?.invoice_link ?? body?.invoiceLink);
    if (invoiceLinkError) {
      return respond(context, 400, { message: invoiceLinkError });
    }

    if (!MANUAL_ENTRY_TYPES.has(txFields.usage_type)) {
      return respond(context, 400, { message: 'invalid_usage_type_for_manual_entry' });
    }
    if (amount <= 0) {
      return respond(context, 400, { message: 'invalid_amount' });
    }
    if (effectiveDate && !isYmdDate(effectiveDate)) {
      return respond(context, 400, { message: 'invalid_effective_date' });
    }
    if (txFields.usage_type === 'manual_adjustment' && txFields.transaction_type === 'DEBIT' && !notes) {
      return respond(context, 400, { message: 'notes_required_for_adjustment' });
    }
    if (!clientProfileId && !studentId) {
      return respond(context, 400, { message: 'client_profile_id_or_student_id_required' });
    }

    if (commitmentId && !studentId) {
      studentId = await resolveLinkedStudentForClientProfile(tenantClient, clientProfileId);
    }
    if (commitmentId && !studentId) {
      return respond(context, 400, { message: 'commitment_id_required' });
    }
    if (!clientProfileId && studentId) {
      const { data: studentRow, error: studentError } = await tenantClient
        .from('students')
        .select('client_profile_id')
        .eq('id', studentId)
        .maybeSingle();
      if (studentError) {
        context.log?.error?.('ledger-transactions failed to resolve student client profile', { message: studentError.message });
        return respond(context, 500, { message: 'failed_to_resolve_client_profile' });
      }
      if (!studentRow?.client_profile_id) {
        return respond(context, 400, { message: 'client_profile_id_or_student_id_required' });
      }
      clientProfileId = studentRow.client_profile_id;
    }
    const resolvedClientProfileId = clientProfileId;

    const idempotencyKey = normalizeString(body?.idempotency_key) || null;
    const metadataBase = body?.metadata && typeof body.metadata === 'object' ? body.metadata : {};

    const payload = {
      client_profile_id: resolvedClientProfileId,
      student_id: studentId,
      commitment_id: commitmentId || null,
      transaction_type: txFields.transaction_type,
      usage_type: txFields.usage_type,
      amount,
      source_ref: null,
      invoice_id: invoiceId,
      invoice_link: invoiceLink,
      notes: notes || null,
      updated_at: new Date().toISOString(),
      metadata: {
        ...metadataBase,
        effective_date: effectiveDate || null,
        transfer_ref: normalizeString(body?.transfer_ref) || null,
        ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
      },
    };

    if (method === 'POST') {
      // Idempotency: return existing record if the same key was already processed
      if (idempotencyKey) {
        const { data: existing } = await tenantClient
          .from('ledger_transactions')
          .select('id, client_profile_id, student_id, commitment_id, transaction_type, usage_type, amount, source_ref, invoice_id, invoice_link, notes, created_at, updated_at, metadata')
          .filter('metadata->>idempotency_key', 'eq', idempotencyKey)
          .maybeSingle();
        if (existing) {
          return respond(context, 200, existing);
        }
      }

      payload.created_at = new Date().toISOString();
      const { data, error } = await tenantClient
        .from('ledger_transactions')
        .insert(payload)
        .select('id, client_profile_id, student_id, commitment_id, transaction_type, usage_type, amount, source_ref, invoice_id, invoice_link, notes, created_at, updated_at, metadata')
        .single();

      if (error) {
        context.log?.error?.('ledger-transactions failed to create record', { message: error.message });
        return respond(context, 500, { message: 'failed_to_create_ledger_transaction' });
      }

      return respond(context, 201, data);
    }

    const id = normalizeString(body?.id);
    if (!id) {
      return respond(context, 400, { message: 'missing_ledger_transaction_id' });
    }

    const { data, error } = await tenantClient
      .from('ledger_transactions')
      .update(payload)
      .eq('id', id)
      .select('id, client_profile_id, student_id, commitment_id, transaction_type, usage_type, amount, source_ref, invoice_id, invoice_link, notes, created_at, updated_at, metadata')
      .maybeSingle();

    if (error) {
      context.log?.error?.('ledger-transactions failed to update record', { message: error.message });
      return respond(context, 500, { message: 'failed_to_update_ledger_transaction' });
    }
    if (!data) {
      return respond(context, 404, { message: 'ledger_transaction_not_found' });
    }

    return respond(context, 200, data);
  }

  if (method === 'DELETE') {
    const id = normalizeString(body?.id);
    if (!id) {
      return respond(context, 400, { message: 'missing_ledger_transaction_id' });
    }

    const { data, error } = await tenantClient
      .from('ledger_transactions')
      .delete()
      .eq('id', id)
      .select('id')
      .maybeSingle();

    if (error) {
      context.log?.error?.('ledger-transactions failed to delete record', { message: error.message });
      return respond(context, 500, { message: 'failed_to_delete_ledger_transaction' });
    }
    if (!data) {
      return respond(context, 404, { message: 'ledger_transaction_not_found' });
    }

    return respond(context, 200, { id, deleted: true });
  }

  return respond(context, 405, { message: 'method not allowed' });
}
