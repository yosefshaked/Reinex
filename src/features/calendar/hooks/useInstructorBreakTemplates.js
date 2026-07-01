import { useState, useEffect, useCallback } from 'react';
import { useOrg } from '@/org/OrgContext';
import { authenticatedFetch } from '@/lib/api-client.js';

/**
 * Hook for fetching all break templates for the org (Template Manager grid view)
 * @param {{ showInactive?: boolean, instructorId?: string }} options
 */
export function useInstructorBreakTemplates({ showInactive = false, instructorId = null } = {}) {
  const { activeOrgId } = useOrg();
  const [breakTemplates, setBreakTemplates] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [refetchTrigger, setRefetchTrigger] = useState(0);

  const refetch = useCallback(() => {
    setRefetchTrigger((prev) => prev + 1);
  }, []);

  useEffect(() => {
    if (!activeOrgId) {
      return;
    }

    let cancelled = false;

    async function fetchBreakTemplates() {
      setIsLoading(true);
      setError(null);

      try {
        const params = { org_id: activeOrgId };

        if (showInactive) {
          params.show_inactive = 'true';
        }

        if (instructorId) {
          params.instructor_employee_id = instructorId;
        }

        const data = await authenticatedFetch('instructor-break-templates', { params });

        if (!cancelled) {
          setBreakTemplates(Array.isArray(data) ? data : []);
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Error fetching break templates:', err);
          setError(err?.message || 'Failed to load break templates');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    fetchBreakTemplates();

    return () => {
      cancelled = true;
    };
  }, [activeOrgId, showInactive, instructorId, refetchTrigger]);

  return { breakTemplates, isLoading, error, refetch };
}
