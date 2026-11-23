import { useCallback, useEffect, useState } from 'react';
import { fetchDatedSetting, saveDatedSetting } from '@/features/settings/api/settings.js';
import { versionInForce } from '@/features/settings/lib/dated-setting.js';
import { todayKey } from '@/lib/local-time.js';

export const INSTRUCTOR_EARNINGS_POLICY_KEY = 'instructor_earnings_policy';

export const DEFAULT_INSTRUCTOR_EARNINGS_POLICY = Object.freeze({
  attended: true,
  no_show: true,
  cancelled_student: false,
  cancelled_clinic: false,
});

const STATUSES = Object.keys(DEFAULT_INSTRUCTOR_EARNINGS_POLICY);

function readPolicy(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : DEFAULT_INSTRUCTOR_EARNINGS_POLICY;
  return Object.fromEntries(STATUSES.map((status) => [status, Boolean(source[status] ?? DEFAULT_INSTRUCTOR_EARNINGS_POLICY[status])]));
}

/**
 * The instructor earnings policy (which participant outcomes pay the instructor) as the billing
 * settings edit it. It is a dated setting: the screen starts from today's version, saving adds a
 * version from `effectiveDate` (default today), and only when the policy differs from the version
 * in force on that date, so saving the student billing policy alone never adds an earnings version.
 */
export function useInstructorEarningsPolicy({ session, orgId, enabled = true }) {
  const [policy, setPolicy] = useState(() => readPolicy(null));
  const [versions, setVersions] = useState([]);
  const [effectiveDate, setEffectiveDate] = useState(() => todayKey());
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!enabled || !session || !orgId) {
      setPolicy(readPolicy(null));
      setVersions([]);
      return;
    }
    setLoading(true);
    try {
      const response = await fetchDatedSetting({ session, orgId, key: INSTRUCTOR_EARNINGS_POLICY_KEY });
      setPolicy(readPolicy(response?.value));
      setVersions(response?.versions || []);
      setEffectiveDate(todayKey());
    } catch (error) {
      console.error('Failed to load the instructor earnings policy', error);
      setPolicy(readPolicy(null));
      setVersions([]);
    } finally {
      setLoading(false);
    }
  }, [enabled, session, orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const baseline = readPolicy(versionInForce(versions, effectiveDate)?.settings_value ?? null);
  const changed = STATUSES.some((status) => policy[status] !== baseline[status]);

  /** Saves a version when the policy changed; returns whether one was saved. */
  const save = useCallback(async () => {
    if (!changed) return false;
    if (!effectiveDate) {
      throw new Error('יש לבחור מאיזה תאריך שכר המדריך בתוקף.');
    }
    await saveDatedSetting({ session, orgId, key: INSTRUCTOR_EARNINGS_POLICY_KEY, value: policy, effectiveDate });
    await load();
    return true;
  }, [changed, effectiveDate, session, orgId, policy, load]);

  return { policy, setPolicy, versions, effectiveDate, setEffectiveDate, changed, loading, save, reload: load };
}

/** One stored version in a few words: which outcomes pay the instructor. */
export function describeInstructorEarningsVersion(version, labels) {
  const policy = readPolicy(version?.settings_value);
  const paid = STATUSES.filter((status) => policy[status]).map((status) => labels?.[status] || status);
  return paid.length ? `משולם: ${paid.join(', ')}` : 'לא משולם באף מצב';
}
