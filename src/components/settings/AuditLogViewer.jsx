import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CalendarDays,
  Clock3,
  FileText,
  HardDrive,
  History,
  Loader2,
  MapPin,
  RefreshCw,
  Settings2,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { authenticatedFetch } from '@/lib/api-client.js';
import { formatAuditDetailValue, getAuditActionLabel, getAuditDetailLabel } from '@/lib/audit-log-ui.js';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';

const PAGE_SIZE = 50;
const RELATIVE_FORMATTER = new Intl.RelativeTimeFormat('he-IL', { numeric: 'auto' });

const ROLE_LABELS = {
  owner: 'בעלים',
  admin: 'מנהל',
  office: 'משרד',
  member: 'חבר צוות',
  system_admin: 'מנהל מערכת',
};

const CATEGORY_META = {
  calendar: {
    label: 'לוח שנה',
    icon: CalendarDays,
    badgeClass: 'bg-blue-100 text-blue-800 border-blue-200',
  },
  storage: {
    label: 'אחסון',
    icon: HardDrive,
    badgeClass: 'bg-cyan-100 text-cyan-800 border-cyan-200',
  },
  backup: {
    label: 'גיבוי',
    icon: ShieldCheck,
    badgeClass: 'bg-slate-100 text-slate-800 border-slate-200',
  },
  settings: {
    label: 'הגדרות',
    icon: Settings2,
    badgeClass: 'bg-violet-100 text-violet-800 border-violet-200',
  },
  students: {
    label: 'תלמידים',
    icon: UserRound,
    badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  },
  files: {
    label: 'מסמכים',
    icon: FileText,
    badgeClass: 'bg-amber-100 text-amber-800 border-amber-200',
  },
};

const RESOURCE_LABELS = {
  lesson_template: 'תבנית שיעור',
  student: 'תלמיד',
  instructor: 'מדריך',
  org_settings: 'ארגון',
  organization: 'ארגון',
  storage_profile: 'פרופיל אחסון',
  files: 'קבצים',
  document: 'מסמך',
  membership: 'חבר צוות',
  backup: 'גיבוי',
};

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

function formatRelativeTime(value) {
  if (!value) return '—';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const absSeconds = Math.abs(seconds);

  if (absSeconds < 60) {
    return RELATIVE_FORMATTER.format(seconds, 'second');
  }

  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) {
    return RELATIVE_FORMATTER.format(minutes, 'minute');
  }

  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) {
    return RELATIVE_FORMATTER.format(hours, 'hour');
  }

  const days = Math.round(hours / 24);
  return RELATIVE_FORMATTER.format(days, 'day');
}

function normalizeFilter(value) {
  return String(value || '').trim().toLowerCase();
}

function describeAction(log) {
  return getAuditActionLabel(log?.action_type);
}

function resolveCategoryMeta(category) {
  const normalized = String(category || '').trim().toLowerCase();
  if (CATEGORY_META[normalized]) {
    return CATEGORY_META[normalized];
  }

  return {
    label: normalized || 'אחר',
    icon: History,
    badgeClass: 'bg-slate-100 text-slate-700 border-slate-200',
  };
}

function resolveRole(role) {
  const normalized = String(role || '').trim().toLowerCase();
  return ROLE_LABELS[normalized] || (normalized || 'לא ידוע');
}

function resolveResource(resourceType) {
  const normalized = String(resourceType || '').trim().toLowerCase();
  return RESOURCE_LABELS[normalized] || (normalized || 'לא צוין משאב');
}

function shortenIdentifier(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  if (normalized.length <= 18) return normalized;
  return `${normalized.slice(0, 8)}...${normalized.slice(-6)}`;
}

function extractDetails(details) {
  if (!details || typeof details !== 'object' || Array.isArray(details)) {
    return [];
  }

  return Object.entries(details)
    .filter(([key, value]) => key && value !== null && typeof value !== 'undefined')
    .slice(0, 4)
    .map(([key, value]) => ({
      label: getAuditDetailLabel(key),
      value: formatAuditDetailValue(value, key),
    }));
}

function buildWhereText(log) {
  const category = resolveCategoryMeta(log?.action_category).label;
  const resource = resolveResource(log?.resource_type);
  return `${category} · ${resource}`;
}

function toSearchText(log) {
  return [
    describeAction(log),
    resolveCategoryMeta(log.action_category).label,
    resolveResource(log.resource_type),
    log.user_email,
    resolveRole(log.user_role),
    log.action_type,
    log.action_category,
    log.resource_type,
    log.resource_id,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
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

    return logs.filter((log) => toSearchText(log).includes(filterText));
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
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">יומן ביקורת ארגוני</h3>
          <p className="text-sm text-slate-600">תצוגה ידידותית של מה קרה, מי ביצע, מתי ובאיזה מודול.</p>
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
          placeholder="חיפוש חופשי לפי מה קרה, מי ביצע ואיפה"
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
        <div className="space-y-3">
          {visibleLogs.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-slate-500">
              לא נמצאו רשומות יומן ביקורת.
            </div>
          ) : (
            visibleLogs.map((log) => {
              const categoryMeta = resolveCategoryMeta(log.action_category);
              const CategoryIcon = categoryMeta.icon;
              const actor = log.user_email || 'משתמש מערכת';
              const role = resolveRole(log.user_role);
              const details = extractDetails(log.details);

              return (
                <article key={log.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="rounded-lg bg-slate-100 p-2 text-slate-600">
                        <CategoryIcon className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="text-base font-semibold text-slate-900">{describeAction(log)}</p>
                        <p className="mt-1 text-sm text-slate-600">
                          <span className="font-medium text-slate-700">{actor}</span>
                          <span className="mx-1.5">•</span>
                          <span>{role}</span>
                        </p>
                      </div>
                    </div>
                    <Badge className={categoryMeta.badgeClass}>{categoryMeta.label}</Badge>
                  </div>

                  <div className="mt-3 grid gap-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-700 md:grid-cols-3">
                    <div className="flex items-start gap-2">
                      <Clock3 className="mt-0.5 h-4 w-4 text-slate-500" />
                      <div>
                        <p className="font-medium text-slate-800">מתי</p>
                        <p>{formatRelativeTime(log.performed_at)}</p>
                        <p className="text-xs text-slate-500">{formatDateTime(log.performed_at)}</p>
                      </div>
                    </div>

                    <div className="flex items-start gap-2">
                      <MapPin className="mt-0.5 h-4 w-4 text-slate-500" />
                      <div>
                        <p className="font-medium text-slate-800">איפה</p>
                        <p>{buildWhereText(log)}</p>
                      </div>
                    </div>

                    <div className="flex items-start gap-2">
                      <History className="mt-0.5 h-4 w-4 text-slate-500" />
                      <div>
                        <p className="font-medium text-slate-800">מזהה פעולה</p>
                        <p className="font-mono text-xs text-slate-600">{log.action_type || '—'}</p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-3">
                    <p className="mb-2 text-xs font-medium text-slate-500">פרטים נוספים</p>
                    {details.length === 0 ? (
                      <p className="text-sm text-slate-500">אין פרטים נוספים לפעולה זו.</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {details.map((entry) => (
                          <span key={`${log.id}-${entry.label}`} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700">
                            <span className="font-medium">{entry.label}:</span> {entry.value}
                          </span>
                        ))}
                        {log.resource_id ? (
                          <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700">
                            <span className="font-medium">מזהה משאב:</span> {shortenIdentifier(log.resource_id)}
                          </span>
                        ) : null}
                      </div>
                    )}
                  </div>
                </article>
              );
            })
          )}
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
