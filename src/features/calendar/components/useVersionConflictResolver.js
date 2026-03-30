import { useCallback, useState } from 'react';

function isVersionConflict(error) {
  return error?.status === 409 && error?.data?.code === 'version_conflict';
}

export function useVersionConflictResolver({ fetchLatestValue, clearError }) {
  const [conflictState, setConflictState] = useState(null);
  const [isResolvingConflict, setIsResolvingConflict] = useState(false);

  const clearConflict = useCallback(() => {
    setConflictState(null);
  }, []);

  const handleVersionConflict = useCallback(async (error, adapter, payload) => {
    if (!isVersionConflict(error) || !adapter || typeof fetchLatestValue !== 'function') {
      return false;
    }

    const latestValue = await fetchLatestValue();
    const nextConflictState = adapter.buildConflictState({ payload, latestValue, error });

    setConflictState({
      ...nextConflictState,
      adapter,
      payload,
      latestValue,
    });
    clearError?.();
    return true;
  }, [clearError, fetchLatestValue]);

  const applyConflictOverride = useCallback(async ({ onUnhandledError } = {}) => {
    if (!conflictState?.adapter?.retry) return false;

    setIsResolvingConflict(true);
    clearError?.();

    try {
      await conflictState.adapter.retry({
        latestValue: conflictState.latestValue,
        payload: conflictState.payload,
        conflictState,
      });
      setConflictState(null);
      return true;
    } catch (error) {
      if (isVersionConflict(error)) {
        const latestValue = await fetchLatestValue();
        const nextConflictState = conflictState.adapter.buildConflictState({
          payload: conflictState.payload,
          latestValue,
          error,
        });
        setConflictState({
          ...nextConflictState,
          adapter: conflictState.adapter,
          payload: conflictState.payload,
          latestValue,
        });
        return false;
      }

      onUnhandledError?.(error);
      return false;
    } finally {
      setIsResolvingConflict(false);
    }
  }, [clearError, conflictState, fetchLatestValue]);

  return {
    conflictState,
    isResolvingConflict,
    handleVersionConflict,
    applyConflictOverride,
    clearConflict,
  };
}

/*
Helper boundary notes:
- Keep in this helper: generic OCC handling only. Detect the version-conflict response,
  load the latest server value, keep conflict UI state, and run the selected override retry.
- Keep in each action function: action-specific request bodies, user-facing labels,
  action-specific diff summaries, and the exact retry implementation for that mutation.
- Do not push mutation-specific branching into this helper. Attendance, lesson edits,
  cancellations, and report-status updates have different payloads and different
  "meaningful differences", so the helper should orchestrate them, not define them.
*/
