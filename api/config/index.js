import { respond, readEnv } from '../_shared/org-bff.js';
import { readSupabasePublicConfig } from '../_shared/supabase-admin.js';

function maskForLog(value) {
  if (!value) return '';
  const stringValue = String(value);
  if (stringValue.length <= 6) return '••••';
  return `${stringValue.slice(0, 2)}••••${stringValue.slice(-2)}`;
}

export default async function (context) {
  const env = readEnv(context);

  try {
    const { supabaseUrl, anonKey } = readSupabasePublicConfig(env);

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
    });

    return respond(
      context,
      200,
      {
        source: 'api',
        supabaseUrl,
        supabase_url: supabaseUrl,
        supabaseAnonKey: anonKey,
        supabase_anon_key: anonKey,
        anonKey,
        anon_key: anonKey,
      },
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
