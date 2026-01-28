import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { useOrg } from '@/org/OrgContext';
import { toast } from 'sonner';

/**
 * Hook for managing guardians (parents, legal representatives)
 * Handles fetching, creating, and managing guardian relationships
 */
export function useGuardians() {
  const { session } = useAuth();
  const { activeOrgId } = useOrg();
  const [guardians, setGuardians] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchGuardians = useCallback(async () => {
    if (!session?.access_token || !activeOrgId) {
      setGuardians([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/guardians?org_id=${activeOrgId}`, {
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'X-Supabase-Authorization': `Bearer ${session.access_token}`,
          'x-supabase-authorization': `Bearer ${session.access_token}`,
          'x-supabase-auth': `Bearer ${session.access_token}`,
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `Failed to fetch guardians: ${response.status}`);
      }

      const data = await response.json();
      setGuardians(data.guardians || []);
    } catch (err) {
      console.error('[useGuardians] Fetch error:', err);
      setError(err.message);
      setGuardians([]);
    } finally {
      setIsLoading(false);
    }
  }, [session, activeOrgId]);

  useEffect(() => {
    fetchGuardians();
  }, [fetchGuardians]);

  const createGuardian = useCallback(async (guardianData) => {
    if (!session?.access_token || !activeOrgId) {
      throw new Error('Missing authentication or organization context');
    }

    try {
      const response = await fetch('/api/guardians', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'X-Supabase-Authorization': `Bearer ${session.access_token}`,
          'x-supabase-authorization': `Bearer ${session.access_token}`,
          'x-supabase-auth': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          org_id: activeOrgId,
          ...guardianData,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `Failed to create guardian: ${response.status}`);
      }

      const data = await response.json();
      toast.success('אפוטרופוס נוצר בהצלחה');
      
      // Refresh the list
      await fetchGuardians();
      
      return data.guardian;
    } catch (err) {
      console.error('[useGuardians] Create error:', err);
      toast.error(`שגיאה ביצירת אפוטרופוס: ${err.message}`);
      throw err;
    }
  }, [session, activeOrgId, fetchGuardians]);

  return {
    guardians,
    isLoading,
    error,
    fetchGuardians,
    createGuardian,
  };
}
