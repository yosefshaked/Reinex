import posthog from 'posthog-js';

let initialized = false;
let enabled = false;

const REDACTED_VALUE = 'redacted';

const SENSITIVE_QUERY_KEYS = new Set([
  'access_identifier',
  'access_token',
  'client',
  'client_name',
  'client_profile_id',
  'code',
  'day_of_week',
  'document',
  'document_name',
  'duration_minutes',
  'email',
  'error',
  'error_code',
  'error_description',
  'fix_availability',
  'fix_type',
  'full_name',
  'identity_number',
  'identitynumber',
  'instructor_id',
  'invite',
  'invite_token',
  'invitation_token',
  'name',
  'notes',
  'otp',
  'phone',
  'refresh_token',
  'returnto',
  'search',
  'service_id',
  'service_name',
  'source_template_id',
  'student',
  'student_id',
  'student_name',
  'suggestion_mode',
  'summary',
  'time_of_day',
  'title',
  'token',
  'token_hash',
  'tokenhash',
  'waiting_list_entry_id',
]);

const ROUTE_ID_PARENT_SEGMENTS = new Set([
  'one-time-customers',
  'services',
  'shared-blocks',
  'students',
]);

const PATHNAME_PROPERTY_KEYS = new Set([
  '$pathname',
  '$initial_pathname',
  'pathname',
]);

const URL_PROPERTY_KEYS = [
  '$current_url',
  '$pathname',
  '$referrer',
  '$initial_current_url',
  '$initial_pathname',
  '$initial_referrer',
  'current_url',
  'href',
  'pathname',
  'referrer',
  'url',
];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LIKELY_TOKEN_PATTERN = /^[a-z0-9_-]{16,}$/i;
const LONG_NUMERIC_PATTERN = /^\d{6,}$/;

function normalizeConfigValue(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return '';
  }
  const hasDoubleQuotes = trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2;
  const hasSingleQuotes = trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2;
  if (hasDoubleQuotes || hasSingleQuotes) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function readRuntimeConfigValue(keys) {
  if (typeof window === 'undefined') {
    return '';
  }

  const runtimeConfig = window.__RUNTIME_CONFIG__;
  if (!runtimeConfig || typeof runtimeConfig !== 'object') {
    return '';
  }

  for (const key of keys) {
    const value = normalizeConfigValue(runtimeConfig?.[key]);
    if (value) {
      return value;
    }
  }

  return '';
}

function readPostHogKey() {
  return (
    normalizeConfigValue(import.meta.env?.VITE_POSTHOG_KEY) ||
    readRuntimeConfigValue(['posthogKey', 'posthog_key', 'VITE_POSTHOG_KEY', 'POSTHOG_KEY'])
  );
}

function readPostHogHost() {
  return (
    normalizeConfigValue(import.meta.env?.VITE_POSTHOG_HOST) ||
    readRuntimeConfigValue(['posthogHost', 'posthog_host', 'VITE_POSTHOG_HOST', 'POSTHOG_HOST']) ||
    'https://eu.i.posthog.com'
  );
}

function isLikelySensitiveValue(value) {
  const normalizedValue = String(value || '').trim();
  return (
    UUID_PATTERN.test(normalizedValue) ||
    LIKELY_TOKEN_PATTERN.test(normalizedValue) ||
    LONG_NUMERIC_PATTERN.test(normalizedValue)
  );
}

function sanitizeSearchParams(search) {
  if (!search || search === '?') {
    return '';
  }

  const normalizedSearch = String(search).startsWith('?') ? String(search).slice(1) : String(search);
  const params = new URLSearchParams(normalizedSearch);
  const sanitized = new URLSearchParams();

  params.forEach((value, key) => {
    const normalizedKey = String(key || '').toLowerCase();
    sanitized.append(
      key,
      SENSITIVE_QUERY_KEYS.has(normalizedKey) || isLikelySensitiveValue(value)
        ? REDACTED_VALUE
        : value,
    );
  });

  const serialized = sanitized.toString();
  return serialized ? `?${serialized}` : '';
}

function shouldRedactPathSegment(segment, previousSegment) {
  if (!segment) {
    return false;
  }

  if (previousSegment === 'forms' && segment === 'shared-blocks') {
    return false;
  }

  if (previousSegment === 'forms') {
    return true;
  }

  if (ROUTE_ID_PARENT_SEGMENTS.has(previousSegment)) {
    return true;
  }

  return UUID_PATTERN.test(segment);
}

function splitPathAndSearch(path) {
  const normalizedPath = String(path);
  const searchStart = normalizedPath.indexOf('?');
  if (searchStart === -1) {
    return { pathname: normalizedPath, search: '' };
  }

  return {
    pathname: normalizedPath.slice(0, searchStart),
    search: normalizedPath.slice(searchStart + 1),
  };
}

function sanitizePath(path) {
  if (!path) {
    return path;
  }

  const { pathname, search } = splitPathAndSearch(path);
  const sanitizedPathname = pathname
    .split('/')
    .map((segment, index, segments) => {
      const previousSegment = segments[index - 1];
      return shouldRedactPathSegment(segment, previousSegment) ? ':id' : segment;
    })
    .join('/');

  return `${sanitizedPathname}${sanitizeSearchParams(search)}`;
}

function sanitizeHash(hash) {
  if (!hash || hash === '#') {
    return hash || '';
  }

  const normalizedHash = String(hash).startsWith('#') ? String(hash).slice(1) : String(hash);
  return `#${sanitizePath(normalizedHash)}`;
}

export function sanitizeAnalyticsUrl(value) {
  if (typeof value !== 'string' || !value) {
    return value;
  }

  const trimmedValue = value.trim();
  const isHashOnlyRoute = trimmedValue.startsWith('#');
  const isRelativePath = !isHashOnlyRoute && trimmedValue.startsWith('/');

  try {
    const url = new URL(trimmedValue, typeof window !== 'undefined' ? window.location.origin : 'https://reinex.local');
    url.search = sanitizeSearchParams(url.search);
    url.pathname = sanitizePath(url.pathname);
    url.hash = sanitizeHash(url.hash);
    if (isHashOnlyRoute) {
      return url.hash;
    }
    if (isRelativePath) {
      return `${url.pathname}${url.search}${url.hash}`;
    }
    return url.href;
  } catch {
    return sanitizePath(trimmedValue);
  }
}

function sanitizeAnalyticsProperty(key, value) {
  if (PATHNAME_PROPERTY_KEYS.has(key)) {
    return sanitizePath(value);
  }
  return sanitizeAnalyticsUrl(value);
}

function deriveHashRouterPathname(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return '';
  }

  try {
    const url = new URL(value, typeof window !== 'undefined' ? window.location.origin : 'https://reinex.local');
    if (!url.hash || url.hash === '#') {
      return '';
    }
    return `${sanitizePath(url.pathname)}${sanitizeHash(url.hash)}`;
  } catch {
    return '';
  }
}

function shouldRewritePathnameFromHash(currentPathname, nextPathname) {
  if (!nextPathname) {
    return false;
  }
  if (typeof currentPathname !== 'string' || !currentPathname.trim()) {
    return true;
  }

  const sanitizedCurrentPathname = sanitizePath(currentPathname);
  const hashStart = nextPathname.indexOf('#');
  const documentPathname = hashStart === -1 ? nextPathname : nextPathname.slice(0, hashStart);
  return sanitizedCurrentPathname === documentPathname;
}

export function sanitizePostHogEvent(captureResult) {
  if (!captureResult || !captureResult.properties) {
    return captureResult;
  }

  const properties = { ...captureResult.properties };

  const currentHashPathname = deriveHashRouterPathname(properties.$current_url);
  if (shouldRewritePathnameFromHash(properties.$pathname, currentHashPathname)) {
    properties.$pathname = currentHashPathname;
  }

  const initialHashPathname = deriveHashRouterPathname(properties.$initial_current_url);
  if (shouldRewritePathnameFromHash(properties.$initial_pathname, initialHashPathname)) {
    properties.$initial_pathname = initialHashPathname;
  }

  URL_PROPERTY_KEYS.forEach((key) => {
    if (typeof properties[key] === 'string') {
      properties[key] = sanitizeAnalyticsProperty(key, properties[key]);
    }
  });

  return {
    ...captureResult,
    properties,
  };
}

export function hasPostHogConfigured() {
  return Boolean(readPostHogKey());
}

export function initPostHog() {
  if (initialized) {
    return enabled;
  }

  initialized = true;
  const apiKey = readPostHogKey();
  if (!apiKey) {
    enabled = false;
    return false;
  }

  posthog.init(apiKey, {
    api_host: readPostHogHost(),
    capture_pageview: true,
    capture_pageleave: true,
    before_send: sanitizePostHogEvent,
    loaded(instance) {
      instance.register({ app: 'reinex-web' });
    },
  });

  enabled = true;
  return true;
}

export function captureAnalyticsEvent(eventName, properties = {}) {
  if (!enabled) {
    initPostHog();
  }

  if (!enabled) {
    return false;
  }

  const normalizedEvent = String(eventName || '').trim();
  if (!normalizedEvent) {
    return false;
  }

  posthog.capture(normalizedEvent, properties);
  return true;
}
