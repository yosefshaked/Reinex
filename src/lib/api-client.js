import { getAuthClient } from '@/lib/supabase-manager.js';

async function resolveBearerToken() {
  const authClient = getAuthClient();
  const { data, error } = await authClient.auth.getSession();

  if (error) {
    throw new Error('Authentication token not found.');
  }

  const token = data?.session?.access_token || null;

  if (!token) {
    throw new Error('Authentication token not found.');
  }

  return token;
}

function resolveTokenFromOverrides(session, accessToken) {
  const overrideToken = typeof accessToken === 'string' && accessToken.trim()
    ? accessToken.trim()
    : null;
  if (overrideToken) {
    return { token: overrideToken, source: 'accessToken' };
  }

  const sessionToken = session?.access_token;
  if (typeof sessionToken === 'string' && sessionToken.trim()) {
    return { token: sessionToken.trim(), source: 'session' };
  }

  return { token: null, source: 'none' };
}

function createAuthorizationHeaders(customHeaders = {}, bearer, { includeJsonContentType = false } = {}) {
  const headers = includeJsonContentType
    ? { 'Content-Type': 'application/json', ...customHeaders }
    : { ...customHeaders };

  headers.Authorization = bearer;
  headers.authorization = bearer;
  headers['X-Supabase-Authorization'] = bearer;
  headers['x-supabase-authorization'] = bearer;
  headers['x-supabase-auth'] = bearer;

  return headers;
}

export async function authenticatedFetch(path, { session: _session, accessToken: _accessToken, ...options } = {}) {
  const resolved = resolveTokenFromOverrides(_session, _accessToken);
  const token = resolved.token || await resolveBearerToken();
  const bearer = `Bearer ${token}`;

  const { headers: customHeaders = {}, body, params, ...rest } = options;
  const headers = createAuthorizationHeaders(customHeaders, bearer, { includeJsonContentType: true });

  let requestBody = body;
  if (requestBody && typeof requestBody === 'object' && !(requestBody instanceof FormData)) {
    requestBody = JSON.stringify(requestBody);
  }

  const normalizedPath = String(path || '')
    .replace(/^\/+/, '')
    .replace(/^api\//, '');

  let url = `/api/${normalizedPath}`;
  if (params && typeof params === 'object') {
    const searchParams = new URLSearchParams();
    for (const [key, rawValue] of Object.entries(params)) {
      if (!key) continue;
      if (rawValue === null || typeof rawValue === 'undefined') continue;
      if (Array.isArray(rawValue)) {
        for (const entry of rawValue) {
          if (entry === null || typeof entry === 'undefined') continue;
          searchParams.append(key, String(entry));
        }
        continue;
      }
      searchParams.set(key, String(rawValue));
    }
    const query = searchParams.toString();
    if (query) {
      url += (url.includes('?') ? '&' : '?') + query;
    }
  }

  const response = await fetch(url, {
    ...rest,
    headers,
    body: requestBody,
  });

  let payload = null;
  const contentType = response.headers?.get?.('content-type') || response.headers?.get?.('Content-Type') || '';
  const isJson = typeof contentType === 'string' && contentType.toLowerCase().includes('application/json');
  if (isJson) {
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const message = payload?.message || 'An API error occurred';
    const error = new Error(message);
    error.status = response.status;
    if (payload) {
      error.data = payload;
    }
    throw error;
  }

  return payload;
}

export async function authenticatedFetchBlob(path, { session: _session, accessToken: _accessToken, ...options } = {}) {
  const resolved = resolveTokenFromOverrides(_session, _accessToken);
  const token = resolved.token || await resolveBearerToken();
  const bearer = `Bearer ${token}`;

  const { headers: customHeaders = {}, params, ...rest } = options;
  const headers = createAuthorizationHeaders(customHeaders, bearer, { includeJsonContentType: false });

  const normalizedPath = String(path || '')
    .replace(/^\/+/, '')
    .replace(/^api\//, '');

  let url = `/api/${normalizedPath}`;
  if (params && typeof params === 'object') {
    const searchParams = new URLSearchParams();
    for (const [key, rawValue] of Object.entries(params)) {
      if (!key) continue;
      if (rawValue === null || typeof rawValue === 'undefined') continue;
      if (Array.isArray(rawValue)) {
        for (const entry of rawValue) {
          if (entry === null || typeof entry === 'undefined') continue;
          searchParams.append(key, String(entry));
        }
        continue;
      }
      searchParams.set(key, String(rawValue));
    }
    const query = searchParams.toString();
    if (query) {
      url += (url.includes('?') ? '&' : '?') + query;
    }
  }

  const response = await fetch(url, {
    ...rest,
    headers,
  });

  if (!response.ok) {
    let message = 'An API error occurred';
    try {
      const text = await response.text();
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object' && typeof parsed.message === 'string') {
        message = parsed.message;
      }
    } catch {
      // Ignore parse errors
    }
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  return response.blob();
}

export async function authenticatedFetchText(path, { session: _session, accessToken: _accessToken, ...options } = {}) {
  const resolved = resolveTokenFromOverrides(_session, _accessToken);
  const token = resolved.token || await resolveBearerToken();
  const bearer = `Bearer ${token}`;

  const { headers: customHeaders = {}, params, ...rest } = options;
  const headers = createAuthorizationHeaders(customHeaders, bearer, { includeJsonContentType: false });

  const normalizedPath = String(path || '')
    .replace(/^\/+/, '')
    .replace(/^api\//, '');

  let url = `/api/${normalizedPath}`;
  if (params && typeof params === 'object') {
    const searchParams = new URLSearchParams();
    for (const [key, rawValue] of Object.entries(params)) {
      if (!key) continue;
      if (rawValue === null || typeof rawValue === 'undefined') continue;
      if (Array.isArray(rawValue)) {
        for (const entry of rawValue) {
          if (entry === null || typeof entry === 'undefined') continue;
          searchParams.append(key, String(entry));
        }
        continue;
      }
      searchParams.set(key, String(rawValue));
    }
    const query = searchParams.toString();
    if (query) {
      url += (url.includes('?') ? '&' : '?') + query;
    }
  }

  const response = await fetch(url, {
    ...rest,
    headers,
  });

  const text = await response.text();

  if (!response.ok) {
    let message = 'An API error occurred';
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object' && typeof parsed.message === 'string') {
        message = parsed.message;
      }
    } catch {
      // ignore JSON parsing failures
    }

    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  return text;
}
