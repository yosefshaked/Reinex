import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { PlayCircle, RefreshCcw, Square } from 'lucide-react';

/**
 * OperationCard — reusable progress block for a single multi-chunk operation
 * (ingestion or analysis). Derives its button / state display from
 * the hook's { status, progress, ... } return value.
 *
 * @param {{
 *   title: string,
 *   description?: string,
 *   status: 'idle'|'running'|'done'|'error'|'cancelled',
 *   progress: number,        // 0-1
 *   processedRows: number,
 *   totalRows: number,
 *   error?: string|null,
 *   onStart: () => void,
 *   onResume?: () => void,
 *   onCancel: () => void,
 *   disabled?: boolean,
 * }} props
 */
function OperationCard({
  title,
  description,
  status,
  progress,
  processedRows,
  totalRows,
  error,
  onStart,
  onResume,
  onCancel,
  disabled = false,
}) {
  const pct = Math.round((progress || 0) * 100);

  const statusLabel = {
    idle:       'ממתין',
    running:    'מעבד…',
    done:       'הושלם',
    error:      'שגיאה',
    cancelled:  'בוטל',
  }[status] || status;

  const statusVariant = {
    idle:      'secondary',
    running:   'default',
    done:      'default',
    error:     'destructive',
    cancelled: 'secondary',
  }[status] || 'secondary';

  return (
    <div className={cn(
      'rounded-lg border p-4 space-y-3',
      disabled && 'opacity-50 pointer-events-none',
    )}>
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">{title}</p>
          {description && (
            <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
          )}
        </div>
        <Badge variant={statusVariant} className="shrink-0">{statusLabel}</Badge>
      </div>

      {/* Progress bar — show when running or done */}
      {(status === 'running' || status === 'done') && (
        <div className="space-y-1">
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {processedRows.toLocaleString()} / {totalRows.toLocaleString()} שורות ({pct}%)
          </p>
        </div>
      )}

      {/* Error message */}
      {status === 'error' && error && (
        <p className="text-xs text-destructive bg-destructive/10 rounded px-2 py-1">{error}</p>
      )}

      {/* Actions */}
      <div className="flex gap-2 justify-end">
        {(status === 'idle' || status === 'error') && (
          <Button size="sm" variant="default" onClick={onStart} className="gap-1.5">
            <PlayCircle className="h-4 w-4" />
            התחל
          </Button>
        )}
        {status === 'cancelled' && onResume && (
          <Button size="sm" variant="outline" onClick={onResume} className="gap-1.5">
            <RefreshCcw className="h-4 w-4" />
            המשך
          </Button>
        )}
        {status === 'running' && (
          <Button size="sm" variant="outline" onClick={onCancel} className="gap-1.5">
            <Square className="h-4 w-4" />
            עצור
          </Button>
        )}
      </div>
    </div>
  );
}

// Map hook-native status strings to OperationCard's display status
function toDisplayStatus(hookStatus) {
  if (hookStatus === 'ingesting' || hookStatus === 'analyzing') return 'running';
  return hookStatus; // 'idle' | 'done' | 'error' pass through as-is
}

/**
 * ProgressOrchestrator — renders ingestion + analysis progress cards side by side.
 *
 * Ingestion (phase 3) must complete before analysis (phase 4) is enabled.
 *
 * @param {{
 *   ingestion: object,  // return value of useImportRowIngestion
 *   analysis: object,   // return value of useImportAnalysis
 *   ingestDoneFromConfig?: boolean,
 * }} props
 */
export function ProgressOrchestrator({ ingestion, analysis, ingestDoneFromConfig = false }) {
  const ingestionStatus = ingestion.status === 'done' || ingestDoneFromConfig
    ? 'done'
    : ingestion.status;
  const analysisLocked = !(ingestion.status === 'done' || ingestDoneFromConfig);

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <OperationCard
        title="קליטת שורות"
        description="שמירת שורות הגולמיות בשרת"
        status={toDisplayStatus(ingestionStatus)}
        progress={ingestion.progress}
        processedRows={ingestion.uploadedRows ?? 0}
        totalRows={ingestion.totalRows ?? 0}
        error={typeof ingestion.error === 'string' ? ingestion.error : ingestion.error?.message}
        onStart={ingestion.ingest}
        onResume={ingestion.resume}
        onCancel={ingestion.cancel}
      />
      <OperationCard
        title="ניתוח וזיהוי"
        description="יצירת ועדכון רשומות מועמדות"
        status={toDisplayStatus(analysis.status)}
        progress={analysis.progress}
        processedRows={analysis.analyzedRows ?? 0}
        totalRows={analysis.totalRows ?? 0}
        error={typeof analysis.error === 'string' ? analysis.error : analysis.error?.message}
        onStart={analysis.analyze}
        onResume={analysis.resume}
        onCancel={analysis.cancel}
        disabled={analysisLocked}
      />
    </div>
  );
}
