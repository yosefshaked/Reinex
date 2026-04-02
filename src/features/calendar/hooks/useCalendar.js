import { useState, useEffect, useCallback, useRef } from 'react';
import { useOrg } from '@/org/OrgContext';
import { authenticatedFetch } from '@/lib/api-client.js';

function toLocalDateString(dateObj) {
  if (!(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) return null;
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getWeekStart(dateString) {
  const date = new Date(dateString);
  const day = date.getDay();
  date.setDate(date.getDate() - day);
  return date;
}

/**
 * Hook for fetching calendar instances
 */
export function useCalendarInstances(date, viewMode = 'day', instructorId = null) {
  const { activeOrgId } = useOrg();
  const [instances, setInstances] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [refetchTrigger, setRefetchTrigger] = useState(0);
  const latestRequestIdRef = useRef(0);

  const refetch = useCallback(() => {
    setRefetchTrigger(prev => prev + 1);
  }, []);

  const getDateRange = (dateString, mode) => {
    if (mode === 'week') {
      const weekStart = getWeekStart(dateString);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);
      return {
        start_date: toLocalDateString(weekStart),
        end_date: toLocalDateString(weekEnd),
      };
    }
    return { date: dateString };
  };

  useEffect(() => {
    if (!activeOrgId || !date) {
      setInstances([]);
      setIsLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    const requestId = latestRequestIdRef.current + 1;
    latestRequestIdRef.current = requestId;

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

        if (cancelled || requestId !== latestRequestIdRef.current) {
          return;
        }

        setInstances(Array.isArray(data) ? data : []);
      } catch (err) {
        if (cancelled || requestId !== latestRequestIdRef.current) {
          return;
        }
        console.error('Error fetching calendar instances:', err);
        setError(err?.message || 'Failed to load instances');
      } finally {
        if (!cancelled && requestId === latestRequestIdRef.current) {
          setIsLoading(false);
        }
      }
    }

    void fetchInstances();

    return () => {
      cancelled = true;
    };
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
  const latestRequestIdRef = useRef(0);

  const refetch = useCallback(() => {
    setRefetchTrigger(prev => prev + 1);
  }, []);

  useEffect(() => {
    if (!activeOrgId) {
      setInstructors([]);
      setIsLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    const requestId = latestRequestIdRef.current + 1;
    latestRequestIdRef.current = requestId;

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

        if (cancelled || requestId !== latestRequestIdRef.current) {
          return;
        }

        setInstructors(Array.isArray(data) ? data : []);
      } catch (err) {
        if (cancelled || requestId !== latestRequestIdRef.current) {
          return;
        }
        console.error('Error fetching calendar instructors:', err);
        setError(err?.message || 'Failed to load instructors');
      } finally {
        if (!cancelled && requestId === latestRequestIdRef.current) {
          setIsLoading(false);
        }
      }
    }

    void fetchInstructors();

    return () => {
      cancelled = true;
    };
  }, [activeOrgId, includeInactive, refetchTrigger]);

  return { instructors, isLoading, error, refetch };
}
