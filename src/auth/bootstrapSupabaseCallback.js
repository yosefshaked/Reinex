export const SUPABASE_CALLBACK_KEYS = Object.freeze([
  'code',
  'error',
  'error_code',
  'error_description',
  'state',
]);

export const SUPABASE_OAUTH_ERROR_STORAGE_KEY = 'supabase-oauth-error';

export function extractSupabaseParams(queryString = '') {
  const normalized = typeof queryString === 'string' && queryString.startsWith('?')
    ? queryString.slice(1)
    : queryString || '';

  const params = new URLSearchParams(normalized);
  const payload = {};
  let hasSupabaseParams = false;

  SUPABASE_CALLBACK_KEYS.forEach((key) => {
    if (params.has(key)) {
      hasSupabaseParams = true;
      payload[key] = params.get(key);
    }
  });

  return {
    hasSupabaseParams,
    payload: hasSupabaseParams ? payload : null,
    params,
  };
}

export function removeSupabaseParams(params) {
  if (!(params instanceof URLSearchParams)) {
    return params;
  }

  SUPABASE_CALLBACK_KEYS.forEach((key) => {
    if (params.has(key)) {
      params.delete(key);
    }
  });

  return params;
}

export function storeSupabaseOAuthError(payload) {
  if (!payload || typeof window === 'undefined') {
    return;
  }

  const hasErrorDetails = Boolean(payload.error || payload.error_code);

  if (!hasErrorDetails) {
    try {
      window.sessionStorage?.removeItem(SUPABASE_OAUTH_ERROR_STORAGE_KEY);
    } catch (error) {
      console.error('Failed to clear stale Supabase OAuth payload', error);
    }
    return;
  }

  try {
    window.sessionStorage?.setItem(
      SUPABASE_OAUTH_ERROR_STORAGE_KEY,
      JSON.stringify(payload),
    );
  } catch (error) {
    console.error('Failed to persist Supabase OAuth error payload', error);
  }
}

export function readStoredSupabaseOAuthError() {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = window.sessionStorage?.getItem(SUPABASE_OAUTH_ERROR_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw);
  } catch (error) {
    console.error('Failed to read Supabase OAuth error payload from storage', error);
    return null;
  }
}

export function clearStoredSupabaseOAuthError() {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.sessionStorage?.removeItem(SUPABASE_OAUTH_ERROR_STORAGE_KEY);
  } catch (error) {
    console.error('Failed to clear Supabase OAuth error payload from storage', error);
  }
}

export function splitHash(hash = '') {
  if (typeof hash !== 'string' || hash.length === 0) {
    return { path: '', query: '' };
  }

  const questionIndex = hash.indexOf('?');
  if (questionIndex === -1) {
    return { path: hash, query: '' };
  }

  return {
    path: hash.slice(0, questionIndex),
    query: hash.slice(questionIndex + 1),
  };
}

export function bootstrapSupabaseCallback() {
  if (typeof window === 'undefined') {
    return;
  }

  const { location } = window;
  if (!location || typeof location.origin !== 'string') {
    return;
  }

  const search = typeof location.search === 'string' ? location.search : '';
  if (!search) {
    return;
  }

  const { hasSupabaseParams, payload, params } = extractSupabaseParams(search);
  if (!hasSupabaseParams) {
    return;
  }

  if (payload) {
    storeSupabaseOAuthError(payload);
  }

  const serializedQuery = params.toString();
  const desiredHash = `#/login/${serializedQuery ? `?${serializedQuery}` : ''}`;
  const currentHash = typeof location.hash === 'string' ? location.hash : '';

  if (currentHash === desiredHash) {
    return;
  }

  const currentUrl = `${location.origin}${location.pathname}${location.search}${currentHash}`;
  const desiredUrl = `${location.origin}${location.pathname}${location.search}${desiredHash}`;

  if (currentUrl === desiredUrl) {
    return;
  }

  if (typeof window.history?.replaceState === 'function') {
    window.history.replaceState(window.history.state, '', desiredUrl);
    return;
  }

  window.location.hash = desiredHash;
}
