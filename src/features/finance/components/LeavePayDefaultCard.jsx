import React, { useCallback, useEffect, useState } from 'react';
import { CalendarDays, Loader2 } from 'lucide-react';
import { toast } from '@/lib/toast.jsx';
import { formatCurrency } from '@/lib/currency.js';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { fetchSettingsValue, upsertSetting } from '@/features/settings/api/settings.js';
import {
  LEAVE_PAY_DEFAULT_METHODS,
  LEAVE_PAY_POLICY_KEY,
  LOOKBACK_MONTHS_MAX,
  LOOKBACK_MONTHS_MIN,
  buildLeavePayDraft,
  buildLeavePayPolicyPayload,
  describeLeavePayMethod,
  getLeavePayMethodLabel,
  isLeavePayDraftChanged,
  readLeavePayPolicy,
  validateLeavePayDraft,
} from '@/features/finance/lib/leave-pay-policy.js';

const TITLE = 'תשלום חופשה - ברירת המחדל של הארגון';

/**
 * The organisation's default leave-pay method (Settings "leave_pay_policy"). Read first: the current
 * values as text and one "שינוי"; the form saves through the settings API, which checks the value.
 */
export default function LeavePayDefaultCard({ session, orgId, canEdit }) {
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
      setStored(response?.value ?? null);
      setLoadState('ready');
    } catch (error) {
      if (signal?.aborted) return;
      console.error('Failed to load the leave pay policy', error);
      setLoadState('error');
    }
  }, [session, orgId]);

  useEffect(() => {
    const controller = new AbortController();
    setDraft(null);
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const policy = readLeavePayPolicy(stored);
  const editing = draft !== null;

  const startEdit = () => {
    setDraft(buildLeavePayDraft(stored));
    setFormError('');
  };

  const cancelEdit = () => {
    setDraft(null);
    setFormError('');
  };

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
      setDraft(null);
      toast.success('ברירת המחדל לתשלום חופשה נשמרה.');
    } catch (error) {
      console.error('Failed to save the leave pay policy', error);
      setFormError('השמירה נכשלה. נסו שוב.');
    } finally {
      setSaving(false);
    }
  };

  const draftProblem = editing ? validateLeavePayDraft(draft) : '';
  const draftChanged = editing ? isLeavePayDraftChanged(stored, draft) : false;
  const draftMonths = editing && Number(draft.lookbackMonths) > 0 ? Number(draft.lookbackMonths) : policy.lookback_months;

  return (
    <Card
      className="relative w-full overflow-hidden border-0 bg-white/80 shadow-md md:col-span-2 flex flex-col"
      data-settings-block="leave-pay-default"
      aria-label={TITLE}
    >
      <CardHeader className="space-y-2 pb-3">
        <div className="flex items-start gap-2">
          <div className="rounded-lg bg-emerald-100 p-2 text-emerald-600">
            <CalendarDays className="h-5 w-5" aria-hidden="true" />
          </div>
          <CardTitle className="text-lg font-bold text-slate-900">{TITLE}</CardTitle>
        </div>
        <p className="text-sm text-slate-600 leading-relaxed">
          חל על כל עובד שלא נבחרה לו שיטה אחרת בלשונית &quot;פיננסים&quot;.
        </p>
      </CardHeader>

      <CardContent className="pt-0 mt-auto space-y-3">
        {loadState === 'loading' ? (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> טוען...
          </div>
        ) : null}

        {loadState === 'error' ? (
          <div className="flex items-center gap-3 text-sm text-red-700">
            טעינת ההגדרה נכשלה.
            <Button type="button" size="sm" variant="outline" onClick={() => void load()}>ניסיון חוזר</Button>
          </div>
        ) : null}

        {loadState === 'ready' && !editing ? (
          <>
            <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[auto_1fr]">
              <dt className="text-slate-500">שיטה</dt>
              <dd data-leave-pay-current-method={policy.default_method}>
                <span className="font-semibold text-slate-900">{getLeavePayMethodLabel(policy.default_method)}</span>
                <span className="block text-slate-600">
                  {policy.default_method === 'fixed_rate'
                    ? `${describeLeavePayMethod('fixed_rate')} הסכום: ${formatCurrency(policy.fixed_rate_default)}.`
                    : describeLeavePayMethod(policy.default_method, {
                      lookbackMonths: policy.lookback_months,
                      compareTwelveMonths: policy.legal_allow_12m_if_better,
                    })}
                </span>
              </dd>
              {policy.default_method !== 'fixed_rate' ? (
                <>
                  <dt className="text-slate-500">מספר חודשים לממוצע</dt>
                  <dd className="font-semibold text-slate-900">{policy.lookback_months}</dd>
                </>
              ) : null}
              {policy.default_method === 'legal' ? (
                <>
                  <dt className="text-slate-500">השוואה ל-12 החודשים האחרונים</dt>
                  <dd className="font-semibold text-slate-900">{policy.legal_allow_12m_if_better ? 'כן' : 'לא'}</dd>
                </>
              ) : null}
            </dl>
            {canEdit ? (
              <Button type="button" size="sm" variant="outline" onClick={startEdit}>שינוי</Button>
            ) : null}
          </>
        ) : null}

        {loadState === 'ready' && editing ? (
          <div className="space-y-4">
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
                      disabled={saving}
                      className="mt-1 accent-primary"
                    />
                    <span>
                      <span className="block text-sm font-semibold text-slate-900">{option.label}</span>
                      <span className="block text-sm text-slate-600">
                        {describeLeavePayMethod(option.value, { lookbackMonths: draftMonths, compareTwelveMonths: draft.compareTwelveMonths })}
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
                disabled={saving}
              />
            </div>

            <div className="flex items-start gap-3">
              <Switch
                id="leave-pay-compare-12m"
                checked={draft.compareTwelveMonths}
                onCheckedChange={(checked) => setDraft((current) => ({ ...current, compareTwelveMonths: checked === true }))}
                disabled={saving || draft.method !== 'legal'}
                aria-describedby="leave-pay-compare-12m-hint"
              />
              <div>
                <Label htmlFor="leave-pay-compare-12m" className="text-sm font-semibold text-slate-700">
                  להשוות גם ל-12 החודשים האחרונים
                </Label>
                <p id="leave-pay-compare-12m-hint" className="text-xs text-slate-500">
                  רק ב&quot;ממוצע חוקי&quot;: אם הממוצע ב-12 החודשים גבוה יותר, משלמים לפיו.
                </p>
              </div>
            </div>

            {formError || (draftProblem && draft.method) ? (
              <p className="text-sm font-medium text-red-700" role="alert">{formError || draftProblem}</p>
            ) : null}

            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                onClick={() => void handleSave()}
                disabled={saving || Boolean(draftProblem) || !draftChanged}
              >
                {saving ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : null}
                שמירה
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={cancelEdit} disabled={saving}>ביטול</Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
