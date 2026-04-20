import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, AlertTriangle } from 'lucide-react';
import { useOrg } from '@/org/OrgContext';
import { authenticatedFetch } from '@/lib/api-client.js';
import { getTodayLocalDateString, getWeekRangeDateStrings } from '../utils/localDate.js';

export function ManualGenerationDialog({ open, onClose, defaultDate, onApplied }) {
  const { activeOrgId } = useOrg();
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isApplyLoading, setIsApplyLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    const referenceDate = defaultDate || getTodayLocalDateString();
    const week = getWeekRangeDateStrings(referenceDate);
    setStartDate(week.start);
    setEndDate(week.end);
    setResult(null);
    setError('');
  }, [open, defaultDate]);

  const canPreview = useMemo(() => Boolean(activeOrgId && startDate && endDate && startDate <= endDate), [activeOrgId, startDate, endDate]);
  const generationWarnings = useMemo(() => (
    Array.isArray(result?.warnings) ? result.warnings : []
  ), [result]);
  const applyErrors = useMemo(() => (
    Array.isArray(result?.applied?.errors) ? result.applied.errors : []
  ), [result]);
  const warningReasonCounts = useMemo(() => {
    const counts = new Map();
    for (const warning of generationWarnings) {
      const reason = String(warning?.reason || 'other');
      counts.set(reason, (counts.get(reason) || 0) + 1);
    }
    return Array.from(counts.entries()).map(([reason, count]) => ({ reason, count }));
  }, [generationWarnings]);

  function getWarningReasonLabel(reason) {
    switch (reason) {
      case 'no_authorization_found':
        return 'אין הרשאת גורם מממן לשירות';
      case 'no_active_authorization':
        return 'קיימת הרשאה אך אינה פעילה';
      case 'no_active_authorization_for_date':
        return 'הרשאה פעילה אך טווח תאריכים לא מכסה את המועד';
      default:
        return 'פער הרשאה לא מסווג';
    }
  }

  async function runGeneration(dryRun) {
    if (!activeOrgId) {
      setError('ארגון פעיל לא נמצא.');
      return null;
    }

    const payload = {
      org_id: activeOrgId,
      start_date: startDate,
      end_date: endDate,
      dry_run: dryRun,
    };

    return authenticatedFetch('calendar/generate', {
      method: 'POST',
      body: payload,
    });
  }

  async function handlePreview() {
    if (!canPreview) return;
    setIsPreviewLoading(true);
    setError('');

    try {
      const payload = await runGeneration(true);
      setResult(payload || null);
    } catch (err) {
      setError(err?.message || 'הרצת תצוגה מקדימה נכשלה.');
      setResult(null);
    } finally {
      setIsPreviewLoading(false);
    }
  }

  async function handleApply() {
    if (!canPreview) return;
    setIsApplyLoading(true);
    setError('');

    try {
      const payload = await runGeneration(false);
      setResult(payload || null);
      if (Array.isArray(payload?.applied?.errors) && payload.applied.errors.length > 0) {
        console.error('Calendar generation apply errors', payload.applied.errors);
        setError(`היצירה הושלמה חלקית. ${payload.applied.errors.length} פעולות נכשלו.`);
      }
      onApplied?.(payload || null);
    } catch (err) {
      setError(err?.message || 'החלת היצירה נכשלה.');
    } finally {
      setIsApplyLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>יצירה ידנית מתבניות</DialogTitle>
          <DialogDescription>
            הרצת דור מופעים לטווח תאריכים עם תצוגה מקדימה לפני החלה בפועל.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="generation-start-date">מתאריך</Label>
              <Input
                id="generation-start-date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="generation-end-date">עד תאריך</Label>
              <Input
                id="generation-end-date"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {result && (
            <div className="space-y-3 border rounded-md p-3 bg-gray-50/70">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                <div className="p-2 bg-white rounded border">תבניות: <span className="font-medium">{result.summary?.templates_considered ?? 0}</span></div>
                <div className="p-2 bg-white rounded border">מועמדים: <span className="font-medium">{result.summary?.candidate_slots ?? 0}</span></div>
                <div className="p-2 bg-white rounded border">להוספה: <span className="font-medium">{result.summary?.to_insert_instances ?? 0}</span></div>
                <div className="p-2 bg-white rounded border">קונפליקטים: <span className="font-medium">{result.summary?.conflicts ?? 0}</span></div>
              </div>

              {(result.summary?.hmo_coverage_warnings ?? 0) > 0 && (
                <Alert className="border-amber-300 bg-amber-50 text-amber-950">
                  <AlertTriangle className="h-4 w-4 text-amber-700" />
                  <AlertDescription className="space-y-2">
                    <div>
                      זוהו <span className="font-semibold">{result.summary?.hmo_coverage_warnings ?? 0}</span> אזהרות כיסוי גורם מממן.
                      {' '}היצירה אינה נחסמת, אך כדאי לטפל באזהרות לפני החלה מלאה.
                    </div>
                    {warningReasonCounts.length > 0 && (
                      <div className="text-xs text-amber-900 flex flex-wrap gap-2">
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
                  <p className="text-sm font-medium mb-1">אזהרות כיסוי גורם מממן</p>
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {generationWarnings.slice(0, 30).map((warning, index) => (
                      <div key={`${warning.student_id || 'student'}-${warning.service_id || 'service'}-${warning.target_date || index}`} className="text-xs bg-white border rounded px-2 py-1">
                        <span className="font-medium">סיבה:</span> {getWarningReasonLabel(warning.reason)}
                        {' • '}
                        <span className="font-medium">תלמיד:</span> {warning.student_id || '—'}
                        {' • '}
                        <span className="font-medium">שירות:</span> {warning.service_id || '—'}
                        {' • '}
                        <span className="font-medium">תאריך:</span> {warning.target_date || '—'}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {Array.isArray(result.conflicts) && result.conflicts.length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-1">קונפליקטים שזוהו</p>
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {result.conflicts.slice(0, 20).map((conflict, index) => (
                      <div key={`${conflict.template_id || 'template'}-${index}`} className="text-xs bg-white border rounded px-2 py-1">
                        <span className="font-medium">תבנית:</span> {conflict.template_id || '—'}
                        {' • '}
                        <span className="font-medium">זמן:</span> {conflict.datetime_start || conflict.target_date || '—'}
                        {Array.isArray(conflict.issues) && conflict.issues.length > 0 && (
                          <span>{' • '}{conflict.issues.map((issue) => issue.type).join(', ')}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {applyErrors.length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-1 text-red-700">שגיאות בהחלה</p>
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {applyErrors.slice(0, 20).map((applyError, index) => (
                      <div key={`${applyError.template_id || 'template'}-${applyError.datetime_start || index}`} className="text-xs bg-red-50 border border-red-200 rounded px-2 py-1 text-red-900">
                        <span className="font-medium">תבנית:</span> {applyError.template_id || '—'}
                        {' • '}
                        <span className="font-medium">זמן:</span> {applyError.datetime_start || '—'}
                        {' • '}
                        <span className="font-medium">שגיאה:</span> {applyError.message || applyError.type || 'apply_error'}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={isPreviewLoading || isApplyLoading}>
            סגור
          </Button>
          <Button type="button" variant="outline" onClick={handlePreview} disabled={!canPreview || isPreviewLoading || isApplyLoading}>
            {isPreviewLoading && <Loader2 className="h-4 w-4 animate-spin ms-2" />}
            תצוגה מקדימה
          </Button>
          <Button
            type="button"
            onClick={handleApply}
            disabled={!canPreview || isPreviewLoading || isApplyLoading || (result && result.summary?.to_insert_instances === 0)}
          >
            {isApplyLoading && <Loader2 className="h-4 w-4 animate-spin ms-2" />}
            בצע יצירה
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
