import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, AlertCircle, FileText, Eye } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { authenticatedFetch } from '@/lib/api-client.js';
import { resolveApiErrorMessage } from '@/lib/error-support.js';
import { useSupabase } from '@/context/SupabaseContext.jsx';
import { useOrg } from '@/org/OrgContext.jsx';
import ReportView from '@/features/sessions/components/ReportView.jsx';

function formatReportDate(isoString) {
  if (!isoString) return '';
  try {
    return new Intl.DateTimeFormat('he-IL', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(isoString));
  } catch {
    return '';
  }
}

/**
 * Session Reports Phase 5 — student profile "דוחות מפגשים" (report history) tab.
 *
 * Lists this student's reports via GET /api/session-reports?student_id=,
 * newest first (the API already orders by submitted_at desc). Each row opens
 * a read-only ReportView.jsx dialog, which renders from the report's own
 * captured metadata.form_schema_snapshot so it always displays correctly even
 * if the service's report form has since changed (see
 * implementations/session-reports/implementation-plan.md, Phase 3
 * "Schema-snapshot decision").
 */
export default function StudentReportsTab({ studentId }) {
  const { session } = useSupabase();
  const { activeOrgId } = useOrg();

  const [state, setState] = useState('idle');
  const [error, setError] = useState('');
  const [reports, setReports] = useState([]);
  const [services, setServices] = useState([]);
  const [selectedReport, setSelectedReport] = useState(null);

  const canFetch = Boolean(session && activeOrgId && studentId);

  const loadReports = useCallback(async (options = {}) => {
    if (!canFetch) return;
    setState('loading');
    setError('');
    try {
      const [reportsPayload, servicesPayload] = await Promise.all([
        authenticatedFetch('session-reports', {
          session,
          signal: options.signal,
          params: { org_id: activeOrgId, student_id: studentId },
        }),
        authenticatedFetch('services', {
          session,
          params: { org_id: activeOrgId },
        }).catch(() => []),
      ]);
      setReports(Array.isArray(reportsPayload?.reports) ? reportsPayload.reports : []);
      setServices(Array.isArray(servicesPayload) ? servicesPayload : []);
      setState('idle');
    } catch (err) {
      if (err?.name === 'AbortError') return;
      console.error('Failed to load student reports', err);
      setError(resolveApiErrorMessage(err) || 'טעינת הדוחות נכשלה.');
      setState('error');
    }
  }, [canFetch, session, activeOrgId, studentId]);

  useEffect(() => {
    if (!canFetch) {
      setState('idle');
      setError('');
      setReports([]);
      return;
    }
    const abortController = new AbortController();
    void loadReports({ signal: abortController.signal });
    return () => abortController.abort();
  }, [canFetch, loadReports]);

  const serviceNameById = useMemo(() => {
    const map = new Map();
    for (const service of services) {
      if (service?.id) map.set(service.id, service.name);
    }
    return map;
  }, [services]);

  const isLoading = state === 'loading';
  const hasError = state === 'error';

  return (
    <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="h-1.5 bg-emerald-500" />
      <div className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg bg-emerald-100 text-emerald-600 flex items-center justify-center text-lg">
            <FileText className="h-5 w-5" />
          </div>
          <h3 className="font-semibold text-zinc-800">דוחות מפגשים</h3>
          <span className="me-auto text-sm text-muted-foreground">היסטוריית הדיווחים שהוגשו עבור התלמיד/ה</span>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : hasError ? (
          <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive flex items-start gap-2">
            <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        ) : reports.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-neutral-500">
            <FileText className="h-10 w-10 mb-2 text-neutral-300" />
            <p className="text-sm">עדיין לא הוגשו דוחות מפגש עבור התלמיד/ה</p>
          </div>
        ) : (
          <div className="space-y-2">
            {reports.map((report) => {
              const lessonDateTime = report?.lesson_participants?.lesson_instances?.datetime_start;
              const displayDate = formatReportDate(lessonDateTime) || formatReportDate(report.submitted_at);
              const serviceName = serviceNameById.get(report.service_id) || null;
              return (
                <div
                  key={report.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/10 px-3 py-2"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-foreground">{displayDate || 'ללא תאריך'}</span>
                      {report.is_legacy && (
                        <Badge variant="outline" className="text-xs bg-neutral-50 text-neutral-600 border-neutral-300">
                          דיווח ישן
                        </Badge>
                      )}
                      {report.reviewed_at && (
                        <Badge variant="outline" className="text-xs bg-emerald-50 text-emerald-700 border-emerald-300">
                          נסקר
                        </Badge>
                      )}
                    </div>
                    {serviceName && <span className="text-xs text-neutral-500">{serviceName}</span>}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-2 shrink-0"
                    onClick={() => setSelectedReport(report)}
                  >
                    <Eye className="h-4 w-4" />
                    צפייה
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={Boolean(selectedReport)} onOpenChange={(next) => { if (!next) setSelectedReport(null); }}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>דוח מפגש</DialogTitle>
          </DialogHeader>
          {selectedReport ? <ReportView report={selectedReport} /> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
