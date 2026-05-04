/**
 * Challenge token module (M3).
 *
 * Generates and verifies short-lived HMAC-SHA256 challenge tokens for the org-purge
 * two-step workflow. A challenge binds a specific plan_id + org_id to a 15-minute window.
 *
 * Token encoding:
 *   base64url( JSON( { payload: "<planId>:<orgId>:<ts>", sig: "<hex>", ts: <ms> } ) )
 *
 * Security properties:
 * - HMAC keyed with ORG_PURGE_CHALLENGE_SECRET (≥32 chars).
 * - Constant-time comparison prevents timing-attack signature forgery.
 * - Encoded payload carries ts so the execute endpoint does not need external state to
 *   verify expiry; the sig covers ts so ts cannot be altered after issuance.
 *
 * See README Section 10 for the full contract.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';

const CHALLENGE_TTL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Generate a challenge token.
 *
 * @param {string} planId - UUID of the prepare plan.
 * @param {string} orgId  - UUID of the org to be purged.
 * @param {string} secret - Value of ORG_PURGE_CHALLENGE_SECRET env var.
 * @returns {{ challenge: string, expiresAt: string }}
 */
export function generateChallenge(planId, orgId, secret) {
  if (!secret || secret.length < 32) {
    throw new Error('ORG_PURGE_CHALLENGE_SECRET must be at least 32 characters.');
  }

  const ts = Date.now();
  const payload = `${planId}:${orgId}:${ts}`;
  const sig = createHmac('sha256', secret).update(payload).digest('hex');

  const token = Buffer.from(JSON.stringify({ payload, sig, ts })).toString('base64url');
  const expiresAt = new Date(ts + CHALLENGE_TTL_MS).toISOString();

  return { challenge: token, expiresAt };
}

/**
 * Verify a challenge token received in the execute request.
 *
 * @param {string} token  - The challenge string from the prepare response.
 * @param {string} planId - plan_id from the execute request body.
 * @param {string} orgId  - org_id extracted from the plan in the process-local plan cache.
 * @param {string} secret - Value of ORG_PURGE_CHALLENGE_SECRET env var.
 * @returns {{ valid: true } | { valid: false, reason: string }}
 */
export function verifyChallenge(token, planId, orgId, secret) {
  if (!secret) {
    return { valid: false, reason: 'CHALLENGE_INVALID' };
  }

  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
  } catch {
    return { valid: false, reason: 'CHALLENGE_INVALID' };
  }

  const { payload, sig, ts } = parsed;

  // Type guards before any crypto work.
  if (typeof payload !== 'string' || typeof sig !== 'string' || typeof ts !== 'number') {
    return { valid: false, reason: 'CHALLENGE_INVALID' };
  }

  // Expiry check (uses the embedded ts — payload authenticity is verified next).
  if (Date.now() - ts > CHALLENGE_TTL_MS) {
    return { valid: false, reason: 'CHALLENGE_EXPIRED' };
  }

  // Payload must encode the exact plan_id and org_id presented in the execute body.
  const expectedPayload = `${planId}:${orgId}:${ts}`;
  if (payload !== expectedPayload) {
    return { valid: false, reason: 'CHALLENGE_INVALID' };
  }

  // Constant-time HMAC comparison — prevents timing attacks.
  const expectedSig = createHmac('sha256', secret).update(payload).digest('hex');

  let sigBuf, expectedBuf;
  try {
    sigBuf = Buffer.from(sig, 'hex');
    expectedBuf = Buffer.from(expectedSig, 'hex');
  } catch {
    return { valid: false, reason: 'CHALLENGE_INVALID' };
  }

  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    return { valid: false, reason: 'CHALLENGE_INVALID' };
  }

  return { valid: true };
}
