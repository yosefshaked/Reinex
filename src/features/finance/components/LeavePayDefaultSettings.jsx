import React, { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from '@/lib/toast.jsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { fetchSettingsValue, upsertSetting } from '@/features/settings/api/settings.js';
import {
  LEAVE_PAY_DEFAULT_METHODS,
  LEAVE_PAY_POLICY_KEY,
  LOOKBACK_MONTHS_MAX,
  LOOKBACK_MONTHS_MIN,
  buildLeavePayDraft,
  buildLeavePayPolicyPayload,
  describeLeavePayMethod,
  isLeavePayDraftChanged,
  readLeavePayPolicy,
  validateLeavePayDraft,
} from '@/features/finance/lib/leave-pay-policy.js';

/**
 * Body of the "תשלום חופשה" dialog in Settings: the organisation's default leave-pay method
 * (Settings "leave_pay_policy"). Opens straight in the form with the current values; the settings
 * API checks the value on save.
 */
export default function LeavePayDefaultSettings({ session, orgId, canEdit, onClose }) {
  const [stored, setStored] = useState(null);
  const [loadState, setLoadState] = useState('loading');
  const [draft, setDraft] = useState(null);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (signal) => {
    if (!session || !orgId) return;
    setLoadState('loading');
    try {
      const response = await fetchSettingsValue({ session, orgId, key: LEAVE_PAY_POLICY_KEY, signal });
      if (signal?.aborted) return;
      const value = response?.value ?? null;
      setStored(value);
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

  const handleSave = async () => {
    const problem = validateLeavePayDraft(draft);
    if (problem) {
      setFormError(problem);
      return;
    }
    setSaving(true);
    setFormError('');
    const value = buildLeavePayPolicyPayload(stored, draft);
    try {
      await upsertSetting({ session, orgId, key: LEAVE_PAY_POLICY_KEY, value });
      setStored(value);
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
  const draftChanged = isLeavePayDraftChanged(stored, draft);
  const draftMonths = Number(draft.lookbackMonths) > 0 ? Number(draft.lookbackMonths) : readLeavePayPolicy(stored).lookback_months;

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

      {formError || (draftProblem && draft.method) ? (
        <p className="text-sm font-medium text-red-700" role="alert">{formError || draftProblem}</p>
      ) : null}

      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          onClick={() => void handleSave()}
          disabled={!canEdit || saving || Boolean(draftProblem) || !draftChanged}
        >
          {saving ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : null}
          שמירה
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => onClose?.()} disabled={saving}>ביטול</Button>
      </div>
    </div>
  );
}
