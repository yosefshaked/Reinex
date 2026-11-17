import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Minus, Plus } from 'lucide-react';
import { toast } from '@/lib/toast.jsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { fetchDatedSetting, saveDatedSetting } from '@/features/settings/api/settings.js';
import DatedSettingFields from '@/features/settings/components/DatedSettingFields.jsx';
import { versionInForce } from '@/features/settings/lib/dated-setting.js';
import { todayKey } from '@/lib/local-time.js';
import {
  ENTITLEMENT_DEFAULT_OPTIONS,
  ENTITLEMENT_DISCLAIMER,
  ENTITLEMENT_PAST_DATE_WARNING,
  LEAVE_ENTITLEMENT_POLICY_KEY,
  MAX_FIXED_TABLE_ROWS,
  buildEntitlementDraft,
  buildEntitlementPayload,
  describeEntitlementVersion,
  isEntitlementDraftChanged,
  seniorityRowLabel,
  validateEntitlementDraft,
} from '@/features/finance/lib/leave-entitlement-settings.js';

/**
 * Body of the "ימי חופשה" dialog in Settings: how many leave days every employee is owed unless a
 * fixed number is set for them in the "נוכחות" tab ("leave_entitlement_policy", a dated setting:
 * a calendar year follows the version in force on its 31 December, or today for the current year).
 */
export default function LeaveEntitlementDefaultSettings({ session, orgId, canEdit, onClose }) {
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
      const response = await fetchDatedSetting({ session, orgId, key: LEAVE_ENTITLEMENT_POLICY_KEY, signal });
      if (signal?.aborted) return;
      const value = response?.value ?? null;
      setStored(value);
      setVersions(response?.versions || []);
      setEffectiveDate(todayKey());
      setDraft(buildEntitlementDraft(value));
      setLoadState('ready');
    } catch (error) {
      if (signal?.aborted) return;
      console.error('Failed to load the leave entitlement policy', error);
      setLoadState('error');
    }
  }, [session, orgId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const baseline = versionInForce(versions, effectiveDate)?.settings_value ?? (versions.length ? null : stored);

  const handleSave = async () => {
    const problem = validateEntitlementDraft(draft);
    if (problem) {
      setFormError(problem);
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      await saveDatedSetting({ session, orgId, key: LEAVE_ENTITLEMENT_POLICY_KEY, value: buildEntitlementPayload(draft), effectiveDate });
      toast.success('ימי החופשה של הארגון נשמרו.');
      onClose?.();
    } catch (error) {
      console.error('Failed to save the leave entitlement policy', error);
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

  const draftProblem = validateEntitlementDraft(draft);
  const draftChanged = isEntitlementDraftChanged(baseline, draft);
  const disabled = saving || !canEdit;
  const setRow = (index, value) => setDraft((current) => ({
    ...current,
    rows: current.rows.map((row, rowIndex) => (rowIndex === index ? value : row)),
  }));

  return (
    <div className="space-y-4" data-settings-block="leave-entitlement-default">
      <p className="text-sm text-slate-600 leading-relaxed" data-leave-entitlement-disclaimer>{ENTITLEMENT_DISCLAIMER}</p>

      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-semibold text-slate-700">כמה ימי חופשה מגיעים לכל עובד</legend>
        {ENTITLEMENT_DEFAULT_OPTIONS.map((option) => {
          const id = `leave-entitlement-mode-${option.value}`;
          const selected = draft.mode === option.value;
          return (
            <label
              key={option.value}
              htmlFor={id}
              className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 ${selected ? 'border-primary bg-primary/5' : 'border-slate-200 bg-white'}`}
            >
              <input
                id={id}
                type="radio"
                name="leave-entitlement-mode"
                value={option.value}
                checked={selected}
                onChange={() => setDraft((current) => ({ ...current, mode: option.value }))}
                disabled={disabled}
                className="mt-1 accent-primary"
              />
              <span>
                <span className="block text-sm font-semibold text-slate-900">{option.label}</span>
                <span className="block text-sm text-slate-600">{option.description}</span>
              </span>
            </label>
          );
        })}
      </fieldset>

      {draft.mode === 'fixed' ? (
        <div className="space-y-2" data-leave-entitlement-table>
          <p className="text-sm font-semibold text-slate-700">ימי חופשה בכל שנת ותק</p>
          <ol className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
            {draft.rows.map((value, index) => {
              const id = `leave-entitlement-year-${index + 1}`;
              return (
                <li key={id} className="grid grid-cols-[minmax(0,1fr)_5rem] items-center gap-2">
                  <label htmlFor={id} className="text-sm text-slate-600">{seniorityRowLabel(index, draft.rows.length)}</label>
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
              onClick={() => setDraft((current) => ({ ...current, rows: [...current.rows, current.rows[current.rows.length - 1] ?? '0'] }))}
              disabled={disabled || draft.rows.length >= MAX_FIXED_TABLE_ROWS}
            >
              <Plus className="h-3.5 w-3.5" /> שורה
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="gap-1 text-xs"
              onClick={() => setDraft((current) => ({ ...current, rows: current.rows.slice(0, -1) }))}
              disabled={disabled || draft.rows.length <= 1}
            >
              <Minus className="h-3.5 w-3.5" /> הסרת השורה האחרונה
            </Button>
          </div>
        </div>
      ) : null}

      <DatedSettingFields
        idPrefix="leave-entitlement-default"
        effectiveDate={effectiveDate}
        onEffectiveDateChange={setEffectiveDate}
        versions={versions}
        describeVersion={describeEntitlementVersion}
        changed={draftChanged}
        disabled={disabled}
        pastDateWarning={ENTITLEMENT_PAST_DATE_WARNING}
      />

      {formError || draftProblem ? (
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
