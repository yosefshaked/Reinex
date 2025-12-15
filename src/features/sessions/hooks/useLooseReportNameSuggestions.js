import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { useOrg } from '@/org/OrgContext';
import { authenticatedFetch } from '@/lib/api-client.js';

/**
 * Hook for suggesting existing students based on loose report name input.
 * Respects permission boundaries:
 * - Admins see all matching students
 * - Member instructors only see their assigned students
 */
export function useLooseReportNameSuggestions(nameInput, enabled = true) {
  const { session } = useAuth();
  const { activeOrgId } = useOrg();
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const debounceRef = useRef(null);

  useEffect(() => {
    if (!enabled || !session || !activeOrgId) {
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
        const searchParams = new URLSearchParams({
          org_id: activeOrgId,
          query: trimmed,
        });
        const results = await authenticatedFetch(`students-search?${searchParams.toString()}`, { session });
        const allResults = Array.isArray(results) ? results : [];
        setSuggestions(allResults);
      } catch (err) {
        setSuggestions([]);
        setError(err?.message || 'חיפוש התלמידים נכשל.');
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) {
        window.clearTimeout(debounceRef.current);
      }
    };
  }, [nameInput, enabled, session, activeOrgId]);

  return { suggestions, loading, error };
}
