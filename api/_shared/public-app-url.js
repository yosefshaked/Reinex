/* eslint-env node */

import { normalizeString } from './org-bff.js';

function readHeader(req, key) {
  const headers = req?.headers || {};
  const direct = headers[key];
  if (typeof direct === 'string' && direct.trim()) return direct.trim();

  const lowerKey = String(key || '').toLowerCase();
  for (const [headerName, headerValue] of Object.entries(headers)) {
    if (String(headerName || '').toLowerCase() === lowerKey && typeof headerValue === 'string' && headerValue.trim()) {
      return headerValue.trim();
    }
  }
  return '';
}

function toUrlOrigin(value) {
  const normalized = normalizeString(value);
  if (!normalized) return '';
  try {
    const parsed = new URL(normalized);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return '';
  }
}

function normalizeOriginRule(rule) {
  return String(rule || '').trim().toLowerCase().replace(/\/$/, '');
}

function parseAllowedOriginRules(env) {
  const raw = normalizeString(
    env?.APP_ALLOWED_PUBLIC_ORIGINS ||
    env?.ALLOWED_PUBLIC_ORIGINS ||
    env?.PUBLIC_APP_ALLOWED_ORIGINS,
  );
  if (!raw) return [];
  return raw
    .split(',')
    .map((item) => normalizeOriginRule(item))
    .filter(Boolean);
}

function isProtocolAllowedForOrigin(parsed) {
  const protocol = String(parsed?.protocol || '').toLowerCase();
  const hostname = String(parsed?.hostname || '').toLowerCase();
  const isLocalhost = hostname === 'localhost' || hostname.endsWith('.localhost');
  if (protocol === 'https:') return true;
  return protocol === 'http:' && isLocalhost;
}

function matchesAllowedRule(origin, rule) {
  const normalizedOrigin = normalizeOriginRule(origin);
  const normalizedRule = normalizeOriginRule(rule);
  if (!normalizedOrigin || !normalizedRule) return false;

  if (normalizedRule.startsWith('*.')) {
    const suffix = normalizedRule.slice(1);
    try {
      return new URL(normalizedOrigin).hostname.toLowerCase().endsWith(suffix);
    } catch {
      return false;
    }
  }

  if (normalizedRule.includes('://')) {
    return normalizedOrigin === normalizedRule;
  }

  try {
    return new URL(normalizedOrigin).hostname.toLowerCase() === normalizedRule;
  } catch {
    return false;
  }
}

export function isAllowedPublicOrigin(origin, env) {
  const normalizedOrigin = normalizeOriginRule(origin);
  if (!normalizedOrigin) return false;

  let parsed;
  try {
    parsed = new URL(normalizedOrigin);
  } catch {
    return false;
  }

  if (!isProtocolAllowedForOrigin(parsed)) {
    return false;
  }

  const rules = parseAllowedOriginRules(env);
  if (!rules.length) {
    return true;
  }

  return rules.some((rule) => matchesAllowedRule(normalizedOrigin, rule));
}

function normalizeConfiguredBaseUrl(env) {
  return normalizeString(
    env?.APP_PUBLIC_APP_URL ||
    env?.PUBLIC_APP_URL ||
    env?.VITE_PUBLIC_APP_URL ||
    env?.VITE_APP_BASE_URL ||
    env?.VITE_SITE_URL ||
    env?.SITE_URL ||
    env?.FRONTEND_URL,
  ).replace(/\/$/, '');
}

export function resolvePublicAppBaseUrl(req, env, { fallback = 'https://reinex.app' } = {}) {
  const origin = toUrlOrigin(readHeader(req, 'origin'));
  if (isAllowedPublicOrigin(origin, env)) {
    return origin;
  }

  const referer = toUrlOrigin(readHeader(req, 'referer'));
  if (isAllowedPublicOrigin(referer, env)) {
    return referer;
  }

  const originalUrl = toUrlOrigin(readHeader(req, 'x-ms-original-url'));
  if (isAllowedPublicOrigin(originalUrl, env)) {
    return originalUrl;
  }

  const proto = readHeader(req, 'x-forwarded-proto') || 'https';
  const host = readHeader(req, 'x-forwarded-host') || readHeader(req, 'host');
  if (typeof host === 'string' && host.trim()) {
    const forwardedOrigin = `${String(proto).trim()}://${host.trim()}`;
    if (isAllowedPublicOrigin(forwardedOrigin, env)) {
      return forwardedOrigin;
    }
  }

  const configuredBaseUrl = normalizeConfiguredBaseUrl(env);
  if (configuredBaseUrl && isAllowedPublicOrigin(configuredBaseUrl, env)) {
    return configuredBaseUrl;
  }

  return normalizeString(fallback).replace(/\/$/, '') || 'https://reinex.app';
}

function normalizeHashRoute(hashRoute) {
  const trimmed = normalizeString(hashRoute || '/');
  const withoutLeadingHash = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
  const withoutHashQuery = withoutLeadingHash.split('?')[0];
  if (!withoutHashQuery) return '/';
  return withoutHashQuery.startsWith('/') ? withoutHashQuery : `/${withoutHashQuery}`;
}

export function buildPublicAppHashRouteUrl(req, env, hashRoute, options = {}) {
  const baseUrl = resolvePublicAppBaseUrl(req, env, options);
  return `${baseUrl}/#${normalizeHashRoute(hashRoute)}`;
}

export function normalizeAbsoluteRedirectUrl(value) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return null;
  }

  try {
    const parsed = new URL(normalized);
    let hash = parsed.hash || '';
    if (hash.includes('?')) {
      hash = hash.slice(0, hash.indexOf('?'));
    }
    return `${parsed.origin}${parsed.pathname}${hash}`;
  } catch {
    return null;
  }
}
