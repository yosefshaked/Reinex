import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Calendar, Clock, AlertCircle, Loader2, FileEdit } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useOrg } from '@/org/OrgContext.jsx';
import { useSupabase } from '@/context/SupabaseContext.jsx';
import { authenticatedFetch } from '@/lib/api-client.js';
import { resolveApiErrorMessage } from '@/lib/error-support.js';
import { useSessionReportsEnabled } from '@/features/sessions/config/session-reports-permission.js';
import {
  buildSessionReportContinuationQueue,
  useSessionModal,
} from '@/features/sessions/context/SessionModalContext.jsx';

const REQUEST_STATE = Object.freeze({
  idle: 'idle',
  loading: 'loading',
  error: 'error',
});

const MAX_VISIBLE_ITEMS = 5;

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
 * Session Reports Phase 5 — instructor's own "pending reports" dashboard card.
 *
 * "Pending" is redefined (see implementations/session-reports/implementation-plan.md,
 * Phase 5) as lesson_participants on past lessons that still have no report —
 * driven by GET /api/session-reports?mode=pending&scope=mine, not the retired
 * loose-report workflow. Each item opens the same anchored report drawer
 * (NewSessionModal) via SessionModalContext, exactly like PendingReportsPage.
 */
export default function MyPendingReportsCard({ onCountChange } = {}) {
  const { activeOrg } = useOrg();
  const { session } = useSupabase();
  const { openSessionReportModal } = useSessionModal();
  const [state, setState] = useState(REQUEST_STATE.idle);
  const [error, setError] = useState('');
  const [items, setItems] = useState([]);
  const [hasMore, setHasMore] = useState(false);

  const activeOrgId = activeOrg?.id || null;
  const sessionReportsEnabled = useSessionReportsEnabled();
  const canFetch = Boolean(session && activeOrgId && sessionReportsEnabled);

  const loadPending = useCallback(async (options = {}) => {
    if (!canFetch) return;

    setState(REQUEST_STATE.loading);
    setError('');

    try {
      const payload = await authenticatedFetch('session-reports', {
        session,
        signal: options.signal,
        params: { org_id: activeOrgId, mode: 'pending', scope: 'mine', page: 1 },
      });
      const nextItems = Array.isArray(payload?.items) ? payload.items : [];
      const total = Number(payload?.total);
      setItems(nextItems);
      setHasMore(Boolean(payload?.has_more));
      onCountChange?.(
        Number.isFinite(total) && total >= 0 ? total : nextItems.length,
        Boolean(payload?.has_more),
      );
      setState(REQUEST_STATE.idle);
    } catch (err) {
      if (err?.name === 'AbortError') return;
      console.error('Failed to load pending reports', err);
      setError(resolveApiErrorMessage(err) || 'טעינת הדיווחים הממתינים נכשלה.');
      setState(REQUEST_STATE.error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canFetch, activeOrgId, session]);

  useEffect(() => {
    if (!canFetch) {
      setState(REQUEST_STATE.idle);
      setError('');
      setItems([]);
      setHasMore(false);
      onCountChange?.(0, false);
      return;
    }

    const abortController = new AbortController();
    void loadPending({ signal: abortController.signal });

    return () => {
      abortController.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canFetch, loadPending]);

  const handleOpenReport = useCallback((item) => {
    openSessionReportModal({
      lessonParticipantId: item.lesson_participant_id,
      studentName: item.student_name || '',
      serviceName: item.service_name || '',
      lessonDateTime: item.lesson_datetime_start || '',
      continuationQueue: buildSessionReportContinuationQueue(items, item.lesson_participant_id),
      onCreated: () => void loadPending(),
    });
  }, [openSessionReportModal, items, loadPending]);

  const isLoading = state === REQUEST_STATE.loading;
  const hasError = state === REQUEST_STATE.error;

  if (!canFetch) {
    return null;
  }

  const visibleItems = items.slice(0, MAX_VISIBLE_ITEMS);
  const remainingCount = Math.max(items.length - visibleItems.length, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-end">הדיווחים הממתינים שלי</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-neutral-600">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>טוען דיווחים...</span>
          </div>
        ) : hasError ? (
          <div className="rounded-lg bg-red-50 p-4 text-sm text-red-700">
            {error || 'טעינת הדיווחים נכשלה.'}
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-8 text-neutral-500">
            <AlertCircle className="h-10 w-10 mx-auto mb-3 text-neutral-400" />
            <p className="text-sm font-medium">אין דיווחים ממתינים</p>
            <p className="text-xs mt-1">כל המפגשים שלכם מתועדים.</p>
          </div>
        ) : (
          <>
            {visibleItems.map((item) => (
              <div
                key={item.lesson_participant_id}
                className="flex flex-col gap-2 rounded-lg border-2 border-amber-200 bg-amber-50/30 p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-foreground break-words">
                      {item.student_name || 'תלמיד ללא שם'}
                    </span>
                    {item.participant_status === 'scheduled' && (
                      <Badge variant="outline" className="bg-neutral-50 text-neutral-600 border-neutral-300 text-xs">
                        נוכחות טרם אושרה
                      </Badge>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-600">
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3.5 w-3.5" />
                      {formatLessonDateTime(item.lesson_datetime_start)}
                    </span>
                    {item.service_name && (
                      <span className="flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" />
                        {item.service_name}
                      </span>
                    )}
                  </div>
                </div>
                <Button size="sm" className="gap-2 shrink-0" onClick={() => handleOpenReport(item)}>
                  <FileEdit className="h-4 w-4" />
                  דיווח
                </Button>
              </div>
            ))}
            {(remainingCount > 0 || hasMore) && (
              <div className="text-center">
                <Link to="/pending-reports" className="text-xs text-primary hover:underline">
                  {remainingCount > 0 ? `עוד ${remainingCount} דיווחים ממתינים` : 'צפייה בכל הדיווחים הממתינים'}
                </Link>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
