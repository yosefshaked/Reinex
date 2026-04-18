import { authenticatedFetch } from '@/lib/api-client.js';
import { getAuthClient } from '@/lib/supabase-manager.js';

/**
 * Impersonation client — handles the browser-side dance of:
 *   1. Stashing the admin's current Supabase session in sessionStorage
 *   2. Swapping the session to the target user via verifyOtp({ token_hash })
 *   3. On exit: calling the exit endpoint with the stashed admin token, then
 *      restoring the admin session via setSession()
 *
 * The impersonation metadata is stored in sessionStorage (not localStorage)
 * so it does not outlive the tab. Every action is server-audited regardless.
 */

export const STASH_KEY = 'reinex_impersonation_v1';

export function readStash() {
  try {
    const raw = window.sessionStorage.getItem(STASH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeStash(stash) {
  try {
    window.sessionStorage.setItem(STASH_KEY, JSON.stringify(stash));
  } catch {
    /* noop */
  }
}

function clearStash() {
  try {
    window.sessionStorage.removeItem(STASH_KEY);
  } catch {
    /* noop */
  }
}

function broadcast() {
  try {
    window.dispatchEvent(new CustomEvent('reinex:impersonation-changed'));
  } catch {
    /* noop */
  }
}

/**
 * Starts an impersonation session.
 *
 * @param {{ targetEmail: string, reason: string, durationMinutes?: number, targetOrgId?: string }} params
 * @returns {Promise<{ sessionId: string, targetEmail: string, targetName: string, targetOrgName: string, expiresAt: string }>}
 */
export async function startImpersonation({ targetEmail, reason, durationMinutes, targetOrgId }) {
  if (!targetEmail || !reason) {
    throw new Error('targetEmail and reason are required');
  }

  // 1. Call backend to mint the magic-link token + record the session.
  const body = {
    target_email: targetEmail,
    reason,
    duration_minutes: durationMinutes,
    target_org_id: targetOrgId,
  };

  const payload = await authenticatedFetch('admin-impersonation-start', {
    method: 'POST',
    body,
  });

  const hashedToken = payload?.hashed_token;
  const sessionId = payload?.session_id;
  if (!hashedToken || !sessionId) {
    throw new Error('Server did not return an impersonation token.');
  }

  // 2. Stash the admin's current Supabase session BEFORE swapping.
  const authClient = getAuthClient();
  const { data: currentSession } = await authClient.auth.getSession();
  const adminSession = currentSession?.session;
  if (!adminSession?.access_token || !adminSession?.refresh_token) {
    throw new Error('Could not capture the current admin session.');
  }

  const stash = {
    sessionId,
    targetEmail: payload.target_email,
    targetName: payload.target_name,
    targetOrgId: payload.target_org_id,
    targetOrgName: payload.target_org_name,
    startedAt: payload.started_at,
    expiresAt: payload.expires_at,
    admin: {
      userId: adminSession.user?.id || null,
      email: adminSession.user?.email || null,
      accessToken: adminSession.access_token,
      refreshToken: adminSession.refresh_token,
    },
  };
  writeStash(stash);

  // 3. Redeem the magic-link token to swap the session in place.
  try {
    const result = await authClient.auth.verifyOtp({
      token_hash: hashedToken,
      type: 'magiclink',
    });
    if (result.error) throw result.error;
  } catch (err) {
    // Swap failed — clear stash and rethrow. The server-side session row is
    // still recorded; it will expire naturally and can be force-ended later.
    clearStash();
    throw new Error(err?.message || 'Failed to redeem impersonation session.');
  }

  broadcast();
  return {
    sessionId,
    targetEmail: payload.target_email,
    targetName: payload.target_name,
    targetOrgName: payload.target_org_name,
    expiresAt: payload.expires_at,
  };
}

/**
 * Ends the current impersonation session and restores the admin session.
 * Safe to call even if no impersonation is active (no-op).
 */
export async function exitImpersonation({ reason = 'admin_exit' } = {}) {
  const stash = readStash();
  if (!stash) return { status: 'no_active_session' };

  const authClient = getAuthClient();

  // 1. Call the exit endpoint with the stashed admin token. We pass the
  //    token explicitly so the endpoint sees the admin, not the target.
  try {
    await authenticatedFetch('admin-impersonation-exit', {
      method: 'POST',
      accessToken: stash.admin.accessToken,
      body: {
        session_id: stash.sessionId,
        reason,
      },
    });
  } catch (err) {
    // Do not block session restoration if server-side close fails — we want
    // the admin back in their own seat. The session will expire server-side.
    // eslint-disable-next-line no-console
    console.warn('admin-impersonation-exit call failed; restoring admin session anyway.', err);
  }

  // 2. Restore the admin session.
  try {
    await authClient.auth.setSession({
      access_token: stash.admin.accessToken,
      refresh_token: stash.admin.refreshToken,
    });
  } catch (err) {
    clearStash();
    broadcast();
    throw new Error(err?.message || 'Failed to restore admin session. Please sign in again.');
  }

  clearStash();
  broadcast();
  return { status: 'ended' };
}

export async function fetchImpersonationSessions({ status = 'all', limit = 50, targetEmail = '' } = {}) {
  const params = { status, limit };
  if (targetEmail) params.target_email = targetEmail;
  return authenticatedFetch('admin-impersonation-list', {
    method: 'GET',
    params,
  });
}

export function isCurrentlyImpersonating() {
  return Boolean(readStash());
}
