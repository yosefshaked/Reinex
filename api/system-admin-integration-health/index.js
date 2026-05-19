/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import { ensureSystemAdmin, normalizeString, readEnv, respond } from '../_shared/org-bff.js';

async function probeSupabaseDb(supabase) {
  const name = 'supabase_db';
  const display_name = 'Supabase DB';
  const start = Date.now();
  try {
    const { error } = await supabase.from('organizations').select('id').limit(1);
    const latency_ms = Date.now() - start;
    if (error) {
      return { name, display_name, status: 'degraded', latency_ms, message: error.message };
    }
    if (latency_ms > 2000) {
      return { name, display_name, status: 'degraded', latency_ms, message: 'response_exceeded_2000_ms' };
    }
    return { name, display_name, status: 'healthy', latency_ms, message: null };
  } catch (err) {
    const latency_ms = Date.now() - start;
    return { name, display_name, status: 'unreachable', latency_ms, message: err?.message || 'Unexpected error' };
  }
}

async function probeSupabaseAuth(supabase) {
  const name = 'supabase_auth';
  const display_name = 'Supabase Auth';
  const start = Date.now();
  try {
    const { error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1 });
    const latency_ms = Date.now() - start;
    if (error) {
      return { name, display_name, status: 'degraded', latency_ms, message: error.message };
    }
    return { name, display_name, status: 'healthy', latency_ms, message: null };
  } catch (err) {
    const latency_ms = Date.now() - start;
    return { name, display_name, status: 'unreachable', latency_ms, message: err?.message || 'Unexpected error' };
  }
}

async function probePostHog(env) {
  const name = 'posthog';
  const display_name = 'PostHog';

  const key = env.VITE_POSTHOG_KEY || env.POSTHOG_API_KEY;
  if (!key) {
    return { name, display_name, status: 'unconfigured', latency_ms: null, message: 'posthog_api_key_not_configured' };
  }

  const host = normalizeString(env.VITE_POSTHOG_HOST || 'https://app.posthog.com');
  const url = `${host}/api/users/@me/`;
  const start = Date.now();
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(5000),
    });
    const latency_ms = Date.now() - start;
    if (response.ok) {
      return { name, display_name, status: 'healthy', latency_ms, message: null };
    }
    return {
      name,
      display_name,
      status: 'degraded',
      latency_ms,
      message: `HTTP ${response.status} ${response.statusText}`,
    };
  } catch (err) {
    const latency_ms = Date.now() - start;
    return { name, display_name, status: 'unreachable', latency_ms, message: err?.message || 'Request failed' };
  }
}

function resolveOverallStatus(probes) {
  const active = probes.filter((p) => p.status !== 'unconfigured');
  if (active.some((p) => p.status === 'unreachable')) return 'unreachable';
  if (active.some((p) => p.status === 'degraded')) return 'degraded';
  return 'healthy';
}

export default async function systemAdminIntegrationHealth(context, req) {
  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);

  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('admin/integration-health: missing Supabase admin credentials');
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    return respond(context, 401, { message: 'missing_bearer_token' });
  }

  const supabase = createSupabaseAdminClient(adminConfig);

  let admin;
  try {
    admin = await ensureSystemAdmin(req, supabase, authorization, { context });
  } catch (err) {
    const status = err.statusCode || 403;
    return respond(context, status, { message: err.message || 'forbidden' });
  }

  const results = await Promise.allSettled([
    probeSupabaseDb(supabase),
    probeSupabaseAuth(supabase),
    probePostHog(env),
  ]);

  const probes = results.map((result) => {
    if (result.status === 'fulfilled') return result.value;
    return {
      name: 'unknown',
      display_name: 'Unknown',
      status: 'unreachable',
      latency_ms: null,
      message: result.reason?.message || 'Probe threw unexpectedly',
    };
  });

  const overall = resolveOverallStatus(probes);

  return respond(context, 200, {
    probes,
    overall,
    checked_at: new Date().toISOString(),
    admin: { user_id: admin.userId, email: admin.email },
  });
}
