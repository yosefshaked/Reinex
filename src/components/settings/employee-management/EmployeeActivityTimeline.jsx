import React, { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { authenticatedFetch } from '@/lib/api-client';
import { cn } from '@/lib/utils';

const FILTERS = [
  { key: 'all', label: 'הכל' },
  { key: 'operational', label: 'תפעולי' },
  { key: 'system', label: 'מערכת' },
  { key: 'documents', label: 'מסמכים' },
];

function formatTimestamp(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('he-IL', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatDayKey(value) {
  if (!value) return 'ללא תאריך';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'ללא תאריך';
  return new Intl.DateTimeFormat('he-IL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

function familyVariant(family) {
  if (family === 'documents') return 'secondary';
  if (family === 'operational') return 'default';
  return 'outline';
}

export default function EmployeeActivityTimeline({ employeeId, orgId, session, enabled = true }) {
  const [items, setItems] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [filterKey, setFilterKey] = useState('all');

  useEffect(() => {
    if (!enabled || !employeeId || !orgId) {
      setItems([]);
      return;
    }

    let isActive = true;
    const load = async () => {
      setIsLoading(true);
      setError('');
      try {
        const payload = await authenticatedFetch(`employee-activity?org_id=${orgId}&employee_id=${employeeId}`, { session });
        if (isActive) {
          setItems(Array.isArray(payload?.items) ? payload.items : []);
        }
      } catch (loadError) {
        console.error('Failed to load employee activity', loadError);
        if (isActive) {
          setError(loadError?.message || 'טעינת הפעילות נכשלה.');
          setItems([]);
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    };

    void load();
    return () => {
      isActive = false;
    };
  }, [employeeId, enabled, orgId, session]);

  const filteredItems = useMemo(() => (
    filterKey === 'all' ? items : items.filter((item) => item.event_family === filterKey)
  ), [filterKey, items]);

  const groups = useMemo(() => {
    const grouped = new Map();
    filteredItems.forEach((item) => {
      const key = formatDayKey(item.occurred_at);
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key).push(item);
    });
    return Array.from(grouped.entries());
  }, [filteredItems]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-4 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        טוען פעילות...
      </div>
    );
  }

  if (error) {
    return <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700">{error}</div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((filter) => (
          <button
            key={filter.key}
            type="button"
            onClick={() => setFilterKey(filter.key)}
            className={cn(
              'rounded-xl border px-3 py-1.5 text-xs font-bold transition',
              filterKey === filter.key
                ? 'border-blue-600 bg-blue-600 text-white'
                : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300',
            )}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {groups.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 p-5 text-center text-sm text-slate-500">
          אין עדיין אירועים להצגה עבור העובד.
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map(([dayLabel, dayItems]) => (
            <div key={dayLabel} className="space-y-2">
              <div className="text-xs font-bold uppercase tracking-wide text-slate-500">{dayLabel}</div>
              <div className="space-y-2">
                {dayItems.map((item) => (
                  <div key={item.id} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-sm font-bold text-slate-900">{item.title}</div>
                          <Badge variant={familyVariant(item.event_family)}>
                            {item.event_family === 'operational' ? 'תפעולי' : item.event_family === 'documents' ? 'מסמכים' : 'מערכת'}
                          </Badge>
                        </div>
                        {item.subtitle ? <div className="mt-1 text-xs text-slate-500">{item.subtitle}</div> : null}
                        <div className="mt-2 text-[11px] text-slate-400">
                          {formatTimestamp(item.occurred_at)} • {item.actor || 'מערכת'}
                        </div>
                      </div>
                      {item.metadata?.details?.updated_fields?.length ? (
                        <Button size="sm" variant="ghost" disabled className="text-xs text-slate-500">
                          {item.metadata.details.updated_fields.length} שדות
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
