import { useState, useEffect, useCallback } from 'react';
import { useOrg } from '@/org/OrgContext';
import { useAuth } from '@/auth/AuthContext.jsx';
import { authenticatedFetch } from '@/lib/api-client.js';

/**
 * Hook for fetching calendar instances
 */
export function useCalendarInstances(date, instructorId = null) {
  const { currentOrg } = useOrg();
  const [instances, setInstances] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [refetchTrigger, setRefetchTrigger] = useState(0);

  const refetch = useCallback(() => {
    setRefetchTrigger(prev => prev + 1);
  }, []);

  useEffect(() => {
    if (!currentOrg?.id || !date) {
      return;
    }

    async function fetchInstances() {
      setIsLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({
          org_id: currentOrg.id,
          date: date,
        });

        if (instructorId) {
          params.append('instructor_id', instructorId);
        }

        const response = await fetch(`/api/calendar/instances?${params}`, {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('access_token')}`,
          },
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch instances: ${response.statusText}`);
        }

        const data = await response.json();
        setInstances(data);
      } catch (err) {
        console.error('Error fetching calendar instances:', err);
        setError(err.message);
      } finally {
        setIsLoading(false);
      }
    }

    fetchInstances();
  }, [currentOrg?.id, date, instructorId, refetchTrigger]);

  return { instances, isLoading, error, refetch };
}

/**
 * Hook for fetching calendar instructors
 */
export function useCalendarInstructors(includeInactive = false) {
  const { activeOrgId } = useOrg();
  const { session } = useAuth();
  const [instructors, setInstructors] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [refetchTrigger, setRefetchTrigger] = useState(0);

  const refetch = useCallback(() => {
    setRefetchTrigger(prev => prev + 1);
  }, []);

  useEffect(() => {
    if (!activeOrgId || !session) {
      return;
    }

    async function fetchInstructors() {
      setIsLoading(true);
      setError(null);

      try {
        const data = await authenticatedFetch('calendar/instructors', {
          session,
          params: {
            org_id: activeOrgId,
            include_inactive: includeInactive,
          },
        });
        setInstructors(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error('Error fetching calendar instructors:', err);
        setError(err?.message || 'Failed to load instructors');
      } finally {
        setIsLoading(false);
      }
    }

    fetchInstructors();
  }, [activeOrgId, includeInactive, refetchTrigger, session]);

  return { instructors, isLoading, error, refetch };
}
