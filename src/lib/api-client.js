import { getAuthClient } from '@/lib/supabase-manager.js';

const ACTIVE_ORG_STORAGE_KEY = 'active_org_id';

function getActiveOrgId() {
  try {
    return window.localStorage.getItem(ACTIVE_ORG_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

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

function createAuthorizationHeaders(customHeaders = {}, bearer, { includeJsonContentType = false, orgId = '' } = {}) {
  const headers = includeJsonContentType
    ? { 'Content-Type': 'application/json', ...customHeaders }
    : { ...customHeaders };

  headers.Authorization = bearer;
  headers.authorization = bearer;
  headers['X-Supabase-Authorization'] = bearer;
  headers['x-supabase-authorization'] = bearer;
  headers['x-supabase-auth'] = bearer;

  if (orgId) {
    headers['x-org-id'] = orgId;
  }

  return headers;
}

function buildApiErrorMessage(payload, status, fallback = 'An API error occurred') {
  const errorId = payload?.error_id || payload?.support_code || '';
  if (status >= 500 && errorId) {
    return `הפעולה נכשלה. קוד תמיכה: ${errorId}`;
  }
  return payload?.message || fallback;
}

function decorateApiError(error, payload, status) {
  error.status = status;
  if (payload) {
    error.data = payload;
  }
  const errorId = payload?.error_id || payload?.support_code || null;
  if (errorId) {
    error.error_id = errorId;
    error.supportCode = errorId;
  }
  return error;
}

export async function authenticatedFetch(path, { session: _session, accessToken: _accessToken, ...options } = {}) {
  const resolved = resolveTokenFromOverrides(_session, _accessToken);
  const token = resolved.token || await resolveBearerToken();
  const bearer = `Bearer ${token}`;
  const orgId = getActiveOrgId();

  const { headers: customHeaders = {}, body, params, ...rest } = options;
  const headers = createAuthorizationHeaders(customHeaders, bearer, { includeJsonContentType: true, orgId });

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
    throw decorateApiError(
      new Error(buildApiErrorMessage(payload, response.status)),
      payload,
      response.status,
    );
  }

  return payload;
}

export async function authenticatedFetchBlob(path, { session: _session, accessToken: _accessToken, ...options } = {}) {
  const resolved = resolveTokenFromOverrides(_session, _accessToken);
  const token = resolved.token || await resolveBearerToken();
  const bearer = `Bearer ${token}`;
  const orgId = getActiveOrgId();

  const { headers: customHeaders = {}, params, ...rest } = options;
  const headers = createAuthorizationHeaders(customHeaders, bearer, { includeJsonContentType: false, orgId });

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
    let payload = null;
    try {
      const text = await response.text();
      payload = JSON.parse(text);
    } catch {
      // Ignore parse errors
    }
    throw decorateApiError(
      new Error(buildApiErrorMessage(payload, response.status)),
      payload,
      response.status,
    );
  }

  return response.blob();
}

export async function authenticatedFetchText(path, { session: _session, accessToken: _accessToken, ...options } = {}) {
  const resolved = resolveTokenFromOverrides(_session, _accessToken);
  const token = resolved.token || await resolveBearerToken();
  const bearer = `Bearer ${token}`;
  const orgId = getActiveOrgId();

  const { headers: customHeaders = {}, params, ...rest } = options;
  const headers = createAuthorizationHeaders(customHeaders, bearer, { includeJsonContentType: false, orgId });

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
    let payload = null;
    try {
      payload = JSON.parse(text);
    } catch {
      // ignore JSON parsing failures
    }

    throw decorateApiError(
      new Error(buildApiErrorMessage(payload, response.status)),
      payload,
      response.status,
    );
  }

  return text;
}
