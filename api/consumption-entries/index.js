// @ts-check
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
import BillingLedgerService from '../_shared/BillingLedgerService.js';

const MAX_BODY_BYTES = 48 * 1024;

function normalizeAccountRequest(body = {}) {
  const accountType = normalizeString(body?.account_type).toLowerCase()
    || (normalizeString(body?.student_id) ? 'student' : 'client_profile');
  const accountRefId = normalizeString(body?.account_ref_id)
    || normalizeString(body?.student_id)
    || normalizeString(body?.client_profile_id)
    || normalizeString(body?.clientProfileId);
  return { accountType, accountRefId };
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
  } catch {
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

  const role = await ensureMembership(supabase, orgId, userId);
  if (!role || !isAdminOrOffice(role)) {
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
    const snapshot = studentId
      ? await billingService.getStudentBillingSnapshot({ studentId })
      : await billingService.getClientBillingSnapshot({ clientProfileId });
    return respond(context, 200, { entries: snapshot.ledger_entries || [] });
  }

  if (!isAdminRole(role)) {
    return respond(context, 403, { message: 'forbidden' });
  }

  try {
    if (method === 'POST') {
      const action = normalizeString(body?.action).toLowerCase();
      if (action === 'reverse_transaction') {
        const result = await billingService.reverseTransaction({
          transactionId: normalizeString(body?.transaction_id || body?.id),
          actorUserId: userId,
          reasonCode: normalizeString(body?.reason_code) || 'manual_reversal',
          effectiveAt: normalizeString(body?.effective_date || body?.effective_at) || null,
          notes: normalizeString(body?.notes) || null,
        });
        return respond(context, 201, result);
      }

      const { accountType, accountRefId } = normalizeAccountRequest(body);
      const direction = normalizeString(body?.direction).toLowerCase();
      const payload = {
        accountType,
        accountRefId,
        amount: body?.amount ?? body?.amount_charged,
        effectiveAt: normalizeString(body?.effective_date || body?.effective_at) || null,
        actorUserId: userId,
        sourceType: direction === 'debit' ? 'manual_adjustment' : 'manual_payment',
        externalReference: normalizeString(body?.external_reference || body?.invoice_id || body?.invoiceId) || null,
        notes: normalizeString(body?.notes) || null,
        metadata: body?.metadata && typeof body.metadata === 'object' ? body.metadata : {},
      };

      const result = direction === 'debit'
        ? await billingService.appendManualDebit(payload)
        : await billingService.appendManualCredit(payload);
      return respond(context, 201, result);
    }

    if (method === 'DELETE') {
      const result = await billingService.reverseTransaction({
        transactionId: normalizeString(body?.transaction_id || body?.id),
        actorUserId: userId,
        reasonCode: 'deleted_via_ui',
        notes: 'UI requested reversal of manual entry',
      });
      return respond(context, 200, result);
    }
  } catch (error) {
    return respond(context, 400, { message: error?.message || 'invalid_consumption_entry_request' });
  }

  return respond(context, 405, { message: 'method not allowed' });
}
