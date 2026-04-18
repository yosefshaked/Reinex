import posthog from 'posthog-js';

let initialized = false;
let enabled = false;

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
