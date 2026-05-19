/* eslint-env node */
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';

const FALLBACK_HEADERS = {
  Accept: 'application/json',
};

function normalizeSource(source) {
  if (!source || typeof source !== 'object') {
    return {};
  }

  if (source.env && typeof source.env === 'object') {
    return { ...source.env, ...source };
  }

  return { ...source };
}

function extractValue(candidate, keys) {
  if (!candidate || typeof candidate !== 'object') {
    return undefined;
  }

  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(candidate, key) && typeof candidate[key] === 'string' && candidate[key]) {
      return candidate[key];
    }
  }

  return undefined;
}

function readPublicSupabaseUrl(source) {
  return (
    extractValue(source, ['supabaseUrl', 'SUPABASE_URL']) ??
    extractValue(source, ['APP_CONTROL_DB_URL', 'APP_SUPABASE_URL', 'VITE_APP_SUPABASE_URL', 'VITE_SUPABASE_URL']) ??
    null
  );
}

function readPublicSupabaseAnonKey(source) {
  return (
    extractValue(source, ['supabaseAnonKey', 'anonKey', 'anon_key', 'SUPABASE_ANON_KEY']) ??
    extractValue(source, ['APP_CONTROL_DB_ANON_KEY', 'APP_SUPABASE_ANON_KEY', 'VITE_APP_SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY']) ??
    null
  );
}

export function readSupabasePublicConfig(source = {}, overrides = {}) {
  const mergedSource = normalizeSource(source);
  const envSource = normalizeSource(process?.env);
  const overrideSource = normalizeSource(overrides);

  const supabaseUrl =
    readPublicSupabaseUrl(overrideSource) ??
    readPublicSupabaseUrl(mergedSource) ??
    readPublicSupabaseUrl(envSource);

  const anonKey =
    readPublicSupabaseAnonKey(overrideSource) ??
    readPublicSupabaseAnonKey(mergedSource) ??
    readPublicSupabaseAnonKey(envSource);

  return { supabaseUrl, anonKey };
}

export function isSupabasePublicConfigValid(config) {
  return Boolean(config?.supabaseUrl && config?.anonKey);
}

export function readSupabaseAdminConfig(source = {}, overrides = {}) {
  const mergedSource = normalizeSource(source);
  const envSource = normalizeSource(process?.env);
  const overrideSource = normalizeSource(overrides);

  const supabaseUrl =
    extractValue(overrideSource, ['supabaseUrl', 'SUPABASE_URL']) ??
    extractValue(mergedSource, ['supabaseUrl', 'SUPABASE_URL', 'APP_CONTROL_DB_URL', 'APP_SUPABASE_URL', 'VITE_APP_SUPABASE_URL']) ??
    extractValue(envSource, ['supabaseUrl', 'SUPABASE_URL', 'APP_CONTROL_DB_URL', 'APP_SUPABASE_URL', 'VITE_APP_SUPABASE_URL']) ??
    null;

  const serviceRoleKey =
    extractValue(overrideSource, ['serviceRoleKey', 'SUPABASE_SERVICE_ROLE_KEY', 'APP_CONTROL_DB_SERVICE_ROLE_KEY']) ??
    extractValue(mergedSource, ['serviceRoleKey', 'SUPABASE_SERVICE_ROLE_KEY', 'APP_CONTROL_DB_SERVICE_ROLE_KEY', 'APP_SUPABASE_SERVICE_ROLE']) ??
    extractValue(envSource, ['serviceRoleKey', 'SUPABASE_SERVICE_ROLE_KEY', 'APP_CONTROL_DB_SERVICE_ROLE_KEY', 'APP_SUPABASE_SERVICE_ROLE']) ??
    null;

  return { supabaseUrl, serviceRoleKey };
}

export function isSupabaseAdminConfigValid(config) {
  return Boolean(config?.supabaseUrl && config?.serviceRoleKey);
}

export function createSupabaseAdminClient(config, options = {}) {
  if (!config?.supabaseUrl || !config?.serviceRoleKey) {
    throw new Error('Missing Supabase admin credentials.');
  }

  const { auth: authOverrides = {}, global: globalOverrides = {}, ...rest } = options;

  const auth = {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
    ...authOverrides,
  };

  const headers = {
    ...FALLBACK_HEADERS,
    ...(globalOverrides.headers ?? {}),
  };

  const global = {
    ...globalOverrides,
    headers,
  };

  return createClient(config.supabaseUrl, config.serviceRoleKey, {
    ...rest,
    auth,
    global,
  });
}

export function getSupabaseAdminClient(source, overrides, options) {
  const config = readSupabaseAdminConfig(source, overrides);
  if (!isSupabaseAdminConfigValid(config)) {
    return null;
  }
  return createSupabaseAdminClient(config, options);
}
