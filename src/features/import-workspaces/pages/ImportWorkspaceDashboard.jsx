import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import PageLayout from '@/components/ui/PageLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ArrowRight, UploadCloud, RefreshCcw, Zap, Loader2, CheckCircle2, AlertCircle, Download, Info } from 'lucide-react';

import { getImportWorkspace, patchWorkspaceConfig, listCandidates, runDryRunChunk, commitChunk, getUploadStatus } from '../api/importWorkspacesApi.js';
import { useImportFileUpload } from '../hooks/useImportFileUpload.js';
import { useImportRowIngestion } from '../hooks/useImportRowIngestion.js';
import { useImportAnalysis } from '../hooks/useImportAnalysis.js';
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

function getSourceTotalRows(source) {
  return Number(source?.profile?.rowCount ?? source?.profile?.totalRows ?? 0);
}

function getMappedSourceReferences(config = {}) {
  const anchorReferences = [];
  const participatingReferences = new Set();
  for (const [anchorReference, mapping] of Object.entries(config.mappings?.by_source || {})) {
    const entityMappings = mapping?.entities
      ? Object.values(mapping.entities).filter((entity) => entity?.enabled)
      : [mapping];
    if (!entityMappings.some((entity) => Object.keys(entity?.field_map || {}).length > 0)) continue;
    anchorReferences.push(anchorReference);
    participatingReferences.add(anchorReference);
    entityMappings.forEach((entity) => Object.values(entity?.field_map || {}).forEach((fieldSource) => {
      if (fieldSource?.source_reference) participatingReferences.add(fieldSource.source_reference);
    }));
  }
  return { anchorReferences, participatingReferences };
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
function deriveCompletedSteps(ws, ingestionStatus, analysisStatus) {
  const config   = ws?.config || {};
  const progress = config.operationProgress || {};
  const totalRows = getWorkspaceTotalRows(config);
  const completed = [];

  const sources = getWorkspaceSources(config);
  const hasMappings = Object.values(config.mappings?.by_source || {})
    .some(hasConfiguredMapping)
    || Object.keys(config.mappings?.field_map || {}).length > 0;
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
    return count > 0 && Number(sourceProgress[source.sourceReference]?.uploadedRows || 0) >= count;
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

function deriveCurrentStep(ws, ingestionStatus, analysisStatus) {
  const config   = ws?.config || {};
  const progress = config.operationProgress || {};
  const totalRows = getWorkspaceTotalRows(config);

  if (!config.sourceReference) return 'upload';

  const sources = getWorkspaceSources(config);
  const hasMappings = Object.values(config.mappings?.by_source || {})
    .some(hasConfiguredMapping)
    || Object.keys(config.mappings?.field_map || {}).length > 0;
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
    return count > 0 && Number(sourceProgress[source.sourceReference]?.uploadedRows || 0) >= count;
  });
  const ingestDone  = ingestDoneFromSources || (sources.length === 1 && (
    ingestionStatus === 'done' || (totalRows > 0 && progress.uploadedRows >= totalRows)
  ));
  if (!ingestDone) return 'ingest';

  const analyzeDoneFromSources = analyzedSources.length > 0 && analyzedSources.every((source) => {
    const count = getSourceTotalRows(source);
    return count > 0 && Number(sourceProgress[source.sourceReference]?.analyzedRows || 0) >= count;
  });
  const analyzeDone = analyzeDoneFromSources || (sources.length === 1 && (
    analysisStatus === 'done' || (progress.analyzedRows >= totalRows && totalRows > 0)
  ));
  if (!analyzeDone) return 'analyze';

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
          <p className="text-xs text-muted-foreground">כל גיליון נשמר כמקור נפרד, כדי שאפשר יהיה למפות תלמידים והורים באופן עצמאי.</p>
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
function MapStep({ workspace, selectedSourceReference, onSourceChange, onSaved }) {
  const config      = workspace.config || {};
  const sources     = getWorkspaceSources(config);
  const selectedSource = sources.find((source) => source.sourceReference === selectedSourceReference) || sources[0];
  const sourceReference = selectedSource?.sourceReference;
  const workspaceId = workspace.id;

  const savedSourceMapping = config.mappings?.by_source?.[sourceReference] || {};
  const [saving, setSaving]         = useState(false);
  const [saveError, setSaveError]   = useState(null);

  async function handleSave(entities) {
    setSaving(true);
    setSaveError(null);
    try {
      await patchWorkspaceConfig(workspaceId, {
        activeSourceReference: sourceReference,
        mappings: {
          by_source: {
            [sourceReference]: {
              entities,
            },
          },
        },
      });
      onSaved?.(sourceReference);
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
      {sources.length > 1 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">בחר מקור למיפוי</p>
          <div className="flex flex-wrap gap-2">
            {sources.map((source) => (
              <Button
                key={source.sourceReference}
                type="button"
                variant={source.sourceReference === sourceReference ? 'default' : 'outline'}
                onClick={() => onSourceChange?.(source.sourceReference)}
              >
                {source.label || source.sheetName || source.filename || source.sourceReference}
              </Button>
            ))}
          </div>
        </div>
      )}
      {saveError && <p className="text-xs text-destructive">{saveError}</p>}
      <MappingEditor
        sources={sources}
        anchorSourceReference={sourceReference}
        initialEntities={savedSourceMapping.entities || {}}
        legacyMapping={savedSourceMapping.entity_type ? savedSourceMapping : null}
        onSave={handleSave}
        saving={saving}
      />
    </div>
  );
}

// ── Ingest + Analyze Step ──────────────────────────────────────────────────
function ProcessStep({ ingestion, analysis, uploadHook, workspace, sourceReference, onSourceChange }) {
  const config    = workspace.config || {};
  const sources = getWorkspaceSources(config);
  const selectedSource = sources.find((source) => source.sourceReference === sourceReference) || sources[0];
  const sourceProgress = config.operationProgress?.by_source?.[sourceReference] || {};
  const sourceMapping = config.mappings?.by_source?.[sourceReference] || {};
  const hasSourceMapping = hasConfiguredMapping(sourceMapping)
    || (sources.length === 1 && Object.keys(config.mappings?.field_map || {}).length > 0);
  const enabledEntityMappings = sourceMapping.entities
    ? Object.values(sourceMapping.entities).filter((entity) => entity?.enabled)
    : [sourceMapping];
  const referencedSources = [...new Set([
    sourceReference,
    ...enabledEntityMappings.flatMap((entity) => Object.values(entity?.field_map || {})
      .map((mapping) => mapping?.source_reference)
      .filter(Boolean)),
  ].filter(Boolean))];
  const totalRows = getSourceTotalRows(selectedSource) || uploadHook.profile?.rowCount || uploadHook.profile?.totalRows || uploadHook.parsedRows?.length || 0;
  const hasRows   = !!uploadHook.parsedRows;
  const ingestDone = ingestion.status === 'done' ||
    (sourceProgress.uploadedRows >= totalRows && totalRows > 0) ||
    (sources.length === 1 && config.operationProgress?.uploadedRows >= totalRows && totalRows > 0);
  const analysisDone = analysis.status === 'done' ||
    (sourceProgress.analyzedRows >= totalRows && totalRows > 0) ||
    (sources.length === 1 && config.operationProgress?.analyzedRows >= totalRows && totalRows > 0);
  const joinedSourcesReady = hasSourceMapping && referencedSources.every((reference) => {
    if (reference === sourceReference) return ingestDone;
    const referencedSource = sources.find((source) => source.sourceReference === reference);
    const referencedTotal = getSourceTotalRows(referencedSource);
    return referencedTotal > 0
      && Number(config.operationProgress?.by_source?.[reference]?.uploadedRows || 0) >= referencedTotal;
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        בשלב הזה שומרים את השורות שנקראו מהקובץ, ואז בודקים אותן מול כללי המערכת: שדות חובה, כפילויות וקשרים בין תלמידים, הורים והערות.
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
      {/* Warn if parsedRows lost but ingestion not done */}
      {!hasRows && !ingestDone && (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-900/20 px-4 py-3 text-sm text-yellow-800 dark:text-yellow-300">
          השורות המנותחות לא קיימות בזיכרון. חזור לשלב בחירת הקובץ ובצע ניתוח מקומי שוב כדי להמשיך בקליטה. אין צורך שהעלאת הגיבוי לשרת תצליח.
        </div>
      )}
      <ProgressOrchestrator
        ingestion={hasRows || ingestDone ? ingestion : { ...ingestion, status: 'idle' }}
        analysis={analysisDone ? {
          ...analysis,
          status: 'done',
          analyzedRows: totalRows,
          totalRows,
          progress: 1,
        } : analysis}
        ingestDoneFromConfig={ingestDone}
        analysisPrerequisitesDone={joinedSourcesReady}
      />
      {!joinedSourcesReady && referencedSources.length > 1 && (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          לפני בדיקת הנתונים צריך לשמור גם את השורות מהמקורות הנוספים שמשתתפים במיפוי.
        </p>
      )}
      {!hasSourceMapping && (
        <p className="text-xs text-muted-foreground">
          המקור הזה משמש להשלמת פרטים במיפוי אחר. צריך לשמור את השורות שלו, אבל אין צורך למפות או לנתח אותו בנפרד.
        </p>
      )}
      {totalRows > 0 && (
        <p className="text-xs text-muted-foreground">
          סה"כ שורות: {totalRows.toLocaleString()}
        </p>
      )}
    </div>
  );
}

// Collect all candidates of a given status by paginating through listCandidates.
async function fetchAllCandidates(workspaceId, status, sourceReference) {
  const candidates = [];
  let page = 1;
  while (true) {
    const result = await listCandidates(workspaceId, { status, sourceReference, page });
    const batch = result.candidates ?? [];
    candidates.push(...batch);
    if (batch.length < (result.pageSize ?? 50)) break;
    page++;
  }
  return candidates;
}

// Topological commit waves: each wave depends on the previous one completing first.
const COMMIT_WAVES = [
  { label: 'לקוחות ותלמידים', types: ['customer', 'active_student', 'inactive_student'] },
  { label: 'הורים ושירותים',  types: ['guardian', 'service'] },
  { label: 'קישורי הורים',    types: ['guardian_link'] },
  { label: 'הערות',           types: ['student_note'] },
];

// ── Commit Step ────────────────────────────────────────────────────────────
function CommitStep({ workspaceId, sourceReference }) {
  const [phase, setPhase]       = useState('idle'); // 'idle' | 'running' | 'done' | 'partial' | 'error'
  const [progress, setProgress] = useState({ done: 0, total: 0, waveLabel: '' });
  const [summary, setSummary]   = useState({ committed: 0, failed: 0 });
  const [errorMsg, setErrorMsg] = useState('');

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
          totalCommitted += result.committed ?? chunk.length;
          totalFailed    += result.failed    ?? 0;
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
        <div className="flex gap-2 justify-center">
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
    <div className="py-8 text-center space-y-4">
      <p className="text-sm text-muted-foreground">
        לחץ על &ldquo;בצע ייבוא&rdquo; כדי להעביר את כל המועמדים המאושרים לטבלאות הפעילות.
        <br />
        שורות שנכשלות לא מונעות את השאר — ניתן לתקן ולנסות שנית.
      </p>
      <Button onClick={() => runCommit('full')} className="gap-2">
        <UploadCloud className="h-4 w-4" />
        בצע ייבוא
      </Button>
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
  const completionRefreshRef = useRef('');

  const config        = workspace?.config || {};

  // Phase 2: file upload
  const uploadHook = useImportFileUpload(workspaceId, getWorkspaceSources(config));

  // Phase 3: ingestion — parsedRows from upload hook
  const sources       = getWorkspaceSources(config);
  const sourceRef     = selectedSourceReference || config.activeSourceReference || uploadHook.sourceReference || config.sourceReference || null;
  const selectedSource = sources.find((source) => source.sourceReference === sourceRef);
  const parsedSource = uploadHook.parsedSources?.find((source) => source.sourceReference === sourceRef);
  const sourceRows = parsedSource?.rows || (uploadHook.sourceReference === sourceRef ? uploadHook.parsedRows : null);
  const totalRows     = getSourceTotalRows(selectedSource) || parsedSource?.rows?.length || uploadHook.profile?.rowCount || uploadHook.profile?.totalRows || sourceRows?.length || 0;
  const ingestionHook = useImportRowIngestion(workspaceId, sourceRef, sourceRows);
  const analysisHook  = useImportAnalysis(workspaceId, sourceRef, totalRows);

  const load = useCallback(async () => {
    if (!workspaceId) return null;
    setLoading(true);
    setError(null);
    try {
      const ws = await getImportWorkspace(workspaceId);
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
    const derived = deriveCurrentStep(workspace, ingestionHook.status, analysisHook.status);
    setCurrentStep(derived);
  // Only run on workspace load, not on every hook status change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace]);

  const handleSourceChange = useCallback(async (nextSourceReference) => {
    await load();
    setSelectedSourceReference(nextSourceReference);
    uploadHook.selectParsedSource(nextSourceReference);
    ingestionHook.reset();
    analysisHook.reset();
  }, [analysisHook, ingestionHook, load, uploadHook]);

  useEffect(() => {
    if (analysisHook.status !== 'done' || !sourceRef) return;
    const refreshKey = `${sourceRef}:done`;
    if (completionRefreshRef.current === refreshKey) return;
    completionRefreshRef.current = refreshKey;
    load();
  }, [analysisHook.status, load, sourceRef]);

  const completedSteps = workspace
    ? deriveCompletedSteps(workspace, ingestionHook.status, analysisHook.status)
    : [];

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
      const result = await listCandidates(workspaceId, { sourceReference: sourceRef || undefined, page: pg });
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
        const result = await listCandidates(workspaceId, { sourceReference: sourceRef || undefined, page });
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
            {{ upload: 'העלאת קובץ', map: 'מיפוי עמודות', ingest: 'קליטה וניתוח', analyze: 'קליטה וניתוח', review: 'סקירת מועמדים', commit: 'ביצוע' }[currentStep]}
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
              selectedSourceReference={sourceRef}
              onSourceChange={handleSourceChange}
              onSaved={async (savedSourceReference) => {
                await handleSourceChange(savedSourceReference);
                setCurrentStep('ingest');
              }}
            />
          )}

          {(currentStep === 'ingest' || currentStep === 'analyze') && (
            <ProcessStep
              ingestion={ingestionHook}
              analysis={analysisHook}
              uploadHook={uploadHook}
              workspace={workspace}
              sourceReference={sourceRef}
              onSourceChange={handleSourceChange}
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
                sourceReference={sourceRef}
                onCandidateSelect={handleCandidateSelect}
              />
            </>
          )}

          {currentStep === 'commit' && <CommitStep workspaceId={workspaceId} sourceReference={sourceRef} />}
        </CardContent>
      </Card>

      {/* Advance to next step when process completes */}
      {(currentStep === 'ingest' || currentStep === 'analyze') && analysisHook.status === 'done' && (
        <div className="mt-4 flex justify-end">
          <Button onClick={() => setCurrentStep('review')}>
            עבור לסקירה
          </Button>
        </div>
      )}

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
