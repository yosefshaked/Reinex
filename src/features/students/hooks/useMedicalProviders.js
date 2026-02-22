import { useCallback, useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { useOrg } from '@/org/OrgContext';
import { authenticatedFetch } from '@/lib/api-client';
import { normalizeMembershipRole, isAdminRole } from '@/features/students/utils/endpoints.js';

const EMPTY_ARRAY = [];

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
      const normalized = Array.isArray(payload?.providers) ? payload.providers : Array.isArray(payload) ? payload : [];
      setProviders(normalized);
      return normalized;
    } catch (error) {
      console.error('Failed to load medical providers', error);
      setProvidersError('טעינת קופות החולים נכשלה.');
      setProviders([]);
      return [];
    } finally {
      setLoadingProviders(false);
    }
  }, [session, activeOrgId]);

  const createProvider = useCallback(async (name) => {
    if (!session || !activeOrgId) {
      throw new Error('לא נמצאה ישות ארגון פעילה.');
    }
    if (!canManageProviders) {
      const error = new Error('אין לך הרשאה להוסיף קופות חולים.');
      error.status = 403;
      throw error;
    }

    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (!trimmed) {
      throw new Error('יש להזין שם קופת חולים.');
    }

    const payload = await authenticatedFetch('settings/medical-providers', {
      session,
      method: 'POST',
      body: {
        org_id: activeOrgId,
        name: trimmed,
      },
    });

    return payload;
  }, [session, activeOrgId, canManageProviders]);

  return {
    providers,
    loadingProviders,
    providersError,
    loadProviders,
    createProvider,
    canManageProviders,
  };
}
