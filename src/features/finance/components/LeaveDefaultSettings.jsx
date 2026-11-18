import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Minus, Plus } from 'lucide-react';
import { toast } from '@/lib/toast.jsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cancelDatedSettingVersion, fetchDatedSetting, saveDatedSettings } from '@/features/settings/api/settings.js';
import DatedSettingFields from '@/features/settings/components/DatedSettingFields.jsx';
import { futureChangeNote, versionInForce } from '@/features/settings/lib/dated-setting.js';
import { todayKey } from '@/lib/local-time.js';
import StepReveal from './StepReveal.jsx';
import {
  ENTITLEMENT_DEFAULT_OPTIONS,
  ENTITLEMENT_DISCLAIMER,
  ENTITLEMENT_PAST_DATE_WARNING,
  LEAVE_ENTITLEMENT_POLICY_KEY,
  MAX_FIXED_TABLE_ROWS,
  seniorityRowLabel,
} from '@/features/finance/lib/leave-entitlement-settings.js';
import {
  LEAVE_PAY_DEFAULT_METHODS,
  LEAVE_PAY_POLICY_KEY,
  LOOKBACK_MONTHS_MAX,
  LOOKBACK_MONTHS_MIN,
  buildLeavePayDraft,
  describeLeavePayMethod,
  isLeavePayDraftChanged,
  readLeavePayPolicy,
} from '@/features/finance/lib/leave-pay-policy.js';
import {
  LEAVE_SETTING_LABELS,
  buildEntitlementStepDraft,
  buildLeaveSettingsVersions,
  describeEntitlementVersion,
  describeLeavePayVersion,
  isEntitlementStepChanged,
  validateLeaveSettingsDraft,
} from '@/features/finance/lib/leave-settings.js';

const PAY_PAST_DATE_WARNING = 'ההגדרה תחול על ימים שכבר עברו. תשלום ימי חופשה שכבר היו מהתאריך הזה יחושב מחדש לפיה.';

function OptionCard({ id, name, value, checked, onSelect, disabled, label, description }) {
  return (
    <label
      htmlFor={id}
      className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 ${checked ? 'border-primary bg-primary/5' : 'border-slate-200 bg-white'}`}
    >
      <input
        id={id}
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onSelect}
        disabled={disabled}
        className="mt-1 accent-primary"
      />
      <span>
        <span className="block text-sm font-semibold text-slate-900">{label}</span>
        {description ? <span className="block text-sm text-slate-600">{description}</span> : null}
      </span>
    </label>
  );
}

/**
 * Body of the "חופשה" dialog in Settings: the organisation's leave defaults as one stepped flow.
 * Step 1 "כמה ימי חופשה מגיעים בשנה?" (leave_entitlement_policy), then, once it has a choice, step 2
 * "כמה משלמים על יום חופשה?" (leave_pay_policy). Both are dated settings: one "בתוקף מ-" and one save
 * for the dialog, which writes a version of each key that changed (same date); one history lists
 * the versions of both. A worker can still get other values in the "נוכחות" tab.
 */
export default function LeaveDefaultSettings({ session, orgId, canEdit, onClose }) {
  const [loadState, setLoadState] = useState('loading');
  const [entitlementStored, setEntitlementStored] = useState(null);
  const [entitlementVersions, setEntitlementVersions] = useState([]);
  const [payStored, setPayStored] = useState(null);
  const [payVersions, setPayVersions] = useState([]);
  const [entitlementDraft, setEntitlementDraft] = useState(null);
  const [payDraft, setPayDraft] = useState(null);
  const [effectiveDate, setEffectiveDate] = useState(() => todayKey());
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const load = useCallback(async (signal) => {
    if (!session || !orgId) return;
    setLoadState('loading');
    try {
      const [entitlement, pay] = await Promise.all([
        fetchDatedSetting({ session, orgId, key: LEAVE_ENTITLEMENT_POLICY_KEY, signal }),
        fetchDatedSetting({ session, orgId, key: LEAVE_PAY_POLICY_KEY, signal }),
      ]);
      if (signal?.aborted) return;
      const today = todayKey();
      const nextEntitlementVersions = entitlement?.versions || [];
      setEntitlementStored(entitlement?.value ?? null);
      setEntitlementVersions(nextEntitlementVersions);
      setEntitlementDraft(buildEntitlementStepDraft(entitlement?.value ?? null, Boolean(versionInForce(nextEntitlementVersions, today))));
      setPayStored(pay?.value ?? null);
      setPayVersions(pay?.versions || []);
      setPayDraft(buildLeavePayDraft(pay?.value ?? null));
      setEffectiveDate(today);
      setLoadState('ready');
    } catch (error) {
      if (signal?.aborted) return;
      console.error('Failed to load the leave settings', error);
      setLoadState('error');
    }
  }, [session, orgId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  // What is in force on the chosen date for each key: a key gets a version only when it differs.
  const entitlementOnDate = versionInForce(entitlementVersions, effectiveDate);
  const entitlementBaseline = entitlementOnDate?.settings_value ?? (entitlementVersions.length ? null : entitlementStored);
  const payBaseline = versionInForce(payVersions, effectiveDate)?.settings_value ?? (payVersions.length ? null : payStored);

  const entitlementInput = { baseline: entitlementBaseline, draft: entitlementDraft, hasVersionOnDate: Boolean(entitlementOnDate) };
  const payInput = { baseline: payBaseline, draft: payDraft };
  const entitlementChanged = isEntitlementStepChanged(entitlementInput);
  const payChanged = Boolean(payDraft) && isLeavePayDraftChanged(payBaseline, payDraft);

  const parts = useMemo(() => [
    {
      key: LEAVE_ENTITLEMENT_POLICY_KEY,
      label: LEAVE_SETTING_LABELS[LEAVE_ENTITLEMENT_POLICY_KEY],
      versions: entitlementVersions,
      describeVersion: describeEntitlementVersion,
      changed: entitlementChanged,
      pastDateWarning: ENTITLEMENT_PAST_DATE_WARNING,
    },
    {
      key: LEAVE_PAY_POLICY_KEY,
      label: LEAVE_SETTING_LABELS[LEAVE_PAY_POLICY_KEY],
      versions: payVersions,
      describeVersion: describeLeavePayVersion,
      changed: payChanged,
      pastDateWarning: PAY_PAST_DATE_WARNING,
    },
  ], [entitlementVersions, payVersions, entitlementChanged, payChanged]);

  // Cancels a version that has not started yet, then reads the settings again.
  const handleCancelVersion = async ({ key, version }) => {
    try {
      await cancelDatedSettingVersion({ session, orgId, key, effectiveDate: version.effective_date });
      toast.success('ההגדרה העתידית בוטלה.');
      await load();
    } catch (error) {
      console.error('Failed to cancel the future leave setting', error);
      toast.error('ביטול ההגדרה נכשל. נסו שוב.');
    }
  };

  const handleSave = async () => {
    const problem = validateLeaveSettingsDraft({ entitlementDraft, payDraft });
    if (problem) {
      setFormError(problem);
      return;
    }
    const versions = buildLeaveSettingsVersions({ entitlement: entitlementInput, pay: payInput });
    if (!versions.length) return;
    setSaving(true);
    setFormError('');
    try {
      await saveDatedSettings({ session, orgId, versions, effectiveDate });
      toast.success('הגדרות החופשה נשמרו.');
      onClose?.();
    } catch (error) {
      console.error('Failed to save the leave settings', error);
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

  const disabled = saving || !canEdit;
  const today = todayKey();
  const entitlementFutureNote = futureChangeNote(entitlementVersions, today);
  const payFutureNote = futureChangeNote(payVersions, today);
  const futureNote = (note) => (note ? (
    <button
      type="button"
      className="ms-2 text-xs font-normal text-amber-700 underline decoration-dotted underline-offset-4"
      onClick={() => setHistoryOpen(true)}
      data-future-change
    >
      {note}
    </button>
  ) : null);
  const stepOneDone = Boolean(entitlementDraft.mode);
  const draftProblem = stepOneDone ? validateLeaveSettingsDraft({ entitlementDraft, payDraft }) : '';
  const anyChange = entitlementChanged || payChanged;
  const draftMonths = Number(payDraft.lookbackMonths) > 0 ? Number(payDraft.lookbackMonths) : readLeavePayPolicy(payBaseline).lookback_months;
  const setRow = (index, value) => setEntitlementDraft((current) => ({
    ...current,
    rows: current.rows.map((row, rowIndex) => (rowIndex === index ? value : row)),
  }));

  return (
    <div className="space-y-4" data-settings-block="leave-default">
      <p className="text-sm text-slate-600 leading-relaxed" data-leave-entitlement-disclaimer>{ENTITLEMENT_DISCLAIMER}</p>

      <fieldset className="space-y-2" data-leave-step="1">
        <legend className="mb-1 text-sm font-semibold text-slate-700">כמה ימי חופשה מגיעים בשנה?{futureNote(entitlementFutureNote)}</legend>
        {ENTITLEMENT_DEFAULT_OPTIONS.map((option) => (
          <OptionCard
            key={option.value}
            id={`leave-entitlement-mode-${option.value}`}
            name="leave-entitlement-mode"
            value={option.value}
            checked={entitlementDraft.mode === option.value}
            onSelect={() => setEntitlementDraft((current) => ({ ...current, mode: option.value }))}
            disabled={disabled}
            label={option.label}
            description={option.description}
          />
        ))}

        {entitlementDraft.mode === 'fixed' ? (
          <div className="space-y-2 pt-1" data-leave-entitlement-table>
            <p className="text-sm font-semibold text-slate-700">ימי חופשה בכל שנת ותק</p>
            <ol className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
              {entitlementDraft.rows.map((value, index) => {
                const id = `leave-entitlement-year-${index + 1}`;
                return (
                  <li key={id} className="grid grid-cols-[minmax(0,1fr)_5rem] items-center gap-2">
                    <label htmlFor={id} className="text-sm text-slate-600">{seniorityRowLabel(index, entitlementDraft.rows.length)}</label>
                    <Input
                      id={id}
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={365}
                      step={0.5}
                      className="h-8"
                      value={value}
                      onChange={(event) => setRow(index, event.target.value)}
                      disabled={disabled}
                    />
                  </li>
                );
              })}
            </ol>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="gap-1 text-xs"
                onClick={() => setEntitlementDraft((current) => ({ ...current, rows: [...current.rows, current.rows[current.rows.length - 1] ?? '0'] }))}
                disabled={disabled || entitlementDraft.rows.length >= MAX_FIXED_TABLE_ROWS}
              >
                <Plus className="h-3.5 w-3.5" /> שורה
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="gap-1 text-xs"
                onClick={() => setEntitlementDraft((current) => ({ ...current, rows: current.rows.slice(0, -1) }))}
                disabled={disabled || entitlementDraft.rows.length <= 1}
              >
                <Minus className="h-3.5 w-3.5" /> הסרת השורה האחרונה
              </Button>
            </div>
          </div>
        ) : null}
      </fieldset>

      <StepReveal shown={stepOneDone} data-leave-step="2">
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-semibold text-slate-700">כמה משלמים על יום חופשה?{futureNote(payFutureNote)}</legend>
          {LEAVE_PAY_DEFAULT_METHODS.map((option) => (
            <OptionCard
              key={option.value}
              id={`leave-pay-method-${option.value}`}
              name="leave-pay-method"
              value={option.value}
              checked={payDraft.method === option.value}
              onSelect={() => setPayDraft((current) => ({ ...current, method: option.value }))}
              disabled={disabled}
              label={option.label}
              description={describeLeavePayMethod(option.value, { lookbackMonths: draftMonths })}
            />
          ))}
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Label htmlFor="leave-pay-lookback-months" className="text-sm font-semibold text-slate-700">מספר חודשים לממוצע</Label>
            <Input
              id="leave-pay-lookback-months"
              type="number"
              inputMode="numeric"
              min={LOOKBACK_MONTHS_MIN}
              max={LOOKBACK_MONTHS_MAX}
              step={1}
              className="w-20"
              value={payDraft.lookbackMonths}
              onChange={(event) => setPayDraft((current) => ({ ...current, lookbackMonths: event.target.value }))}
              disabled={disabled}
            />
          </div>
        </fieldset>
      </StepReveal>

      <DatedSettingFields
        idPrefix="leave-default"
        effectiveDate={effectiveDate}
        onEffectiveDateChange={setEffectiveDate}
        parts={parts}
        disabled={disabled}
        onCancelVersion={canEdit ? handleCancelVersion : undefined}
        historyOpen={historyOpen}
        onHistoryOpenChange={setHistoryOpen}
      />

      {formError || draftProblem ? (
        <p className="text-sm font-medium text-red-700" role="alert">{formError || draftProblem}</p>
      ) : null}

      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          onClick={() => void handleSave()}
          disabled={!canEdit || saving || !stepOneDone || Boolean(draftProblem) || !anyChange || !effectiveDate}
        >
          {saving ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : null}
          שמירה
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => onClose?.()} disabled={saving}>ביטול</Button>
      </div>
    </div>
  );
}
