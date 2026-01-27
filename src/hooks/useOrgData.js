/**
 * Organization Data Fetching Hooks
 * 
 * This module provides versatile hooks for fetching organization resources (students, instructors, services).
 * 
 * KEY DESIGN DECISIONS:
 * 
 * 1. **Stable Dependencies**: The hook only refetches when meaningful params change.
 *    - `params` object is serialized via JSON.stringify() to detect actual value changes
 *    - `mapResponse` function is stabilized via useCallback with string representation
 *    - This prevents infinite loops from object reference changes
 * 
 * 2. **Conditional Fetching**: The `enabled` flag allows components to control when fetching occurs.
 *    - Forms/modals can disable fetching until opened
 *    - Pages can wait for auth/filters to be ready
 *    - When disabled, data can optionally be cleared via `resetOnDisable`
 * 
 * 3. **Dynamic Params**: Supports changing filter parameters (e.g., status filter, search terms).
 *    - queryString is memoized and only updates when param values actually change
 *    - Automatically refetches when params change
 * 
 * 4. **Manual Refetch**: Every hook returns a `refetch` function for post-mutation updates.
 *    - After creating/updating a record, call `refetch()` to reload the list
 * 
 * USE CASES SUPPORTED:
 * - Simple fetch on mount (forms, modals)
 * - Filtered fetch with dynamic params (admin pages with filters)
 * - Conditional enabled/disabled (settings dialogs)
 * - Refetch on demand (after mutations)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/auth/AuthContext.jsx';
import { useOrg } from '@/org/OrgContext.jsx';
import { authenticatedFetch } from '@/lib/api-client.js';

function resolveOrgAndSession({ orgId: orgIdOverride, session: sessionOverride }, contextOrgId, contextSession) {
  const orgId = orgIdOverride ?? contextOrgId ?? null;
  const session = sessionOverride ?? contextSession ?? null;
  return { orgId, session };
}

function shouldInclude(value) {
  return value !== undefined && value !== null && `${value}`.trim() !== '';
}

function buildSearchParamsString(baseParams = {}, orgId) {
  const searchParams = new URLSearchParams();
  if (shouldInclude(orgId)) {
    searchParams.set('org_id', orgId);
  }
  Object.entries(baseParams).forEach(([key, value]) => {
    if (shouldInclude(value)) {
      searchParams.set(key, value);
    }
  });
  return searchParams.toString();
}

/**
 * Core hook for fetching organization data resources.
 * 
 * Design principles:
 * 1. Stable dependencies - only refetch when meaningful params change
 * 2. Support conditional fetching via `enabled` flag
 * 3. Manual refetch capability for mutations
 * 4. Proper cleanup and error handling
 * 
 * @param {Object} options
 * @param {string} options.resource - Resource name (for logging)
 * @param {string} options.path - API endpoint path
 * @param {boolean} options.enabled - Whether fetching is enabled
 * @param {string} options.orgId - Organization ID override
 * @param {Object} options.session - Session override
 * @param {boolean} options.resetOnDisable - Clear data when disabled
 * @param {Object} options.params - Query parameters (will be memoized internally)
 * @param {Function} options.mapResponse - Transform response payload
 */
function useOrgDataResource({
  resource,
  path = '',
  enabled = true,
  orgId: orgIdOverride,
  session: sessionOverride,
  resetOnDisable = true,
  params = {},
  mapResponse,
}) {
  void resource;
  const { session: contextSession } = useAuth();
  const { activeOrgId } = useOrg();

  const { orgId, session } = resolveOrgAndSession({ orgId: orgIdOverride, session: sessionOverride }, activeOrgId, contextSession);

  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Memoize mapResponse if provided as inline function
  const stableMapResponse = useCallback(
    (payload) => (typeof mapResponse === 'function' ? mapResponse(payload) : payload),
    [mapResponse]
  );

  const paramsKey = useMemo(() => {
    if (!params || typeof params !== 'object') return '';
    const keys = Object.keys(params);
    if (keys.length === 0) return '';
    try {
      return JSON.stringify(params);
    } catch {
      return '';
    }
  }, [params]);

  const stableParamsRef = useRef({ key: null, value: {} });
  const stableParams = useMemo(() => {
    if (!paramsKey) {
      stableParamsRef.current = { key: null, value: {} };
      return stableParamsRef.current.value;
    }

    if (stableParamsRef.current.key === paramsKey) {
      return stableParamsRef.current.value;
    }

    stableParamsRef.current = { key: paramsKey, value: params };
    return stableParamsRef.current.value;
  }, [paramsKey, params]);

  // Create stable query string from params - only changes when actual param values change
  const queryString = useMemo(() => {
    if (!paramsKey || !stableParams || Object.keys(stableParams).length === 0) return '';
    return buildSearchParamsString(stableParams, orgId);
  }, [paramsKey, stableParams, orgId]);

  // Fetch function - stable reference, only recreates when critical deps change
  const fetchResource = useCallback(async () => {
    const effectiveEnabled = enabled && shouldInclude(orgId);

    if (!effectiveEnabled) {
      if (resetOnDisable) {
        setData([]);
        setError('');
      }
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');

    try {
      const url = `${path}${queryString ? `?${queryString}` : ''}`;
      const payload = await authenticatedFetch(url, { session });
      const mapped = stableMapResponse(payload);
      const normalized = Array.isArray(mapped) ? mapped : [];
      setData(normalized);
    } catch (err) {
      if (err?.name === 'AbortError') {
        return;
      }
      setError(err?.message || 'Failed to load data');
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [enabled, orgId, resetOnDisable, queryString, session, stableMapResponse, path]);

  // Auto-fetch when dependencies change
  useEffect(() => {
    void fetchResource();
  }, [fetchResource]);

  return {
    data,
    loading,
    error,
    refetch: fetchResource,
  };
}

export function useInstructors(options = {}) {
  const { includeInactive = false, includeUnlinked = false, enabled = true, orgId, session, resetOnDisable = true } = options;
  const params = useMemo(() => ({
    include_inactive: includeInactive ? 'true' : undefined,
    include_unlinked_members: includeUnlinked ? 'true' : undefined,
  }), [includeInactive, includeUnlinked]);

  const { data, loading, error, refetch } = useOrgDataResource({
    resource: 'instructors',
    path: 'instructors',
    enabled,
    orgId,
    session,
    resetOnDisable,
    params,
  });

  // API returns either an array (legacy) or an object { employees, unlinked_members }
  const instructors = Array.isArray(data) ? data : (data?.employees || []);
  const unlinkedMembers = Array.isArray(data?.unlinked_members) ? data.unlinked_members : [];

  return {
    instructors,
    unlinkedMembers,
    loadingInstructors: loading,
    instructorsError: error,
    refetchInstructors: refetch,
  };
}

export function useServices(options = {}) {
  const { enabled = true, orgId, session, resetOnDisable = true } = options;

  const mapResponse = useCallback((payload) => payload?.settings?.available_services, []);

  const { data, loading, error, refetch } = useOrgDataResource({
    resource: 'services',
    path: 'settings',
    enabled,
    orgId,
    session,
    resetOnDisable,
    params: { keys: 'available_services' },
    mapResponse,
  });

  return {
    services: data,
    loadingServices: loading,
    servicesError: error,
    refetchServices: refetch,
  };
}

export function useStudents(options = {}) {
  const {
    status = 'active',
    enabled = true,
    orgId,
    session,
    resetOnDisable = true,
    extraParams = {},
  } = options;

  const params = useMemo(() => ({ status, ...extraParams }), [status, extraParams]);

  const { data, loading, error, refetch } = useOrgDataResource({
    resource: 'students',
    path: 'students-list',
    enabled,
    orgId,
    session,
    resetOnDisable,
    params,
  });

  return {
    students: data,
    loadingStudents: loading,
    studentsError: error,
    refetchStudents: refetch,
  };
}
