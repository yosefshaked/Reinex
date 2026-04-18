import posthog from 'posthog-js';

let initialized = false;
let enabled = false;

function readPostHogKey() {
  return String(import.meta.env?.VITE_POSTHOG_KEY || '').trim();
}

function readPostHogHost() {
  return String(import.meta.env?.VITE_POSTHOG_HOST || 'https://eu.i.posthog.com').trim();
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
    return false;
  }

  const normalizedEvent = String(eventName || '').trim();
  if (!normalizedEvent) {
    return false;
  }

  posthog.capture(normalizedEvent, properties);
  return true;
}
