import { useState, useEffect, useCallback, useRef } from 'react';
import { useOrg } from '@/org/OrgContext';
import { authenticatedFetch } from '@/lib/api-client.js';
import { getWeekRangeDateStrings } from '../utils/localDate.js';

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
      const { start, end } = getWeekRangeDateStrings(dateString);
      return {
        start_date: start,
        end_date: end,
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

/**
 * Hook for fetching instructor breaks for the visible date range
 */
export function useInstructorBreaks(date, viewMode = 'day') {
  const { activeOrgId } = useOrg();
  const [breaks, setBreaks] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [refetchTrigger, setRefetchTrigger] = useState(0);
  const latestRequestIdRef = useRef(0);

  const refetch = useCallback(() => {
    setRefetchTrigger(prev => prev + 1);
  }, []);

  useEffect(() => {
    if (!activeOrgId || !date) {
      setBreaks([]);
      setIsLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    const requestId = latestRequestIdRef.current + 1;
    latestRequestIdRef.current = requestId;

    async function fetchBreaks() {
      setIsLoading(true);
      setError(null);

      try {
        let startDate = date;
        let endDate = date;

        if (viewMode === 'week') {
          const { start, end } = getWeekRangeDateStrings(date);
          startDate = start;
          endDate = end;
        }

        const data = await authenticatedFetch('instructor-breaks', {
          params: {
            org_id: activeOrgId,
            start_date: startDate,
            end_date: endDate,
          },
        });

        if (cancelled || requestId !== latestRequestIdRef.current) {
          return;
        }

        setBreaks(Array.isArray(data) ? data : []);
      } catch (err) {
        if (cancelled || requestId !== latestRequestIdRef.current) {
          return;
        }
        console.error('Error fetching instructor breaks:', err);
        setError(err?.message || 'Failed to load breaks');
      } finally {
        if (!cancelled && requestId === latestRequestIdRef.current) {
          setIsLoading(false);
        }
      }
    }

    void fetchBreaks();

    return () => {
      cancelled = true;
    };
  }, [activeOrgId, date, viewMode, refetchTrigger]);

  return { breaks, isLoading, error, refetch };
}
