import { useCallback, useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { useOrg } from '@/org/OrgContext';
import { authenticatedFetch } from '@/lib/api-client';
import { normalizeMembershipRole, isAdminRole } from '@/features/students/utils/endpoints.js';
import { normalizeTagCatalog } from '@/features/students/utils/tags.js';

const EMPTY_ARRAY = [];

export function useStudentTags() {
  const { session } = useAuth();
  const { activeOrg, activeOrgId } = useOrg();
  const membershipRole = normalizeMembershipRole(activeOrg?.membership?.role);
  const canManageTags = isAdminRole(membershipRole);

  const [tagOptions, setTagOptions] = useState(EMPTY_ARRAY);
  const [loadingTags, setLoadingTags] = useState(false);
  const [tagsError, setTagsError] = useState('');

  const loadTags = useCallback(async () => {
    if (!session || !activeOrgId) {
      setTagOptions([]);
      setTagsError('');
      setLoadingTags(false);
      return [];
    }

    setLoadingTags(true);
    setTagsError('');

    try {
      const searchParams = new URLSearchParams({ org_id: activeOrgId });
      const payload = await authenticatedFetch(`settings/student-tags?${searchParams.toString()}`, { session });
      const normalized = normalizeTagCatalog(payload?.tags ?? payload);
      setTagOptions(normalized);
      return normalized;
    } catch (error) {
      console.error('Failed to load student tags', error);
      setTagsError('טעינת התגיות נכשלה.');
      setTagOptions([]);
      return [];
    } finally {
      setLoadingTags(false);
    }
  }, [session, activeOrgId]);

  const createTag = useCallback(async (name) => {
    if (!session || !activeOrgId) {
      throw new Error('לא נמצאה ישות ארגון פעילה.');
    }
    if (!canManageTags) {
      const error = new Error('אין לך הרשאה להוסיף תגיות.');
      error.status = 403;
      throw error;
    }

    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (!trimmed) {
      throw new Error('יש להזין שם תגית.');
    }

    const payload = await authenticatedFetch('settings/student-tags', {
      session,
      method: 'POST',
      body: {
        org_id: activeOrgId,
        name: trimmed,
      },
    });

    return payload;
  }, [session, activeOrgId, canManageTags]);

  return {
    tagOptions,
    loadingTags,
    tagsError,
    loadTags,
    createTag,
    canManageTags,
  };
}
