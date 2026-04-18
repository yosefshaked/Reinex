import { asError, MissingRuntimeConfigError } from '../lib/error-utils.js';
export { MissingRuntimeConfigError } from '../lib/error-utils.js';

const IS_DEV = Boolean(import.meta?.env?.DEV);

if (IS_DEV) {
  console.debug('[runtime/config] module evaluated');
}

const CACHE = new Map();

let currentConfig = null;
let readyResolve = () => {};
let readyPromise = createReadyPromise();
let lastDiagnostics = {
  orgId: null,
  status: null,
  scope: 'app',
  ok: false,
  error: null,
  endpoint: null,
  timestamp: null,
  accessToken: null,
  accessTokenPreview: null,
  body: null,
  bodyIsJson: false,
  bodyText: null,
};

const activatedListeners = new Set();
const clearedListeners = new Set();

function notifyListeners(collection, payload) {
  if (!collection || collection.size === 0) {
    return;
  }

  for (const listener of Array.from(collection)) {
    try {
      listener(payload);
    } catch (error) {
      console.error('runtime config listener failed', error);
    }
  }
}

function createReadyPromise() {
  return new Promise((resolve) => {
    readyResolve = resolve;
  });
}

export function onConfigActivated(listener) {
  if (typeof listener !== 'function') {
    return () => {};
  }
  activatedListeners.add(listener);
  return () => {
    activatedListeners.delete(listener);
  };
}

export function onConfigCleared(listener) {
  if (typeof listener !== 'function') {
    return () => {};
  }
  clearedListeners.add(listener);
  return () => {
    clearedListeners.delete(listener);
  };
}

async function ensureAuthClientInitialized(credentials) {
  try {
    const { initializeAuthClient } = await import('../lib/supabase-manager.js');
    initializeAuthClient(credentials);
  } catch (error) {
    throw asError(error, 'טעינת לקוח Supabase נכשלה. ודא שמפתחות הבקרה תקינים.');
  }
}

export async function activateConfig(rawConfig, options = {}) {
  const sanitized = sanitizeConfig(rawConfig, options.source || rawConfig?.source || 'manual');

  if (!sanitized) {
    throw new MissingRuntimeConfigError('נדרשים ערכי supabaseUrl ו-supabaseAnonKey להפעלת החיבור.');
  }

  const normalized = {
    supabaseUrl: sanitized.supabaseUrl,
    supabaseAnonKey: sanitized.supabaseAnonKey,
    posthogKey: sanitized.posthogKey || '',
    posthogHost: sanitized.posthogHost || '',
    source: sanitized.source || options.source || 'manual',
    orgId: options.orgId ?? null,
  };

  await ensureAuthClientInitialized(normalized);

  currentConfig = {
    supabaseUrl: normalized.supabaseUrl,
    supabaseAnonKey: normalized.supabaseAnonKey,
    posthogKey: normalized.posthogKey,
    posthogHost: normalized.posthogHost,
    source: normalized.source,
    orgId: normalized.orgId,
  };

  if (IS_DEV) {
    console.debug('[runtime/config] activated', {
      source: currentConfig.source,
      hasOrg: Boolean(currentConfig.orgId),
    });
  }

  if (typeof window !== 'undefined') {
    window.__RUNTIME_CONFIG__ = {
      supabaseUrl: currentConfig.supabaseUrl,
      supabaseAnonKey: currentConfig.supabaseAnonKey,
      posthogKey: currentConfig.posthogKey,
      posthogHost: currentConfig.posthogHost,
      source: currentConfig.source,
      orgId: currentConfig.orgId,
    };
  }

  CACHE.set('app', { ...normalized });
  notifyListeners(activatedListeners, {
    supabaseUrl: currentConfig.supabaseUrl,
    supabaseAnonKey: currentConfig.supabaseAnonKey,
    posthogKey: currentConfig.posthogKey,
    posthogHost: currentConfig.posthogHost,
    source: currentConfig.source,
    orgId: currentConfig.orgId,
  });
  readyResolve();
  return { supabaseUrl: currentConfig.supabaseUrl, supabaseAnonKey: currentConfig.supabaseAnonKey };
}

export function clearConfig() {
  currentConfig = null;
  CACHE.delete('app');
  readyPromise = createReadyPromise();
  notifyListeners(clearedListeners);
  if (typeof window !== 'undefined') {
    window.__RUNTIME_CONFIG__ = null;
  }
  if (IS_DEV) {
    console.debug('[runtime/config] cleared');
  }
}

export function getConfigOrThrow() {
  if (!currentConfig?.supabaseUrl || !currentConfig?.supabaseAnonKey) {
    throw new MissingRuntimeConfigError();
  }
  return {
    supabaseUrl: currentConfig.supabaseUrl,
    supabaseAnonKey: currentConfig.supabaseAnonKey,
  };
}

export function getCurrentConfig() {
  if (!currentConfig?.supabaseUrl || !currentConfig?.supabaseAnonKey) {
    return null;
  }
  return {
    supabaseUrl: currentConfig.supabaseUrl,
    supabaseAnonKey: currentConfig.supabaseAnonKey,
    posthogKey: currentConfig.posthogKey || '',
    posthogHost: currentConfig.posthogHost || '',
    source: currentConfig.source || null,
    orgId: currentConfig.orgId || null,
  };
}

export function getPrimaryControlConfig() {
  const cached = CACHE.get('app');

  if (cached?.supabaseUrl && cached?.supabaseAnonKey) {
    return {
      supabaseUrl: cached.supabaseUrl,
      supabaseAnonKey: cached.supabaseAnonKey,
      source: cached.source || null,
    };
  }

  if (currentConfig?.supabaseUrl && currentConfig?.supabaseAnonKey && !currentConfig?.orgId) {
    return {
      supabaseUrl: currentConfig.supabaseUrl,
      supabaseAnonKey: currentConfig.supabaseAnonKey,
      source: currentConfig.source || null,
    };
  }

  return null;
}

export async function waitConfigReady() {
  return readyPromise;
}

function sanitizeConfig(raw, source = 'api') {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }
  const supabaseUrl = raw.supabaseUrl;
  const supabaseAnonKey = raw.supabaseAnonKey;
  const posthogKey = raw.posthogKey ?? raw.posthog_key ?? '';
  const posthogHost = raw.posthogHost ?? raw.posthog_host ?? '';
  const trimmedUrl = typeof supabaseUrl === 'string' ? supabaseUrl.trim() : '';
  const trimmedKey = typeof supabaseAnonKey === 'string' ? supabaseAnonKey.trim() : '';
  const trimmedPosthogKey = typeof posthogKey === 'string' ? posthogKey.trim() : '';
  const trimmedPosthogHost = typeof posthogHost === 'string' ? posthogHost.trim() : '';

  if (!trimmedUrl || !trimmedKey) {
    return undefined;
  }

  return {
    supabaseUrl: trimmedUrl,
    supabaseAnonKey: trimmedKey,
    posthogKey: trimmedPosthogKey,
    posthogHost: trimmedPosthogHost,
    source,
  };
}

function buildTokenPreview(token) {
  if (!token) {
    return null;
  }
  const trimmed = String(token).trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.length <= 8) {
    return trimmed;
  }
  return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`;
}

function updateDiagnostics({
  orgId,
  status,
  scope,
  ok,
  error,
  accessToken,
  body,
  bodyIsJson,
  endpoint,
  bodyText,
}) {
  lastDiagnostics = {
    orgId: orgId || null,
    status: typeof status === 'number' ? status : null,
    scope,
    ok,
    error: error || null,
    endpoint: endpoint || null,
    timestamp: Date.now(),
    accessToken: accessToken || null,
    accessTokenPreview: buildTokenPreview(accessToken),
    body: bodyIsJson ? body ?? null : null,
    bodyIsJson: Boolean(bodyIsJson && body !== undefined),
    bodyText: typeof bodyText === 'string' && bodyText.length ? bodyText : null,
  };
}

export function getRuntimeConfigDiagnostics() {
  return { ...lastDiagnostics };
}

function buildCacheKey() {
  return 'app';
}

async function ensureJsonResponse(response, orgId, scope, accessToken, endpoint) {
  const rawContentType = response.headers.get('content-type') || '';
  const normalizedContentType = typeof rawContentType === 'string' ? rawContentType.toLowerCase() : '';

  if (normalizedContentType.includes('application/json')) {
    return;
  }

  let bodyText = '';
  try {
    bodyText = await response.text();
  } catch {
    bodyText = '';
  }

  const endpointLabel = endpoint || '/api/config';
  let friendlyMessage = `הפונקציה ${endpointLabel} לא מחזירה JSON תקין. ודא שהיא מחזירה תשובה מסוג application/json.`;

  if ((response.status === 401 || response.status === 403) && scope === 'org') {
    friendlyMessage =
      `הפונקציה ${endpointLabel} החזירה ${response.status} ללא JSON. ודא שסיפקת כותרת x-functions-key תקינה או שה- authLevel של הפונקציה הוא "anonymous".`;
  } else if (response.status === 404) {
    friendlyMessage = `הפונקציה ${endpointLabel} החזירה 404 ללא JSON. ודא שהנתיב קיים ומחזיר supabaseUrl ו-supabaseAnonKey.`;
  }

  updateDiagnostics({
    orgId,
    status: response.status,
    scope,
    ok: false,
    error: friendlyMessage,
    accessToken,
    body: null,
    bodyIsJson: false,
    endpoint,
    bodyText,
    errorReason: 'response-not-json',
  });

  const error = new MissingRuntimeConfigError(friendlyMessage);
  error.status = response.status;
  error.endpoint = endpointLabel;
  error.bodyText = bodyText;
  throw asError(error);
}

export async function loadRuntimeConfig(options = {}) {
  const { force = false } = options;
  const cacheKey = buildCacheKey();

  if (!force && CACHE.has(cacheKey)) {
    return CACHE.get(cacheKey);
  }

  const headers = { Accept: 'application/json' };
  const endpoint = '/api/config';

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'GET',
      headers,
      cache: 'no-store',
    });
  } catch {
    updateDiagnostics({
      orgId: null,
      status: null,
      scope: 'app',
      ok: false,
      error: 'network-failure',
      accessToken: null,
      body: null,
      bodyIsJson: false,
      endpoint,
    });
    throw new MissingRuntimeConfigError(
      `לא ניתן ליצור קשר עם הפונקציה ${endpoint}. ודא שהיא פרוסה ופועלת.`,
    );
  }

  await ensureJsonResponse(response, null, 'app', null, endpoint);

  let rawBodyText = '';
  try {
    rawBodyText = await response.text();
  } catch {
    rawBodyText = '';
  }

  let payload = null;
  const trimmedBody = rawBodyText.trim();
  if (trimmedBody) {
    try {
      payload = JSON.parse(trimmedBody);
    } catch {
      updateDiagnostics({
        orgId: null,
        status: response.status,
        scope: 'app',
        ok: false,
        error: 'invalid-json',
        accessToken: null,
        body: null,
        bodyIsJson: false,
        endpoint,
        bodyText: rawBodyText,
      });
      const parsingError = new MissingRuntimeConfigError(
        `לא ניתן לפענח את תשובת ${endpoint}. ודא שהפונקציה מחזירה JSON תקין.`,
      );
      parsingError.status = response.status;
      parsingError.endpoint = endpoint;
      parsingError.bodyText = rawBodyText;
      throw parsingError;
    }
  }

  if (!response.ok) {
    const serverMessage = typeof payload?.error === 'string'
      ? payload.error
      : `טעינת ההגדרות נכשלה (סטטוס ${response.status}).`;

    updateDiagnostics({
      orgId: null,
      status: response.status,
      scope: 'app',
      ok: false,
      error: serverMessage,
      accessToken: null,
      body: payload,
      bodyIsJson: typeof payload === 'object' && payload !== null,
      endpoint,
      bodyText: rawBodyText,
    });
    const error = new MissingRuntimeConfigError(serverMessage);
    error.status = response.status;
    error.body = payload;
    error.endpoint = endpoint;
    error.bodyText = rawBodyText;
    throw asError(error);
  }

  const sanitized = sanitizeConfig(payload, 'api');
  if (!sanitized) {
    updateDiagnostics({
      orgId: null,
      status: response.status,
      scope: 'app',
      ok: false,
      error: 'missing-keys',
      accessToken: null,
      body: payload,
      bodyIsJson: typeof payload === 'object' && payload !== null,
      endpoint,
      bodyText: rawBodyText,
    });
    const error = new MissingRuntimeConfigError(
      `הפונקציה ${endpoint} לא סיפקה supabaseUrl ו-supabaseAnonKey.`,
    );
    error.status = response.status;
    error.body = payload;
    error.endpoint = endpoint;
    error.bodyText = rawBodyText;
    throw asError(error);
  }

  const normalized = {
    ...sanitized,
    orgId: null,
  };

  updateDiagnostics({
    orgId: null,
    status: response.status,
    scope: 'app',
    ok: true,
    error: null,
    accessToken: null,
    body: payload,
    bodyIsJson: typeof payload === 'object' && payload !== null,
    endpoint,
    bodyText: rawBodyText,
  });

  CACHE.set(cacheKey, normalized);
  await activateConfig(normalized, { source: normalized.source || 'api', orgId: null });

  return normalized;
}

function hasPreloadedConfig(raw) {
  if (!raw || typeof raw !== 'object') {
    return false;
  }
  const supabaseUrl = raw.supabaseUrl;
  const supabaseAnonKey = raw.supabaseAnonKey;
  return Boolean(
    typeof supabaseUrl === 'string' && supabaseUrl.trim() &&
    typeof supabaseAnonKey === 'string' && supabaseAnonKey.trim(),
  );
}

if (typeof window !== 'undefined' && hasPreloadedConfig(window.__RUNTIME_CONFIG__)) {
  (async () => {
    try {
      const preloaded = window.__RUNTIME_CONFIG__;
      const orgId = preloaded.orgId ?? preloaded.org_id ?? null;
      await activateConfig(preloaded, { source: preloaded.source || 'preload', orgId });
    } catch (error) {
      console.warn('failed to activate preloaded runtime config', error);
    }
  })();
}
