import { Badge } from '@/components/ui/badge';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';

const PHASE_COPY = {
  idle: 'מכין את הנתונים לעיבוד…',
  ingest: 'שומר את הנתונים…',
  analyze: 'בודק את הנתונים…',
  done: 'העיבוד הושלם',
};

export function ProgressOrchestrator({ processing, onRetry }) {
  const pct = Math.round((processing.progress || 0) * 100);
  const isRunning = processing.status === 'running';
  const isDone = processing.status === 'done' && processing.phase === 'done';
  const isError = processing.status === 'error';
  const statusLabel = isError ? 'שגיאה' : isDone ? 'הושלם' : isRunning ? 'מעבד…' : 'ממתין';
  const statusVariant = isError ? 'destructive' : isDone || isRunning ? 'default' : 'secondary';

  return (
    <div className="rounded-lg border p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          {isError ? (
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
          ) : isDone ? (
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
          ) : (
            <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-primary" />
          )}
          <div>
            <p className="font-medium">{isError ? 'לא הצלחנו להשלים את העיבוד' : PHASE_COPY[processing.phase]}</p>
            {processing.currentSourceLabel && !isError && (
              <p className="mt-1 text-xs text-muted-foreground">
                מקור נוכחי: {processing.currentSourceLabel}
              </p>
            )}
          </div>
        </div>
        <Badge variant={statusVariant} className="shrink-0">{statusLabel}</Badge>
      </div>

      {processing.total > 0 && !isError && (
        <div className="space-y-2">
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {processing.processed.toLocaleString()} / {processing.total.toLocaleString()} שורות ({pct}%)
          </p>
        </div>
      )}

      {isError && processing.error && (
        <div className="space-y-2 rounded bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <p>{processing.error}</p>
          <button type="button" className="font-medium underline underline-offset-2" onClick={onRetry}>
            נסה שוב
          </button>
        </div>
      )}
    </div>
  );
}
