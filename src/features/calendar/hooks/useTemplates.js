import { useState, useEffect, useCallback } from 'react';
import { useOrg } from '@/org/OrgContext';
import { authenticatedFetch } from '@/lib/api-client.js';

/**
 * Hook for fetching all lesson templates (Template Manager grid view)
 * @param {{ showInactive?: boolean, instructorId?: string }} options
 */
export function useTemplates({ showInactive = false, instructorId = null } = {}) {
  const { activeOrgId } = useOrg();
  const [templates, setTemplates] = useState([]);
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

    async function fetchTemplates() {
      setIsLoading(true);
      setError(null);

      try {
        const params = {
          org_id: activeOrgId,
          all: 'true',
        };

        if (showInactive) {
          params.show_inactive = 'true';
        }

        if (instructorId) {
          params.instructor_id = instructorId;
        }

        const data = await authenticatedFetch('lesson-templates', { params });

        if (!cancelled) {
          setTemplates(Array.isArray(data) ? data : []);
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Error fetching templates:', err);
          setError(err?.message || 'Failed to load templates');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    fetchTemplates();

    return () => {
      cancelled = true;
    };
  }, [activeOrgId, showInactive, instructorId, refetchTrigger]);

  return { templates, isLoading, error, refetch };
}

/**
 * Hook for template CRUD operations
 */
export function useTemplateMutations() {
  const { activeOrgId } = useOrg();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const createTemplate = useCallback(
    async (templateData) => {
      setIsSubmitting(true);
      try {
        const data = await authenticatedFetch('lesson-templates', {
          method: 'POST',
          body: {
            ...templateData,
            org_id: activeOrgId,
          },
        });
        return { data, error: null };
      } catch (err) {
        return { data: null, error: err?.message || 'Failed to create template' };
      } finally {
        setIsSubmitting(false);
      }
    },
    [activeOrgId],
  );

  const updateTemplate = useCallback(
    async (templateId, updates) => {
      setIsSubmitting(true);
      try {
        const data = await authenticatedFetch(`lesson-templates/${templateId}`, {
          method: 'PUT',
          body: {
            ...updates,
            template_id: templateId,
            org_id: activeOrgId,
          },
        });
        return { data, error: null };
      } catch (err) {
        return { data: null, error: err?.message || 'Failed to update template' };
      } finally {
        setIsSubmitting(false);
      }
    },
    [activeOrgId],
  );

  const deleteTemplate = useCallback(
    async (templateId) => {
      setIsSubmitting(true);
      try {
        const data = await authenticatedFetch(`lesson-templates/${templateId}`, {
          method: 'DELETE',
          body: {
            template_id: templateId,
            org_id: activeOrgId,
          },
        });
        return { data, error: null };
      } catch (err) {
        return { data: null, error: err?.message || 'Failed to delete template' };
      } finally {
        setIsSubmitting(false);
      }
    },
    [activeOrgId],
  );

  return { createTemplate, updateTemplate, deleteTemplate, isSubmitting };
}
