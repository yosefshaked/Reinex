/**
 * useAdminStore — shared persistence hook for admin-console modules.
 *
 * Loads from the `system-admin-store` API (backed by the admin_data table).
 * If the table doesn't exist yet (API returns 501), silently falls back to
 * the module's localStorage key so existing data is never lost.
 *
 * The hook:
 *   - Initialises items from localStorage immediately (synchronous, no flash)
 *   - Replaces items with API data once the request resolves
 *   - upsert(record): create or replace by record.id, fires API + localStorage
 *   - remove(id): delete by id, fires API + localStorage
 */
import React from 'react';
import { authenticatedFetch } from '@/lib/api-client.js';

function readStorage(storageKey, seed) {
  if (!storageKey || typeof window === 'undefined') return seed;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return seed;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : seed;
  } catch {
    return seed;
  }
}

function writeStorage(storageKey, items) {
  if (!storageKey || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(items));
  } catch { /* quota — ignore */ }
}

/**
 * @param {string} module  - One of 'incidents' | 'knowledge_base' | 'future_ideas' | 'compliance'
 * @param {object} options
 * @param {Array}  options.seed        - Seed data shown when localStorage is empty
 * @param {string} options.storageKey  - localStorage key for fallback persistence
 */
export function useAdminStore(module, { seed = [], storageKey = null } = {}) {
  // Initialise from localStorage immediately so there's no empty flash.
  const [items, setItems] = React.useState(() => readStorage(storageKey, seed));
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);

  // null = unknown (loading), true = API available, false = localStorage only
  const apiModeRef = React.useRef(null);
  // Guard against overwriting mutations that happened during the initial load.
  const mutatedDuringLoadRef = React.useRef(false);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    mutatedDuringLoadRef.current = false;

    authenticatedFetch('system-admin-store', { method: 'GET', params: { module } })
      .then((data) => {
        if (cancelled) return;
        apiModeRef.current = true;
        // Only replace state if no mutations happened while we were loading.
        if (!mutatedDuringLoadRef.current) {
          setItems(Array.isArray(data?.records) ? data.records : []);
        }
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        // 501 = table not created yet — localStorage fallback, no error shown.
        apiModeRef.current = false;
        if (err?.status !== 501) setError(err);
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [module]);

  /**
   * Create or update a record. Identified by record.id.
   * Optimistic: updates React state immediately, fires API in background.
   */
  const upsert = React.useCallback((record) => {
    mutatedDuringLoadRef.current = true;

    setItems((prev) => {
      const idx = prev.findIndex((i) => i.id === record.id);
      const next = idx >= 0
        ? prev.map((i) => (i.id === record.id ? record : i))
        : [record, ...prev];

      // Always keep localStorage in sync (safe even in strict-mode double invoke).
      if (storageKey) writeStorage(storageKey, next);

      return next;
    });

    if (apiModeRef.current === true) {
      authenticatedFetch('system-admin-store', {
        method: 'POST',
        body: { module, record_id: record.id, data: record },
      }).catch((err) => {
        if (err?.status === 501) apiModeRef.current = false;
      });
    }
  }, [module, storageKey]);

  /**
   * Delete a record by id.
   * Optimistic: removes from React state immediately, fires API in background.
   */
  const remove = React.useCallback((id) => {
    mutatedDuringLoadRef.current = true;

    setItems((prev) => {
      const next = prev.filter((i) => i.id !== id);
      if (storageKey) writeStorage(storageKey, next);
      return next;
    });

    if (apiModeRef.current === true) {
      authenticatedFetch('system-admin-store', {
        method: 'DELETE',
        params: { module, record_id: id },
      }).catch((err) => {
        if (err?.status === 501) apiModeRef.current = false;
      });
    }
  }, [module, storageKey]);

  return { items, loading, error, upsert, remove };
}
