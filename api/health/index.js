/* eslint-env node */

export default async function (context) {
  const timestamp = new Date().toISOString();
  const env = context.env ?? globalThis.process?.env ?? {};

  // Surface which required env vars are present (not their values) so the
  // diagnostics page can show a deployment checklist without auth.
  const REQUIRED_ENV = [
    'APP_SUPABASE_URL',
    'APP_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'ORG_CREDENTIALS_ENCRYPTION_KEY',
  ];

  const envCheck = Object.fromEntries(
    REQUIRED_ENV.map((key) => [key, Boolean(env[key])]),
  );

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
