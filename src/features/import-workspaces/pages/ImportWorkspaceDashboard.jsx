import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import PageLayout from '@/components/ui/PageLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ArrowRight, UploadCloud, RefreshCcw, Zap, Loader2, CheckCircle2, AlertCircle, Download, Info } from 'lucide-react';

import { getImportWorkspace, patchWorkspaceConfig, listCandidates, runDryRunChunk, commitChunk, getUploadStatus, getRowsStatus } from '../api/importWorkspacesApi.js';
import { useImportFileUpload } from '../hooks/useImportFileUpload.js';
import {
  getMappedSourceReferences,
  getSourceTotalRows,
  useImportProcessing,
} from '../hooks/useImportProcessing.js';
import { PipelineStepper } from '../components/PipelineStepper.jsx';
import { MappingEditor } from '../components/MappingEditor.jsx';
import { ProgressOrchestrator } from '../components/ProgressOrchestrator.jsx';
import { CandidateQueue } from '../components/CandidateQueue.jsx';
import { CandidateDetailSheet } from '../components/CandidateDetailSheet.jsx';

function getWorkspaceTotalRows(config) {
  const sources = getWorkspaceSources(config);
  if (sources.length > 1) {
    return sources.reduce((sum, source) => sum + Number(source.profile?.totalRows || source.profile?.rowCount || 0), 0);
  }
  const progress = config?.operationProgress || {};
  return Number(
    config?.profile?.rowCount ??
    config?.profile?.totalRows ??
    progress.totalRows ??
    progress.uploadedRows ??
    0
  );
}

function hasConfiguredMapping(mapping) {
  if (mapping?.entities) {
    return Object.values(mapping.entities).some((entity) => (
      entity?.enabled && Object.keys(entity.field_map || {}).length > 0
    ));
  }
  return Object.keys(mapping?.field_map || {}).length > 0;
}

function getWorkspaceSources(config = {}) {
  if (Array.isArray(config.sources) && config.sources.length > 0) return config.sources;
  if (!config.sourceReference) return [];
  return [{
    sourceReference: config.sourceReference,
    label: config.fileName || config.sourceReference,
    headers: config.profile?.headers || config.headers || [],
    profile: config.profile || {},
  }];
}

// ── Step derivation ────────────────────────────────────────────────────────
function getUploadedRows(config, sourceReference, ingestedRowsBySource = {}) {
  return Math.max(
    Number(config.operationProgress?.by_source?.[sourceReference]?.uploadedRows || 0),
    Number(ingestedRowsBySource[sourceReference] || 0),
  );
}

function deriveCompletedSteps(ws, ingestionStatus, analysisStatus, ingestedRowsBySource = {}) {
  const config   = ws?.config || {};
  const progress = config.operationProgress || {};
  const totalRows = getWorkspaceTotalRows(config);
  const completed = [];

  const sources = getWorkspaceSources(config);
  const hasMappings = hasConfiguredMapping(config.mappings || {});
  const sourceProgress = progress.by_source || {};
  const { anchorReferences, participatingReferences } = getMappedSourceReferences(config);
  const participatingSources = participatingReferences.size > 0
    ? sources.filter((source) => participatingReferences.has(source.sourceReference))
    : sources;
  const analyzedSources = anchorReferences.length > 0
    ? sources.filter((source) => anchorReferences.includes(source.sourceReference))
    : sources;
  const sourcesIngested = participatingSources.length > 0 && participatingSources.every((source) => {
    const count = getSourceTotalRows(source);
    return count > 0 && getUploadedRows(config, source.sourceReference, ingestedRowsBySource) >= count;
  });
  const sourcesAnalyzed = analyzedSources.length > 0 && analyzedSources.every((source) => {
    const count = getSourceTotalRows(source);
    return count > 0 && Number(sourceProgress[source.sourceReference]?.analyzedRows || 0) >= count;
  });
  const ingestDone   = sourcesIngested || (sources.length === 1 && (
    ingestionStatus === 'done' || (totalRows > 0 && progress.uploadedRows >= totalRows)
  ));
  const analyzeDone  = sourcesAnalyzed || (sources.length === 1 && (
    analysisStatus === 'done' || (progress.analyzedRows >= totalRows && totalRows > 0)
  ));

  if (config.sourceReference) completed.push('upload');
  if (hasMappings)            completed.push('map');
  if (ingestDone)             completed.push('ingest');
  if (analyzeDone)            completed.push('analyze');
  if (analyzeDone)            completed.push('review');

  return completed;
}

function deriveCurrentStep(ws, ingestionStatus, analysisStatus, ingestedRowsBySource = {}) {
  const config   = ws?.config || {};
  const progress = config.operationProgress || {};
  const totalRows = getWorkspaceTotalRows(config);

  if (!config.sourceReference) return 'upload';

  const sources = getWorkspaceSources(config);
  const hasMappings = hasConfiguredMapping(config.mappings || {});
  if (!hasMappings) return 'map';

  const sourceProgress = progress.by_source || {};
  const { anchorReferences, participatingReferences } = getMappedSourceReferences(config);
  const participatingSources = participatingReferences.size > 0
    ? sources.filter((source) => participatingReferences.has(source.sourceReference))
    : sources;
  const analyzedSources = anchorReferences.length > 0
    ? sources.filter((source) => anchorReferences.includes(source.sourceReference))
    : sources;
  const ingestDoneFromSources = participatingSources.length > 0 && participatingSources.every((source) => {
    const count = getSourceTotalRows(source);
    return count > 0 && getUploadedRows(config, source.sourceReference, ingestedRowsBySource) >= count;
  });
  const ingestDone  = ingestDoneFromSources || (sources.length === 1 && (
    ingestionStatus === 'done' || (totalRows > 0 && progress.uploadedRows >= totalRows)
  ));
  if (!ingestDone) return 'process';

  const analyzeDoneFromSources = analyzedSources.length > 0 && analyzedSources.every((source) => {
    const count = getSourceTotalRows(source);
    return count > 0 && Number(sourceProgress[source.sourceReference]?.analyzedRows || 0) >= count;
  });
  const analyzeDone = analyzeDoneFromSources || (sources.length === 1 && (
    analysisStatus === 'done' || (progress.analyzedRows >= totalRows && totalRows > 0)
  ));
  if (!analyzeDone) return 'process';

  return 'review';
}

// ── Upload Step ────────────────────────────────────────────────────────────
function UploadStep({ hook, workspace, onDone, onCreateNew }) {
  const { fileState, uploadState, parseState, parsedRows, selectFile, upload, parse } = hook;

  const fileInputRef = useRef(null);
  const [backupStatus, setBackupStatus] = useState({ status: 'idle', data: null, error: null });
  const config = workspace?.config || {};
  const savedSources = getWorkspaceSources(config);
  const existingFileName = config.fileName || config.sourceReference || '';
  const hasServerBackup = Boolean(config.objectKey);
  const hasParsedProfile = Boolean(config.sourceReference && (config.profile?.headers?.length || config.headers?.length));
  const hasCurrentFile = Boolean(fileState.file);

  const isUploaded  = uploadState.status === 'done';
  const isCurrentParsed = parseState.status === 'done' && parsedRows !== null;
  const isParsed    = isCurrentParsed || (!hasCurrentFile && hasParsedProfile);
  const isUploading = ['requesting_url', 'uploading', 'saving_metadata'].includes(uploadState.status);
  const isParsing   = ['reading', 'parsing', 'saving_profile'].includes(parseState.status);
  const uploadFailedNonblocking = uploadState.status === 'failed_nonblocking';
  const shouldShowExistingParsedFile = hasParsedProfile && !hasCurrentFile;
  const backupExpiresAt = config.backupExpiresAt ||
    (config.uploadedAt ? new Date(new Date(config.uploadedAt).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString() : null);

  useEffect(() => {
    if (!workspace?.id || !config.objectKey) {
      setBackupStatus({ status: 'idle', data: null, error: null });
      return;
    }
    let cancelled = false;
    setBackupStatus({ status: 'loading', data: null, error: null });
    getUploadStatus(workspace.id)
      .then((data) => {
        if (!cancelled) setBackupStatus({ status: 'done', data, error: null });
      })
      .catch((err) => {
        if (!cancelled) setBackupStatus({ status: 'error', data: null, error: err });
      });
    return () => {
      cancelled = true;
    };
  }, [workspace?.id, config.objectKey]);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-muted/35 px-4 py-3 text-sm">
        <div className="flex items-start gap-2">
          <TooltipProvider delayDuration={150}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border bg-background text-muted-foreground"
                  aria-label="מה ההבדל בין העלאה לשרת לבין ניתוח קובץ?"
                >
                  <Info className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs leading-relaxed">
                העלאה לשרת היא גיבוי זמני שעוזר לנו לבדוק תקלות. ניתוח קובץ קורא את הקובץ אצלך במחשב וממנו ממשיכים לייבוא.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <p className="text-muted-foreground">
            אפשר להעלות גיבוי זמני לשרת ל-30 יום, אבל זה לא חובה. גם אם הגיבוי נכשל, אפשר להמשיך לנתח את הקובץ מהמחשב.
          </p>
        </div>
      </div>

      {shouldShowExistingParsedFile && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-900/70 dark:bg-emerald-950/30 dark:text-emerald-200">
          <p className="font-medium">קובץ כבר נותח בסביבת הייבוא הזו</p>
          <p className="mt-1 text-emerald-800/80 dark:text-emerald-200/80">
            {existingFileName ? `קובץ: ${existingFileName}` : 'אפשר להמשיך למיפוי בלי להעלות שוב.'}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={onDone} className="gap-2">
              <CheckCircle2 className="h-4 w-4" />
              המשך למיפוי
            </Button>
            <Button variant="outline" onClick={onCreateNew}>
              ייבוא קובץ אחר בסביבה חדשה
            </Button>
          </div>
        </div>
      )}

      {hasServerBackup && !hasParsedProfile && !hasCurrentFile && (
        <div className="rounded-lg border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          הגיבוי לשרת כבר קיים. כדי לנתח את הנתונים צריך לבחור את הקובץ מהמחשב, בלי להעלות אותו שוב.
        </div>
      )}

      {hasServerBackup && (
        <div className="rounded-lg border bg-background px-4 py-3 text-sm">
          <p className="font-medium text-foreground">מצב הגיבוי הזמני</p>
          {backupStatus.status === 'loading' ? (
            <p className="mt-1 text-muted-foreground">בודק אם קובץ הגיבוי עדיין קיים בשרת…</p>
          ) : backupStatus.data?.status === 'available' ? (
            <p className="mt-1 text-emerald-700 dark:text-emerald-300">
              הגיבוי הזמני עדיין קיים בשרת
              {backupExpiresAt ? `, והוא צפוי להימחק סביב ${new Date(backupExpiresAt).toLocaleDateString('he-IL')}.` : '.'}
            </p>
          ) : backupStatus.data?.status === 'missing_or_expired' ? (
            <p className="mt-1 text-amber-700 dark:text-amber-300">
              הגיבוי הזמני נמחק או פג תוקף. אם הקובץ כבר נותח, אפשר להמשיך כרגיל; אם לא, צריך לבחור את הקובץ מהמחשב שוב.
            </p>
          ) : backupStatus.status === 'error' ? (
            <p className="mt-1 text-muted-foreground">
              לא הצלחנו לבדוק כרגע את מצב הגיבוי. זה לא חוסם את הייבוא, כי הנתונים השמורים נשענים על השורות שכבר נותחו.
            </p>
          ) : (
            <p className="mt-1 text-muted-foreground">
              הגיבוי הוא זמני בלבד ונמחק אוטומטית לפי מדיניות השרת.
            </p>
          )}
        </div>
      )}

      {/* File picker */}
      <div className="flex items-center gap-3 flex-wrap">
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="sr-only"
          id="file-picker-upload"
          onChange={e => {
            const f = e.target.files?.[0];
            if (f) selectFile(f);
            e.target.value = '';
          }}
        />
        <Button
          variant="outline"
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading || isParsing}
          className="gap-2"
        >
          <UploadCloud className="h-4 w-4" />
          {fileState.file ? fileState.file.name : savedSources.length > 0 ? 'בחר קובץ נוסף' : existingFileName || 'בחר קובץ'}
        </Button>

        {fileState.file && !isUploaded && (
          <Button onClick={upload} disabled={isUploading} className="gap-2">
            {isUploading ? 'מעלה…' : 'העלה לשרת'}
          </Button>
        )}

        {fileState.file && !isCurrentParsed && (
          <Button onClick={parse} disabled={isParsing} className="gap-2">
            {isParsing ? `מנתח… ${parseState.pct}%` : 'נתח קובץ'}
          </Button>
        )}

        {isParsed && (
          <Button
            onClick={onDone}
            className="gap-2 bg-emerald-600 text-white shadow-lg shadow-emerald-600/25 ring-2 ring-emerald-300 animate-pulse hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-600"
          >
            <CheckCircle2 className="h-4 w-4" />
            המשך למיפוי
          </Button>
        )}
      </div>

      {(isParsed || savedSources.length > 0 || hook.parsedSources?.length > 0) && (
        <p className="text-xs text-muted-foreground">
          מייבאים מכמה קבצים (למשל תלמידים והורים בנפרד)? בחר/י עכשיו קובץ נוסף — כל קובץ מנותח בנפרד
          ומתווסף לרשימת המקורות למטה. כשסיימת להוסיף את כל הקבצים, לחצ/י &quot;המשך למיפוי&quot;.
        </p>
      )}

      {(savedSources.length > 0 || hook.parsedSources?.length > 0) && (
        <div className="space-y-2 rounded-lg border p-3">
          <p className="text-sm font-medium">מקורות שנוספו</p>
          {[...new Map([
            ...savedSources,
            ...(hook.parsedSources || []),
          ].map((source) => [source.sourceReference, source])).values()].map((source) => (
            <div key={source.sourceReference} className="flex items-center justify-between gap-3 text-sm">
              <span>{source.label || source.sheetName || source.filename || source.sourceReference}</span>
              <Badge variant="secondary">{Number(source.profile?.totalRows || 0).toLocaleString()} שורות</Badge>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">כל קובץ (וכל גיליון) נשמר כמקור נפרד, כדי שאפשר למפות תלמידים והורים בנפרד ולחבר ביניהם בשלב המיפוי.</p>
        </div>
      )}

      {/* Status messages */}
      {fileState.error && (
        <p className="text-xs text-destructive">{fileState.error}</p>
      )}
      {uploadFailedNonblocking && (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          העלאת הגיבוי לשרת נכשלה — ניתן להמשיך, הקובץ ינותח מקומית
          {uploadState.error ? ` (${uploadState.error})` : ''}
        </p>
      )}
      {uploadState.error && !uploadFailedNonblocking && (
        <p className="text-xs text-destructive">{uploadState.error}</p>
      )}
      {parseState.error && (
        <p className="text-xs text-destructive">{parseState.error}</p>
      )}

      {/* Parsed summary */}
      {isParsed && (
        <div className="rounded-lg bg-muted/50 px-4 py-3 text-sm space-y-1">
          <p className="font-medium text-green-700 dark:text-green-400">הקובץ נותח בהצלחה</p>
          <p className="text-muted-foreground">
            {(hook.parsedRows?.length ?? config.profile?.rowCount ?? config.profile?.totalRows ?? 0).toLocaleString()} שורות •{' '}
            {(hook.profile?.headers?.length ?? config.profile?.headers?.length ?? config.headers?.length ?? 0)} עמודות
          </p>
        </div>
      )}
    </div>
  );
}

// ── Map Step ───────────────────────────────────────────────────────────────
function MapStep({ workspace, onSaved }) {
  const config      = workspace.config || {};
  const sources     = getWorkspaceSources(config);
  const workspaceId = workspace.id;

  const [saving, setSaving]         = useState(false);
  const [saveError, setSaveError]   = useState(null);

  async function handleSave(entities, join) {
    setSaving(true);
    setSaveError(null);
    try {
      const progressReset = Object.fromEntries(
        sources
          .map((source) => source.sourceReference)
          .filter(Boolean)
          .map((sourceReference) => [sourceReference, { analyzedRows: 0 }]),
      );
      await patchWorkspaceConfig(workspaceId, {
        mappings: {
          entities,
          join,
        },
        operationProgress: {
          by_source: progressReset,
        },
      });
      onSaved?.();
    } catch (err) {
      setSaveError(err.message || 'שגיאה בשמירה');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        הפעל את האזורים שברצונך לייבא ומפה אותם במקביל. כל שורה יכולה ליצור לקוח, הורה, חיבור להורה ושירות.
      </p>
      {saveError && <p className="text-xs text-destructive">{saveError}</p>}
      <MappingEditor
        sources={sources}
        initialEntities={config.mappings?.entities || {}}
        initialJoin={config.mappings?.join || {}}
        onSave={handleSave}
        saving={saving}
      />
    </div>
  );
}

// Recover parsed rows that were lost (e.g. after a refresh): first try to
// re-download + re-parse the server backup automatically, then fall back to
// asking the user to re-select the same file from disk.
function RowRecovery({ uploadHook, objectKey, fileName, remainingCount = 1 }) {
  const { parseState, recoverFromBackup, recoverFromFile } = uploadHook;
  const [phase, setPhase] = useState(objectKey ? 'recovering' : 'needs_reupload');
  const [recoverError, setRecoverError] = useState(null);
  const [pickedName, setPickedName] = useState(null);
  const fileInputRef = useRef(null);
  const attemptedRef = useRef(false);

  const attemptRecover = useCallback(() => {
    setRecoverError(null);
    setPhase('recovering');
    recoverFromBackup(objectKey, { fileName }).catch((err) => {
      setRecoverError(err?.message || 'recover_failed');
      setPhase('needs_reupload');
    });
  }, [objectKey, fileName, recoverFromBackup]);

  useEffect(() => {
    if (attemptedRef.current || !objectKey) return;
    attemptedRef.current = true;
    attemptRecover();
  }, [objectKey, attemptRecover]);

  const isBusy = ['reading', 'parsing', 'saving_profile'].includes(parseState.status);

  function handlePick(file) {
    if (!file) return;
    setPickedName(file.name);
    setRecoverError(null);
    setPhase('recovering');
    recoverFromFile(file, objectKey)
      .catch((err) => {
        setRecoverError(err?.message || 'parse_failed');
        setPhase('needs_reupload');
      })
      // Clear the input only AFTER the read settles. Resetting value mid-read can
      // abort the FileReader (NotReadableError → file_read_error) in Chrome.
      .finally(() => { if (fileInputRef.current) fileInputRef.current.value = ''; });
  }

  if (phase === 'recovering') {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-300">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>
          {parseState.stage === 'downloading_backup'
            ? 'משחזר את הקובץ מהגיבוי בשרת…'
            : `מנתח מחדש את הקובץ… ${parseState.pct || 0}%`}
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800 dark:border-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-300">
      <div>
        <p className="font-medium">
          צריך לטעון מחדש את הקובץ{fileName ? `: ${fileName}` : ''}
          {remainingCount > 1 ? ` (נותרו ${remainingCount} מקורות)` : ''}
        </p>
        <p className="mt-1 text-xs">
          הנתונים נקראים מהקובץ בדפדפן ולא נשמרים אחרי רענון הדף.
          {objectKey ? ' לא הצלחנו לשחזר את הקובץ מהגיבוי בשרת. ' : ' '}
          {fileName
            ? `בחר/י שוב את הקובץ ${fileName} כדי להמשיך בקליטה. `
            : 'בחר/י שוב את אותו קובץ כדי להמשיך בקליטה. '}
          הגיבוי בשרת הוא עותק בטיחות בלבד ואינו משמש לייבוא.
        </p>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="sr-only"
        onChange={(e) => handlePick(e.target.files?.[0])}
      />
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" className="gap-2" onClick={() => fileInputRef.current?.click()} disabled={isBusy}>
          <UploadCloud className="h-4 w-4" />
          {pickedName || (fileName ? `בחר/י את ${fileName}` : 'בחר/י קובץ')}
        </Button>
        {objectKey && (
          <Button variant="ghost" size="sm" className="gap-2" onClick={attemptRecover} disabled={isBusy}>
            <RefreshCcw className="h-4 w-4" />
            נסה לשחזר שוב מהשרת
          </Button>
        )}
      </div>
      {recoverError && (
        <p className="text-xs text-muted-foreground">{`לא ניתן לשחזר (${recoverError}). נסה/י לבחור את הקובץ שוב.`}</p>
      )}
    </div>
  );
}

// ── Processing Step ────────────────────────────────────────────────────────
function ProcessStep({ processing, uploadHook, workspace, sourceReference, onSourceChange, onRetry }) {
  const config    = workspace.config || {};
  const sources = getWorkspaceSources(config);
  const { anchorReferences, participatingReferences } = getMappedSourceReferences(config);
  const requiredSources = participatingReferences.size > 0
    ? sources.filter((source) => participatingReferences.has(source.sourceReference))
    : sources;
  const hasSourceMapping = anchorReferences.includes(sourceReference);
  // Sources whose rows are neither in memory nor saved in the DB yet. Recovered
  // one at a time (a single parse can run at once); the next surfaces after each.
  const recoverySources = requiredSources.filter((source) => {
    const reference = source.sourceReference;
    const totalRows = getSourceTotalRows(source);
    const hasRows = uploadHook.parsedSources?.some((parsedSource) => (
      parsedSource.sourceReference === reference && Array.isArray(parsedSource.rows)
    ));
    const uploadedRows = Number(processing.sourceProgress?.[reference]?.uploadedRows || 0);
    return totalRows > 0 && uploadedRows < totalRows && !hasRows;
  });
  const recoverySource = recoverySources[0] || null;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        מעבד את הקובץ — אפשר להמתין כאן. השורות נשמרות לבדיקה ולאחר מכן נבדקות מול כללי המערכת.
      </p>
      {sources.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {sources.map((source) => (
            <Button
              key={source.sourceReference}
              type="button"
              size="sm"
              variant={source.sourceReference === sourceReference ? 'default' : 'outline'}
              onClick={() => onSourceChange?.(source.sourceReference)}
            >
              {source.label || source.sheetName || source.filename || source.sourceReference}
            </Button>
          ))}
        </div>
      )}
      {/* Parsed rows lost (e.g. after refresh): recover from backup or re-pick. */}
      {recoverySource && (
        <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50/70 p-3 dark:border-amber-900/60 dark:bg-amber-950/20">
          <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
            חסר מקור שנדרש לפי המיפוי
          </p>
          <p className="text-xs text-amber-800/80 dark:text-amber-200/80">
            המיפוי משתמש במקור הזה, לכן צריך לטעון או לשחזר את השורות שלו לפני הניתוח.
          </p>
          <RowRecovery
            key={recoverySource.sourceReference}
            uploadHook={uploadHook}
            objectKey={recoverySource.file?.objectKey || config.objectKey || null}
            fileName={recoverySource.file?.fileName || recoverySource.label || config.fileName || null}
            remainingCount={recoverySources.length}
          />
        </div>
      )}
      <ProgressOrchestrator processing={processing} onRetry={onRetry} />
      {!hasSourceMapping && (
        <p className="text-xs text-muted-foreground">
          המקור הזה משמש להשלמת פרטים במיפוי אחר. צריך לשמור את השורות שלו, אבל אין צורך למפות או לנתח אותו בנפרד.
        </p>
      )}
    </div>
  );
}

const ENTITY_TYPE_LABELS = {
  customer: 'לקוח/ה',
  guardian: 'הורה',
  guardian_link: 'קישור הורה-תלמיד',
  service: 'שירות',
};

const STATUS_LABELS = {
  needs_review: 'לבדיקה',
  ready: 'מוכן',
  blocked: 'חסום',
  blocked_by_dependency: 'ממתין לתלות',
  skipped: 'מדולג',
  committed: 'בוצע',
  failed: 'נכשל',
};

const FIELD_LABELS = {
  first_name: 'שם פרטי',
  last_name: 'שם משפחה',
  identity_number: 'תעודת זהות',
  phone: 'טלפון',
  guardian_first_name: 'שם פרטי של ההורה',
  guardian_last_name: 'שם משפחה של ההורה',
  guardian_phone: 'טלפון הורה',
  guardian_email: 'אימייל הורה',
  email: 'אימייל',
  date_of_birth: 'תאריך לידה',
  customer_type: 'סוג לקוח',
  is_active: 'פעיל/ה',
  relationship: 'קרבה',
  service_name: 'שם השירות',
  name: 'שם השירות',
  description: 'תיאור',
};

const ISSUE_MESSAGES = {
  missing_required_field: 'שדה חובה חסר.',
  missing_recommended_field: 'שדה מומלץ חסר.',
  invalid_field_format: 'פורמט השדה לא תקין.',
  duplicate_identity_number: 'קיימת כבר רשומה במערכת עם אותה תעודת זהות. אי אפשר ליצור שתי רשומות עם אותו מספר; יש לקשר לרשומה הקיימת, לתקן את המספר, או לדלג.',
  duplicate_identity_in_file: 'אותה תעודת זהות מופיעה יותר מפעם אחת בקובץ או במרחב הייבוא. יש לתקן או לדלג על הכפילות.',
  duplicate_email: 'קיימת כבר רשומה עם אותו אימייל. מומלץ לבדוק אם זו אותה רשומה.',
  missing_contact_path: 'נדרש טלפון תקין בתלמיד/ה או באפוטרופוס מקושר.',
};

function candidateDisplayName(candidate) {
  const data = candidate?.candidate_data || {};
  return [
    data.first_name,
    data.last_name,
  ].filter(Boolean).join(' ')
    || [
      data.guardian_first_name,
      data.guardian_last_name,
    ].filter(Boolean).join(' ')
    || data.service_name
    || data.name
    || '—';
}

function issueText(issue) {
  const fieldPrefix = FIELD_LABELS[issue?.field] ? `${FIELD_LABELS[issue.field]}: ` : '';
  const duplicateName = String(issue?.duplicate_name || '').trim();
  const duplicateNames = Array.isArray(issue?.duplicate_names)
    ? issue.duplicate_names.map((name) => String(name || '').trim()).filter(Boolean)
    : [];
  const duplicateText = duplicateName
    ? ` (${duplicateName})`
    : duplicateNames.length > 0
      ? ` (${duplicateNames.join(', ')})`
      : '';
  const baseMessage = issue?.message || ISSUE_MESSAGES[issue?.code] || issue?.code || 'נדרשת בדיקה.';
  const message = !issue?.message && ['duplicate_identity_number', 'duplicate_identity_in_file'].includes(issue?.code)
    ? baseMessage.replace('.', `${duplicateText}.`)
    : baseMessage;
  return `${fieldPrefix}${message}`;
}

function candidateExclusionReasons(candidate) {
  const status = String(candidate?.status || '');
  if (status === 'skipped') return ['סומן לדילוג ולכן לא ייובא.'];
  if (status === 'needs_review') return ['עדיין ממתין להחלטה בסקירה.'];
  if (status === 'failed') return ['נכשל בביצוע קודם. יש לחזור לסקירה, לתקן ולנסות שוב.'];
  if (status === 'blocked_by_dependency') return ['ממתין לתלות אחרת לפני הייבוא.'];

  const issues = Array.isArray(candidate?.issues) ? candidate.issues : [];
  if (issues.length > 0) return issues.map(issueText);
  if (status && status !== 'ready') return [`סטטוס: ${STATUS_LABELS[status] || status}`];
  return ['לא ייובא בשלב זה.'];
}

function CandidatePreviewRow({ candidate, reasons = [], variant = 'import' }) {
  const isExcluded = variant === 'excluded';
  return (
    <div className="rounded-md border px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium">{candidateDisplayName(candidate)}</p>
          <p className="text-xs text-muted-foreground">
            {ENTITY_TYPE_LABELS[candidate.entity_type] || candidate.entity_type}
          </p>
        </div>
        <Badge variant={isExcluded ? 'secondary' : 'default'} className="text-xs">
          {STATUS_LABELS[candidate.status] || candidate.status}
        </Badge>
      </div>
      {reasons.length > 0 && (
        <ul className="mt-2 space-y-1">
          {reasons.map((reason, index) => (
            <li
              key={`${candidate.id}-${index}`}
              className={isExcluded
                ? 'rounded bg-destructive/10 px-2 py-1 text-xs text-destructive'
                : 'rounded bg-emerald-50 px-2 py-1 text-xs text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300'}
            >
              {reason}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Collect all candidates, optionally scoped to a status, by paginating through listCandidates.
async function fetchAllCandidates(workspaceId, status, sourceReference) {
  const candidates = [];
  let page = 1;
  while (true) {
    const result = await listCandidates(workspaceId, {
      status: status || undefined,
      sourceReference,
      page,
    });
    const batch = result.candidates ?? [];
    candidates.push(...batch);
    if (batch.length < (result.pageSize ?? 50)) break;
    page++;
  }
  return candidates;
}

// Topological commit waves: each wave depends on the previous one completing first.
const COMMIT_WAVES = [
  { label: 'לקוחות ותלמידים', types: ['customer'] },
  { label: 'הורים ושירותים',  types: ['guardian', 'service'] },
  { label: 'קישורי הורים',    types: ['guardian_link'] },
];

// ── Commit Step ────────────────────────────────────────────────────────────
function CommitStep({ workspaceId, sourceReference, onBackToReview }) {
  const [phase, setPhase]       = useState('idle'); // 'idle' | 'running' | 'done' | 'partial' | 'error'
  const [progress, setProgress] = useState({ done: 0, total: 0, waveLabel: '' });
  const [summary, setSummary]   = useState({ committed: 0, failed: 0 });
  const [errorMsg, setErrorMsg] = useState('');
  const [preview, setPreview] = useState({ loading: true, error: '', importable: [], excluded: [] });

  const loadPreview = useCallback(async () => {
    if (!workspaceId) return;
    setPreview((current) => ({ ...current, loading: true, error: '' }));
    try {
      const candidates = await fetchAllCandidates(workspaceId, '', sourceReference);
      const importable = candidates.filter((candidate) => candidate.status === 'ready');
      const excluded = candidates.filter((candidate) => (
        candidate.status !== 'ready' && candidate.status !== 'committed'
      ));
      setPreview({ loading: false, error: '', importable, excluded });
    } catch (err) {
      setPreview({ loading: false, error: err.message || 'שגיאה בטעינת תצוגת הייבוא', importable: [], excluded: [] });
    }
  }, [sourceReference, workspaceId]);

  useEffect(() => {
    if (phase === 'idle') loadPreview();
  }, [loadPreview, phase]);

  async function runCommit(mode = 'full') {
    if (phase === 'running') return;
    setPhase('running');
    setErrorMsg('');
    setProgress({ done: 0, total: 0, waveLabel: '' });
    setSummary({ committed: 0, failed: 0 });

    try {
      let candidates;
      if (mode === 'retry') {
        candidates = await fetchAllCandidates(workspaceId, 'failed', sourceReference);
      } else {
        const ready   = await fetchAllCandidates(workspaceId, 'ready', sourceReference);
        const skipped = await fetchAllCandidates(workspaceId, 'skipped', sourceReference);
        candidates = [...ready, ...skipped];
      }

      if (candidates.length === 0) {
        setPhase('done');
        return;
      }

      const grouped = {};
      for (const c of candidates) {
        if (!grouped[c.entity_type]) grouped[c.entity_type] = [];
        grouped[c.entity_type].push(c.id);
      }

      const total = candidates.length;
      setProgress({ done: 0, total, waveLabel: '' });
      let done = 0;
      let totalCommitted = 0;
      let totalFailed = 0;

      for (const wave of COMMIT_WAVES) {
        const idsInWave = wave.types.flatMap(t => grouped[t] ?? []);
        if (idsInWave.length === 0) continue;
        setProgress({ done, total, waveLabel: wave.label });
        for (let i = 0; i < idsInWave.length; i += 25) {
          const chunk  = idsInWave.slice(i, i + 25);
          const result = await commitChunk(workspaceId, chunk);
          totalCommitted += Number(result.committed ?? chunk.length);
          totalFailed    += Number(result.failed ?? 0);
          done += chunk.length;
          setProgress({ done, total, waveLabel: wave.label });
        }
      }

      setSummary({ committed: totalCommitted, failed: totalFailed });
      setPhase(totalFailed > 0 ? 'partial' : 'done');
    } catch (err) {
      setErrorMsg(err.message || 'commit_failed');
      setPhase('error');
    }
  }

  if (phase === 'done') {
    return (
      <div className="py-8 text-center space-y-2">
        <CheckCircle2 className="h-10 w-10 text-green-500 mx-auto" />
        <p className="text-sm font-medium">הייבוא הושלם בהצלחה</p>
        {summary.committed > 0 && (
          <p className="text-xs text-muted-foreground">{summary.committed} רשומות הועברו לטבלאות הפעילות.</p>
        )}
      </div>
    );
  }

  if (phase === 'partial') {
    return (
      <div className="py-8 text-center space-y-3">
        <AlertCircle className="h-10 w-10 text-yellow-500 mx-auto" />
        <p className="text-sm font-medium">הייבוא הושלם חלקית</p>
        <p className="text-xs text-muted-foreground">
          {summary.committed} הועברו בהצלחה, {summary.failed} נכשלו.
        </p>
        <p className="text-xs text-muted-foreground">
          ניתן לפתוח את הכרטיסים שנכשלו, לתקן את הבעיה ואז לנסות שוב.
        </p>
        <div className="flex flex-wrap gap-2 justify-center">
          {onBackToReview && (
            <Button variant="outline" size="sm" onClick={onBackToReview} className="gap-2">
              <ArrowRight className="h-4 w-4" />
              חזרה לסקירה ותיקון
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => runCommit('retry')} className="gap-2">
            <RefreshCcw className="h-4 w-4" />
            נסה שנית על הנכשלים
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setPhase('done')}>
            סיים ממילא
          </Button>
        </div>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="py-8 text-center space-y-3">
        <AlertCircle className="h-10 w-10 text-destructive mx-auto" />
        <p className="text-sm font-medium text-destructive">שגיאה בביצוע הייבוא</p>
        <p className="text-xs text-muted-foreground">{errorMsg}</p>
        <Button variant="outline" size="sm" onClick={() => setPhase('idle')} className="mt-1">
          נסה שוב
        </Button>
      </div>
    );
  }

  if (phase === 'running') {
    const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
    return (
      <div className="py-8 space-y-4">
        <div className="flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <span>מבצע ייבוא{progress.waveLabel ? ` — ${progress.waveLabel}` : ''}…</span>
        </div>
        <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {progress.done} / {progress.total} רשומות
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="rounded-lg border bg-muted/35 px-4 py-3 text-sm text-muted-foreground">
        בדקו את הרשימות לפני ביצוע. רק מועמדים בסטטוס מוכן יועברו לטבלאות הפעילות; השאר יישארו בסביבת הייבוא לתיקון או דילוג.
      </div>

      {preview.loading && (
        <div className="flex items-center gap-2 rounded-lg border px-4 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          טוען רשימת ייבוא…
        </div>
      )}

      {!preview.loading && preview.error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {preview.error}
        </div>
      )}

      {!preview.loading && !preview.error && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">ייובאו עכשיו</h3>
              <Badge variant="default" className="text-xs">{preview.importable.length}</Badge>
            </div>
            <div className="max-h-[26rem] space-y-2 overflow-y-auto rounded-lg border bg-background p-2">
              {preview.importable.length > 0 ? (
                preview.importable.map((candidate) => (
                  <CandidatePreviewRow
                    key={candidate.id}
                    candidate={candidate}
                    reasons={['מוכן לייבוא.']}
                  />
                ))
              ) : (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                  אין מועמדים מוכנים לייבוא.
                </p>
              )}
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">לא ייובאו עכשיו</h3>
              <Badge variant="secondary" className="text-xs">{preview.excluded.length}</Badge>
            </div>
            <div className="max-h-[26rem] space-y-2 overflow-y-auto rounded-lg border bg-background p-2">
              {preview.excluded.length > 0 ? (
                preview.excluded.map((candidate) => (
                  <CandidatePreviewRow
                    key={candidate.id}
                    candidate={candidate}
                    variant="excluded"
                    reasons={candidateExclusionReasons(candidate)}
                  />
                ))
              ) : (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                  אין מועמדים חסומים או מדולגים.
                </p>
              )}
            </div>
          </section>
        </div>
      )}

      <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row-reverse sm:items-center">
        <Button
          onClick={() => runCommit('full')}
          className="gap-2"
          disabled={preview.loading || Boolean(preview.error) || preview.importable.length === 0}
        >
          <UploadCloud className="h-4 w-4" />
          בצע ייבוא
        </Button>
        <Button variant="outline" onClick={loadPreview} disabled={preview.loading} className="gap-2">
          <RefreshCcw className="h-4 w-4" />
          רענן רשימות
        </Button>
        {onBackToReview && (
          <Button variant="ghost" onClick={onBackToReview} className="gap-2">
            <ArrowRight className="h-4 w-4" />
            חזרה לסקירה
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Main Dashboard ─────────────────────────────────────────────────────────
export default function ImportWorkspaceDashboard() {
  const { id: workspaceId } = useParams();
  const navigate = useNavigate();

  const [workspace, setWorkspace]         = useState(null);
  const [loading, setLoading]             = useState(true);
  const [error, setError]                 = useState(null);
  const [currentStep, setCurrentStep]     = useState('upload');
  const [selectedCandidate, setSelectedCandidate] = useState(null);
  const [sheetOpen, setSheetOpen]         = useState(false);
  const [queueKey, setQueueKey]           = useState(0); // force re-mount queue on decision
  const [isDryRunning, setIsDryRunning]   = useState(false);
  const [dryRunProgress, setDryRunProgress] = useState({ done: 0, total: 0 });
  const [selectedSourceReference, setSelectedSourceReference] = useState(null);
  const [analysisRequest, setAnalysisRequest] = useState(null);
  const [completedAnalysisRequestToken, setCompletedAnalysisRequestToken] = useState(0);
  const [ingestedRowsBySource, setIngestedRowsBySource] = useState({});
  const startedForcedAnalysisKeysRef = useRef(new Set());
  const completionRefreshRef = useRef('');
  const initialStepDerivedRef = useRef(false);

  const config = useMemo(() => workspace?.config || {}, [workspace]);

  // Phase 2: file upload
  const uploadHook = useImportFileUpload(workspaceId, getWorkspaceSources(config));

  const sources = useMemo(() => getWorkspaceSources(config), [config]);
  const sourceRef     = selectedSourceReference || config.activeSourceReference || uploadHook.sourceReference || config.sourceReference || null;
  const processingSources = useMemo(() => {
    const byReference = new Map(sources.map((source) => [source.sourceReference, source]));
    for (const parsedSource of uploadHook.parsedSources || []) {
      byReference.set(parsedSource.sourceReference, {
        ...byReference.get(parsedSource.sourceReference),
        ...parsedSource,
      });
    }
    return [...byReference.values()];
  }, [sources, uploadHook.parsedSources]);
  const getParsedRows = useCallback((reference) => (
    uploadHook.parsedSources?.find((source) => source.sourceReference === reference)?.rows || null
  ), [uploadHook.parsedSources]);
  const processing = useImportProcessing(workspaceId, {
    sources: processingSources,
    config,
    getParsedRows,
    ingestedRowsBySource,
  });
  const {
    analyzeAll,
    ingestAll,
    resetAnalysisProgress,
    sourceProgress: processingSourceProgress,
    status: processingStatus,
  } = processing;

  const load = useCallback(async () => {
    if (!workspaceId) return null;
    setLoading(true);
    setError(null);
    try {
      const ws = await getImportWorkspace(workspaceId);
      const statusResults = await Promise.allSettled(
        getWorkspaceSources(ws.config || {}).map((source) => (
          getRowsStatus(workspaceId, source.sourceReference)
        )),
      );
      const durableCounts = {};
      statusResults.forEach((result) => {
        if (result.status !== 'fulfilled') return;
        durableCounts[result.value.source_reference] = Number(result.value.ingested_rows || 0);
      });
      setIngestedRowsBySource(durableCounts);
      setWorkspace(ws);
      return ws;
    } catch (err) {
      setError(err.message || 'שגיאה בטעינת סביבת הייבוא');
      return null;
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => { load(); }, [load]);

  // Auto-navigate to the current step on first load
  useEffect(() => {
    if (!workspace) return;
    const availableSources = getWorkspaceSources(workspace.config || {});
    setSelectedSourceReference((current) => current
      || workspace.config?.activeSourceReference
      || availableSources[0]?.sourceReference
      || null);
    if (initialStepDerivedRef.current) return;
    initialStepDerivedRef.current = true;
    const derived = deriveCurrentStep(workspace, 'idle', 'idle', ingestedRowsBySource);
    setCurrentStep(derived);
  }, [ingestedRowsBySource, workspace]);

  const handleSourceChange = useCallback(async (nextSourceReference) => {
    await load();
    setSelectedSourceReference(nextSourceReference);
    uploadHook.selectParsedSource(nextSourceReference);
  }, [load, uploadHook]);

  useEffect(() => {
    const { participatingReferences } = getMappedSourceReferences(config);
    if (
      uploadHook.parseState.status !== 'done'
      || uploadHook.parsedSources.length === 0
      || processingStatus === 'running'
      || processingStatus === 'error'
    ) return;
    const hasIncompleteSource = uploadHook.parsedSources
      .filter((source) => participatingReferences.size === 0 || participatingReferences.has(source.sourceReference))
      .some((source) => (
      Number(processingSourceProgress[source.sourceReference]?.uploadedRows || 0) < (source.rows?.length || 0)
    ));
    if (!hasIncompleteSource) return;
    ingestAll();
  }, [
    ingestAll,
    processingSourceProgress,
    processingStatus,
    config,
    uploadHook.parseState.status,
    uploadHook.parsedSources,
  ]);

  useEffect(() => {
    const { anchorReferences, participatingReferences, requiredReferencesByAnchor } = getMappedSourceReferences(config);
    const parsedIngestPending = uploadHook.parsedSources
      .filter((source) => participatingReferences.size === 0 || participatingReferences.has(source.sourceReference))
      .some((source) => (
      Number(processingSourceProgress[source.sourceReference]?.uploadedRows || 0) < (source.rows?.length || 0)
    ));
    if (
      anchorReferences.length === 0
      || parsedIngestPending
      || processingStatus === 'running'
      || processingStatus === 'error'
    ) return;

    const sourcesByReference = new Map(processingSources.map((source) => [source.sourceReference, source]));
    const readyAnchors = anchorReferences.filter((anchorReference) => (
      [...(requiredReferencesByAnchor.get(anchorReference) || [])].every((reference) => {
        const requiredTotal = getSourceTotalRows(sourcesByReference.get(reference));
        return requiredTotal > 0
          && Number(processingSourceProgress[reference]?.uploadedRows || 0) >= requiredTotal;
      })
    ));
    const forceReferences = Array.isArray(analysisRequest?.sourceReferences)
      ? analysisRequest.sourceReferences
      : analysisRequest?.sourceReference
        ? [analysisRequest.sourceReference]
        : [];
    const readyForceReferences = forceReferences.filter((reference) => readyAnchors.includes(reference));
    const forceKey = analysisRequest
      ? `${readyForceReferences.slice().sort().join('|')}:${analysisRequest.token}`
      : null;
    const shouldForce = analysisRequest
      && readyForceReferences.length > 0
      && !startedForcedAnalysisKeysRef.current.has(forceKey)
      ? true
      : false;
    const hasIncompleteAnchor = readyAnchors.some((reference) => {
      const total = getSourceTotalRows(sourcesByReference.get(reference));
      return Number(processingSourceProgress[reference]?.analyzedRows || 0) < total;
    });
    if (!shouldForce && !hasIncompleteAnchor) return;

    if (shouldForce) startedForcedAnalysisKeysRef.current.add(forceKey);
    const requestToken = shouldForce ? analysisRequest.token : null;
    analyzeAll({ forceReferences: shouldForce ? readyForceReferences : [] }).then((completed) => {
      if (completed && requestToken) setCompletedAnalysisRequestToken(requestToken);
    });
  }, [
    analysisRequest,
    analyzeAll,
    config,
    processingSourceProgress,
    processingStatus,
    processingSources,
    uploadHook.parsedSources,
  ]);

  useEffect(() => {
    if (processing.phase !== 'done' || processing.status !== 'done') return;
    if (analysisRequest && completedAnalysisRequestToken < analysisRequest.token) return;
    const { anchorReferences } = getMappedSourceReferences(config);
    const refreshKey = `${anchorReferences.slice().sort().join('|')}:${analysisRequest?.token || 0}`;
    if (!refreshKey || completionRefreshRef.current === refreshKey) return;
    completionRefreshRef.current = refreshKey;
    load().then(() => {
      setQueueKey((key) => key + 1);
      setCurrentStep('review');
    });
  }, [
    analysisRequest,
    completedAnalysisRequestToken,
    config,
    load,
    processing.phase,
    processing.status,
  ]);

  const completedSteps = workspace
    ? deriveCompletedSteps(workspace, 'idle', 'idle', ingestedRowsBySource)
    : [];

  const handleProcessingRetry = useCallback(() => {
    if (processing.phase === 'ingest') {
      ingestAll();
      return;
    }
    const pendingRequestToken = analysisRequest
      && completedAnalysisRequestToken < analysisRequest.token
      ? analysisRequest.token
      : null;
    analyzeAll().then((completed) => {
      if (completed && pendingRequestToken) {
        setCompletedAnalysisRequestToken(pendingRequestToken);
      }
    });
  }, [
    analysisRequest,
    analyzeAll,
    completedAnalysisRequestToken,
    ingestAll,
    processing.phase,
  ]);

  function handleCandidateSelect(candidate) {
    setSelectedCandidate(candidate);
    setSheetOpen(true);
  }

  function handleDecisionSaved() {
    setQueueKey(k => k + 1); // refresh queue
    setSheetOpen(false);
  }

  // A per-field edit recomputes issues server-side; refresh the queue in the
  // background but keep the drawer open so the user can keep fixing fields.
  function handleCandidateUpdated(updated) {
    if (updated) setSelectedCandidate(updated);
    setQueueKey(k => k + 1);
  }

  async function handleExportIssues() {
    // Collect all candidates that have blocking issues or failed status
    const problematic = [];
    let pg = 1;
    while (true) {
      const result = await listCandidates(workspaceId, { page: pg });
      const batch = result.candidates ?? [];
      for (const c of batch) {
        if (c.blocking_issues_count > 0 || c.status === 'failed') problematic.push(c);
      }
      if (batch.length < (result.pageSize ?? 50)) break;
      pg++;
    }
    if (problematic.length === 0) return;

    const escape = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = ['entity_type', 'status', 'source_name', 'blocking_issues_count', 'issues'].join(',');
    const rows = problematic.map(c => {
      const name = [c.candidate_data?.first_name, c.candidate_data?.last_name].filter(Boolean).join(' ')
        || c.candidate_data?.service_name
        || c.candidate_data?.name
        || '';
      return [
        escape(c.entity_type),
        escape(c.status),
        escape(name),
        escape(c.blocking_issues_count),
        escape(JSON.stringify(c.issues ?? [])),
      ].join(',');
    });

    const csv = [header, ...rows].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `import-issues-${workspaceId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleDryRunAll() {
    if (isDryRunning) return;
    setIsDryRunning(true);
    setDryRunProgress({ done: 0, total: 0 });
    try {
      // Paginate through all candidates and collect IDs; each page == one dry-run batch (50)
      let page = 1;
      let total = null;
      let done = 0;
      while (true) {
        const result = await listCandidates(workspaceId, { page });
        const candidates = result.candidates ?? [];
        if (total === null) {
          total = result.total ?? candidates.length;
          setDryRunProgress({ done: 0, total });
        }
        if (candidates.length === 0) break;
        const ids = candidates.map(c => c.id);
        await runDryRunChunk(workspaceId, ids);
        done += ids.length;
        setDryRunProgress({ done, total });
        if (candidates.length < result.pageSize) break;
        page++;
      }
      setQueueKey(k => k + 1); // refresh queue to reflect new dry_run_summary values
    } catch {
      // Individual batch errors are surfaced per-candidate by the backend
    } finally {
      setIsDryRunning(false);
      setDryRunProgress({ done: 0, total: 0 });
    }
  }

  if (loading) {
    return (
      <PageLayout title="טוען…">
        <div className="space-y-4">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </PageLayout>
    );
  }

  if (error) {
    return (
      <PageLayout title="שגיאה">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" onClick={load} className="mt-4 gap-2">
          <RefreshCcw className="h-4 w-4" /> נסה שוב
        </Button>
      </PageLayout>
    );
  }

  return (
    <PageLayout
      title={workspace?.name || 'סביבת ייבוא'}
      description={workspace?.description}
      actions={
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate('/import-workspaces')}
          className="gap-2"
        >
          <ArrowRight className="h-4 w-4" />
          כל הסביבות
        </Button>
      }
    >
      {/* Stepper */}
      <Card className="mb-6">
        <CardContent className="pt-5 pb-4">
          <PipelineStepper
            currentStep={currentStep}
            completedSteps={completedSteps}
            onStepClick={setCurrentStep}
          />
        </CardContent>
      </Card>

      {/* Step content */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {{ upload: 'העלאת קובץ', map: 'מיפוי עמודות', process: 'עיבוד', ingest: 'עיבוד', analyze: 'עיבוד', review: 'סקירת מועמדים', commit: 'ביצוע' }[currentStep]}
          </CardTitle>
        </CardHeader>
        <Separator />
        <CardContent className="pt-5">
          {currentStep === 'upload' && (
            <UploadStep
              hook={uploadHook}
              workspace={workspace}
              onCreateNew={() => navigate('/import-workspaces')}
              onDone={async () => {
                await load();
                setCurrentStep('map');
              }}
            />
          )}

          {currentStep === 'map' && workspace && (
            <MapStep
              workspace={workspace}
              onSaved={async () => {
                const refreshed = await load();
                const nextConfig = refreshed?.config || config;
                const { anchorReferences } = getMappedSourceReferences(nextConfig);
                anchorReferences.forEach((reference) => resetAnalysisProgress(reference));
                setAnalysisRequest((previous) => ({
                  token: Number(previous?.token || 0) + 1,
                  sourceReferences: anchorReferences,
                }));
                setCurrentStep('process');
              }}
            />
          )}

          {(currentStep === 'process' || currentStep === 'ingest' || currentStep === 'analyze') && (
            <ProcessStep
              processing={processing}
              uploadHook={uploadHook}
              workspace={workspace}
              sourceReference={sourceRef}
              onSourceChange={handleSourceChange}
              onRetry={handleProcessingRetry}
            />
          )}

          {currentStep === 'review' && (
            <>
              <div className="mb-3 flex items-center gap-3">
                <TooltipProvider delayDuration={150}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-2"
                        onClick={handleDryRunAll}
                        disabled={isDryRunning}
                      >
                        <Zap className="h-4 w-4" />
                        {isDryRunning
                          ? `בודק… ${dryRunProgress.done}/${dryRunProgress.total}`
                          : 'בדיקת ניסיון לכולם'}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-xs leading-relaxed">
                      בדיקה בלי לבצע ייבוא בפועל. כדאי להריץ לפני ביצוע סופי כדי לראות מה ייווצר, מה יעודכן ומה עדיין חסום.
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={handleExportIssues}
                >
                  <Download className="h-4 w-4" />
                  ייצוא בעיות (CSV)
                </Button>
                <Button
                  size="sm"
                  className="gap-2 ms-auto"
                  onClick={() => setCurrentStep('commit')}
                >
                  המשך לביצוע
                </Button>
              </div>
              <CandidateQueue
                key={queueKey}
                workspaceId={workspaceId}
                onCandidateSelect={handleCandidateSelect}
              />
            </>
          )}

          {currentStep === 'commit' && (
            <CommitStep
              workspaceId={workspaceId}
              onBackToReview={() => { setQueueKey(k => k + 1); setCurrentStep('review'); }}
            />
          )}
        </CardContent>
      </Card>

      {/* Candidate detail sheet */}
      <CandidateDetailSheet
        candidate={selectedCandidate}
        workspaceId={workspaceId}
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onDecisionSaved={handleDecisionSaved}
        onCandidateUpdated={handleCandidateUpdated}
      />
    </PageLayout>
  );
}
