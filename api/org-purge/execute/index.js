/* eslint-env node */
/**
 * POST /api/org-purge/execute
 *
 * Step 2 of the two-step org purge workflow. IRREVERSIBLE.
 *
 * Responsibilities:
 *   1. Verify the caller is an AAL2 system admin.
 *   2. Fetch the plan from active_routing by plan_id + category='org_purge_plan'.
 *   3. Enforce expiry (expires_at check).
 *   4. Verify the challenge: SHA-256(incoming_token) must match routing_info.challenge_hash.
 *   5. DELETE the active_routing row immediately (single-use — on success OR failure).
 *   6. Re-resolve the live org name and check org_name_confirm matches (human gate).
 *   7. Acquire a pg_advisory_lock keyed on org_id to prevent concurrent executes.
 *   8. Re-run drift checks to catch schema changes in the last 15 minutes.
 *   9. Execute phases 1–14 sequentially:
 *        Phase 1–13 + 14.1–14.3: hard DELETE per manifest entry.
 *        Phase 8.1: delete Supabase Storage files before DB rows.
 *        Phase 14.4: tombstone UPDATE on organizations row.
 *  10. Write the permanent audit_log entry (org_id = tombstone UUID — FK is valid).
 *  11. Release the advisory lock.
 *  12. Return the full execute response.
 *
 * See README Sections 6, 7, 9, and 14 for the full contract.
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
import { logAuditEvent } from '../../_shared/audit-log.js';
import { runDriftChecks } from '../drift-check.js';
import { executePhases } from '../execute-phases.js';
import { MANIFEST_VERSION } from '../purge-manifest.js';

const ACTIVE_ROUTING_CATEGORY = 'org_purge_plan';

// ─── Advisory lock helpers ────────────────────────────────────────────────────

/**
 * Derive a stable int64 lock key from the org UUID.
 * Takes the first 16 hex characters (= 8 bytes = signed int64 range).
 */
function orgIdToLockKey(orgId) {
  return BigInt('0x' + orgId.replace(/-/g, '').slice(0, 16));
}

/**
 * Acquire a pg_advisory_lock via Supabase RPC.
 * Returns true if acquired, false if an error occurred (including lock contention).
 *
 * pg_try_advisory_lock returns true/false immediately (non-blocking).
 * We use try_lock so we can return 409 immediately rather than hanging the request.
 */
async function tryAcquireAdvisoryLock(client, orgId) {
  const lockKey = orgIdToLockKey(orgId);
  try {
    const { data, error } = await client.rpc('pg_try_advisory_lock', { key: lockKey });
    if (error) {
      console.error('[org-purge/execute] pg_try_advisory_lock error:', error.message);
      return false;
    }
    return data === true;
  } catch (err) {
    console.error('[org-purge/execute] pg_try_advisory_lock threw:', err?.message);
    return false;
  }
}

async function releaseAdvisoryLock(client, orgId) {
  const lockKey = orgIdToLockKey(orgId);
  try {
    await client.rpc('pg_advisory_unlock', { key: lockKey });
  } catch (err) {
    // Non-fatal — the lock will expire with the DB connection anyway.
    console.error('[org-purge/execute] pg_advisory_unlock threw:', err?.message);
  }
}

// ─── Azure Function handler ───────────────────────────────────────────────────

export default async function executePurge(context, req) {
  if (req.method !== 'POST') {
    return respond(context, 405, { error: 'METHOD_NOT_ALLOWED' });
  }

  const startTime = Date.now();
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
  const planId = typeof body?.plan_id === 'string' ? body.plan_id.trim() : '';
  const challengeToken = typeof body?.challenge === 'string' ? body.challenge.trim() : '';
  const orgNameConfirm = typeof body?.org_name_confirm === 'string' ? body.org_name_confirm : '';

  if (!isValidOrgId(planId)) {
    return respond(context, 400, { error: 'EXECUTE_VALIDATION_FAILED', reason: 'PLAN_NOT_FOUND' });
  }
  if (!challengeToken || !orgNameConfirm) {
    return respond(context, 400, { error: 'EXECUTE_VALIDATION_FAILED', reason: 'MISSING_FIELDS' });
  }

  const challengeSecret = env.ORG_PURGE_CHALLENGE_SECRET;
  if (!challengeSecret || challengeSecret.length < 32) {
    context.log?.error?.('[org-purge/execute] ORG_PURGE_CHALLENGE_SECRET is missing or too short');
    return respond(context, 500, { error: 'SERVER_MISCONFIGURED' });
  }

  // 3. Fetch plan from active_routing (single DB read, works across all instances).
  const { data: planRow, error: planFetchError } = await client
    .from('active_routing')
    .select('id, org_id, routing_info, expires_at')
    .eq('id', planId)
    .eq('category', ACTIVE_ROUTING_CATEGORY)
    .maybeSingle();

  if (planFetchError || !planRow) {
    return respond(context, 400, { error: 'EXECUTE_VALIDATION_FAILED', reason: 'PLAN_NOT_FOUND' });
  }

  // 4. Enforce expiry.
  if (new Date(planRow.expires_at).getTime() < Date.now()) {
    // Clean up the stale row as a courtesy (best-effort).
    await client.from('active_routing').delete().eq('id', planId);
    return respond(context, 400, { error: 'EXECUTE_VALIDATION_FAILED', reason: 'CHALLENGE_EXPIRED' });
  }

  const orgId = planRow.org_id;
  const storedHash = planRow.routing_info?.challenge_hash;
  const storedRowCounts = planRow.routing_info?.row_counts ?? {};

  // 5. Compare SHA-256(incoming challenge) against the stored hash.
  //    The row is deleted REGARDLESS of whether validation passes — single-use enforcement.
  const incomingHash = createHash('sha256').update(challengeToken).digest('hex');
  const challengeValid = typeof storedHash === 'string' && incomingHash === storedHash;

  // Atomic single-use: delete the plan row before proceeding (prevents replay on any outcome).
  const { error: deleteError } = await client
    .from('active_routing')
    .delete()
    .eq('id', planId);

  if (deleteError) {
    // Log but continue — the row will expire naturally; the hash check is still the gate.
    context.log?.warn?.('[org-purge/execute] failed to delete plan row', { message: deleteError.message });
  }

  if (!challengeValid) {
    return respond(context, 400, { error: 'EXECUTE_VALIDATION_FAILED', reason: 'CHALLENGE_INVALID' });
  }

  // 6. Org name confirmation — re-query the live org to get the current name.
  // This is the final human gate before irreversible deletion.
  const { data: liveOrg, error: orgQueryError } = await client
    .from('organizations')
    .select('id, name')
    .eq('id', orgId)
    .maybeSingle();

  if (orgQueryError || !liveOrg) {
    return respond(context, 404, { error: 'ORG_NOT_FOUND' });
  }

  if (liveOrg.name.startsWith('PURGED:')) {
    return respond(context, 409, { error: 'ORG_ALREADY_PURGED' });
  }

  // Exact case-sensitive match required.
  if (orgNameConfirm !== liveOrg.name) {
    return respond(context, 400, {
      error: 'EXECUTE_VALIDATION_FAILED',
      reason: 'ORG_NAME_MISMATCH',
    });
  }

  const orgName = liveOrg.name; // Canonical name captured before tombstone.

  // 6. Acquire advisory lock to prevent concurrent executes for the same org.
  const lockAcquired = await tryAcquireAdvisoryLock(client, orgId);
  if (!lockAcquired) {
    return respond(context, 409, {
      error: 'ORG_PURGE_IN_PROGRESS',
      hint: 'Another purge for this org is currently running. Wait and retry.',
    });
  }

  try {
    // 7. Re-run drift checks to catch schema changes in the last 15 minutes.
    //    Backup guard is force-skipped here (it was already validated at prepare time).
    const reDriftResult = await runDriftChecks(client, orgId, { forceSkipBackupCheck: true });
    if (!reDriftResult.passed) {
      context.log?.warn?.('[org-purge/execute] re-drift check failed', reDriftResult.blocking);
      return respond(context, 400, {
        error: 'DRIFT_CHECK_FAILED',
        hint: 'Schema drift was detected since the prepare call. Re-run prepare.',
        checks: reDriftResult.blocking,
      });
    }

    // 8. Execute all 14 phases (phases 1–13 hard delete, 8 storage-aware, 14 tombstone).
    context.log?.info?.('[org-purge/execute] starting phase runner', { orgId, planId, adminId: admin.userId });

    const { deletedCounts, tombstonedOrg, phaseErrors, storage } =
      await executePhases(client, orgId, orgName, env);

    // 9. Write the permanent audit_log entry.
    //    org_id = tombstone UUID (the row still exists, FK is valid).
    let auditLogEventId = null;
    try {
      auditLogEventId = await logAuditEvent(client, {
        orgId,               // FK resolves to the tombstone row.
        userId:    admin.userId,
        userEmail: admin.email,
        userRole:  'system_admin',
        actionType:     'system_admin.org_purge_executed',
        actionCategory: 'admin_control',
        resourceType:   'organization',
        resourceId:     orgId,
        details: {
          original_org_name:    orgName,
          tombstone_name:       tombstonedOrg.tombstoneName,
          tombstone_slug:       tombstonedOrg.tombstoneSlug,
          manifest_version:     MANIFEST_VERSION,
          deleted_counts:       deletedCounts,
          storage_attempted:    storage.attempted,
          storage_deleted:      storage.deleted,
          storage_failed:       storage.failed,
          storage_failed_paths: storage.failedPaths,
          phase_errors:         phaseErrors,
          before_state: {
            original_org_name: orgName,
            row_counts:        storedRowCounts,
          },
        },
      });
    } catch (auditErr) {
      // Audit failure must NEVER block the response — the purge already happened.
      context.log?.error?.('[org-purge/execute] audit log failed', { message: auditErr?.message });
    }

    // 10. (Plan already consumed in step 5 via DB DELETE.)

    const durationMs = Date.now() - startTime;

    context.log?.info?.('[org-purge/execute] completed', {
      orgId, orgName, durationMs, planId, adminId: admin.userId,
      phaseErrorCount: phaseErrors.length,
      storageFailures: storage.failed,
    });

    return respond(context, 200, {
      org_id:           orgId,
      org_name:         orgName,
      purged_at:        new Date().toISOString(),
      duration_ms:      durationMs,
      manifest_version: MANIFEST_VERSION,
      deleted_counts:   deletedCounts,
      tombstoned_org: {
        id:             tombstonedOrg.id,
        original_name:  tombstonedOrg.originalName,
        tombstone_name: tombstonedOrg.tombstoneName,
        tombstone_slug: tombstonedOrg.tombstoneSlug,
      },      storage: {
        files_attempted: storage.attempted,
        files_deleted:   storage.deleted,
        files_failed:    storage.failed,
        failed_paths:    storage.failedPaths,
      },
      phase_errors:      phaseErrors,
      audit_log_event_id: auditLogEventId,
    });

  } finally {
    // Always release the advisory lock, even if an error is thrown above.
    await releaseAdvisoryLock(client, orgId);
  }
}
