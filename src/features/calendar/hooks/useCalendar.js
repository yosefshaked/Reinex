import { useState, useEffect } from 'react';
import { useOrganization } from '../../../contexts/OrganizationContext';

/**
 * Hook for fetching calendar instances
 */
export function useCalendarInstances(date, instructorId = null) {
  const { currentOrg } = useOrganization();
  const [instances, setInstances] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

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
  }, [currentOrg?.id, date, instructorId]);

  return { instances, isLoading, error };
}

/**
 * Hook for fetching calendar instructors
 */
export function useCalendarInstructors(includeInactive = false) {
  const { currentOrg } = useOrganization();
  const [instructors, setInstructors] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!currentOrg?.id) {
      return;
    }

    async function fetchInstructors() {
      setIsLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({
          org_id: currentOrg.id,
          include_inactive: includeInactive.toString(),
        });

        const response = await fetch(`/api/calendar/instructors?${params}`, {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('access_token')}`,
          },
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch instructors: ${response.statusText}`);
        }

        const data = await response.json();
        setInstructors(data);
      } catch (err) {
        console.error('Error fetching calendar instructors:', err);
        setError(err.message);
      } finally {
        setIsLoading(false);
      }
    }

    fetchInstructors();
  }, [currentOrg?.id, includeInactive]);

  return { instructors, isLoading, error };
}
