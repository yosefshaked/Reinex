/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import { ensureSystemAdmin, normalizeString, readEnv, respond } from '../_shared/org-bff.js';
import { respondTrackedError } from '../_shared/error-events.js';
import BillingLedgerService from '../_shared/BillingLedgerService.js';

function isUuidLike(value) {
  const normalized = normalizeString(value);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized);
}

function parseClaimIds(rawValue) {
  const normalized = normalizeString(rawValue);
  if (!normalized) return [];
  return Array.from(new Set(normalized
    .split(/[\s,]+/)
    .map((value) => normalizeString(value))
    .filter(Boolean)));
}

export default async function systemAdminAdminTools(context, req) {
  const method = String(req.method || 'GET').toUpperCase();
  if (method !== 'GET') {
    return respond(context, 405, { message: 'method_not_allowed' });
  }

  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);
  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('system-admin-admin-tools: missing Supabase admin credentials');
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    return respond(context, 401, { message: 'missing_bearer_token' });
  }

  const supabase = createSupabaseAdminClient(adminConfig);

  let admin = null;
  try {
    admin = await ensureSystemAdmin(req, supabase, authorization, { context });
  } catch (err) {
    return respond(context, err.statusCode || 403, { message: err.message || 'forbidden' });
  }

  const tool = normalizeString(req?.query?.tool).toLowerCase() || 'hmo_claim_readiness';
  if (tool !== 'hmo_claim_readiness') {
    return respond(context, 400, { message: 'unsupported_admin_tool' });
  }

  const orgId = normalizeString(req?.query?.org_id || req?.query?.orgId);
  const lessonParticipantId = normalizeString(req?.query?.lesson_participant_id || req?.query?.lessonParticipantId);
  const hmoProviderId = normalizeString(req?.query?.hmo_provider_id || req?.query?.hmoProviderId);
  const requestedClaimIds = parseClaimIds(req?.query?.claim_ids || req?.query?.claimIds);

  if (!isUuidLike(orgId)) {
    return respond(context, 400, { message: 'invalid_org_id' });
  }
  if (!lessonParticipantId && !hmoProviderId && requestedClaimIds.length === 0) {
    return respond(context, 400, { message: 'missing_hmo_claim_inspection_target' });
  }
  if (lessonParticipantId && !isUuidLike(lessonParticipantId)) {
    return respond(context, 400, { message: 'invalid_lesson_participant_id' });
  }
  if (hmoProviderId && !isUuidLike(hmoProviderId)) {
    return respond(context, 400, { message: 'invalid_hmo_provider_id' });
  }

  try {
    const service = new BillingLedgerService({ tenantClient: supabase, orgId });
    const payload = await service.inspectHmoClaimReadiness({
      lessonParticipantId,
      hmoProviderId,
      requestedClaimIds,
    });

    return respond(context, 200, {
      tool: 'hmo_claim_readiness',
      inputs: {
        org_id: orgId,
        lesson_participant_id: lessonParticipantId || null,
        hmo_provider_id: hmoProviderId || null,
        claim_ids: requestedClaimIds,
      },
      ...payload,
      checked_at: new Date().toISOString(),
    });
  } catch (error) {
    context.log?.error?.('system-admin-admin-tools: hmo_claim_readiness failed', {
      message: error?.message,
      orgId,
      lessonParticipantId,
      hmoProviderId,
      claimCount: requestedClaimIds.length,
    });
    return respondTrackedError(context, req, supabase, {
      status: 500,
      message: 'failed_to_run_admin_tool',
      userId: admin?.userId,
      error,
      metadata: {
        tool: 'hmo_claim_readiness',
        org_id: orgId,
        lesson_participant_id: lessonParticipantId,
      },
    });
  }
}
