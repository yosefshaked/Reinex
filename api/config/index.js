import { respond, readEnv } from '../_shared/org-bff.js';
import { readSupabasePublicConfig } from '../_shared/supabase-admin.js';

function maskForLog(value) {
  if (!value) return '';
  const stringValue = String(value);
  if (stringValue.length <= 6) return '••••';
  return `${stringValue.slice(0, 2)}••••${stringValue.slice(-2)}`;
}

function readFirstNonEmpty(env, keys) {
  for (const key of keys) {
    const value = typeof env?.[key] === 'string' ? env[key].trim() : '';
    if (value) {
      return value;
    }
  }
  return '';
}

export default async function (context) {
  const env = readEnv(context);

  try {
    const { supabaseUrl, anonKey } = readSupabasePublicConfig(env);
    const posthogKey = readFirstNonEmpty(env, ['VITE_POSTHOG_KEY', 'APP_POSTHOG_KEY', 'POSTHOG_KEY']);
    const posthogHost = readFirstNonEmpty(env, ['VITE_POSTHOG_HOST', 'APP_POSTHOG_HOST', 'POSTHOG_HOST']);

    if (!supabaseUrl) {
      context.log?.error?.('Base runtime config is missing Supabase URL.', {
        hasAppSupabaseUrl: Boolean(env.APP_SUPABASE_URL),
        hasSupabaseUrl: Boolean(env.SUPABASE_URL),
        hasViteAppSupabaseUrl: Boolean(env.VITE_APP_SUPABASE_URL),
        hasViteSupabaseUrl: Boolean(env.VITE_SUPABASE_URL),
      });
      return respond(context, 500, { error: 'server_misconfigured' }, { 'Cache-Control': 'no-store' });
    }

    if (!anonKey) {
      context.log?.error?.('Base runtime config is missing Supabase anon key.', {
        hasAppSupabaseAnonKey: Boolean(env.APP_SUPABASE_ANON_KEY),
        hasSupabaseAnonKey: Boolean(env.SUPABASE_ANON_KEY),
        hasViteAppSupabaseAnonKey: Boolean(env.VITE_APP_SUPABASE_ANON_KEY),
        hasViteSupabaseAnonKey: Boolean(env.VITE_SUPABASE_ANON_KEY),
      });
      return respond(context, 500, { error: 'server_misconfigured' }, { 'Cache-Control': 'no-store' });
    }

    context.log?.info?.('Issued base app config.', {
      supabaseUrl: maskForLog(supabaseUrl),
      anonKey: maskForLog(anonKey),
      hasPosthogKey: Boolean(posthogKey),
      posthogHost: posthogHost ? maskForLog(posthogHost) : '',
    });

    const payload = {
      source: 'api',
      supabaseUrl,
      supabaseAnonKey: anonKey,
    };

    if (posthogKey) {
      payload.posthogKey = posthogKey;
    }

    if (posthogHost) {
      payload.posthogHost = posthogHost;
    }

    return respond(
      context,
      200,
      payload,
      {
        'Cache-Control': 'no-store',
        'X-Config-Scope': 'app',
      },
    );
  } catch (error) {
    context.log?.error?.('Unhandled configuration error.', {
      message: error?.message,
    });
    return respond(context, 500, { error: 'server_error' }, { 'Cache-Control': 'no-store' });
  }
}
