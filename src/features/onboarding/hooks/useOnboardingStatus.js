import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/auth/AuthContext.jsx';
import { getAuthClient } from '@/lib/supabase-manager.js';

const LOCALSTORAGE_KEY = 'onboarding_completed';

/**
 * Hook to track onboarding completion status
 * Stores in both Supabase user metadata (persistent) and localStorage (fallback)
 */
export function useOnboardingStatus() {
  const { user } = useAuth();
  const [completed, setCompleted] = useState(false);
  const [loading, setLoading] = useState(true);

  // Load onboarding status on mount
  useEffect(() => {
    async function loadStatus() {
      if (!user?.id) {
        setLoading(false);
        return;
      }

      try {
        const authClient = getAuthClient();
        const { data, error } = await authClient.auth.getUser();

        if (error) throw error;

        const userMetadata = data?.user?.user_metadata || {};
        const isCompleted = userMetadata.onboarding_completed === true;

        setCompleted(isCompleted);

        // Also sync with localStorage
        if (isCompleted) {
          localStorage.setItem(LOCALSTORAGE_KEY, 'true');
        }
      } catch (error) {
        console.error('Failed to load onboarding status from Supabase:', error);

        // Fallback to localStorage
        const localStatus = localStorage.getItem(LOCALSTORAGE_KEY) === 'true';
        setCompleted(localStatus);
      } finally {
        setLoading(false);
      }
    }

    loadStatus();
  }, [user?.id]);

  // Mark onboarding as completed
  const markCompleted = useCallback(async () => {
    if (!user?.id) return;

    try {
      const authClient = getAuthClient();

      // Update user metadata in Supabase
      const { error } = await authClient.auth.updateUser({
        data: {
          onboarding_completed: true,
          onboarding_completed_at: new Date().toISOString(),
        },
      });

      if (error) throw error;

      setCompleted(true);
      localStorage.setItem(LOCALSTORAGE_KEY, 'true');
    } catch (error) {
      console.error('Failed to save onboarding status to Supabase:', error);

      // Still mark as completed locally
      setCompleted(true);
      localStorage.setItem(LOCALSTORAGE_KEY, 'true');
    }
  }, [user?.id]);

  // Reset onboarding (for "Show me again" feature)
  const reset = useCallback(async () => {
    if (!user?.id) return;

    try {
      const authClient = getAuthClient();

      const { error } = await authClient.auth.updateUser({
        data: {
          onboarding_completed: false,
          onboarding_reset_at: new Date().toISOString(),
        },
      });

      if (error) throw error;

      setCompleted(false);
      localStorage.removeItem(LOCALSTORAGE_KEY);
    } catch (error) {
      console.error('Failed to reset onboarding status in Supabase:', error);

      // Still reset locally
      setCompleted(false);
      localStorage.removeItem(LOCALSTORAGE_KEY);
    }
  }, [user?.id]);

  return {
    completed,
    loading,
    markCompleted,
    reset,
  };
}
