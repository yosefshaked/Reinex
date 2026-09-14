import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, Check, Loader2 } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { getParticipantStatusDisplay, summarizePreviewImpacts } from '../utils/lessonDialogModel.js';

const TONE_CLASSES = {
  ok: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200',
  bad: 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-200',
  neutral: 'bg-slate-100 text-slate-600',
  open: 'border border-dashed border-slate-300 text-slate-500',
};

export function ParticipantStatusPill({ status, label, tone }) {
  const display = status ? getParticipantStatusDisplay(status) : { label, tone };
  return (
    <span className={`inline-flex h-[22px] items-center whitespace-nowrap rounded-full px-2.5 text-xs font-bold ${TONE_CLASSES[display.tone] || TONE_CLASSES.neutral}`}>
      {display.label}
    </span>
  );
}

/**
 * One-line confirmation for a participant status change: from → to, the money impact from the
 * server preview, and a single confirm (Enter). Full sentences stay one click away under "פירוט".
 */
export function LessonImpactStrip({
  fromStatus,
  toStatus,
  loading,
  preview,
  error,
  saving,
  note,
  onConfirm,
  onCancel,
}) {
  const [showDetails, setShowDetails] = useState(false);
  const confirmRef = useRef(null);
  const summary = preview ? summarizePreviewImpacts(preview) : null;
  const ready = !loading && Boolean(preview);

  useEffect(() => {
    if (ready) {
      confirmRef.current?.focus();
    }
  }, [ready]);

  return (
    <div className="flex flex-col gap-2 border-t border-dashed border-slate-200 bg-slate-50 px-3.5 py-2.5" role="group" aria-label="אישור שינוי סטטוס">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="inline-flex items-center gap-1.5">
          <ParticipantStatusPill status={fromStatus} />
          <ArrowLeft className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
          <ParticipantStatusPill status={toStatus} />
        </span>

        {loading ? (
          <span className="inline-flex items-center gap-2 text-xs text-slate-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            בודקים את ההשפעה מול השרת...
          </span>
        ) : null}

        {ready && summary.quiet ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700">
            <Check className="h-3.5 w-3.5" />
            אין השפעה כספית — רק עדכון סטטוס
          </span>
        ) : null}

        {ready && summary.segments.length > 0 ? (
          <div className="flex flex-wrap items-center text-xs text-slate-600">
            {summary.segments.map((segment, index) => (
              <span
                key={`${segment.key}-${index}`}
                className={`inline-flex items-center gap-1.5 ${index > 0 ? 'border-s border-slate-200 ps-2.5 ms-2.5' : ''}`}
              >
                <span className="text-[11px] font-bold text-slate-400">{segment.label}</span>
                <span className={`font-bold ${segment.key === 'hmo' ? 'text-violet-700' : 'text-slate-900'}`}>{segment.value}</span>
              </span>
            ))}
          </div>
        ) : null}

        {note ? <span className="text-xs text-slate-500">· {note}</span> : null}

        <div className="ms-auto flex items-center gap-1.5">
          {ready && summary.details.length > 0 ? (
            <Button type="button" size="sm" variant="ghost" className="h-8 px-2.5 text-xs" onClick={() => setShowDetails((value) => !value)}>
              {showDetails ? 'הסתרת פירוט' : 'פירוט'}
            </Button>
          ) : null}
          <Button type="button" size="sm" variant="ghost" className="h-8 px-2.5 text-xs" onClick={onCancel} disabled={saving}>
            ביטול
          </Button>
          <Button
            ref={confirmRef}
            type="button"
            size="sm"
            className="h-8 gap-1.5 bg-primary px-3 text-xs text-primary-foreground hover:bg-primary/90"
            onClick={onConfirm}
            disabled={!ready || saving}
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {saving ? 'שומרים...' : 'אישור'}
            {!saving ? <kbd className="rounded bg-white/20 px-1 text-[10px] font-bold">Enter</kbd> : null}
          </Button>
        </div>
      </div>

      {ready && summary.warnings.map((warning) => (
        <div key={warning} className="flex items-start gap-2 rounded-lg bg-amber-50 px-2.5 py-2 text-xs font-medium text-amber-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{warning}</span>
        </div>
      ))}

      {error ? (
        <div className="flex items-start gap-2 rounded-lg bg-red-50 px-2.5 py-2 text-xs font-medium text-red-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {ready && showDetails ? (
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {summary.details.map((detail, index) => (
            <li key={`${detail.type}-${index}`} className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-700">
              <span className="block text-[11px] font-bold text-slate-400">{detail.group}</span>
              {detail.message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
