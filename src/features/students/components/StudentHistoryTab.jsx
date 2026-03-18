import React, { useState, useEffect, useCallback } from 'react';
import { Loader2, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { authenticatedFetch } from '@/lib/api-client.js';
import { useSupabase } from '@/context/SupabaseContext.jsx';
import { useOrg } from '@/org/OrgContext.jsx';

/** Map technical action_type strings to readable Hebrew labels */
const ACTION_LABELS = {
  STUDENT_CREATED: 'יצירת תלמיד',
  STUDENT_UPDATED: 'עדכון פרטי תלמיד',
  STUDENT_DELETED: 'מחיקת תלמיד',
  STATUS_CHANGED: 'שינוי סטטוס',
  GUARDIAN_CREATED: 'הוספת אפוטרופוס',
  GUARDIAN_UPDATED: 'עדכון אפוטרופוס',
  GUARDIAN_DELETED: 'מחיקת אפוטרופוס',
  DOCUMENT_UPLOADED: 'העלאת מסמך',
  DOCUMENT_DELETED: 'מחיקת מסמך',
  LESSON_ASSIGNED: 'הקצאת שיעור',
  LESSON_CANCELLED: 'ביטול שיעור',
  ENROLLMENT_CREATED: 'הרשמה לקורס',
  ENROLLMENT_DELETED: 'ביטול הרשמה',
  TEMPLATE_CREATED: 'יצירת תבנית שיעור',
  TEMPLATE_UPDATED: 'עדכון תבנית שיעור',
};

function getActionLabel(actionType) {
  if (!actionType) return 'פעולה';
  return ACTION_LABELS[actionType] || actionType.replace(/_/g, ' ');
}

function getActionVariant(actionType) {
  if (!actionType) return 'outline';
  const type = String(actionType).toUpperCase();
  if (type.includes('DELETE') || type.includes('CANCEL')) return 'destructive';
  if (type.includes('CREATE') || type.includes('ENROLL')) return 'secondary';
  return 'default';
}

function formatTimestamp(ts) {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleString('he-IL', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return ts;
  }
}

/**
 * History tab: fetches audit log entries for a student and renders them as a vertical timeline.
 *
 * @param {Object} props
 * @param {string} props.studentId
 */
export default function StudentHistoryTab({ studentId }) {
  const { session } = useSupabase();
  const { activeOrg } = useOrg();

  const [entries, setEntries] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [expandedId, setExpandedId] = useState(null);

  const activeOrgId = activeOrg?.id;

  const fetchAuditLog = useCallback(async (cursor = null) => {
    if (!studentId || !activeOrgId) return;

    const isFirst = !cursor;
    if (isFirst) setIsLoading(true);
    else setIsLoadingMore(true);
    setError(null);

    try {
      const params = {
        resource_id: studentId,
        org_id: activeOrgId,
        limit: 50,
      };
      if (cursor) params.before = cursor;

      const data = await authenticatedFetch('audit-log', { session, params });
      const logs = Array.isArray(data?.logs) ? data.logs : [];
      const pagination = data?.pagination || {};

      if (isFirst) {
        setEntries(logs);
      } else {
        setEntries((prev) => [...prev, ...logs]);
      }

      setHasMore(Boolean(pagination.has_more));
      setNextCursor(pagination.next_cursor || null);
    } catch (err) {
      console.error('Failed to load audit log', err);
      setError(err?.message || 'טעינת היסטוריה נכשלה');
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, [studentId, activeOrgId, session]);

  useEffect(() => {
    void fetchAuditLog();
  }, [fetchAuditLog]);

  const handleLoadMore = () => {
    if (nextCursor && !isLoadingMore) {
      void fetchAuditLog(nextCursor);
    }
  };

  const toggleExpanded = (id) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  /** Render before/after details for an audit entry */
  const renderDetails = (entry) => {
    const details = entry?.details;
    if (!details || typeof details !== 'object') {
      return <p className="text-xs text-neutral-500">אין פרטי שינוי נוספים</p>;
    }

    // "changes" array format (structured diffs)
    if (Array.isArray(details.changes) && details.changes.length > 0) {
      return (
        <div className="space-y-2">
          {details.changes.map((change, idx) => (
            <div key={idx} className="space-y-1 pb-2 last:pb-0">
              <p className="font-semibold text-neutral-700 text-xs">{change.field || 'שדה'}</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <p className="text-neutral-500">לפני</p>
                  <p className="text-neutral-700 break-words">{String(change.before ?? '—')}</p>
                </div>
                <div>
                  <p className="text-neutral-500">אחרי</p>
                  <p className="text-neutral-700 break-words">{String(change.after ?? '—')}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      );
    }

    // Generic key-value pairs in details
    const keys = Object.keys(details).filter((k) => k !== 'changes');
    if (keys.length === 0) {
      return <p className="text-xs text-neutral-500">אין פרטי שינוי נוספים</p>;
    }

    return (
      <div className="space-y-1 text-xs">
        {keys.map((key) => (
          <div key={key} className="flex gap-2">
            <span className="font-semibold text-neutral-600 min-w-[80px]">{key}:</span>
            <span className="text-neutral-700 break-words">{String(details[key] ?? '—')}</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="h-1.5 bg-indigo-500" />
      <div className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center text-lg">🕐</div>
          <h3 className="font-semibold text-zinc-800">היסטוריית שינויים</h3>
          <span className="mr-auto text-sm text-muted-foreground">כל השינויים שנעשו בנתוני התלמיד</span>
        </div>
        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-start gap-3">
                <Skeleton className="h-3 w-3 rounded-full mt-1.5" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive flex items-start gap-2">
            <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        ) : entries.length > 0 ? (
          <>
            {/* Timeline */}
            <div className="space-y-0">
              {entries.map((entry, idx) => {
                const isExpanded = expandedId === entry.id;
                return (
                  <div key={entry.id || idx} className="flex items-stretch gap-3">
                    {/* Timeline spine */}
                    <div className="flex flex-col items-center w-4">
                      <div className="h-3 w-3 rounded-full border-2 border-blue-500 bg-white flex-shrink-0 mt-4" />
                      {idx < entries.length - 1 && (
                        <div className="flex-1 w-0.5 bg-neutral-200" />
                      )}
                    </div>

                    {/* Entry content */}
                    <div className="flex-1 pb-4">
                      <button
                        type="button"
                        className="w-full rounded-md border px-3 py-3 text-right hover:bg-neutral-50/50 transition-colors"
                        onClick={() => toggleExpanded(entry.id)}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 text-right">
                            <div className="flex flex-wrap gap-2 items-center mb-1">
                              <Badge variant={getActionVariant(entry.action_type)} className="text-xs">
                                {getActionLabel(entry.action_type)}
                              </Badge>
                              {entry.action_category && (
                                <span className="text-xs text-neutral-500">{entry.action_category}</span>
                              )}
                            </div>
                            <p className="text-sm font-medium text-foreground">
                              {entry.user_email || 'מערכת'}
                            </p>
                            <p className="text-xs text-neutral-500 mt-0.5">
                              {formatTimestamp(entry.performed_at)}
                            </p>
                          </div>
                          {isExpanded ? (
                            <ChevronUp className="h-4 w-4 text-neutral-400 flex-shrink-0 mt-1" />
                          ) : (
                            <ChevronDown className="h-4 w-4 text-neutral-400 flex-shrink-0 mt-1" />
                          )}
                        </div>

                        {/* Expandable before/after details */}
                        {isExpanded && (
                          <div className="mt-3 border-t pt-3 text-right">
                            {renderDetails(entry)}
                          </div>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Load More */}
            {hasMore && (
              <div className="flex justify-center pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleLoadMore}
                  disabled={isLoadingMore}
                >
                  {isLoadingMore ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin ms-2" />
                      טוען...
                    </>
                  ) : (
                    'טען עוד'
                  )}
                </Button>
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center py-8 text-neutral-500">
            <span className="text-3xl mb-2">🕐</span>
            <p className="text-sm">אין היסטוריית שינויים</p>
          </div>
        )}
      </div>
    </div>
  );
}
