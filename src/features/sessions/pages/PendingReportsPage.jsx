import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Loader2, AlertCircle, Calendar, Clock, FileEdit, ChevronRight, ChevronLeft, Info } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useOrg } from '@/org/OrgContext.jsx';
import { useSupabase } from '@/context/SupabaseContext.jsx';
import { authenticatedFetch } from '@/lib/api-client.js';
import { resolveApiErrorMessage } from '@/lib/error-support.js';
import { normalizeMembershipRole, isAdminOrOffice } from '@/features/students/utils/endpoints.js';
import { useSessionReportsEnabled } from '@/features/sessions/config/session-reports-permission.js';
import { useSessionModal } from '@/features/sessions/context/SessionModalContext.jsx';

const REQUEST_STATE = Object.freeze({
  idle: 'idle',
  loading: 'loading',
  error: 'error',
});

function formatLessonDateTime(isoString) {
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
 * Session Reports Phase 5 — "pending reports" (redefined).
 *
 * A pending item is a lesson_participants row on a past, non-cancelled lesson
 * (participant_status IN ('attended','scheduled')) whose service has a report
 * form assigned, with no non-legacy report yet — see
 * GET /api/session-reports?mode=pending in api/session-reports/index.js.
 * There is no more loose-report / unassigned-student workflow (Decision #4 in
 * implementations/session-reports/implementation-plan.md) — every row here is
 * already anchored to a real lesson_participants row, so the only action is
 * "open the report drawer" (via SessionModalContext), never assign/reject.
 *
 * Admin/office see the org-wide list (scope=all) plus the E7 "documented but
 * unconfirmed" drift signal; plain instructors see only their own lessons
 * (scope=mine) — the backend enforces this same split server-side.
 */
export default function PendingReportsPage() {
  const sessionReportsEnabled = useSessionReportsEnabled();
  const { activeOrg } = useOrg();
  const { session } = useSupabase();
  const { openSessionReportModal } = useSessionModal();

  const [state, setState] = useState(REQUEST_STATE.idle);
  const [error, setError] = useState('');
  const [items, setItems] = useState([]);
  const [documentedUnconfirmed, setDocumentedUnconfirmed] = useState([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  const activeOrgId = activeOrg?.id || null;
  const membershipRole = activeOrg?.membership?.role;
  const normalizedRole = useMemo(() => normalizeMembershipRole(membershipRole), [membershipRole]);
  const isAdminOrOfficeMember = isAdminOrOffice(normalizedRole);
  const scope = isAdminOrOfficeMember ? 'all' : 'mine';

  const canFetch = Boolean(session && activeOrgId && sessionReportsEnabled);

  const loadPending = useCallback(async (targetPage = 1, options = {}) => {
    if (!canFetch) return;

    setState(REQUEST_STATE.loading);
    setError('');

    try {
      const payload = await authenticatedFetch('session-reports', {
        session,
        signal: options.signal,
        params: { org_id: activeOrgId, mode: 'pending', scope, page: targetPage },
      });
      setItems(Array.isArray(payload?.items) ? payload.items : []);
      setDocumentedUnconfirmed(Array.isArray(payload?.documented_unconfirmed) ? payload.documented_unconfirmed : []);
      setHasMore(Boolean(payload?.has_more));
      setPage(targetPage);
      setState(REQUEST_STATE.idle);
    } catch (err) {
      if (err?.name === 'AbortError') return;
      console.error('Failed to load pending reports', err);
      setError(resolveApiErrorMessage(err) || 'טעינת הדיווחים הממתינים נכשלה.');
      setState(REQUEST_STATE.error);
    }
  }, [canFetch, activeOrgId, session, scope]);

  useEffect(() => {
    if (!canFetch) {
      setState(REQUEST_STATE.idle);
      setError('');
      setItems([]);
      setDocumentedUnconfirmed([]);
      setPage(1);
      setHasMore(false);
      return;
    }

    const abortController = new AbortController();
    void loadPending(1, { signal: abortController.signal });

    return () => {
      abortController.abort();
    };
  }, [canFetch, loadPending]);

  const handleOpenReport = useCallback((item) => {
    openSessionReportModal({
      lessonParticipantId: item.lesson_participant_id,
      studentName: item.student_name || '',
      serviceName: item.service_name || '',
      lessonDateTime: item.lesson_datetime_start || '',
      onCreated: () => void loadPending(page),
    });
  }, [openSessionReportModal, loadPending, page]);

  const isLoading = state === REQUEST_STATE.loading;
  const hasError = state === REQUEST_STATE.error;

  if (!canFetch && (!session || !activeOrgId)) {
    return (
      <div className="container mx-auto p-4 sm:p-6 max-w-5xl">
        <Card>
          <CardHeader>
            <CardTitle>דיווחים ממתינים</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 text-neutral-600">
              <AlertCircle className="h-5 w-5" />
              <p>יש לבחור ארגון פעיל כדי לצפות בדיווחים ממתינים.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!sessionReportsEnabled) {
    return <Navigate to="/students-list" replace />;
  }

  return (
    <div className="container mx-auto p-4 sm:p-6 max-w-5xl">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <div>
            <CardTitle className="text-2xl font-bold">דיווחים ממתינים</CardTitle>
            <p className="text-sm text-neutral-500 mt-1">
              {isAdminOrOfficeMember
                ? 'מפגשים שהתקיימו וטרם תועדו על ידי המדריך.'
                : 'המפגשים שלכם שטרם תיעדתם.'}
            </p>
          </div>
          {items.length > 0 && (
            <Badge variant="outline" className="text-lg px-3 py-1">
              {items.length}
              {hasMore ? '+' : ''}
            </Badge>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-neutral-600">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span>טוען דיווחים...</span>
            </div>
          ) : hasError ? (
            <div className="rounded-lg bg-red-50 p-4 text-sm text-red-700">
              {error || 'טעינת הדיווחים נכשלה.'}
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-12 text-neutral-500">
              <AlertCircle className="h-12 w-12 mx-auto mb-4 text-neutral-400" />
              <p className="text-lg font-medium">אין דיווחים ממתינים</p>
              <p className="text-sm mt-1">כל המפגשים תועדו.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {items.map((item) => (
                <Card key={item.lesson_participant_id} className="border-2 hover:border-primary/30 transition-colors">
                  <CardContent className="p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-base font-semibold text-foreground break-words">
                            {item.student_name || 'תלמיד ללא שם'}
                          </h3>
                          {item.participant_status === 'scheduled' && (
                            <Badge variant="outline" className="bg-neutral-50 text-neutral-600 border-neutral-300">
                              נוכחות טרם אושרה
                            </Badge>
                          )}
                        </div>
                        <div className="grid grid-cols-1 gap-1 text-sm text-neutral-600 sm:grid-cols-2">
                          <span className="flex items-center gap-2">
                            <Calendar className="h-4 w-4 shrink-0" />
                            {formatLessonDateTime(item.lesson_datetime_start)}
                          </span>
                          {item.service_name && (
                            <span className="flex items-center gap-2">
                              <Clock className="h-4 w-4 shrink-0" />
                              {item.service_name}
                            </span>
                          )}
                          {isAdminOrOfficeMember && item.instructor_name && (
                            <span className="text-neutral-500">מדריך: {item.instructor_name}</span>
                          )}
                        </div>
                      </div>
                      <Button size="sm" className="gap-2 shrink-0" onClick={() => handleOpenReport(item)}>
                        <FileEdit className="h-4 w-4" />
                        דיווח מפגש
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {!isLoading && !hasError && (items.length > 0 || page > 1) && (
            <div className="flex items-center justify-between pt-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => void loadPending(page - 1)}
                className="gap-1"
              >
                <ChevronRight className="h-4 w-4" />
                הקודם
              </Button>
              <span className="text-xs text-neutral-500">עמוד {page}</span>
              <Button
                variant="outline"
                size="sm"
                disabled={!hasMore}
                onClick={() => void loadPending(page + 1)}
                className="gap-1"
              >
                הבא
                <ChevronLeft className="h-4 w-4" />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* E7 drift signal — admin/office only, "documented but attendance never confirmed" */}
      {isAdminOrOfficeMember && documentedUnconfirmed.length > 0 && (
        <Card className="mt-4 border-dashed border-amber-300 bg-amber-50/40">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base font-semibold text-amber-800">
              <Info className="h-4 w-4" />
              מתועד אך נוכחות לא אושרה
            </CardTitle>
            <p className="text-xs text-amber-700">
              קיים דיווח למפגשים הבאים, אך הנוכחות עדיין מסומנת כ"ממתין" ביומן — כדאי לוודא ולעדכן את הנוכחות.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {documentedUnconfirmed.map((item) => (
              <div key={item.lesson_participant_id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-200 bg-white px-3 py-2 text-sm">
                <span className="font-medium text-foreground">{item.student_name || 'תלמיד ללא שם'}</span>
                <span className="text-neutral-500">{formatLessonDateTime(item.lesson_datetime_start)}</span>
                {item.service_name && <span className="text-neutral-500">{item.service_name}</span>}
                {item.instructor_name && <span className="text-neutral-500">מדריך: {item.instructor_name}</span>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
