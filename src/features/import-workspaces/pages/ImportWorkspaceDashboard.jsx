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
  const progress = config?.operationProgress || {};
  return Number(
    config?.profile?.rowCount ??
    config?.profile?.totalRows ??
    progress.totalRows ??
    progress.uploadedRows ??
    0
  );
}

// ── Step derivation ────────────────────────────────────────────────────────
function deriveCompletedSteps(ws, ingestionStatus, analysisStatus) {
  const config   = ws?.config || {};
  const progress = config.operationProgress || {};
  const totalRows = getWorkspaceTotalRows(config);
  const completed = [];

  const hasMappings = config.mappings?.field_map &&
    Object.keys(config.mappings.field_map).length > 0;
  const ingestDone   = ingestionStatus === 'done' || (totalRows > 0 && progress.uploadedRows >= totalRows);
  const analyzeDone  = analysisStatus === 'done'  || (progress.analyzedRows >= totalRows && totalRows > 0);

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

  const hasMappings = config.mappings?.field_map &&
    Object.keys(config.mappings.field_map).length > 0;
  if (!hasMappings) return 'map';

  const ingestDone  = ingestionStatus === 'done' || (totalRows > 0 && progress.uploadedRows >= totalRows);
  if (!ingestDone) return 'ingest';

  const analyzeDone = analysisStatus === 'done' || (progress.analyzedRows >= totalRows && totalRows > 0);
  if (!analyzeDone) return 'analyze';

  return 'review';
}

// ── Upload Step ────────────────────────────────────────────────────────────
function UploadStep({ hook, workspace, onDone, onCreateNew }) {
  const { fileState, uploadState, parseState, parsedRows, selectFile, upload, parse } = hook;

  const fileInputRef = useRef(null);
  const [backupStatus, setBackupStatus] = useState({ status: 'idle', data: null, error: null });
  const config = workspace?.config || {};
  const existingFileName = config.fileName || config.sourceReference || '';
  const hasServerBackup = Boolean(config.objectKey);
  const hasParsedProfile = Boolean(config.sourceReference && (config.profile?.headers?.length || config.headers?.length));
  const hasCurrentFile = Boolean(fileState.file);

  const isUploaded  = uploadState.status === 'done' || hasServerBackup;
  const isParsed    = (parseState.status === 'done' && parsedRows !== null) || hasParsedProfile;
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
      {!shouldShowExistingParsedFile && (
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
          {fileState.file ? fileState.file.name : existingFileName || 'בחר קובץ'}
        </Button>

        {fileState.file && !isUploaded && (
          <Button onClick={upload} disabled={isUploading} className="gap-2">
            {isUploading ? 'מעלה…' : 'העלה לשרת'}
          </Button>
        )}

        {fileState.file && !isParsed && (
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
  const headers     = config.profile?.headers || config.headers || [];
  const sampleRow   = config.profile?.sampleRow || {};
  const workspaceId = workspace.id;

  const [entityType, setEntityType] = useState(config.entityType || 'active_student');
  const [saving, setSaving]         = useState(false);
  const [saveError, setSaveError]   = useState(null);

  async function handleSave(fieldMap) {
    setSaving(true);
    setSaveError(null);
    try {
      await patchWorkspaceConfig(workspaceId, {
        entityType,
        mappings: { field_map: fieldMap },
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
        בחר איזו עמודה בקובץ מתאימה לכל שדה במערכת. אפשר להשתמש באותה עמודה בכמה סוגי רשומות, למשל תעודת זהות לקישור בין תלמיד, הורה והערה.
      </p>
      {saveError && <p className="text-xs text-destructive">{saveError}</p>}
      <MappingEditor
        sourceColumns={headers}
        sampleRow={sampleRow}
        entityType={entityType}
        initialFieldMap={config.mappings?.field_map || {}}
        onEntityTypeChange={setEntityType}
        onSave={handleSave}
        saving={saving}
      />
    </div>
  );
}

// ── Ingest + Analyze Step ──────────────────────────────────────────────────
function ProcessStep({ ingestion, analysis, uploadHook, workspace }) {
  const config    = workspace.config || {};
  const totalRows = getWorkspaceTotalRows(config) || uploadHook.profile?.rowCount || uploadHook.profile?.totalRows || uploadHook.parsedRows?.length || 0;
  const hasRows   = !!uploadHook.parsedRows;
  const ingestDone = ingestion.status === 'done' ||
    (config.operationProgress?.uploadedRows >= totalRows && totalRows > 0);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        בשלב הזה שומרים את השורות שנקראו מהקובץ, ואז בודקים אותן מול כללי המערכת: שדות חובה, כפילויות וקשרים בין תלמידים, הורים והערות.
      </p>
      {/* Warn if parsedRows lost but ingestion not done */}
      {!hasRows && !ingestDone && (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-900/20 px-4 py-3 text-sm text-yellow-800 dark:text-yellow-300">
          השורות המנותחות לא קיימות בזיכרון. חזור לשלב בחירת הקובץ ובצע ניתוח מקומי שוב כדי להמשיך בקליטה. אין צורך שהעלאת הגיבוי לשרת תצליח.
        </div>
      )}
      <ProgressOrchestrator
        ingestion={hasRows || ingestDone ? ingestion : { ...ingestion, status: 'idle' }}
        analysis={analysis}
        ingestDoneFromConfig={ingestDone}
      />
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
  { label: 'תלמידים',         types: ['active_student', 'inactive_student'] },
  { label: 'הורים ושירותים', types: ['guardian', 'service'] },
  { label: 'קישורי הורים',   types: ['guardian_link'] },
  { label: 'הערות',          types: ['student_note'] },
];

// ── Commit Step ────────────────────────────────────────────────────────────
function CommitStep({ workspaceId, sourceReference }) {
  const [phase, setPhase]       = useState('idle'); // 'idle' | 'running' | 'done' | 'error'
  const [progress, setProgress] = useState({ done: 0, total: 0, waveLabel: '' });
  const [errorMsg, setErrorMsg] = useState('');

  async function handleCommit() {
    if (phase === 'running') return;
    setPhase('running');
    setErrorMsg('');
    setProgress({ done: 0, total: 0, waveLabel: '' });

    try {
      // Collect all ready + skipped candidates
      const readyCandidates  = await fetchAllCandidates(workspaceId, 'ready', sourceReference);
      const skippedCandidates = await fetchAllCandidates(workspaceId, 'skipped', sourceReference);
      const all = [...readyCandidates, ...skippedCandidates];

      if (all.length === 0) {
        setPhase('done');
        return;
      }

      // Group by entity_type
      const grouped = {};
      for (const c of all) {
        if (!grouped[c.entity_type]) grouped[c.entity_type] = [];
        grouped[c.entity_type].push(c.id);
      }

      const total = all.length;
      setProgress({ done: 0, total, waveLabel: '' });
      let done = 0;

      for (const wave of COMMIT_WAVES) {
        const idsInWave = wave.types.flatMap(t => grouped[t] ?? []);
        if (idsInWave.length === 0) continue;
        setProgress({ done, total, waveLabel: wave.label });
        for (let i = 0; i < idsInWave.length; i += 50) {
          const chunk = idsInWave.slice(i, i + 50);
          await commitChunk(workspaceId, chunk);
          done += chunk.length;
          setProgress({ done, total, waveLabel: wave.label });
        }
      }

      setPhase('done');
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
        <p className="text-xs text-muted-foreground">כל הרשומות הועברו לטבלאות הפעילות.</p>
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
        הפעולה אטומית — או שהכל יתבצע, או שלא יתבצע כלום.
      </p>
      <Button onClick={handleCommit} className="gap-2">
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

  const config        = workspace?.config || {};

  // Phase 2: file upload
  const uploadHook = useImportFileUpload(workspaceId, workspace?.config?.sourceReference ?? null);

  // Phase 3: ingestion — parsedRows from upload hook
  const sourceRef     = config.sourceReference ?? uploadHook.sourceReference ?? null;
  const totalRows     = getWorkspaceTotalRows(config) || uploadHook.profile?.rowCount || uploadHook.profile?.totalRows || uploadHook.parsedRows?.length || 0;
  const ingestionHook = useImportRowIngestion(workspaceId, sourceRef, uploadHook.parsedRows);
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
    const derived = deriveCurrentStep(workspace, ingestionHook.status, analysisHook.status);
    setCurrentStep(derived);
  // Only run on workspace load, not on every hook status change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace]);

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
        || c.candidate_data?.name || '';
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
              onSaved={() => {
                load(); // refresh workspace to pick up saved mappings
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
      />
    </PageLayout>
  );
}
