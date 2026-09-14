import { useCallback, useEffect, useRef, useState } from 'react';
import { authenticatedFetch } from '@/lib/api-client.js';
import { DEFAULT_BILLING_POLICY, DEFAULT_INSTRUCTOR_EARNINGS_POLICY } from '../utils/lessonDialogModel.js';

/**
 * Session Reports — load which participants already have a (non-legacy) report so the roster can
 * show "documented" vs. an open "file report" action. Only fetched when the feature is enabled and
 * the dialog is open.
 */
export function useLessonSessionReports({ enabled, open, orgId, instanceId }) {
  const [reportsByParticipant, setReportsByParticipant] = useState({});
  const [loadState, setLoadState] = useState({ scopeKey: '', status: 'idle' });
  const requestIdRef = useRef(0);
  const scopeKey = enabled && open && instanceId && orgId ? `${orgId}:${instanceId}` : '';

  const reload = useCallback(async () => {
    const requestId = ++requestIdRef.current;

    if (!scopeKey) {
      setReportsByParticipant({});
      setLoadState({ scopeKey: '', status: 'idle' });
      return;
    }

    setLoadState({ scopeKey, status: 'loading' });
    try {
      const payload = await authenticatedFetch('session-reports', {
        params: { org_id: orgId, lesson_instance_id: instanceId },
      });
      if (requestId !== requestIdRef.current) return;

      const map = {};
      for (const report of Array.isArray(payload?.reports) ? payload.reports : []) {
        if (report?.lesson_participant_id && !report?.is_legacy) {
          map[report.lesson_participant_id] = report;
        }
      }
      setReportsByParticipant(map);
      setLoadState({ scopeKey, status: 'ready' });
    } catch (err) {
      if (requestId !== requestIdRef.current) return;

      console.error('Failed to load session reports for lesson', err);
      setReportsByParticipant({});
      setLoadState({ scopeKey, status: 'error' });
    }
  }, [instanceId, orgId, scopeKey]);

  useEffect(() => {
    void reload();
    return () => {
      requestIdRef.current += 1;
    };
  }, [reload]);

  const recordReport = useCallback((report) => {
    if (!report?.lesson_participant_id) return;
    setReportsByParticipant((current) => ({
      ...current,
      [report.lesson_participant_id]: report,
    }));
  }, []);

  return {
    reportsByParticipant,
    loading: Boolean(scopeKey) && (loadState.scopeKey !== scopeKey || loadState.status === 'loading'),
    loadFailed: loadState.scopeKey === scopeKey && loadState.status === 'error',
    reload,
    recordReport,
  };
}

/**
 * Loads the org's billing consumption and instructor earnings policies; falls back to the defaults
 * when there is no org or the request fails.
 */
export function useLessonFinancePolicies(orgId) {
  const [billingPolicy, setBillingPolicy] = useState(DEFAULT_BILLING_POLICY);
  const [instructorEarningsPolicy, setInstructorEarningsPolicy] = useState(DEFAULT_INSTRUCTOR_EARNINGS_POLICY);

  useEffect(() => {
    if (!orgId) {
      setBillingPolicy(DEFAULT_BILLING_POLICY);
      setInstructorEarningsPolicy(DEFAULT_INSTRUCTOR_EARNINGS_POLICY);
      return undefined;
    }

    let cancelled = false;
    const loadPolicies = async () => {
      try {
        const response = await authenticatedFetch('settings', {
          params: {
            org_id: orgId,
            key: 'billing_consumption_policy,instructor_earnings_policy',
          },
        });
        const settings = response?.settings && typeof response.settings === 'object'
          ? response.settings
          : {};
        if (!cancelled) {
          setBillingPolicy({
            ...DEFAULT_BILLING_POLICY,
            ...(settings.billing_consumption_policy && typeof settings.billing_consumption_policy === 'object'
              ? settings.billing_consumption_policy
              : {}),
          });
          setInstructorEarningsPolicy({
            ...DEFAULT_INSTRUCTOR_EARNINGS_POLICY,
            ...(settings.instructor_earnings_policy && typeof settings.instructor_earnings_policy === 'object'
              ? settings.instructor_earnings_policy
              : {}),
          });
        }
      } catch (loadError) {
        console.error('Failed to load finance policies for attendance dialog:', loadError);
        if (!cancelled) {
          setBillingPolicy(DEFAULT_BILLING_POLICY);
          setInstructorEarningsPolicy(DEFAULT_INSTRUCTOR_EARNINGS_POLICY);
        }
      }
    };

    void loadPolicies();
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  return { billingPolicy, instructorEarningsPolicy };
}

/**
 * Loads the server-side requirements (e.g. whether an instructor-compensation decision is needed)
 * for the absence status being chosen. Results are keyed by participant + status, so a stale answer
 * is never shown for a different selection and callers don't need to reset it by hand.
 */
export function useAbsenceRequirements({ orgId, instanceId, participantId, status, onError }) {
  const [state, setState] = useState({ key: '', status: 'idle', data: null });
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  });

  const key = orgId && instanceId && participantId && status ? `${instanceId}:${participantId}:${status}` : '';

  useEffect(() => {
    if (!key) return undefined;

    let cancelled = false;
    setState({ key, status: 'loading', data: null });
    const loadAbsenceRequirements = async () => {
      try {
        const response = await authenticatedFetch('calendar/attendance', {
          method: 'POST',
          body: {
            action: 'status-requirements',
            org_id: orgId,
            instance_id: instanceId,
            participant_id: participantId,
            participant_status: status,
          },
        });
        if (!cancelled) {
          setState({ key, status: 'ready', data: response && typeof response === 'object' ? response : null });
        }
      } catch (loadError) {
        console.error('Failed to load absence requirements:', loadError);
        if (!cancelled) {
          setState({ key, status: 'error', data: null });
          onErrorRef.current?.(loadError);
        }
      }
    };

    void loadAbsenceRequirements();
    return () => {
      cancelled = true;
    };
  }, [key, orgId, instanceId, participantId, status]);

  const current = state.key === key ? state : null;
  return {
    requirements: current?.data ?? null,
    loading: Boolean(key) && (!current || current.status === 'loading'),
  };
}

/**
 * Our own writes bump lesson/participant versions (attendance also re-syncs closure state), but the
 * `instance` prop only refreshes after the whole calendar refetch. `syncVersionsFromServer` pulls the
 * fresh versions right away so a quick follow-up action on the same lesson isn't rejected as a
 * version conflict; the getters return whichever version is newer.
 */
export function useLessonVersions({ instance, displayParticipants, scopeKey, enabled, fetchLatest }) {
  const [overlay, setOverlay] = useState(null);

  function getCurrentInstanceVersion() {
    const overlayVersion = overlay?.scopeKey === scopeKey ? overlay.instanceVersion : null;
    return typeof overlayVersion === 'number' && overlayVersion > (instance?.version ?? -Infinity)
      ? overlayVersion
      : instance?.version;
  }

  function getCurrentParticipantVersion(participantId) {
    const baseVersion = displayParticipants.find((participant) => participant.id === participantId)?.version;
    const overlayVersion = overlay?.scopeKey === scopeKey ? overlay.participants?.[participantId] : null;
    return typeof overlayVersion === 'number' && overlayVersion > (baseVersion ?? -Infinity)
      ? overlayVersion
      : baseVersion;
  }

  async function syncVersionsFromServer() {
    if (!enabled) return;
    const requestScopeKey = scopeKey;
    try {
      const latest = await fetchLatest();
      setOverlay({
        scopeKey: requestScopeKey,
        instanceVersion: typeof latest?.version === 'number' ? latest.version : null,
        participants: Object.fromEntries(
          (Array.isArray(latest?.participants) ? latest.participants : [])
            .map((participant) => [participant.id, participant.version]),
        ),
      });
    } catch (syncError) {
      console.error('Failed to refresh lesson versions after update:', syncError);
    }
  }

  const resetVersions = useCallback(() => setOverlay(null), []);

  return { getCurrentInstanceVersion, getCurrentParticipantVersion, syncVersionsFromServer, resetVersions };
}
