/* eslint-env node */

import { readSupabasePublicConfig } from '../_shared/supabase-admin.js';

export default async function (context) {
  const timestamp = new Date().toISOString();
  const env = context.env ?? globalThis.process?.env ?? {};
  const publicConfig = readSupabasePublicConfig(env);

  // Surface which required env vars are present (not their values) so the
  // diagnostics page can show a deployment checklist without auth.
  const envCheck = {
    SUPABASE_URL: Boolean(publicConfig.supabaseUrl),
    SUPABASE_ANON_KEY: Boolean(publicConfig.anonKey),
    SUPABASE_SERVICE_ROLE_KEY: Boolean(env.SUPABASE_SERVICE_ROLE_KEY),
  };

  context.res = {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify({
      ok: true,
      timestamp,
      env: envCheck,
    }),
  };
}
