import { useState, useEffect, useCallback } from 'react';
import { useOrg } from '@/org/OrgContext';
import { authenticatedFetch } from '@/lib/api-client.js';

/**
 * Hook for fetching calendar instances
 */
export function useCalendarInstances(date, viewMode = 'day', instructorId = null) {
  const { activeOrgId } = useOrg();
  const [instances, setInstances] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [refetchTrigger, setRefetchTrigger] = useState(0);

  const refetch = useCallback(() => {
    setRefetchTrigger(prev => prev + 1);
  }, []);

  const getDateRange = (dateString, mode) => {
    if (mode === 'week') {
      const date = new Date(dateString);
      const day = date.getDay();
      const diff = date.getDate() - day + (day === 0 ? -6 : 1);
      const weekStart = new Date(date.setDate(diff));
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);
      return {
        start_date: weekStart.toISOString().split('T')[0],
        end_date: weekEnd.toISOString().split('T')[0],
      };
    }
    return { date: dateString };
  };

  useEffect(() => {
    if (!activeOrgId || !date) {
      return;
    }

    async function fetchInstances() {
      setIsLoading(true);
      setError(null);

      try {
        const params = {
          org_id: activeOrgId,
          ...getDateRange(date, viewMode),
          ...(instructorId ? { instructor_id: instructorId } : {}),
        };
        
        const data = await authenticatedFetch('calendar/instances', {
          params,
        });
        setInstances(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error('Error fetching calendar instances:', err);
        setError(err?.message || 'Failed to load instances');
      } finally {
        setIsLoading(false);
      }
    }

    fetchInstances();
  }, [activeOrgId, date, viewMode, instructorId, refetchTrigger]);

  return { instances, isLoading, error, refetch };
}

/**
 * Hook for fetching calendar instructors
 */
export function useCalendarInstructors(includeInactive = false) {
  const { activeOrgId } = useOrg();
  const [instructors, setInstructors] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [refetchTrigger, setRefetchTrigger] = useState(0);

  const refetch = useCallback(() => {
    setRefetchTrigger(prev => prev + 1);
  }, []);

  useEffect(() => {
    if (!activeOrgId) {
      return;
    }

    async function fetchInstructors() {
      setIsLoading(true);
      setError(null);

      try {
        const data = await authenticatedFetch('calendar/instructors', {
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
  }, [activeOrgId, includeInactive, refetchTrigger]);

  return { instructors, isLoading, error, refetch };
}
