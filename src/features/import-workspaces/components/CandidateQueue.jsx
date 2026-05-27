import { useState, useCallback, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertCircle, AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react';
import { listCandidates } from '../api/importWorkspacesApi.js';

const ENTITY_TYPE_LABELS = {
  active_student:   'תלמיד/ה פעיל/ה',
  inactive_student: 'תלמיד/ה לא פעיל/ה (ארכיון)',
  guardian:         'הורה',
  guardian_link:    'קישור הורה-תלמיד',
  service:          'שירות',
  student_note:     'הערה',
};

const STATUS_LABELS = {
  needs_review:         'לבדיקה',
  ready:                'מוכן',
  blocked:              'חסום',
  blocked_by_dependency:'ממתין לתלות',
  skipped:              'מדולג',
  committed:            'בוצע',
  failed:               'נכשל',
};

const STATUS_VARIANT = {
  needs_review:         'default',
  ready:                'default',
  blocked:              'destructive',
  blocked_by_dependency:'secondary',
  skipped:              'secondary',
  committed:            'outline',
  failed:               'destructive',
};

function CandidateRow({ candidate, onSelect }) {
  const hasBlockers  = candidate.blocking_issues_count > 0;
  const warningCount = (candidate.issues || []).filter(i => i.severity === 'warning').length;
  const displayName  = [
    candidate.candidate_data?.first_name,
    candidate.candidate_data?.last_name,
  ].filter(Boolean).join(' ')
    || candidate.candidate_data?.name
    || candidate.candidate_data?.note_text?.slice(0, 30)
    || '—';

  return (
    <tr
      className="border-b hover:bg-muted/30 transition-colors cursor-pointer"
      onClick={() => onSelect(candidate)}
    >
      <td className="px-3 py-2.5 text-sm font-medium">{displayName}</td>
      <td className="px-3 py-2.5 text-sm text-muted-foreground">
        {ENTITY_TYPE_LABELS[candidate.entity_type] ?? candidate.entity_type}
      </td>
      <td className="px-3 py-2.5">
        <Badge variant={STATUS_VARIANT[candidate.status] || 'secondary'} className="text-xs">
          {STATUS_LABELS[candidate.status] || candidate.status}
        </Badge>
      </td>
      <td className="px-3 py-2.5">
        <div className="flex gap-1.5 flex-wrap">
          {hasBlockers && (
            <span className="inline-flex items-center gap-1 rounded text-xs px-1.5 py-0.5 bg-destructive/10 text-destructive font-medium">
              <AlertCircle className="h-3 w-3" />
              {candidate.blocking_issues_count} חוסמים
            </span>
          )}
          {warningCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded text-xs px-1.5 py-0.5 bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400 font-medium">
              <AlertTriangle className="h-3 w-3" />
              {warningCount} אזהרות
            </span>
          )}
          {!hasBlockers && warningCount === 0 && (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </div>
      </td>
      <td className="px-3 py-2.5 text-xs text-muted-foreground">
        <ChevronLeft className="h-4 w-4 ms-auto" aria-hidden />
      </td>
    </tr>
  );
}

/**
 * @param {{
 *   workspaceId: string,
 *   onCandidateSelect: (candidate: object) => void,
 * }} props
 */
export function CandidateQueue({ workspaceId, onCandidateSelect }) {
  const [entityType, setEntityType]  = useState('');
  const [status, setStatus]          = useState('');
  const [page, setPage]              = useState(1);
  const [data, setData]              = useState(null);
  const [loading, setLoading]        = useState(false);
  const [error, setError]            = useState(null);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await listCandidates(workspaceId, {
        entityType: entityType || undefined,
        status: status || undefined,
        page,
      });
      setData(result);
    } catch (err) {
      setError(err.message || 'שגיאה בטעינת מועמדים');
    } finally {
      setLoading(false);
    }
  }, [workspaceId, entityType, status, page]);

  useEffect(() => {
    load();
  }, [load]);

  const totalPages = data ? Math.ceil(data.total / data.pageSize) : 1;

  function handleFilterChange(setter) {
    return (val) => {
      setter(val === 'all' ? '' : val);
      setPage(1);
    };
  }

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="flex gap-2 flex-wrap items-center">
        <Select value={entityType || 'all'} onValueChange={handleFilterChange(setEntityType)} dir="rtl">
          <SelectTrigger className="h-8 w-44 text-sm">
            <SelectValue placeholder="כל הסוגים" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">כל הסוגים</SelectItem>
            {Object.entries(ENTITY_TYPE_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={status || 'all'} onValueChange={handleFilterChange(setStatus)} dir="rtl">
          <SelectTrigger className="h-8 w-36 text-sm">
            <SelectValue placeholder="כל הסטטוסים" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">כל הסטטוסים</SelectItem>
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <span className="text-sm text-muted-foreground me-auto">
          {data ? `${data.total.toLocaleString()} רשומות` : ''}
        </span>

        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          רענן
        </Button>
      </div>

      {/* Table */}
      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr>
              <th className="text-end px-3 py-2 font-medium">שם</th>
              <th className="text-end px-3 py-2 font-medium">סוג</th>
              <th className="text-end px-3 py-2 font-medium">סטטוס</th>
              <th className="text-end px-3 py-2 font-medium">בעיות</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {loading && (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b">
                  <td className="px-3 py-2.5" colSpan={5}>
                    <Skeleton className="h-4 w-full" />
                  </td>
                </tr>
              ))
            )}
            {!loading && error && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-sm text-destructive">{error}</td>
              </tr>
            )}
            {!loading && !error && data?.candidates.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-sm text-muted-foreground">
                  אין רשומות להציג
                </td>
              </tr>
            )}
            {!loading && !error && (data?.candidates || []).map(c => (
              <CandidateRow key={c.id} candidate={c} onSelect={onCandidateSelect} />
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="outline" size="icon" className="h-7 w-7"
            onClick={() => setPage(p => p - 1)} disabled={page <= 1 || loading}
            aria-label="עמוד קודם"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <span className="text-sm text-muted-foreground">{page} / {totalPages}</span>
          <Button
            variant="outline" size="icon" className="h-7 w-7"
            onClick={() => setPage(p => p + 1)} disabled={page >= totalPages || loading}
            aria-label="עמוד הבא"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
