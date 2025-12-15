import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { useOrg } from '@/org/OrgContext';
import { authenticatedFetch } from '@/lib/api-client.js';

function buildQueryParams(orgId, params) {
  const searchParams = new URLSearchParams();
  if (orgId) {
    searchParams.set('org_id', orgId);
  }
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && `${value}`.trim() !== '') {
      searchParams.set(key, value);
    }
  });
  return searchParams;
}

export function useStudentNameSuggestions(nameInput, { excludeStudentId } = {}) {
  const { session } = useAuth();
  const { activeOrgId } = useOrg();
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const debounceRef = useRef(null);

  useEffect(() => {
    if (!session || !activeOrgId) {
      setSuggestions([]);
      return undefined;
    }

    const trimmed = typeof nameInput === 'string' ? nameInput.trim() : '';
    if (!trimmed || trimmed.length < 2) {
      setSuggestions([]);
      return undefined;
    }

    setLoading(true);
    setError('');

    debounceRef.current = window.setTimeout(async () => {
      try {
        const searchParams = buildQueryParams(activeOrgId, { query: trimmed });
        const results = await authenticatedFetch(`students-search?${searchParams.toString()}`, { session });
        const allResults = Array.isArray(results) ? results : [];
        
        // Filter out the current student being edited
        const filtered = excludeStudentId 
          ? allResults.filter(student => student.id !== excludeStudentId)
          : allResults;
        
        setSuggestions(filtered);
      } catch (err) {
        setSuggestions([]);
        setError(err?.message || 'חיפוש התלמידים נכשל.');
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => {
      if (debounceRef.current) {
        window.clearTimeout(debounceRef.current);
      }
    };
  }, [nameInput, session, activeOrgId, excludeStudentId]);

  return { suggestions, loading, error };
}

export function useNationalIdGuard(nationalIdInput, { excludeStudentId } = {}) {
  const { session } = useAuth();
  const { activeOrgId } = useOrg();
  const [duplicate, setDuplicate] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const debounceRef = useRef(null);
  const lastCheckedRef = useRef('');
  const lastDuplicateIdRef = useRef('');

  useEffect(() => {
    if (!session || !activeOrgId) {
      console.log('[useNationalIdGuard] Missing session or org, clearing state', {
        hasSession: !!session,
        activeOrgId: activeOrgId || 'none',
      });
      setDuplicate(null);
      lastCheckedRef.current = '';
      lastDuplicateIdRef.current = '';
      return undefined;
    }

    const trimmed = typeof nationalIdInput === 'string' ? nationalIdInput.trim() : '';
    console.log('[useNationalIdGuard] Input changed', {
      raw: nationalIdInput,
      trimmed,
      isEmpty: !trimmed,
      excludeStudentId: excludeStudentId || 'none',
    });

    if (!trimmed) {
      console.log('[useNationalIdGuard] Empty input, clearing duplicate state');
      setDuplicate(null);
      setError('');
      lastCheckedRef.current = '';
      lastDuplicateIdRef.current = '';
      return undefined;
    }

    console.log('[useNationalIdGuard] Starting debounced check (250ms)', { trimmed });
    setLoading(true);
    setError('');

    debounceRef.current = window.setTimeout(async () => {
      try {
        const searchParams = buildQueryParams(activeOrgId, {
          national_id: trimmed,
          exclude_id: excludeStudentId,
        });
        const url = `students-check-id?${searchParams.toString()}`;
        console.log('[useNationalIdGuard] Calling API', {
          url,
          nationalId: trimmed,
          excludeStudentId: excludeStudentId || 'none',
          orgId: activeOrgId,
        });

        const payload = await authenticatedFetch(url, { session });
        console.log('[useNationalIdGuard] API response received', {
          payload,
          exists: payload?.exists,
          hasStudent: !!payload?.student,
          studentId: payload?.student?.id,
          studentName: payload?.student?.name,
        });

        lastCheckedRef.current = trimmed;

        if (payload?.exists && payload.student) {
          // Extra safety check: ensure the duplicate is not the student being excluded
          if (excludeStudentId && payload.student.id === excludeStudentId) {
            console.log('[useNationalIdGuard] Duplicate is excluded student, ignoring', {
              duplicateId: payload.student.id,
              excludeStudentId,
            });
            setDuplicate(null);
            lastDuplicateIdRef.current = '';
          } else {
            console.log('[useNationalIdGuard] Setting duplicate state', {
              student: payload.student,
              id: payload.student.id,
              name: payload.student.name,
            });
            setDuplicate(payload.student);
            lastDuplicateIdRef.current = payload.student.id || trimmed;
          }
        } else {
          console.log('[useNationalIdGuard] No duplicate found, clearing state');
          setDuplicate(null);
          lastDuplicateIdRef.current = '';
        }
      } catch (err) {
        console.error('[useNationalIdGuard] API call failed', {
          error: err,
          message: err?.message,
          status: err?.status,
          nationalId: trimmed,
        });
        setDuplicate(null);
        lastDuplicateIdRef.current = '';
        setError(err?.message || 'אימות תעודה נכשל.');
      } finally {
        console.log('[useNationalIdGuard] Finished check, setting loading=false');
        setLoading(false);
      }
    }, 250);

    return () => {
      if (debounceRef.current) {
        window.clearTimeout(debounceRef.current);
      }
    };
  }, [nationalIdInput, session, activeOrgId, excludeStudentId]);

  return { duplicate, loading, error };
}
