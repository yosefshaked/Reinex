/* eslint-env node */
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import { normalizeString, readEnv, respond } from '../_shared/org-bff.js';
import { parseJsonBodyWithLimit } from '../_shared/validation.js';
import { buildPublicAppHashRouteUrl } from '../_shared/public-app-url.js';
import { deliverPasswordResetEmail } from '../_shared/password-reset-email.js';

function normalizeEmail(value) {
  const trimmed = normalizeString(value).toLowerCase();
  const emailPattern = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  return emailPattern.test(trimmed) ? trimmed : '';
}

export default async function passwordReset(context, req) {
  if (String(req.method || 'GET').toUpperCase() !== 'POST') {
    return respond(context, 405, { message: 'method_not_allowed' });
  }

  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);

  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('password-reset missing supabase admin credentials');
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  let body = {};
  try {
    body = await parseJsonBodyWithLimit(req, { maxBytes: 16 * 1024 });
  } catch {
    return respond(context, 400, { message: 'invalid_json_body' });
  }

  const email = normalizeEmail(body?.email);
  if (!email) {
    return respond(context, 400, { message: 'invalid_email' });
  }

  const supabase = createSupabaseAdminClient(adminConfig);
  const redirectTo = buildPublicAppHashRouteUrl(req, env, '/update-password', {
    fallback: 'https://reinex.thepcrunners.com',
  });

  try {
    await deliverPasswordResetEmail({
      supabase,
      env,
      context,
      email,
      redirectTo,
    });
  } catch (error) {
    context.log?.error?.('password-reset failed to send recovery email', {
      email,
      message: error?.message,
    });
    return respond(context, 502, { message: 'failed_to_send_password_reset' });
  }

  return respond(context, 200, { message: 'password_reset_requested' });
}
