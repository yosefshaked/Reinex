/* eslint-env node */
/**
 * POST /api/org-purge/prepare
 *
 * Step 1 of the two-step org purge workflow.
 *
 * Responsibilities:
 *   1. Verify the caller is an AAL2 system admin.
 *   2. Validate org_id is a known, non-tombstoned org.
 *   3. Run the seven drift checks (C1–C7).  Any blocking check returns 400.
 *   4. Collect preflight row counts for all 47 manifest tables.
 *   5. Count storage files (Documents.path values) for the org.
 *   6. Generate an HMAC-SHA256 challenge token (15-min TTL).
 *   7. Persist the plan into active_routing (category='org_purge_plan');
 *      the inserted row's id becomes the plan_id returned to the caller.
 *      routing_info stores { org_name, row_counts, challenge_hash } where
 *      challenge_hash = SHA-256(challenge_token). The raw token is never stored.
 *   8. Return the full prepare response including counts and any C3 drift warnings.
 *
 * State management: active_routing was chosen over the process-local Map because
 * Azure Function hosts are stateless and requests may be routed to different
 * instances. active_routing already holds other short-lived transient state
 * (form OTP flows), has an expires_at index, and its FK to organizations
 * provides natural org scoping. The 'org_purge_plan' category tag keeps these
 * rows isolated from normal form OTP rows.
 *
 * See README Sections 6, 7, and 10 for the full contract.
 */

import { createHash } from 'node:crypto';
import { resolveBearerAuthorization } from '../../_shared/http.js';
import {
  createSingleClient,
  ensureSystemAdmin,
  isValidOrgId,
  parseRequestBody,
  readEnv,
  respond,
} from '../../_shared/org-bff.js';
import { runDriftChecks } from '../drift-check.js';
import { generateChallenge } from '../challenge.js';
import { MANIFEST_VERSION } from '../purge-manifest.js';

const PLAN_TTL_MS = 15 * 60 * 1000; // 15 minutes — matches challenge TTL exactly
const ACTIVE_ROUTING_CATEGORY = 'org_purge_plan';

// ─── Azure Function handler ───────────────────────────────────────────────────

export default async function preparePurge(context, req) {
  if (req.method !== 'POST') {
    return respond(context, 405, { error: 'METHOD_NOT_ALLOWED' });
  }

  const env = readEnv(context);
  const client = createSingleClient(env);
  const authorization = resolveBearerAuthorization(req);

  // 1. Auth: AAL2 + is_system_admin.
  let admin;
  try {
    admin = await ensureSystemAdmin(req, client, authorization, { context });
  } catch (err) {
    return respond(context, err.statusCode ?? 403, { error: err.message });
  }

  // 2. Parse + validate request body.
  const body = parseRequestBody(req);
  const orgId = typeof body?.org_id === 'string' ? body.org_id.trim() : '';
  const forceSkipBackupCheck = body?.force_skip_backup_check === true;

  if (!isValidOrgId(orgId)) {
    return respond(context, 400, { error: 'INVALID_ORG_ID' });
  }

  const challengeSecret = env.ORG_PURGE_CHALLENGE_SECRET;
  if (!challengeSecret || challengeSecret.length < 32) {
    context.log?.error?.('[org-purge/prepare] ORG_PURGE_CHALLENGE_SECRET is missing or too short');
    return respond(context, 500, { error: 'SERVER_MISCONFIGURED' });
  }

  // 3. Run drift checks (includes org existence check + C7 backup guard).
  let driftResult;
  try {
    driftResult = await runDriftChecks(client, orgId, { forceSkipBackupCheck, env });
  } catch (err) {
    context.log?.error?.('[org-purge/prepare] drift check threw', { message: err?.message });
    return respond(context, 500, { error: 'INTERNAL_ERROR', detail: err?.message });
  }

  // Org not found is surfaced through C7 as a blocking check.
  if (!driftResult.passed) {
    // Distinguish "org not found" for a cleaner 404.
    const notFound = driftResult.blocking.find(c => c.check === 'C7_ORG_NOT_FOUND');
    if (notFound) {
      return respond(context, 404, { error: 'ORG_NOT_FOUND' });
    }
    // Already tombstoned — specific 409.
    const alreadyPurged = driftResult.blocking.find(c => c.check === 'C7_ORG_ALREADY_PURGED');
    if (alreadyPurged) {
      return respond(context, 409, { error: 'ORG_ALREADY_PURGED', tombstone_name: alreadyPurged.tombstone_name });
    }
    return respond(context, 400, { error: 'DRIFT_CHECK_FAILED', checks: driftResult.blocking });
  }

  const orgName = driftResult.orgName;
  const rowCounts = driftResult.rowCounts;

  // 4. Count storage files (Documents rows with a non-null path).
  let storageFileCount = 0;
  try {
    const { count } = await client
      .from('Documents')
      .select('*', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .not('path', 'is', null);
    storageFileCount = count ?? 0;
  } catch {
    // Non-fatal; zero is a safe default.
    storageFileCount = rowCounts['Documents'] ?? 0;
  }

  // 5. Generate challenge token, then persist the plan to active_routing.
  //    The inserted row's auto-generated UUID becomes the plan_id.
  //    We first generate a placeholder challenge (planId unknown), then insert the row,
  //    then regenerate the challenge with the real planId from the DB.
  const expiresAt = new Date(Date.now() + PLAN_TTL_MS).toISOString();

  // Insert the plan row first to obtain the DB-assigned plan_id (= active_routing.id).
  const { data: planRow, error: planInsertError } = await client
    .from('active_routing')
    .insert({
      org_id:       orgId,
      category:     ACTIVE_ROUTING_CATEGORY,
      routing_info: { org_name: orgName, row_counts: rowCounts, challenge_hash: null },
      expires_at:   expiresAt,
      created_by:   admin.userId,
    })
    .select('id')
    .single();

  if (planInsertError || !planRow?.id) {
    context.log?.error?.('[org-purge/prepare] failed to insert plan row', { message: planInsertError?.message });
    return respond(context, 500, { error: 'INTERNAL_ERROR', detail: 'plan_persist_failed' });
  }

  const planId = planRow.id;

  // Now generate the challenge with the real planId, then hash it and update the row.
  const { challenge, expiresAt: challengeExpiresAt } = generateChallenge(planId, orgId, challengeSecret);
  const challengeHash = createHash('sha256').update(challenge).digest('hex');

  const { error: updateError } = await client
    .from('active_routing')
    .update({ routing_info: { org_name: orgName, row_counts: rowCounts, challenge_hash: challengeHash } })
    .eq('id', planId);

  if (updateError) {
    // Non-critical: the row was inserted; clean up and surface the error.
    await client.from('active_routing').delete().eq('id', planId);
    context.log?.error?.('[org-purge/prepare] failed to store challenge hash', { message: updateError.message });
    return respond(context, 500, { error: 'INTERNAL_ERROR', detail: 'challenge_persist_failed' });
  }

  context.log?.info?.('[org-purge/prepare] plan persisted to active_routing', {
    planId,
    orgId,
    adminId: admin.userId,
    expiresAt: challengeExpiresAt,
  });

  return respond(context, 200, {
    plan_id:              planId,
    org_id:               orgId,
    org_name:             orgName,
    challenge,
    challenge_expires_at: challengeExpiresAt,
    row_counts:           rowCounts,
    drift_warnings:       driftResult.warnings,
    manifest_version:     MANIFEST_VERSION,
    storage_file_count:   storageFileCount,
  });
}
