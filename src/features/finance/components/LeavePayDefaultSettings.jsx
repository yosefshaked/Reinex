import React, { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from '@/lib/toast.jsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { fetchDatedSetting, saveDatedSetting } from '@/features/settings/api/settings.js';
import DatedSettingFields from '@/features/settings/components/DatedSettingFields.jsx';
import { versionInForce } from '@/features/settings/lib/dated-setting.js';
import { todayKey } from '@/lib/local-time.js';
import {
  LEAVE_PAY_DEFAULT_METHODS,
  LEAVE_PAY_POLICY_KEY,
  LOOKBACK_MONTHS_MAX,
  LOOKBACK_MONTHS_MIN,
  buildLeavePayDraft,
  buildLeavePayPolicyPayload,
  describeLeavePayMethod,
  getEffectiveDefaultMethod,
  getLeavePayMethodLabel,
  isLeavePayDraftChanged,
  readLeavePayPolicy,
  validateLeavePayDraft,
} from '@/features/finance/lib/leave-pay-policy.js';

/** One stored version in a few words, for the history list. */
function describeLeavePayVersion(version) {
  const policy = readLeavePayPolicy(version?.settings_value);
  return `${getLeavePayMethodLabel(getEffectiveDefaultMethod(policy))} · ${policy.lookback_months} חודשים`;
}

/**
 * Body of the "תשלום חופשה" dialog in Settings: the organisation's default leave-pay method
 * ("leave_pay_policy", a dated setting: a leave day is valued by the version in force on that day).
 * Opens straight in the form with today's values; saving adds a version from the chosen date
 * (default today). The settings API checks the value on save.
 */
export default function LeavePayDefaultSettings({ session, orgId, canEdit, onClose }) {
  const [stored, setStored] = useState(null);
  const [versions, setVersions] = useState([]);
  const [effectiveDate, setEffectiveDate] = useState(() => todayKey());
  const [loadState, setLoadState] = useState('loading');
  const [draft, setDraft] = useState(null);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (signal) => {
    if (!session || !orgId) return;
    setLoadState('loading');
    try {
      const response = await fetchDatedSetting({ session, orgId, key: LEAVE_PAY_POLICY_KEY, signal });
      if (signal?.aborted) return;
      const value = response?.value ?? null;
      setStored(value);
      setVersions(response?.versions || []);
      setEffectiveDate(todayKey());
      setDraft(buildLeavePayDraft(value));
      setLoadState('ready');
    } catch (error) {
      if (signal?.aborted) return;
      console.error('Failed to load the leave pay policy', error);
      setLoadState('error');
    }
  }, [session, orgId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  // What is in force on the chosen date: saving is allowed only when the draft differs from it.
  const baseline = versionInForce(versions, effectiveDate)?.settings_value ?? (versions.length ? null : stored);

  const handleSave = async () => {
    const problem = validateLeavePayDraft(draft);
    if (problem) {
      setFormError(problem);
      return;
    }
    setSaving(true);
    setFormError('');
    const value = buildLeavePayPolicyPayload(baseline, draft);
    try {
      await saveDatedSetting({ session, orgId, key: LEAVE_PAY_POLICY_KEY, value, effectiveDate });
      toast.success('ברירת המחדל לתשלום חופשה נשמרה.');
      onClose?.();
    } catch (error) {
      console.error('Failed to save the leave pay policy', error);
      setFormError('השמירה נכשלה. נסו שוב.');
    } finally {
      setSaving(false);
    }
  };

  if (loadState === 'loading') {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> טוען...
      </div>
    );
  }

  if (loadState === 'error') {
    return (
      <div className="flex items-center gap-3 text-sm text-red-700">
        טעינת ההגדרה נכשלה.
        <Button type="button" size="sm" variant="outline" onClick={() => void load()}>ניסיון חוזר</Button>
      </div>
    );
  }

  const draftProblem = validateLeavePayDraft(draft);
  const draftChanged = isLeavePayDraftChanged(baseline, draft);
  const draftMonths = Number(draft.lookbackMonths) > 0 ? Number(draft.lookbackMonths) : readLeavePayPolicy(baseline).lookback_months;

  return (
    <div className="space-y-4" data-settings-block="leave-pay-default">
      <p className="text-sm text-slate-600 leading-relaxed">
        חל על כל עובד שלא נבחרה לו שיטה אחרת בלשונית &quot;פיננסים&quot;.
      </p>

      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-semibold text-slate-700">שיטה</legend>
        {LEAVE_PAY_DEFAULT_METHODS.map((option) => {
          const id = `leave-pay-method-${option.value}`;
          const selected = draft.method === option.value;
          return (
            <label
              key={option.value}
              htmlFor={id}
              className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 ${selected ? 'border-primary bg-primary/5' : 'border-slate-200 bg-white'}`}
            >
              <input
                id={id}
                type="radio"
                name="leave-pay-method"
                value={option.value}
                checked={selected}
                onChange={() => setDraft((current) => ({ ...current, method: option.value }))}
                disabled={saving || !canEdit}
                className="mt-1 accent-primary"
              />
              <span>
                <span className="block text-sm font-semibold text-slate-900">{option.label}</span>
                <span className="block text-sm text-slate-600">
                  {describeLeavePayMethod(option.value, { lookbackMonths: draftMonths })}
                </span>
              </span>
            </label>
          );
        })}
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <Label htmlFor="leave-pay-lookback-months" className="text-sm font-semibold text-slate-700">מספר חודשים לממוצע</Label>
        <Input
          id="leave-pay-lookback-months"
          type="number"
          inputMode="numeric"
          min={LOOKBACK_MONTHS_MIN}
          max={LOOKBACK_MONTHS_MAX}
          step={1}
          className="w-20"
          value={draft.lookbackMonths}
          onChange={(event) => setDraft((current) => ({ ...current, lookbackMonths: event.target.value }))}
          disabled={saving || !canEdit}
        />
      </div>

      <DatedSettingFields
        idPrefix="leave-pay-default"
        effectiveDate={effectiveDate}
        onEffectiveDateChange={setEffectiveDate}
        versions={versions}
        describeVersion={describeLeavePayVersion}
        changed={draftChanged}
        disabled={saving || !canEdit}
      />

      {formError || (draftProblem && draft.method) ? (
        <p className="text-sm font-medium text-red-700" role="alert">{formError || draftProblem}</p>
      ) : null}

      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          onClick={() => void handleSave()}
          disabled={!canEdit || saving || Boolean(draftProblem) || !draftChanged || !effectiveDate}
        >
          {saving ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : null}
          שמירה
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => onClose?.()} disabled={saving}>ביטול</Button>
      </div>
    </div>
  );
}
