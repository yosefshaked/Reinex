import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Loader2, RefreshCw } from 'lucide-react';
import { authenticatedFetch } from '@/lib/api-client.js';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const PAGE_SIZE = 50;

function formatDateTime(value) {
  if (!value) return '—';

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return '—';
  }

  return new Intl.DateTimeFormat('he-IL', {
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(parsed);
}

function formatDetails(details) {
  if (!details || typeof details !== 'object' || Array.isArray(details)) {
    return '—';
  }

  const entries = Object.entries(details);
  if (entries.length === 0) {
    return '—';
  }

  const summary = entries
    .slice(0, 2)
    .map(([key, value]) => {
      const serialized = typeof value === 'object' ? JSON.stringify(value) : String(value);
      const compact = serialized.length > 60 ? `${serialized.slice(0, 57)}...` : serialized;
      return `${key}: ${compact}`;
    })
    .join(' | ');

  return entries.length > 2 ? `${summary} ...` : summary;
}

function normalizeFilter(value) {
  return String(value || '').trim().toLowerCase();
}

export default function AuditLogViewer({ session, orgId }) {
  const [logs, setLogs] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  const filterText = normalizeFilter(search);

  const visibleLogs = useMemo(() => {
    if (!filterText) return logs;

    return logs.filter((log) => {
      const haystack = [
        log.action_type,
        log.action_category,
        log.user_email,
        log.user_role,
        log.resource_type,
        log.resource_id,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return haystack.includes(filterText);
    });
  }, [logs, filterText]);

  async function fetchLogs({ cursor = null, append = false } = {}) {
    if (!orgId || !session) return;

    if (append) {
      setIsLoadingMore(true);
    } else {
      setIsLoading(true);
      setError('');
    }

    try {
      const payload = await authenticatedFetch('audit-log', {
        session,
        params: {
          org_id: orgId,
          limit: PAGE_SIZE,
          before: cursor || undefined,
        },
      });

      const incomingLogs = Array.isArray(payload?.logs) ? payload.logs : [];
      const pagination = payload?.pagination || {};

      setLogs((prev) => (append ? [...prev, ...incomingLogs] : incomingLogs));
      setHasMore(Boolean(pagination.has_more));
      setNextCursor(pagination.next_cursor || null);
    } catch (fetchError) {
      setError(fetchError?.message || 'שגיאה בטעינת יומן הביקורת');
    } finally {
      if (append) {
        setIsLoadingMore(false);
      } else {
        setIsLoading(false);
      }
    }
  }

  useEffect(() => {
    fetchLogs({ append: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, session?.access_token]);

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">יומן ביקורת ארגוני</h3>
          <p className="text-sm text-slate-600">מוצגות פעולות שבוצעו בארגון הפעיל בלבד.</p>
        </div>

        <Button
          type="button"
          variant="outline"
          className="gap-2"
          onClick={() => fetchLogs({ append: false })}
          disabled={isLoading}
        >
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          רענון
        </Button>
      </div>

      <div className="max-w-sm">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="חיפוש לפי פעולה, קטגוריה או משתמש"
        />
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {isLoading ? (
        <div className="h-40 flex items-center justify-center text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : (
        <div className="rounded-md border bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">זמן</TableHead>
                <TableHead className="text-right">פעולה</TableHead>
                <TableHead className="text-right">קטגוריה</TableHead>
                <TableHead className="text-right">משתמש</TableHead>
                <TableHead className="text-right">משאב</TableHead>
                <TableHead className="text-right">פרטים</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleLogs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-slate-500">
                    לא נמצאו רשומות יומן ביקורת.
                  </TableCell>
                </TableRow>
              ) : (
                visibleLogs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="text-right whitespace-nowrap">{formatDateTime(log.performed_at)}</TableCell>
                    <TableCell className="text-right">
                      <span className="font-medium">{log.action_type || '—'}</span>
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant="secondary">{log.action_category || '—'}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="text-sm leading-tight">
                        <div>{log.user_email || '—'}</div>
                        <div className="text-xs text-slate-500">{log.user_role || '—'}</div>
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {log.resource_type || '—'}
                      {log.resource_id ? <div className="text-xs text-slate-500">{log.resource_id}</div> : null}
                    </TableCell>
                    <TableCell className="text-right text-xs text-slate-600 max-w-[320px] break-words">
                      {formatDetails(log.details)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {hasMore && (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="outline"
            onClick={() => fetchLogs({ cursor: nextCursor, append: true })}
            disabled={isLoadingMore || !nextCursor}
            className="gap-2"
          >
            {isLoadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            טען עוד
          </Button>
        </div>
      )}
    </div>
  );
}
