import React from 'react';
import posthog from 'posthog-js';
import {
  initPostHog,
  hasPostHogConfigured,
  captureAnalyticsEvent,
} from '@/lib/analytics/posthog.js';

/**
 * Admin-specific PostHog helpers.
 *
 * The shared lib in @/lib/analytics/posthog.js handles init + generic capture.
 * This module layers on:
 *   - identifyUser: wire current admin identity for PostHog session stitching
 *   - resetAnalytics: clear identity on logout / impersonation entry
 *   - captureAdminEvent: namespaced capture (admin.* event prefix)
 *   - useFeatureFlag: React hook that reacts to PostHog flag changes
 */

let identified = false;

function ensureInit() {
  if (!hasPostHogConfigured()) return false;
  return initPostHog();
}

export function identifyUser(userId, traits = {}) {
  if (!ensureInit()) return false;
  if (!userId) return false;
  posthog.identify(String(userId), {
    ...traits,
    is_system_admin: true,
  });
  identified = true;
  return true;
}

export function resetAnalytics() {
  if (!identified) return;
  try {
    posthog.reset();
  } catch {
    /* noop */
  }
  identified = false;
}

export function captureAdminEvent(eventName, properties = {}) {
  const name = String(eventName || '').trim();
  if (!name) return false;
  const namespaced = name.startsWith('admin.') ? name : `admin.${name}`;
  return captureAnalyticsEvent(namespaced, {
    surface: 'system-admin',
    ...properties,
  });
}

/**
 * React hook — returns the current value of a PostHog feature flag.
 * Subscribes to flag changes and re-renders on update.
 *
 * Returns undefined until PostHog is initialised; after that, either a
 * boolean, a string (for multivariate flags), or false if the flag is off.
 */
export function useFeatureFlag(flagKey, defaultValue = false) {
  const [value, setValue] = React.useState(defaultValue);

  React.useEffect(() => {
    if (!ensureInit() || !flagKey) {
      setValue(defaultValue);
      return undefined;
    }

    const read = () => {
      try {
        const v = posthog.getFeatureFlag(flagKey);
        setValue(v === undefined ? defaultValue : v);
      } catch {
        setValue(defaultValue);
      }
    };

    read();

    let unsub = null;
    try {
      unsub = posthog.onFeatureFlags(() => read());
    } catch {
      /* older posthog-js signature — skip */
    }

    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, [flagKey, defaultValue]);

  return value;
}

/**
 * React hook — fires a page-view-ish admin event when the given module is
 * opened. Safe to call unconditionally; no-op when PostHog is unconfigured.
 */
export function useAdminModuleView(moduleKey, extraProps = {}) {
  React.useEffect(() => {
    if (!moduleKey) return;
    captureAdminEvent('module_viewed', { module: moduleKey, ...extraProps });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleKey]);
}
