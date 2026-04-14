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
import BillingLedgerService from '../_shared/BillingLedgerService.js';
import {
  fetchBillingSnapshot,
  reconcileStudentBilling,
} from '../_shared/student-billing.js';

const MAX_BODY_BYTES = 96 * 1024;

function currentMonthRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const toKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return {
    startDate: toKey(start),
    endDate: toKey(end),
  };
}

function mapBillingActionError(errorCode) {
  switch (errorCode) {
    case 'invoice_batch_not_found':
      return { status: 404, body: { message: errorCode } };
    case 'missing_student_id':
    case 'invalid_manual_credit_source_type':
    case 'invalid_manual_debit_source_type':
      return { status: 400, body: { message: errorCode } };
    default:
      return { status: 400, body: { message: errorCode || 'invalid_billing_action' } };
  }
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
    context.log?.error?.('billing failed to validate token', { message: authError?.message });
    return respond(context, 401, { message: 'invalid or expired token' });
  }
  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  const userId = authResult.data.user.id;
  const body = method === 'GET'
    ? {}
    : parseJsonBodyWithLimit(req, MAX_BODY_BYTES, { mode: 'observe', context, endpoint: 'billing' });
  const orgId = resolveOrgId(req, body);
  if (!orgId) {
    return respond(context, 400, { message: 'invalid org id' });
  }

  let role = null;
  try {
    role = await ensureMembership(supabase, orgId, userId);
  } catch (membershipError) {
    context.log?.error?.('billing failed to verify membership', { message: membershipError?.message });
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

  const billingService = new BillingLedgerService({ tenantClient });

  if (method === 'GET') {
    const studentId = normalizeString(req?.query?.student_id);
    const clientProfileId = normalizeString(req?.query?.client_profile_id || req?.query?.clientProfileId);
    const hmoProviderId = normalizeString(req?.query?.hmo_provider_id || req?.query?.hmoProviderId);
    let startDate = normalizeString(req?.query?.start_date);
    let endDate = normalizeString(req?.query?.end_date);

    if (!studentId && !clientProfileId && !hmoProviderId && !startDate && !endDate) {
      const currentRange = currentMonthRange();
      startDate = currentRange.startDate;
      endDate = currentRange.endDate;
    }

    const snapshot = hmoProviderId
      ? await billingService.getHmoProviderReceivablesSnapshot({
        hmoProviderId,
        periodStart: startDate || null,
        periodEnd: endDate || null,
      })
      : await fetchBillingSnapshot(tenantClient, {
        studentId,
        clientProfileId,
        startDate,
        endDate,
      });

    return respond(context, 200, snapshot);
  }

  if (!isAdminRole(role)) {
    return respond(context, 403, { message: 'forbidden' });
  }

  const action = normalizeString(body?.action).toLowerCase();

  if (method === 'POST' && action === 'reconcile_student_billing') {
    const result = await reconcileStudentBilling(tenantClient, {
      studentId: normalizeNullableId(body?.student_id),
      startDate: normalizeString(body?.start_date),
      endDate: normalizeString(body?.end_date),
      actorUserId: userId,
    });

    if (result?.error) {
      const mapped = mapBillingActionError(result.error);
      return respond(context, mapped.status, mapped.body);
    }

    return respond(context, 200, result);
  }

  try {
    if (method === 'POST' && action === 'append_manual_credit') {
      const result = await billingService.appendManualCredit({
        accountType: normalizeString(body?.account_type),
        accountRefId: normalizeString(body?.account_ref_id),
        amount: body?.amount,
        effectiveAt: normalizeString(body?.effective_at),
        actorUserId: userId,
        sourceType: normalizeString(body?.source_type),
        sourceId: normalizeString(body?.source_id) || null,
        externalReference: normalizeString(body?.external_reference) || null,
        notes: normalizeString(body?.notes) || null,
        metadata: body?.metadata && typeof body.metadata === 'object' ? body.metadata : {},
      });
      return respond(context, 201, result);
    }

    if (method === 'POST' && action === 'append_manual_debit') {
      const result = await billingService.appendManualDebit({
        accountType: normalizeString(body?.account_type),
        accountRefId: normalizeString(body?.account_ref_id),
        amount: body?.amount,
        effectiveAt: normalizeString(body?.effective_at),
        actorUserId: userId,
        sourceType: normalizeString(body?.source_type),
        sourceId: normalizeString(body?.source_id) || null,
        externalReference: normalizeString(body?.external_reference) || null,
        notes: normalizeString(body?.notes) || null,
        metadata: body?.metadata && typeof body.metadata === 'object' ? body.metadata : {},
      });
      return respond(context, 201, result);
    }

    if (method === 'POST' && action === 'reverse_transaction') {
      const result = await billingService.reverseTransaction({
        transactionId: normalizeString(body?.transaction_id),
        actorUserId: userId,
        reasonCode: normalizeString(body?.reason_code) || 'manual_reversal',
        effectiveAt: normalizeString(body?.effective_at) || null,
        notes: normalizeString(body?.notes) || null,
        sourceId: normalizeString(body?.source_id) || null,
        metadata: body?.metadata && typeof body.metadata === 'object' ? body.metadata : {},
      });
      return respond(context, 201, result);
    }

    if (method === 'POST' && action === 'create_hmo_invoice_batch') {
      const result = await billingService.createHmoInvoiceBatch({
        hmoProviderId: normalizeString(body?.hmo_provider_id),
        periodStart: normalizeString(body?.period_start) || null,
        periodEnd: normalizeString(body?.period_end) || null,
        actorUserId: userId,
        externalReference: normalizeString(body?.external_reference) || null,
        externalLink: normalizeString(body?.external_link) || null,
        notes: normalizeString(body?.notes) || null,
      });
      return respond(context, 201, result);
    }

    if (method === 'POST' && action === 'record_hmo_invoice_batch_payment') {
      const result = await billingService.recordHmoInvoiceBatchPayment({
        batchId: normalizeString(body?.batch_id),
        amount: body?.amount,
        effectiveAt: normalizeString(body?.effective_at) || null,
        actorUserId: userId,
        externalReference: normalizeString(body?.external_reference) || null,
        notes: normalizeString(body?.notes) || null,
        metadata: body?.metadata && typeof body.metadata === 'object' ? body.metadata : {},
      });
      return respond(context, 201, result);
    }
  } catch (error) {
    const mapped = mapBillingActionError(error?.message || error?.code);
    return respond(context, mapped.status, mapped.body);
  }

  return respond(context, 405, { message: 'method not allowed' });
}
