import { useState, useEffect, useCallback, useRef } from 'react';
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
  const pendingCountRef = useRef(0);

  const beginSubmitting = useCallback(() => {
    pendingCountRef.current += 1;
    setIsSubmitting(true);
  }, []);

  const finishSubmitting = useCallback(() => {
    pendingCountRef.current = Math.max(0, pendingCountRef.current - 1);
    if (pendingCountRef.current === 0) {
      setIsSubmitting(false);
    }
  }, []);

  const createTemplate = useCallback(
    async (templateData) => {
      beginSubmitting();
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
        finishSubmitting();
      }
    },
    [activeOrgId, beginSubmitting, finishSubmitting],
  );

  const updateTemplate = useCallback(
    async (templateId, updates) => {
      beginSubmitting();
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
        finishSubmitting();
      }
    },
    [activeOrgId, beginSubmitting, finishSubmitting],
  );

  const deleteTemplate = useCallback(
    async (templateId) => {
      beginSubmitting();
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
        finishSubmitting();
      }
    },
    [activeOrgId, beginSubmitting, finishSubmitting],
  );

  const createTemplateOverride = useCallback(
    async (overrideData) => {
      beginSubmitting();
      try {
        const data = await authenticatedFetch('lesson-template-overrides', {
          method: 'POST',
          body: {
            ...overrideData,
            org_id: activeOrgId,
          },
        });
        return { data, error: null };
      } catch (err) {
        return { data: null, error: err?.message || 'Failed to create template override' };
      } finally {
        finishSubmitting();
      }
    },
    [activeOrgId, beginSubmitting, finishSubmitting],
  );

  const deleteTemplateOverride = useCallback(
    async (overrideId) => {
      beginSubmitting();
      try {
        const data = await authenticatedFetch(`lesson-template-overrides/${overrideId}`, {
          method: 'DELETE',
          body: {
            override_id: overrideId,
            org_id: activeOrgId,
          },
        });
        return { data, error: null };
      } catch (err) {
        return { data: null, error: err?.message || 'Failed to delete template override' };
      } finally {
        finishSubmitting();
      }
    },
    [activeOrgId, beginSubmitting, finishSubmitting],
  );

  return {
    createTemplate,
    updateTemplate,
    deleteTemplate,
    createTemplateOverride,
    deleteTemplateOverride,
    isSubmitting,
  };
}

/**
 * Hook for loading date-specific overrides for a single template.
 * @param {string|null} templateId
 * @param {{ enabled?: boolean }} options
 */
export function useTemplateOverrides(templateId, { enabled = true } = {}) {
  const { activeOrgId } = useOrg();
  const [overrides, setOverrides] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [refetchTrigger, setRefetchTrigger] = useState(0);

  const refetch = useCallback(() => {
    setRefetchTrigger((prev) => prev + 1);
  }, []);

  useEffect(() => {
    if (!enabled || !activeOrgId || !templateId) {
      setOverrides([]);
      setError(null);
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    async function fetchOverrides() {
      setIsLoading(true);
      setError(null);

      try {
        const data = await authenticatedFetch('lesson-template-overrides', {
          params: {
            org_id: activeOrgId,
            template_id: templateId,
          },
        });

        if (!cancelled) {
          setOverrides(Array.isArray(data) ? data : []);
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Error fetching template overrides:', err);
          setError(err?.message || 'Failed to load template overrides');
          setOverrides([]);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    fetchOverrides();

    return () => {
      cancelled = true;
    };
  }, [activeOrgId, templateId, enabled, refetchTrigger]);

  return { overrides, isLoading, error, refetch };
}
