import React, { useMemo, useState } from 'react';
import { ChevronDown, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { todayKey } from '@/lib/local-time.js';
import { buildDatedSettingWarnings, versionFromLabel } from '@/features/settings/lib/dated-setting.js';

/**
 * The date part of every dated setting (a setting read as of a date, like a rate): "בתוקף מ-" with
 * today as the default, the warnings before saving (a past date recomputes pay already shown), and a
 * collapsible "היסטוריה (N)" of the versions with their dates. The form owns the value and the save;
 * `describeVersion(version)` says in a few words what a stored version holds. The warnings show only
 * while there is something to save (`changed`).
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
}) {
  const [showHistory, setShowHistory] = useState(false);
  const today = todayKey();
  const list = useMemo(() => (Array.isArray(versions) ? versions : []), [versions]);
  const warnings = useMemo(
    () => buildDatedSettingWarnings({ versions: list, effectiveDate, today, ...(pastDateWarning ? { pastDateWarning } : {}) }),
    [list, effectiveDate, today, pastDateWarning],
  );
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
        {list.length > 0 ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="gap-1 text-xs"
            aria-expanded={showHistory}
            aria-controls={historyId}
            onClick={() => setShowHistory((value) => !value)}
          >
            היסטוריה ({list.length})
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showHistory ? 'rotate-180' : ''}`} />
          </Button>
        ) : null}
      </div>

      {changed && warnings.length > 0 ? (
        <ul className="space-y-1 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800" role="status">
          {warnings.map((warning) => (
            <li key={warning} className="flex items-start gap-1.5">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{warning}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {showHistory && list.length > 0 ? (
        <ol id={historyId} className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {list.map((version) => (
            <li key={`${version.effective_date}-${version.created_at || ''}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className="font-semibold text-slate-900">{describeVersion ? describeVersion(version) : ''}</span>
              <span className="text-xs text-slate-500">
                {versionFromLabel(version)}
                {version.effective_date > today ? ' (עתידי)' : ''}
                {version.notes ? ` · ${version.notes}` : ''}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
