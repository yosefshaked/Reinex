import React from 'react';
import { authenticatedFetch } from '@/lib/api-client.js';

/**
 * useAdminStore — API-backed persistence for admin-console modules.
 *
 * @param {string} module - 'incidents' | 'knowledge_base' | 'future_ideas' | 'compliance'
 * @param {object} options
 * @param {Array}  options.seed - Initial items shown while the first fetch is in flight
 */
export function useAdminStore(module, { seed = [] } = {}) {
  const [items, setItems] = React.useState(seed);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    authenticatedFetch('system-admin-store', { method: 'GET', params: { module } })
      .then((data) => {
        if (cancelled) return;
        setItems(Array.isArray(data?.records) ? data.records : []);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err);
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [module]);

  const upsert = React.useCallback((record) => {
    setItems((prev) => {
      const idx = prev.findIndex((i) => i.id === record.id);
      return idx >= 0
        ? prev.map((i) => (i.id === record.id ? record : i))
        : [record, ...prev];
    });

    authenticatedFetch('system-admin-store', {
      method: 'POST',
      body: { module, record_id: record.id, data: record },
    }).catch(() => {});
  }, [module]);

  const remove = React.useCallback((id) => {
    setItems((prev) => prev.filter((i) => i.id !== id));

    authenticatedFetch('system-admin-store', {
      method: 'DELETE',
      params: { module, record_id: id },
    }).catch(() => {});
  }, [module]);

  return { items, loading, error, upsert, remove };
}
