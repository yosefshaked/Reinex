import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge.jsx';
import { Loader2, AlertTriangle } from 'lucide-react';
import { useOrg } from '@/org/OrgContext';
import { authenticatedFetch } from '@/lib/api-client.js';
import { getNextWeekRangeDateStrings, getTodayLocalDateString } from '../utils/localDate.js';
import {
  buildGenerationReview,
  clearGenerationReview,
  getActionableGenerationIssues,
  getRetryableGenerationFailures,
  readGenerationReview,
  writeGenerationReview,
} from '../utils/generationReviewStorage.js';

function buildRequestKey({ orgId, startDate, endDate, requestMode, retryItems }) {
  return JSON.stringify({
    orgId: orgId || '',
    startDate: startDate || '',
    endDate: endDate || '',
    requestMode: requestMode || 'full_range',
    retryItems: Array.isArray(retryItems)
      ? retryItems
        .map((entry) => ({
          template_id: entry?.template_id || '',
          target_date: entry?.target_date || '',
        }))
        .sort((left, right) => `${left.template_id}|${left.target_date}`.localeCompare(`${right.template_id}|${right.target_date}`))
      : [],
  });
}

function formatIssueWhen(issue) {
  const date = issue?.target_date || '';
  const time = issue?.time_of_day ? String(issue.time_of_day).slice(0, 5) : '';

  if (date && time) {
    return `${formatHebrewDate(date)} ${time}`;
  }
  if (issue?.datetime_start) {
    const raw = String(issue.datetime_start);
    const datePart = raw.slice(0, 10);
    const timePart = raw.slice(11, 16);
    return [formatHebrewDate(datePart), timePart].filter(Boolean).join(' ');
  }
  return formatHebrewDate(date);
}

function getIssueSourceLabel(issue) {
  if (issue?.source === 'hmo_warning') return 'אזהרת גורם מממן';
  return issue?.source === 'apply_error' ? 'נכשל בהחלה' : 'נחסם בתצוגה מקדימה';
}

function formatHebrewDate(value) {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('he-IL', {
      day: 'numeric',
      month: 'numeric',
      year: 'numeric',
    }).format(new Date(`${value}T12:00:00`));
  } catch {
    return value;
  }
}

function getIssueTypeLabel(type) {
  switch (type) {
    case 'instructor_overlap':
      return 'חפיפה למדריך/ה';
    case 'student_overlap':
      return 'חפיפה לתלמיד/ה';
    case 'capacity_exceeded':
      return 'חריגה מקיבולת';
    case 'invalid_template_data':
      return 'נתוני תבנית לא תקינים';
    case 'missing_client_profile_link':
      return 'חסר קישור לכרטיס לקוח';
    case 'invalid_datetime':
      return 'תאריך או שעה לא תקינים';
    case 'instance_insert_failed':
      return 'יצירת שיעור נכשלה';
    case 'participant_insert_failed':
      return 'הוספת משתתף נכשלה';
    case 'hmo_authorization_gap':
      return 'פער בכיסוי גורם מממן';
    case 'generation_conflict':
      return 'בעיה ביצירת שיעור';
    default:
      return 'בעיה ביצירת שיעור';
  }
}

function getIssueLabel(issue) {
  const issueTypes = Array.isArray(issue?.issue_types) && issue.issue_types.length > 0
    ? issue.issue_types
    : [issue?.issue_type].filter(Boolean);
  return issueTypes.map(getIssueTypeLabel).filter(Boolean).join(', ') || getIssueTypeLabel(issue?.issue_type);
}

function getRepairTargetLabel(target) {
  switch (target?.type) {
    case 'student_profile':
      if (target?.label === 'student_finance') return 'לכרטיס פיננסי';
      return 'לכרטיס תלמיד';
    case 'template_edit':
      return 'לעריכת תבנית';
    default:
      return 'לטיפול';
  }
}

function buildIssueDisplayMessage(issue) {
  const raw = String(issue?.message || '').trim();
  if (!raw || raw === 'generation_issue') {
    return getIssueLabel(issue);
  }
  if (/^[a-z0-9_:-]+$/i.test(raw)) {
    return getIssueTypeLabel(raw);
  }
  return raw
    .replaceAll('client_profile_id', 'קישור לכרטיס לקוח')
    .replaceAll('student_profile', 'כרטיס תלמיד')
    .replaceAll('template_edit', 'עריכת תבנית');
}

export function ManualGenerationDialog({ open, onClose, onApplied, onReviewStateChange }) {
  const navigate = useNavigate();
  const { activeOrgId } = useOrg();
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [result, setResult] = useState(null);
  const [savedReview, setSavedReview] = useState(null);
  const [error, setError] = useState('');
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isApplyLoading, setIsApplyLoading] = useState(false);
  const [activeMode, setActiveMode] = useState('full_range');
  const [lastPreviewRequestKey, setLastPreviewRequestKey] = useState('');

  useEffect(() => {
    if (!open) return;

    const persistedReview = activeOrgId ? readGenerationReview(activeOrgId) : null;
    const week = getNextWeekRangeDateStrings(getTodayLocalDateString());

    setSavedReview(persistedReview);
    setStartDate(week.start);
    setEndDate(week.end);
    setResult(null);
    setError('');
    setIsPreviewLoading(false);
    setIsApplyLoading(false);
    setLastPreviewRequestKey('');
    setActiveMode(persistedReview?.retryableFailures?.length > 0 ? 'retry_failed' : 'full_range');
  }, [open, activeOrgId]);

  const retryItems = useMemo(() => (
    Array.isArray(savedReview?.retryableFailures)
      ? savedReview.retryableFailures.map((entry) => entry.retry_item).filter((entry) => entry?.template_id && entry?.target_date)
      : []
  ), [savedReview]);

  const fullRequestKey = useMemo(() => buildRequestKey({
    orgId: activeOrgId,
    startDate,
    endDate,
    requestMode: 'full_range',
    retryItems: [],
  }), [activeOrgId, startDate, endDate]);

  const retryRequestKey = useMemo(() => buildRequestKey({
    orgId: activeOrgId,
    startDate: savedReview?.scope?.startDate || startDate,
    endDate: savedReview?.scope?.endDate || endDate,
    requestMode: 'retry_failed',
    retryItems,
  }), [activeOrgId, savedReview?.scope?.startDate, savedReview?.scope?.endDate, startDate, endDate, retryItems]);

  const activeRequestKey = activeMode === 'retry_failed' ? retryRequestKey : fullRequestKey;
  const canRunFullRange = Boolean(activeOrgId && startDate && endDate && startDate <= endDate);
  const canRunRetry = Boolean(activeOrgId && retryItems.length > 0);
  const canPreview = activeMode === 'retry_failed' ? canRunRetry : canRunFullRange;
  const currentIssues = useMemo(() => getActionableGenerationIssues(result), [result]);
  const currentRetryableFailures = useMemo(() => getRetryableGenerationFailures(result), [result]);
  const visibleIssues = currentIssues.length > 0 ? currentIssues : (savedReview?.issues || []);
  const visibleRetryableFailures = currentRetryableFailures.length > 0 ? currentRetryableFailures : (savedReview?.retryableFailures || []);
  const generationWarnings = useMemo(() => (
    Array.isArray(result?.warnings) ? result.warnings : []
  ), [result]);
  const warningReasonCounts = useMemo(() => {
    const counts = new Map();
    for (const warning of generationWarnings) {
      const reason = String(warning?.reason || 'other');
      counts.set(reason, (counts.get(reason) || 0) + 1);
    }
    return Array.from(counts.entries()).map(([reason, count]) => ({ reason, count }));
  }, [generationWarnings]);
  const canApply = Boolean(
    canPreview
    && lastPreviewRequestKey === activeRequestKey
    && (activeMode === 'retry_failed'
      ? (savedReview?.scope?.startDate || startDate)
      : startDate)
    && (result?.dry_run === true)
    && ((result?.summary?.to_insert_instances ?? 0) > 0),
  );

  function switchMode(nextMode) {
    setActiveMode(nextMode);
    setResult(null);
    setError('');
    setLastPreviewRequestKey('');
  }

  function getWarningReasonLabel(reason) {
    switch (reason) {
      case 'no_authorization_found':
        return 'אין הרשאת גורם מממן לשירות';
      case 'no_active_authorization':
        return 'קיימת הרשאה אך אינה פעילה';
      case 'no_active_authorization_for_date':
        return 'הרשאה פעילה אך טווח תאריכים לא מכסה את המועד';
      case 'authorization_conflict':
        return 'קיימות הרשאות חופפות';
      case 'authorization_exhausted':
        return 'מכסת ההרשאה נוצלה';
      case 'missing_authorization_pricing':
        return 'חסרים מחירי כיסוי באישור';
      case 'missing_post_coverage_policy':
        return 'חסרה מדיניות המשך לאחר מיצוי';
      default:
        return 'פער הרשאה לא מסווג';
    }
  }

  function updateSavedReview(nextReview) {
    setSavedReview(nextReview);
    onReviewStateChange?.(nextReview);
  }

  function persistIssuesReview(nextResult, source, requestMode) {
    if (!activeOrgId) {
      return;
    }

    const nextReview = buildGenerationReview({
      orgId: activeOrgId,
      startDate: requestMode === 'retry_failed' ? (savedReview?.scope?.startDate || startDate) : startDate,
      endDate: requestMode === 'retry_failed' ? (savedReview?.scope?.endDate || endDate) : endDate,
      requestMode,
      result: nextResult,
      source,
    });

    if (nextReview.issues.length === 0 && nextReview.retryableFailures.length === 0) {
      return;
    }

    writeGenerationReview(activeOrgId, nextReview);
    updateSavedReview(nextReview);
  }

  function clearPersistedReview() {
    if (!activeOrgId) {
      return;
    }
    clearGenerationReview(activeOrgId);
    updateSavedReview(null);
  }

  async function runGeneration(dryRun, requestMode) {
    if (!activeOrgId) {
      setError('ארגון פעיל לא נמצא.');
      return null;
    }

    const payload = {
      org_id: activeOrgId,
      start_date: requestMode === 'retry_failed' ? (savedReview?.scope?.startDate || startDate) : startDate,
      end_date: requestMode === 'retry_failed' ? (savedReview?.scope?.endDate || endDate) : endDate,
      dry_run: dryRun,
    };

    if (requestMode === 'retry_failed') {
      payload.retry_items = retryItems;
    }

    return authenticatedFetch('calendar/generate', {
      method: 'POST',
      body: payload,
    });
  }

  async function handlePreview(requestMode = activeMode) {
    if (requestMode === 'retry_failed' ? !canRunRetry : !canRunFullRange) {
      return;
    }

    setIsPreviewLoading(true);
    setError('');

    try {
      const payload = await runGeneration(true, requestMode);
      setResult(payload || null);
      setLastPreviewRequestKey(requestMode === 'retry_failed' ? retryRequestKey : fullRequestKey);

      if (getActionableGenerationIssues(payload).length > 0) {
        persistIssuesReview(payload, 'preview', requestMode);
      }
    } catch (err) {
      setError(err?.message || 'הרצת תצוגה מקדימה נכשלה.');
      setResult(null);
      setLastPreviewRequestKey('');
    } finally {
      setIsPreviewLoading(false);
    }
  }

  async function handleApply(requestMode = activeMode) {
    if (!canApply) {
      return;
    }

    setIsApplyLoading(true);
    setError('');

    try {
      const payload = await runGeneration(false, requestMode);
      const issues = getActionableGenerationIssues(payload);
      setResult(payload || null);

      if (issues.length > 0) {
        console.error('Calendar generation actionable issues', issues);
        setError(`היצירה הושלמה חלקית. יש ${issues.length} פריטים שדורשים טיפול.`);
        persistIssuesReview(payload, 'apply', requestMode);
      } else if (requestMode === 'retry_failed' || requestMode === 'full_range') {
        clearPersistedReview();
      }

      onApplied?.(payload || null);
      if (issues.length === 0) {
        onClose?.();
      }
      setLastPreviewRequestKey('');
    } catch (err) {
      setError(err?.message || 'החלת היצירה נכשלה.');
    } finally {
      setIsApplyLoading(false);
    }
  }

  function handleDismissSavedReview() {
    clearPersistedReview();
    if (activeMode === 'retry_failed') {
      setActiveMode('full_range');
    }
  }

  function handleJumpTo(path) {
    if (!path) {
      return;
    }

    onClose?.();
    navigate(path);
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>יצירה ידנית מתבניות</DialogTitle>
          <DialogDescription>
            כל החלה מחייבת תצוגה מקדימה עדכנית. אפשר לעבוד בטווח מלא או לחזור רק לכשלים שנשמרו לטיפול.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {savedReview && (
            <Alert className="border-slate-300 bg-slate-50 text-slate-950">
              <AlertTriangle className="h-4 w-4 text-slate-700" />
              <AlertTitle className="flex items-center gap-2">
                רשימת טיפול שמורה
                <Badge variant="outline">{visibleIssues.length} בעיות</Badge>
                {visibleRetryableFailures.length > 0 ? <Badge variant="secondary">כשלים ניתנים לניסיון חוזר: {visibleRetryableFailures.length}</Badge> : null}
              </AlertTitle>
              <AlertDescription className="space-y-3">
                <div className="text-sm text-slate-700">
                  {savedReview.savedAt ? `נשמר ב-${savedReview.savedAt.replace('T', ' ').slice(0, 16)}.` : 'נשמרה סקירה קודמת.'}
                  {' '}אפשר לצאת לתקן, לחזור ללוח, ולפתוח מחדש את אותה הסקירה בלי לאבד את הרשימה.
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant={activeMode === 'full_range' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => switchMode('full_range')}
                  >
                    טווח מלא
                  </Button>
                  <Button
                    type="button"
                    variant={activeMode === 'retry_failed' ? 'default' : 'outline'}
                    size="sm"
                    disabled={visibleRetryableFailures.length === 0}
                    onClick={() => switchMode('retry_failed')}
                  >
                    פריטים לטיפול בלבד
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={handleDismissSavedReview}>
                    נקה רשימת טיפול
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="generation-start-date">מתאריך</Label>
              <Input
                id="generation-start-date"
                type="date"
                value={activeMode === 'retry_failed' ? (savedReview?.scope?.startDate || startDate) : startDate}
                onChange={(e) => setStartDate(e.target.value)}
                disabled={activeMode === 'retry_failed'}
              />
            </div>
            <div>
              <Label htmlFor="generation-end-date">עד תאריך</Label>
              <Input
                id="generation-end-date"
                type="date"
                value={activeMode === 'retry_failed' ? (savedReview?.scope?.endDate || endDate) : endDate}
                onChange={(e) => setEndDate(e.target.value)}
                disabled={activeMode === 'retry_failed'}
              />
            </div>
          </div>

          {activeMode === 'retry_failed' && (
            <Alert className="border-blue-200 bg-blue-50 text-blue-950">
              <AlertTriangle className="h-4 w-4 text-blue-700" />
              <AlertDescription>
                מצב ניסיון חוזר פועל על {visibleRetryableFailures.length} פריטים שנשמרו מהסקירה, ולא מריץ מחדש את כל הטווח.
              </AlertDescription>
            </Alert>
          )}

          {activeMode === 'full_range' && savedReview && (
            <Alert className="border-slate-200 bg-slate-50 text-slate-900">
              <AlertTriangle className="h-4 w-4 text-slate-600" />
              <AlertDescription>
                מצב טווח מלא יריץ שוב את כל התבניות בטווח הנבחר. כדי להפעיל יצירה צריך קודם להריץ תצוגה מקדימה חדשה לטווח הזה.
              </AlertDescription>
            </Alert>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {result && (
            <div className="space-y-3 rounded-md border bg-gray-50/70 p-3">
              <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-5">
                <div className="rounded border bg-white p-2">תבניות: <span className="font-medium">{result.summary?.templates_considered ?? 0}</span></div>
                <div className="rounded border bg-white p-2">מועמדים: <span className="font-medium">{result.summary?.candidate_slots ?? 0}</span></div>
                <div className="rounded border bg-white p-2">להוספה: <span className="font-medium">{result.summary?.to_insert_instances ?? 0}</span></div>
                <div className="rounded border bg-white p-2">קונפליקטים: <span className="font-medium">{result.summary?.conflicts ?? 0}</span></div>
                <div className="rounded border bg-white p-2">שגיאות החלה: <span className="font-medium">{result.summary?.apply_errors ?? 0}</span></div>
              </div>

              {(result.summary?.hmo_coverage_warnings ?? 0) > 0 && (
                <Alert className="border-amber-300 bg-amber-50 text-amber-950">
                  <AlertTriangle className="h-4 w-4 text-amber-700" />
                  <AlertDescription className="space-y-2">
                    <div>
                      זוהו <span className="font-semibold">{result.summary?.hmo_coverage_warnings ?? 0}</span> אזהרות כיסוי גורם מממן.
                    </div>
                    {warningReasonCounts.length > 0 && (
                      <div className="flex flex-wrap gap-2 text-xs text-amber-900">
                        {warningReasonCounts.map((item) => (
                          <span key={item.reason} className="rounded border border-amber-300 bg-white px-2 py-0.5">
                            {getWarningReasonLabel(item.reason)}: {item.count}
                          </span>
                        ))}
                      </div>
                    )}
                  </AlertDescription>
                </Alert>
              )}

              {result.warnings_notice === 'hmo_authorization_schema_missing' && (
                <Alert className="border-slate-300 bg-slate-50 text-slate-900">
                  <AlertTriangle className="h-4 w-4 text-slate-700" />
                  <AlertDescription>
                    לא ניתן להציג אזהרות כיסוי גורם מממן כי טבלאות ההרשאות אינן זמינות בסביבה זו.
                  </AlertDescription>
                </Alert>
              )}

              {generationWarnings.length > 0 && (
                <div>
                  <p className="mb-1 text-sm font-medium">אזהרות כיסוי גורם מממן</p>
                  <div className="max-h-56 space-y-2 overflow-y-auto">
                    {generationWarnings.slice(0, 30).map((warning, index) => (
                      <div key={`${warning.student_id || 'student'}-${warning.service_id || 'service'}-${warning.target_date || index}`} className="rounded border bg-white p-3 text-xs">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={warning.severity === 'error' ? 'destructive' : 'secondary'}>
                            {getWarningReasonLabel(warning.reason)}
                          </Badge>
                          <span className="font-medium text-slate-900">{warning.student_name || 'ללא שם תלמיד'}</span>
                          <span className="text-slate-500">{formatHebrewDate(warning.target_date)}</span>
                          {warning.time_of_day ? <span className="text-slate-500">{String(warning.time_of_day).slice(0, 5)}</span> : null}
                        </div>
                        <div className="mt-1 text-slate-700">
                          שירות: <span className="font-medium">{warning.service_name || 'לא זוהה שירות'}</span>
                        </div>
                        <div className="mt-1 text-slate-700">{warning.message}</div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={!warning.student_id}
                            onClick={() => handleJumpTo(warning.student_id ? `/students/${warning.student_id}/financial` : '')}
                          >
                            לכרטיס פיננסי
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={!warning.template_id}
                            onClick={() => handleJumpTo(warning.template_id ? `/calendar/templates?edit_template_id=${warning.template_id}` : '')}
                          >
                            לתבנית
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {visibleIssues.length > 0 && (
            <div className="space-y-2 rounded-md border border-slate-200 p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">רשימת פריטים לטיפול</p>
                  <p className="text-xs text-slate-600">הרשימה נשמרת בסשן עד ניקוי מפורש או עד ניסיון חוזר שמצליח.</p>
                </div>
                <Badge variant="outline">{visibleIssues.length}</Badge>
              </div>

              <div className="max-h-72 space-y-2 overflow-y-auto">
                {visibleIssues.map((issue, index) => {
                  const studentTarget = Array.isArray(issue.repair_targets)
                    ? issue.repair_targets.find((target) => target.type === 'student_profile')
                    : null;
                  const templateTarget = Array.isArray(issue.repair_targets)
                    ? issue.repair_targets.find((target) => target.type === 'template_edit')
                    : null;

                  return (
                    <div key={`${issue.source || 'issue'}-${issue.template_id || 'template'}-${issue.target_date || issue.datetime_start || index}`} className="rounded border bg-white p-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={issue.source === 'apply_error' ? 'destructive' : 'secondary'}>
                          {getIssueSourceLabel(issue)}
                        </Badge>
                        <span className="font-medium">{issue.student_name || 'ללא שם תלמיד'}</span>
                        <span className="text-xs text-slate-500">{formatIssueWhen(issue)}</span>
                      </div>
                      <div className="mt-2 text-sm text-slate-800">{buildIssueDisplayMessage(issue)}</div>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-600">
                        {issue.service_name ? <span>שירות: {issue.service_name}</span> : null}
                        <span>סוג: {getIssueLabel(issue)}</span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {[studentTarget, templateTarget].filter(Boolean).map((target) => (
                          <Button
                            key={`${target.type}-${target.path}`}
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={!target?.path}
                            onClick={() => handleJumpTo(target?.path)}
                          >
                            {getRepairTargetLabel(target)}
                          </Button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={isPreviewLoading || isApplyLoading}>
            סגור
          </Button>
          <Button type="button" variant="outline" onClick={() => handlePreview(activeMode)} disabled={!canPreview || isPreviewLoading || isApplyLoading}>
            {isPreviewLoading && <Loader2 className="ms-2 h-4 w-4 animate-spin" />}
            {activeMode === 'retry_failed' ? 'תצוגה מקדימה לפריטים לטיפול' : 'תצוגה מקדימה'}
          </Button>
          <Button type="button" onClick={() => handleApply(activeMode)} disabled={!canApply || isPreviewLoading || isApplyLoading}>
            {isApplyLoading && <Loader2 className="ms-2 h-4 w-4 animate-spin" />}
            {activeMode === 'retry_failed' ? 'נסה שוב רק את הפריטים לטיפול' : 'בצע יצירה'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
