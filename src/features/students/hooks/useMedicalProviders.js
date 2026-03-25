import { useCallback, useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { useOrg } from '@/org/OrgContext';
import { authenticatedFetch } from '@/lib/api-client';
import { normalizeMembershipRole, isAdminRole } from '@/features/students/utils/endpoints.js';

const EMPTY_ARRAY = [];

function normalizeProviders(payload) {
  const providers = Array.isArray(payload?.providers) ? payload.providers : Array.isArray(payload) ? payload : [];
  return providers.map((provider) => ({
    ...provider,
    tracks: Array.isArray(provider?.tracks) ? provider.tracks : [],
    is_active: provider?.is_active !== false,
  }));
}

export function useMedicalProviders() {
  const { session } = useAuth();
  const { activeOrg, activeOrgId } = useOrg();
  const membershipRole = normalizeMembershipRole(activeOrg?.membership?.role);
  const canManageProviders = isAdminRole(membershipRole);

  const [providers, setProviders] = useState(EMPTY_ARRAY);
  const [loadingProviders, setLoadingProviders] = useState(false);
  const [providersError, setProvidersError] = useState('');

  const loadProviders = useCallback(async () => {
    if (!session || !activeOrgId) {
      setProviders([]);
      setProvidersError('');
      setLoadingProviders(false);
      return [];
    }

    setLoadingProviders(true);
    setProvidersError('');

    try {
      const searchParams = new URLSearchParams({ org_id: activeOrgId });
      const payload = await authenticatedFetch(`settings/medical-providers?${searchParams.toString()}`, { session });
      const normalized = normalizeProviders(payload);
      setProviders(normalized);
      return normalized;
    } catch (error) {
      console.error('Failed to load medical providers', error);
      setProvidersError('טעינת הגורמים המממנים נכשלה.');
      setProviders([]);
      return [];
    } finally {
      setLoadingProviders(false);
    }
  }, [session, activeOrgId]);

  const mutateProviders = useCallback(async (method, body) => {
    if (!session || !activeOrgId) {
      throw new Error('לא נמצאה ישות ארגון פעילה.');
    }
    if (!canManageProviders) {
      const error = new Error('אין לך הרשאה לנהל גורמים מממנים.');
      error.status = 403;
      throw error;
    }

    const payload = await authenticatedFetch('settings/medical-providers', {
      session,
      method,
      body: {
        org_id: activeOrgId,
        ...body,
      },
    });

    const normalized = normalizeProviders(payload);
    if (normalized.length > 0 || method === 'DELETE') {
      setProviders(normalized);
    }
    return payload;
  }, [session, activeOrgId, canManageProviders]);

  const createProvider = useCallback(async (input) => {
    const name = typeof input === 'string' ? input.trim() : `${input?.name || ''}`.trim();
    if (!name) {
      throw new Error('יש להזין שם גורם מממן.');
    }
    return mutateProviders('POST', typeof input === 'string'
      ? { entity: 'provider', name }
      : { entity: 'provider', ...input, name });
  }, [mutateProviders]);

  const updateProvider = useCallback(async (payload) => mutateProviders('PUT', {
    entity: 'provider',
    ...payload,
  }), [mutateProviders]);

  const deleteProvider = useCallback(async (id) => mutateProviders('DELETE', {
    entity: 'provider',
    id,
  }), [mutateProviders]);

  const createTrack = useCallback(async (payload) => mutateProviders('POST', {
    entity: 'track',
    ...payload,
  }), [mutateProviders]);

  const updateTrack = useCallback(async (payload) => mutateProviders('PUT', {
    entity: 'track',
    ...payload,
  }), [mutateProviders]);

  const deleteTrack = useCallback(async (id) => mutateProviders('DELETE', {
    entity: 'track',
    id,
  }), [mutateProviders]);

  return {
    providers,
    loadingProviders,
    providersError,
    loadProviders,
    createProvider,
    updateProvider,
    deleteProvider,
    createTrack,
    updateTrack,
    deleteTrack,
    canManageProviders,
  };
}
