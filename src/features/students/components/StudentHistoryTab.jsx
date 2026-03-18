import React, { useState, useEffect } from 'react';
import { Loader2, Clock, AlertCircle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { apiClient } from '@/services/apiClient.js';

/**
 * History tab showing student audit log timeline.
 * 
 * Displays a chronological timeline of all system actions affecting this student,
 * including:
 * - Profile changes (guardian, phone, email, etc.)
 * - Status changes (active/suspended)
 * - Lesson assignments/cancellations
 * - Enrollment changes
 * 
 * Each entry shows:
 * - Action type (badge)
 * - Actor name
 * - Timestamp
 * - Before/after values (in collapsible details)
 * 
 * Uses pagination via `before` cursor for performance.
 * 
 * @param {Object} props
 * @param {string} props.studentId - Student ID for filtering audit log
 * @returns {JSX.Element}
 */
export default function StudentHistoryTab({ studentId }) {
  const [auditLog, setAuditLog] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [beforeCursor, setBeforeCursor] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  // Fetch student audit log on mount and when beforeCursor changes
  useEffect(() => {
    if (!studentId) {
      setError('Student ID is required');
      return;
    }

    const fetchAuditLog = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const params = {
          resource_id: studentId,
          limit: 50,
        };
        if (beforeCursor) {
          params.before = beforeCursor;
        }

        const response = await apiClient.get('/api/audit-log', { params });
        const entries = response?.data?.audit_log || [];

        if (beforeCursor) {
          // Append to existing log for pagination
          setAuditLog((prev) => [...prev, ...entries]);
        } else {
          // First load
          setAuditLog(entries);
        }

        setHasMore(entries.length >= 50);
      } catch (err) {
        console.error('Error fetching audit log:', err);
        setError(err.message || 'Failed to load history');
        setHasMore(false);
      } finally {
        setIsLoading(false);
      }
    };

    fetchAuditLog();
  }, [studentId, beforeCursor]);

  const handleLoadMore = () => {
    if (auditLog.length > 0) {
      const lastEntry = auditLog[auditLog.length - 1];
      setBeforeCursor(lastEntry.id);
    }
  };

  const getActionBadgeVariant = (action) => {
    const actionMap = {
      UPDATE: 'default',
      CREATE: 'secondary',
      DELETE: 'destructive',
      SUSPEND: 'destructive',
      ACTIVATE: 'secondary',
      ENROLL: 'secondary',
      UNENROLL: 'outline',
    };
    return actionMap[action] || 'outline';
  };

  const formatTimestamp = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleString('he-IL', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-blue-600" />
          <CardTitle className="text-lg">היסטוריית שינויים</CardTitle>
        </div>
        <CardDescription>כל השינויים בנתוני התלמיד</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && auditLog.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
          </div>
        ) : error ? (
          <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive flex items-start gap-2">
            <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        ) : auditLog.length > 0 ? (
          <>
            {/* Timeline */}
            <div className="space-y-3">
              {auditLog.map((entry, idx) => (
                <div key={entry.id || idx} className="space-y-2">
                  {/* Timeline dot and line */}
                  <div className="flex items-start gap-3">
                    <div className="flex flex-col items-center gap-2 pt-1">
                      <div className="h-3 w-3 rounded-full border-2 border-blue-500 bg-white" />
                      {idx < auditLog.length - 1 && (
                        <div className="h-12 w-0.5 bg-neutral-200" />
                      )}
                    </div>

                    {/* Entry content */}
                    <div
                      className="flex-1 cursor-pointer rounded-md border px-3 py-3 hover:bg-neutral-50/50 transition-colors"
                      onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <div className="flex flex-wrap gap-2 items-center mb-1">
                            <Badge variant={getActionBadgeVariant(entry.action)} className="text-xs">
                              {entry.action}
                            </Badge>
                            {entry.action_category && (
                              <span className="text-xs text-neutral-600">
                                {entry.action_category}
                              </span>
                            )}
                          </div>
                          <p className="text-sm font-medium text-foreground">
                            {entry.actor_name || 'System'}
                          </p>
                          <p className="text-xs text-neutral-500 mt-0.5">
                            {formatTimestamp(entry.created_at)}
                          </p>
                        </div>
                      </div>

                      {/* Expandable Details */}
                      {expandedId === entry.id && (
                        <div className="mt-3 space-y-2 border-t pt-3 text-xs">
                          {entry.changes?.length > 0 ? (
                            entry.changes.map((change, idx) => (
                              <div key={idx} className="space-y-1 pb-2 last:pb-0">
                                <p className="font-semibold text-neutral-700">
                                  {change.field}
                                </p>
                                <div className="grid grid-cols-2 gap-2">
                                  <div>
                                    <p className="text-xs text-neutral-500">קודם</p>
                                    <p className="text-neutral-700 break-words">
                                      {change.before || '—'}
                                    </p>
                                  </div>
                                  <div>
                                    <p className="text-xs text-neutral-500">אחרי</p>
                                    <p className="text-neutral-700 break-words">
                                      {change.after || '—'}
                                    </p>
                                  </div>
                                </div>
                              </div>
                            ))
                          ) : (
                            <p className="text-neutral-500">אין פרטי שינוי</p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Load More Button */}
            {hasMore && (
              <div className="sticky bottom-0 flex justify-center pt-4">
                <button
                  onClick={handleLoadMore}
                  disabled={isLoading}
                  className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-50 disabled:opacity-50"
                >
                  {isLoading ? 'טוען...' : 'טען עוד הערכים'}
                </button>
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-neutral-500 py-2">אין היסטוריית שינUIים</p>
        )}
      </CardContent>
    </Card>
  );
}
