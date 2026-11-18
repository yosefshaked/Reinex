import React, { useMemo, useState } from 'react';
import { ChevronDown, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { todayKey } from '@/lib/local-time.js';
import { buildDatedSettingsWarnings, mergeVersionHistory, versionFromLabel } from '@/features/settings/lib/dated-setting.js';

/**
 * The date part of every dated setting (a setting read as of a date, like a rate): "בתוקף מ-" with
 * today as the default, the warnings before saving (a past date recomputes pay already shown), and a
 * collapsible "היסטוריה (N)" of the versions with their dates. The form owns the value and the save;
 * `describeVersion(version)` says in a few words what a stored version holds. The warnings show only
 * while there is something to save (`changed`).
 *
 * A screen that saves several dated settings from one date passes `parts` instead
 * ([{ key, label, versions, describeVersion, changed, pastDateWarning }]): one date, the warnings of
 * each part that will get a new version (each with its own past-date wording), and one history list
 * of all their versions, each labelled.
 *
 * A version that has not started yet (effective date after today) can be cancelled from the history
 * when `onCancelVersion({ key, version })` is passed. The history can be controlled from outside
 * (`historyOpen` / `onHistoryOpenChange`), so a note elsewhere ("ישתנה ב-...") can open it.
 */
export default function DatedSettingFields({
  idPrefix,
  effectiveDate,
  onEffectiveDateChange,
  versions = [],
  describeVersion,
  changed = true,
  disabled = false,
  pastDateWarning,
  parts,
  onCancelVersion,
  historyOpen,
  onHistoryOpenChange,
}) {
  const [ownShowHistory, setOwnShowHistory] = useState(false);
  const showHistory = historyOpen ?? ownShowHistory;
  const setShowHistory = (next) => {
    const value = typeof next === 'function' ? next(showHistory) : next;
    setOwnShowHistory(value);
    onHistoryOpenChange?.(value);
  };
  const [confirming, setConfirming] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const today = todayKey();
  const allParts = useMemo(() => (
    Array.isArray(parts) && parts.length
      ? parts
      : [{ key: '', label: '', versions: Array.isArray(versions) ? versions : [], describeVersion, changed, pastDateWarning }]
  ), [parts, versions, describeVersion, changed, pastDateWarning]);
  const history = useMemo(() => mergeVersionHistory(allParts), [allParts]);
  const warnings = useMemo(
    () => buildDatedSettingsWarnings({ parts: allParts, effectiveDate, today }),
    [allParts, effectiveDate, today],
  );
  async function cancelVersion(row) {
    setCancelling(true);
    try {
      await onCancelVersion({ key: row.key, version: row.version });
    } finally {
      setCancelling(false);
      setConfirming('');
    }
  }
  const dateId = `${idPrefix}-effective-date`;
  const historyId = `${idPrefix}-history`;

  return (
    <div className="space-y-2" data-dated-setting={idPrefix}>
      <div className="flex flex-wrap items-center gap-3">
        <Label htmlFor={dateId} className="text-sm font-semibold text-slate-700">בתוקף מ-</Label>
        <Input
          id={dateId}
          type="date"
          className="w-44"
          value={effectiveDate || ''}
          onChange={(event) => onEffectiveDateChange?.(event.target.value)}
          disabled={disabled}
        />
        {history.length > 0 ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="gap-1 text-xs"
            aria-expanded={showHistory}
            aria-controls={historyId}
            onClick={() => setShowHistory((value) => !value)}
          >
            היסטוריה ({history.length})
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showHistory ? 'rotate-180' : ''}`} />
          </Button>
        ) : null}
      </div>

      {warnings.length > 0 ? (
        <ul className="space-y-1 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800" role="status">
          {warnings.map((warning) => (
            <li key={warning} className="flex items-start gap-1.5">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{warning}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {showHistory && history.length > 0 ? (
        <ol id={historyId} className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {history.map(({ key, label, text, version }) => {
            const rowId = `${key}-${version.effective_date}`;
            const cancellable = Boolean(onCancelVersion) && version.effective_date > today;
            return (
            <li
              key={`${key}-${version.effective_date}-${version.created_at || ''}`}
              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
              data-history-key={key || undefined}
            >
              <span className="text-slate-900">
                {label ? <span className="text-slate-500">{label} · </span> : null}
                <span className="font-semibold">{text}</span>
              </span>
              <span className="flex items-center gap-2 text-xs text-slate-500">
                <span>
                  {versionFromLabel(version)}
                  {version.effective_date > today ? ' (עתידי)' : ''}
                  {version.notes ? ` · ${version.notes}` : ''}
                </span>
                {cancellable && confirming !== rowId ? (
                  <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setConfirming(rowId)} disabled={disabled || cancelling} data-cancel-version>
                    ביטול ההגדרה העתידית
                  </Button>
                ) : null}
                {cancellable && confirming === rowId ? (
                  <span className="flex items-center gap-1" data-cancel-version-confirm>
                    <span className="font-medium text-slate-700">לבטל?</span>
                    <Button type="button" size="sm" variant="destructive" className="h-6 px-2 text-xs" onClick={() => void cancelVersion({ key, version })} disabled={cancelling}>כן, לבטל</Button>
                    <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setConfirming('')} disabled={cancelling}>לא</Button>
                  </span>
                ) : null}
              </span>
            </li>
            );
          })}
        </ol>
      ) : null}
    </div>
  );
}
